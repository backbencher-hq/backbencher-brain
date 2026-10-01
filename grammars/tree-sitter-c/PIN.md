# tree-sitter-c — grammar pin

This directory is the **source of record** for the C grammar the product loads.
`wasm/tree-sitter-c.wasm` is a build of exactly these files, and
`script/m14/verify-grammar-pins.ts` proves that offline on every run.

## Upstream

| | |
| --- | --- |
| repository | `tree-sitter/tree-sitter-c` |
| version | `0.24.1` (npm `tree-sitter-c@0.24.1`; `package.json` and `tree-sitter.json` are byte-identical to the tarball's) |
| license | MIT (`LICENSE`) |
| upstream tarball | `npm pack tree-sitter-c@0.24.1` — kept for the A/B at `$HOME/ishaq/fixtures/c/grammar/` |

## The prior question, and why it had to be asked first

This lane is **not** `byte-identical-to-npm-tarball`, which is the provenance kind
every other lane in `validation/m14/grammar-pins.json` uses. The vendored
`grammar.js` differs from npm `tree-sitter-c@0.24.1`'s copy by 75 diff lines and
carries this repository's own `#743` and `#743b` markers — the grammar is a
**local patch of upstream**.

So before provenance could be stated at all, one question had to be answered, and
it was not a formality:

> Is `wasm/tree-sitter-c.wasm` a build of the **patched** source, or a pristine
> upstream build that predates the patch?

It decides what every C measurement means. The F1 oracle, the 2,498-file census,
the clang layout probe and all 28 mutants are all measurements of a parse produced
by these bytes. If the patch were not live, the lane would have been measuring a
grammar that is not the one it believes it is, and every number would need
re-measuring.

**Measured answer: the patch is live.** A rebuild of the committed patched source
is *surface-identical to the wired bytes in both directions* — 128 named types,
zero difference either way — and *behaviourally identical on all 10 constructs* of
the battery below. Pristine upstream 0.24.1, by contrast, is short by exactly the
three node types the patch adds and fails all three `#743b` shapes.

Re-runnable: `bun run script/m14/tmp/c-audit/c-grammar-pin.ts` →
`validation/m14/results/c-grammar-pin.json`.

## The patches

| | site | what |
| --- | --- | --- |
| **#743** | `grammar.js` | `macro_prefixed_type_specifier` as a **visible** node, with the conflict entries the ordinary reading (`A B;` = a `B` of type `A`) needs. Upstream hides the rule, so the analyzer could not name the type position at all. The in-file note records that two conflict variants became unnecessary once the rule carried `prec(-1)` — the ordinary reading is then chosen during table construction rather than arbitrated at parse time. |
| **#743b** | `grammar.js` | a **header name in a preprocessor-argument position**: `__has_include(<vector>)`, `__has_include("meta")`, and the wrapper form real headers use, `FMT_HAS_INCLUDE(<string_view>)`. Upstream parses every one as an `ERROR` node, because `<string_view>` is not a preproc expression — `<` would have to be a binary operator with a missing left operand. The shape reaches 16 files across the two cpp corpora, in the guard of every portable header. |

`#743b` is scoped to the **argument position deliberately**, and that is what makes
it safe rather than a lexer gamble: `<` cannot *begin* a `_preproc_expression`
(the unary operators are `! ~ - +`), so at the start of an argument there is no
competing `<` token to lose the tie to, and the header token is preferred purely by
match length. Anywhere else `<` stays the comparison operator. The character class
also excludes what a header name cannot contain, so `< B && C >` is not a candidate
for the token in the first place.

## Surface and behaviour A/B

Three builds, one battery. `W` = the wired bytes, `P` = a rebuild of the committed
patched source, `U` = pristine npm 0.24.1's own published wasm.

| construct | W | P | U | note |
| --- | --- | --- | --- | --- |
| `#if __has_include(<vector>)` | clean | clean | **damaged** | `#743b`'s subject |
| `#if __has_include("meta")` | clean | clean | **damaged** | the quoted spelling |
| `#if FMT_HAS_INCLUDE(<string_view>)` | clean | clean | **damaged** | the wrapper form |
| `#if A < B && C > D` | clean | clean | clean | **the risk the patch must not create** — `<` stays the comparison operator outside an argument position; pinned clean before the change |
| `#if MAX(A < B, C < D)` | clean | clean | clean | the same risk, parenthesised — the shape most likely to be captured by a header-name token |
| `struct s { redisAtomic long long x; };` | clean | clean | clean | `#743`: why `macro_prefixed_type_specifier` must be visible |
| `#include <stdio.h>` | clean | clean | clean | control |
| `#define A 1` | clean | clean | clean | control |
| `struct s { int a; char b[4]; };` | clean | clean | clean | control — the analyzer's core subject |
| `enum e { A, B = 2, C };` | clean | clean | clean | control — the shape the `#939` array-dimension fix reads |

| | W | P | U |
| --- | --- | --- | --- |
| bytes | 650,175 | 630,720 | 625,918 |
| sha256 | `f9a2d771…` | `30ed4aae…` | `c852c2a8…` |
| ids / named / anon / fields | 366 / 128 / 202 / 39 | 366 / 128 / 202 / 39 | 363 / 125 / 202 / 39 |
| named types not in the other | — | 0 | 0 |
| named types the other lacks | — | 0 | **3** |

The three are `macro_prefixed_type_specifier`, `macro_specifier`,
`preproc_header_name` — precisely what the patch adds, and **zero** the other way,
which is the statement that the patch is live in the bytes this lane loads and is
purely additive at the node-type level.

**Bytes are not expected to match, and the pin does not require them to.** A wasm
build carries its emscripten version, its compiler flags and its section order, so
two builds of one grammar differ in sha256 while being the same grammar. `W` and
`P` differ by 19,455 bytes for exactly that reason. The claim is surface and
behaviour identity — which is what `verify-grammar-pins.ts` measures, and which is
why a rebuild that reproduces the surface is accepted over a sha-only pin.

## The offline source↔wasm proof

`verify-grammar-pins.ts`'s `sourceVsWasmFor` re-measures this on every run:

```
c   f9a2d771d989   650175 B  ids= 366 named=128 anon= 202 fields= 39  vendored:6 files
     source↔wasm: all 135 declared names present (7 supertypes hidden by design),
     128 wasm-named types all declared, 0 built-in extra(s)
```

Zero in both directions. That is the offline statement that **the committed bytes
are a build of the committed source** — and it could not run at all before this
work, because the vendored tree carried no `node-types.json`/`grammar.json` pair.

## What is vendored, and why

| file | why |
| --- | --- |
| `grammar.js` | the grammar, 42 KB, the whole surface — and the **patched** copy, with each edit's measured rationale in comments. |
| `src/grammar.json`, `src/node-types.json` | **generated** from that `grammar.js` by `tree-sitter generate` (CLI 0.25.10) and vendored on purpose: they are what the offline source↔wasm proof runs on. Without them the check reports "not applicable" and the lane has no proof at all. |
| `package.json`, `tree-sitter.json` | byte-identical to npm `tree-sitter-c@0.24.1`. |
| `LICENSE` | MIT requires the license to travel with the source. |

## What is NOT vendored, and why

| path | why |
| --- | --- |
| `src/parser.c` | 3.9 MB of generated tables. `tree-sitter generate` rebuilds it from `grammar.js`, and the check runs on the generated JSONs. |
| `src/tree_sitter/*.h` | regenerated headers the generated parser includes; shipped by the CLI. |
| `bindings/`, `binding.gyp`, `binding_test.js` | node-native bindings; not parser source. |
| `prebuilds/` | platform `.node` binaries; not parser source. |
| `queries/highlights.scm`, `queries/tags.scm` | editor queries; the engine does not load them. |
| `README.md` | upstream's readme; no check reads it. |
| the 0.24.1 tarball's own wasm | kept **outside** the repository, at `$HOME/ishaq/fixtures/c/grammar/pristine-tree-sitter-c-0.24.1.wasm`, so the A/B can use a build this repo has decided against without the repo pinning it. `SHA256SUMS.txt` sits beside it. |

## Reproducing

```bash
# the pristine build the A/B is measured against
npm pack tree-sitter-c@0.24.1

# a rebuild of the committed patched source
cp grammars/tree-sitter-c/{grammar.js,tree-sitter.json,package.json} <builddir>/
cd <builddir> && tree-sitter generate && tree-sitter build --wasm

# the whole comparison, and the verdict
bun run script/m14/tmp/c-audit/c-grammar-pin.ts
```

`tree-sitter generate` was run with CLI **0.25.10**; `tree-sitter build --wasm`
pulls `emscripten/emsdk:4.0.4` through docker. A different CLI or SDK will produce
a different sha256 for the same grammar — which is the point above, not a problem.

## Kept for the A/B

`$HOME/ishaq/fixtures/c/grammar/` holds `pristine-tree-sitter-c-0.24.1.wasm`,
`rebuilt-patched.wasm`, `patched-grammar.js.snapshot`, both `node-types.json`
files, and `SHA256SUMS.txt`, so the comparison survives the network copy
disappearing and the vendored tree changing.
