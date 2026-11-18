# ISSUE-03 — Go file-dependency graph: every import external/unresolved, zero internal dependents

- **Lane:** `go-imports` · **Task:** task-3 · **Product:** `backbencher-brain` HEAD `be4c0ef25` · **bb:** 0.1.6
- **Date:** 2026-11-18 · **Specimen:** `/home/ishaq2321/bettercap` (projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`, 1972 files / 55,785 symbols)
- **Read-only campaign:** no source edits, no reindex of bettercap, no writes to bettercap.

## Verdict

**REAL** — the Go file-dependency graph is structurally empty: every Go specifier is stored/emitted `external:true` + `resolution:"unresolved"`, so no intra-module dependency or dependent edge exists for any Go file. One sub-claim is **REAL-BUT-MISDESCRIBED** (details under adjudication): `unresolvedSpecifiers: 0` is not a self-contradiction — the field is documented as *internal*-only and its 0 is arithmetically consistent with the (wrong) all-external classification; it is a symptom, not an independent contradiction.

**Severity: high.** For a Go project the tool's headline answer — "no internal file coupling" — is a false negative on (measured) 326 same-module import specifiers in bettercap, 0 of which resolve. Every downstream consumer of this graph (dependency overview, coupling/score, edit-impact intuition) reads a Go project as 100 % external. Two other real Go repositories reproduce it.

**Confidence:** high for the defect + root cause (source quote + stored rows); medium for the *ideal* fix shape (package-directory semantics need a product decision).

## Reproduce (exact, bounded)

```bash
cd /home/ishaq2321/mcp/backbencher-brain
# A. the reported page (26 files under session/, 20 returned)
node bin/bb tool bb_analyze --dir /home/ishaq2321/bettercap \
  --args '{"mode":"dependencies","filePath":"session"}'            # -> 23,657 B, exit 0
# B. Lead's single-file corroboration (main.go: 11 imports, 4 same-module)
node bin/bb tool bb_analyze --dir /home/ishaq2321/bettercap \
  --args '{"mode":"dependencies","filePath":"main.go"}'
# C. same class on 2 other real Go repos (existing indexes; no new index created)
node bin/bb tool bb_analyze --dir /home/ishaq2321/bb_tests/repositories/gh-cli/internal \
  --args '{"mode":"dependencies","limit":20}'
node bin/bb tool bb_analyze --dir /home/ishaq2321/bb_tests/repositories/gql-gqlgen/graphql \
  --args '{"mode":"dependencies","limit":20}'
# D. stored-row ground truth (read-only)
sqlite3 -readonly /home/ishaq2321/.bb/projects/4c7590f1cba319aac298a50453c0ec440f2dc857/brain.db \
  "SELECT COUNT(*), SUM(is_external=1), SUM(resolved_symbol_id IS NOT NULL) FROM brain_import;"
```

Bounded observed output (A; full JSON in evidence):

```
summary: returned 20, totalFiles 26, truncated true,
         returnedInternalDependencies 0, returnedInternalDependents 0, pageLimit 20
row session/command_handler_test.go: deps [testing (external:true, unresolved)], dependents [], score 0, unresolvedSpecifiers 0
row session/session_json.go:        8 deps — encoding/json, net, runtime, time,
         github.com/bettercap/bettercap/v2/{caplets,core,network,packets}
         ALL external:true resolution:"unresolved"; dependents []; score 0; unresolvedSpecifiers 0
rows: 20/20 have dependents:[], dependentsTotal:0, unresolvedSpecifiers:0, score 0
deps on page: 115 -> external:true 115, resolution:"unresolved" 115, resolved 0
```

Page classification of the 115 returned specifiers (ground truth from A): **78 stdlib, 12 same-module (`github.com/bettercap/bettercap/v2/...`), 25 third-party**.

Corroboration (Lead): `filePath=main.go` → 11/11 imports external+unresolved incl. same-module `core/log/modules/session`; `returnedInternalDependencies:0`, `returnedInternalDependents:0`, `dependentsTotal:0` (`evidence/lead/issue03-deps-maiNgo.json`).

## Expected vs observed

Ground truth — `/home/ishaq2321/bettercap/go.mod:1` = `module github.com/bettercap/bettercap/v2`; `main.go:3-20` imports 5 stdlib (`fmt io os strings runtime`), 4 same-module (`.../v2/{core,log,modules,session}`), 2 third-party (`github.com/evilsocket/islazy/{str,tui}`); `session/session.go:3-31` imports 10 stdlib, 6 same-module (`.../v2/{caplets,core,firewall,log,network,packets}`), 8 third-party (`github.com/bettercap/readline`, `github.com/evilsocket/islazy/*`).

| Aspect | Expected (documented contract) | Observed |
|---|---|---|
| same-module import (`.../v2/session`) | `external:false`, `resolution:"resolved"`, target path `session/…`, importer listed as dependent | `external:true`, `resolution:"unresolved"`, no target path |
| stdlib import (`fmt`) | external (stdlib is outside the project) but labelled as external/dependency, not "unresolved internal specifier" | `external:true` + `resolution:"unresolved"` (resolution was never attempted) |
| third-party (`github.com/evilsocket/islazy/str`) | external | external (coincidentally right) |
| file `dependents` for a Go package a file imports | non-empty | `dependents:[]`, `dependentsTotal:0` (every row) |
| page summary | internal dependencies > 0 on a real Go project | `returnedInternalDependencies:0` on every page (session 0, modules 0, project 0, gh-cli 0, gqlgen 0) |
| `unresolvedSpecifiers` (documented: "*Internal* specifiers…") | >0 only for internal specifiers that fail to resolve | 0 on all rows — consistent with its internal-only denominator **because** everything is misclassified external |

DB ground truth (bettercap, `evidence/go-imports/db-queries.txt`): 1972 files / **369 Go files**; `brain_import` **1,948 rows**, `is_external=1` on **1,947** (the 1 internal row is `modules/ui/ui/index.html → /assets/images/logo.png`); Go rows **1,880 across 346 files, 1,880 external, 0 internal, `resolved_symbol_id` non-null on 0 rows**; Go specifier split **326 same-module / 1,105 stdlib / 449 third-party**; `imports` relationships **1,908** (target symbol non-null 358, target null 1,550) — **0 have a same-module target** and **0 target a file under `session/`**.

## Root cause (file:line + quoted code, HEAD be4c0ef25)

The defect is a three-link chain; all three links must be fixed for a Go project to get an internal edge.

**Link 1 — the store applies a JS/TS "bare specifier = external" idiom to a lane that never declares `isExternal`.** Go's analyzer publishes no `isExternal`/`isSystemInclude` and has no same-module concept (it only knows stdlib-vs-third-party, and its "third-party" test is true for the project's own module path):

```ts
// src/ast/real-go-analyzer.ts:5586-5599
imports.push({
  module: importPath, isDefault: false, alias, items: [packageName],
  range: this.nodeToRange(spec),
  metadata: {
    isGoImport: true, packageName, framework,
    isStandardLibrary: this.isGoStandardLibrary(importPath),
    isThirdParty: this.isGoThirdPartyPackage(importPath),
  },
})
// src/ast/real-go-analyzer.ts:6188-6190
private isGoThirdPartyPackage(importPath: string): boolean {
  return stringIncludes(importPath, ".") && !this.isGoStandardLibrary(importPath)
}
```

```ts
// src/ast/pool-worker.ts:1929-1937 — the fallback that decides every undeclared lane
const declared = (i.metadata ?? {}) as Record<string, any>
const external =
  declared.isSystemInclude === true || declared.isExternal === true || i.isExternal === true
    ? true
    : declared.isSystemInclude === false || declared.isExternal === false
      ? false
      : typeof i.module === "string"
        ? !i.module.startsWith(".") && !i.module.startsWith("/")
        : !!i.isExternal
```

Every Go specifier (`fmt`, `github.com/bettercap/bettercap/v2/session`) starts with neither `.` nor `/` → `external = true`; `parallel-indexer.ts:5091-5092` stores that as `brain_import.is_external = 1` (verified 1,880/1,880). This is why it is *not* a generic all-language defect: js/ts specifiers are relative (`./x` → internal), and c/cpp/clojure declare `isSystemInclude`/`isExternal` and bypass the fallback. It is a **Go-analyzer-specific missing declaration** amplified by a **shared JS-shaped default**.

**Link 2 — the dependency engine trusts that flag and never attempts resolution for an external row**, so `resolution` is the untouched default `"unresolved"` and the only code that populates reverse edges never runs:

```ts
// src/intelligence/analysis/dependencies.ts:273-288
for (const imp of allImports) {
  const external = !!imp.isExternal
  if (external && !includeExternal) continue
  let targetFileId: string | undefined
  let resolution: Resolution = "unresolved"
  if (!external) {
    const resolved = resolveInternalSpecifier(fileById.get(imp.fileId) ?? "", imp.importPath, filesByPath)
    resolution = resolved.resolution
    targetFileId = resolved.fileId === imp.fileId ? undefined : resolved.fileId
    if (targetFileId) {
      if (!dependentsByFile.has(targetFileId)) dependentsByFile.set(targetFileId, new Set())
      dependentsByFile.get(targetFileId)!.add(imp.fileId)
      ...
```

`dependents:[]` is therefore **not** from a resolution-independent reverse query: `dependentsByFile` is written only (a) in the resolved branch above and (b) from the symbol-edge pass (`dependencies.ts:246-257`), which for Go has nothing usable (Link 3). The "internal" counters inherit the same flag: `dependencies.ts:322-323` (`internalDeps = …!d.external…`, `unresolved = …d.resolution==="unresolved" && !d.external…`) and `handler.ts:414-418` (`returnedInternalDependencies: …filter(x => !x.external)`) — so 0 is downstream, not independent evidence.

**Link 3 — nothing in the indexer or the dependency engine knows a Go module path, so even a correctly-classified `external:false` Go row still could not resolve.** `resolveInternalSpecifier` (`dependencies.ts:95-128`) understands only `./`, `../`, `/` and a project-relative suffix match; `github.com/bettercap/bettercap/v2/session` matches no `brain_file` path. The index-time resolver is a no-op for Go by construction:

```ts
// src/ast/import-resolution.ts:333-337
export function splitImportTarget(targetExternal: string): { path: string; item: string } | null {
  const i = targetExternal.lastIndexOf(":")
  if (i <= 0 || i === targetExternal.length - 1) return null
  return { path: targetExternal.slice(0, i), item: targetExternal.slice(i + 1) }
}
// its row query (import-resolution.ts:621-624) only loads targets containing ':'
WHERE r.project_id = ? AND r.relationship_type = 'imports'
  AND r.target_external IS NOT NULL AND instr(r.target_external, ':') > 0
```

Go's `target_external` is the bare module path (`real-go-analyzer.ts:700-701`: `source: packageName || filePath, target: imp.module || ""`), so every Go import edge is invisible to the only import-target resolver. `grep go.mod src/` finds readers only in the migration assistant (`cross-language-migration-assistant.ts:2013-2041`, `ProjectSelfImport.goModule`) — none in the AST indexer or dependency engine. Consequence at symbol layer: 1,550 of 1,908 Go import edges have `target_symbol_id` NULL; the 358 that do are **false leaf-name collisions** (334 point into `Makefile` (170), `fontawesome/metadata/icons.yml` (94), `.github/workflows/release.yaml` (44), `openlayers/ol.js` (26) — the ISSUE-02 cross-language defect; 20 collide with `log`/`context`/`path` symbols in 3 Go files). **0 same-module edges resolve.**

**Adjudication of the reported "new contradiction":** `unresolvedSpecifiers` is documented as *internal*-only (`src/intelligence/contracts.ts:622-625`: "Internal specifiers this file wrote that resolve to no indexed file") and computed as `resolution === "unresolved" && !d.external`. Given the misclassification, 0 is the arithmetically correct value of its own narrow denominator — so this is **REAL-BUT-MISDESCRIBED**, not a separate contradiction. The *real* honesty gap it points at: a per-dependency `resolution:"unresolved"` is emitted for rows whose resolution was never attempted (the default at `dependencies.ts:277`), so "unresolved" conflates "we tried and failed" with "external, we didn't try", and the page carries no signal that 100 % of a project's imports were classified external.

## Generality table

| language | project | repro | same class? | evidence |
|---|---|---|---|---|
| Go | bettercap (1972 files; 369 .go, 1,880 import rows) | `dependencies filePath=session` / `main.go` | **YES** (all ext+unresolved, 0 internal, 0 dependents) | `deps-session-raw.json`, `deps-modules-raw.json`, `deps-project-raw.json`, `db-queries.txt`, `evidence/lead/issue03-deps-maiNgo.json` |
| Go | gh-cli `internal/` (145 files; parent `go.mod` module `github.com/cli/cli/v2`, 103 same-module imports on disk) | `dependencies` project-wide (CLI) | **YES** — 122/122 deps external+unresolved, `returnedInternalDependencies:0`; same-module specs present in page (`github.com/cli/cli/v2/internal/text`, `/api`, `/pkg/httpmock`) | `deps-ghcli-internal-raw.json` |
| Go | gql-gqlgen `graphql/` (161 files; `go.mod` module `github.com/99designs/gqlgen`) | `dependencies` project-wide (CLI) | **YES** — 67/67 external+unresolved, internal 0 | `deps-gqlgen-graphql-raw.json` |
| JS | `.corpus/axios/lib` (74 in scope) | MCP `dependencies filePath=".corpus/axios/lib" limit=5` | **NO** — 42 internal deps resolved, 120 internal dependents, relative specs `resolution:"resolved"`; internal-unresolved row correctly reports `unresolvedSpecifiers:1` (`../env/data.js`) | `mcp-workspace-language-comparison.txt` |
| TS | workspace `src/intelligence/analysis` (6 files) | MCP `dependencies filePath="src/intelligence/analysis" limit=25` | **NO** — 24 internal deps resolved, 40 internal dependents, `node:crypto` external | `mcp-workspace-language-comparison.txt` |
| Python | workspace `script/**` (50 files, 159 import rows) | stored classification census | **CANNOT-VERIFY empirically** — population has only stdlib/third-party imports (159/159 external, 0 same-project), so no failing case exists to test; code path is the shared fallback above. Fixture indexing blocked in sandbox (bb index cannot mkdir `~/.bb/projects`). | `mcp-workspace-language-comparison.txt` |
| Java | workspace (10 files, 4 import rows) | stored classification census | **CANNOT-VERIFY empirically** — only third-party imports (spring/javax). Same predicted mechanism (`com.demo.Util` would be external), not asserted. | `mcp-workspace-language-comparison.txt` |
| Go | `.corpus/` Go repos (consul/nomad/vault) | — | **OPEN** — not indexed in the workspace project (corpus index is `partial`: only 9/22 repos; consul/nomad/vault absent), so the Lead-suggested MCP route was not usable; replaced by the 2 real Go indexes above. | `mcp-workspace-language-comparison.txt` |
| adjacent tool | bettercap Go module symbol (`session` in `session/session.go:1`) | `bb_graph symbol=session file=session/session.go direction=callees relationshipTypes=[imports]` | **Consistently wrong raw data** — graph exposes 24 import edges, all `to: ext:<module path>`, `isExternal:true`, including 6 same-module (`github.com/bettercap/bettercap/v2/{caplets,core,firewall,log,network,packets}`). `bb_visualize` not re-probed (OPEN; no separate mode warrants re-deriving — it reads the same stored rows). | `graph-module-symbol-imports.json`, `graph-session-session-json.json` |

## Blast radius

- bettercap: **369 Go files; 346 with imports; 1,880 import rows all `is_external=1`**; **326 same-module specifiers, 0 resolved**; `session/` = 26 files / 160 import rows, all external (page: 78 stdlib, 12 same-module, 25 third-party). **0 import edges target any file under `session/`** → every session file's dependents list is empty.
- Project-wide `dependencies` page ranks non-Go assets first (`Makefile`, `icons.yml`, `release.yaml`, `ol.js`) because the only *usable* import edges (354 of 1,908) are almost all bogus leaf-name edges (334 → non-Go files, 20 → 3 Go files); `returnedInternalDependents:275` is therefore mostly noise, and `returnedInternalDependencies:0` is the real measurement.
- Cross-repo: gh-cli/internal (122 deps, internal 0) and gqlgen/graphql (67 deps, internal 0) reproduce. Any Go project indexed by bb that uses module-internal imports is affected; that is the normal layout of every Go repo.
- `returnedInternalDependencies` **is emitted** (handler.ts:414-417) — on every dependencies page, always 0 for Go.

## Fix sketch (implementation-ready)

Two layers; each is independently testable, and Link 3 is required for the edge to appear.

1. **Store the project's Go module identity at index time** (prerequisite). When indexing a project whose root (or an ancestor up to the project root) contains `go.mod`, read the `module <path>` line once and persist it (project metadata table/column, or a `brain_project` metadata key) together with the project root's module-relative dir. `src/ast/parallel-indexer.ts` already has project root context; add a single `readGoModulePath(projectRoot)` helper (bounded read, first `module` line, cache per project). Mirror on the read side in `src/intelligence/analysis/dependencies.ts`.
2. **Fix classification (Link 1).** In `real-go-analyzer.ts` `processGoImportSpec`, compute and publish `isExternal` explicitly for Go: `false` when the specifier equals the module path or starts with `modulePath + "/"`; `true` for stdlib (existing `isGoStandardLibrary`) and third-party. Plumb `isExternal` into `ImportInfo` (the field `pool-worker.ts:1931` already reads) or into `metadata.isExternal` that `pool-worker.ts:1930-1937` already prefers — no new external semantics, just declare what Go knows. Requires the analyzer to receive the module path (add to analyzer context options; the analyzer is per-file so this must be threaded from the indexer, not read from go.mod per file).
3. **Resolve Go module-path specifiers (Link 2+3).** In `dependencies.ts` `resolveInternalSpecifier` add a language-aware branch (importer language go + project module path): strip `modulePath` prefix → remainder is a module-relative package dir; prepend the project root's module-relative dir; resolve to **all indexed `.go` files under that directory** (a Go import names a *package*, not a file) — emit one edge per non-test file (or one representative + package-level edge, product decision; recommend all files, labelled `resolution:"resolved"`, with the package dir as the path for unresolved-decision audit). Fallback to `unresolved` when the directory is absent (e.g. vendored/generated), never guess.
4. **Make the counters honest (contract-level).** For an external specifier emit no `resolution` (or `"external"`), so `unresolved` means "attempted and failed"; keep `unresolvedSpecifiers` internal-only (its docstring already says so) and consider renaming it `unresolvedInternalSpecifiers` in the tool contract. Add a page-level signal when ≥ some share of a project's imports were classified external without a module-path rule (e.g. `classificationBasis: "specifier-shape"`), so a Go project can never again read as "no internal coupling" silently.

## Gate proposal (would have caught this)

- **New fixture gate** (`script/verify-analyze.ts` and/or `script/m13/verify-analyze-modes.ts`): a 4-file Go fixture with `go.mod` (`module example.com/m`), `a/a.go` importing `fmt` + `example.com/m/b`, `b/b.go`, and a test file; index into a temp project and assert on `bb_analyze mode=dependencies`: (i) `a` has one internal dependency whose path is `b/…` and `external:false`/`resolution:"resolved"`; (ii) `b`'s `dependents` contains `a` and `dependentsTotal ≥ 1`; (iii) `fmt` is external; (iv) `returnedInternalDependencies ≥ 1`; (v) `unresolvedSpecifiers` equals the number of internal unresolved entries. Verified absent today: same fixture would report all-external 0-internal.
- **Store-classification gate** (post-index invariant, any Go project): assert `brain_import.is_external = 0` for every row whose `import_path` equals/starts with the project's `go.mod` module path; fail with the row ids. Catches Link 1 without depending on the dependency engine.
- **Generalized regression**: run the same assertion family for any language whose analyzer declares absolute module imports (Java/C#/Python absolute) once a fixture exists — the gate should be defined on the *classification* rule, not on Go.
- **Contract test for the counter**: `dependencies` on a fixture with one relative internal import pointing at a missing file must emit `resolution:"unresolved"`, `external:false`, `unresolvedSpecifiers:1` (already true for JS; pin it for Go when the branch lands).

## Evidence paths

`docs/bb-bettercap-triage/evidence/go-imports/`
- `deps-session-raw.json` — reported page A (20/26 files; 115 deps; full rows)
- `deps-modules-raw.json` — `filePath=modules`, limit 50 (50/1812 files; 274 deps)
- `deps-project-raw.json` — project-wide, limit 20 (20/1972; 275 internal dependents, all from false edges)
- `deps-ghcli-internal-raw.json`, `deps-gqlgen-graphql-raw.json` — Go cross-repo reproduction
- `db-queries.txt` — read-only sqlite3 quantification (file/lang counts, is_external split, same-module count, resolved edges, false-target breakdown, session targets = 0)
- `root-cause-quotes.txt` — every quoted code block with file:line
- `ground-truth-imports.txt` — bettercap `go.mod`, `main.go`, `session/session.go` imports
- `graph-module-symbol-imports.json`, `graph-session-session-json.json` — bb_graph cross-check (same raw data, consistently external)
- `mcp-workspace-language-comparison.txt` — JS/TS working comparison, Python/Java population censuses, corpus-partial note
- Lead corroboration: `evidence/lead/issue03-deps-maiNgo.json`
- `deps-session-stderr.txt` (0 bytes; exit 0)

## Adjacent defects seen (recorded in `findings/UNLOCKED.md`, not chased)

1. Dependency mode's only usable edges are the ISSUE-02 false cross-language matches: `Makefile`/`icons.yml`/`release.yaml`/`ol.js` rank **top** on bettercap's project-wide dependency page with 275 "internal dependents". Raw data is shared with issue 2.
2. Workspace index (multi-repo `.corpus`) cross-contaminates dependents across unrelated repos (`.corpus/axios/lib/utils.js` lists `.corpus/moment/*` and `.corpus/chartjs/*` dependents) — path/tail resolution has no repo boundary in a single project index.
3. `bb_graph` cannot represent a file-level Go import at all (module-path targets become `ext:` nodes) — the same wrong `isExternal` is exposed there; no resolution field, so a graph reader cannot even see the misclassification.
