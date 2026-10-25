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

import {CompilationEnvironment} from '../lib/compilation-env.js';
import {aliveTimeoutMessage} from '../lib/compilers/alive-tv.js';
import {AliveTvCompiler} from '../lib/compilers/index.js';
import type {CompilationResult} from '../types/compilation/compilation.interfaces.js';
import {makeCompilationEnvironment, makeFakeCompilerInfo, makeFakeParseFiltersAndOutputOptions} from './utils.js';

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
