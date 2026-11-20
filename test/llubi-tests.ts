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

import {beforeAll, describe, expect, it} from 'vitest';

import {LlubiCompiler} from '../lib/compilers/index.js';
import {llubiTimeoutMessage} from '../lib/compilers/llubi.js';
import type {CompilationResult} from '../types/compilation/compilation.interfaces.js';
import {makeCompilationEnvironment, makeFakeCompilerInfo, makeFakeParseFiltersAndOutputOptions} from './utils.js';

const languages = {
    llvm: {id: 'llvm'},
} as const;

describe('llubi compiler', () => {
    let compiler: LlubiCompiler;

    beforeAll(() => {
        const info = makeFakeCompilerInfo({exe: '/opt/llvm/bin/llubi', lang: languages.llvm.id});
        compiler = new LlubiCompiler(info, makeCompilationEnvironment({languages}));
    });

    // ---- Arguments ----

    it('should ask for a verbose trace and nothing else, since llubi has no -o', () => {
        const filters = makeFakeParseFiltersAndOutputOptions({intel: true});
        expect(compiler.optionsForFilter(filters, 'output.txt')).toEqual(['--verbose']);
    });

    it('should let a user turn the trace back off', () => {
        const filters = makeFakeParseFiltersAndOutputOptions({intel: true});
        const args = compiler.prepareArguments(['--verbose=false'], filters, {}, 'example.ll', 'output.txt', [], []);
        expect(args).toEqual(['--verbose', '--verbose=false', 'example.ll']);
    });

    // ---- Streams ----

    it('should show the interpreter log in the main pane and the program output separately', () => {
        expect(compiler.splitStreams('hello world', 'Entering function: main\n')).toEqual({
            report: 'Entering function: main\n',
            programOutput: 'hello world',
        });
    });

    it('should mask the temporary path the tool was handed', () => {
        const report = '#0   br label %loop at @main /tmp/compiler-explorer-compilerX/example.ll:5\n';
        expect(compiler.maskInputFilename(report, '/tmp/compiler-explorer-compilerX/example.ll')).toBe(
            '#0   br label %loop at @main <source>:5\n',
        );
    });

    // ---- Exit status ----

    it('should treat the interpreted program return value as success, not failure', () => {
        const report = 'Entering function: main\n  ret i32 42\nExiting function: main\n';
        expect(compiler.summariseExit(report, 42, false)).toEqual({
            report: `${report}Program exited with status 42\n`,
            code: 0,
        });
    });

    it('should not repeat an exit the trace already reported', () => {
        for (const ending of ['Program exited with code 3\n', 'Program aborted.\n']) {
            const report = `Entering function: main\n${ending}`;
            expect(compiler.summariseExit(report, 3, false)).toEqual({report, code: 0});
        }
    });

    it('should report undefined behaviour as a finding of the run rather than a failure of the tool', () => {
        const report =
            'Entering function: main\nImmediate UB detected: Integer division by zero.\n' +
            "error: Execution of function 'main' failed.\n";
        expect(compiler.summariseExit(report, 1, false)).toEqual({report, code: 0});
    });

    it('should keep a parse diagnostic as a failure, since the run never started', () => {
        const report = '/opt/llvm/bin/llubi: bad.ll:2:11: error: expected value token\n';
        expect(compiler.summariseExit(report, 1, false)).toEqual({report, code: 1});
    });

    it('should keep a missing entry function as a failure, despite the diagnostic looking like a finding', () => {
        const report = "error: 'main' function not found in module.\n";
        expect(compiler.summariseExit(report, 1, false)).toEqual({report, code: 1});
    });

    it('should leave a timeout alone', () => {
        const report = 'Entering function: main\n';
        expect(compiler.summariseExit(report, -1, true)).toEqual({report, code: -1});
    });

    // ---- Output ----

    it('should pass the trace through line by line, without asm filtering', async () => {
        const report = 'Entering function: main\n  %a = add i32 20, 22 => i32 42\n  ret i32 %a';
        const result = await compiler.processAsm({asm: report});
        expect(result.asm.map(line => line.text)).toEqual(report.split('\n'));
        expect(result.asm.every(line => line.source === null)).toBe(true);
    });

    it('should replace the output with advice when llubi times out', () => {
        const result = compiler.postCompilationPreCacheHook({
            code: -1,
            timedOut: true,
            asm: '<Compilation failed>',
        } as CompilationResult);
        expect((result.asm as {text: string}[]).map(line => line.text)).toEqual(llubiTimeoutMessage.split('\n'));
    });
});
