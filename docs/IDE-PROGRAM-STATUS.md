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
| v0 | M24 | The Server | **CLOSED** (shipped at I1) | I1 (all five languages, all six features) | [m24/M24-FINAL-AUDIT.md](./m24/M24-FINAL-AUDIT.md) |
| v1 | M25 | The Extension | **CLOSED** (11/11 verified) | I3 (editor-verified, VS Code); I4 on Cursor 3.18.9 + Antigravity 1.107.0 — Windsurf declared blocked | [m25 ledger](../validation/m25/results/manifest.json) |
| v2 | M26 | The Graph | **CLOSED** (11/11 verified) | I3 (graph panel live in VS Code, in-editor verified); cross-language per-pair with declared absence; 39 mutants caught across 9 suites | [m26 ledger](../validation/m26/results/manifest.json) |
| v3 | M27 | Everywhere (JetBrains/Zed/Neovim/Helix) | **CLOSED** (7/7 verified) | N1 I3 (Neovim headless, machine-driven); J1/Z1/H1 I2 (config + wire capabilities, blocked legs recorded); 17 mutants caught across 5 suites | [m27 ledger](../validation/m27/results/manifest.json), [matrix](./m27/FORK-CAPABILITY-MATRIX.md) |
| v4 | M28 | The Union (MCP + agent) | **CLOSED** (7/7 verified) | U1 I3-equivalent (MCP answers machine-proven identical to IDE answers on the shared fixture); annotations schema-enforced provenance + real headless-editor leg; 18 mutants caught across 5 suites | [m28 ledger](../validation/m28/results/manifest.json), [surface](./m28/MCP-SURFACE.md) |
| v5 | M29 | Precision Waves | **CLOSED** (9/9 verified) | wave-1 languages owner-approved (java/python/ts/js/kotlin/scala) verified through real editors; giant-repo budgets within contract §3 | [m29 ledger](../validation/m29/results/manifest.json) |
| v6 | M42 | The Interactive Hover | **CLOSED** (8/8 verified) | rich hover + actions live in-editor (E5 70/70, E6 cursor/antigravity); click-throughs and panels verified in real VS Code | [m42 ledger](../validation/m42/results/manifest.json) |
| v7 | M44 | The Understandable Hub | **CLOSED on GitHub**; closure gate X1 verified 48/48 at its closing commit, owner spot check pending — **governance record reads `known-gap` at HEAD `a0ed9eade`** | — (no claim level published from a red governance record) | [m44/M44-MASTER-PLAN.md](./m44/M44-MASTER-PLAN.md), [G1](../validation/m44/results/G1.json) |
| v8 | M55 | The Hub That Tells the Truth | **CLOSED on GitHub**; **3 of 9 records red at HEAD `a0ed9eade`** — T2 `known-gap` (2 call-hierarchy checks), T3 `known-gap` (2 relations checks), X1 `known-gap` (4 closure checks) | I1 for the protocol-level gates only (T1/T4/P1 verified this pass); **no I3/I5 claim survives the red records** | [m55/M55-MASTER-PLAN.md](./m55/M55-MASTER-PLAN.md), [ledger](../validation/m55/results/manifest.json) |
| v9 | M62 | Address Truth | **CLOSED**; ledger closed, G1/A1/A2/A3/X1 `verified`, pinned at commit `a943047e5c` (2026-09-28) and **not re-earned since** | I1 (machine-level address truth); the editor-visible half is the owner's I3 spot-check, which is scheduled, not recorded | [m62/M62-MASTER-PLAN.md](./m62/M62-MASTER-PLAN.md), [ledger](../validation/m62/results/manifest.json) |

Nothing on this page is a fork- or editor-verified claim until a milestone's
ledger pins a version, a run, and a machine per claim (I3/I4 definitions,
contract §2). v1's claims are pinned in `validation/m25/results/*.json` and
the per-fork capability matrix
([m25/FORK-CAPABILITY-MATRIX.md](./m25/FORK-CAPABILITY-MATRIX.md)).

## The gate-reachability audit (commit `a0ed9eade`, this pass)

A gate nothing runs is not a gate, and a ledger that says `verified` over a
record that says `known-gap` is worse than no ledger. Both were true of this
program at the commit above. What was measured, and by which gate:

| Finding | Measured | Now caught by |
| --- | --- | --- |
| The whole M27 lane (7 verifiers) and M28 lane (7) were named by **no** npm script | 0 references in `package.json` | wired as `verify:m27`, `verify:m28` |
| Six M55 gates — the ones `src/lsp/call_hierarchy.ts` and `src/lsp/identity.ts` NAME as their protecting gates — were wired nowhere | `grep 'm55/verify-identity' package.json` → 0 | wired as `verify:m55` |
| `script/m55/verify-closure.ts:478` asserted `package.json scripts['verify:m55']` contains `m55/verify-closure`, and no `verify:m55` script existed — an unsatisfiable check | C6 could never pass | `verify:m55` exists; G4 of the gate below keeps it existing |
| 6 lane closure gates (m25, m26, m29, m42, m45, m53) were referenced by nothing | — | wired as `verify:lane-closures` |
| 7 IDE surface gates named by `src/lsp/*` and `ide/vscode/*` as their own mutation gates were wired nowhere | — | wired as `verify:m25-surface`, `verify:m26-surface`, `verify:m42-surface`, `verify:m44-surface` |
| 196 verifier scripts remain unreachable from any npm script | census | each is DECLARED with a stated reason in [script/m61/orphan-baseline.json](../script/m61/orphan-baseline.json); a new undeclared one fails G1 |

The standing gate for all of it is `script/m61/verify-orphan-gates.ts`
(`npm run verify:gate-wiring`, evidence `validation/m61/results/V5.json`). It
proves the census sees a real tree, that every unwired verifier is declared with
a reason, that a declared orphan which has since been wired FAILS (the list
cannot rot into an allowlist), that every verifier the LSP source names is wired
or declared, that C6 stays satisfiable, and that no lane ledger claims
`verified` over a non-verified record. Its M9 mutant plants a real file on disk
and proves the live census refuses it.

**What is still open, stated plainly:** 24 ledger-vs-record drifts exist at this
commit across M20, M24, M25, M26, M29, M42, M44, M45 and M61. The M27, M28 and
M55 ledgers are now PROJECTED from their records by their own governance gates,
so they cannot drift again. The remaining ledgers are hand-maintained; their
lanes own that fix and it is not done.

## v2 — The Graph (M26): shipped capabilities

The differentiator, shipped honest: one HTML/renderer core (`script/m26/graph-core.ts`)
reused everywhere — never per-IDE forks.

- **Graph panel live in VS Code** (`bbLsp.showGraph` → `ide/vscode/src/graph-panel.ts`):
  `bb/graph` over the real LanguageClient, rendered through the ONE core via an
  escaping DOM port, emitted through the canonical W6 shell. In-editor proof: E5 29/29.
- **Versioned transport** (`bb/graph`, schema v1): loud declared errors on version
  mismatch, unknown symbol, and unindexed workspace — never a silent empty graph.
  Every edge traces to its `brain_relationship` row id.
- **Five-tier evidence badges + legend** on every edge and every graph; the 0.7
  inheritance floor is one rule across webview and hover (drift-gated).
- **Bounded impact mode** (200 nodes / depth 5) with in-UI "Showing X of Y"
  truncation and an independent declared total — never silent.
- **Cross-language hover, per-pair**: facts from stored `is_cross_language` rows
  only; pairs without rows are declared absent. **Proven end-to-end from real
  indexing (M26.A1)**: the indexer's cross-language flag now fires in both
  resolution paths (insert-time java→scala 3/3; late-resolution ts→js 2/2 — a
  real write-path defect found and fixed), with `name-resolution` bridges and
  honest inferred-tier rendering.
- **Webview hardening (W6)**: strict nonce-bound CSP, canonical HTML shell,
  adversarial fixtures rendered inert, three security mutant classes caught.
- **Generated docs**: `docs/m26/GRAPH.md` regenerated from live code + the ledger;
  byte-identical drift gate. Claim levels match the ledger by construction.

## v1 — The Extension (M25): shipped capabilities

Thin VS Code-family client (`ide/vscode`) over `bb_lsp` — all intelligence
stays in the server; the client owns launch, consent, and the status surface:

| Capability | Level | Evidence |
| --- | --- | --- |
| Server resolution order (explicit path → workspace dist → source fallback), version-gated | I1 | `validation/m25/results/E1.json` |
| Auto-index consent machine with declared modes, BB_DATA_DIR provenance | I1 | `validation/m25/results/E2.json` |
| Status surface: staleness markers, claim tiers, activation budget law | I1 | `validation/m25/results/E3.json` |
| Marketplace listing truthfulness (drift-gated claims, per-editor install doc) | I1 | `validation/m25/results/D1.json` |
| In-editor verification (pinned VS Code 1.85.0, shared assertion core) | I3 | `validation/m25/results/E5.json` |
| Fork verification: Cursor 3.18.9 + Antigravity 1.107.0 verified; Windsurf blocked-with-reason | I4 | `validation/m25/results/F-CURSOR.json`, `F-ANTIGRAVITY.json`, `F-WINDSURF.json` |
| Cross-platform honesty: Linux verified; macOS/Windows recorded blocked (no runner — owner decision open) | §10 | `validation/m25/results/E7-linux.json`, `E7-darwin.json`, `E7-windows.json` |

Honest gaps carried forward: macOS/Windows OS-matrix runners (or waiver) are
an owner decision; OpenVSX live publish awaits `OVSX_PAT` (E4 declares the
package verified, the listing not yet live); owner spot-check passes are
scheduled in the issue-closure comments.

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
| Fixtures are TypeScript; per-language fixture evidence for java/groovy/kotlin/scala | M26+ (unchanged by v1 — extension scope) |
| ~~I3 (editor-verified) / I4 (fork-verified) levels unclaimed~~ — **retired by M25** (E5/E6 evidence) | M25 ✅ |
| Latency budgets measured on one machine (recorded per evidence file) | partially retired by M25.E7: Linux verified; macOS/Windows blocked pending owner runner-or-waiver decision |
| bun harness leg `blocked` where bun is absent — recorded with reason | standing rule |
| Single-root workspaces only | M25+ |
| No graph UI, no cross-language hover | ~~M26~~ retired at M26 closure (graph panel live in VS Code; cross-language hover per stored pair, absence declared) |
| Event storms >1000/s unverified | M29/R3 |

## Verdict history

| Date | Event | Evidence |
| --- | --- | --- |
| 2026-09-02 | M24 closed: 11/11 issues verified, closure gate 60/60 + 6 negatives, full-suite re-run green at closing commit | [m24/M24-FINAL-AUDIT.md](./m24/M24-FINAL-AUDIT.md) |
| 2026-09-03 | M25 closed: 11/11 issues verified at HEAD `e6125bb` — governance 72/72, E5 in-editor 26/26 (VS Code 1.85.0), E6 forks 26/26 ×2 (Cursor, Antigravity) + Windsurf blocked, E7 Linux 39/39 with darwin/win32 blocked records, X1 closure gate 37/37 incl. budget-violation-hidden mutant | [m25 ledger](../validation/m25/results/manifest.json), [X1](../validation/m25/results/X1.json) |
| 2026-09-04 | M26 closed: 11/11 issues verified at HEAD `5153034` — graph panel live in VS Code (E5 29/29 in-editor), bb/graph transport v1 over real stdio, five-tier evidence badges + legend, bounded impact mode with in-UI truncation, W6 webview hardening, generated per-pair docs from 17 real dbs, X1 closure gate 50/50 with per-mutant records; 39 mutants caught across 9 suites (A1 1, D1 3, V1 5, W1 6, W2 5, W3 5, W4 5, W5 6, W6 3 — D1 gained its ambient-leak control M3 during the M62 fixpoint convergence, so the published total follows the live record) | [m26 ledger](../validation/m26/results/manifest.json), [X1](../validation/m26/results/X1.json) |
| 2026-09-04 | M26.A1 addendum closed: cross-language write path proven end-to-end from REAL indexing — a real indexer defect found and fixed (late-resolved relationships never got the cross-language flag/bridge; fix is upgrade-only in both resolution flows); fixtures java→scala 3/3, ts→js 2/2 flagged with `name-resolution` bridges; verifier 11/11 + 1/1 mutant | [A1](../validation/m26/results/A1.json), [issue #615](https://github.com/backbencher-hq/backbencher-brain/issues/615) |
| 2026-09-04 | M27 closed: 7/7 issues verified — one binary reaches five editor families. Neovim I3 (real headless session, 31/31); LSP4IJ/Zed/Helix I2 with wire-level capability subsets and blocked legs recorded (runIde / wasm build, in-editor Zed session, driven hx); generated capability matrix v3 with the graph delta declared per editor; X1 closure gate 31/31 + 4 negative probes; 17 mutants caught across 5 suites (N1 4, J1 4, Z1 3, H1 4, V1 2) | [m27 ledger](../validation/m27/results/manifest.json), [X1](../validation/m27/results/X1.json), [matrix](./m27/FORK-CAPABILITY-MATRIX.md) |
| 2026-09-04 | M28 closed: 7/7 issues verified — the agent and the developer share one truth. Union differential gate U1 proves MCP answers ≡ IDE answers on the shared fixture (edge multisets with tiers, impact sets with declared truncation, cross-language facts with declared absence); annotations land in the shared index with SCHEMA-enforced provenance (`author_class` NOT NULL — a provenance-less write is refused by the storage layer itself) and render where the human reads (author-labeled hover section + graph badge, asserted by a real headless Neovim session); MCP surface doc fully generated from the live registry; X1 closure gate 31/31 + 4 negative probes; 18 mutants caught across 5 suites (T1 2, U1 4, A1 4, A2 6, V1 2) | [m28 ledger](../validation/m28/results/manifest.json), [X1](../validation/m28/results/X1.json), [surface](./m28/MCP-SURFACE.md) |

## Next up

The ladder discipline is unchanged: each milestone's governance gate re-audits
the bar below it, so a red bar above blocks the next wave. As of this pass the
red bars are, in dependency order:

1. **M24's §3 latency gate** — `script/m24/verify-harness.ts` is `known-gap`
   because the `node-dist` leg misses warm budgets on the machine it last ran
   (hover 132.7 ms vs a 50 ms budget; `prepareCallHierarchy` 135.8 ms and
   `callHierarchyExpand` 112.1 ms vs 100 ms). The `node-source` leg passes. The
   `bun` leg is `blocked` — bun is absent.
2. **M27 / M28** — `known-gap`, correctly: their ledger projections now publish
   the red records (M27.N1 `blocked` — no nvim; M28 T1/U1/A2/V1 `known-gap`).
   These lanes are honest-red, not drifting.
3. **M55** — T2 and T3 `known-gap` on real checks (a fixture call-site the
   relations gate cannot resolve; a `get` symbol with declared zero callers that
   the fixture now contradicts). Needs a lane fix, not a doc fix.
4. **Every lane's governance gate whose bar depends on the above** — M25, M26,
   M29 and M44 all report RED for `stale-commit` pins and inherited bar
   failures, which is the correct answer for a program whose lower bars are red.

M29 — Precision Waves (v5) closed 2026-09-04; the versions above it (v6 M42,
v7 M44, v8 M55, v9 M62) are all closed on GitHub. There is no v10. The next
program work is re-earning the red records above on a machine that can run them,
not opening a new milestone.
