// Copyright (c) 2026, Compiler Explorer Authors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import fs from 'node:fs/promises';
import path from 'node:path';

import type {ParsedAsmResult} from '../../types/asmresult/asmresult.interfaces.js';
import type {CompilationResult, ExecutionOptionsWithEnv} from '../../types/compilation/compilation.interfaces.js';
import type {ParseFiltersAndOutputOptions} from '../../types/features/filters.interfaces.js';
import {AnalysisTool} from './analysis-tool.js';
import {ClangParser} from './argument-parsers.js';
import {type InterpreterStreams, IrInterpreter} from './ir-interpreter.js';

// Each SMT query gets far longer than a whole compile is usually allowed, so a hard problem ends in CE's
// timeout (where we can suggest how to simplify it) rather than in a terse per-query "timeout" from Alive2.
// It comes before the user's options, and alive-tv takes the last occurrence, so users can still override it.
const defaultSmtTimeoutArg = '--smt-to=50000';

const timeoutAdvice = `There are a few things you can try:

- remove extraneous instructions, if any

- reduce variable widths, for example to i16, i8, or i4`;

// backend-tv already assumes inputs are neither undef nor poison, so the undef advice doesn't apply to it.
export const backendTvTimeoutMessage = `backend-tv timed out while processing your query.
${timeoutAdvice}`;

export const aliveTimeoutMessage = `Alive2 timed out while processing your query.
${timeoutAdvice}

- add the --disable-undef-input command line flag, which
  allows Alive2 to assume that arguments to your IR are not
  undef. This is, in general, unsound: it can cause Alive2
  to miss bugs.`;

export class AliveTvCompiler extends AnalysisTool {
    static override get key() {
        return 'alive-tv';
    }

    override supportsObjdump() {
        return false;
    }

    override optionsForFilter(filters: ParseFiltersAndOutputOptions, outputFilename: string) {
        return [defaultSmtTimeoutArg, '-o', this.filename(outputFilename)];
    }

    override getArgumentParserClass() {
        return ClangParser;
    }

    override getCompilerResultLanguageId(_filters?: ParseFiltersAndOutputOptions): string {
        return 'llvm-ir';
    }

    // alive-tv's report is prose interleaved with IR; the asm parser would treat lines like "#0:" as labels.
    override async processAsm(result: {asm: string}): Promise<ParsedAsmResult> {
        return {asm: result.asm.split('\n').map(text => ({text, source: null}))};
    }

    override postCompilationPreCacheHook(result: CompilationResult): CompilationResult {
        if (result.timedOut) {
            result.asm = aliveTimeoutMessage.split('\n').map(text => ({text, source: null}));
        }
        return result;
    }
}

export class AliveExecCompiler extends IrInterpreter {
    static override get key() {
        return 'alive-exec';
    }

    override readonly timeoutMessage = aliveTimeoutMessage;

    // alive-exec writes its report to std::cout and ignores -o, so there is no output file to name.
    override optionsForFilter(_filters: ParseFiltersAndOutputOptions, _outputFilename: string) {
        return [defaultSmtTimeoutArg];
    }

    override splitStreams(stdout: string, stderr: string): InterpreterStreams {
        // alive-exec models no output libcalls, so the program cannot write anything of its own, and stderr
        // carries only the IR reader's diagnostics. Both belong in the report.
        return {report: stdout + stderr, programOutput: ''};
    }

    override ranTheProgram(report: string): boolean {
        // alive-exec names each basic block as it enters it, having first echoed the function.
        return /^Executing /m.test(report);
    }

    override reportsItsOwnExit(report: string): boolean {
        // Returned gives the full value, where the exit status keeps only its bottom eight bits, and the
        // 255 that goes with ERROR (poison) or UB triggered is alive-exec's own rather than the program's.
        return /^(?:Returned |ERROR: )|UB triggered!/m.test(report);
    }
}

// backend-tv compiles the IR for AArch64 or RISC-V, lifts the assembly back to IR and checks that against the
// original. It reports on stdout rather than to a file named with -o, because it gives up with a non-zero status
// on anything the lifter can't handle, having said why, and CE empties the main pane whenever the status is
// non-zero: the report then has to travel as compiler output to be seen at all.
export class BackendTvCompiler extends AliveTvCompiler {
    static override get key() {
        return 'backend-tv';
    }

    // Without --terse, backend-tv also echoes its argv and the lifter's full trace, lifted IR included. Users
    // who want that can pass --terse=false, which comes later and so wins.
    override optionsForFilter(_filters: ParseFiltersAndOutputOptions, _outputFilename: string) {
        return [defaultSmtTimeoutArg, '--terse'];
    }

    override async runCompiler(
        compiler: string,
        options: string[],
        inputFilename: string,
        execOptions: ExecutionOptionsWithEnv,
        filters?: ParseFiltersAndOutputOptions,
    ): Promise<CompilationResult> {
        execOptions ??= this.getDefaultExecOptions();
        execOptions.customCwd ??= path.dirname(inputFilename);

        const result = await this.exec(compiler, options, execOptions);
        // Only stdout and stderr are masked for us, so a report bound for the output file has to be masked here.
        const report = (result.stdout + result.stderr).split(result.filenameTransform(inputFilename)).join('<source>');

        await fs.writeFile(this.getOutputFilename(path.dirname(inputFilename), this.outputFilebase), report);
        result.stdout = '';
        result.stderr = result.code === 0 ? '' : report;

        return {
            ...this.transformToCompilationResult(result, inputFilename),
            languageId: this.getCompilerResultLanguageId(filters),
        };
    }

    override postCompilationPreCacheHook(result: CompilationResult): CompilationResult {
        if (result.timedOut) {
            result.asm = backendTvTimeoutMessage.split('\n').map(text => ({text, source: null}));
        }
        return result;
    }
}
