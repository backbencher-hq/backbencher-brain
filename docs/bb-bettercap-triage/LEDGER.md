# Triage ledger — FINAL (Lead-owned)

Campaign closed 2026-11-18. Baseline HEAD `be4c0ef25`, bb `0.1.6`, bettercap index
`4c7590f1…` (1972/1973 files, 55,785 symbols), **specimen untouched** (`git -C bettercap status`
empty; reads only, `sqlite3 -readonly`, dry-run `bb_edit` only). All 12 report items adjudicated
from independent evidence; 8 lanes completed their tasks; no lane wrote outside
`docs/bb-bettercap-triage/`.

Verdict vocabulary: `CHARTER.md` §2. Cross-cutting causes: `findings/LEAD-FINDINGS.md`. Generality:
`GENERALITY.md`. Battle plan: `PLAN.md`. Raw evidence: `evidence/` (12 lane directories + lead).

| # | Issue | Lane | Final verdict | Severity | One-line mechanism (measured) | Finding file |
|---|---|---|---|---|---|---|
| 01 | bb_edit refactor misses package-qualified caller; no build gate | edit-safety | **REAL** | **critical** | Caller edge exists but (A) its source symbol is the 12-byte `package main` module (44/44 edges; 0 on `func main`), so the rename window excludes main.go:47; (B) Go `field_identifier`/TS `property_identifier` classified member-name → dropped (46 qualified callers → 1 file/1 site); (C) caller-evidenced file with 0 sites silently skipped; (D) post-write validation is syntax-only → `validated:true` on non-compiling tree; fixture replay → `undefined: modules.LoadModules` | ISSUE-01-unsafe-refactor.md |
| 02 | Cross-language edges yaml/makefile/js → go | cross-lang | **REAL-BUT-MISDESCRIBED** | high | All 7 rows exact, but they are name-collision re-bindings of analyzer-declared external targets; 2,423/2,423 cross rows are `name-resolution` (≥43% structurally impossible pairs); marker certifies language mismatch; read surface republishes 0.9/`import_based` | ISSUE-02-false-cross-language-edges.md |
| 03 | Go dependency graph all-external, no dependents | go-imports | **REAL** (sub-claim `unresolvedSpecifiers:0` REAL-BUT-MISDESCRIBED) | high | 3-link chain: Go analyzer never declares `isExternal`/same-module → pool-worker JS rule ⇒ 1,880/1,880 Go imports `is_external=1`; dependencies engine resolves only `!external` ⇒ dependents empty; no go.mod awareness anywhere ⇒ 0 internal resolution. Reproduced on 3 Go indexes; JS/TS correct | ISSUE-03-go-dependency-graph.md |
| 04 | Orphan false positive / callers=0 for referenced callback | go-callgraph | **REAL-BUT-MISDESCRIBED** | high | Orphan engine correct/kind-aware; input missing: Go GO1 `uses` pass same-file-only (`fileValues.has`) ⇒ cross-file `plugin.Defines["onEvent"] = jsOnEventFunc` emits 0 rows; 8 callbacks at 70%; totals exact (4,385 / 2,739 / 1,644 / 4,697); `callers=0` is correct call semantics | ISSUE-04-orphan-false-positives.md |
| 05 | Test mapping to unrelated tests at 0.85 | go-testintel | **REAL** | medium–high | 3 layers: leaf-only qualified calls (`errors.New`→"New"), unscoped eager resolution (91/91 `session.New` incoming calls from bare "New"; 50 from 13 test files), test-intel consumes stored calls as `direct_call` 0.85 with no scope validation. `session.New` untested; `Lock/Unlock` map to embedded `sync.Mutex` calls. 14.1% of project test-file calls rows are this shape; gqlgen reproduces | ISSUE-05-test-mapping.md |
| 06 | Test quality: assertions 0, JS-only parameterization | go-testintel | **REAL** (mechanism corrected) | medium | Aggregate 0.322 exact (mean of 7 files); 0 assertions claimed vs 114 real Go assertion sites; `error_handling` 0 too (report omitted); parameterization fires via `%s` printf-verb heuristic (not `it.each` as report said — zero it.each tokens), hard-coded anchor "it.each/test.each template"; classifier table JS-shaped (Go 0, testify 2/4, JS vitest 1.0, Python 0, TS 0.167) | ISSUE-06-test-quality.md |
| 07 | bb_doc documents wrong symbol / passed:true | retrieval | **PARTIAL** | medium | Exact-name union of 5 copies presented as one subject (title/canonicalPath imply one); ordering by `line_start`; qualified `session.Session` does not disambiguate; `limit:1` documents the module.go:35 **field** at `passed:true`; `passed` is 4-term consistency conjunction with no scope term. "never the canonical struct" is FALSE at defaults (cited 7×) | ISSUE-07-doc-wrong-symbol.md |
| 08 | bb_search symbol mode metadata-only / fileId | retrieval | **REAL-BUT-MISDESCRIBED** | medium | Metadata-only REAL (`includeContent` refused in symbol mode); `fileId` claim partly wrong (symbols mode is text, no fileId; real mismatch is `symbol` absolute path vs `content`/`file` `<projectId>:relPath`); "skill claims exact source" REAL (descriptor/onboard/MCP guide contradict BB_SEARCH.md) | ISSUE-08-search-symbol-mode.md |
| 09 | bb_ask 0% semantic coverage on configured space | embeddings-health | **REAL** | high | Query model authoritative, scan hard-filters one space (`semantic-search.ts:329-333`); 1/55,785 in configured space; the 1 vector is `ParseOptions:26` (the report's only hit); index `embedMany` degraded batches to local (23,924), reconcile backfill exists but only inside `bb index`, best-effort, no durable pending state; no populated-space preference | ISSUE-09-embedding-provider-coverage.md |
| 10 | Impact/graph payload bloat, bounds after data | payload-honesty | **REAL-BUT-MISDESCRIBED** (composite) | medium (high at host cap) | 345 vs maxNodes is two units (engine caller rows vs dependent-node budget, enforced); real: graph Session = 1,087,986 B (>1 MB), summary at 99.5–99.7%; impact counts at 99.7–99.9%; 4 hand-ordered envelopes, no shared serializer; `maxNodes` not caller-settable | ISSUE-10-impact-graph-payload-bounds.md |
| 11 | 1972/1973 + status=complete, 24 LESS, 42.9% | embeddings-health | **PARTIAL** | medium | Contradiction real but **not silent** (`[INCOMPLETE_INDEX]` error, exit 1); real defects: `status` ignores deliberate `skippedFiles`, and the 1 missing file is `modules/ui/ui/vendor.js` (5.43 MB, size-tier skip) so the printed `force=true` remedy can never work; "24 LESS" = 16 `.less` + 8 `.scss`; 42.9% = 23,925/55,785 exact but unexplained (embed outcome not persisted) | ISSUE-11-index-health-caveats.md |
| 12 | security 39 vs 0; visualize whole-project | payload-honesty | **REAL** (split) | low / medium | security = label conflation (39 = registry languages in "leads" tier, project-independent; stored leads line is the only lead count; docs repeat label); visualize = unconditional "this graph is the whole project" at `visualization-engine.ts:1023`, false for every non-project scope/truncated page, reproduced on 3 projects incl. empty module | ISSUE-12-output-contradictions.md |

## Cross-cutting (Lead-verified; `findings/LEAD-FINDINGS.md`)

- **L-1 (P0):** unscoped leaf-name binding — qualified external references (`errors.New`, `os`) rebound
  to arbitrary same-named project symbols across files/packages/languages. 89 incoming calls to
  `session.New`, 88 from bare `New`; 8,548 package-qualified calls (4,940 bound).
- **L-2 (P0):** cross-language layer has no non-name bridge — 2,423/2,423 bettercap cross rows,
  15,836 workspace rows, all `name-resolution`; genuine-bridge positive control required before filtering.
- **L-3 (P1):** bounds-after-data in 4 tool envelopes (issues 10).
- **L-4 (P2):** old indexes (2026-10-17) crash graph-family reads with raw
  `no such column: r.target_basis`.
- **L-5 (P2):** resolver overrides analyzer's own declared `bindReason` without recording an inferred basis.
- **Ops:** workspace MCP server served a stale dist chunk (`database-HE6EE3VA.js`) during the campaign;
  CLI `--dir` was used for all probes. Rebuild/restart before MCP-parity retesting (PLAN P2-7).

## Unlocked (adjacent defects recorded by lanes; `findings/UNLOCKED.md`)

19 lane-prefixed blocks: false-edge ranking polluting dependency pages; multi-repo workspace
cross-contamination of dependents; `bb_graph` exposing same-module imports as `ext:`; asset-vendor
noise (1,573/1,644 file-orphans are FontAwesome SVGs); doc `limit` as subject selector; search JSON
property noise; orphan coverage-gap caveat hidden by CLI text; keyword fallback hiding model space;
INCOMPLETE remedy cannot fix size-tier skip; embed outcome not persisted; security visualize gating;
old-index schema drift; MCP dist chunk integrity; dotted/namespace rename blindness; inert penalty
clamp; hard-coded quality anchors; gqlgen leaf collisions.

## Outcome

Verification phase complete: **12/12 items real in some form; 0 false.** Tally: 5 REAL
(01, 03, 05, 06, 09), 4 REAL-BUT-MISDESCRIBED (02, 04, 08, 10), 1 REAL-composite (12), 2 PARTIAL
(07, 11). Every item needed at least one correction to the report's stated mechanism or numbers.
Scope: 4 tool-level, 2 indexer-wide, 3 Go-analyzer class, 1 edit-engine, 2 reporting/contract. Generality: no item is bettercap-specific (`GENERALITY.md`). Hunt plan with
root causes, fixes and gates: `PLAN.md` — P0 refactor safety + name binding; P1 Go identity/uses,
test intel, response envelope; P2 doc/search/embeddings/health/labels/old-index.
