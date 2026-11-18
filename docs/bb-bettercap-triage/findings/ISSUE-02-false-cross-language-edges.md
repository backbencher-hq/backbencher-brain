# ISSUE-02 — Cross-language edges: Go stdlib imports + JS property names re-bound by name collision

- **Lane:** `cross-lang` · **Issue:** report item 2 · **Task:** `task-2`
- **HEAD:** `be4c0ef25` ("Release 0.1.6: five analyzers, one graph")
- **bb:** `0.1.6` (`node bin/bb --version`) · **Date:** 2026-11-18 (UTC)
- **Subject index:** bettercap `/home/ishaq2321/bettercap`, projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`
- **Verdict: `REAL-BUT-MISDESCRIBED`** — every observed row reproduces exactly; the description of *what the row is* and *how far it extends* is wrong.
- **Severity: `high`**

## 1. Verdict and one-paragraph finding

The report's observation is real and exact: `bb_cross_language main` on bettercap returns 7
`is_cross_language = 1` rows, including `main.go:main:1 --imports--> os @ .github/workflows/release.yaml:15`
(confidence 0.9), `fmt @ Makefile:36` (0.9), `io @ modules/ui/ui/assets/openlayers/ol.js:464` (0.9), and four
`uses` rows from `fontawesome.js` into `main` at 0.6. **But none of those files imports, calls or uses any Go
symbol.** They are the *collision targets* of a name-only re-binding: the Go analyzer correctly emitted the
stdlib import specifiers `fmt`, `io`, `os` as **external/unresolved** targets (its own metadata says
`isStdlib:true`, `reasonCode:"target_is_a_module_path_not_a_symbol"`), and a global name-resolution pass then
bound those bare names to whatever project symbol carried the same name — a YAML matrix key, a Makefile target,
a minified JS function. The four FontAwesome rows are `main = _ref.main` object-property destructuring bound to
the Go `package main` symbol. The pass that stamps `is_cross_language` then *certifies* the bad binding because
the two files' languages differ, and the read surface publishes the original row confidence (0.9/0.6) and a
type-derived tier (`import_based`). So the finding is **not** that a declared candidate heuristic produced
low-confidence name-resolution rows — that part *is* documented. The finding is that the rows are
**over-confident and mislabeled** (0.9 / `import_based` / `structural` renderings of a binding with no
evidence), that the binding contradicts the product's own declared model in two places, and that the report
understates a **systemic, 100 %-name-resolution population** (2,423/2,423 bettercap cross-language rows) rather
than a handful of quirk edges on `main`.

## 2. Why it matters

1. An agent or IDE user asking "what does `main` bridge to?" is told it imports a YAML workflow key, a Makefile
   target and a minified OpenLayers function at 90 % confidence. `bb_graph` returns the *same stored row*
   (`rowId …:main:uses:745`) as a cross-language edge to `main.go:main:1` with `targetBasis:"symbol"` — the
   external basis is laundered away — and hover/graph/impact all read the same table.
2. It corrupts the surfaces the 0.1.6 release advertises ("five analyzers, one graph"): graph edges point at
   non-code symbols (`skills`, `exports`, `Position` in Markdown/JSON), and the strongest tier (`structural`) at
   confidence **1.0** is reachable on a name-collision row (workspace sample: `GateLockError extends Error` where
   `Error` resolves to a JSON evidence file's key at `validation/m14/instruments/ruby/incoming-declaration.json:382`).
3. It contradicts the product's own declared model: `src/ast/analysis-exclusions.ts:108` declares that "a YAML
   mapping key, a Markdown heading, a JSON property and a CSS selector have no callers and never will", yet the
   cross-language binder and its read surface use exactly those symbols as `imports`/`calls`/`extends` targets.
4. It makes the cross-language feature's precision unknowable: 100 % of bettercap's cross rows carry
   `bridge_mechanism='name-resolution'`, so a consumer has no row-level signal separating a real bridge
   (`graphql → typescript` codegen, a genuine `ts → js` import) from a collision. Trust in the whole feature is
   what is at stake, and this is a live indexer defect, not a stale artifact.

## 3. Reproduce (bounded)

```bash
cd /home/ishaq2321/mcp/backbencher-brain
# (a) the public read surface
node bin/bb tool bb_cross_language --dir /home/ishaq2321/bettercap --args '{"symbol":"main"}'
# (b) the stored rows behind it (read-only; never reindexes bettercap)
node docs/bb-bettercap-triage/evidence/cross-lang/inspect-db.cjs \
  /home/ishaq2321/.bb/projects/4c7590f1cba319aac298a50453c0ec440f2dc857/brain.db main-rows
# (c) the graph door consuming the same row
node bin/bb tool bb_graph --dir /home/ishaq2321/bettercap \
  --args '{"symbol":"makeIconMasking","direction":"callees","relationshipTypes":["uses"],"maxEdges":800,"edgeLimit":800}'
```

Observed (abridged; full payloads in §11):

```
facts: 7, storedRowCount 7, pairCount 3, ambiguous true (4 copies of "main")
main.go:main:1  --imports(0.9, import_based)-->  fmt @ Makefile:36              [go → make]      rowId ...:main.go:main:1:fmt:imports:4
main.go:main:1  --imports(0.9, import_based)-->  io  @ .../openlayers/ol.js:464 [go → javascript] rowId ...:main.go:main:1:io:imports:5
main.go:main:1  --imports(0.9, import_based)-->  os  @ .github/workflows/release.yaml:15 [go → yaml] rowId ...:main.go:main:1:os:imports:6
fontawesome.js:makeIconMasking:742 --uses(0.6, usage_contextual)--> main.go:main:1  [direction caller] rowId ...:main:uses:745
   (same shape: makeIconStandard:813, asIcon:854, makeInlineSvgAbstract:903)
```

DB row detail (decisive): `main.go:main:1` is `symbol_type: module` — the **package clause** `package main`, not
`func main` (`main.go:main:20`); `src_line` 4/5/6 are the real import lines; the rows carry
`target_external: "os"` etc. **and** a `target_symbol_id`, and their stored metadata still says:

```
{"relationshipType":"go_import_spec","isGoImportDep":true,"isImport":true,"packageName":"os",
 "isStdlib":true,"evidenceClass":"import_based",
 "reasonCode":"target_is_a_module_path_not_a_symbol",
 "bindReason":"target_is_a_module_path_not_a_symbol", ...}
{"isFieldAccess":true,"receiverRoot":"_ref","evidenceClass":"usage_contextual", ...}   # the 4 JS uses rows
```

Graph door: the same `rowId …:main:uses:745` appears in `bb_graph` output as
`isCrossLanguage:true, bridgeMechanism:"name-resolution", to:"main.go:main:1", targetBasis:"symbol"`.

## 4. Ground truth: the cited lines are not imports/uses of Go symbols

| Cited location | Actual bytes | Why it is not an import/use |
|---|---|---|
| `main.go:1` | `package main` | The rows are stored on the package-clause `module` symbol (`main.go:main:1`), not `func main` (`main.go:20`). `main.go:4/5/6` are `"fmt"`, `"io"`, `"os"` inside `import ( … )` — real imports of **stdlib module paths**, which resolve to no project file. |
| `.github/workflows/release.yaml:15` | `        os:` | A GitHub-Actions **matrix key** (`matrix.os`), a YAML mapping key. Not an import site, not a symbol, not a provider of `os`. |
| `Makefile:36` | `fmt:` | A **make target** named `fmt` (`$(GOFMT) -s -w $(PACKAGES)`). No `fmt` symbol exists; it is not a package. |
| `modules/ui/ui/assets/openlayers/ol.js:464` | `function io(a){if(a.frameState){…}}` | A **minified OpenLayers function definition** named `io`. Nothing imports Go `io`; the name is local to a vendored browser bundle. |
| `fontawesome.js:745/816/856` | `main = _ref.main,` (and `:905 main = _params$icons.main,`) | **Object-property destructuring** of an icon-definition options object: `main` is a field, not the Go `main` symbol. Same file at `:742/:813/:854/:903` are `function makeIconMasking(_ref) { var children = _ref.children, … main = _ref.main, … }`. |

## 5. Expected vs observed (declared contract vs measured behavior)

**Declared (BB_CROSS_LANGUAGE.md:72-76)** — name-resolution bridging is declared *placeholder*:
> "It does not infer a bridge. `bridge` is stored data; on indexed corpora almost every row carries the
> indexer's name-resolution placeholder, so a bridge value names how the row was minted, not a verified interop
> mechanism."

→ So *existence* of name-resolution rows is **documented heuristic behavior**. The defect is not existence.

**Contradicted (GRAPH_ENGINE.md, "Semantics and invariants")**:
> "**Unresolved targets are `ext:<name>` nodes.** The name is kept — it is what the store saw — and is never
> joined back onto other symbols to manufacture an edge; `ext:` nodes are leaves."

→ The Go import targets were external/unresolved (`isStdlib:true`, `target_is_a_module_path_not_a_symbol`) yet
were joined back onto YAML/Make/JS symbols to manufacture edges, and the graph door now reports
`targetBasis:"symbol"` because `target_symbol_id` is set (`schema-ddl.ts:118-126` computes `target_basis` as
`symbol` first). Observed: exactly the manufactured edge the invariant forbids.

**Contradicted (analysis-exclusions.ts:96-124)**:
> "A YAML mapping key, a Markdown heading, a JSON property and a CSS selector have no callers and never will …
> These files are NOT excluded from the index … Only their individual symbols stop being code-rule candidates."

→ Those very symbols are used as `imports`/`calls`/`extends` targets; `NON_CODE_LANGUAGES` is consumed by
orphans/anti-patterns/search/impact (`src/intelligence/patterns/orphans.ts:29`, `rules.ts:27`,
`src/lsp/impact.ts:116`, search modules) but **not** by the resolution pass, the cross-language marker, or the
cross-language read surface.

**Contradicted (evidence_tier.ts:48-61/156-171)** — the tier rule is a function of *relationship kind*, never of
*binding quality*: `imports → import_based` (line 167), and a stored `evidenceClass` wins (line 163), so a
collision binding renders at the legend's second-strongest tier. The module's own header quotes TIER_MEANINGS
("a guess … treat as a hint, never as fact") for `inferred`; a name-resolution binding should not be
distinguishable from a real import/structural edge at the read surface — and it is not.

**Observed confidence semantics** — `0.9` is the *Go import row's* confidence in "this file imports this module
path", and `0.6` is the *JS analyzer's* confidence in "this expression uses a name `main`". Neither is evidence
for the cross-language binding, which has none. No field of `CrossLanguageAgentFact`
(`src/lsp/cross_language_hover.ts:191-238`) publishes the binding basis, so the number reads as confidence in
the cross-language relation.

## 6. Root cause (file:line in `src/` + quoted code)

The chain is four passes; each is individually declared, the composition is not.

**(1) The analyzer honestly emits an external target.** `src/ast/real-go-analyzer.ts:153`:
```ts
  // The target is an import PATH (`net/http`, `encoding/json`), which names a
  // module and not any symbol this analyzer can bind.
  "imports|*": "target_is_a_module_path_not_a_symbol",
```
and the emitted row (`:716-736`) carries `isGoImportDep:true, isImport:true, isStdlib:true` + `bindReason`
(confirmed in the stored metadata quoted in §3). The JS analyzer emits the four `uses` rows with
`isFieldAccess:true, receiverRoot:"_ref"` and `target_external:"main"` — a bare property name.

**(2) The eager per-edge resolve binds that bare name project-wide with no gate.** `src/ast/parallel-indexer.ts:3863-3872`:
```ts
  const resolveTargetStmt = rawDb.prepare(
    `SELECT s.id, s.file_id, f.language FROM brain_symbol s
     LEFT JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.name = ?
     ORDER BY COALESCE(s.is_declaration, 0) ASC, (s.file_id = ?) DESC, (f.language = ?) DESC, s.id
     LIMIT 1`
  )
```
used at `:5409-5411` for every non-`contains` row: `((resolveTargetStmt.get(projectId, targetName, fileId, fileLang) ?? resolveTargetStmt.get(projectId, targetLeaf, fileId, fileLang)) as any)`. Preference is declaration → same file → same language → **lowest id, any language**. There is no "is the target declared external?" test, no non-code-language test, and no language-pair plausibility test. The file's own M49 #816 comment (`:3834-3845`) records this same failure class for a different row type: *"`greet --uses--> name` … both resolved to the `name` KEY OF package.json, and were then stamped is_cross_language=1 with bridge mechanism `name-resolution`"* — the fix made ranking deterministic and proximity-ordered, it did not refuse the cross-language fallback.

**(3) The deferred pass makes "any language" an explicit plan step.** `src/ast/parallel-indexer.ts:6634-6642`:
```sql
      CREATE TEMP TABLE _i13_best_any AS
      SELECT s.name AS name, MIN(s.id) AS symbol_id
      FROM brain_symbol s
      JOIN _i13_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
      WHERE s.project_id = '${projectId}'
      GROUP BY s.name
```
and `:6656-6666`:
```sql
      CREATE TEMP TABLE _i13_pick AS
      SELECT t.rel_id AS rel_id,
             COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) AS target_symbol_id
      FROM _i13_src t
      JOIN brain_relationship r ON r.id = t.rel_id
      LEFT JOIN _i13_best_file bf ON bf.name = r.target_external AND bf.file_id = t.src_file
      LEFT JOIN _i13_best_lang bl ON bl.name = r.target_external AND bl.lang = t.src_lang
      LEFT JOIN _i13_best_any  ba ON ba.name = r.target_external
      WHERE r.project_id = '${projectId}'
        AND r.target_external IS NOT NULL AND r.relationship_type <> 'contains'
        AND instr(r.target_external, '.') = 0 AND instr(r.target_external, ':') = 0
```
`_i13_best_any` is the cross-language binding path: `COALESCE(file, language, ANY)`. `os`, `fmt`, `io`, `main`
are bare names (no `.`, no `:`), so they reach it; 3 of the 11 Go imports in `main.go` collide with a symbol
somewhere (the other 8 stay honest `NULL`), which is why this is a **collision lottery** rather than a uniform
failure.

**(4) The cross-language marker certifies the binding (upgrade-only).** `src/ast/parallel-indexer.ts:5876-5904`
(duplicated at `:6749-6777`):
```sql
           UPDATE brain_relationship
           SET is_cross_language = CASE WHEN EXISTS (
             SELECT 1 FROM brain_symbol ss … JOIN brain_symbol ts ON ts.id = brain_relationship.target_symbol_id
             … AND lower(sf.language) <> lower(tf.language)
           ) THEN 1 ELSE brain_relationship.is_cross_language END,
           bridge_mechanism = COALESCE(brain_relationship.bridge_mechanism,
             CASE WHEN EXISTS ( … languages differ … ) THEN 'name-resolution' ELSE NULL END)
```
The predicate is *"the two endpoint files' languages differ"* — which is **guaranteed true** for a mis-binding,
so the marker cannot distinguish a real bridge from a collision. Its comment states the posture: *"UPGRADE-ONLY
(a row the analyzer declared cross-language stays 1; a computed-0 row never downgrades)"* — precision is never
re-examined, only language difference.

**(5) The read surface is faithful to the row and therefore repeats the label.** `src/lsp/cross_language_hover.ts:485-512`
(`factFromRow`) publishes `bridge: row.bridge_mechanism ?? UNNAMED_BRIDGE` (line 496), `tier:
tierForCrossLanguageEdge(...)` (497-501 → `src/lsp/evidence_tier.ts:156-171`, `imports → import_based` at line
167), and `confidence: row.confidence ?? 0` (line 502); `rowId` is the stored row. There is no `targetBasis` /
binding-basis field, no candidate flag, and no non-code-target filter. So the read tool is *correct by its own
docs* ("stored rows, never inferences") and simultaneously over-confident, because the store labels the row.

## 7. Generality

Fixture plan: the sandbox blocks `bb index` of a new directory (`ENOENT … mkdir '/home/ishaq2321/.bb/projects/<hash>'`)
and `/tmp` is per-call ephemeral in this environment (Lead-provided env fact), so the fresh tiny-polyglot fixture
could not be indexed by this lane. Generality was established from two existing indexes instead.

| language pair | project | repro | same class? | evidence |
|---|---|---|---|---|
| go → yaml (`imports` 0.9) | bettercap | `main.go:main:1 imports os → release.yaml:15`; `bb_cross_language main` fact 3 | **YES** | `probe-a-main-bettercap.json`, `db-main-cross-full.json` |
| go → make (`imports` 0.9) | bettercap | `fmt @ Makefile:36` | **YES** | same |
| go → javascript (`imports` 0.9) | bettercap | `io @ ol.js:464` | **YES** | same |
| javascript → go (`uses` 0.6) | bettercap | 4 FontAwesome destructuring rows into `main.go:main:1` | **YES** | `db-main-cross-full.json`, `probe-graph-js-uses-full.json` |
| typescript → json (`calls` 0.9, `references` 0.95) | backbencher-brain workspace | 3,209 `calls` + 2,340 `references` rows; e.g. `trim @ script/m45/storyboard.json:23` (a JSON **key**), `Error @ validation/m14/instruments/ruby/incoming-declaration.json:382` (`extends`, conf **1.0**, `structural`) | **YES** | `ws-cross-external-bound.json`, `ws-cross-sample-durable.json`; MCP `bb_cross_language {"symbol":"main"}` → 1,509 facts |
| typescript → markdown (`calls` 0.9, `instantiates` 1.0) | backbencher-brain workspace | 1,569 `calls`; `Number @ docs/analyzers/css.md:1696` (a markdown table header), `Position @ docs/analyzers/dart.md:181` (conf 1.0, `structural`) | **YES** | `ws-cross-sample-durable.json` |
| graphql → typescript (`references`) | backbencher-brain workspace | 4,034 rows | **MIXED / not claimed** — this pair can be genuine (schema→codegen); needs positive control before any filter lands | `ws-cross-external-bound.json` |
| go → yaml/make/js | `.corpus/consul`, `.corpus/vault`, `.corpus/nomad` | corpus subtree: 27,044 files, 116,191 symbols, 351,414 source rels, **0 marked cross-language**, 120,740 unbound. Cannot reproduce in this index (corpora were stored without the marking pass / a re-resolve); a fresh corpus index is blocked. | **CANNOT-VERIFY (blocked)** | `ws-corpus-status.json`, `ws-cross-corpus.json` |
| js ↔ css/json | `.corpus/*` | same as above | **CANNOT-VERIFY (blocked)** | same |
| fresh polyglot fixture (`/tmp`) | — | `bb index <new dir>` blocked by sandbox (no mkdir under `~/.bb/projects`); `/tmp` per-call ephemeral | **BLOCKED** | Lead env facts; not re-attempted |

Mechanism generality: the defect is **indexer-wide, not Go-specific** — the binding ranking (`_i13_best_any`) and
the marker (`languages differ ⇒ cross-language`) are language-agnostic; any analyzer that publishes a bare
external name (Go stdlib import, JS/TS property/local/global, Python module, …) can be rebound to any symbol of
that name in any language. The two corpora measured show it on Go→YAML/Make/JS-asset and TS→JSON/Markdown.

## 8. Quantification (so a fix can be sized)

**bettercap** (`db-totals.json`, `db-cross-pairs.json`, `db-cross-external-bound.json`, `db-cross-assets.json`,
`db-cross-hubs.json`, `db-cross-impossible.json`):
- 111,408 stored relationship rows; **2,423 cross-language rows**;
  **2,423/2,423 (100 %) carry `bridge_mechanism='name-resolution'`**;
- by type: `imports` 334 (all 0.9), `uses` 913 (0.7/0.6), `references` 611, `calls` 554, `instantiates` 8,
  `part_of` 3 (aggregate matches Lead's independent count);
- **≥1,048 rows (43 %) sit in structurally-impossible pairs** for the relation (e.g. `js → yaml calls` 330,
  `js → yaml uses` 291, `go → make imports` 170, `go → yaml imports` 138, `js → xml uses` 58, `go → javascript
  imports` 26) — a *lower bound*, not the false share;
- **1,558 rows (64 %) have an endpoint under `/assets/`** (vendored minified bundles); hub targets are minified/
  generic identifiers (`T` 521, `push` 266, `fmt` 170, `map` 115, `B` 87, `N` 85, `sync` 69);
- `main.go` shows the lottery cleanly: 11 `imports` rows at 0.9, exactly **3 rebound cross-language** (fmt/io/os),
  8 left `NULL`.

**workspace project** (`ws-cross-external-bound.json`, `ws-cross-sample-durable.json`): **15,836 cross-language
rows**; largest pairs `graphql → typescript references` 4,034, `typescript → json calls` 3,209,
`typescript → json references` 2,340, `typescript → markdown calls` 1,569. The name `main` alone has **1,509
cross-language facts** (1,477 on the symbol + 32 on members). Rows at confidence **1.0** with stored
`evidenceClass:"structural"` target JSON/Markdown keys: e.g. `GateLockError --extends--> Error @
validation/m14/instruments/ruby/incoming-declaration.json:382`, `Arm --contains--> exports @
docs/analyzers/csharp.md:1416`.

**Same stored rows the other tools consume?** Yes for `bb_graph`: the exact `rowId
…:fontawesome.js:makeIconMasking:742:main:uses:745` is returned by `bb_graph` with `isCrossLanguage:true`,
`bridgeMechanism:"name-resolution"`, `to:"main.go:main:1"`, `targetBasis:"symbol"`. `bb_impact` defaults to
`calls, instantiates, extends, implements` (`bb_impact` rule echo), so the 7 rows on `main` (imports/uses) do
not reach impact *by default*; the same class does (the workspace `extends`/`instantiates` rows at 1.0) and
impact will include these rows when `relationshipTypes` is overridden. One surface divergence worth knowing:
`bb_graph main` resolves the root to `main.go:main:20` (`func main`), so it shows **none** of the 7 rows that
`bb_cross_language main` shows (they hang off the non-traversable `module` symbol `main.go:main:1`), while
`bb_cross_language` unions over all 4 copies — the two doors read the same table but answer different
questions.

## 9. Fix sketch (implementation-ready, write-side first)

**A. Refuse the binding (indexer, `src/ast/parallel-indexer.ts` + `src/ast/analysis-exclusions.ts`).**
1. Add a shared predicate `isNonCodeTargetLanguage(lang)` (reuse `NON_CODE_LANGUAGES`, the ONE definition) and
   apply it to the candidate side of `resolveTargetStmt` and to `_i13_best_any`/`_i13_best_lang`: for
   code-relation types (`calls`, `uses`, `references`, `instantiates`, `extends`, `implements`, `imports`,
   `overrides`, `renders`, `decorates`, `mixes_in`, `exports`) do not bind a target whose file language is a
   structural-key language. (A Markdown/JSON/YAML key is never a call target — the repo already declares this.)
2. Honor the row's own external claim: skip binding when `json_extract(metadata,'$.isStdlib') = 1` or
   `json_extract(metadata,'$.isExternalTarget') = 1`, or `bindReason`/`reasonCode` is
   `target_is_a_module_path_not_a_symbol`, or the relation is `imports` and the target is a module path
   (`isImport|isGoImportDep`), or `metadata.isFieldAccess = 1` and the receiver root does not resolve to a
   project symbol. Leave `target_symbol_id NULL` — honest unresolved, exactly what GRAPH_ENGINE.md promises.
3. Make the cross-language marker evidence-bearing: do not set `is_cross_language = 1` for a row whose only
   basis is a name-resolution binding. Either require an analyzer-declared bridge mechanism (FFI/wasm/http/
   codegen/`bridgeMechanism` in analyzer metadata) for a cross-language *fact*, or keep the row but store
   `metadata.bindingBasis = 'name-only'`, `confidence = MIN(confidence, 0.5)`, `evidenceClass = 'inferred'` so
   it can never render `import_based`/`structural`. Add a `binding_basis` column (generated, no reindex needed
   for reads to be honest) or a `targetBasis`-equivalent exposed in the fact.
4. Fix `target_basis` for bound-from-external rows: `schema-ddl.ts:118-126` returns `symbol` whenever
   `target_symbol_id IS NOT NULL`; prefer the external claim (`'external'`/`'unresolved'`) when the row's own
   metadata declares it, so graph edges stop laundering the basis.

**B. Read-surface honesty (defence in depth; `src/lsp/cross_language_hover.ts`, `src/lsp/evidence_tier.ts`).**
5. Add `targetBasis`/`candidate` to `CrossLanguageAgentFact`; render name-resolution-only facts as
   `tier: inferred` (or a declared `candidate` flag) in both hover and tool output. Optionally filter non-code
   targets for code-relation types at the read surface too (same predicate, no second rule — import it).
6. Update `docs/BB_CROSS_LANGUAGE.md` to publish the precision model it already implies: rows whose bridge is
   the indexer's `name-resolution` placeholder are **candidates**, their confidence is the original edge's
   confidence, and their target may be a name collision. Keep "stored rows, never inferences" — add the
   candidate declaration beside it.

**Blast radius.** The resolution pass is shared by every language analyzer and by `bb_graph`/`bb_impact`/hover,
so the gate must include positive controls: genuine `graphql → typescript` codegen references, a real
`ts → js` import, a same-language call — none may be lost. Existing indexes need a re-resolve/reindex for the
stored rows to change (documented, not silent). No schema change is required for A.1-A.2.

## 10. Gate proposal (what would have caught it)

1. **Precision fixture gate** (`script/…/verify-cross-language-precision.ts`, in-repo fixture, no CLI new-dir
   index): Go `package main; import ("fmt";"io";"os")`; `release.yaml` with `os:`; `Makefile` with `fmt:`;
   `ol.js` with `function io(a){}` and `var main = _ref.main`; plus one genuine positive control (a TS import
   of a JS module). Assert: (a) `is_cross_language=1` count for the collision rows is **0**; (b) `target_symbol_id`
   is NULL for the three stdlib imports; (c) the genuine control is still marked with its mechanism; (d)
   `bb_cross_language main` returns `declaredAbsent:true` (or no facts naming yaml/make/js); (e) `bb_graph` shows
   `ext:os`/`ext:fmt`/`ext:io` unresolved leaves.
2. **Mutation gate** on `_i13_pick`: seed a row with `metadata {"isStdlib":true}`, `target_external "os"`, and a
   symbol `os` in `x.yaml`; run the resolution pass; assert the target stays NULL and `is_cross_language` 0.
   (Mirror the existing mutation-suite style: the gate must FAIL against the pre-fix code — include the pre-fix
   plan as the negative control, as `script/m65/verify-graph-plan.ts` already does for plans.)
3. **Corpus sweep**: zero rows with `relationship_type IN (...) AND tf.language IN NON_CODE_LANGUAGES` (with an
   explicit declared allowance list if any pair is real). Run on bettercap + the workspace project; publish the
   count as a measurement record, not a gate, until precision is understood.
4. **Read-surface parity gate**: for every stored cross-language row returned by `bb_cross_language`, the fact
   must carry `targetBasis`; a `name-resolution`-only row must not render `import_based`/`structural` unless a
   mechanism is stored.

## 11. Evidence paths (all under `docs/bb-bettercap-triage/evidence/cross-lang/`)

`probe-a-main-bettercap.json` (the 7 facts) · `db-main-cross-narrow.json`, `db-main-cross-full.json` (stored
rows + full metadata) · `db-main-copies.json` (4 copies; `main.go:main:1` is `module`) · `db-maingo-all-rows.json`
(44 rows from main symbols; 11 imports, 3 rebound) · `db-totals.json` · `db-cross-pairs.json` ·
`db-cross-external-bound.json` · `db-cross-assets.json` · `db-cross-hubs.json` · `db-cross-impossible.json` ·
`probe-graph-main.json` · `probe-graph-js-uses-full.json` (same rowId through the graph door) ·
`probe-impact-js.json` · `ws-cross-external-bound.json` · `ws-cross-sample-durable.json` ·
`ws-corpus-status.json`, `ws-cross-corpus.json` · scripts `inspect-db.cjs`, `q2.cjs`, `q3.cjs`, `q4.cjs`, `q5.cjs`.

## 12. Verdict breakdown and open items

- **REAL sub-claims:** all 7 rows, names, files, lines, confidences (0.9/0.6), relationship types and the 4-copy
  ambiguity reproduce exactly on bettercap at HEAD. The mechanism is live and systemic.
- **Misdescribed (why not plain REAL):** (a) `direction: callee` means *the asked symbol is the SOURCE of the
  stored row* (the edge points out to `other`) — for the three imports the row's target is the bare stdlib
  specifier, rebound to a collision victim, so "`main` imports `os` **from** release.yaml:15" describes a
  meaningless bridge and misplaces the line's role; (b) the rows hang off the **package-clause** `module`
  symbol `main.go:main:1`, not `func main` (`main.go:20`); (c) `0.9` is the original Go import's confidence and
  `0.6` the JS analyzer's use-name confidence — neither measures the cross-language relation, and no fact field
  publishes that; (d) "unchanged" understates scope: 100 % of bettercap's 2,423 cross rows are
  name-resolution-only, and the workspace project carries 15,836 with the same class at 0.9–1.0/`structural`.
- **Declared-heuristic boundary:** existence of `name-resolution` rows *is* documented as a placeholder
  (BB_CROSS_LANGUAGE.md:72-76); what is **not** declared — and is contradicted by GRAPH_ENGINE.md:155-158,
  analysis-exclusions.ts:96-124 and the tier rule — is presenting a collision binding at `import_based`/
  `structural` with 0.9/1.0 confidence, and joining an analyzer-declared external target back onto a project
  symbol.
- **OPEN / CANNOT-VERIFY:** fresh polyglot fixture (sandbox blocks `bb index` of a new dir; `/tmp` ephemeral);
  `.corpus` corpora (0 cross rows in the existing index — needs a fresh corpus index or a re-resolve to test);
  exact JS analyzer source line that emits `isFieldAccess` `uses` rows (DB metadata proves the emitter's
  declaration; the analyzer line was not pinned); the true precision share of the 2,423 rows (only the
  structurally-impossible lower bound is measured — full precision needs pair-by-pair adjudication or a
  positive-control sweep).
