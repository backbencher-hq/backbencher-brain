# M50: Tool Adoption Truth — used, useful, trusted

> GitHub milestone #54 (CLOSED). Issues: #763 (A1), #764 (A2), #765 (A3), #766 (A4),
> #788 (A5 — registered after delivery once connectivity returned; the issue text
> lived in `docs/m50/A5-issue.md` while the network was down, and the number was
> never invented), #767 (X1). All delivered issues carry an evidence receipt and
> are closed; the A4 human-session claim remains honestly `pending`.

## The milestone invariant (verbatim, enforced by X1)

> **No tool is called "adoptable" until a scripted agent loop picks it unprompted,
> and no fix lands without a measured before/after on the real index.**

Every acceptance criterion traces to this sentence.

## Why this milestone exists (measured, from A1 — not guessed)

The user's coding agents (VS Code, opencode) with the MCP connected do not use
the bb tools — even when explicitly told to. A1 (#763) measured the rejection on
the real index (816MB DB, 168,705 symbols, production `node bin/bb mcp` shape):

| Verdict | Tool (p50 warm) | Root cause (evidence-backed) |
|---|---|---|
| TIMEOUT (hard fail) | bb_patterns (90s+) | full-pattern scan per call materializes 33,603 findings before display slicing |
| REJECT | bb_graph (18.9s) | per-hop symbol-NAME join traversal; 3 hops = 335s reconstructed on the real DB |
| REJECT | bb_ask (4.8s) | embedding-provider round-trip + re-rank inside the call |
| SLOW | bb_analyze complexity (2.9s), dependencies (2.1s), test_gaps (1.6s), test_mapping (1.7s), bb_security (1.0s), bb_analyze impact (1.2s) | per-call full-dataset aggregation, stat-heavy freshness |
| Divergence | graph-family takes `symbol`, analyze takes `target`, search takes `query` | three guess-errors recorded verbatim; every wrong guess teaches the agent to quit |
| OK (10) | bb_search 564ms, bb_health 366ms, bb_doc 380ms, bb_visualize 558ms, bb_impact 551ms, bb_cross_language 195ms, bb_annotations 3ms, analyze callers/stats/test_quality 582/244/70ms | — |

Full table + SQL reconstructions: `validation/m50/results/A1.json` (+ 19 per-case files).

**After A2 (same harness, fresh `node bin/bb mcp`, real index):** `bb_graph`
18.9s → **0.32s** (58×), `bb_patterns` >90s timeout → **1.6s** (56×), `bb_ask`
4.83s → **0.93s** (5.2×), `bb_analyze callers` 582ms → 9ms, `bb_impact` 551ms
→ 8ms, `bb_cross_language` 195ms → 4ms. **16 of 20 probes are now OK; ZERO
remain in the REJECT/timeout class** (A1 had 4). Before/after table:
`validation/m50/results/A2-latency-compare.json`.

**Declared residuals (not OK, honestly reported — not excused):**
`bb_analyze complexity` 2895ms → 2253ms (still SLOW: per-call aggregation over
3,040 files with stat/hash work — the A1 root cause, untouched by the planner
fix), `bb_security` 1032ms → 1229ms (SLOW, within run-to-run variance — no
regression claim either way), `bb_patterns all` 90s timeout → 1609ms (SLOW
borderline; the full-scan cost was removed, the remaining time is the rule
evaluation itself). These three are filed as follow-ups on #764 rather than
silently declared fixed. **Superseded by the residual passes below:** complexity
**272ms**, security **164ms**, test_gaps **311ms** (all OK); `bb_patterns all`
remains SLOW-borderline at **1,345ms**, and `bb_annotate` remains an ERROR by
design (invalid-args probe; the write tool is deliberately not fired at the real
index). Residue is computed from the receipts in `A2-residual.json`, and a
conviction is only withdrawn by a newer receipt that measures OK.

## Issues

- **A1 (#763) — Measure the rejection.** DONE: latency census (19 probes, fresh
  process, warm), SQL-layer reconstructions of the two catastrophic paths,
  verbatim parameter-guess errors. No fixes in A1.
- **A2 (#764) — Fix what A1 convicts.** Worklist: (1) bb_patterns: bounded
  rule scan + pre-aggregated counts; never materialize the full findings set.
  (2) bb_graph: id-keyed adjacency (one adjacency load, BFS in memory), not
  name joins. (3) complexity/dependencies: cached or sampled aggregation with
  declared freshness. (4) bb_ask: provider call moved off the critical path or
  cached; declare the latency. (5) Unify the parameter vocabulary (`target`
  everywhere, `symbol` accepted as an alias) — decided with the registry gates.
  Every fix lands with before/after numbers from A1's harness.

  **DELIVERED (root cause, not worklist guess):** A1's "slow handlers" verdict
  was WRONG about the engine — the handlers were fast in-process (3–108ms); the
  15–45s stdio numbers came from SQLite planning WITHOUT sqlite_stat1 (ANALYZE
  never ran on any real DB), which made the graph owner-cascade scan every
  brain_symbol row per hop (117–126ms × ~150 hops; EXPLAIN + cpuprofile
  evidence). A2's real fix is planner truth, not traversal rewrites:
  (a) `ensurePlannerStats()` — absence-only ANALYZE at DB open;
  (b) `ensureHealthIndexes()` self-heals 8 core traversal indexes + repair-path
  ANALYZE when one is recreated;
  (c) `analyze` as a recorded final post-processing phase (fresh indexes are
  born with stats).
  Measured (fresh `node bin/bb mcp`, real repo): bb_graph 19.2s/15.4s/15.2s →
  2.9s/0.66s/0.60s; bb_patterns timeout>45s → 4.5s; per-hop 117–126ms →
  0.29–0.56ms (200–400×). Gate: `verify-planner-stats.ts` 9/9 bun + tsx,
  mutation-proven. Evidence: `validation/m50/results/A2-planner-stats.json`.
  **bb_ask, second half (delivered):** the remaining cost was the embedding
  provider round-trip *inside* the call plus re-parsing 260MB of JSON digits per
  query. Both are fixed with measured numbers: (a) dense vectors are written as
  a little-endian float32 blob at insert time and backfilled for legacy indexes
  (JSON stays the source of truth; the blob is an accelerator — 260MB of JSON
  digits → 82MB of bytes, 3.16× less to read); (b) a bounded LRU query-embedding
  cache (128 entries, keyed by model+endpoint) makes a repeated question free
  while a NEW question still pays the provider honestly. Measured on the real
  index: bb_ask 4.8s → 1.1s (repeated: ~0.3ms of embedding), blob promotion
  11,124 rows in 3.7s, decode is bit-identical to JSON (max abs delta 2.9e-8).
  Gates: `verify-vector-blobs.ts` 30/30 (bun + tsx, mutation-proven),
  `probe-ask-cache.ts` (identity-proven: every repeat compared bit-for-bit to a
  fresh computation). Evidence: `A2-vector-blobs.json`, `A2-ask-cache.json`.
  **Parameter vocabulary (delivered):** graph/annotations tools accept
  `target`/`symbolName`/`query`, analyze/doc/visualize accept
  `symbol`/`symbolName`/`query`, and a rejection now NAMES the accepted options
  and aliases instead of dead-ending. `verify-a2-param-aliases.ts` 129 checks.
  **A2 residual (post-closure) — the three A1 convictions that stayed above the
  one-second line.** All three had the same defect shape: an engine
  materialized far more than it could ever return.
  (1) `bb_analyze complexity` (project scope) fetched every joined symbol row
  (168,629) to average a column and keep 20 — the aggregate is computable in SQL
  and the breakdown is `LIMIT 20` (2,253ms → 375ms through the production
  harness; `probe-complexity-phases.ts` proves old and new produce identical
  metrics and the same top-20).
  (2) `bb_security` loaded every symbol (168,629 rows / 508ms) into a Map to
  resolve the 2,692 ids the taint rows actually reference — now flow paths are
  parsed once and only the referenced ids are fetched, in 500-id chunks
  (568ms → 94ms engine time; `probe-security-phases.ts` proves the bounded map
  equals the full map for every referenced id and the report digest is
  byte-identical to the pre-fix run).
  (3) `bb_patterns` built and sorted all ~28,602 orphan findings before slicing
  to `maxResults` (100), and called the pure path predicates once per symbol —
  now candidates are lightweight sort keys, finding objects are built only for
  the returned page, and the predicates are memoized per file (digest-identical
  output, proven by `probe-pattern-phases.ts`).
  The structural property is gated by `verify-a2-bounded-work.ts` (hermetic
  fixture: 700 seeded taint flows spanning the chunk boundary, independent SQL
  derivations, a comparator-ordered pagination oracle, and three falsifiability
  negatives); the mutation self-test proves the gate can fail. Latency itself
  stays in the probes and the A2c production-shape sweep — never a ceiling
  inside a gate.
  (4) `bb_analyze test_gaps` (1,584ms → **311ms**, 5.1×, same harness) built a
  gap object — with its recommendation string — for **every** production symbol
  (30,557 here) via `testMapping({maxResults: 100000})`, sorted all of them, and
  sliced to 200. Candidates are now lightweight sort keys, findings are built
  only for the returned page, and the two-stage stable sort reproduces the
  previous ordering so the output is **byte-identical** (sha256
  `3c362e5…f68f` over gaps+summary+truncated, `prevReportDigestMatch: true`).
  The same pass also stops the engine paying for a test-edge table scan when no
  code test source exists, and resolves the per-file noise predicates once per
  file instead of once per symbol.

  **A2 residual, truth half — the tool was reporting a false census.**
  `A2-test-sources.json` records it: the indexer's `is_test_file` classifier
  matches directory segments (`…/spec/…`) and the `.spec.` infix with **no
  regard for file type**, so on the real index all **30** flagged files are JSON
  data fixtures (`script/m14/spec/*-completeness.json`,
  `validation/m14/results/M14.0.SPEC.json`) and every relationship from them is
  `contains` — **0** classified call/reference/import edges. `test_gaps` and
  `test_mapping` therefore saw a corpus of 30 JSON files / 5,196 JSON symbols,
  classified nothing, and reported **all 30,557 production symbols as
  untested**, while `test_quality` listed the 30 JSON files as test files. The
  fixes here (in-lane, no re-index): a test source must be **code**, so non-code
  flagged files are excluded from the test corpus and the exclusion is declared
  in `provenance.unknowns` (`non-code-test-files-excluded: 30 …`), and a corpus
  that yields no classified evidence declares
  `no-test-evidence-edges: … this is an absence of evidence, not evidence of
  absence`. `test_quality` now lists **0** test files instead of 30 JSON
  fixtures, and the whole production payload delta is the declared unknowns
  (357 bytes standalone + 6 bytes of nesting indent = the 363 bytes observed in
  the sweep — reconciled in the evidence, not a loose end).

  **Reported, NOT changed (root cause, other lane):** the
  `is_test_file` classifier itself (`src/ast/parallel-indexer.ts`) still flags
  non-code files, and the same flag feeds the pattern/exclusion surfaces other
  lanes own. Correcting it needs a re-index and a coordinated re-measure of the
  M13/M15 pattern corpora, so it is filed as a finding with evidence rather than
  changed unilaterally. The structural properties above are gated by
  `verify-a2-test-sources.ts`.
**A5 (#788) — Verify-chain truth (found during A2).** Two gates in the repo's
  own chain were RED at HEAD for reasons unrelated to any live defect:
  `verify-contract-diff.ts` (13 failures — the M10.01 frozen baseline still
  listed 11 tools and a pre-M28 category vocabulary) and
  `verify-tool-registry.ts` (1 failure — a substring test for "handler" that
  bb_search's own description defeats). A red gate nobody reads hides the next
  real regression, so A5 re-froze the mechanically-derived baseline from the
  live registry (recorded in `postBaselineRepairs`), widened the category
  vocabulary to the declared set, and replaced the substring test with a
  structural handler-leak check. Gate: `verify-a5-verify-chain.ts` (10 checks,
  including a degraded-baseline copy and a real handler-key mutant injected into
  the registry source that must fail the gate). Evidence: `A5.json`.
- **A3 (#765) — Guidance that survives restarts.** `bb onboard <dir>` writes an
  AGENTS.md section: only registry-real tools, one when-to-use line each.
  Purge remaining ghost names from shipped surfaces. Extended H1-style gate
  proves every guidance-surface tool name exists in the registry (mutation).
- **A4 (#766) — Prove adoption.** Delivered as two honest halves: (1) the exact
  agent-shaped call SHAPES A1 recorded as failures are replayed through the real
  gateway on a hermetic indexed fixture — 5/5 now resolve, and the one shape with
  a genuinely nonexistent option is refused with the accepted list named;
  (2) guidance decidability — 16/16 realistic tasks map to exactly one tool row
  in the generated AGENTS.md section, with zero ghost names. The third claim —
  a model picking bb tools UNPROMPTED — cannot be observed by a scripted gate, so
  it is stamped `humanSession.status = "pending"` in `A4.json` and the closure
  gate reports it as pending rather than inventing an uplift.
- **X1 (#767) — Closure gate.** Refuses close without current evidence and the
  A4 uplift receipt. Mutation-proven self-test (M31/M35/M40 pattern).

## Gates registry (wired into verify chain as they land)

| Code | Script | Infra |
|---|---|---|
| G1 | verify-governance.ts | yes |
| G2 | verify-gate-selftest.ts (control + mutation for every non-infra gate) | yes |
| A2-stats | verify-planner-stats.ts | no |
| A2-aliases | verify-a2-param-aliases.ts | no |
| A2-vector-blobs | verify-vector-blobs.ts | no |
| A2-bounded | verify-a2-bounded-work.ts | no |
| A2-test-sources | verify-a2-test-sources.ts | no |
| A3 | verify-a3-guidance-truth.ts | no |
| A4 | verify-a4-adoption.ts | no |
| A5 | verify-a5-verify-chain.ts | no |
| X1 | verify-closure.ts | yes |

All of the above run in `npm run verify:m50` and in the full `npm run verify`
chain. Measured probes (`probe-*.ts`) are registered separately in
`script/m50/gates.json` — probes measure, gates decide.

## Ground rules

- No fix without an A1-measured conviction (issue #764 explicitly says so).
- **Run the M50 gates serially.** The mutation seams (frozen baseline,
  registry source) are temporarily corrupted and restored byte-for-byte during
  a gate run; a gate reading that file mid-mutation — or a second copy of the
  same gate — will transiently see the corrupted world and go red. Found while
  verifying A5 (a parallel closure run red-flipped it 9/10; serial 10/10).
  `npm run verify:m50` is sequential by construction.
- Every verdict carries numbers; no prose-only claims.
- The co-agent's analyzer lane (M49) is untouched by this milestone.
- Every gate seals its own run (commit stamp + pass/fail counters) so a stale
  green is visible as stale.
- Anything a scripted gate cannot observe is declared `pending`, never inferred.
