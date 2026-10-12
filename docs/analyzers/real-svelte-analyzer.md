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
| instantiates | EMITTED | 12,857 | 2,618 | template pass: every non-builtin element tag → leaf tag name as written (`<Button />` → Button); builtin HTML tags and `svelte:` primitives filtered. The DYNAMIC `this={X}` path (`<svelte:component>` / `<svelte:element>`) resolves an import-bound bare identifier post-merge at that value's line, and since F22 (2026-10-12) it also carries the FULL site set in `metadata.dynamicTargetLines` while `line_number` keeps the LAST site — the map used to be `Map<name, line>`, which lost 36 of 125 corpus sites silently because the edge itself stayed right | 0.95 (12,753) / 1.0 (104) |
| uses | EMITTED | 11,800 | 4,086 | template reads resolving to a name in scope, with `{#each}`/`{#await}`/`{#snippet}`/`{@const}` shadow tracking and the `$store` auto-subscription sigil. Three rules were REPAIRED inside this family in the 2026-10-12 round: a Svelte 5.36 declaration tag now BINDS (`{const doubler = …}`, F26 — head registered into the walk's shadow set, tail collected as reads) instead of publishing the declared name as a member read; a keyed `{#each}` block's KEY expression is a READ (F25 — `(keyOf(row))`/`(sortKey)` publish, while the ordinary `(row.id)` still contributes nothing because the collector's dot rule skips leaves, and the key's words are no longer registered as false template-locals); and a `{@render}` tag's ARGUMENTS are reads (F24). F27 (2026-10-12) added the two rules that make this family positional: a written OBJECT-LITERAL KEY is not a read (`{{ month: x }}` writes `month`; `{{ month }}` reads it; a COMPUTED key `{{ [k]: v }}` reads `k`), decided by the innermost open bracket plus a per-depth pending-`?` flag because `? :` and `: ` are the same character; and a SPREAD argument IS a read (`[...list]` publishes `list`), which the receiver-only dot rule had suppressed because the token before the name is a dot. Since F23 (2026-10-12) the shadow set is also widened per EXPRESSION for the two event carriers (`on:click={…}` and the Svelte-5 `onclick={…}` on an intrinsic tag), so an ARROW PARAMETER — `(evt) => …`, and the destructured `({ data }) => …` — is a template-local rather than a published member read; measured on the corpus at exactly 1 edge in 6,439 files, so the fixtures are the evidence and the corpus is not. **F28 (2026-10-12)** closed the last measured MISSING class in this family: every site that writes a BINDING PATTERN — `{#each … as …}`, `{#await … then …}`, `{:catch …}`, `{#snippet name(…)}`, `{let …}` / `{@const …}` heads — went through the flat word collector, which put EVERY word in the shadow set. So a pattern's READ positions were never published (`{#snippet counter(c = count)}` binds `c` and reads `count`; a computed key `{ [keyExpr]: v }` reads `keyExpr`; a default `x = expr` reads `expr`) and a PROPERTY name was a fabricated template-local (`{ a: b }` binds `b` alone, so registering `a` silenced a real member read of `a` for the whole block). The replacement is one positional, left-to-right pass that mutates the shadow set as it binds (`collectBindingPattern`), which is what makes the ordering rule hold: in `{ idx, [idx - 1]: last }` the computed key's `idx` reads a template-local by the time it is scanned and publishes nothing. A parameter ANNOTATION is neither a read nor a binding (`{#snippet typed(c: number = 4)}` publishes no `number`). Measured before the fix with the grammar-derived oracle (`script/m14/tmp/svelte-uses-oracle.ts`, which re-parses each fragment with the JAVASCRIPT grammar and so decides the split from `assignment_pattern.right` and `computed_property_name`): 35 unpublished template reads over 6,439 files, 27 of them this class, at 81 sites carrying a computed key or a default. **F29 (2026-10-12)** then made the DEDUPE lossy-on-purpose visible: the graph dedupe keys on `type|source|target` and keeps the FIRST row, and the script delegate's rows are pushed before the template pass, so a member read in BOTH script and template lost its template row silently — 384 of 5,781 template reads (6.6%) on the 3,085 corpus files where an independent oracle's shadow model is provably equivalent to this analyzer's. The survivor now gains `metadata.isTemplateRead: true` and `metadata.templateReadSites: [ … ]`; `line_number` and `confidence` are deliberately NOT moved (a payload field the shared budget and the differential baseline pin). The site list is written even for a single dropped site, unlike the read map's own convention, and the reason is what `line_number` means on each: on a template-read row it IS a site, but on the survivor it is the SCRIPT's line, so the list is the only place that site exists | 0.95 (8,116) / 0.9 (1) / 0.85 (144) / **0.6 (3,539 — heuristic, see below)** |
| imports | EMITTED | 9,525 | 3,068 | script `import` → `${modulePath}:${item}`; a namespace import is `mod:*` | 1.0 (9,521) / **0.6 (4 — heuristic)** |
| contains | EMITTED | 6,566 | 2,962 | component/type/class ownership from `ownerName`, plus the JS delegate's interface-member and object-member containment | 1.0 |
| calls | EMITTED | 3,660 | 1,789 | script calls via JS analyzer leaf identities; `on:`/`onclick:` directives → call to the handler leaf; `{@render}` → the snippet leaf. Since F24 (2026-10-12) a `{@render}` tag's ARGUMENTS are also reads (they are `uses` rows, not `calls`, so they are not counted in this row): one per argument identifier at ITS own line, the multiline form's base advancing past the newlines so `beta`/`gamma` land on 41/42 rather than the tag's 40. The callee is excluded from those reads (it belongs to this edge), a member leaf stays out (`row(obj.eps)` reads `obj`), and a snippet parameter stays out — the fixture pins all three as forbid rows | 0.9 (2,946) / 0.85 (705) / 0.8 (9) |
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

## Recorded fixture baseline (2026-10-11, SUPERSEDED 2026-10-12)

**Current state: 53 pass / 0 fail** (the 53rd is `svg-filter-builtin-tags`, added by F30 on 2026-10-12 —
see the F30 note at the end of this section). The 2026-10-12 port closed the last two pins this section
records — `pattern-reads` by F28 (the binding-pattern read/binding split) and
`dedupe-template-read-record` by F29 (the dropped-site record) — after §24's round closed seven more
(`declaration-tag-shadow`, `dynamic-target-sites`, `handler-param-shadow`, `keyed-each-key-reads`,
`multi-site-read-record`, `object-key-not-a-read`, `render-tag-argument-reads`). Three fixtures were
RE-PINNED in the process and every one of them only in FORM: the read record's key moved from the
pre-fold `meta.templateReadLines` to the lane's ratified `meta.templateReadSites`, and four one-element
site arrays became `line_number`-only rows (the read map is written only for MORE than one site). All
39 svelte mutants are CAUGHT, including the two added with F28/F29
(`svelte/binding-pattern-reads-lost`, `svelte/dropped-template-read-not-recorded`), and both typechecks
are clean (`tsc --noEmit` and `-p tsconfig.scripts.json`). The allowance was then RETIRED by the
ceremony, not by a scoped run: `bun run script/m14/run-fixtures.ts --update-baseline` (full suite, 50
lanes, exit 0) rewrote `validation/m14/fixture-baseline.json` — **svelte 9 -> 0**, and every other lane
byte-identical — and emptied this lane's entry in `validation/m14/fixture-baseline.failing.json`. The
write's own words: `fixture allowance retired by this write: 13 failure(s) across 2 lane(s) — vue 5 -> 1,
svelte 9 -> 0`. Reproducibility was checked rather than assumed: a FULL run afterwards, without
`--update-baseline`, reports `fixture baseline gate: no regressions` with **no** stale-high and **no**
unrecorded report, and both artifacts are SHA-256 identical to the written ones.

The historical record, kept because it names what was wrong: `validation/m14/fixture-baseline.json`
recorded this lane at **10 failing pins of 52**, and
`validation/m14/fixture-baseline.failing.json` names them, because a count cannot say WHICH fixture is
red. Nine were already red when the baseline was written at `31b6cd908`:
`declaration-tag-shadow`, `dedupe-template-read-record`, `dynamic-target-sites`, `handler-param-shadow`,
`keyed-each-key-reads`, `multi-site-read-record`, `object-key-not-a-read`, `pattern-reads` and
`render-tag-argument-reads`. One — `relationship-kind-catalog`, which asserts a statement-level
`imports` row — went red with the javascript round `4d1da43ed`, at the same commit that moved vue and
html: this lane's `<script>` block delegates to that analyzer, so a delegate change is visible here
while the javascript lane's own pins stay green. The fixture FILE's landing commit is a separate fact
from the commit that turned it red — most of these files came with `1719ff6b3`, and
`relationship-kind-catalog` with `3e8e5543f`, while the red arrives with the delegate. RECORDED rather
than adjudicated: stale pin or a row the delegate owes back is open. The bisect (43/9 at `31b6cd908`,
42/10 at HEAD, fixtures unchanged) and the gate change are §18 of
`docs/analyzers/BRANCH-INVENTORY-2026-10-07.md`.

**Re-measured 2026-10-12 (F30, the SVG element vocabulary): 53 pass / 0 fail, one mutant added.** This
lane shares the builtin tag vocabulary with the vue lane, and
`script/m14/verify-cross-language-consistency.ts` holds the two lists and the F5 oracle's IDENTICAL, so
F30's fix (the SVG filter module and the rest of the element vocabulary — the vue lane measured 441
fabricated `instantiates` edges from `<filter>` and six primitives over a 1,162-file draw) arrived here
whether or not this lane asked for it. What this lane owes in return is proof that it USES the set rather
than merely declaring it: set parity is a statement about two literals and cannot see a call site that
compares against the wrong thing. `svelte/svg-filter-builtin-tags` is that proof, and
`svelte/reemit-svg-filter-tags` (39 -> 40 mutants, CAUGHT) is the regression that keeps it honest — the
fixture carries a real component in the same template so the check cannot be satisfied by silencing
everything.

The lane's own corpus weight was measured before it was assumed, and it is **zero: 0 of the 6,436
`.svelte` files on disk (`svelte` 4,561 + `shadcn-svelte` 1,878) contain a filter primitive or a
`<filter>` element at all.** So this lane inherits the vocabulary from the parity rule rather than from a
defect visible here today — the live measurement is the vue lane's 441 edges — and what this lane owes is
the behaviour pin above, not a corpus figure it has no draw for.

## Issue

Closes M12.13 (GitHub issue #152).
