# JavaScript lane — STATE

**Author: Muhammad Ishaq Khan.**
**REGENERATED 2026-11-13.** The original of this page, and five sibling contract pages, were deleted
from this working tree by the 0.1.5 release cycle and exist in **no git history** (`git log --all`
finds no commit for any of them). They cannot be restored, so this page is **rewritten from what is
measurable now** — every number below names the command that produces it. Anything the original said
that is not re-derivable here is intentionally absent rather than invented.

---

## Where the lane stands

| | |
|---|---|
| analyzer | `src/ast/real-javascript-analyzer.ts` (`RealJavaScriptAnalyzer`) |
| grammar | `tree-sitter-javascript` 0.23.1 (+ a pragma-gated TypeScript/TSX retry for Flow `.js`) |
| regex in the analyzer | **0** — grep for literals, `new RegExp`, `.replace(/`, `.match(/`, `.test(/`, `.split(/`, `.exec(/` returns nothing |
| JS fixtures | **98 pass / 0 fail** (`bun run script/m14/run-fixtures.ts javascript`) |
| whole fleet | **50 lanes, 1,820 pass, 0 fail** |
| differential svelte | truth 2,184 · covered **100%** · MISSING **0** · unexplained **0** · hash `1aa48514c0dab17a` |
| differential lodash | truth 12,597 · covered **100%** · MISSING **0** · unexplained **0** · hash `494e1b94766e8ade` |
| `audit:js-census` | PASS |
| `audit:doc-truth-emissions` | PASS (50 analyzers, 0 false-negative / 0 false-positive / 0 undocumented) |
| relationship witnesses | PASS — **13 of 13** implementable labels fire; `part_of` silent by disposition |
| syntax-form witnesses | PASS — **13 of 13** forms behave as asserted |
| source attribution | **0** unattributed |
| target validity | **0** invalid — measured on svelte (3,271 rows) and on the new corpus preact (13,185 rows, 3,423 using the binding claim) |

## The 14 vocabulary labels

| label | state |
|---|---|
| `calls`, `uses`, `imports`, `exports`, `contains`, `extends`, `references`, `overrides`, `instantiates` | emitted |
| `implements` | emitted **from JSDoc `@implements`** — JavaScript has no clause for it, and the grammar route was tested end-to-end and is ready but deliberately not wired (it adds Flow syntax, measured population 0 across the original corpora) |
| `decorates` | emitted; carries `metadata.importedBinding` when the decorator is an import (**2,554 of 2,570** rows on nomad) |
| `renders` | emitted; **react 15,451 / preact 2,852** rows once a JSX-bearing corpus was measured |
| `mixes_in` | emitted; every measured target carries `importedBinding` (**81 of 81** across nomad+consul). The store has no `mixes_in` resolution rule — the claim is present and checkable, resolution is a store-side decision |
| `part_of` | **NOT APPLICABLE TO JAVASCRIPT — ruled on the LANGUAGE, not the grammar (2026-11-13).** The family's `part_of` is defined in `src/ast/types.ts` as a unit whose code is **included into another unit's single scope** — *"the part imports nothing, and cannot be resolved as a separate module"* — and every lane that emits it does so from an inclusion DIRECTIVE: C/C++ `#include "x"` (quoted), Julia `include("x")`, bash `source`, CSS `@import`, Dart `part`, Erlang `-include`, F# `#load`, HCL modules. **ECMAScript has no such directive, and that is a language fact rather than a grammar gap: every module — ESM and CJS alike — is evaluated in its own scope.** An `import`/`require` names a SEPARATE unit and takes bindings from it; it never merges another file's declarations into the current scope, and no grammar patch can create a relation the language does not have. The two closest constructs are not it: a class declared as a **class-field value** (`class Outer { static Inner = class Inner {} }`) is JavaScript's nearest nested type and is ALREADY modeled by `contains` (`contains Outer -> Inner`, with `Outer.Inner` published as a symbol — pinned by a witness), so emitting `part_of` there would duplicate a relation the vocabulary already has; and `export * from './x'` merges another module's EXPORT SURFACE while that module keeps its own scope, which is `imports`/`exports`. **Measured:** the nested-class construct occurs **0 times in authored source** across the 16 cloned corpora (3 occurrences, all in prettier's Flow TEST FIXTURES). **Falsifier, named:** this ruling fails if ECMAScript gains a construct that evaluates another unit's declarations in the includer's scope, or if the vocabulary is redefined so `part_of` covers structural nesting — and then `contains` and `part_of` need a JOINT decision, not a lane-local one. |

## Symbol completeness

`script/m14/javascript-symbol-coverage-census.ts` measures both axes.

**Grammar declarations: 0 missed** at module/class scope on react, preact, jquery, underscore, three,
ramda, d3, express, chartjs, socket.io, moment, vue, mongoose, svelte, nomad, consul, vault, bootstrap,
lodash (1 on proxicall). Documented non-gaps, each counted in its own bucket: function locals, object
literal members, and import bindings.

**JSDoc declarations** (`@typedef` / `@callback` / `@interface` / `@enum`) were a **100% gap** — they
live in comments, so no node census could see them. Now published as symbols: svelte **38/38**,
chartjs 51/51, ramda 21/21, consul 4/4, nomad 20/22, vault 13/14, proxicall 12/13.

## Corpora

Two sets, both recorded with exact commits in `validation/m14/js-corpus/JS-CORPUS.md`, and re-creatable
with `bash script/m14/clone-js-corpus.sh`:

- **original** (in `bb_tests/repositories`, read-only): svelte, lodash, bootstrap, proxicall, vault,
  consul, nomad — all Ember/svelte-shaped ECMAScript, which is precisely their limitation
- **cloned for this campaign** (`react`, `preact`, `three`, `webpack`, `prettier`, `jquery`,
  `underscore`, `moment`, `ramda`, `d3`, `axios`, `express`, `socket.io`, `mongoose`, `chartjs`, `vue`)
  — JSX, Flow, ES5, class-heavy and tooling shapes

**A measurement rule learned the hard way:** build output is not authored code. `dist/`, `build/`,
`node_modules/`, `vendor/`, `umd/`, `www/`, `coverage/`, `__snapshots__/` and `*.min.js` are excluded —
before that, ramda's `dist/ramda.js` bundle produced 18 phantom "JSDoc declarations missed" for
minified names and moment reported 41,821 variable declarators mostly in `dist/`.

**And a second rule:** `getParser` recreates a parser every 500 files, so any census that walks a corpus
must re-fetch the parser periodically. A probe holding one reference across thousands of parses reads
from a deleted object; that bug silently made a census skip files and distorted an A/B.

## Flow-annotated `.js` (the largest coverage gain)

React's source is Flow, which `tree-sitter-javascript` cannot parse: **782 of 1,450 authored files
(53.9%)** produced error trees, and **96% carry a `@flow` pragma**. `src/ast/engine.ts` now retries
those files with the TypeScript grammar, then TSX, under four gates (javascript only; primary parse
failed; Flow declared in the source head; fallback tree must parse clean). Measured A/B with the
engine's kill-switch `BB_JS_FLOW_FALLBACK=0`:

| React authored `.js` | symbols | relationships |
|---|---|---|
| fallback off | 9,950 | 113,739 |
| fallback on | **11,120** | **113,848** |

215 files remain unparseable (Flow-only syntax: `declare var`, exact object types `{| |}`, existential
`*`) plus React Compiler's own `component C() {}` DSL, which is not JavaScript.

## Instruments (all committed, all re-runnable)

| instrument | answers |
|---|---|
| `javascript-symbol-coverage-census.ts` | which declaration NODES and JSDoc NAMES become symbols |
| `javascript-vocabulary-census.ts` | whole-population counts per label + `importedBinding` claims |
| `javascript-syntax-form-census.ts` | which ES forms a corpus contains (0 = never exercised, not broken) |
| `javascript-relationship-witness.ts` | every label fires; every syntax form behaves as asserted |
| `javascript-chain-owner-census.ts` | multi-segment member reads: owner before/after |
| `javascript-field-owner-census.ts` | class-scoped `this.<field>` writes vs reads (tree-only, cannot inherit the defect) |
| `javascript-source-attribution-census.ts` | replays `resolveCurrent` per line to check each row's source |
| `javascript-target-validity-census.ts` | target rows that are not names |
| `clone-js-corpus.sh` | re-creates the measurement corpus at recorded commits |

## A metric that was wrong before the code was

Running the target-validity census on the NEW corpus reported **9 invalid targets on preact** where
svelte had 0. All nine were the census's own over-strictness, and both classes are legal JavaScript:

| case | example | why it is legal |
|---|---|---|
| a RESERVED WORD as a property | `return this.class`, `….to.be.false` | a property may be spelled with any reserved word; `isFieldAccess` is the evidence, and the census additionally demanded `receiverRoot`, which a `this.class` read does not carry |
| a NON-ASCII identifier | `Math.sin(θ)` | a Greek letter is a legal JavaScript identifier |

Fixed in the census (accept `isFieldAccess` alone; treat code points above 127 as letters), and preact
now reports **0**. The analyzer needed no change — but the lane's headline number would have been wrong
without running it on a corpus that contains these shapes.

## The `imports` resolution gap — corrected twice, and finally measured

The per-relationship table shows `imports` as the worst label: 97.7% unresolved in an index-less
run. Three statements were made about it during this campaign and **two of them were wrong**; the
sequence is recorded because the wrong ones were plausible and the correction is the useful part.

**Wrong 1 — "the analyzer does not claim bare packages".** It does; the claim is gated.

**Wrong 2 — "NOTHING ever sets `ProjectIndex.complete`, so the claim is inert everywhere".** That
came from grepping for the literal `complete: true` and missing the assignment form. Production is
correct and always was: `src/ast/parallel-indexer.ts:7087` computes
`indexScope = { complete: options.files === undefined && options.isIncremental !== true }`, line 1860
stamps `built.complete = true`, and line 1853 refuses to build a claim-only index at all for
`.js/.jsx/.mjs/.cjs/.py/.ts/.tsx` unless the scope is complete. **The JS claim fires in production
whenever the indexer walks a whole project** — exactly as designed.

**Right — the GATE was the inert one.** `incoming-gate`'s builder called
`buildProjectIndexStreaming(wasm, repoFiles, spec)` and never stated completeness, so its `--index`
arm was byte-identical to the index-less arm. Fixed by making completeness an EXPLICIT parameter of
all three builders (`buildProjectIndex`, `buildProjectIndexFromDisk`,
`buildProjectIndexStreaming`), **defaulting to false** — a builder not told it saw the whole project
must not certify one — and passing the gate's own `whole` flag (`maxFiles <= 0`).

**Measured on whole preact (207 files, 23,727 edges), the same corpus both ways:**

| arm | `imports` edges | resolved | **extOK (verified external claim)** | unresolved |
|---|---|---|---|---|
| index-less | 1,361 | 288 | **0** | 924 |
| `--index` | 1,361 | 288 | **95** | **829** |

The claim opens for the first time in the gate's arm, 95 rows gain a verified external claim and the
unresolved share falls by the same 95. Nothing else moved: `calls` and `uses` are identical in both
arms, and `refuted` is 0 in both.

**Production blast radius: zero.** The new parameter is opt-in; no production caller passes it, and
production already stamps the flag on its own path. The java (13 readers) and python (3 readers) lanes
therefore see byte-identical inputs as before.

## The per-label oracle on a JSX corpus — three tool bugs, then FABRIC 0

`javascript-label-oracle-agreement.ts` had never been pointed at a corpus with JSX; it was written
against svelte/lodash. Four fixes, all in the TOOL:

1. **EISDIR** — `git ls-files` lists SUBMODULE entries as directories and the walk `readFileSync`'d one.
   Now requires `isFile()`.
2. **`undefined.truth`** — it read `labels.get(label)!` and preact's truth contains labels outside its
   `COMPARED` set. Counted in an `uncompared` bucket now.
3. **BINDING CLAIMS COMPARED RAW** — the analyzer spells a locally-bound target
   `<container><BINDING_SEP><name>`; the AUTHORITATIVE differential normalises exactly that
   (`auditTarget`, differential.ts:1405) and this tool did not, so every binding-claim row read as a
   fabrication. The tell: this file had ZERO references to `BINDING_SEP` while the differential had four.
4. **JSX NAMES COUNTED AS READS** — a JSX element's name is an ordinary `identifier` node, so the
   generic identifier walk pushed a `uses` row IN ADDITION to the `renders` row its own derivation
   emits. One reference, two labels, and every JSX corpus reported a large phantom MISSING. The guard:
   a parent of `jsx_opening_element` / `jsx_self_closing_element` / `jsx_closing_element` means the
   identifier is a JSX NAME. **Measured on preact-150: truth `uses` 3,659 → 3,049 (the 610 drop IS the
   phantom rows), missing 741 → 79, real missing 688 → 79.** The guard is provably a no-op without
   JSX: the svelte and lodash differential hashes are byte-identical afterwards.

**Result on preact-150:** **FABRIC 0 on every label.** imports 947/947 · exports 220/220 · contains
177/177 · extends 135/135 · instantiates 10/10 · references 4/4 · renders 402/402 · calls 1,969/2,081
(missing 113, all noise-filter, real 0) · uses 2,970/3,049 (missing 79 real).

**FABRIC = 0 on a corpus shape this lane was never measured against** is the ship-critical number: the
analyzer invents nothing an independent oracle cannot derive.

## Still open

1. **The store-side questions** — the name-ranking bind and a `mixes_in` resolution rule. Both are
   all-lane store decisions, not lane emissions.
2. **215 unparseable React files** — Flow-only syntax. A grammar patch is the route; population and
   risk need measuring first.
3. **Tagged-template invalid escapes** (`String.raw`…`\u{`…) — valid ES2018, rejected by the grammar.
   One file in prettier's own source; whole-corpus prevalence not yet measured.
4. **`@typedef` targets are symbols now, but consumers** that look up a type by name from stored facts
   have not been re-checked.
