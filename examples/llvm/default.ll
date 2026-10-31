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

; Hosting is provided by Google
; This instance is administered by John Regehr
; Alive2 is developed by Nuno P. Lopes and others
