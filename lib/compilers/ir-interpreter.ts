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

export type InterpreterStreams = {
    /** The interpreter's own account of the run: its trace and any UB diagnosis. Shown in the main pane. */
    report: string;
    /** Whatever the interpreted program itself wrote. Shown in the output pane. */
    programOutput: string;
};

// Base for the interpreters of LLVM IR. Two things set them apart from the compilers CE usually drives: they
// write their report to a stream instead of to a file named with -o, and once they start running their exit
// status is the interpreted program's, so neither `ret i32 42` from main nor a finding of undefined behaviour
// should reach CE as a failure.
export abstract class IrInterpreter extends AnalysisTool {
    abstract splitStreams(stdout: string, stderr: string): InterpreterStreams;

    /**
     * True when the report shows the interpreter got as far as running the program, so that whatever it says
     * next, undefined behaviour included, is a result. Until then a non-zero status is the tool's own: it
     * could not read the IR, or found nothing in it to run.
     */
    abstract ranTheProgram(report: string): boolean;

    /** True when the report already says how the run ended, so that adding a line would only repeat it. */
    abstract reportsItsOwnExit(report: string): boolean;

    /** Shown in place of the report when CE's own timeout cuts the interpreter short. */
    abstract readonly timeoutMessage: string;

    override supportsObjdump() {
        return false;
    }

    override getArgumentParserClass() {
        return ClangParser;
    }

    override getCompilerResultLanguageId(_filters?: ParseFiltersAndOutputOptions): string {
        return 'llvm-ir';
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
        const {report, programOutput} = this.splitStreams(result.stdout, result.stderr);
        const masked = this.maskInputFilename(report, result.filenameTransform(inputFilename));
        const summarised = this.summariseExit(masked, result.code, result.timedOut);

        await fs.writeFile(this.getOutputFilename(path.dirname(inputFilename), this.outputFilebase), summarised.report);
        result.stdout = programOutput;
        // CE empties the main pane whenever the status is non-zero, so a report that goes with a failure has
        // to travel as compiler output if it is to be seen at all.
        result.stderr = summarised.code === 0 ? '' : summarised.report;
        result.code = summarised.code;

        return {
            ...this.transformToCompilationResult(result, inputFilename),
            languageId: this.getCompilerResultLanguageId(filters),
        };
    }

    /** Only stdout and stderr are masked for us, so a report bound for the output file has to be masked here. */
    maskInputFilename(report: string, transformedInputFilename: string): string {
        return report.split(transformedInputFilename).join('<source>');
    }

    summariseExit(report: string, code: number, timedOut: boolean): {report: string; code: number} {
        if (timedOut || code < 0 || !this.ranTheProgram(report)) return {report, code};
        if (this.reportsItsOwnExit(report)) return {report, code: 0};
        const separator = report.endsWith('\n') ? '' : '\n';
        return {report: `${report}${separator}Program exited with status ${code}\n`, code: 0};
    }

    // The reports are prose interleaved with IR; the asm parser would treat lines like "#0:" as labels.
    override async processAsm(result: {asm: string}): Promise<ParsedAsmResult> {
        return {asm: result.asm.split('\n').map(text => ({text, source: null}))};
    }

    override postCompilationPreCacheHook(result: CompilationResult): CompilationResult {
        if (result.timedOut) {
            result.asm = this.timeoutMessage.split('\n').map(text => ({text, source: null}));
        }
        return result;
    }
}
