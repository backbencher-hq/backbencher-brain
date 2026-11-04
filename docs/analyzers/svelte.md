# svelte.md

## Language

- Analyzer file: `src/ast/real-svelte-analyzer.ts`
- Parser: `tree-sitter-svelte` (SFC pass over the `.svelte` file), served from the repo wasm
  (digest `3d601416b5955a872f044a861efde61081ad1920d26903e9e0b8c4ccebaf09b5`, measured 2026-10-23 by
  `script/m14/svelte-extended-census.ts`; the registry serves the repo wasm first)
- Script delegation: `engine.ts` pre-parses every `<script>` block's exact `raw_text` byte range with
  the grammar the block's own `lang` names — `javascript` by default, `typescript` for `lang="ts"`,
  `tsx` for `lang="tsx"` (`engine.ts:1966`) — and passes the trees positionally via the shared SFC
  context keys `sfcScriptTrees` / `sfcScriptLines` / `sfcScriptCols` / `sfcScriptStartIndex` /
  `sfcScriptLangs` (`engine.ts:1959-1980`). The analyzer never touches `embeddedScriptContent`
  (avoids the engine's polyglot-injection path double-counting symbols).
- Script dispatch inside the analyzer: `lang="ts"`/`lang="tsx"` blocks go to
  `new RealTypeScriptAnalyzer().analyze(...)` and every other block to
  `new RealJavaScriptAnalyzer().analyze(...)` (`real-svelte-analyzer.ts:1093-1104`). The delegate's
  symbols, relationships, `imports[]` and `exports[]` are merged with SFC line/column offsets.
- Language detection: `.svelte` → `language-detection.ts`
- Wired in: `engine.ts getAnalyzer` → `RealSvelteAnalyzer`

## Symbol contract

| Field | Supported? | How extracted (AST node/field) |
| --- | --- | --- |
| name | ✅ | SFC component → file stem → class; script top-level `variable_declarator` → name identifier (const → Constant, let/var → Variable), `function_declaration` → name; `export let`/`export function` → same, owned by the component (public API) |
| kind | ✅ | component → Class; const → Constant; let/var → Variable; function → Function; `export let` props and `$props()` destructure names → Property |
| qualified/container name | ✅ | `ownerName` = component name for exported symbols and component-owned props/reactive targets (`export let`/`$props()`/`$:`); non-exported script top-levels are module-scope (owner empty, mirrors JS family) |
| range (start/end line + column) | ✅ | script-content nodes offset to SFC line numbers via the script block's start position |
| parameters | ✅ | from the delegate (`params` recorded, never symbols) |
| returnType / type | — | the SFC pass constructs its own symbols (Class/Constant/Variable/Function/Property) without `returnType`/`type` fields; the script delegate's symbols are merged as the delegate emits them, so a TypeScript-script file's symbols carry whatever that delegate publishes, not a type the SFC pass synthesized |
| documentation/comments | ✅ | via the delegate (JSDoc / `//` comments on script symbols) |
| complexity metrics | ✅ | via the delegate (script cyclomatic) plus template decision blocks counted by the SFC pass |
| syntax errors | ✅ | ERROR/missing nodes surfaced; `parseErrors` counted by the differential and the census |
| decorators/attributes | — | not a symbol field. Decorators remain edges, not attributes: the TypeScript delegate publishes `decorates` (see the ontology table) and the SFC pass copies it; the corpus exercises it once |

## Relationship ontology

The single claim table for this analyzer. It is derived from `src/ast/real-svelte-analyzer.ts` (each
row cites its emission site or the seam that carries it) and from the lane's committed whole-population
measurement — production `ASTEngine.parseFile` over the fleet's admitted population (git-tracked
`*.svelte` under `$PWD/.corpus`, ≤ 1 MiB per file): **6,147 admitted files across 6 repositories, all
6,147 attempted, 0 production parse failures, 45,243 relationship edges** (2026-10-23;
`validation/m14/measurements/svelte-head-incoming-table1-20261023T144224.txt`,
`validation/m14/measurements/svelte-extended-census.json`,
`script/m14/spec/svelte-completeness.json`). The SFC pass emits `calls`, `renders`, `uses` and
`contains` directly; every other kind arrives from the JS/TS script delegate and is copied across the
delegation seam, which stamps `metadata.sfcDelegated: true` and `metadata.sfcLineOffset` on every row it
copies (`real-svelte-analyzer.ts:1268`). Provenance per kind is measured in the census (sfc vs
delegate) and printed in the counts section below.

| Relationship type | Emitted? | How resolved | Confidence model |
| --- | --- | --- | --- |
| calls | ✅ yes | SFC template pass + delegate script calls. SFC sites: `on:`/`onclick:` directive handler leaf, extracted from the opaque `svelte_raw_text` by a pure-String scan (last callable leaf of `box.open`, trailing call parens stripped, `NON_CALLABLE_LITERALS` refused) at `real-svelte-analyzer.ts:1019`; `{@render X}` snippet-render tag at `:714`; invoked directive carriers (`use:`/`transition:`/`in:`/`out:`/`animate:` names the framework invokes) at `:1541`; `{@attach}` attach directive at `:1059`; a named function handed to an INVOKING rune (`$effect`, `$derived.by`, `$host`, …) at `:1787`, marked `evidenceClass: structural`. Script calls come from the JS/TS delegate (e.g. `real-javascript-analyzer.ts:2655`). Resolution: target is the callable leaf as WRITTEN (bare identifier or last dotted segment); no cross-file resolution, and a target whose root binding is a package the project does not publish is marked `isExternal` | 0.9 `{@render}` · 0.85 `on:` handler / invoked directive / rune invocation · 0.8 attach directive · delegate's own confidence for script calls. `classifyEvidenceTier` (`real-svelte-analyzer.ts:3149`) leaves calls `usage_contextual` unless a site stamped `evidenceClass` |
| extends | ✅ yes | `<script>` class heritage, delegated to the JS/TS analyzer (`real-javascript-analyzer.ts:827/842`, `real-typescript-analyzer.ts:5727`) and copied by the seam. Resolution: written base name, qualified/import-resolved by the delegate; no SFC-side rebasing | delegate's heritage confidence (structural for a written declaration); `classifyEvidenceTier` tiers extends `structural` at confidence ≥ 1, `usage_contextual` at ≥ 0.85, else `inferred` |
| implements | ✅ yes | `implements` clauses in `<script>` classes, TypeScript delegate (`real-typescript-analyzer.ts:5758`), copied by the seam. Resolution: written interface name; per-file delegate rule | delegate's confidence; same `classifyEvidenceTier` tiering as `extends` |
| uses | ✅ yes | Template reads from the SFC pass: an identifier read in a template expression (`{count}`, attribute values, `{#each}`/`{#await}`/`{#snippet}`/`{@const}` bodies with shadow tracking, `$store` auto-subscription sigil) resolves to a name in lexical scope at `real-svelte-analyzer.ts:1367`, ONE edge per member carrying the complete `templateReadSites` set. Script-side reads come from the JS/TS delegate | 0.95 for SFC template reads; delegate's own value for script reads (the delegate publishes some below 0.7, which the M14 harness buckets as `unknown`); default tier `usage_contextual` |
| imports | ✅ yes | Script `import` statements, emitted by the JS/TS delegate (`real-javascript-analyzer.ts:1433/1626`, `real-typescript-analyzer.ts:7870/7903`) and copied by the seam. Target spelling is `${module}:${item}` (a namespace import is `mod:*`); a relative `.svelte` specifier that names an admitted project file also carries `metadata.importProjectFile`, and a bare specifier naming a package the project does not publish carries `metadata.sourcePathClaim`. ALSO a payload channel: the analyzer returns `ImportInfo[]` (`real-svelte-analyzer.ts:497`, merged from the delegate at `:1271`) which the indexer writes to the `brain_import` table | 1.0 on the import edge; `evidenceClass: import_based` (forced by `classifyEvidenceTier`) |
| exports | ✅ yes | `export let`/`export function`/`$props()` bindings become the component public API; `context="module"` exports stay module API. Emitted by the delegate (`real-javascript-analyzer.ts:2851`, `real-typescript-analyzer.ts:8112`) and copied by the seam. ALSO a payload channel: `ExportInfo[]` (`real-svelte-analyzer.ts:498`, merged at `:1293`) | 1.0; `evidenceClass: structural` |
| contains | ✅ yes | SFC component → every module-level symbol, and `ownerName` ownership for component-owned props/exports/reactive targets (SFC pass, `real-svelte-analyzer.ts:1514`); the delegate contributes interface-member and object-member containment (`real-javascript-analyzer.ts:2134`) copied by the seam | 1.0; `evidenceClass: structural` |
| references | ✅ yes | Type/decorator/qualified references from the JS/TS delegate (`real-javascript-analyzer.ts:3627/4399`), copied by the seam. Resolution: delegate's qualified-name rule; per-file | delegate's confidence; `classifyEvidenceTier` sets `import_based` when `metadata.isImport`, else `reference_qualified` |
| overrides | ✅ yes | Class-member overrides in `<script>`, delegate only (`real-javascript-analyzer.ts:2199/2286`, `real-typescript-analyzer.ts:7510/7572/7691`); the seam additionally respells the owner half from the delegate's own `extends` row (`<Base>.<member>`, `real-svelte-analyzer.ts:1261-1268`). Resolution: delegate's base-class rule; CORPUS ZERO (0 edges in 0 files, measured 2026-10-23) — implemented and corpus-unexercised, the csharp precedent | delegate's confidence; `classifyEvidenceTier` tiers `structural`/`usage_contextual`/`inferred` by confidence |
| instantiates | ✅ yes | Script `new` construction sites, delegate only (`real-javascript-analyzer.ts:2725`, `real-typescript-analyzer.ts:7040/7376`), copied by the seam. Template tags are NOT instantiates — see `renders`; the two relations are kept distinct | delegate's confidence; `classifyEvidenceTier` keeps it `structural` unless the delegate marks component usage |
| decorates | ✅ yes | Decorators in `<script lang="ts">`, TypeScript delegate (`real-typescript-analyzer.ts:7454`; JS delegate `real-javascript-analyzer.ts:3047`), copied by the seam. CORPUS EXERCISED ONCE: the only applied decorator in 6,147 files is `@foo()` on a class in svelte's own validator sample `ts-unsupported-decorator/input.svelte` (this is the language's own negative test — it asserts the decorator is rejected) | delegate's confidence (the one corpus row is 1.0); default tier `usage_contextual` |
| renders | ✅ yes | SFC template pass — three sites, all owned by this analyzer: a plain capitalised component tag at `real-svelte-analyzer.ts:861` (`metadata.isComponentUsage: true`); a dotted-namespace tag `<Ns.M/>` at `:1441` (`metadata.resolution: "namespace-member"`, module kept in `metadata.namespaceBinding`); a dynamic `<svelte:component this={X}/>` / `<svelte:element this={X}/>` at `:1484` when X is an import-bound bare identifier (a member-resolved X deliberately emits `uses` instead). Builtin HTML tags and `svelte:` primitives are filtered. The delegate's JSX renders branch exists but cannot fire in an SFC script | 0.95 plain tag · 0.9 dotted namespace · 0.95 dynamic `this=`; `evidenceClass: usage_contextual` |
| mixes_in | ✅ yes | Call-shaped heritage (`class X extends mix(Base)`) in `<script>`, emitted by the JS/TS delegate (`real-javascript-analyzer.ts:852/917`, `real-typescript-analyzer.ts:8663`) and copied by the seam — R3 delegation, no grammar change. CORPUS ZERO: 0 edges, and the construct leg independently measures 0 call-shaped heritage classes over 6,147 files (2026-10-23) | delegate's confidence; default tier `usage_contextual` |
| part_of | ✅ yes | Triple-slash reference directives (`/// <reference path="…"/>`) in `<script>`, emitted by the TypeScript delegate (`real-typescript-analyzer.ts:8792`) and copied by the seam. BUILD-SCOPED: the emission path exists only on the PATCHED TypeScript grammar serving a `reference_directive` node carrying `role`/`target` fields (patched R2 build `8586372d…`, provisional — the TypeScript lane measured a regeneration drift and the wiring is being withdrawn pending its v3). CORPUS ZERO: 0 edges, and the construct leg measures 0 directives in BOTH build shapes (patched `reference_directive` nodes and unpatched comment-shaped directives) over 6,147 files (2026-10-23) | delegate's confidence; default tier `usage_contextual` |

### Measured counts behind the rows — the 2026-10-23 whole-population run

Production path, admitted population, one run; per-kind edge counts and their seam provenance
(`sfc` = written by `real-svelte-analyzer.ts`, `delegate` = copied from the JS/TS analyzer):
`validation/m14/measurements/svelte-extended-census.json` (provenance),
`svelte-head-incoming-table1-20261023T144224.txt` (closure).

| Relationship type | edges | sfc | delegate | note |
| --- | --- | --- | --- | --- |
| calls | 3,586 | 1,159 | 2,427 | template directives/`{@render}`/runes + delegate script calls |
| uses | 11,472 | 7,825 | 3,647 | largest template side; delegate script reads |
| contains | 6,238 | 5,772 | 466 | ownership + delegate member containment |
| imports | 8,992 | 0 | 8,992 | delegate import rows; `ImportInfo[]` payload rides beside |
| exports | 2,482 | 0 | 2,482 | delegate export rows; `ExportInfo[]` payload rides beside |
| references | 752 | 0 | 752 | delegate qualified references |
| extends | 16 | 0 | 16 | delegate class heritage |
| implements | 1 | 0 | 1 | delegate `implements` clause |
| overrides | 0 | 0 | 0 | delegate path exists; corpus-unexercised |
| instantiates | 191 | 0 | 191 | delegate script `new` only |
| decorates | 1 | 0 | 1 | the single decorator site named above |
| renders | 11,512 | 11,512 | 0 | SFC template pass, three shapes |
| mixes_in | 0 | 0 | 0 | delegate path exists, construct 0 sites |
| part_of | 0 | 0 | 0 | delegate path exists on the patched TS build, construct 0 sites |

The eleven-term closure over the same run partitions all **45,243** edges exactly: resolved 20,647 +
ambiguous-by-declaration 1,519 + unresolved 13,757 + bindOK 3,680 + external 5,640 = 45,243, with
`collRes` 5,762 (of `resolved`; all `contains` tie-break picks) and ambiguous-by-kind 786 printed
beside and never added. `unclassed` 0.

**The `renders` relabel moved no edge.** On 2026-10-23 the SFC template relation moved from
`instantiates` to `renders` (`real-svelte-analyzer.ts:861/1441/1484`, commit `03b776294`; the F5 oracle
was patched to derive `renders` in the same wave, commit `44b33cf37`). The pre-change and post-change
runs total the SAME 45,243 edges, and the buckets cross-check exactly: instantiates 11,703 → 191 and
renders 0 → 11,512 (resolved 549 = 68 + 481 · unresolved 9,263 = 7 + 9,256 · ambiguous 832 = 832 ·
extOK 945 = 2 + 943 · bindOK 114 = 114). A label moved; no relationship was created or destroyed.

### The four extended values, one by one

- **`renders` — the SFC template pass (implemented, corpus-exercised, 11,512 edges).** Three emission
  shapes, all measured on the corpus: plain capitalised tag (`:861`, 0.95), dotted-namespace tag
  (`:1441`, 0.9, `resolution: namespace-member`), dynamic import-bound `this=` (`:1484`, 0.95). The
  relation means "this file's markup mounts this component"; it is deliberately NOT `instantiates`,
  because the source contains no `new`. Both directions are pinned by the fixture
  `validation/m14/fixtures/svelte/renders-component-tags.*` (template tags must render and must not
  instantiate; a script `new` must instantiate and must not render).
- **`decorates` — implemented, exercised exactly ONCE in 6,147 files.** The row is delegate
  provenance; the corpus's only applied decorator is in `svelte/…/ts-unsupported-decorator/input.svelte`
  (the compiler's own unsupported-decorator test), target `foo` against 445 declarations. A reader
  should see that as a property of the row rather than a count absorbed into a denominator.
- **`mixes_in` — implemented through the delegation seam, corpus-zero.** The JS/TS delegate's R3
  call-shaped-heritage rule emits it; the construct leg of the census measures **0** call-shaped
  heritage classes over the admitted population, so the zero is a corpus fact, not an unreachable
  path. Overturn condition: one `<script>` class whose heritage clause is a call whose callee is a
  declaration in the corpus.
- **`part_of` — implemented through the delegation seam, corpus-zero AND BUILD-SCOPED.** The
  TypeScript delegate emits it for `/// <reference path="…"/>` ONLY when the served grammar produces a
  `reference_directive` node with role/target fields (the patched R2 build `8586372d…`, provisional:
  the TypeScript lane measured a regeneration drift and the wiring is being withdrawn pending v3).
  The census's construct leg counts both possible shapes — patched `reference_directive` nodes AND
  unpatched comment-shaped directives — and both are **0** over 6,147 files. "0 sites under the
  patched build" and "0 sites under the served build" are different claims; this row states the build
  it was measured under (census BUILD PRECONDITIONS block, 2026-10-23).

### The `overrides` evidence — implemented and corpus-unexercised (corrected 2026-11-03)

An earlier revision of this page called `overrides` "the one row that is not EMITTED". **That framing
was wrong and is corrected here**: the analyzer DOES publish the kind — through the JS/TS delegate,
copied by the seam (`real-svelte-analyzer.ts:1261-1268`; delegate sites
`real-javascript-analyzer.ts:2199/2286`, `real-typescript-analyzer.ts:7510/7572/7691`). What is
narrower and remains true is the corpus measurement:

- `script/m14/svelte-overrides-capability.mts` measures the construct through production `parseFile`
  over a declared probe population (8 SFCs + 5 plain-file controls, 0 corpus files): 1 override edge
  on the JS delegate, 1 on the TS delegate, 1 from a `context="module"` block, 1 for an accessor,
  identical with and without the `override` modifier. A plain `.js` control fires identically, so the
  seam neither adds nor drops the type.
- This lane's own fixture `heritage-implements-overrides.svelte` carries **4** `overrides` edges
  (`Child.area -> Base.area`, `Base.area -> Shape.area`, `Child.render -> Base.render`,
  `Child.area -> Shape.area`).
- Whole-population run 2026-10-23: **0 `overrides` edges in 0 files.** The construct probe over the
  same corpus (historically 6,439 readdir files; 5,498 `<script>` blocks, 2,031 `lang="ts"`/`"tsx"`,
  all sub-parsed, 0 failures) found 105 class-shaped declarations, 337 `method_definition`, 767
  `property_signature`, 20 `interface_declaration`, 3 `extends_clause` and 1 `implements_clause` —
  every inventory row non-zero, which is what makes the zero an absence rather than a broken probe.
  3 classes carry a superclass; 2 extend host types no corpus file declares (`HTMLElement`,
  `HTMLButtonElement`); 1 resolves, and it shares only `constructor`, which ECMAScript does not
  inherit. Name collisions: 0. **Resolved overrides: 0, in 0 files.**
- The construct, the implementation and the corpus are three different questions; the answer is
  "implemented + corpus-unexercised, counted ONCE inside `implemented` with the zero disclosed"
  (`script/m14/spec/svelte-completeness.json`, `_implemented_measured.overrides`). Overturn
  condition: one corpus SFC whose class extends a class declared in the corpus and re-declares one of
  its non-constructor members.

### Historical census (2026-10-16) — superseded where it differs from the 2026-10-23 run

Kept as measured history, not as the current claim. Its population rule was a readdir walk, not the
fleet's admitted-set rule, and it predates the extended vocabulary and the `renders` relabel:
`script/m14/svelte-census.mts` saw 6,439 `.svelte` files across 61 corpus dirs (shadcn-svelte 1,878 /
svelte 4,561), 6,436 parsed, 3 empty, 0 over 512 KB, **19,247 symbols and 47,713 relationships**, plus
8,684 `imports[]` payload rows in 3,075 files. Its 9-kind relationship channel read: calls 3,660 ·
uses 11,800 · contains 6,566 · imports 9,525 · exports 2,512 · references 775 · extends 17 ·
implements 1 · instantiates 12,857 (the template tags that are now `renders`) · overrides 0.

Historical per-kind table (counts and confidence mixes from the 2026-10-16 census; the LABEL
`renders` is applied to the template-tag row because the same pass produced it — the count is the
pre-relabel one):

| Relationship type | Verdict | Edges | Files | How resolved | Confidence model |
| --- | --- | --- | --- | --- | --- |
| renders | EMITTED | 12,857 | 2,618 | template pass: every non-builtin element tag → leaf tag name as written (`<Button />` → Button); builtin HTML tags and `svelte:` primitives filtered | 0.95 (12,753) / 1.0 (104) |
| uses | EMITTED | 11,800 | 4,086 | template reads resolving to a name in scope, with `{#each}`/`{#await}`/`{#snippet}`/`{@const}` shadow tracking and the `$store` auto-subscription sigil | 0.95 (8,116) / 0.9 (1) / 0.85 (144) / **0.6 (3,539 — heuristic, see below)** |
| imports | EMITTED | 9,525 | 3,068 | script `import` → `${modulePath}:${item}`; a namespace import is `mod:*` | 1.0 (9,521) / **0.6 (4 — heuristic)** |
| contains | EMITTED | 6,566 | 2,962 | component/type/class ownership from `ownerName`, plus the JS delegate's interface-member and object-member containment | 1.0 |
| calls | EMITTED | 3,660 | 1,789 | script calls via JS analyzer leaf identities; `on:`/`onclick:` directives → call to the handler leaf; `{@render}` → the snippet leaf | 0.9 (2,946) / 0.85 (705) / 0.8 (9) |
| exports | EMITTED | 2,512 | 1,299 | `export let`/`export function`/`$props()` bindings → component public API; module-block exports stay module API | 1.0 |
| references | EMITTED | 775 | 310 | decorator/type references merged from the delegate | 0.95 (484) / 0.8 (290) / 1.0 (1) |
| extends | EMITTED | 17 | 16 | in-`<script>` class heritage, delegated to the JS/TS analyzer | 1.0 |
| implements | EMITTED | 1 | 1 | `implements` clause; 0 on shadcn-svelte's 1,878 files, 1 on the svelte compiler suite | 1.0 |
| overrides | **CORPUS ZERO** | 0 | 0 | implemented through the delegate; the corpus never exercises it (see the corrected section above) | — |

**Two channels for imports (measured 2026-10-16).** `imports` appears in BOTH the relationship channel
(9,525 edges) and the `imports[]` payload channel (8,684 rows). They are different surfaces:
`ParseResult.imports` is what the parallel indexer writes to the `brain_import` table; relationship
edges go to `brain_relationship`. The old `script/m14/firing-check.mjs` tallied only the relationship
channel and compared against the enum value `"brain_import"`, which no emitter produces — that is the
superseded v1 instrument; `firing-check-v2.mjs` separates the two channels for this reason.

### The six questions for the nine already-emitted types (2026-10-16 census)

The instrument and numbers below are the 2026-10-16 census's; the current population and counts are
the 2026-10-23 table above. Kept because the reasoning about resolution, labelling and confidence is
still what this lane's measurement says.

| | question | instrument | result |
| --- | --- | --- | --- |
| 1 | **Exists** (constructible) | source derivation | 6 types constructed in `real-svelte-analyzer.ts`; the rest arrive from the delegate. Derivation answers this question only. |
| 2 | **Fires** (on real corpus) | `svelte-census.mts`, production path | **9/9 fire.** Per-type edges and file counts in the historical table; 0 silent among the nine. |
| 3 | **Correct** (an independent oracle agrees) | `differential.ts` F5 + `script/m14/svelte-truth.ts` | 200-file shadcn-svelte probe: tree-truth 1,444 edges, covered 1,444 (100%), MISSING 0, analyzer edges 1,436, **unexplained 0, heuristic 0**. The DERIVATION gate read `svelte: clean` — this lane supplied its own oracle for `contains` and `uses` (`20e2d2be5`). **The oracle is a second walker over the SAME grammar, so a shared grammar bug is invisible to both sides.** That limit is the harness's and is not closed here. |
| 4 | **Labelled** (right type, not a neighbour) | `script/m14/svelte-labelling-audit.mts` | 47,713 edges, 11 asymmetry rules, **0 hits**, with 26 calibration cases proving each rule can fire. The instrument's first version reported 2,296 false positives — seven rule defects, each verified against a corpus file and recorded in the source. |
| 5 | **Resolved** (both endpoints bind) | `svelte-census.mts` per-type columns | **Source: 47,673 of 47,713 (99.92%)** bind to a symbol declared in the same file; 40 do not. **Target: 33,940 of 47,713 (71.13%)** bind to a local declaration, an import binding, or a `module:item` import; 13,773 do not. The two weakest targets were `instantiates` (102 local / 4,685 import / **8,070 unresolved**) — a template tag names a COMPONENT in another file — and `imports` (0 local / 0 import-binding / **7,560 `module:item`** / 1,965 unresolved). `contains` resolved its target on 6,566 of 6,566. |
| 6 | **Confident** (`evidenceClass` + confidence right) | `svelte-census.mts` | 47,713 of 47,713 edges carry a confidence; 0 do not. **3,543 edges (7.43%) are below 0.7 and therefore heuristics** per M14 §4: 3,539 `uses` at 0.6 and 4 `imports` at 0.6. All edges carry an `evidenceClass`. |
| 7 | **R7** (no unknown symbols, empty names, or placeholder endpoints) | `svelte-census.mts` + `script/m14/svelte-r7-probe.mts` | 0 empty symbol names, 0 unknown/empty `SymbolKind`, 0 empty edge sources, 0 empty edge targets. **10 placeholder sites remain** (2 symbol names, 3 edge sources, 5 edge targets), every one listed BY NAME by the probe: all 10 are bindings that really exist in the corpus — 8 against the two files that declare `unknown` (`css/samples/omit-scoping-attribute-class-dynamic/input.svelte:2`, `runtime-runes/samples/proxy-coercive-assignment-warning/main.svelte:14`), 2 the earlier R7 fix in `783c26690` did not reach. R7's text scopes the rule to a literal "that does not exist in the source", so these are not violations. |
| — | **Edges are OUTGOING ONLY** | — | Every edge is emitted from the file being analyzed; no claim about incoming edges is made or supported by any number here. |

### Confidence honesty (M14 §4, 2026-10-16 census)

`uses` carried 3,539 edges at **0.6**, below the 0.7 line, so they were countable heuristics rather
than facts: 7.43% of confident edges. They came from template reads whose provenance is a character
walk over the grammar's opaque `svelte_raw_text` leaf — the documented fallback for a construct the
grammar cannot express structurally, not a claim of independence from it. `imports` carried 4 more at
0.6. Everything else was ≥ 0.8. The current reportable model is the claim table's
`Confidence model` column: SFC sites carry the fixed values written at their sites (0.8–1.0) and the
delegate carries its own values, re-tiered once by `classifyEvidenceTier` (`:3149`).

### Payload and latency (2026-10-16 measurement)

`script/m14/svelte-payload-latency.mts`, production path, median of 3 per file, warm-up discarded,
population derived by readdir:

| corpus | sampled | timed | ms/file | ms/KiB | symbols | edges |
| --- | --- | --- | --- | --- | --- | --- |
| shadcn-svelte | 400 | 380 | 17.88 | 12.18 | 1,200 | 5,411 |
| svelte | 400 | 380 | 7.72 | 28.81 | 1,211 | 2,049 |

The two populations disagree in **direction** — svelte's own repo is mostly files under 0.5 KiB where
a fixed cost dominates, so its ms/KiB is the worse figure — which is why a single mixed number would be
less informative. Within shadcn the cost is monotone in file size (7.05 → 94.20 ms across six buckets).

Edge weight per type at that measurement: `renders` (then labelled `instantiates`) 34.9% of edge bytes
(180 B/edge), `imports` 22.7% (248 B/edge, the widest rows), `uses` 20.0%, `contains` 11.4%, `calls`
5.9%, `exports` 3.5%, `references` 1.6%; `overrides` contributes 0 bytes. Narrowing to one type pays
0.018× (`references`) to 0.323× (the template row) of unfiltered — a within-lane comparison over edge
bytes, **not** comparable to the workstream's lodash/ripgrep 2.5-4.8×, which measures a serialized
response.

## Supported constructs

- SFC decomposition: `<template>` + `<script>` + `<style>` blocks located via the
  tree-sitter-svelte `element`/`script_element`/`style_element` tree; template pass and script pass are
  independent, no source-text scanning of the file
- `<script>` instance and `context="module"` blocks: `lang` absent/`js`/anything` → JavaScript
  delegate; `lang="ts"`/`lang="tsx"` → TypeScript delegate (grammar chosen by `engine.ts:1966`);
  imports, top-level const/let/var, function declarations, `export let` props, `$props()` destructure
  names, `$:` reactive targets, class declarations and heritage — `Button.svelte`, `UserList.svelte`,
  `App.svelte`, `Negative.svelte`
- Runes (`$state`, `$derived`, `$props()`, `$effect`, …) are compiler keywords — never symbols;
  destructured `$props()` locals are Property symbols (JS family contract). A named function handed to
  an INVOKING rune is a call site (D7)
- Template components: non-builtin element tags → `renders` (leaf tag as written) — `App.svelte`
  (`<Button/>`, `<Card/>`); dotted-namespace tags (`<Card.Root/>`) and import-bound dynamic
  `<svelte:component this={X}/>` targets also render (fixtures `namespace-component-tags`,
  `dynamic-target-sites`, `renders-component-tags`)
- Events: `on:`/`onclick:` directives → `calls` to the handler leaf — `Button.svelte` (`on:click`),
  `App.svelte` (`on:greet`), `UserList.svelte` (`on:select`); `{@render}` tags and invoked directive
  carriers are call sites too
- Negative fixtures: `bind:`/`class:`/`transition:`/`use:` directives never emit edges themselves
  (an invoked carrier emits `calls`, a member read emits `uses`); `on:input={(e) => e.target.value}`
  (arrow with param + property access, no call target) emits nothing; template expressions
  (`{count}`, `{#each}` bodies) are not symbols or calls — they are `uses` reads where a name binds;
  builtin HTML tags never render and never instantiate; locals/params (`e`, `local`, `stateVal`)
  never become symbols — `Negative.svelte`
- Legacy props: `export let query = ''` → component public API (`exports` + `contains`) —
  `UserList.svelte`
- 2026-11-03: the scoped fixture suite is **54 pass / 0 fail**
  (`bun run script/m14/run-fixtures.ts --lang svelte`), including the both-directions
  `renders-component-tags` fixture and the `heritage-implements-overrides` fixture (4 override rows)

## Unsupported / explicit-unknown constructs

- `lang="ts"`/`lang="tsx"` scripts are parsed by the **TypeScript** delegate, not the JS one
  (`real-svelte-analyzer.ts:1093-1104`); the earlier "always JS" note on this page was wrong and is
  corrected here. Template expressions remain grammar-opaque either way (next bullet).
- Svelte 5.2+ template syntax that the tree-sitter grammar cannot express is handled by documented
  fallbacks where the construct is reachable (`on:` handler leaf extracted with pure-String scanning
  of the opaque `svelte_raw_text`/`raw_text_expr` leaf — the grammar exposes template expressions as
  an opaque leaf, so no AST structure exists to walk; this is the documented regex-free fallback for
  grammar-opaque constructs). Files with such syntax surface as ERROR nodes, counted in the corpus
  section below, not silently dropped.
- `{#snippet}`, `{@render}`, `{#each}` blocks do not emit symbols — snippets are template-local
  fragments, each-blocks are iteration statements (family contract; no locals from block scopes).
  `{@render X}` DOES emit a `calls` edge to the snippet leaf.
- Dynamic component targets: an import-bound bare identifier in `<svelte:component this={X}/>` /
  `<svelte:element this={X}/>` IS resolved (a `renders` edge at `:1484`); a MEMBER-resolved value
  (`this={obj.Comp}`) deliberately emits `uses` instead — the dynamic target is not cross-file
  resolved beyond the import binding.

## Regex inventory

The HEAD-blob tree-sitter AST census (`npx tsx script/m12/regex-census.ts --head`,
`validation/m12/results/regex-census.json`) scanned all 48 analyzers and reports
`totalRegexUsages: 25` with **no Svelte entry** — i.e. 0 regex literals in this analyzer. The
`no-regex-gate.sh` delegation prints no svelte row for the same reason (run 2026-11-03). The engine's
SFC script pre-parse uses byte-offset `raw_text` slicing, not the polyglot regex path. The string
tests this analyzer needs are character walks, not patterns: `isIdentifier`, plus
`containsWhitespace`, `isUriSchemeSpecifier` and `isDottedIdentifierChain`
(`real-svelte-analyzer.ts:282-355`), whose accept sets are pinned by the control arm
`script/m14/svelte-ident-checks.ts` (50 arms, 50 PASS / 0 FAIL) — including the empty segment
(`a..b`) that a dotted-name loop must reject. The `on:` handler leaf extraction uses the same
pure-String scanning.

## Complexity envelope

From `validation/m12/results/svelte-complexity.json` (M12 run, committed artifact):

| Run | files | symbols | relationships | wall ms | symbols/s | relationships/s | peak RSS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fixtures | 5 | 29 | 35 | 481.2 | 60 | 73 | 204.2 MB |
| corpus_subset | 396 | 913 | 655 | 2,292.3 | 398 | 286 | 271.2 MB |

Declared budgets: fixtures < 2 s (met: 0.48 s); 400-file corpus < 60 s (met: 2.3 s).

Hot path: the SFC tree is walked once (explicit stack, `script_element`/`style_element` subtrees
skipped); script subtrees are delegated to the JS/TS analyzer (single iterative traversal, scope
per-frame snapshots); template `renders` resolution is O(1) builtin-tag set lookups; `on:` handler
leaf extraction is a single linear scan of the small expression text; containment from `ownerName` is
one pass. No O(n²) or per-symbol O(n) scans.

## Differential ground truth

- Ground truth: `validation/m12/ground-truth/svelte.json` — **82 facts** (29 symbol + 53
  relationship: uses 16, contains 10, calls 9, imports 7, exports 5, **instantiates 4**, references 2),
  authority `manual_audit`, each quoting its fixture line.
- **The 4 `instantiates` facts are template-tag facts and are SUPERSEDED.** The extended vocabulary
  renamed the SFC template relation to `renders` on 2026-10-23 (analyzer `03b776294`; F5 oracle
  `44b33cf37`). The M12 fixture differential can therefore NOT be re-run unchanged against the
  current analyzer: its truth still expects `instantiates` where the analyzer now emits `renders`.
  The verdict is **pending a truth update**, and the F5 corpus differential (whose svelte oracle now
  derives `renders`) is the current instrument.
- `validation/m12/results/svelte-differential.json` in this checkout is a per-file extraction record
  (`kind: per_analyzer_differential:svelte`, `perFile` for the five fixtures, truthSource/truthReference
  prose); it carries **no** precision/recall/FP/FN/`passed` fields. The earlier revision of this page
  claimed "Precision 1.000 / recall 1.000 / FP 0 / FN 0 / unknown 0, `passed: true`,
  `earliestFailingLayer: none`" — **no committed artifact in this checkout attests those numbers, so
  they are UNKNOWN, not claimed.** A fresh run (`bun script/m12/verify-analyzer.ts svelte`) writes the
  verdict fields, but would rewrite a tracked artifact outside the 2026-11-03 page pass and measures
  the pre-relabel truth; it was deliberately not run here.
- Historical, unchanged: the F5 svelte probe reported 200 shadcn-svelte files with tree-truth 1,444,
  covered 1,444 (100%), MISSING 0, analyzer edges 1,436, unexplained 0, heuristic 0 (2026-10-16
  census). It is a probe, not the whole population, and it predates `renders`.

## Corpus validation

**Current (2026-10-23), the fleet's admitted population — this is the claim.** Population rule:
git-tracked `*.svelte` per repository entry at the corpus root, then the 1 MiB per-file cap. Measured:
**6,147 admitted files across 6 repositories** (svelte 4,462 · shadcn-svelte 1,681 · snacks.nvim 1 ·
nvim-treesitter 1 · gql-graphql-yoga 1 · gql-graphql-eslint 1; corpus-root entries 202, 202 distinct
real paths). All 6,147 attempted: 6,144 non-empty files parsed + 3 empty + 0 unreadable; **0
production parse failures, 0 SFC parse failures, 0 script sub-parse failures**; **45,243 relationship
edges** whose eleven-term closure is exact (see the ontology section). Construct leg on the same
population: 17,605 component tags, 745 reserved-namespace tags, 18,502 intrinsic tags, 5,243 `<script>`
blocks (1,844 `lang="ts"`/`"tsx"`, all sub-parsed), 1 decorator, 0 call-shaped heritage classes and 0
reference directives in both build shapes. Artifacts: `validation/m14/measurements/`
`svelte-head-residual-gate-20261023T144224.txt`, `svelte-head-incoming-table1-20261023T144224.txt`,
`svelte-extended-census.json`, `svelte-head-extended-census-{emission,construct}-20261023T150407.txt`;
declaration `validation/m14/instruments/svelte/incoming-declaration.json`.

**Historical (M12, 2026-10) — a different scope, kept as the earlier measurement:**
- Corpus target: `validation/m12/corpus-manifest.json` → `svelte@26786e92` (clean; the svelte repo's
  own `.svelte` test suite — 4,462 files across runtime-legacy/runtime-runes/parser-modern/validator/
  snapshot/print/… categories)
- Sample: 396 tracked `.svelte` files (deterministic stratified sample across 20 test categories;
  sample file `validation/m12/results/svelte-corpus-sample.txt`, reproducible from `git ls-files`; 4
  deliberately-broken `loose-invalid-*`/`loose-unclosed-*` parser error-recovery fixtures excluded —
  invalid by design, not corpus source)
- Symbols 913 / relationships 655 / wall 2.3 s / **0 crashes / 0 timeouts** — fresh parser per file,
  mirrors the production pipeline (`script/m12/svelte-corpus-errors.ts`)
- **Grammar upgrade (like M12.11 Dart):** the previously pinned npm `tree-sitter-svelte` wasm (2023)
  errored on 30/400 (7.5%) — it predates Svelte 5 snippets and `{@render}`. Rebuilt from the
  maintained `tree-sitter-grammars/tree-sitter-svelte` fork (2025-06, Svelte 5): **12/396 (3.0%)**
  residual ERROR-node files, all using Svelte 5.2+ syntax that no tree-sitter grammar supports —
  `{@attach}` attachments, generic snippets (`{#snippet generic<T>}`), `{#each}` shorthand without
  `as`, comments inside tags, self-closing `<script/>`, `{@const}` division. Verified identical gaps
  on the newer `PRRPCHT/tree-sitter-svelte-next` fork (2026-02): same 16 files, same 82 error nodes.
  Recorded honestly as `grammarErrorFiles: 12` in the manifest (precedent: kotlin 51, fsharp 108,
  typescript 5 — nonzero counts recorded with root-cause notes, never hidden). The old 30/400
  measurement was discarded, not recorded.
- Fixture shapes were re-verified against that grammar before commit: attribute expression value
  moved from `expr_attribute_value > raw_text_expr` to `expression > svelte_raw_text` (handled in
  `onHandlerLeaf`); snippet/render/each block shapes probed and confirmed compatible.
- **At HEAD the per-file ERROR-node rate is UNKNOWN**: the 2026-10-23 whole-population run measures
  parse FAILURES (0), not ERROR-node density, and no post-relabel re-measure of the 12/396 figure was
  committed. The historical number stands for the grammar it was measured on.

## Evidence pointers

- Fixtures: `validation/m14/fixtures/svelte/` (54 pass / 0 fail, 2026-11-03)
- Whole-population declaration: `validation/m14/instruments/svelte/incoming-declaration.json`
- Coverage block: `script/m14/spec/svelte-completeness.json`
- 2026-10-23 whole-population run: `validation/m14/measurements/svelte-head-residual-gate-20261023T144224.txt`,
  `svelte-head-incoming-table1-20261023T144224.txt`, `svelte-extended-census.json`,
  `svelte-head-extended-census-emission-20261023T150407.txt`,
  `svelte-head-extended-census-construct-20261023T150407.txt`
- Historical M12 artifacts: ground truth `validation/m12/ground-truth/svelte.json`; differential
  extraction `validation/m12/results/svelte-differential.json` (no verdict fields — see above);
  complexity `validation/m12/results/svelte-complexity.json`; corpus sample
  `validation/m12/results/svelte-corpus-sample.txt`
- Regex census: `validation/m12/results/regex-census.json` (no svelte row) · identifier control arm:
  `script/m14/svelte-ident-checks.ts`
- Docs: this file

## Issue

Closes M12.13 (GitHub issue #152). Launch pass 2026-11-03: the relationship ontology became the
single 14-row measured claim table above, and the "always JS"/"dynamic targets unresolved"/
"overrides not emitted" claims were corrected against the analyzer source and the committed evidence.
