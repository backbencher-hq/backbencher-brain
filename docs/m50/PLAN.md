# M50: Tool Adoption Truth — used, useful, trusted

> GitHub milestone #54. Issues: #763 (A1), #764 (A2), #765 (A3), #766 (A4), #767 (X1).

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
  Still open from the original worklist: bb_ask ~4.8s (provider latency),
  parameter vocabulary unification — both continue under A2 with the same
  before/after discipline.
- **A3 (#765) — Guidance that survives restarts.** `bb onboard <dir>` writes an
  AGENTS.md section: only registry-real tools, one when-to-use line each.
  Purge remaining ghost names from shipped surfaces. Extended H1-style gate
  proves every guidance-surface tool name exists in the registry (mutation).
- **A4 (#766) — Prove adoption.** Scripted agent loop (opencode-style prompt +
  tool schema) over a fixture; measured unprompted bb-tool picks before vs
  after A2/A3. User runs one real opencode session; outcome recorded.
- **X1 (#767) — Closure gate.** Refuses close without current evidence and the
  A4 uplift receipt. Mutation-proven self-test (M31/M35/M40 pattern).

## Gates registry (wired into verify chain as they land)

| Code | Script | Infra |
|---|---|---|
| G1 | verify-governance.ts | yes |
| A2 | verify-planner-stats.ts (+ verify-a2-latency-bounds.ts as further fixes land) | no |
| A3 | verify-a3-guidance-truth.ts | no |
| A4 | verify-a4-adoption.ts | no |
| X1 | verify-closure.ts | yes |

## Ground rules

- No fix without an A1-measured conviction (issue #764 explicitly says so).
- Every verdict carries numbers; no prose-only claims.
- The co-agent's analyzer lane (M49) is untouched by this milestone.
