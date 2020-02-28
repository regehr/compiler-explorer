define i32 @src(i32) {
  %r = udiv i32 %0, 8192
  ret i32 %r
}

define i32 @tgt(i32) {
  %r = lshr i32 %0, 13
  ret i32 %r
}

; alive-tv is a translation validation tool based
; on Alive2:
;   https://github.com/AliveToolkit/alive2
;
; you can use it in two ways:
; 1. as illustrated by the default text above, if
;    you provide an LLVM IR function called src
;    and one called tgt, alive-tv will try to prove
;    that tgt refines src
; 2. otherwise, alive-tv will run an optimization
;    pipeline similar to -O2 on your code, and then
;    try to show that the optimized function(s) 
;    refine the original one(s)