# tree-sitter-r (vendored, patched)

Base: `@eagleoutice/tree-sitter-r@1.1.2` (MIT). Its published
`tree-sitter-r.wasm` was byte-identical (sha256
`b11a872a88ad8a9ebc85607ef3fd4cabdf6cbead51421ec1492b4591b6854553`) to the
`wasm/tree-sitter-r.wasm` this repository shipped, so this is the same grammar
with one rule changed.

## The patch

```diff
-    _hex_literal: $ => /0[xX][0-9a-fA-F]+/,
-    _number_literal: $ => /(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d*)?/,
+    _hex_literal_exponent: $ => /0[xX](?:[0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?|\.[0-9a-fA-F]+)[pP][+-]?[0-9]+/,
+    _hex_literal_plain: $ => /0[xX][0-9a-fA-F]+/,
+    _hex_literal: $ => choice($._hex_literal_exponent, $._hex_literal_plain),
+    _number_literal: $ => /(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/,
```

R parses every numeric literal with `strtod(3)`, so it accepts the C99
hexadecimal-float form `0x<hexdigits>[.<hexdigits>]p[+-]<decimals>`, where the
binary exponent is mandatory. The upstream rule knew only the integer-hex form,
so the lexer stopped at `0x1` and the remainder was re-read as an identifier
plus an addition:

| Source | Before | After |
| --- | --- | --- |
| `v <- 0x1p+53` | two statements, `hasError=false` | one `float` |
| `mn <= 0x1p+53` | `ERROR` on `0x1` plus a stray `p + 53` | clean `float` |
| `0x.8p1` | `0` and a fabricated identifier `x.8p1` | one `float` |
| `0xABp-2` | `0xAB`, `p`, `2` | one `float` |
| `1east` | the float `1e` then `ast` | `1` then `east` |

The first row is a silent misparse with no diagnostic anywhere. `Matrix` (CRAN
recommended, R Core) writes `0x1p+53` in 8 places.

The `[eE][+-]?\d*` -> `[eE][+-]?\d+` tightening is the same class of defect: R's
own scanner requires the digits, and `\d*` let a bare `1e` lex as a float.

## Measured effect

Both builds produced with the same toolchain, so the delta is this patch alone:
ERROR/MISSING nodes over 1,174 corpus files **15 -> 3**; Matrix **12 -> 0**;
4 files improved, **0 regressed**; 0 analyzer output changes; node-type and field
sets otherwise unchanged (2 new hidden tokens, 0 named types, 0 fields). The 3
remaining are correct failures — a Go text/template file that ships inside the
shiny package, and a deliberate syntax-error fixture in testthat.

## Rebuilding

The vendored `src/scanner.c` is the upstream external scanner and is **required**
— `tree-sitter build --wasm` fails without it. It is force-added because
`.gitignore` excludes `grammars/tree-sitter-*/src/*` (that rule exists to keep
the *generated* `parser.c` / `grammar.json` / `node-types.json` out).

```sh
npm install --no-save tree-sitter-cli@0.24.7
cd grammars/tree-sitter-r
npx tree-sitter generate
npx tree-sitter build --wasm
cp tree-sitter-r.wasm ../../wasm/tree-sitter-r.wasm
```

To A/B the patch, build the pristine `grammar.js` with the same CLI and compare
the two wasms over the corpora — that is how the numbers above were produced, and
it is the only way to separate the patch from toolchain drift.
