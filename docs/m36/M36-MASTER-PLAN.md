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
M30/M32/M33/M34 milestone gates, explicitly excluding machine-specific legs.

### Further findings (recorded 2026-09-03)

- **The package has no `test` script** — even with the lockfile committed,
  the workflow's `npm test` step would fail. The repo's testing methodology
  is the verifier chain, so the Test step is repaired to run the four
  hermetic core verifiers (`verify-engine`, `verify-schema`,
  `verify-tool-registry`, `verify-public-surface`) under `npx tsx` — proven
  to pass under a fresh empty `HOME` (runner-like), 8–12s each.
- **`script/verify-core.ts` is machine-specific**: it hard-codes a personal
  opencode database path (`$HOME/.local/share/opencode/...`) and
  asserts its row counts, so it fails on any other machine. It stays out of
  CI like the M19 legs. (Its repair is a separate finding, not an M36 issue.)
- **Runner certification (S2)**: all 21 M30/M32/M33/M34 gates pass under a
  fresh empty `HOME` (21/22 first pass; two latent verifier defects found
  and fixed: the M32 smoke harness's fixed input pacing lost a pty race
  under load — now prompt-aware; M33's governance probe assumed ledger
  progression — back-ported the M34 fix). The M33 man-page gate needs
  `groff`/`man-db`, absent from runner images, so the verify job installs
  them explicitly (never silently skipped). Runner images have no `bun`, so
  `verify:fast` runs under `npx tsx`. The S2 wiring gate survived a real
  bug of its own: a regex-based YAML block extractor truncated at the
  first blank line — replaced with line-based splitting.

## Non-goals / ownership boundary

- The **verify job** (S2) is additive-only; the existing build job's
  install/typecheck/build steps remain byte-identical (diff-checked by the
  S2 verifier). S1 *repairs* the broken Test step (`npm test` → hermetic
  core verifiers) because the package has no test script — a recorded
  root-cause fix, not a redesign.
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
