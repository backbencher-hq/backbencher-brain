# go-imports lane — P1-1 Go imports + P1-2 Go cross-file uses / attribution (fix status)

Campaign: `docs/bb-bettercap-fix/FIX-CHARTER.md`. Branch: `fix-campaign-wave2` (worktree
`.tools/wt-wave2` from CP1 commit `380a7e473`). Bettercap is read-only; the FINAL campaign step
runs the one DB-copy reindex that proves the index-time effects end to end.

## Tasks

| task | scope | status |
|---|---|---|
| task-11 | phase 1, analyzer-local: GO1 cross-file function-value `uses`, package-main RED proof, import-identity prerequisites | **COMPLETE (CP1)** |
| task-17 | phase 2: module identity plumbing, Go `isExternal`, dependency-engine Go resolver, package-main source attribution | **GREEN** |

## Phase 1 (task-11, landed in CP1 `380a7e473`)

- `src/ast/real-go-analyzer.ts` — GO1 bare-identifier pass now publishes a cross-file value read
  as an anchored LEAF row (target = the name, confidence 0.6,
  `metadata.relationshipType "identifier_usage"`, `crossFileValueRead: true`) with the existing
  reason code `used_identifier_recorded_as_a_leaf_whose_declaring_file_is_out_of_scope`. The
  analyzer is a per-file entry point (`analyze(rootNode, content, filePath)`), so it cannot verify
  a sibling declaration; the row stops DISCARDING the read. Exclusions extended: Go predeclared
  values (`nil/true/false/iota`), predeclared builtins (`len/append/…`), predeclared types, this
  file's import bindings, and parameter NAMES inside function types / interface method specs
  (`isParameterNameOccurrence` guard — 56 fabricated rows measured on bettercap session/ before
  it, 0 after; evidence `evidence/go-imports/IMPACT-bettercap-session.txt` vs
  `evidence/go-imports/GREEN2-bettercap-session-impact-with-guard.txt`).
- Import-identity prerequisites as pure functions + tests: `goImportExternality`,
  `readGoModulePath` (tested in `script/verify-analyze.ts`).
- package-main attribution: RED DB proof captured
  (`evidence/go-imports/RED-probe-phase1.txt`): a `calls` row inside `func main` binds to
  `main.go:main:1` (module, 12-byte span) because the store's `nameToSymbol` is first-wins.
  Not analyzer-fixable; handed to phase 2.
- Gates/evidence: `evidence/go-imports/RED-fixtures-go.txt` (RED), `GREEN-fixtures-go.txt`,
  `RED-verify-analyze.txt` (RED: missing exports), `GREEN-verify-analyze.txt`;
  `RED-guard-fixtures-go.txt` / `GREEN2-fixtures-go-with-param-guard.txt`.

## Phase 2 (task-17) — GREEN

### Files changed (this lane)

| file | change |
|---|---|
| `src/ast/go-module.ts` **new** | bounded `readGoModulePath` / `readGoModuleInfo` (walks up to 32 ancestor dirs for the governing go.mod), per-process `moduleInfoForProject` cache, pure `goImportExternality`, `goPackageDirForSpecifier` |
| `src/ast/parallel-indexer.ts` | (1) `storeResults` persists `go_module_path` / `go_module_dir` into `brain_project_meta` once per call (cached reader); (2) Go import-classification section uses `goImportExternality` (same-module ⇒ `is_external=0`) as the authoritative rule + store-side fallback — JS/TS idiom untouched for every other language; (3) source attribution: for Go non-`contains` rows with a repeated source name, the innermost same-named symbol whose span covers the row's site line wins (module-level rows keep the module symbol) |
| `src/ast/pool-worker.ts` | Go import plumbing ONLY: `parseFile` attaches `goModulePath` to the analyzer context at the single point both production entry paths converge |
| `src/ast/real-go-analyzer.ts` | helpers moved to `go-module.ts` (re-exported for the phase-1 gate); `analyze` reads `context.goModulePath`; `processGoImportSpec` publishes `isExternal` from the pure rule (nothing when undecidable) |
| `src/brain/schema-ddl.ts` | `PROJECT_META_DDL` + `ensureProjectMetaTable` — additive/idempotent `brain_project_meta(project_id, key, value, time_updated)` on every open (annotation-table pattern) |
| `src/intelligence/analysis/dependencies.ts` | language-aware Go branch: module path → modulo-relative package dir → every indexed `.go` file directly in that dir ⇒ `resolution:"resolved"` deps + populated dependents; external Go rows carry `external:true` and **no** `resolution` claim; provenance states the Go classification basis |
| `script/verify-analyze.ts` | Go phase-2 gate block (11 assertions + 5 helper assertions); phase-1 block retained |
| `docs/analyzers/go.md` | phase-2 section docs the module identity, `isExternal`, attribution and the dependency-engine contract |
| `docs/BB_ANALYZE.md` | §`dependencies` contract: Go module specifier → package directory; external Go rows carry no `resolution` claim; provenance states the classification basis (Lead-assigned closing item) |

### Gate (RED → GREEN)

Command (worktree): `BB_DATA_DIR=$PWD/.tools/triage-fix/go-imports/bbdata npx tsx script/verify-analyze.ts`

- **RED** `evidence/go-imports/phase2/RED-verify-analyze-phase2.txt` — the phase-2 block fails at
  its first assertion (`SqliteError: no such table: brain_project_meta`): the identity did not
  exist; the project-meta table is the first thing phase 2 adds. Intermediate runs pin the
  per-defect progression (`GREEN-verify-analyze-phase2-attempt1/2/3.txt`): attempt3 shows
  module-identity/isExternal/dependency assertions already GREEN while
  `P2: call inside func main is attributed to func main` is still RED — the acceptance proof the
  campaign asked for.
- **GREEN** `evidence/go-imports/phase2/GREEN-verify-analyze-phase2.txt` — `ANALYZE: PASS`
  (51 `ok:` lines).
- Phase-1 Go fixtures unchanged: `evidence/go-imports/phase2/GREEN-fixtures-go-phase2.txt` —
  `{"go":{"pass":51,"fail":0}}`.
- `script/m13/verify-analyze-modes.ts`: `evidence/go-imports/phase2/GREEN-m13-verify-analyze-modes.txt`
  — `An1: VERIFIED (84/84 passed, 27 negatives)`.
- `npx tsc --noEmit`: `evidence/go-imports/phase2/GREEN-tsc.txt` — exit 0, 0 bytes.
- `script/m14/go9-census.ts` is NOT runnable in this sandbox: it hardcodes
  `/tmp/opencode/wt/VERIFY_GO9/src/ast/engine.ts` (environment path from another machine);
  failure captured in `evidence/go-imports/phase2/go9-census-attempt.txt`, unrelated to this
  change. The M14 Go fixture suite is the executable analyzer gate here.

### Asserted facts (gate lines)

1. `go.mod` module path + module-relative dir persisted as project metadata.
2. No `brain_import` row whose path equals/starts with the project module path is `is_external=1`
   (post-index invariant); the same-module import is stored internal.
3. Third-party import stays external (control); stdlib stays external.
4. `getFileDependencies` resolves the internal Go dependency to the package's files
   (`external:false`, `resolution:"resolved"`), populates `dependents`, and the page reports
   internal dependencies ≥ 1; an external Go dependency carries no `resolution`.
5. A `calls` row inside `func main` is attributed to the FUNCTION symbol (line > 1), and the
   module symbol does not own it; module-level import rows still bind the module symbol (control).
6. Pure helpers: same-module specifier ⇒ internal; stdlib/third-party ⇒ external;
   module-path lookalike (`example.com/m2/x`) ⇒ external (prefix boundary); unknown module path
   stays undecided; subdirectory-indexed project maps `…/internal/x` ⇒ `x`; third-party specifier
   maps to no project package dir.
7. JavaScript/TypeScript behaviour unchanged — the pre-existing verify-analyze checks
   (dependency paths, `service.ts` dependent, coupling/complexity/impact) still pass in the same
   run (`ANALYZE: PASS`).

### Known limits / handoffs

- The end-to-end bettercap symptom proof (session internal deps resolved, `returnedInternalDependencies>0`,
  func-main attribution on the real index) requires a **reindex of a bettercap DB copy** — the
  original index predates the module-identity metadata and is never written. That is the FINAL
  campaign step; the gates above assert every mechanism it will expose.
- A database indexed before this wave has no `brain_project_meta` rows; the dependency engine
  answers exactly as before and its provenance states the classification basis. Reindex (or the
  next index run on the project) writes the identity.
- An import under the project's module but OUTSIDE the indexed project root (e.g. a project
  indexed at `internal/` importing `…/api`) maps to no indexed package and stays unresolved —
  honest, since the index does not contain that package.
- Worktree note: `src/brain/database.ts`, `src/cli/index.ts`, `src/mcp/server.ts`,
  `script/m-fix/verify-old-index-compat.ts` were modified by ANOTHER session in this worktree
  (P2-6 old-index compat). This lane did not touch them.
