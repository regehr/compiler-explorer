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

import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {CompilationEnvironment} from '../lib/compilation-env.js';
import {aliveTimeoutMessage, backendTvTimeoutMessage} from '../lib/compilers/alive-tv.js';
import {AliveExecCompiler, AliveTvCompiler, BackendTvCompiler} from '../lib/compilers/index.js';
import type {CompilationResult, ExecutionOptionsWithEnv} from '../types/compilation/compilation.interfaces.js';
import {
    makeCompilationEnvironment,
    makeFakeCompilerInfo,
    makeFakeParseFiltersAndOutputOptions,
    newTempDir,
} from './utils.js';

const languages = {
    llvm: {id: 'llvm'},
} as const;

describe('alive-tv compiler', () => {
    let ce: CompilationEnvironment;
    let compiler: AliveTvCompiler;

    beforeAll(() => {
        ce = makeCompilationEnvironment({languages});
        const info = makeFakeCompilerInfo({
            exe: '/opt/alive2/alive-tv',
            lang: languages.llvm.id,
        });
        compiler = new AliveTvCompiler(info, ce);
    });

    // ---- Arguments ----

    it('should pass only an SMT timeout and the output file, regardless of filters', () => {
        const filters = makeFakeParseFiltersAndOutputOptions({intel: true, binary: false});
        expect(compiler.optionsForFilter(filters, 'output.txt')).toEqual(['--smt-to=50000', '-o', 'output.txt']);
    });

    it('should let a user-supplied SMT timeout come after the default one', () => {
        const filters = makeFakeParseFiltersAndOutputOptions({intel: true});
        const args = compiler.prepareArguments(
            ['--smt-to=1000', '--disable-undef-input'],
            filters,
            {},
            'example.ll',
            'output.txt',
            [],
            [],
        );
        expect(args).toEqual([
            '--smt-to=50000',
            '-o',
            'output.txt',
            '--smt-to=1000',
            '--disable-undef-input',
            'example.ll',
        ]);
    });

    it('should not support objdump', () => {
        expect(compiler.supportsObjdump()).toBe(false);
    });

    // ---- Output ----

    it('should pass the report through line by line, without asm filtering', async () => {
        const report = 'define i32 @src(i32 %x) {\n#0:\n  ret i32 %x\n}\nTransformation seems to be correct!';
        const result = await compiler.processAsm({asm: report});
        expect(result.asm.map(line => line.text)).toEqual(report.split('\n'));
        expect(result.asm.every(line => line.source === null)).toBe(true);
    });

    it('should replace the output with advice when alive-tv times out', () => {
        const result = compiler.postCompilationPreCacheHook({
            code: -1,
            timedOut: true,
            asm: '<Compilation failed>',
        } as CompilationResult);
        expect((result.asm as {text: string}[]).map(line => line.text)).toEqual(aliveTimeoutMessage.split('\n'));
    });

    it('should leave other failures alone', () => {
        const result = compiler.postCompilationPreCacheHook({
            code: 255,
            timedOut: false,
            asm: '<Compilation failed>',
        } as CompilationResult);
        expect(result.asm).toBe('<Compilation failed>');
    });
});

describe('backend-tv compiler', () => {
    let compiler: BackendTvCompiler;

    beforeAll(() => {
        const info = makeFakeCompilerInfo({exe: '/opt/alive2/backend-tv', lang: languages.llvm.id});
        compiler = new BackendTvCompiler(info, makeCompilationEnvironment({languages}));
    });

    afterEach(() => vi.restoreAllMocks());

    async function runWith(code: number, report: string) {
        const dir = newTempDir();
        await fs.writeFile(compiler.getOutputFilename(dir, compiler.outputFilebase), report);
        vi.spyOn(compiler, 'exec').mockResolvedValue({
            code,
            okToCache: true,
            filenameTransform: filename => filename,
            stdout: '',
            stderr: '',
            execTime: 0,
            timedOut: false,
            truncated: false,
        });
        return compiler.runCompiler('backend-tv', [], path.join(dir, 'example.ll'), {} as ExecutionOptionsWithEnv);
    }

    // ---- Arguments ----

    it('should ask for the terse report ahead of the options it shares with alive-tv', () => {
        const filters = makeFakeParseFiltersAndOutputOptions({intel: true});
        expect(compiler.optionsForFilter(filters, 'output.txt')).toEqual([
            '--terse',
            '--smt-to=50000',
            '-o',
            'output.txt',
        ]);
    });

    it('should let a user bring the lifter trace back', () => {
        const filters = makeFakeParseFiltersAndOutputOptions({intel: true});
        const args = compiler.prepareArguments(['--terse=false'], filters, {}, 'example.ll', 'output.txt', [], []);
        expect(args).toEqual(['--terse', '--smt-to=50000', '-o', 'output.txt', '--terse=false', 'example.ll']);
    });

    // ---- Output ----

    it('should show why the lifter gave up, although CE discards the report of a failed run', async () => {
        const result = await runWith(255, "ERROR: we don't support structures in return values yet\n");
        expect(result.code).toBe(255);
        expect(result.stderr.map(line => line.text)).toEqual([
            "ERROR: we don't support structures in return values yet",
        ]);
    });

    it('should not repeat the report as compiler output when it reaches the main pane', async () => {
        const result = await runWith(0, 'Transformation seems to be correct!\n');
        expect(result.stderr).toEqual([]);
    });

    it('should not suggest --disable-undef-input on a timeout, since backend-tv already assumes it', () => {
        const result = compiler.postCompilationPreCacheHook({
            code: -1,
            timedOut: true,
            asm: '<Compilation failed>',
        } as CompilationResult);
        expect((result.asm as {text: string}[]).map(line => line.text)).toEqual(backendTvTimeoutMessage.split('\n'));
        expect(backendTvTimeoutMessage).not.toContain('--disable-undef-input');
    });
});

describe('alive-exec compiler', () => {
    let compiler: AliveExecCompiler;

    beforeAll(() => {
        const info = makeFakeCompilerInfo({exe: '/opt/alive2/alive-exec', lang: languages.llvm.id});
        compiler = new AliveExecCompiler(info, makeCompilationEnvironment({languages}));
    });

    // ---- Arguments ----

    it('should ask only for an SMT timeout, since -o is ignored', () => {
        const filters = makeFakeParseFiltersAndOutputOptions({intel: true});
        expect(compiler.optionsForFilter(filters, 'output.txt')).toEqual(['--smt-to=50000']);
    });

    // ---- Streams ----

    it('should report both streams, since the interpreted program writes nothing of its own', () => {
        expect(compiler.splitStreams('Executing %entry\n', "could not read bitcode from 'x.ll'\n")).toEqual({
            report: "Executing %entry\ncould not read bitcode from 'x.ll'\n",
            programOutput: '',
        });
    });

    // ---- Exit status ----

    it('should treat the interpreted program return value as success, not failure', () => {
        const report = 'Executing %#0\nReturned #x0000002a / non-poison=true\n';
        expect(compiler.summariseExit(report, 42, false)).toEqual({report, code: 0});
    });

    it('should report poison as a finding of the run rather than a failure of the tool', () => {
        const report = 'Executing %#0\nReturned #x80000000 / non-poison=false\nERROR: program returned poison\n';
        expect(compiler.summariseExit(report, 255, false)).toEqual({report, code: 0});
    });

    it('should report triggered UB without claiming the program itself exited 255', () => {
        const report = 'Executing %#0\n%a = UB triggered!\n';
        expect(compiler.summariseExit(report, 255, false)).toEqual({report, code: 0});
    });

    it('should keep a failure to read the IR as a failure, since the run never started', () => {
        const report = "bad.ll:2:11: error: expected value token\nCould not read bitcode from 'bad.ll'\n";
        expect(compiler.summariseExit(report, 255, false)).toEqual({report, code: 255});
    });

    it('should note the exit status when the report never said how the program ended', () => {
        expect(compiler.summariseExit('Executing %#0\n', 7, false)).toEqual({
            report: 'Executing %#0\nProgram exited with status 7\n',
            code: 0,
        });
    });

    it('should leave a timeout alone', () => {
        expect(compiler.summariseExit('Executing %#0\n', -1, true)).toEqual({report: 'Executing %#0\n', code: -1});
    });

    it('should replace the output with advice when alive-exec times out', () => {
        const result = compiler.postCompilationPreCacheHook({
            code: -1,
            timedOut: true,
            asm: '<Compilation failed>',
        } as CompilationResult);
        expect((result.asm as {text: string}[]).map(line => line.text)).toEqual(aliveTimeoutMessage.split('\n'));
    });
});
