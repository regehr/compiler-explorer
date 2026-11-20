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

import type {ParseFiltersAndOutputOptions} from '../../types/features/filters.interfaces.js';
import {type InterpreterStreams, IrInterpreter} from './ir-interpreter.js';

// llubi says nothing at all about a run that goes well: the interpreted program's return value just becomes
// its exit status. Verbose is the only mode that shows the execution it performed, which is the whole point
// of reaching for a UB-aware interpreter, so ask for it up front. It comes before the user's options, where
// --verbose=false can still turn it back off.
const defaultVerboseArg = '--verbose';

export const llubiTimeoutMessage = `llubi ran out of time interpreting your program.

If it may not terminate, --max-steps=<N> stops it after N
instructions and --max-stack-depth=<N> bounds its recursion,
either of which reports where it had got to.`;

export class LlubiCompiler extends IrInterpreter {
    static override get key() {
        return 'llubi';
    }

    override readonly timeoutMessage = llubiTimeoutMessage;

    // llubi has no -o: see splitStreams for where its two kinds of output go instead.
    override optionsForFilter(_filters: ParseFiltersAndOutputOptions, _outputFilename: string) {
        return [defaultVerboseArg];
    }

    override splitStreams(stdout: string, stderr: string): InterpreterStreams {
        // Mirrors the split the llubi playground shows: the interpreter's trace, UB reports and diagnostics
        // go to stderr, while printf and puts from the program itself go to stdout.
        return {report: stderr, programOutput: stdout};
    }

    override ranTheProgram(report: string): boolean {
        // --verbose announces every function the interpreter enters, so this is also what tells a run that
        // got started from one that fell over on the IR before it could begin.
        return /^Entering function: /m.test(report);
    }

    override reportsItsOwnExit(report: string): boolean {
        if (/^Program (?:exited with code \d+|aborted)/m.test(report)) return true;
        // Having got as far as running, any diagnostic llubi raises is its account of undefined behaviour or
        // a poison return, either bare or prefixed with the tool name and position.
        return /^(?:.*?\s)?error: /im.test(report);
    }
}
