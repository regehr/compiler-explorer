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

import type {ParsedAsmResult} from '../../types/asmresult/asmresult.interfaces.js';
import type {CompilationResult} from '../../types/compilation/compilation.interfaces.js';
import type {ParseFiltersAndOutputOptions} from '../../types/features/filters.interfaces.js';
import {AnalysisTool} from './analysis-tool.js';
import {ClangParser} from './argument-parsers.js';

// Each SMT query gets far longer than a whole compile is usually allowed, so a hard problem ends in CE's
// timeout (where we can suggest how to simplify it) rather than in a terse per-query "timeout" from Alive2.
// It comes before the user's options, and alive-tv takes the last occurrence, so users can still override it.
const defaultSmtTimeoutArg = '--smt-to=50000';

export const aliveTimeoutMessage = `Alive2 timed out while processing your query.
There are a few things you can try:

- remove extraneous instructions, if any

- reduce variable widths, for example to i16, i8, or i4

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
