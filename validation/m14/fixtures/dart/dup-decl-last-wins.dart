// fixture: dart/dup-decl-last-wins — #753 / DARTD20 (the family dup-key ruling).
//
// One scope declaring the same callable twice is INVALID Dart (a compile
// error), so no compiling program reaches this shape. The analyzer must still
// answer DETERMINISTICALLY, and the family's answer — settled by python's #748
// on 512 pinned files, where 21 of 25 duplicate-name scopes turned out to be
// declaration CHAINS and 3 branch ALTERNATIVES, leaving exactly ONE genuine
// rebinding whose language answer was LAST-WINS — is that the LAST declaration
// owns the name.
//
// dart did the opposite (it kept the FIRST body), so the symbol's range,
// parameters, return type and `contains` line all described the declaration
// that does not run. The duplicate census over the FULL extent of both pinned
// corpora (script/m14/tmp/dt-dup-census.ts, 2,547 files) measured the shape:
// ZERO genuine duplicate MEMBER names — every flag was a `X()`/`X.named()`
// constructor false positive, a legal `get`/`set` pair, or my first census's
// own container gap — but FIFTEEN genuine duplicate TOP-LEVEL callables in
// test files, which dart emitted as TWO symbols. Both scopes now share one
// ruling and one helper (`registerCallable`). The second `foo` and the second
// `top` below differ from their first declarations in PARAMETER COUNT, which
// is what makes the payload's answer checkable: only the live declaration
// carries `second`.
class D {
  int foo(int first) {
    return first;
  }

  int foo(int first, int second) {
    return first + second;
  }
}

int top(int first) {
  return first;
}

int top(int first, int second) {
  return first + second;
}
