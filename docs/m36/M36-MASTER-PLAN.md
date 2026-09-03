# M36 — CI Enforcement — Master Plan

Milestone: M36 · GitHub milestone: 36 · Status: open
Authority: this document · Governing contract: `docs/M14-HONESTY-CONTRACT.md`

## Purpose

M30–M34 built ~700 verification checks with 68 mutants across the honesty,
discovery, consumability, and language gates — but the verify discipline runs
only when someone remembers locally. Worse, the existing CI has been red for
every recent run.

### Root-cause finding (recorded 2026-09-03)

GitHub Actions evidence (run 33339778229 and every earlier recent run): CI
dies at the `setup-node` cache step with **"Dependencies lock file is not
found"** — `package-lock.json` was never committed (GitHub contents API
returns 404). The jobs never reach typecheck, build, or test; the Node 18/20
matrix legs are cancelled by fail-fast after the Node 22 leg fails. The
lockfile in the workspace is valid (`npm install --package-lock-only
--dry-run` clean), so S1 is a pure repair whose proof is a green run on
GitHub itself.

Second finding: `npm run verify` (M30/M32/M33/M34 gates) has no CI job, so
none of that discipline is machine-enforced. The full chain cannot run on a
runner — M19 benchmarks against local corpora (`~/intellij-community`, a
giant ASP.NET repo) — so CI gets a **`verify:fast`** subset: build + the
M30/M32/M33/M36-milestone gates, explicitly excluding machine-specific legs.

## Non-goals / ownership boundary

- The existing `build` job in `.github/workflows/ci.yml` must remain
  **byte-identical**; S2's change is additive-only (a new `verify` job).
- No runner environment changes beyond what `npm ci` needs (the lockfile).
- No `src/mcp/` changes (M21), no analyzer work (M14), no LSP/IDE work
  (M24–M29), no tool-documentation work (M31), no staleness work (M35).
- No changes to what the gates check — this milestone only makes them run
  somewhere other than one person's memory.

## Authority order

1. This master plan (`docs/m36/M36-MASTER-PLAN.md`).
2. The governing honesty contract (`docs/M14-HONESTY-CONTRACT.md`).
3. Executable implementation and its verifiers.

Where docs and behavior disagree, behavior wins and the docs gate must be
updated — never the reverse.

## Protocol (every issue)

Every issue carries machine-emitted evidence: `currentCommit`,
`verifierCommand`, `evidenceFile`, `positiveAndNegativeChecks`, fresh
timestamp, and `limitations`. A known-gap is recorded as `known-gap` and a
blocked issue as `blocked` — never silently skipped. `verified` is only
reachable with positive AND negative (adversarial) checks passing at the
current commit. CI-run URLs are recorded in issue comments; they are
time-variant and therefore not part of the machine evidence.

## GitHub issue numbers

M36's issues are filed on GitHub as milestone 36: G1=#588, S1=#589, S2=#590,
X1=#591. The ledger and `REAL_ISSUE_NUMBERS` in
`script/m36/verify-governance.ts` enforce these values exactly — a
placeholder or unknown number is a gate failure, so the ledger cannot drift
from GitHub.

## Issue order and dependencies

| Issue | Tool | Scope | Depends on |
|---|---|---|---|
| G1 | governance | master plan, ledger, chain wiring | — |
| S1 | repair | commit package-lock.json; green CI run proves npm ci works | G1 |
| S2 | gate | verify:fast script + additive verify job in ci.yml | S1 |
| X1 | gate | closure gate | S1, S2 |

X1 closes last; no issue may close before the issue it depends on.

## Completion bar

1. A GitHub Actions run on main reaches typecheck/build/test and is GREEN
   with the lockfile committed; a stale lockfile (dep added without lock
   update) fails `npm ci` locally — mutant-proven.
2. `verify:fast` exists, is green locally end to end, and runs in CI as an
   additive `verify` job; removing a gate from `verify:fast` fails the S2
   verifier, and the build job remains byte-identical (mutant-proven).
3. All M36 gates are permanent parts of `npm run verify`, and the closure
   gate audits the whole milestone fail-closed.
