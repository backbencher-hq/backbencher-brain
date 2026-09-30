# tree-sitter-objc — grammar pin

**Lane:** `objective-c` · **wired bytes:** `wasm/tree-sitter-objc.wasm`
**Provenance kind:** `local-rebuild-from-vendored-source`
**Base:** `tree-sitter-grammars/tree-sitter-objc` 3.0.2
**Re-measure with:** `bun run script/m60/objc-grammar-provenance.ts`
**Verify with:** `bun run script/m14/verify-grammar-pins.ts`

---

## Why this lane is a rebuild and not a published wasm

Most lanes in this file pin bytes that are byte-identical to a published package. This one
cannot, and the reason is that **Objective-C runs a patched grammar**.

`wasm/tree-sitter-objc.wasm` (5,625,072 B, sha256 520bf5e0…) is a rebuild of the vendored
`grammars/tree-sitter-objc/grammar.js`, which is upstream 3.0.2 plus four rules this
repository added. npm's own `tree-sitter-objc@3.0.2` wasm is 5,317,155 B and is a different
build. Byte-identity is therefore not available as a provenance kind, and the interesting
question is the one the C lane's pin had to answer first: **are the wired bytes a build of the
patched source, or a pristine build predating the patches?** Every number this lane has ever
published — the 9-fixture suite, the 5 grammar-wave mutants, the 329-file census, the 622-vs-158
error comparison — is a measurement of a parse produced by these specific bytes, so the answer
decides what all of them mean.

**Measured answer: the patches are live, and the bytes are honest.** Re-derivable via
`script/m60/objc-grammar-provenance.ts`; artifact
`validation/m60/results/objc-grammar-provenance.json`.

| comparison | surface | behaviour | reading |
|---|---|---|---|
| WIRED vs REBUILD | 0 / 0 named types differ | **0 of 329** files differ | the bytes are a build of this source |
| WIRED vs PRISTINE | 8 named types in WIRED only, **0 the other way** | 47 of 329 files differ | the patches are additive and load-bearing |

The byte sha256s differ in both comparisons, and they must: a wasm build carries its emscripten
version, compiler flags and section order. Identity is claimed on **surface and behaviour**, which
is what the gate measures, not on bytes.

## What the patches buy, measured over the router's 329-file universe

| | PRISTINE 3.0.2 | WIRED (patched) |
|---|---|---|
| ERROR nodes | 622 | **158** |
| symbols | 4,779 | **5,095** |
| relationships | 23,754 | **24,226** |

**P1 — `macro_prefixed_objc_declaration` (#743).** A bare macro line above an
`@interface`/`@implementation`/`@protocol` is a file-scope macro, not a declaration, and
upstream reads it as a lone specifier closed by a MISSING `;`. Carries `prec(-1)`, which is
load-bearing: raising it demands arbitration (`type_specifier, macro_prefixed_objc_declaration`),
the wall the cpp half hit.

**P2 — the same rule admitted in `_block_item`.** The defect that made P1 useless in practice.
tree-sitter-c builds a file-scope `preproc_if` body from `_block_item`, not `_top_level_item`, so
registering P1 in `_top_level_item` alone made it **unreachable inside every conditional**. sdwebimage
wraps most of its headers in `#if SD_UIKIT || SD_MAC`, so the fallthrough was the norm, and the
ERROR node it produced ran **101 lines to the next `@end`** — deleting a whole class and replacing
its properties with phantoms named after the property *attributes* (`variable:strong`,
`variable:copy`, `variable:assign`, `variable:readonly`) while reporting `properties: 0`.

**P3 — `macro_enum_specifier`.** `typedef NS_ENUM(Underlying, Name) { ... };` is Apple's universal
enum idiom: the name is inside the macro's arguments and there is **no trailing declarator**, the
opposite of every typedef the grammar handled. Upstream collapses the body into ERROR nodes — 35
declarations, 164 named constants, **152 invisible (7.3% recovery)** across the corpus. Two
details are load-bearing and both were measured, not guessed:

- `prec(1)`, **not** `prec(-1)`. At `prec(-1)` the rule generates, builds a wasm, and does
  *nothing*: `NS_ENUM` is absorbed as a `type_identifier` and `(...)` as a
  `parenthesized_declarator` by default, so the rule is never consulted. A rule that never fires
  still passes a diff of the grammar file.
- Deliberately **generic** — identifier, parenthesised args, brace body — not an
  `NS_ENUM|NS_OPTIONS|…` name list. Naming the five macros one corpus happened to use repeats a
  mistake this project has already made in the yaml analyzer's include tags: a closed set built
  from the constructs someone thought to ask about, which makes everything else invisible by
  construction rather than by measurement.

Aliased to `enum_specifier` at every admission point, so the analyzer's existing C-enum path
applies unchanged — that is also why `macro_enum_specifier` is a **rule and not a node type**, and
a hand-written patch list that expected it as a node type reported this pin as `NOT HONEST`.

**P4 — `availability_macro_specifier`.** Apple's trailing availability annotations are macro
*calls* with nested parens, commas and string literals:
`API_DEPRECATED_WITH_REPLACEMENT("use removeImageForKey:", macos(10.10, X), ios(8.0, X), …)`.
C's `macro_type_specifier` covers `MACRO(type)` — one type argument — and `attribute_specifier`
covers `[[...]]`, so neither reached the shape. The annotation trails the last parameter, the
parse could not continue, and the ERROR node swallowed the **enclosing `@protocol`**: 83 lines,
`SDImageCacheDefine.h` analysed to **0 methods where it has 7**.

Admitted only via a local `_method_trailing_modifiers` and inside the method selector/parameter
loop, and the narrowness is itself a measurement. Admitting it through the shared
`_declaration_modifiers` — the right-looking move, since the annotation really does trail a
declaration — **generated, built, and passed its minimal case**, then over the corpus: 285 →
**14,710** ERROR nodes, **17,642** relationships dropped, 239 of 329 files regressed, because that
hidden rule sits in every declaration and parameter position in the grammar and a rule whose
arguments include a bare `identifier` outranks ordinary declarations almost everywhere
(`UIApplicationMain(argc, argv)` in `main.m` was read as an annotation).

Admitting it inside the loop as well is not optional. The loop offers exactly two things — another
selector or another parameter — and a trailing `AF_API_UNAVAILABLE(macos);` begins with an
identifier, so `method_selector` claimed it and the method was published as
`setDidFinishEventsForBackgroundURLSessionBlock:AF_API_UNAVAILABLE`. **A selector is identity in
Objective-C:** that is not a typo in a name, it is a method that does not exist, carrying a
`contains` row a consumer would route calls to, while the real selector is the one that vanishes.

**Open, and deliberately not patched — the fourth Apple macro shape.** A bracketing
`NS_ASSUME_NONNULL_BEGIN`-style macro whose successor is a `typedef` rather than an
`@`-declaration is still unhandled: the pair parses as a K&R `function_definition` and the
declaration is lost (1 declaration, 1 file, 3 ERROR nodes). The only rule measured for it
improved the corpus by 8 symbols and 11 relationships with zero losses, and was **reverted**:
it fired in exactly one place, resisted ten minimal reproductions, and its behaviour flipped
when the rule's position in the `rules` object changed and nothing else did. The full negative
result, and what a real fix would have to do instead, are recorded in `grammar.js` next to the
rule's absence. Enum recovery is therefore 164/164 members across 34 of 35 declarations
(98.78%), not 100%.

## What is vendored, and what is not

`grammar.js` (patched), `package.json`, `tree-sitter.json`, `LICENSE`, `README.md`, `queries/`,
`PIN.md`, and `src/grammar.json` + `src/node-types.json` **regenerated from the patched
`grammar.js`** by `tree-sitter generate` (tree-sitter CLI 0.26.9) on 2026-09-29.

The generated `src/` is the point of the exercise. Before it, the vendored tree carried no
`node-types.json`/`grammar.json` pair, so this gate's **source↔wasm check could not run for
Objective-C at all** and the lane had no offline proof that its bytes were a build of its own
source — the exact gap the C pin record describes for its own lane before the same treatment.

`src/parser.c` is **deliberately not vendored**: `tree-sitter generate` rebuilds it from
`grammar.js`, the check runs on the generated JSONs, and the file is tens of megabytes. This
differs from the hcl lane, which vendors `parser.c` and can rebuild the wasm from the directory
alone; the difference is deliberate and recorded rather than accidental.

## Reproducing the build

The build needs **upstream** `tree-sitter-c@0.24.1` on `node_modules` — *not* this repository's
patched `grammars/tree-sitter-c`. That copy carries the #743 `macro_prefixed_type_specifier`
rule, which is not co-live with objc's `generic_specifier`: generating against it fails outright
with `Unresolved conflict: '^' identifier identifier • '<'` (`NSArray<NSString *>` read against
`A B` as a macro-decorated type). Inheriting the c fix for objc is a separate wave, not this one.

```
npm pack tree-sitter-c@0.24.1 && tar xzf tree-sitter-c-0.24.1.tgz
mkdir -p <grammar>/node_modules/tree-sitter-c && cp -r package/* <grammar>/node_modules/tree-sitter-c/
cd <grammar> && tree-sitter generate && tree-sitter build --wasm --output <out>.wasm .
```

A rebuild of the committed patched source is 5,625,072 B against the wired 5,625,072 B —
byte-identical on this build, and behaviourally identical on all 329 routed files in every case;
the standard below is behavioural, not by hash, because a wasm build carries its emscripten
version, compiler flags and section order and two correct builds of one source need not agree, and analyzer-identical on all 329 routed files. That is the standing standard
for this lane: **behaviourally, not by hash.**

## The hazard this pin exists to retire

Before this pin, Objective-C was one of 21 lanes in the repository with a patched, in-tree
grammar and **no pin at all**. The pin's entire job is to catch "the wired bytes are not a build
of the source we think they are", and a patched grammar is precisely where that happens: someone
edits `grammar.js`, rebuilds, and every downstream number moves with no gate objecting. The C
lane's own record names the same hazard for its own grammar — a node-type literal written from
memory of a different tree-sitter-c release, caught only because the vocabulary happened to be
checked. For Objective-C the risk was higher rather than lower, and it was carried for the whole
of the #743 wave.
