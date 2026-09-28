# M17 — Persistence Integrity & Tool Honesty

Milestone: recordRun/history must equal the analysis that produced it.
GitHub milestone #17 · Issues #403–#410 · Started 2026-08-24

---

## 1. Origin findings (the defects this milestone exists for)

Both were found by **running the tools live**, not by reading code:

| # | Finding | Evidence |
|---|---------|----------|
| 1 | `bb_security { recordRun: true }` persisted `rule="unresolved"` / `severity="unknown"` rows into `brain_analysis_finding` for **isolated taint sources** (e.g. `script/test-live-mcp.ts:10:unresolved`), even though the live summary counts those separately as "unvalidated sources". Root cause: `taint.ts` classified columns by missing symbol-id instead of by **endpoint resolution**, so sink-NULL rows fell through to `confirmed` and were promoted to findings. | `script/verify-tool-history.ts` (A2 matrix); reproduced end-to-end (index → taint → adapter → recordRun → history) |
| 2 | `bb_patterns { recordRun: true }` persisted **only the display slice** (`slice(0, limit)`, default 20) as "the run". History under-reported, and the auto-resolve pass in `completeAnalysisRun` would mark real findings past the slice as "resolved"/gone on the next run. | `script/verify-tool-history.ts` (B section) — 31 found recorded as 31, previously would persist 20 |

## 2. What M17 verifies (issue groups)

| Code | Issue | Invariant |
|------|-------|-----------|
| C1 | Governance: master plan, evidence ledger, closure gate, wiring | Every closed issue has an evidence file that re-reads clean at HEAD |
| S1 | `bb_security` source-only observations never become findings or history | state classification + history cleanliness (already fixed in `f145352`, gate permanent) |
| S2 | `bb_security` real-repo e2e: recordRun ↔ history invariants on real corpora | persisted set == live set on real repos |
| P1 | `bb_patterns` recordRun persists the full analyzed set | recorded == found == DB rows (+ docs) |
| H1 | Cross-tool audit: every tool that records a run persists the full analyzed set | per-tool persist() → DB matrix, no hidden truncation |
| A8 | `bb_ask` counts match DB; no fabricated counts on missing index | permanent regression from M16 |
| D6 | Docs truth: per-tool recordRun/history semantics for the website | byte-fresh docs match handler source |
| X9 | Closure gate: persist-display equivalence + anti-hollow scans | planted-mutation fails the gate |

## 3. Verification protocol (every issue)

1. **Verifier first.** Each issue gets a script under `script/m17/` (or a shared
   script) that can FAIL. No auto-pass constants, no `>= 0` tautologies, no
   `|| true` — the M17 closure gate scans for these.
2. **Real repos.** E2E must run against real repositories on disk:
   - targeted families at `~/fixtures/repositories/` (rake·Ruby, element-plus·Vue/TS,
     lodash·JS, powershell, rebar3·Erlang, cabal·Haskell, terraform·HCL, swift-nio·Swift,
     zig, mojo, cython, grails-core·Groovy, scala3, Exposed·Kotlin, cats-effect·Scala …)
   - larger clones under `~/` — `~/ProxiCall` (Android/Java), `~/openclaw` (Python/TS),
     `~/paperclip`, `~/aspnetcore`, `~/roslyn` (C#), `~/intellij-community` (Java)
   - a repo that cannot be found is **reported as missing, never skipped silently**.
3. **Evidence file:** `validation/m17/results/<CODE>.json` written by the verifier
   with `verified, checks, passed, failed, negatives, generatedAt`.
4. **Negative line:** every evidence notes what it does NOT prove (so we never
   over-read a pass).
5. **Closure comment:** closing an issue requires a GitHub comment quoting the
   real run output + the evidence path.
6. **Ledger:** `validation/m17/results/manifest.json` lists each issue with
   `closed: true/false`; the closure gate only trusts evidence for `closed` issues.

## 4. Honesty rules (non-negotiable)

- Never mark evidence verified unless a fresh rerun at HEAD agrees with the committed file.
- A missing repo or corpus is reported, never silently skipped.
- A fix that can't be verified is not closed — it is documented and left open for reuse.
- The gate itself must pass a planted-mutation test before the milestone can close (X).9.

## 5. Completion record

| Issue | Status | Evidence | Notes |
|-------|--------|----------|-------|
| C1 | CLOSED (#403) | validation/m17/results/C1.json | gate + ledger + wiring (a39fb9f) |
| S1 | CLOSED (#404) | validation/m17/results/S1.json | rake: 26 persisted == 26 live, 34 source-only excluded, 0 bad (dde5df6) |
| S2 | CLOSED (#405) | validation/m17/results/S2.json | rake 26/26 + lodash 9/9; source-only project 0 (da38ac4) |
| P1 | CLOSED (#406) | validation/m17/results/P1.json | rake 70 found == 70 recorded == 70 db; docs (07e5c44) |
| H1 | CLOSED (#407) | validation/m17/results/H1.json | census: 2 persisting tools; no slice in persist; fingerprints stable (cac5283) |
| A8 | CLOSED (#408) | validation/m17/results/A8.json | rake ask 319 == DB 319; no-index honest (168810c) |
| D6 | CLOSED (#409) | validation/m17/results/D6.json | generated docs fresh; BB_* contract + absence checks (de1fa28) |
| X9 | CLOSED (#410) | validation/m17/results/X9.json | planted poison + hollow both fail the gate; restore green (this commit) |

## 6. Definite scope / NEGATIVE list (what M17 does NOT claim)

- M17 proves the **persistence/history** axis. It does not re-prove analyzer AST
  correctness (that is M14 + per-analyzer milestones) and does not claim all
  40+ languages are perfect.
- M17 does not turn heuristics into proofs: "no `unresolved` in history" does
  not mean every detected flow is exploited or exploitable.