# M53: Deep Review Wave — LSP lane takes in the co-agent changes

**GitHub milestone:** 52 (`M53: Deep Review Wave — Reservation (co-agent)`)
**Status:** in progress
**Lane owner:** bb_lsp / IDE program (this agent)
**Governing contract:** [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)

## Purpose

The co-agent lanes landed large changes on main after the M44 closure HEAD
(0df02f01): **M48 Tool Surface Truth** (16-tool registry, installer
allow-lists), **M51 Index Truth** (storeable-reference guard, health
honesty), **M52 Health Latency** (covering index, grouped language query),
**M49 review-intake** (groovy/scala closure waves), **M37.21 analyzer
waves** (java/JVM/web fixes).

M53 is the independent, evidence-backed verification that these changes do
not hurt or break the LSP work — and the recorded receipt that says so to
the co-agent and the engineer. Nothing here is claimed; everything is a
gate that can fail.

## Facts established by the survey (2026-09-09)

1. **Zero-touch:** `git diff 9afe0fac..origin/m48-recovery` over the LSP
   lane (`src/lsp/`, `ide/vscode/src/`, `script/m24..m44`, the graph
   engine) is EMPTY. The co-agents never edited LSP-lane files, on main or
   on the integration branch. (R3 pins this as machine evidence.)
2. **Main is additive:** no commit in `0df02f01..HEAD` touches the LSP
   lane; the shared npm verify chain carries both lanes' gates.
3. **Merge semantics are safe but required:** the merge-base predates the
   M44.U5 file-disambiguation fix (9da145ff), so the branch lacks it. A
   3-way merge keeps the fix; merging before release is a declared
   follow-up, not a hazard. (R3 asserts this so it cannot silently flip.)
4. **Risk surfaces** (where their changes COULD have hurt us, verified in
   R1/R2 rather than assumed):
   - write path: M51's guard changed what the indexer may write → what
     hover/graph/impact read
   - schema/index: M52's covering index + query split → the health and
     language queries my staleness surfaces share
   - tool surface: M48's 16-tool registry → no `bb/`-namespace collision
     with the LSP custom requests (verified: `bb/graph`, `bb/impact`,
     `bb/staleness`, `bb/webview` vs `bb_*` MCP tools — disjoint)
   - shared verify chain: both lanes' gates must stay green together

## Issues

| Issue | What it proves | Evidence |
|---|---|---|
| [#731](https://github.com/backbencher-hq/backbencher-brain/issues/731) R1 | Full m24→m44 gate ladder passes at the co-agent HEAD | `validation/m53/results/R1.json` |
| [#732](https://github.com/backbencher-hq/backbencher-brain/issues/732) R2 | Fresh co-agent index → LSP surfaces return declared-shape, non-regressed data | `validation/m53/results/R2.json` |
| [#733](https://github.com/backbencher-hq/backbencher-brain/issues/733) R3 | Branch audit: zero-touch + merge-required, machine-pinned, can-fail | `validation/m53/results/R3.json` |
| [#734](https://github.com/backbencher-hq/backbencher-brain/issues/734) X1 | Closure gate + INTEGRATION-RECEIPT + verdict posted to co-agent/engineer | `validation/m53/results/X1.json`, `docs/m53/INTEGRATION-RECEIPT.md` |

## Rules

- Fixture-first for anything broken in my lane (F7), attribution with
  evidence for anything broken in theirs — never silent.
- Every verdict carries its HEAD sha and timestamp; stale evidence refuses
  closure (m42 freshness rule).
- The verdict message to the co-agent states what was taken in, at which
  HEAD, and what remains declared-open (the branch merge).
