; HINT: If you are running into timeouts, please
; consider passing the --disable-undef-input flag
; to alive-tv. Avoiding the need to reason about
; undef tends to make Alive2 a lot faster.

define i32 @src(i32 %x) {
  %r = udiv i32 %x, 8192
  ret i32 %r
}

define i32 @tgt(i32 %x) {
  %r = lshr i32 %x, 13
  ret i32 %r
}

; -------------------------

define i32 @main() {
  %x = freeze i32 poison
  %rs = udiv i32 %x, 8192
  %rt = lshr i32 %x, 13
  ret i32 1
}

; A good "getting started" exercise with Alive2
; would be to change the udiv (unsigned divide)
; instruction in @src above into an sdiv (signed
; divide) and then fix @tgt so that the optimization
; is again correct.

; alive-tv is a translation validation tool based
; on Alive2:
;   https://github.com/AliveToolkit/alive2
;
; You can use it in two ways:
; 1. As illustrated by the default text above, if
;    you provide an LLVM IR function called src
;    and one called tgt, alive-tv will try to prove
;    that tgt refines src
; 2. Otherwise, alive-tv will run an optimization
;    pipeline similar to -O2 on your code, and then
;    try to show that the optimized function(s)
;    refine the original one(s)

; llubi is LLVM's UB-aware interpreter. This is a
; newer and in-tree alternative to alive-exec. The
; documentation can be found here:
; https://llvm.org/docs/CommandGuide/llubi.html

; alive-exec is an experimental tool that uses Alive2
; to execute an LLVM IR function. The function must
; not have parameters or access memory. By default it
; executes "main"

; backend-tv is an experimental research project that
; uses Alive2's translation validation infrastructure
; to validate executions of LLVM's backend. It takes
; the first function in the file (@src in this case),
; lowers it to either RISC-V or AArch64 assembly,
; then tries to prove that the backend executed
; correctly by lifting the assembly back to IR. To
; see the lowering and lifting steps, pass --terse=0

; Hosting is provided by Google
; This instance is administered by John Regehr
; Alive2 is developed by Nuno P. Lopes and others
