# Fix campaign charter — verified bettercap-report defects

Status: ACTIVE. Author: Lead. Created 2026-11-18. Supersedes nothing: the triage deliverable
(`docs/bb-bettercap-triage/`) stays frozen as the evidence base; this directory is the fix campaign's
durable state. Every lane is briefed from THIS file + its own triage finding + `PLAN.md`.

## 0. Mission

Fix the defects verified in `docs/bb-bettercap-triage/PLAN.md` — across the tools and analyzers they
actually live in, not only Go:
P0-1 refactor safety, P0-2 unscoped name binding, P1-1 Go import identity, P1-2 Go cross-file uses
+ package-main span attribution, P1-3 test intelligence, P1-4 response envelope, P2-1..P2-7
(doc scope, search surface, embedding lifecycle, health honesty, label/claims honesty, old-index
compat, dist integrity/ops).

Rule: **a fix is not a fix until a gate that was RED before it is GREEN after it, and a positive
control still passes.** The triage campaign proved the defects; this campaign must not move a number
by weakening a check, deleting a fixture, or re-baselining evidence. If a fix cannot be gated, the
lane stops and reports why.

## 1. Ground truth

- Repo: `/home/ishaq2321/mcp/backbencher-brain`, branch `main`, HEAD `75448b029` (triage commit) or
  later; release state before this campaign: bb 0.1.6, tag `be4c0ef25`.
- Specimens (read-only): bettercap `/home/ishaq2321/bettercap` (never reindex, never write),
  workspace index (MCP scope / `.corpus/` corpora), bb_tests indexes (`gql-gqlgen/graphql`,
  `gql-gqlgen/api`, `gh-cli/internal`). Language diversity comes from `.corpus/` (22 repos) and the
  pre-built indexes; a fresh `bb index` is NOT possible in this sandbox (it cannot create
  `~/.bb/projects/<hash>`), and `/tmp` is per-bash-call ephemeral. Fixtures for new gates must live
  in the repo's own `script/`/`validation/` fixture areas, not `/tmp`, and must be created by the
  test harness itself.
- Each lane's own triage finding is the specification of the defect:
  `docs/bb-bettercap-triage/findings/ISSUE-NN-*.md` (root cause file:line, fix sketch, gate proposal)
  plus `findings/LEAD-FINDINGS.md` (L-1..L-5) and `PLAN.md`. Read them before touching code.

## 2. Team and ownership (one owner per file)

| lane | fix scope | source files it OWNS (edit only these) | triage finding |
|---|---|---|---|
| `edit-safety` | P0-1 refactor safety: span fallback, qualified-reference classifier, zero-site completeness refusal, verification gate | `src/intelligence/edit/**`, `src/ast/safety-primitives.ts`, `script/m13/verify-edit-rename.ts`, `script/m71/**`, `docs/BB_EDIT.md` | ISSUE-01, PLAN §2 |
| `cross-lang` | P0-2 name binding + cross-language: binding gates (external/non-code/same-language), import/package scoping, marker evidence, read-surface basis | `src/ast/parallel-indexer.ts` **resolution passes only** (§~3860–3900 eager, §~5700–6800 deferred/marker), `src/ast/cross-language-intelligence.ts`, `src/ast/cross-language-relationship-mapper.ts`, `src/lsp/evidence_tier.ts`, `src/lsp/cross_language_hover.ts`, `script/m57/**`, new gate under `script/` | LEAD-FINDINGS L-1/L-2, ISSUE-02 |
| `go-imports` | P1-1 Go import identity + P1-2 Go cross-file uses + package-main span attribution (**the single Go-analyzer lane**) | `src/ast/real-go-analyzer.ts`, `src/ast/pool-worker.ts` (Go import plumbing only), `src/intelligence/analysis/dependencies.ts`, `parallel-indexer.ts` **import-classification section only** (§~5090–5100 writes) after P0-2 lands, `script/verify-analyze.ts`, `validation/m14/fixtures/go/**`, `docs/analyzers/go.md` | ISSUE-03, ISSUE-04 |
| `go-testintel` | P1-3 test mapping validation + language-aware quality model | `src/intelligence/testing/**`, `src/intelligence/analysis/test-intel.ts`, `script/verify-test-intel.ts`, `script/verify-test-quality.ts`, `docs/BB_TEST_INTEL.md`, `docs/BB_TEST_QUALITY.md` | ISSUE-05, ISSUE-06 |
| `payload-honesty` | P1-4 summary-first envelope + P2-5 security/visualize label honesty | `src/mcp/tools/shared.ts`, `src/mcp/tools/bb_impact/**`, `src/mcp/tools/bb_graph/**`, `src/intelligence/visualization/**`, `src/intelligence/security/rebuild/registry.ts`, script gates for payloads, docs pages for those tools | ISSUE-10, ISSUE-12 |
| `retrieval` | P2-1 doc scope subject + P2-2 search symbol-mode | `src/intelligence/documentation/**`, `src/intelligence/search/engine.ts` (symbol projection), `src/mcp/tools/bb_doc/**`, `src/mcp/tools/bb_search/**`, `src/cli/onboard.ts`, `docs/BB_DOC.md`, `docs/BB_SEARCH.md` | ISSUE-07, ISSUE-08 |
| `embeddings-health` | P2-3 provider lifecycle/backfill/fallback + P2-4 health status honesty | `src/intelligence/search/semantic-search.ts`, `src/intelligence/health/**`, `src/ast/index-status.ts`, `src/cli/index.ts`, `src/setup/**`, embedding persistence, `docs/EMBEDDINGS.md`, `docs/BB_HEALTH.md`; `parallel-indexer.ts` embedding-reconcile section (§~2950–3050) ONLY if unavoidable, with Lead notice | ISSUE-09, ISSUE-11 |
| `go-callgraph` | independent verifier + build/verification coordinator + P2-6 old-index compat + P2-7 dist integrity | verifier: no source edits in wave 1; P2-6/P2-7 later: read-path DB open/schema compat (`src/brain/database.ts` readers), `script/verify-dist-integrity.ts`, ops notes | UNLOCKED entries (payload U10.1, edit-safety U1) |

**Hot files** (two lanes named above share one file). Rules: (a) the first-named lane owns the file in
that wave; (b) the second lane must wait for a Lead message that the first lane's change is committed,
then rebase its own edit; (c) never run a repo-wide formatter on a hot file; (d) if an edit returns
`FS_STALE_VERSION`, re-read and re-apply, do not force. `src/ast/parallel-indexer.ts` is the hottest:
P0-2 (cross-lang) wave 1 → Go import plumbing (go-imports) wave 2.

## 3. Wave plan and dependencies

- **Wave 1 (start now, parallel):** `edit-safety` (P0-1), `cross-lang` (P0-2), `go-testintel` (P1-3),
  `payload-honesty` (P1-4 + P2-5), `retrieval` (P2-1/P2-2), `embeddings-health` (P2-3/P2-4),
  `go-imports` **phase 1 only** (Go analyzer-local: isExternal declaration, GO1 cross-file uses,
  package-main span attribution, fixtures/gates — NO `parallel-indexer.ts`, NO `dependencies.ts`
  Go-resolution branch yet), `go-callgraph` baseline gate run + verifier harness (no product edits).
- **Integration checkpoint 1 (Lead):** typecheck, build, run every lane's gate, independent
  verifier pass, commit. Unblocks go-imports phase 2 (P1-1 indexer plumbing + dependencies resolver,
  built on P0-2's resolver).
- **Wave 2:** go-imports phase 2; cross-cutting e2e verification on bettercap + one non-Go project
  (`gql-gqlgen/graphql` Go cross-check, workspace `.corpus/axios` JS, `gh-cli/internal` Go); P2-6/P2-7.
- **Final:** full relevant verify-suite slice, docs truth gates, triage-defect re-run on bettercap
  proving each reported symptom gone, final report in `docs/bb-bettercap-fix/FINAL.md`, commit.

Task dependencies on the shared task board encode this; a lane starts only when its task is `ready`.

## 4. Gate protocol (non-negotiable)

For each defect the lane must, in order:

1. **RED first.** Write/extend the gate test in the repo's own harness style (`tsx` script under
   `script/`), run it at the unmodified code, capture the failing output (evidence file), and report
   the RED line to Lead. A gate that does not fail pre-fix is not a gate — fix the gate.
2. **Positive control.** The gate must also assert that the legitimate behavior still works (Go
   same-module import stays internal; genuine cross-language bridge survives; same-package
   unqualified rename still renames; table tests score assertions; a real impact answer keeps its
   counts). State the control explicitly in the report.
3. **Fix.** Minimal, root-caused change in the lane's owned files only. No drive-by refactors, no
   formatting-only churn across files, no dependency changes, no build-system changes.
4. **GREEN + suite.** Re-run the new gate and the most relevant existing gates/scripts
   (`script/m13/verify-*`, `script/verify-*`, `script/m57/*`, etc. — the lane's finding names them);
   run `npx tsc --noEmit` before reporting. A fix that regresses another gate is not done.
5. **Evidence.** Write raw outputs to `docs/bb-bettercap-fix/evidence/<lane>/` and a status page
   `docs/bb-bettercap-fix/<lane>.md` (state: RED evidence, fix commit/file list, GREEN evidence,
   controls, open issues). Keep it updated; it is the lane's durable handoff.
6. **Report** to Lead with: task id, status, files changed (paths), gate command + RED/GREEN result,
   control result, remaining risks.

No weakening of assertions, no skipped tests, no updated baselines to make a gate pass, no
`--force`-style escapes. If the honest fix is large, report the split rather than half-fixing.

## 5. Build and environment protocol

- **Only the build coordinator (`go-callgraph`) and the Lead run `npm run build`.** Lanes run gates via
  `npx tsx script/...` (source-level) — the compiled `dist/` is not needed for those and concurrent
  builds corrupt it (this is exactly the `database-HE6EE3VA.js` stale-chunk failure the triage found).
- The CLI (`node bin/bb`) reads `dist/`. E2E CLI verification happens at integration checkpoints after
  the coordinator builds; request it instead of building yourself.
- `/tmp` is per-bash-call ephemeral; use `.tools/triage-fix/<lane>/` for scratch and repo fixtures for
  committed test data. Do not index new project dirs (sandbox blocks `~/.bb/projects/<hash>` create).
- One bb CLI process at a time per lane; bettercap is never written or reindexed; DB reads are
  `sqlite3 -readonly` only.
- No destructive git commands. Do not rewrite another lane's files or docs. Never touch
  `docs/bb-bettercap-triage/` (frozen evidence).

## 6. Reporting rhythm

- Claim the shared task first (`team_task_get` → `team_task_update action=claim` with the current
  revision), then work.
- Milestone messages to `lead`: (a) within ~20 min: RED evidence + fix plan; (b) when GREEN with
  controls; (c) immediately if blocked or if a root cause contradicts the triage finding.
- Final lane message: the same compact summary, task marked complete by the lane.
- The Lead updates `docs/bb-bettercap-fix/BOARD.md` after each checkpoint; only the Lead edits it.

## 7. Definition of done (per lane)

Gate exists and is RED on pre-fix bytes, GREEN after; positive control green; `npx tsc --noEmit`
clean for touched files; relevant verify scripts pass; lane status page + evidence written; task
completed; Lead's independent verifier (`go-callgraph`) re-ran the gate and agrees; the user-visible
symptom from the triage finding is reproduced as gone on bettercap (or the non-Go specimen named in
the finding). Anything short of that is reported as PARTIAL with the exact gap.
