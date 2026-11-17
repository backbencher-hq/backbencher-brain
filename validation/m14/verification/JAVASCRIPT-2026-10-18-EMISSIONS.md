# JavaScript — the 2026-10-18 canonical-vocabulary emissions

**Author: Muhammad Ishaq Khan.**
**REGENERATED 2026-11-13.** The original of this page was deleted from this working tree by the 0.1.5
release cycle and exists in **no git history** (`git log --all` finds no commit for it), so it cannot be
restored. This is rewritten from the code and the instruments as they stand now; every shape below was
read out of `src/ast/real-javascript-analyzer.ts` rather than recalled.

## What changed on that date

The family adopted a **canonical 14-value relationship vocabulary** and required every analyzer to emit
inside it rather than inventing per-lane spellings. The JS lane's rows moved onto it as follows, and the
dispositions below are current, not historical:

| label | disposition in this lane |
|---|---|
| `calls` | emitted — direct calls, including both sides of a comma expression and `new`-free call sites |
| `uses` | emitted — bare reads, field reads, receiver-typed reads |
| `imports` | emitted — ESM forms, CJS `require`, dynamic `import()`; `*` for a module load |
| `exports` | emitted — ESM named/default/namespace, re-exports, CJS `module.exports`/`exports.name` |
| `contains` | emitted — class members, class-in-class, container-owned object members |
| `extends` | emitted — class heritage, including a call-shaped heritage's base |
| `implements` | **emitted from JSDoc `@implements`**; the grammar route is proven feasible and deliberately unwired |
| `references` | emitted — `instanceof`, and the positions the call/read walks refuse (e.g. decorator position) |
| `overrides` | emitted — a class member overriding a base member |
| `instantiates` | emitted — `new X()` |
| `decorates` | emitted — one row per decorator, on the DECORATOR's own line; this label REPLACED a `references` row at the same site |
| `renders` | emitted — JSX elements; lowercase host elements correctly emit nothing |
| `mixes_in` | emitted — a class heritage that is a mixin application |
| `part_of` | **NOT APPLICABLE TO JAVASCRIPT — ruled on the LANGUAGE, not the grammar (2026-11-13).** The family's `part_of` is defined in `src/ast/types.ts` as a unit whose code is **included into another unit's single scope** — *"the part imports nothing, and cannot be resolved as a separate module"* — and every lane that emits it does so from an inclusion DIRECTIVE: C/C++ `#include "x"` (quoted), Julia `include("x")`, bash `source`, CSS `@import`, Dart `part`, Erlang `-include`, F# `#load`, HCL modules. **ECMAScript has no such directive, and that is a language fact rather than a grammar gap: every module — ESM and CJS alike — is evaluated in its own scope.** An `import`/`require` names a SEPARATE unit and takes bindings from it; it never merges another file's declarations into the current scope, and no grammar patch can create a relation the language does not have. The two closest constructs are not it: a class declared as a **class-field value** (`class Outer { static Inner = class Inner {} }`) is JavaScript's nearest nested type and is ALREADY modeled by `contains` (`contains Outer -> Inner`, with `Outer.Inner` published as a symbol — pinned by a witness), so emitting `part_of` there would duplicate a relation the vocabulary already has; and `export * from './x'` merges another module's EXPORT SURFACE while that module keeps its own scope, which is `imports`/`exports`. **Measured:** the nested-class construct occurs **0 times in authored source** across the 16 cloned corpora (3 occurrences, all in prettier's Flow TEST FIXTURES). **Falsifier, named:** this ruling fails if ECMAScript gains a construct that evaluates another unit's declarations in the includer's scope, or if the vocabulary is redefined so `part_of` covers structural nesting — and then `contains` and `part_of` need a JOINT decision, not a lane-local one. |

## The two labels whose status changed after a ruling

`implements` was ruled out in 2026-11 and is now **emitted**. The ruling measured whether the GRAMMAR
could carry an `implements` clause (it cannot), which is a different question from whether the LANGUAGE
can state conformance — JavaScript states it in a comment. The lesson is recorded in
`JAVASCRIPT-IMPLEMENTS-JSDOC.md`.

`renders` was recorded as 0 rows on every corpus. That was true of the corpora, all of which contain no
JSX. With a JSX-bearing corpus it is **15,451 rows on react** and **2,852 on preact** — a zero measured
on corpora that cannot contain the construct says nothing about the emission.

## How each disposition is verified now

| evidence | covers |
|---|---|
| `javascript-relationship-witness.ts` | every implementable label FIRES on a minimal construct (13/13) |
| `javascript-syntax-form-census.ts` | which forms a corpus contains, so "0 rows" is distinguishable from "never exercised" |
| `javascript-vocabulary-census.ts` | whole-population counts per label per corpus, plus `importedBinding` claims |
| `audit:doc-truth-emissions` | every claim in the lane doc corresponds to an emitted label (0 false-negative / 0 false-positive) |
| `differential.ts` | the emitted rows match tree-derived truth with 0 unexplained |
