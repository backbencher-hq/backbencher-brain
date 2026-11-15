// M60/#924 (cpp row, third class) — a call's target is a NAME, or the call has no
// target. Reconstructed from the real corpus sites (fmt/include/fmt/format.h:1113,
// fmt/include/fmt/base.h:1737, fmt/include/fmt/base.h:814-816/1027-1032).
//
// The callee descent used to return whatever node it stopped on, so any callee the
// grammar does not name published its SOURCE TEXT as the target: a lambda body, an
// element call, a parenthesized expression. 224 such call sites over the two pinned
// cpp corpora, measured (script/m14/tmp/c924-calls-ws.ts); the same rule also
// removed 143 `calls` edges whose target was a functional CAST spelled as a type
// (`calls -> int`), which no consumer can resolve because no function is named
// `int`.
void take(int v);
int wide(int v);
unsigned to_unsigned(int v);

void consume(int v);

struct Buffer {
  constexpr Buffer(int a, unsigned b) {}
};

template <typename T>
struct Box {
  constexpr Box(T v) {}
};

// (a) FUNCTIONAL-STYLE CASTS. Where a callee would go these put a `primitive_type`
//     (the grammar's own record that this is a cast) OR a builtin-type KEYWORD
//     the grammar read as an `identifier` (`unsigned`, `short`, `long`). Either
//     way a keyword can never be a function name, which is what the cpp lane's
//     `CPP_BUILTIN_TYPE_KEYWORDS` refuses — the C lane has always had the same
//     discipline (`C_SPECIFIER_KEYWORDS`).
unsigned cast_rows(int value) {
  unsigned scaled = unsigned(value) + int(value) + char('a') + short(value) + long(value);
  return scaled;
}

// (b) AN IMMEDIATELY-INVOKED LAMBDA (format.h:1113): the callee IS the lambda
//     expression, so there is no name to publish.
unsigned lambda_iife(int n) {
  int k = [](int m) { return m + 1; }(n);
  return k;
}

// (c) AN ELEMENT CALL (base.h:1737): the callee is a subscript. The element's name
//     is not knowable statically — the same ruling the lane already applies to C
//     function pointers.
void element_call(int n) {
  void (*fns[2])(int) = {take, wide};
  fns[0](n);
}

// (d) A PARENTHESIZED EXPRESSION as callee: an expression, not a name.
void conditional_callee(int n, int flag) {
  (flag ? take : wide)(n);
}

// CONTROLS — every call whose callee IS a name must survive.
struct S {
  void method(int v) { consume(v); }
};

void controls(S& s, int v) {
  take(v);
  s.method(v);
  Buffer(1, 2u);
  Box<int>(v);
  to_unsigned(v);
}
