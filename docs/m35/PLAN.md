# M35: Read-Path Staleness Honesty — Master Plan

**Milestone:** M35 · **GitHub milestone:** #35 "M35: Read-Path Staleness Honesty"
**Status:** open
**Authority:** `src/brain/freshness.ts` is the single staleness oracle (hash-based, mtime+size fast path, matches the indexer's `file_hash`). Every read tool may only report staleness derived from it — never from ad-hoc heuristics.

## Mission

Make every read tool tell the truth about index freshness. Today only `bb_search` file/content modes and `bb_ask` mark stale results; `bb_search` symbol mode, all `bb_analyze` modes, `bb_patterns`, `bb_security`, `bb_doc`, `bb_visualize`, and `bb_migrate` return DB rows as current truth with no staleness signal. This is the "AI created a function and thinks it is not in the database" class of user-reported failure, on the read side: stale relationships, stale taints, stale migration plans presented with full confidence.

## Verified starting state (2026-09-03 evidence sweep)

| Read path | Staleness today | M35 action |
|---|---|---|
| `bb_search` file mode | `stale` flag per result | keep (may migrate onto F1 core) |
| `bb_search` content mode | `staleCount`/`freshCount` envelope | keep (may migrate onto F1 core) |
| `bb_search` symbol mode | **NONE** — `ASTEngine.findSymbol` has no freshness check | S1: per-result flag + envelope |
| `bb_ask` | `[STALE — file changed since index]` markers | E1: align to shared envelope |
| `bb_analyze` (all 11 modes) | **NONE** — graphTraversal/stats/complexity/impact/test-* read DB straight | S1: per-node flag + envelope |
| `bb_patterns` | **NONE** (verified: zero staleness mentions) | S2: per-finding flag + envelope |
| `bb_security` | **NONE** | S2: per-finding flag + envelope |
| `bb_doc` | **NONE** | S2: freshness note on documented symbols |
| `bb_visualize` | **NONE** | S3: per-node flag, links inherit worst-of-endpoints |
| `bb_migrate` | **NONE** | S3: per-step flag + envelope |
| `bb_health` | own freshness surface (verbose stale-file names, refresh, integrity) | keep; align field names to E1 where non-breaking |

## Issues

| Code | Issue | Title |
|---|---|---|
| G1 | #579 | Governance: staleness ledger, gates wiring, mutation-based gate self-test |
| F1 | #580 | Freshness core: batch row-level staleness resolution for symbols and relationships |
| E1 | #581 | Response envelope contract: standard freshness block on every read-tool JSON response |
| S1 | #582 | bb_search symbol mode + bb_analyze read modes: staleness surfaced |
| S2 | #583 | bb_patterns + bb_security + bb_doc: staleness surfaced on derived findings |
| S3 | #584 | bb_visualize + bb_migrate: staleness surfaced on graph and migration plans |
| C1 | #585 | Observed-behavior corpus: mutate-after-index snapshot proving every tool tells the staleness truth |
| D1 | #586 | Docs truth: staleness semantics documented per tool and machine-gated |
| X1 | #587 | Closure gate: full staleness-truth audit at final HEAD |

## Attack order

G1 → F1 → E1 → S1 / S2 / S3 (parallelizable after F1+E1) → C1 (after S1–S3) → D1 → X1.

F1 is the dependency root: it must be fast and batch-correct before any tool consumes it. E1 freezes the wire shape so S-issues cannot each invent their own. C1 is the proof layer; D1 documents only what C1 proved.

## Gate registry (self-tested by G1)

| Gate | Script | Mutations (G1 self-test) |
|---|---|---|
| Governance | `script/m35/verify-governance.ts` | fabricated ledger evidence; missing evidence file |
| Envelope contract | `script/m35/verify-envelope-contract.ts` (E1) | handler omits freshness block; remediation string drifts from registry constant |
| Freshness core | `script/m35/verify-freshness-core.ts` (F1) | resolver marks a missing file fresh; batch cost exceeds unique-file bound |
| Tool wiring S1 | `script/m35/verify-s1-read-paths.ts` | stale symbol row reported fresh; analyze envelope counts wrong |
| Tool wiring S2 | `script/m35/verify-s2-derived.ts` | stale finding presented fresh |
| Tool wiring S3 | `script/m35/verify-s3-graph-migrate.ts` | stale migration step unflagged; link inherits wrong endpoint state |
| Staleness corpus | `script/m35/staleness-corpus.ts --check` (C1) | baseline tampering detected |
| Docs truth | `script/m35/verify-docs-staleness.ts` (D1) | doc claims staleness for an unimplemented mode; remediation string drift |
| Closure | `script/m35/verify-closure.ts` (X1) | stale evidence accepted; subordinate gate red accepted; wiring broken |

## Evidence policy

Identical to M31's proven contract (including its post-closure audit lessons):

- **Zero rule:** missing data is never zero — it is `known-gap`.
- Every issue closes only with a persisted evidence envelope in `validation/m35/results/`:
  `status: "verified"`, 40-hex `currentCommit`, `workingTreeRelevantChanges: []`,
  `verifierCommand`, `evidenceFile`, `generatedAt`, `passed > 0`, `failed == 0`, `negativeCases > 0`.
- **No auto-pass assertions** in any M35 verifier (governance greps for `ck(..., true)`, `|| true`, tautologies).
- **Explicit-only stamping:** evidence files are written only when `BB_M35_EVIDENCE=1` (M31 X1 lesson — ordinary gate runs are read-only; this eliminates re-stamp churn). The self-test strips this env from sandboxed child runs (M31 audit lesson: sandboxed gates must never be able to stamp real evidence).
- **Ledger:** `validation/m35/ledger.json`, synced only by `script/m35/sync-ledger.ts` from evidence files, never hand-edited.
- **Wiring is machine-checked:** governance reads `package.json` and verifies `npm run verify` actually runs every M35 gate (M31 audit lesson: criterion 3 was once assumed, not enforced).

## Honest boundaries

- Staleness is **additive truth**: flags and envelope blocks only. No tool drops stale rows, and no read path silently re-indexes. Remediation is a named command the caller chooses to run.
- `bb_health` keeps its own richer freshness surface (per-file names, refresh, integrity); E1 aligns only shared field vocabulary, non-breakingly.
- History interplay: `recordRun` history entries keep their recorded state; staleness applies to live reads, never rewrites persisted history.
- No file-watcher/daemon in this milestone — `bb watch` is explicitly future work, separate scope.
- Analyzer accuracy itself is owned by M14 (co-agent). Staleness reporting is orthogonal: a stale flag is computed from file identity, not symbol quality.

## Post-merge role

`script/m35/staleness-corpus.ts --check` is a designated acceptance probe in `MERGE_NOTES.md` merge-day procedure: after laptops merge, the corpus proves staleness behavior survived the merge, per tool, per language family. Until C1 delivers it, the two live M35 gates (governance + mutation self-test) already run inside `npm run verify` and are part of the merge-day procedure.

## Delivery log

- **F1 (#580) delivered** — `resolveRowsFreshness`/`resolveRowsFreshnessDetailed` in `src/brain/freshness.ts`: batch row-level resolver (id+path keys, per-call memoized stats, chunked IN loads, hash fallback on metadata mismatch), `FreshnessSummary` shape, observable `freshnessStats` counters. Gate `script/m35/verify-freshness-core.ts`: 29/29 behavioral + 3 negative cases, mutation-proven (O(rows) stat mutation flips it) via self-test entry `m35-freshness-core`. Wired into `npm run verify`. Evidence `validation/m35/results/F1.json` at `979b53f`.
- **G1 (#579) closed** with stamped evidence — governance 30/30 (incl. new staged-wiring enforcement), self-test 9/9.
- **E1 (#581) delivered** — `StalenessEnvelope` contract in `src/intelligence/contracts.ts`; `buildStalenessEnvelope` + machine-stable `FRESHNESS_REMEDIATION` constants in `src/brain/freshness.ts` (CLI `bb index --changed` / `bb index "<file>"`, MCP `bb_index`); registry `freshnessModes` registration field (validator-enforced ⊆ executable modes) with bb_search `symbol/content/file` registered and description advertising the block; handlers carry the block (per-item `stale` on symbol matches; file-scope remediation names the exact file; silence when fresh); CLI human-mode line uses the registered constant. Gate `verify-envelope-contract.ts` 29/29 (8 negatives), 2 mutations proven in self-test (19/19). Contract-surface rot repaired en route: `m10-baseline.json` gained M22's `bb_index` and M13.44's visualize scope-only modes (annotated in-file); both frozen-count checks now derive from the baseline; `bb_reindex` alias removed (zero refs). Docs regenerated; corpus drift verified field-by-field as purely additive before baseline regen.

## Delivery log

- **S1 (#582) delivered** — `script/m35/verify-s1-read-paths.ts` (74/74, 5 negatives, mutation-proven ×2): all 11 bb_analyze modes + bb_search symbol carry the registered envelope; project-wide modes resolve a deterministic stride sample (cap 64, `mode:"sampled"`, counts proven correct-for-sample by independent recomputation); targeted modes stay `complete`; complexity/test_quality resolve exactly their visible rows. Latency budget measured on the lodash M19 anchor (direct added-cost instrument, A/B noise recorded): ≤1.7–4.1% ratio for real handlers, <1.5ms absolute for trivial ones — documented in-gate and here as the criterion-3 rule.


## Delivery notes

- C1 (#585) delivered: `script/m35/staleness-corpus.ts` — 93/93 (23 negatives), deterministic (two-run byte-identical modulo timestamp), baseline diffed on `--check`, tamper mutation proven in the gate self-test (49/49). Wired into `npm run verify` and the MERGE_NOTES merge-day procedure.
- D1 (#586) delivered: per-tool **Staleness** sections generated from the registry + registered remediation constants (docs cannot drift from code); docs-truth gate `script/m35/verify-docs-staleness.ts` 71/71 (16 negatives) cross-checks the doc map against the LIVE registry and fails on unimplemented-mode claims; mutation proven in self-test (54/54); TOOLS_OVERVIEW carries the staleness-semantics block.
- X1 (#587) delivered: closure gate aggregates all subordinate evidence at ONE stamp, re-runs content gates read-only, proves corpus currency + derived npm wiring + ledger conformance + governed-source residue. Two-run stability proven (68/68 twice, zero residue); subordinate-evidence-flip mutation proven in self-test (59/59). Milestone closes via the gate.
