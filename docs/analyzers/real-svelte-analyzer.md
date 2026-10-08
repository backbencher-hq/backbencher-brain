# real-svelte-analyzer.md

## Language

- Analyzer file: `src/ast/real-svelte-analyzer.ts`
- Parser: `tree-sitter-svelte` (SFC pass over the `.svelte` file) + the real
  JavaScript analyzer (`RealJavaScriptAnalyzer`) for `<script>` content —
  **always JS**, whether or not `lang="ts"` is set (family-consistent
  scoping, mirrors the M12.12 Vue decision; verified the JS analyzer handles
  Svelte script patterns — `$props()` destructure, `$state`, `$derived`,
  `export let` — with `rootHasError: false`)
- Script pre-parse wiring: `engine.ts` parses each `<script>` block content
  (exact `raw_text` byte offsets from the SFC tree, pure AST — no regex
  extraction; multiple blocks supported: instance + `context="module"`) and
  passes the trees via `AnalyzeContext` generic SFC keys
  (`sfcScriptTrees`/`sfcScriptLines`/`sfcScriptCols`, shared with Vue); the
  analyzer never touches `embeddedScriptContent` (avoids the engine's
  polyglot-injection path double-counting symbols)
- Language detection: `.svelte` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealSvelteAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | SFC component → file stem → class; script top-level `variable_declarator` → name identifier (const → Constant, let/var → Variable), `function_declaration` → name; `export let`/`export function` → same, owned by the component (public API) |
| kind | ✅ | component → Class; const → Constant; let/var → Variable; function → Function |
| qualified/container name | ✅ | `ownerName` = component name for exported symbols (`export let`/`export function`); non-exported script top-levels are module-scope (owner empty, mirrors JS family) |
| range (start/end line + column) | ✅ | script-content nodes offset to SFC line numbers via the script block's start position |
| parameters | ✅ | from the JS analyzer (recorded, never symbols) |
| returnType / type | — | Svelte SFCs are not type-analyzed (script always parsed as JS — documented decision above) |
| documentation/comments | ✅ | via the JS analyzer (JSDoc / `//` comments on script symbols) |
| complexity metrics | ✅ | via the JS analyzer |
| syntax errors | ✅ | ERROR/missing nodes surfaced; `parseErrors` counted in the differential |
| decorators/attributes | — | n/a |

## Relationship ontology

Every row below carries a COUNT and a FILE COUNT measured through production
`ASTEngine.parseFile` (`src/ast/pool-worker.ts` → `engine.ts:1592-1623`, which
pre-parses each `<script>` body with the JS/TS/TSX grammar and hands the trees
to the analyzer as `context.sfcScriptTrees`).

**Population** — `script/m14/svelte-census.mts`, DERIVED by readdir, never
hand-listed: 6,439 `.svelte` files across 61 corpus dirs, of which two carry
any (shadcn-svelte 1,878 / svelte 4,561). 6,436 parsed, 0 threw, 3 empty, 0
over 512 KB. **19,247 symbols, 47,713 relationships**, plus 8,684 `imports[]`
rows in 3,075 files (9,541 bound items, 1,362 distinct modules).

**Sampled, not exhaustive.** The counts above are over the whole 6,439-file
population. `instantiates` and `imports` dominate because they are what a Svelte
component library *is* — a template tag is an instantiation, and shadcn's
registry is 1,878 components — which is a property of the format, not a defect.

**Reading the two channels.** `imports` appears in BOTH the relationship
channel (9,525 edges) and the `imports[]` channel (8,684 rows). They are
different surfaces: `ParseResult.imports` (`src/ast/types.ts:206-216`) is what
parallel-indexer writes to the `brain_import` TABLE; the relationship edges go
to `brain_relationship`. `script/m14/firing-check.mjs` tallies only the
relationship channel and compares against the enum value `"brain_import"`,
which no emitter produces — that is the superseded v1 instrument, and
`firing-check-v2.mjs` reports the two channels separately for this reason.

| Relationship type | Verdict | Edges | Files | How resolved | Confidence model |
| --- | --- | --- | --- | --- | --- |
| instantiates | EMITTED | 12,857 | 2,618 | template pass: every non-builtin element tag → leaf tag name as written (`<Button />` → Button); builtin HTML tags and `svelte:` primitives filtered | 0.95 (12,753) / 1.0 (104) |
| uses | EMITTED | 11,800 | 4,086 | template reads resolving to a name in scope, with `{#each}`/`{#await}`/`{#snippet}`/`{@const}` shadow tracking and the `$store` auto-subscription sigil | 0.95 (8,116) / 0.9 (1) / 0.85 (144) / **0.6 (3,539 — heuristic, see below)** |
| imports | EMITTED | 9,525 | 3,068 | script `import` → `${modulePath}:${item}`; a namespace import is `mod:*` | 1.0 (9,521) / **0.6 (4 — heuristic)** |
| contains | EMITTED | 6,566 | 2,962 | component/type/class ownership from `ownerName`, plus the JS delegate's interface-member and object-member containment | 1.0 |
| calls | EMITTED | 3,660 | 1,789 | script calls via JS analyzer leaf identities; `on:`/`onclick:` directives → call to the handler leaf; `{@render}` → the snippet leaf | 0.9 (2,946) / 0.85 (705) / 0.8 (9) |
| exports | EMITTED | 2,512 | 1,299 | `export let`/`export function`/`$props()` bindings → component public API; module-block exports stay module API | 1.0 |
| references | EMITTED | 775 | 310 | decorator/type references merged from the delegate | 0.95 (484) / 0.8 (290) / 1.0 (1) |
| extends | EMITTED | 17 | 16 | in-`<script>` class heritage, delegated to the JS/TS analyzer | 1.0 |
| implements | EMITTED | 1 | 1 | `implements` clause; 0 on shadcn-svelte's 1,878 files, 1 on the svelte compiler suite | 1.0 |
| overrides | **RULED on the corpus** | 0 | 0 | see below — the language HAS it, the analyzer emits it, the corpus does not exercise it | — |

**RELATIONSHIP CHANNEL: 9/10.** `imports[]` CHANNEL: non-zero in 3,075 files.

### `overrides` — the one row that is not EMITTED, and why it is not RULED as a language fact

The ruling table (`script/m14/svelte-ruled.ts`) originally opened "Svelte
itself has no such construct". **That sentence was false** and was corrected on
2026-10-05 (commit `b547d9e21`). The construct is real and the implementation is
real:

- The SFC seam delegates each `<script>` body to the JS/TS analyzer, which
  constructs `RelationshipType.Overrides` at `real-javascript-analyzer.ts:1503/1584`
  and `real-typescript-analyzer.ts:5292/5354/5473`.
- `script/m14/svelte-overrides-capability.mts` measures it through production
  `parseFile` over a population the probe itself declares (8 SFCs + 5 plain-file
  controls, **0 corpus files**): 1 override edge on the JS delegate, 1 on the TS
  delegate, 1 from a `context="module"` block, 1 for an accessor, identical with
  and without the `override` modifier. A plain `.js` control fires identically,
  so the seam neither adds nor drops the type.
- This lane's own fixture `heritage-implements-overrides.svelte` already carries
  **4** `overrides` edges (`Child.area -> Base.area`, `Base.area -> Shape.area`,
  `Child.render -> Base.render`, `Child.area -> Shape.area`).

What is measured is narrower and is the only thing the ruling asserts: **no file
in this lane's corpus exercises it.** `script/m14/svelte-construct-probe.mts`
over 6,439 SFCs (5,498 `<script>` blocks, 2,031 `lang="ts"`/`"tsx"`, all
sub-parsed, 0 failures) finds 105 class-shaped declarations, 337
`method_definition`, 767 `property_signature`, 20 `interface_declaration`,
3 `extends_clause` and 1 `implements_clause` — every inventory row non-zero,
which is what makes the zeros absences rather than a broken probe. 3 classes
carry a superclass; 2 extend host types no corpus file declares
(`HTMLElement`, `HTMLButtonElement`); 1 resolves, and it shares only
`constructor`, which ECMAScript does not inherit. Name collisions: 0.
**Resolved overrides: 0, in 0 files.**

So none of the three verdicts fits, and saying so is the result rather than a
failure to reach one:

| verdict | requires | measured | met |
| --- | --- | --- | --- |
| EMITTED | non-zero on a real corpus file | 0 over 6,439 | no |
| RULED | the construct never occurs | it occurs, and resolves | no |
| GAP | the analyzer does not read it | it reads it and emits it | no |

The construct is real, the implementation is real, the corpus is silent.
**Overturn condition** (a fact about the corpus, not about this lane's output):
one corpus SFC whose class extends a class declared in the corpus and re-declares
one of its non-constructor members.

### The six questions for the nine already-emitted types

| | question | instrument | result |
| --- | --- | --- | --- |
| 1 | **Exists** (constructible) | source derivation | 6 types constructed in `real-svelte-analyzer.ts`; the rest arrive from the delegate. Derivation answers this question only. |
| 2 | **Fires** (on real corpus) | `svelte-census.mts`, production path | **9/9 fire.** Per-type edges and file counts in the table above; 0 silent among the nine. |
| 3 | **Correct** (an independent oracle agrees) | `differential.ts` F5 + `script/m14/svelte-truth.ts` | 200-file shadcn-svelte probe: tree-truth 1,444 edges, covered 1,444 (100%), MISSING 0, analyzer edges 1,436, **unexplained 0, heuristic 0**. The DERIVATION gate reads `svelte: clean` — this lane supplies its own oracle for `contains` and `uses` (`20e2d2be5`), which were 2 DERIVATION findings at handover. **The oracle is a second walker over the SAME grammar, so a shared grammar bug is invisible to both sides.** That limit is the harness's and is not closed here. |
| 4 | **Labelled** (right type, not a neighbour) | `script/m14/svelte-labelling-audit.mts` | 47,713 edges, 11 asymmetry rules, **0 hits**, with 26 calibration cases proving each rule can fire. The instrument's own first version reported 2,296 false positives — seven rule defects, each verified against a corpus file and recorded in the source. See the commit for the seven. |
| 5 | **Resolved** (both endpoints bind) | `svelte-census.mts` per-type columns | **Source: 47,673 of 47,713 (99.92%)** bind to a symbol declared in the same file; 40 do not. **Target: 33,940 of 47,713 (71.13%)** bind to a local declaration, an import binding, or a `module:item` import; 13,773 do not, and the census names samples per type. The two weakest targets are `instantiates` (102 local / 4,685 import / **8,070 unresolved**) — a template tag names a COMPONENT, which lives in another file, so a single-file walk cannot resolve it and the import-binding channel is doing the work — and `imports` (0 local / 0 import-binding / **7,560 `module:item`** / 1,965 unresolved), whose targets are spelled `mod:item` by construction. `contains` resolves its target on 6,566 of 6,566. |
| 6 | **Confident** (`evidenceClass` + confidence right) | `svelte-census.mts` | 47,713 of 47,713 edges carry a confidence; 0 do not. **3,543 edges (7.43%) are below 0.7 and are therefore heuristics** per M14 §4: 3,539 `uses` at 0.6 and 4 `imports` at 0.6. All 47,713 carry an `evidenceClass`. |
| 7 | **R7** (no unknown symbols, empty names, or placeholder endpoints) | `svelte-census.mts` + `script/m14/svelte-r7-probe.mts` | 0 empty symbol names, 0 unknown/empty `SymbolKind`, 0 empty edge sources, 0 empty edge targets. **10 placeholder sites remain** (2 symbol names, 3 edge sources, 5 edge targets), and the probe lists every one BY NAME: all 10 are bindings that really exist in the corpus — 8 against the two files that declare `unknown` (`css/samples/omit-scoping-attribute-class-dynamic/input.svelte:2` `export let unknown = 'whatever'`, and `runtime-runes/samples/proxy-coercive-assignment-warning/main.svelte:14` `const unknown = (node) => …`), and 2 that the earlier R7 fix in `783c26690` did not reach. R7's own text scopes the rule to a literal "that does not exist in the source", so these are not violations; suppressing them would delete true facts. |
| — | **Edges are OUTGOING ONLY** | — | Every edge is emitted from the file being analyzed. Resolving who points AT a given symbol is a separate subsystem that does not exist yet, so no claim about incoming edges is made or supported by any number here. |

### Confidence honesty (M14 §4)

`uses` carries 3,539 edges at **0.6**, below the 0.7 line, so they are countable
heuristics rather than facts: 7.43% of confident edges. They come from template
reads that resolve to a name in scope but whose provenance is a character walk
over the grammar's opaque `svelte_raw_text` leaf — the documented fallback for a
construct the grammar cannot express structurally, not a claim of independence
from it. `imports` carries 4 more at 0.6. Everything else is ≥ 0.8.

### Payload and latency

`script/m14/svelte-payload-latency.mts` (new; the lane had no such check and
`docs/analyzers/svelte.md` records that gap as X5). Production path, median of 3
per file, warm-up discarded, population derived by readdir:

| corpus | sampled | timed | ms/file | ms/KiB | symbols | edges |
| --- | --- | --- | --- | --- | --- | --- |
| shadcn-svelte | 400 | 380 | 17.88 | 12.18 | 1,200 | 5,411 |
| svelte | 400 | 380 | 7.72 | 28.81 | 1,211 | 2,049 |

The two populations disagree in **direction** — svelte's own repo is mostly files
under 0.5 KiB where a fixed cost dominates, so its ms/KiB is the worse figure —
which is why a single mixed number would be the less informative one. Within
shadcn the cost is monotone in file size (7.05 → 94.20 ms across six buckets).

Edge weight per type, which is what decides whether an added type regresses a
budgeted surface: `instantiates` 34.9% of edge bytes (180 B/edge), `imports`
22.7% (248 B/edge — the widest rows), `uses` 20.0%, `contains` 11.4%, `calls`
5.9%, `exports` 3.5%, `references` 1.6%. `overrides` contributes 0 bytes.
Narrowing to one type pays 0.018× (`references`) to 0.323× (`instantiates`) of
unfiltered — a within-lane comparison over edge bytes, **not** comparable to the
workstream's lodash/ripgrep 2.5-4.8×, which measures a serialized response.

## Supported constructs

- SFC decomposition: `<template>` + `<script>` + `<style>` blocks located via
  the tree-sitter-svelte `element`/`script_element`/`style_element` tree;
  template pass and script pass are independent, no source-text scanning
- `<script>` (JS + TS, instance + `context="module"`): imports, top-level
  const/let/var, function declarations, `export let` props — `Button.svelte`,
  `UserList.svelte`, `App.svelte`, `Negative.svelte`
- Runes (`$state`, `$derived`, `$props()`, `$effect`, …) are compiler
  keywords — never symbols; destructured `$props()` locals are params, not
  symbols (JS family contract)
- Template components: non-builtin element tags → instantiates (leaf tag as
  written) — `App.svelte` (`<Button/>`, `<Card/>`)
- Events: `on:` directives → calls to the handler leaf — `Button.svelte`
  (`on:click`), `App.svelte` (`on:greet`), `UserList.svelte` (`on:select`)
- Negative fixtures: `bind:`/`class:`/`transition:`/`use:` directives never
  emit; `on:input={(e) => e.target.value}` (arrow with param + property
  access, no call target, no bare identifier) emits nothing; template
  expressions (`{count}`, `{#each}` bodies) are not symbols or calls;
  builtin HTML tags never instantiate; locals/params (`e`, `local`,
  `stateVal`) never become symbols — `Negative.svelte`
- Legacy props: `export let query = ''` → component public API (exports +
  contains) — `UserList.svelte`

## Unsupported / explicit-unknown constructs

- `lang="ts"` scripts are parsed with the **JS** analyzer, not the TS one —
  deliberate family-consistency decision (mirrors Vue M12.12). Type
  annotations are ignored, not synthesized.
- Svelte 5.2+ template syntax that the tree-sitter grammar cannot express is
  handled by documented fallbacks where the construct is reachable
  (`on:` handler leaf extracted with pure-String scanning of the opaque
  `svelte_raw_text`/`raw_text_expr` leaf — the grammar exposes template
  expressions as an opaque leaf, so no AST structure exists to walk; this is
  the documented regex-free fallback for grammar-opaque constructs).
- `{#snippet}`, `{@render}`, `{#each}` blocks do not emit symbols — snippets
  are template-local fragments, each-blocks are iteration statements (family
  contract; no locals from block scopes).
- Slotted/dynamic `<svelte:component this={...}>` targets are not resolved
  (dynamic target, family contract).

## Regex inventory

From `validation/m12/results/regex-census.json`: the Svelte analyzer has **0
regex usages** (2 in the legacy analyzer eliminated; census 123 → 121). The
engine's SFC script pre-parse uses byte-offset `raw_text` slicing, not the
polyglot regex path. The `on:` handler leaf extraction uses pure-String
scanning (`isIdentifier`, char-class loops) — never regex.

## Complexity envelope

From `validation/m12/results/svelte-complexity.json`:

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 29 | 35 | 481.2 | 60 | 73 | 204.2 MB |
| corpus_subset | 396 | 913 | 655 | 2,292.3 | 398 | 286 | 271.2 MB |

Declared budgets: fixtures < 2 s (met: 0.48 s); 400-file corpus < 60 s
(met: 2.3 s).

Hot-path audit: SFC tree walked once (explicit stack, `script_element`/
`style_element` subtrees skipped); script subtrees delegated to the JS
analyzer (single iterative traversal, scope per-frame snapshots); template
instantiates resolved with O(1) builtin-tag set lookups; `on:` handler leaf
extraction is a single linear scan of the small expression text; containment
from `ownerName` in one pass. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/svelte.json`
  (authority: `manual_audit` — every fact verified against fixture source and
  the TS/JS family contract; 63 facts)
- Result: `validation/m12/results/svelte-differential.json`
- Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`, `parseErrors: 0`

## Corpus validation

- Corpus target: `validation/m12/corpus-manifest.json` →
  `svelte@26786e92` (clean; the svelte repo's own `.svelte` test suite —
  4,462 files across runtime-legacy/runtime-runes/parser-modern/validator/
  snapshot/print/… categories, the canonical Svelte source corpus)
- Sample: 396 tracked `.svelte` files (deterministic stratified sample across
  20 test categories; sample file
  `validation/m12/results/svelte-corpus-sample.txt`, reproducible from
  `git ls-files`; 4 deliberately-broken `loose-invalid-*`/`loose-unclosed-*`
  parser error-recovery fixtures excluded — they are invalid by design, not
  corpus source)
- Symbols 913 / relationships 655 / wall 2.3 s / **0 crashes / 0 timeouts**
  — fresh parser per file, mirrors production pipeline (scan script
  `script/m12/svelte-corpus-errors.ts`)
- **Grammar upgrade (like M12.11 Dart):** the previously pinned npm
  `tree-sitter-svelte` wasm (2023) errored on 30/400 (7.5%) — it predates
  Svelte 5 snippets and `{@render}`. Rebuilt from the maintained
  `tree-sitter-grammars/tree-sitter-svelte` fork (2025-06, Svelte 5):
  **12/396 (3.0%)** residual error files, all using Svelte 5.2+ syntax that
  **no tree-sitter grammar supports** — `{@attach}` attachments, generic
  snippets (`{#snippet generic<T>}`), `{#each}` shorthand without `as`,
  comments inside tags, self-closing `<script/>`, `{@const}` division.
  Verified identical gaps on the newer `PRRPCHT/tree-sitter-svelte-next`
  fork (2026-02): same 16 files, same 82 error nodes — the maintained fork
  is the best available grammar. Recorded honestly as
  `grammarErrorFiles: 12` in the manifest (precedent: kotlin 51, fsharp 108,
  typescript 5 — nonzero counts are recorded with root-cause notes, never
  hidden). The old 30/400 measurement was discarded, not recorded.
- Fixture shapes re-verified against the new grammar before commit: attribute
  expression value moved from `expr_attribute_value > raw_text_expr` to
  `expression > svelte_raw_text` (handled in `onHandlerLeaf`); snippet/
  render/each block shapes probed and confirmed compatible.

## Evidence pointers

- Fixtures: `validation/m12/fixtures/svelte/`
- Ground truth: `validation/m12/ground-truth/svelte.json`
- Differential: `validation/m12/results/svelte-differential.json`
- Complexity: `validation/m12/results/svelte-complexity.json`
- Corpus sample: `validation/m12/results/svelte-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (0 for this analyzer)
- Docs: this file

## Issue

Closes M12.13 (GitHub issue #152).
