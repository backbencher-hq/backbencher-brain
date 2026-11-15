# THE ORPHAN CENSUS RECONCILED — 43 undeclared orphans and 13 source-named ones declared with reasons, and the record can finally NAME them

**Run 2026-10-13:** `npx tsx script/m61/verify-orphan-gates.ts` (record: `V5.json`, run at
`d9b3084b`, status KNOWN-GAP 14/15, mutants 11/11).

## What the run found (before the reconciliation)

```
M61.V5: KNOWN-GAP (12/15 passed, 11/11 mutants)
  census: 648 verifiers, 420 wired, 228 unwired (185 declared)
  - G1: 43 undeclared: script/m14/lanes/java-verify/... … +31 more
  - G3: 13 undeclared: script/m14/verify-erlang-identity.ts (named by src/ast/real-erlang-analyzer.ts) …
  - G5: 20 drifted: m20.M2: ledger=verified record=known-gap …
```

- **The census had not been run since 2026-10-05** — its then-latest record was **already known-gap,
  3 of 15 checks failing** — and the baseline was last committed 2026-10-06, whose own census block
  already showed `orphans: 190` against `declaredOrphans: 184`. The gap only grew: 43 by this run.
- **The mechanism is that nothing invokes the census.** `verify:gate-wiring` has an npm entry point,
  but no npm chain and no CI workflow calls it, so a week of lane work — the m62 typecheck ratchet,
  the `perf` instruments, the m24/m26/m28/m55/m60/m62 lane gates, the java-verify family — could
  break the G1 invariant without a single red anywhere.
- **And the failure could not be reviewed: `V5.json` reported "43 undeclared" while naming none of
  them.** The census serialized the bare `newOrphans` **function** (`verify-orphan-gates.ts`,
  `census:` block), which `JSON.stringify` drops — the one failure that most needs a list was the
  only one with no evidence attached. **Fixed:** the record now carries `newOrphans: unseen`, the
  list G1 itself computed.

## What was declared (additions only — `lost: []` verified both ways against the previous baseline)

- **G1 · 43 declarations — `orphans` 185 → 228.** Every reason states the instrument's own role
  (from its header) plus the wiring fact (`in-pkg=0`: no npm script and no closure gate names any of
  them):
  - `VERIFY_JAVA9` java lane family ×6 (`script/m14/lanes/java-verify/`)
  - M14 wave instruments ×8 (`ts-verify-census.mjs`, csharp ×2, erlang, kotlin, python, rust, and one
    `script/m14/tmp` scratch probe declared as scratch)
  - m24 ×4 · m26 ×2 · m28 ×4 · m55 ×4 · m56 ×1
  - m60 Lua ×3 (LUA-52/53/54) — no `verify-lua-*` member was ever npm-wired; the earlier members were
    declared previously
  - m62 ×3 — including `verify-gate-typecheck-coverage.ts`, the whole-script-tree typecheck ratchet,
    declared with its actual reason: it re-runs `tsconfig.gates-wide` twice and plants a canary/breaker
    file in `script/` while running, so it is run deliberately at a quiet HEAD
  - `perf` ×8 — machine-local corpus instruments; their runs' evidence sits in `validation/m60/results/`
- **G3 · 13 source-named declarations — `sourceNamedUnwired` 8 → 21.** Each is named by `src/`, none
  is wired: four were already declared orphans (`verify-erlang-identity`, `verify-import-alias`,
  `verify-graph-transport`, `verify-rich-hover`); nine are newest (position-arithmetic,
  surface-parity, hover-coverage, lua ×2, perf ×4).
- **Re-run after the declarations: G1 0 undeclared, G3 0 undeclared** — census 648 verifiers / 420
  wired / 228 unwired / 228 declared, mutants 11/11, the M9 planted-orphan end-to-end proof green.

## What remains — G5, and it is explicitly not this gate's to repair

**20 ledgers claim `verified` over records that read `known-gap`/`blocked`**: `m20` ×11, `m21` ×1,
`m26` ×3, `m29` ×4, `m62.A2` ×1. The gate's own limitation line is the rule: *"This gate reports; it
does not repair. Wiring a gate into package.json and projecting a ledger are lane-owner actions."*
So **V5 stays KNOWN-GAP (14/15) and exits 1 BY DESIGN** until those lanes re-project their ledgers.
This is a disclosure, not a pass.

## The wiring recommendation, and why it must come SECOND

`verify:gate-wiring` being invoked by nothing is the mechanism by which a 43-orphan drift went
unnoticed for a week. Wiring the census into `npm run verify` is one line — **but it should follow
the G5 clearance, not precede it**: a chain step that is red for 20 other-lane records would fail
every lane's full verify run. Until then, this run is the review surface, and re-running the census
after any batch of new verifiers is one command.

## Boundaries

- Reachability is text-derived (package.json script values plus closure-gate bodies), as the gate
  itself discloses; a verifier invoked only by a mechanism the parser does not model would appear as
  an orphan — which is why every declaration states a reason rather than an exemption.
- The baseline's previous `head` (`de5ff45a…`) is not in this clone (a cross-laptop head); each run
  writes its own, and the current baseline/V5 record the commit they were produced at.
