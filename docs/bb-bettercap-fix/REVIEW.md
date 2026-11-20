# REVIEW — second, independent review + re-verification pass on landed `main`

Date 2026-11-20. Tree: clean worktree at `main` HEAD `4a28b12e4` (`.tools/wt-verify2`), bb `0.1.6`.
Method: rebuild + typecheck + run every campaign gate again on the LANDED commit (not the campaign
branch), rerun the read-time symptom script, and redo the write-side proof on a fresh real-source
index. Commands are the documented gate commands (BB_DATA_DIR set; the two env-only friction points
are named below).

## Re-verified on the landed commit

| area | result |
|---|---|
| `npm run build` | exit 0 ("Build success in 1071ms"), 155/156 chunks |
| `npm run verify:dist` | exit 0 — 156 chunks / 1069 refs / entry present |
| `verify-dist-integrity.ts --self-test` | 4/4 — clean copy passes; dangling-chunk (`database-HE6EE3VA` class), missing entry, deleted-but-referenced chunk all caught; real dist untouched |
| `npx tsc --noEmit` | 1 error, **only** `src/ast/real-csharp-analyzer.ts:2719` — another lane's committed change; **0 errors in campaign files** (same single external error exists before our commits) |
| P0-1 edit family | `m71/verify-refactor-safety` 23/23; `m13/verify-edit-rename`, `verify-edit-freshness`, `m15/verify-edit-crossfile`, `verify-edit`, `m13/verify-edit-honesty`, `m15/verify-edit-classification` (37/37) all exit 0 |
| P0-2 | `m57/verify-p02-name-binding` **18/18** (fixture + mutant + bettercap DB-copy arm); m57 t1/t2/t4 exit 0 (real-DB portions skipped by documented env flag) |
| P1-1/P1-2 | `verify-analyze` **ANALYZE: PASS**; Go fixtures **51/51** ("all fixtures pass") |
| P1-3 | `verify-test-intel` PASS; `verify-test-quality` PASS |
| P1-4/P2-5 | `m73/verify-payload-envelope` **78/78**; graph-family gates: `verify-graph` **GRAPH: PASS**, `m65 blindspots` PASS, `m13/verify-analyze-modes` 84/84, `m13/verify-visualize-views` PASS, `m13/verify-visualize-target-literals` PASS, `m13/verify-visualize-owner-fold` **V8 29/29**, `m35/verify-s3-graph-migrate` PASS, `m48/verify-p3-agreement` PASS, `m28/verify-mcp-tools` PASS |
| P2-1/P2-2 | `verify-retrieval-contract` **45/45**; `verify-search-modes` 48/48; `m13/verify-ask-contract` 27/27; `verify-doc` PASS; `verify-health` PASS |
| P2-3/P2-4 | `verify-embedding-lifecycle` PASS · `verify-health-honesty` PASS — both needed the documented `.tools/triage-fix/embeddings-health` parent dir (mkdtemp parent absent in a fresh worktree; same environment-only cause the verifier classified) |
| P2-6 | `script/m-fix/verify-old-index-compat` **P2-6 OLD-INDEX COMPAT: PASS** |
| bettercap read-time symptoms | Lead script on the landed build: **34 pass / 0 fail / 5 deferred** |
| specimen integrity | `/home/ishaq2321/bettercap`: `git status` empty; index DB mtime `Nov 18 17:07` (predates the campaign) — never written |

## Write-side proof redone with the LANDED build
Fresh index of a real bettercap source subset (393 files, `derived: full`, 19,995 symbols):
- refactor dry-run `LoadModules`: **3 files / 3 sites** (`modules/modules.go`, `main.go`,
  `modules/modules_test.go`), `reparsed: passed`, `unresolvedReferences: []`
- `main.go:47 modules.LoadModules` **bound** (metadata `bindingBasis=import-path`), `modules_test.go:16`
  bound; **504** import-path bindings on the index
- func main owns **21** call rows; module symbol **0**
- imports: **326 internal**, **0** same-module marked external
- cross-language name-resolution structural rows: **0**
- GO1 cross-file reads **378**, fabricated function-type parameter rows **0**
- `dependencies(session)`: internal deps **348**, internal dependents **2470**

## Review findings (disclosed)
1. **History scope leak (minor)**: wave-1 commit `380a7e473` accidentally included an +8-line
   **C# lane** edit to `script/m14/ontology-coverage-gate.ts` (the file was in the working tree when
   `script/` was staged). Content is that lane's own correct addition, later superseded/extended by
   its commits; unrelated to the bettercap fixes and no functional risk. Rewriting shared history to
   remove it is not permitted; recorded here instead.
2. **External tsc error on main**: `src/ast/real-csharp-analyzer.ts:2719` is committed by another
   session before our commits and is present at main HEAD; campaign files contribute none.
3. **Known pre-existing caveats unchanged** and already documented: full-specimen reindex blocked by
   the unmodified `_res_contains_targets` 21M-row `SQLITE_FULL` scaling defect; `embedOutcome`
   durability PARTIAL (off-limits reconcile section); `verify-doc-tool-surface` environment-only;
   pre-existing REDs m48-p1/p2, m57 t5/closure/gate-selftest/governance, m13
   visualize-options/honesty.
4. Gate-integrity audit of the legacy envelope adaptations: the only removed lines are
   `return { ok: true, json: JSON.parse(text) }` → `flattenEnvelope(JSON.parse(text))` and two
   `harness.check` lines re-added verbatim inside `flattenEnvelope(...)`; **no assertion deleted or
   relaxed** (predicates unchanged).

## Verdict
The landed `main` commits (`380a7e473` wave 1, `9caaebdde` wave 2, `3ac7a66ac` final report) reproduce
every campaign gate GREEN on the landed tree, both bettercap verification arms (read-time and
write-side subset) pass with the landed build, and the specimen and its index are untouched. The two
items worth the owner's attention are the disclosed history scope leak (1) and the external C#
typecheck error (2); neither affects the campaign's fixes.

## Append: `bb_analyze/handler.ts` working-tree incident (diagnosed + repaired)

**Symptom:** the shared checkout's working tree had `src/mcp/tools/bb_analyze/handler.ts`
syntactically broken (15 `TS1005/TS1434` errors) while the committed file was fine.

**Diagnosis (evidence-backed):**
- The working-tree file was an **uncommitted, very stale copy**: after removing 2 stray lines it is
  byte-identical to the file as of commit `b6d615184` (2026-11-01, "TOOLS CAMPAIGN"), i.e. it had
  lost both `19411d627` (2026-11-16) and the wave-1 CP1 fix `380a7e473` (envelope for
  `bb_analyze mode=impact`, dependency-scope fix, walk-bound fields).
- Two lines had been spliced into a comment block: a leaked instruction fragment
  ("…While the owners work, the remaining Lead infrastructure: the regex policy gate the user asked
  for (AST-based, no text scanning, with an allowlist that requires edge-case tests).") followed by an
  **uncommented** continuation `is the locator; resolve it to a row id here, once.` — the latter is
  parsed as code, which is what produced the syntax errors.
- Root cause: a concurrent session's editor wrote a stale (Nov-1) buffer over the file — a lost
  update — and an instruction sentence was pasted into the comment. The corrupted content never
  reached git (`git status` showed it as modified only; the committed HEAD version is correct).

**Repair:** the corrupted WIP was archived first (`git diff HEAD` patch + full file + the Nov-1
reference copy under `.tools/handler-incident/`, gitignored); the file was then restored from HEAD
(`sha256 82a71896…`). `npx tsc --noEmit` now reports only the pre-existing external C# error
(`src/ast/real-csharp-analyzer.ts`, another lane's committed change); `git status` for the file is
clean, and no unique work was lost (the WIP was a stale snapshot, not new edits).

## Append: lane close-outs (the completion call was premature)

At the time the goal was first marked complete, two lanes had never delivered their closing message or
lane status page: `go-testintel` (P1-3) and `retrieval` (P2-1/P2-2) — both had been cut repeatedly by
harness failures, and the Lead's compiled `STATUS-WAVE1.md` substitute was not their required
close-out. Both lanes were reopened and have now delivered their own pages and final replies; the Lead
re-ran their gates on the landed tree (`verify-test-intel` PASS 24 checks, `verify-test-quality` PASS
56 checks, `verify-retrieval-contract` 45/45) and verified their E2E/probe evidence numbers against
the committed JSON. Pages committed as `41dc91ecc` (go-testintel) and `f3ce5b57a` (retrieval).
Remaining items are the lanes' declared follow-ups, listed in `FINAL.md` §"Post-review correction".

## Append: residual closure

The lane close-outs' declared residuals were then closed: go-testintel's docs rewrite (`39f69b4b5`,
docs-truth gates PASS) and retrieval's R1 engine-level `fileId` identity (`ee45e176d`, retrieval gate
48/48, edit family green, tsc/build/dist clean), plus CLI/dist E2E captures for both lanes and the
old-index typed-refusal check on the CLI door. No lane-declared residual remains open; what remains is
explicitly pre-existing or a declared design limitation (listed in `FINAL.md`).
