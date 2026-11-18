# ISSUE-05 — `test_mapping` reports `session.New:155` as tested by unrelated `caplets/` + `js/` tests at 0.85 (leaf-name resolution artifact)

- **Lane:** `go-testintel` · **Task:** task-5 · **Product:** `backbencher-brain` HEAD `be4c0ef25` · **bb:** 0.1.6
- **Date:** 2026-11-18 · **Specimen:** `/home/ishaq2321/bettercap` (projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`, 1973 files / 55,785 symbols)
- **Read-only campaign:** no source edits, no reindex of bettercap, no writes to bettercap. Repro of record: `evidence/go-testintel/05-mapping-session-fp.json` (145,969 B, exit 0, 3.7 s).

## Verdict

**REAL.** Reproduced exactly at current HEAD: `session/session.go:New:155` is reported tested by `caplets/caplet_test.go:142` (`TestCapletEvalError`) and a block of `js/data_test.go` entries, every link `evidence:"direct_call"`, `relationshipType:"calls"`, `confidence:0.85`. Ground truth is that **no test in the repository calls `session.New` at all** — there are zero occurrences of `New()` in any `session/*_test.go`, and the two cited files call `errors.New(...)` (stdlib) and `otto.New()` (third-party) respectively.

Two detail drifts from the report, stated for precision (they change nothing about the mechanism):
1. "ten `js/data_test.go` benchmarks" — observed are **12 `js/data_test.go` rows: 8 `Test*` functions + 4 `Benchmark*` functions** (the report's count/kind is imprecise; all 12 are the same false edge).
2. "Lock/Unlock to unrelated module tests" — true for the majority (e.g. `modules/arp_spoof/arp_spoof_test.go` locks an embedded `sync.Mutex`), but **not every link is false**: `modules/api_rest/api_rest_test.go` has a genuine `s.Lock()` on a session object. The mapping cannot distinguish the two — that is the defect, not the mixed outcome.

**Severity: medium** (high for any consumer that treats `testedSymbols` as coverage). The same stored edges feed `test_gaps`, `test_impact`, `testSuggestions` (0.85 "extend_existing_test") and every `bb_graph`/`bb_impact` caller answer for `New`, `Lock`, `Unlock`, so the blast radius is the whole dependent-symbol surface, not one page.

**Confidence:** high for defect + mechanism (stored rows carry both the false binding *and* the metadata that contradicts it; both source layers quoted). Medium for the exact fix split between analyzer and resolver (product decision, sketched below).

## Why it matters to a user

A user asks "is `session.New` tested / what must I update if I change it?" The tool answers with a 0.85-confidence link to a caplet test and ten `js/data_test.go` benchmarks. An agent acting on this writes tests against the wrong contract, or worse, concludes a changed symbol is covered. The same name-resolution artifact is what `bb_doc`/`bb_graph` trust, so the wrong answer is internally consistent and therefore hard to detect.

## Reproduce (exact, bounded)

```bash
cd /home/ishaq2321/mcp/backbencher-brain
# A. the reported page (scoped to session/ production symbols; test corpus is project-wide by design)
node bin/bb tool bb_analyze --dir /home/ishaq2321/bettercap \
  --args '{"mode":"test_mapping","filePath":"session","limit":2000}' \
  > docs/bb-bettercap-triage/evidence/go-testintel/05-mapping-session-fp.json
# `target` is refused for this mode (handler.ts:133) — filePath/limit are the accepted args.

# B. the two entries the report names
jq '.entries[] | select(.name=="New")   | {file,line,strongestEvidence,linksTruncated,links:[.links[]|{testSymbolName,testFile,evidence,confidence}]}' \
  docs/bb-bettercap-triage/evidence/go-testintel/05-mapping-session-fp.json
jq '.entries[] | select(.name=="Lock" or .name=="Unlock") | {name,file,line,links:[.links[]|{testSymbolName,testFile}]}' \
  docs/bb-bettercap-triage/evidence/go-testintel/05-mapping-session-fp.json

# C. ground truth in the specimen (does anything call session.New? does caplet_test/go js test it?)
grep -n "New()" /home/ishaq2321/bettercap/session/*_test.go            # -> no matches
grep -n "New" /home/ishaq2321/bettercap/caplets/caplet_test.go | head   # -> NewCaplet(...), errors.New(...)
grep -n "otto.New()" /home/ishaq2321/bettercap/js/data_test.go | head   # -> external otto package
grep -n "func TestCapletEvalError" /home/ishaq2321/bettercap/caplets/caplet_test.go   # -> :142
sed -n '142,158p' /home/ishaq2321/bettercap/caplets/caplet_test.go     # -> :150 NewCaplet, :157 errors.New

# D. stored-row ground truth (read-only DB; never mutated)
DB=/home/ishaq2321/.bb/projects/4c7590f1cba319aac298a50453c0ec440f2dc857/brain.db
sqlite3 -readonly "file:$DB?mode=ro" \
 "SELECT r.target_external, COUNT(*) FROM brain_relationship r
  WHERE r.target_symbol_id='4c7590f1cba319aac298a50453c0ec440f2dc857:session/session.go:New:155'
  GROUP BY 1;"                                   # -> New|91   (all 91 target_external = bare "New")
sqlite3 -readonly "file:$DB?mode=ro" \
 "SELECT f.relative_path, COUNT(*) FROM brain_relationship r
  JOIN brain_symbol s ON s.id=r.source_symbol_id JOIN brain_file f ON f.id=s.file_id
  WHERE r.target_symbol_id='4c7590f1cba319aac298a50453c0ec440f2dc857:session/session.go:New:155'
  AND COALESCE(f.is_test_file,0)=1 GROUP BY 1;"  # -> 50 rows across 13 test files
```

## Bounded observed output

Header/population of A:

```
summary: productionSymbols 187, testedSymbols 34, untestedSymbols 153,
         testFiles 66, scannedTestSymbols 915, evidenceLinks 264, returned 187, truncated false
```

The `New` entry (page-capped at `DEFAULT_MAX_LINKS = 20`; `linksTruncated: true`; DB says 50 test-source rows):

```
file session/session.go:155  strongestEvidence direct_call
  TestCapletEvalError  caplets/caplet_test.go  direct_call calls 0.85
  BenchmarkAtob        js/data_test.go         direct_call calls 0.85
  BenchmarkBtoa        js/data_test.go         direct_call calls 0.85
  BenchmarkGzipCompress / BenchmarkGzipDecompress            js/data_test.go
  TestAtob / TestBtoa / TestBtoaAtobRoundTrip                js/data_test.go
  TestGzipCompress / TestGzipCompressDecompressRoundTrip /
  TestGzipCompressInvalidArgs / TestGzipDecompress /
  TestGzipDecompressInvalidArgs                              js/data_test.go
  BenchmarkAppendFile / BenchmarkMkdirAll / BenchmarkReadDir /
  BenchmarkReadFile / BenchmarkWriteFile                     js/fs_test.go
  TestAppendFile / TestFileSystemIntegration                 js/fs_test.go
```

`Lock`/`Unlock` entries (complete, 16 links each — DB agrees: 16 test-source rows each):

```
Lock   session/session.go:164  links 16: modules/{api_rest,arp_spoof,net_probe,net_recon,wifi}/*_test.go + routing/tables_test.go
Unlock session/session.go:169  links 16: same six files
```

Stored row that the mapping page is derived from (verbatim from the DB; this single row contains the refutation):

```
relationship_type calls | target_external "New" | confidence 0.8 | is_cross_file 1
metadata {"relationshipType":"go_function_call","callExpression":"errors.New","isPackageQualified":true,
          "isStdlib":true,"stdlibPath":"errors",
          "evidenceClass":"usage_contextual",
          "reasonCode":"callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file",
          "bindReason":"callee_recorded_as_a_leaf_name_whose_owner_is_not_resolved_per_file",
          "layerFlow":"test→core","frequency":"one_of_91","isTestCode":true, ...}
source 4c7590f1…:js/data_test.go:TestBtoa:11
```

Ground truth for the same code, from the specimen:

- `caplets/caplet_test.go:142` `func TestCapletEvalError(t *testing.T)` — its only `New` tokens are `NewCaplet("test", …)` at :150 and `errors.New("test error")` at :157. It never names `session.New`.
- `js/data_test.go` line 12, 80, 156, … : `vm := otto.New()` — `otto` is `github.com/robertkrimen/otto`, an external package.
- `session/*_test.go`: **0** occurrences of `New()`; the seven session test files test `ParseCommands`, `NewEventPool`, `NewModuleHandler`, `NewEnvironment`, `NewCommandHandler`, `NewModuleParameter`, etc. — never `session.New`.
- So the correct `test_mapping` answer for `session.New` is **untested (0 links)**; the tool reports 50.

## Expected vs observed

| Source | Claim | Reality |
|---|---|---|
| `docs/BB_TEST_INTEL.md:24-27` | "A production symbol is considered *tested* when a symbol that lives in a test file has a relationship edge whose resolved `target_symbol_id` is that production symbol." | The relationship row for `errors.New` has `target_symbol_id = session.New`; the static-evidence contract is satisfied only because the stored id is wrong. |
| `docs/BB_TEST_INTEL.md:45-46` | "Mapping is keyed by **resolved symbol id**, so two same-named symbols in different files are never conflated (verified)." | The key is an id, yes — but the id was produced by name-only resolution of a *leaf that is not a bare callee*. The guarantee holds at the mapping layer and is defeated at the index layer. |
| `docs/BB_TEST_INTEL.md:39-43` | `direct_call` = `calls`/`instantiates`, confidence 0.85 | Faithfully applied to an edge that is not a test call. |
| report | `session.New:155 → caplets/caplet_test.go:142 + ten js/data_test.go benchmarks @0.85` | Reproduced: 1 caplet + 12 `js/data_test.go` rows (+7 `js/fs_test.go`); "ten benchmarks" is a miscount (8 `Test*` + 4 `Benchmark*`). |
| report | `Lock`/`Unlock` → unrelated module tests | Reproduced for 15/16 links; 1 link (`api_rest_test.go` `s.Lock()`) is a real session lock. |

## Root cause (three layers; quoted code)

### L1 — the Go analyzer stores a package-qualified call as its bare LEAF (`src/ast/real-go-analyzer.ts:6577-6588`)

```ts
  private resolveGoFunctionCall(callExpression: string, symbols, dotImported = false, boundNames?): string | undefined {
    // Handle package-qualified calls (package.Function) — always resolve to
    // the LEAF name (Rust M12.18 contract): `strings.ToUpper` -> `ToUpper`,
    // `s.repo.Save` -> `Save`. Stdlib/external leaves are kept as call
    // targets even when no local symbol matches (`calls normalize -> println`).
    if (stringIncludes(callExpression, ".")) {            // :6581
      const parts = callExpression.split(".")
      const functionName = parts[parts.length - 1]
      if (!functionName) return undefined
      const fallback = findSymbol(symbols, (s) => this.isGoPackageCallable(s) && s.name === functionName)
      return fallback?.name ?? functionName              // :6588  → target_external = "New"
    }
```

`symbols` here is the **current file's** symbol list, so for `errors.New` / `otto.New` there is no local match and the function returns the leaf `"New"`. The qualifier is not lost — it is recorded in the row metadata (`callExpression:"errors.New"`, `isPackageQualified:true`, `isStdlib:true`, `stdlibPath:"errors"`) — but `target_external` is the leaf, and every downstream resolver keys on that column.

### L2 — the resolver binds a bare target name to one project-wide symbol, with no package/module scope (`src/ast/parallel-indexer.ts`)

Eager path (`:3863-3872`):

```ts
  const resolveTargetStmt = rawDb.prepare(
    `SELECT s.id, s.file_id, f.language FROM brain_symbol s
     LEFT JOIN brain_file f ON f.id = s.file_id
     WHERE s.project_id = ? AND s.name = ?
     ORDER BY COALESCE(s.is_declaration, 0) ASC, (s.file_id = ?) DESC, (f.language = ?) DESC, s.id
     LIMIT 1`
  )
```

Authoritative pass (review I13, `:6656-6696`) recomputes **every** bare-name row — including rows already bound:

```sql
      CREATE TEMP TABLE _i13_pick AS
      SELECT t.rel_id AS rel_id,
             COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) AS target_symbol_id
      FROM _i13_src t
      JOIN brain_relationship r ON r.id = t.rel_id
      LEFT JOIN _i13_best_file bf ON bf.name = r.target_external AND bf.file_id = t.src_file
      LEFT JOIN _i13_best_lang bl ON bl.name = r.target_external AND bl.lang = t.src_lang
      LEFT JOIN _i13_best_any  ba ON ba.name = r.target_external
      WHERE r.project_id = ? AND r.target_external IS NOT NULL
        AND r.relationship_type <> 'contains'
        AND instr(r.target_external, '.') = 0        -- :6667  bare names only
        AND instr(r.target_external, ':') = 0
        AND COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) IS NOT NULL
```
…then `UPDATE brain_relationship SET target_symbol_id = p.target_symbol_id FROM _i13_pick p WHERE brain_relationship.id = p.rel_id` (`:6691-6696`).

Its ranking is "declaration first, then same-file, then same-language, then lowest id". `New` has two symbols in bettercap — `session/session.go:New:155` (function, `is_declaration=1`) and `session/session_routing.go:New:20` (property). No caller file declares its own `New`, so the same-language bucket wins and the lowest id (`session/session.go…`) takes **all 91** incoming rows. Nothing in the pass consults the row's own `isStdlib`/`isPackageQualified` metadata, and nothing requires the target to share a package/module with the source. For Go a bare callee can only name a declaration in the **same package**; the pass has no such rule.

**Why `Lock`/`Unlock` are the same defect with a different trigger:** `Lock` and `Unlock` are each the *unique* symbol of that name in the index (verified: `SELECT name,COUNT(*) … name IN ('Lock','Unlock')` → 1 each). Every receiver-selector `x.Lock()` in the corpus is stored as leaf `Lock` (same `:6581` branch), so 152 production + 16 test-file rows bind to `session.(*Session).Lock`. `modules/arp_spoof/arp_spoof_test.go` demonstrates it: `type MockPacketQueue struct { sync.Mutex … }` (:66), `func (m *MockPacketQueue) GetSentPackets()` calls `m.Lock()` (:96) → mapped to `session.Lock`. `mod.Session.Lock` rows are real; `m.Lock`/`g.Lock`/`cacheLock.Lock` are not — the index has no way to tell them apart.

### L3 — test-intel consumes the poisoned ids as 0.85 test evidence with no validation (`src/intelligence/testing/test-intel.ts`)

```ts
const DIRECT_TYPES = new Set(["calls", "instantiates"])                       // :35
export const EVIDENCE_CONFIDENCE = { direct_call: 0.85, reference: 0.6, import: 0.4 }  // :67-71
// loadGraph: every relationship row whose SOURCE symbol lives in an is_test_file file
const testEdges = testFileCount === 0 ? [] : raw.prepare(                    // :229
  "SELECT r.target_symbol_id AS targetId, … FROM brain_relationship r
   JOIN brain_symbol ts ON ts.id = r.source_symbol_id
   JOIN brain_file tf ON tf.id = ts.file_id AND COALESCE(tf.is_test_file,0) = 1 …")
```

There is no package/import/scope check between the test file and the production symbol, and no re-derivation of the edge from `metadata.callExpression`. The mapping layer is behaving exactly as designed; it is being fed false ids. This is why the fix is two-layer (below) and why fixing `test-intel.ts` alone would only paper over the graph.

## Generality

| language | project | fixture/repro | same class? | evidence |
|---|---|---|---|---|
| Go | bettercap (`session/`) | A: scoped `test_mapping` | **YES** — 50 test-source rows to a symbol no test calls; `New`/`Lock`/`Unlock` all leaf-bound | `evidence/go-testintel/05-mapping-session-fp.json`, `05-db-new-rows.txt` |
| Go | bettercap (project-wide DB) | stored-row census | **YES, broad** — 3,245 test-file `calls` rows, **457 (14.1 %)** carry `metadata.isStdlib=1` (a qualified external call stored as a bare leaf); 91 rows to `New`, 152 each to `Lock`/`Unlock` | SQL in §Reproduce D |
| Go | `.corpus`-style second index: gqlgen `graphql` (161 files / 1,806 syms) | `test_mapping` project-wide | **YES** — `executor/executor.go:New:37` gets 20 (of 155) links from 8 test files at 0 calls of `executor.New`; `New` has **five** symbols in that repo and all 155 leaf rows bind to the lowest-id one; `String`, `Error`, `Len`, `Get` similarly capped | `evidence/go-testintel/05-mapping-gqlgen-graphql.json` |
| Go | gqlgen (`executor/testexecutor/testexecutor.go:New:42`) | ground truth grep | **YES, worse** — tests legitimately call `testexecutor.New()`, which is *also* stored as leaf `New` and bound to `executor.New`; even "true" test references resolve to the wrong symbol | `grep -rn "executor\.New("` in specimen; DB group-by |
| cross-language (Rust → the leaf contract) | source-level | `:6581` comment: "Rust M12.18 contract" | **same contract, not executed** — the leaf-target rule is shared family-wide; no Rust index probed this round (OPEN) | source quote |
| JS/TS `test_mapping` | workspace `.corpus/axios` | not run (time-boxed) | OPEN — CROSS-LANGUAGE test-intel validation is `CANNOT-VERIFY` this round | — |

**Conclusion:** the mechanism is analyzer-family-level, not bettercap-specific: any language whose analyzer collapses a qualified call to a leaf name and whose resolver then binds bare names project-wide will fabricate test evidence. Go is the demonstrated case; the code comment shows the same contract is inherited from Rust.

## Fix sketch (implementation-ready)

**(1) Resolver: a bare target may only bind inside the source's package/module scope when the language has module scope** (`src/ast/parallel-indexer.ts`, I13 `_i13_pick` + `_i13_best_*`):
- add a scope key to the candidate tables: for Go, the directory of the declaring file (Go package = directory); accept a candidate only when `bm.file_id`'s directory equals the source file's directory, unless the row carries an explicit import/qualifier that resolves to it. Same for Rust modules / Java packages / Python modules — one `file_module_scope(file_id)` helper, one column, same SQL shape.
- **fail closed**: when no same-scope candidate exists, leave `target_symbol_id NULL` rather than binding the lowest-id global name. A null target is an honest "unresolved"; a wrong target is a fabricated call edge.
- do not attempt receiver-type resolution here (out of scope); null is the correct answer for `m.Lock()`.

**(2) Analyzer: stop discarding the qualifier in `target_external`** (`src/ast/real-go-analyzer.ts:6581-6588`): keep the leaf as `metadata.leafName` but emit `target_external = callExpression` (`errors.New`, `otto.New`, `m.Lock`) — or add `metadata.qualifier` and `metadata.qualifierKind:"package"|"receiver"`. With the qualifier in the key, the resolver's strategy 1/2/3 can refuse to bind a `package`-qualified target whose qualifier is a known stdlib/external import, and can bind `testexecutor.New` to that package's `New` instead of the lowest-id `New`. Coordinate with `edit-safety`/`go-imports` (same rows: ISSUE-03-adjacent).

**(3) test-intel: validate the link before publishing 0.85** (`src/intelligence/testing/test-intel.ts:229-236, 275-287`): for a `direct_call` link, require one of (a) target and test are in the same file/module scope, or (b) the edge resolved through a resolved `imports` row / the test file imports the target's module. Otherwise downgrade to `reference`/drop with a declared `unvalidated-edge` unknown. Also carry `metadata.isStdlib` through the SQL and refuse rows where the row itself says the callee is an external stdlib leaf — the row knows.

## Gate proposal (pins each fix; add to existing gates, no new harness)

1. `script/m13/verify-analyze-modes.ts` (existing handler gate): a behaviour fixture with `pkg/a` (`func New()`), `pkg/b` test calling `errors.New("x")` → assert `test_mapping` entry for `a.New` is `strongestEvidence:"none"` / `links:[]`, and assert `b` sees no `calls → a.New` row. Fails today (binding fires).
2. `script/verify-test-intel.ts` (existing, "same-name isolation" case is the right home): two same-leaf symbols in different packages + a test in a third calling `errors.New` → assert 0 direct_call links. Extend the existing same-name-isolation case, whose current fixture never exercises a *leaf written from a qualified external call*.
3. Index-level (with `go-imports`/`edit-safety`): a `script/` gate that indexes the 3-file Go fixture and asserts every `calls` row whose `target_external` has no dot either (a) shares the package directory with its target or (b) is NULL. Bounded, deterministic, no network.
4. Ranking property: an invariant gate over any Go index — `SELECT COUNT(*) FROM brain_relationship r JOIN brain_symbol s… WHERE r.relationship_type='calls' AND instr(r.target_external,'.')=0 AND json_extract(r.metadata,'$.isPackageQualified')=1` must be 0 (a qualified call may not be stored as a bare name).

## Blast radius (measured, bettercap)

- `session.New`: 91 incoming `calls` rows, all `target_external="New"`; 50 from 13 test files → `testedSymbols` +1 and 50 false 0.85 links.
- `session.Lock` / `session.Unlock`: 152 incoming rows each; 16 test-file rows each.
- Project-wide: 3,245 test-file `calls` rows, of which 457 (14.1 %) are the stdlib-leaf shape; every one is a candidate false test link. `New`'s `frequency` metadata (`one_of_91`) shows the same rows also pollute `bb_graph`/`bb_impact`/`bb_doc`.
- Second Go repo: gqlgen `executor.New` 155 rows; `String`/`Error`/`Len`/`Get` each capped at 20 links from leaf collisions.

## Evidence

- `evidence/go-testintel/05-mapping-session-fp.json` — full `test_mapping filePath=session` answer.
- `evidence/go-testintel/05-db-new-rows.txt` — 30 stored rows targeting `session.New` with metadata (bounded).
- `evidence/go-testintel/05-mapping-gqlgen-graphql.json` — second Go repo generality.
- Commands + SQL: §Reproduce; all read-only (`sqlite3 -readonly`, `--args` read tools, no `bb_index`, no `bb_edit`).

## Adjacent leads recorded

`findings/UNLOCKED.md` → lane `go-testintel` block: (i) `Error`/`String`/`Len`/`Get` are the same class on gqlgen, so the **same mechanism under-scores `bb_graph`/`bb_impact`** (cross-ref ISSUE-04); (ii) risk that fixing this in test-intel only would hide the graph defect.
