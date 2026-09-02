# IDE Program Status — living tracker (M24–M29)

> **This document is the running state of the IDE program.** It is updated at
> every milestone closure and at any material change between milestones.
> It never upgrades a claim beyond what machine evidence supports
> (authority order in [M24-MASTER-PLAN.md](./m24/M24-MASTER-PLAN.md) and the
> [IDE Honesty Contract](./IDE-HONESTY-CONTRACT.md)).
>
> **Update protocol:** when a milestone closes, or a claim level changes, or
> a limitation is added/retired, this file is updated in the same commit and
> the change is covered by the milestone's drift gate where one exists.

Constitution: [IDE-PROGRAM-DECISIONS.md](./IDE-PROGRAM-DECISIONS.md)
Contract: [IDE-HONESTY-CONTRACT.md](./IDE-HONESTY-CONTRACT.md)

## Program at a glance

| Version | Milestone | Name | State | Claim level | Status doc |
| --- | --- | --- | --- | --- | --- |
| v0 | M24 | The Server | **COMPLETE** | I1 (all five languages, all six features) | [m24/M24-FINAL-AUDIT.md](./m24/M24-FINAL-AUDIT.md) |
| v1 | M25 | The Extension | not started | I3/I4 target — **not claimed** | — |
| v2 | M26 | The Graph | not started | — | — |
| v3 | M27 | Everywhere (JetBrains/Zed/Neovim/Helix) | not started | — | — |
| v4 | M28 | The Union (MCP + agent) | not started | — | — |
| v5 | M29 | Precision Waves | not started | — | — |

Nothing on this page is a fork- or editor-verified claim until M25 pins a
version, a run, and a machine (I3/I4 definitions, contract §2).

## v0 — The Server (M24): shipped capabilities

Standalone LSP 3.18 binary over stdio (`bb lsp`, entry in
`src/lsp/server.ts`), reading the persisted `brain.db` index:

| Feature | Level | Evidence |
| --- | --- | --- |
| Hover — signature + usage count + evidence class + stale marker | I1 | `validation/m24/results/L2.json` |
| Definition | I1 | `validation/m24/results/L3.json` |
| References | I1 | `validation/m24/results/L3.json` |
| Document symbols | I1 | `validation/m24/results/L4.json` |
| Workspace symbols | I1 | `validation/m24/results/L4.json` |
| Call hierarchy (prepare / incoming / outgoing) | I1 | `validation/m24/results/L5.json` |

- **Languages:** java, groovy, kotlin, scala, typescript (launch set; the
  opening set, never the ceiling — contract §9). All other languages are
  **declared absent**, never "coming soon".
- **Claim level I1** = protocol-passed: the reference LSP client harness
  (`script/m24/lsp_harness.ts`, permanent in `npm run verify`) exercises
  positive and negative cases against a seeded fixture index, and warm p95
  latency holds the contract §3 budgets (50 ms hover/definition/references/
  doc symbols; 150 ms workspace symbols; 100 ms call hierarchy).
- **Complement stance (contract §7):** no completion, no diagnostics, no
  rename. We layer on top of first-party language servers.
- **Honesty in every response:** claim tier and stale marker are part of the
  wire response, not documentation garnish.

## Standing gates (permanent in `npm run verify`)

| Gate | Protects | Evidence |
| --- | --- | --- |
| `verify-governance.ts` | ledger truth, evidence freshness, closure rules | `validation/m24/results/G1.json` |
| `verify-positions.ts` | LSP ↔ index position mapping (8 mutants) | `validation/m24/results/P1.json` |
| `verify-freshness.ts` | watch → debounce → reindex → stale markers (4 mutants) | `validation/m24/results/P2.json` |
| `verify-server.ts` | LSP lifecycle, capabilities, transport | `validation/m24/results/L1.json` |
| per-feature verifiers | L2–L5 behavior + mutants | `L2.json`–`L5.json` |
| `verify-harness.ts` | runtime legs + latency budgets | `validation/m24/results/V1.json` |
| `verify-docs.ts` | doc/evidence drift + banned vocabulary | `validation/m24/results/D1.json` |
| `verify-closure.ts` | §6 mutant coverage + completion bar + byte-identical regeneration | `validation/m24/results/X1.json` |

## Declared limitations of v0 (carried forward)

| Limitation | Retires in |
| --- | --- |
| Fixtures are TypeScript; per-language fixture evidence for java/groovy/kotlin/scala | M25 |
| I3 (editor-verified) / I4 (fork-verified) levels unclaimed | M25 |
| Latency budgets measured on one machine (recorded per evidence file) | M25.E7 cross-platform wave |
| bun harness leg `blocked` where bun is absent — recorded with reason | standing rule |
| Single-root workspaces only | M25+ |
| No graph UI, no cross-language hover | M26 |
| Event storms >1000/s unverified | M29/R3 |

## Verdict history

| Date | Event | Evidence |
| --- | --- | --- |
| 2026-09-02 | M24 closed: 11/11 issues verified, closure gate 60/60 + 6 negatives, full-suite re-run green at closing commit | [m24/M24-FINAL-AUDIT.md](./m24/M24-FINAL-AUDIT.md) |

## Next up

M25 — The Extension (VS Code thin client + forks via OpenVSX), per the
decision record. May start: the v0 completion bar is fully satisfied and
audited. Extension work must keep every standing gate green; a client change
that breaks the harness fails `npm run verify` like any server regression.
