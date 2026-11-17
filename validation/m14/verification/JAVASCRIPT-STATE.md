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
| `part_of` | **NOT EXPRESSIBLE, declared.** No composition-part node in the pinned grammar, and JSDoc has no `@partOf` tag, so there is no second channel either |

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

## Still open

1. **The store-side questions** — the name-ranking bind and a `mixes_in` resolution rule. Both are
   all-lane store decisions, not lane emissions.
2. **215 unparseable React files** — Flow-only syntax. A grammar patch is the route; population and
   risk need measuring first.
3. **Tagged-template invalid escapes** (`String.raw`…`\u{`…) — valid ES2018, rejected by the grammar.
   One file in prettier's own source; whole-corpus prevalence not yet measured.
4. **`@typedef` targets are symbols now, but consumers** that look up a type by name from stored facts
   have not been re-checked.
