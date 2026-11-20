# embeddings-health — P2-3 / P2-4 lane status (GREEN)

Task: `task-15` (claimed rev 2) · Lane: `embeddings-health`
Product: HEAD `75448b029` (fix campaign base; triage specimens from `be4c0ef25`), bb 0.1.6, 2026-11-18.
Read-only specimens: bettercap (`/home/ishaq2321/bettercap`, never reindexed/written), workspace index
(MCP). The user's `~/.bb/config.json` was **never** modified (both gates hash it before/after and assert
equality); provider behavior was mocked with `BB_EMBEDDING_*` env + a loopback OpenAI-compatible server.

Status: **GREEN** — both gates PASS, positive controls PASS, `npx tsc --noEmit` clean (whole repo,
0 errors), `script/verify-semantic.ts` PASS, `script/verify-health.ts` PASS, and the user-visible
bettercap symptom is reproduced as gone at source level. The `embedOutcome` durability item that
was PARTIAL at CP1 is now **FIXED** (see §7.1: durable `brain_project_meta` record + health surface + gate).

## 1. Defects fixed (from triage ISSUE-09 / ISSUE-11, PLAN P2-3 / P2-4)

1. **Read path hard-filtered to the under-covered configured space** (`semantic-search.ts:329-333`).
   After a provider change the index can hold thousands of vectors from the previous/local space and
   almost none from the configured model (bettercap: 1/55,785 vs 23,924 local). The query was embedded
   into the configured space, the scan filtered to it, and the answer degraded to a keyword fallback
   that never named the populated space. → **declared populated-space fallback** via a shared pure
   planner; the query is re-embedded with the fallback model (never a cross-space compare), and the
   line/provenance declare `configured-model-space-under-covered` + the pending backfill.
2. **No durable "backfill pending" state.** The reconcile pass exists but runs only inside `bb index`,
   stops after two stalled batches, and records nothing. → the state is now DERIVED from durable
   per-space rows (configured model vs symbol count, 5% floor) and surfaced by `bb_health`
   (`embeddings.configured`, `EMBEDDINGS_BACKFILL_PENDING`, the `BACKFILL PENDING` line) and by
   `bb_ask` (retrieval `reason=` + provenance unknown). The CLI reconcile message says
   `BACKFILL PENDING` when symbols remain.
3. **Index-time local degradation was log.debug only.** Rows already record their model, so the
   degradation is now *reported* (per-space coverage + pending warning) instead of inferred as a
   single percentage. (The per-run outcome is now durable — §7.1.)
4. **`status=complete` printed beside `indexedFiles<N — INCOMPLETE`.** Status is now DERIVED from
   every completion cause (`deriveIndexCompleteness` in the health provider): deliberate
   `skippedFiles` vs unexplained write/parse loss; a bare `status=complete` can no longer print beside
   a shortfall (`status=incomplete (recordedStatus=complete contradicts the counts)`).
5. **Wrong remedy (`force=true to rebuild from scratch`).** The one bettercap "missing" file is a
   deliberate >5 MB size-tier skip (`modules/ui/ui/vendor.js`, 5,430,946 B) that `force` re-skips
   forever. → new `SKIPPED_FILES` warning names the cause and the real options; `INCOMPLETE_INDEX`
   (error) is reserved for the unexplained remainder a rebuild actually fixes.
6. **Syntax attribution was one blob.** `[SYNTAX_ERRORS]` now groups by lane:
   `24 indexed files have syntax errors (less (CSS grammar): 16, scss (SCSS grammar): 8)` — measured
   from `brain_file.language` + the path, so one count no longer implies one fix.
7. **Coverage line conflated two spaces.** `embeddings:` now prints library-wide coverage AND the
   configured model's space + `BACKFILL PENDING`; `EMBEDDINGS_BACKFILL_PENDING` names the declared
   `bb_ask` fallback. `bb doctor`'s model-mixed/mismatch remedy now names the reconcile/backfill
   (`bb index`) and explains `--force` is the full re-parse, not the required first step.

## 2. Changed files

Product (all inside the lane's owned scope, except the new module allowed by Lead):
- `src/brain/semantic/embedding-spaces.ts` **NEW** — pure planner (`planEmbeddingSpaces`,
  `readEmbeddingSpaces`, `resolveConfiguredEmbeddingModel`, `MIN_CONFIGURED_SPACE_COVERAGE = 0.05`).
- `src/intelligence/search/semantic-search.ts` — declared space fallback; `fallbackReason`
  `configured-model-space-under-covered`; pending-backfill provenance; keyword fallback now carries
  the compared model/dimension instead of hardcoded `none` (also fixes triage UNLOCKED U1 in the same
  file).
- `src/intelligence/health/health-provider.ts` — `deriveIndexCompleteness` (exported pure helper +
  types), derived status in the index line, `SKIPPED_FILES`/cause-aware `INCOMPLETE_INDEX`,
  per-space embeddings payload + line, `EMBEDDINGS_BACKFILL_PENDING`, language-grouped syntax warning.
- `src/setup/doctor.ts` — foreign-model/mismatch remedy names reconcile/backfill, not only `--force`.
- `src/cli/index.ts` — reconcile output says `BACKFILL PENDING` and points at `bb health`.
- `docs/EMBEDDINGS.md` — §2b provider-change/space-plan table, two new fallback rungs, two-space
  coverage semantics.
- `docs/BB_HEALTH.md` — derived index status, skip-cause remedies, two-space embeddings line, syntax
  attribution.
- Gates: `script/verify-embedding-lifecycle.ts` **NEW**, `script/verify-health-honesty.ts` **NEW**.

Not touched: `src/ast/parallel-indexer.ts` (hot file / off-limits without a Lead window). No build,
no dependency change, no product rule weakened.

## 3. RED evidence (pre-fix bytes)

- `docs/bb-bettercap-fix/evidence/embeddings-health/01-gate-embedding-lifecycle-RED.txt` — leg A
  (provider switched: 1 configured row, populated local space) returned
  `method=keyword-fallback queryModel=none fallbackReason=no-vector-above-threshold comparable=1/N`;
  4 FAIL (A2 hard-filter, A3 not from populated space, A4 undeclared, A5 pending not named);
  controls already green (backfilled configured space answered with vectors; no config mutation).
- `.../02-gate-health-honesty-RED.txt` — fabricated bettercap counters on a fixture index:
  `index: … 1972/1973 — INCOMPLETE … status=complete`; 8 FAIL (R2 status contradiction, R3 no derived
  status, R4 force remedy, R5 no skip cause, R8 no per-language syntax counts, R9/R10/R11 single-space
  coverage / no pending state); C1/C2 controls green.

**Gate-refinement note (honest record):** after the first RED run the lifecycle fixture was enlarged
from 3 to 24 symbols because 1/3 = 33% sat ABOVE the 5% coverage floor (the gate was not exercising the
under-covered path) and the query was made to clear the local 0.5 similarity floor so the asserted
outcome is the measured bettercap one (`method=vector` from the local space). The failing legs are the
same defect; the formal RED output above is the pre-refinement run. No product edit was made to obtain
RED.

## 4. GREEN evidence + controls

- `.../05-gates-GREEN-final.txt` (and `03`/`04`): **both gates PASS**, exit 0.
  - lifecycle: `leg A: method=vector queryModel=local-word-vectors-v3 fallbackReason=configured-model-space-under-covered comparable=23/24`;
    A1-A6 ok (A5/A6 prove the configured model + `backfill pending` are named in provenance).
  - controls: leg B (configured space fully backfilled) `method=vector queryModel=test/configured-embed
    fallbackReason=none` B1-B4 ok; `C1/C3: user embedding config was not mutated` ok.
  - health: index line
    `indexedFiles=1972/1973 — INCOMPLETE, 1 file(s) … (deliberate skip; force will not fix it) status=incomplete (recordedStatus=complete contradicts the counts)`;
    embeddings line
    `… 42.9% of symbols (library-wide, 23,925/55,785 across 2 space(s)) · configured nvidia/…: 0% (1/55,785) — BACKFILL PENDING`;
    warning codes `SYNTAX_ERRORS,SKIPPED_FILES,EMBEDDINGS_BACKFILL_PENDING`; R1-R11 ok;
    control C1 `status=complete` on a genuinely complete run, C2 no INCOMPLETE on a complete run,
    C3 no config mutation.
- `.../06-verify-semantic.txt` — `SEMANTIC: PASS` (model/width consistency, read-only open, legacy
  fallbacks intact).
- `.../07-verify-health.txt` — `HEALTH VERIFICATION: PASS`.
- `npx tsc --noEmit` — clean (0 errors, whole repo) at lock time.
- `.../08-bettercap-source-e2e.txt` — **user-visible symptom gone, source level** (dist rebuild is
  CP1's; CLI read through `npx tsx src/cli/index.ts`):
  - `bb_ask` bettercap: `method=vector, queryModel=local-word-vectors-v3, embeddingCoverage=43%
    (23924/55785), reason=configured-model-space-under-covered`; provenance:
    `Configured embedding space nvidia/nemotron-3.5-embed-8b covers 1/55785 symbols (0%) — backfill
    pending. Stored spaces: local-word-vectors-v3:23924, nvidia/nemotron-3.5-embed-8b:1.`
  - `bb health` bettercap: two-space embeddings line + `BACKFILL PENDING`; derived `status=incomplete`;
    `[SYNTAX_ERRORS] … (less (CSS grammar): 16, scss (SCSS grammar): 8)`;
    `[SKIPPED_FILES]` names the deliberate skip and says force re-skips it;
    `[EMBEDDINGS_BACKFILL_PENDING]` names the declared local fallback.
- `.../09-doc-gates.txt`, `10`, `12` — see §7 for the two pre-existing/environmental gate issues
  (not caused by this lane; verified pre-existing via `git show HEAD:docs/EMBEDDINGS.md`).

## 5. Controls (explicit)

| control | assertion | result |
|---|---|---|
| complete run still complete | fixture with indexed==total, no skips → formatted line contains `status=complete`, no INCOMPLETE/SKIPPED warning | PASS (`verify-health-honesty` C1/C2) |
| configured+backfilled space answers semantically | all symbols hold configured-model rows; query embedded by the mock provider → `method=vector`, `queryModel=<configured>`, no fallback reason, results non-empty | PASS (lifecycle B1-B4) |
| no config mutation | sha256 of `~/.bb/config.json` identical before/after both gates | PASS (C1 lifecycle, C3 health) |
| same-space principle preserved | fallback re-embeds the query in the fallback space; scan is still one model+width; `verify-semantic` PASS | PASS |
| read path does not write | no writes added; all new DB reads go through the existing read-only handle | by construction + verify-semantic read-only leg |

## 6. User-visible symptom check (PLAN P2-3/P2-4 verify)

PLAN P2-3: "`bb_ask` on bettercap answers from the 23,924-vector local space with a declared fallback,
or declares 'backfill pending: 1/55,785 in configured space'" → **both**, see §4 `08` evidence.
PLAN P2-4: "`bb health bettercap` shows consistent status, per-language error attribution, two-space
coverage" → **all three**, see §4.

## 7. Deferred / risks (PARTIAL items resolved)

1. **`embedOutcome` durability — FIXED (post-review completion).** Every index run now persists
   `brain_project_meta.last_embed_outcome` (queued/embedded/failed/skipped/dropped/invalid + run time);
   `bb_health` reads it into `embeddings.lastRun`, prints `· last run: N embedded[, N failed][, N
   dropped (queue cap)]` on the `embeddings:` line, and raises `EMBEDDING_RUN_INCOMPLETE` when the
   pass was incomplete (`EMBEDDING_RUN_HISTORY_UNREADABLE` when the record cannot be read, never
   silent). Gate `script/verify-health-honesty.ts` pins it: R12 payload, R13 warning, R14 line, C4
   control (clean run does not warn). Proven on the full bettercap index:
   `{queued:23951, embedded:23951, failed:0, skipped:0, dropped:0, invalid:0}` and
   `embeddings: … · last run: 23951 embedded` in `evidence/final/full-index/health.txt`.
   (Historical gap:]

2. **Pre-existing doc-gate failures (not this lane's change; verified against HEAD):**
   `script/verify-embedding-docs.ts` fails 2 mutant checks because the mutant anchor
   `/further batches are held off by a bounded[^.]*\./` does not exist in `docs/EMBEDDINGS.md` at HEAD
   either (`git show HEAD:docs/EMBEDDINGS.md` has no retry sentence) — the gate's mutant needs fixing
   in its own milestone; the docs contract itself passed 55/57.
   `script/m13/verify-health-docs.ts` crashes under tsx before reading docs
   (`path.resolve(undefined)` at its line 37 — `import.meta.dirname` unavailable in that harness).
   Both are recorded in `09`/`10`/`12` and reported to Lead; neither is caused by this lane.
3. **Dist not rebuilt** (campaign rule: only CP1 coordinator builds). `node bin/bb` reads `dist/`, so
   the shipped CLI still shows pre-fix behavior until the CP1 build; source-level E2E in §4 is the
   pre-build verification. P2-7 owns the dist integrity gate.
4. **`force` remains a valid escape for genuinely unexplained losses** — the new warning says the
   unexplained remainder is what a rebuild can fix; we did not remove the option, only stopped
   recommending it for a cause it cannot fix.

## 8. Evidence index (docs/bb-bettercap-fix/evidence/embeddings-health/)

| file | content |
|---|---|
| `01-gate-embedding-lifecycle-RED.txt` | pre-fix lifecycle gate (4 FAIL) |
| `02-gate-health-honesty-RED.txt` | pre-fix health honesty gate (8 FAIL) |
| `03-gate-embedding-lifecycle-GREEN.txt` | post-fix lifecycle gate (first green, pre-refinement) |
| `04-gate-health-honesty-GREEN.txt` | post-fix health honesty gate (PASS) |
| `05-gates-GREEN-final.txt` | final confirmation: both gates PASS + tsc |
| `06-verify-semantic.txt` | SEMANTIC: PASS |
| `07-verify-health.txt` | HEALTH VERIFICATION: PASS |
| `08-bettercap-source-e2e.txt` | bettercap source-level `bb_ask` + `bb health` (symptom gone) |
| `09-doc-gates.txt` | doc-gate results (pre-existing issues) |
| `10-verify-embedding-docs-full.txt` | full embedding-docs gate output (mutant pre-existing) |
| `11-verify-health-docs-full.txt` | (wrong path attempt; see `12`) |
| `12-verify-health-docs.txt` | m13 health-docs harness crash (environmental) |
