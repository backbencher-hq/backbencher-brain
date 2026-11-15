# M72 status ledger

Updated by the Lead; this is the durable state a restarted teammate reads first.
Full plan: `PLAN.md`. Language ownership: `LANGUAGES.md`.

## Done (Lead, Phase 0)

- `src/mcp/tools/bb_security/handler.ts`:
  - live answer starts with the honesty banner + `formatSecurityTierDeclaration()` (registry counts, "unsupported languages are NOT scanned");
  - head says `security leads`, never `security: N critical`;
  - per-lead grade is rendered as `exec|high|medium|low` (stored `critical` is shown as `exec`), each line is `lead: <label> token pair ...`;
  - `recordRun` answer carries the same banner/tier and says `leads recorded`.
- `src/mcp/tools/bb_security/descriptor.ts`: description/summary now say lexical token co-occurrence lead generator, not dataflow/scanner.
- `src/cli/onboard.ts`: TASK_DISAMBIGUATION text for bb_security changed to the lead-generator wording (root AGENTS.md regeneration is task-7).
- `src/intelligence/security/rebuild/spec-types.ts`: frozen contract (tiers, lexical syntax, source/sink/sanitizer rules, evidence, lead).
- `src/intelligence/security/rebuild/registry.ts`: all 53 matrix languages, 36 leads / 17 unsupported / 0 scan, reasons + aliases, tier counts/declaration.
- `src/intelligence/security/rebuild/specs/{index,group-a,group-b}.ts`: aggregation contract; group files are the two spec lanes' write points.
- `docs/m72-security-rebuild/{PLAN,PHASE-0,LANGUAGES}.md`.

## In flight (teammates)

| Task | Owner | Scope |
|---|---|---|
| task-5 | engine-core | matcher/flow/engine + unit tests |
| task-6 | pipeline-store | brain_security_flow table, stale-row deletion, pool-worker/parallel-indexer wiring, legacy gate |
| task-7 | answer-claims | docs/website/onboard honesty, generated pages |
| task-8 | gates-matrix | per-language tier axis, m72 Phase-0/engine/matrix gates, real-corpus defect gate |
| task-9 | specs-a | 18 language specs + fixtures (lane A) |
| task-10 | specs-b | 18 language specs + fixtures (lane B) |

Research input (low-cost model): `validation/m72/research/language-api-candidates.md` (nemotron subagent; advisory, specs lanes verify).

## Next after teammates report

1. Review diffs; run `npx tsc --noEmit`; run the m72 gates and the matrix gate.
2. Wire handler to read `brain_security_flow` (Phase 1) once store + engine + specs exist; keep legacy output only under `BB_SECURITY_LEGACY=1`.
3. Add per-language fixture runner that executes the engine against `validation/m72/fixtures/**` and compares expected leads.
4. Promote a language to `scan` only after its fixture + oracle gate passes (write `validation/m72/promotions/<lang>.json`).
5. Update `validation/tools/bb_security/REAL-CORPUS.json` / supersede it with measured Phase-1 evidence (the parameterized negative must be a failure, not pass:true).

## Verified Phase 0 answer (live handler against this repo's index)

```
⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING
tiers: 0 scan / 36 leads / 17 unsupported (of 53 analyzers) — unsupported languages are NOT scanned by bb_security; leads require manual validation
not scanned by bb_security (no executable source model): css, graphql, hcl, html, json, make, markdown, protobuf, sass, scss, sql, svelte, terraform, toml, vue, xml, yaml — stylesheet text; no executable source/sink surface
leads tier: 35 language(s) present; lexical output only
security leads: 500 resolved pair(s) / 0 unvalidated; lexical grades (not risk): 500 exec / ...
  [exec] lead: SQL injection token pair (porcelainEntries) @ archive/...:81 <- database_read -> database_write
```

`npx tsc --noEmit` for the touched trees: clean (exit 0).

## Phase 1 — verified end-to-end (Lead, this round)

All 35 spec modules (36 code languages via the `tsx` alias) are aggregated; `npx tsc --noEmit` exits 0.

Live pipeline proof on a temp project (source worker, temp `BB_DATA_DIR`, no repo writes):
- TS `db.query("... " + req.body.q)` → one `brain_security_flow` row: `sql_injection/high`, rule `typescript.sql.query`, evidence with source/sink byte offsets, reach path `["typescript.request","x = req.body.q"]`.
- Python `os.environ → os.system` → `command_injection/critical`, rule `python.cmd.os_shell`.
- Go `os.Getenv → exec.Command` → `command_injection/high`, rule `go.sink.exec-command`.
- parameterized TS `db.query("... = ?", [x])` → **no row** (sanitizer exclusion).
- `test/a.test.ts` vulnerable code → **no row** (test-file exclusion).
- edit concatenated → parameterized + `index --changed` → rows 1→0 (stale-row deletion).
- move the function 12 lines down + `--changed` → same stored id (`...typescript.sql.query:67:76`) — ids are line-number-free.
- handler default reads the M72 store: banner + tier line + `leads tier:` + evidence lines + `[leads: showing N of M; offset; page size; more available]`; `limit:1 offset:1` is an empty page with total 1.
- `recordRun` persists the census (first `new=1`; repeat `new=0 repeated=1`); `history:true` returns the runs/findings page.
- Phase-0 gate re-run after these changes: PASS — 37 checks, 37 passed, 0 failed, 0 KNOWN-GAP (the two REAL-CORPUS KNOWN-GAPs flipped to PASS once the corpus evidence was regenerated with the M72 engine; see `PHASE-2.md` §3 for the measured table: graphql-js/rake/rebar3 0 leads, ansible 3 path_traversal, sqlite 6 (5 sql_injection, 1 path_traversal), retired `brain_taint_flow` rows 0 everywhere).

## Release evidence (2026-11-13)

- `npx tsc --noEmit` → exit 0; `npx tsup` → build success (engine chunk emitted; the worker bundle imports it).
- Compiled-CLI proof (not just tsx): `node bin/bb index <tmp ts project>` on a concatenated-SQL TS fixture wrote **1** `brain_security_flow` row (the source path and the dist path agree).
- M72 gates: engine 37/37, matrix 53 languages/21 checks, fixtures 36 languages/36 PASS, phase0 **37/37 with 0 KNOWN-GAP**.
- Legacy security suite (all green): m13 28/28 + 68/68 + 25/25 + 69/69; m15 deep X1-X8 VERIFIED, precision 49/49 (1 documented KNOWN-GAP), regressions ALL PASS; m17 corpus 5/5, history 3/3; m20 58/58 + 22/22 + 39/39; `script/verify-security.ts` 52/52.
- Real-corpus evidence regenerated with the M72 engine (five repos, isolated `BB_DATA_DIR`): graphql-js 0 leads, rake 0, rebar3 0, ansible 3 `path_traversal`, sqlite 6 (5 `sql_injection`, 1 `path_traversal`); retired `brain_taint_flow` rows 0 in every corpus; all six adversarial cases pass (including `parameterized-sql-negative`).
- Public claims: `docs/tools/bb_security.md` (npm-packaged) carries the lead-generator description and the per-project `not scanned by bb_security` declaration and no longer contains "Taint-flow security scan"; `AGENTS.md` onboarding row is regenerated; `git grep` for the two retired taglines over README/docs/website/AGENTS.md returns nothing.

## Phase 2b — in progress

- **2b-1 lead adjudication: DONE.** `script/m72/oracle/label-corpus-leads.ts` reads the 9 leads from the corpus DBs (fails if the count ≠ 9) and writes `validation/m72/oracle/labels.json`. Honest result: **9 leads — 4 vulnerable, 1 safe, 3 unreachable, 1 unknown** (4 of them real injection paths in sqlite's Tcl test commands; 1 correctly-safe `%Q` construction; 4 non-findings the engine surfaced). Explicitly **not** a precision rate: no safe-code denominator exists.
- **2b-2 one-hop reachability: MEASURED, then deliberately not built.** `script/m72/oracle/probe-onehop.ts` (read-only) counted 101,419 stored call edges across the five corpora: 20,759 in graphql-js with `calleeExpression`, **0** in rake/rebar3/ansible/sqlite. Same-file resolution succeeds 1,605 times (TS only) and the number of caller↔callee pairs where one side holds a stored lead is **0**. Conclusion: one-hop would add nothing measurable today; the real blocker is analyzer-level callee capture for non-TS languages. Recorded in `PHASE-2B.md` §2 rather than built.
- **2b-3 labelled fixture corpus: DONE (150 files).** Four families under `validation/m72/oracle/fixtures/<family>/`, each file carrying `class=vulnerable|safe`, `expect=lead|none` and a stated `reason`; `expected.json` per family is machine-readable so the oracle needs no prose parsing.
  - Measured: **code-injection 35 (20 vuln / 15 safe) · command-injection 44 (27 / 17) · path-traversal 32 (16 / 16) · sql-execute 39 (23 / 16) = 150 files, 86 TP / 0 FP / 0 FN** (`npx tsx script/m72/oracle/lib/run-labelled.ts`).
  - **This is a fixture precision over written files, not a corpus precision.** The corpus denominator remains unmeasured.
- **2b-4 CVE-fix oracle: substrate built, 0 evaluable pairs.** `script/m72/oracle/cve-classify.ts` + `script/m72/oracle/lib/cve-diff.ts`, inventory in `validation/m72/oracle/cve/sources.json`.
  - Measured: 199 corpora, **198 shallow single-commit snapshots** (no parent exists); one repo has history (`proxicall`, 6,929 commits, 204 security commits). Chasing all 8 with a parent-side lead showed **every one was a line shift, not a fix** — by content the leads were identical. One genuine hardening (`89ee25709`, SQL identifier allowlist) runs as **`inconclusive`**: the parent had no lead to lose.
  - **Recall is UNMEASURED. No number is reported.** The harness exits 1 when nothing is evaluable and never counts "no parent lead" as a pass.
- **2b-5 promotion per family: 0 promoted, decision recorded.** `validation/m72/promotions/README.md` lists the six-part checklist and marks each unmet leg with its evidence. `scan` stays at **0**.
- **2b-6 lead-density funnel: MEASURED — the constraint is sink presence, not the engine.** `script/m72/oracle/probe-density.ts` over five corpora: 1,247 files → 28,957 symbols → 26,638 non-container → **472 with a source (1.8%) · 201 with a sink (0.8%) · 41 with both → 4 accepted**. Spec coverage is *not* the cause (every lead-tier spec declares 5–11 sinks, median 9, and none has zero). graphql-js is a **library** with no request handler, no `db.query`, no `res.redirect`, so a zero there is a true negative for that architecture, not a detector gap. Evidence: `validation/m72/results/density.json`.
  - Consequence: whole-repo density measures the *repo kind*, not detector quality, so density is the wrong promotion metric. The honest metric remains per-family precision on real application code, which still needs the CVE-fix oracle or a labelled real-code set.

- **2b-6 component formats: svelte + vue promoted `unsupported` → `leads`.** 6,147 `.svelte` + 1,155 `.vue` files exist across the corpora and were all indexed but never security-scanned; `pool-worker.ts` already extracts their `<script>` blocks as JS-family symbols. New `specs/{svelte,vue}.ts` (5 sources / 10 sinks / 6 sanitizers each) + `specs/component-specs.ts`. **Tier counts now 53 / 38 leads / 15 unsupported / 0 scan.** The other 15 `unsupported` languages are genuinely non-executable (css, scss, sass, html, xml, json, yaml, toml, markdown, protobuf, graphql, sql, hcl, terraform, make).
  - Engine fix this exposed: a source that *declares* a variable (`captureVariable`) and a sink consuming that identifier had no reach path unless an assignment sat between them, so `export let code; eval(code)` produced no lead while `const code = getInput(); eval(code)` did. Fixed in `flow.ts`; 37/37 engine assertions still pass; pinned by component fixtures.
  - Measured on 71 sampled component files: 27 have extractable symbols, 1 genuine lead (`location.hash` → `location.href`). Coverage, not volume: component risk concentrates in template directives (`{@html}`, `v-html`) that the extracted script body cannot contain, so those are documented limits rather than rules that could never fire.

Gate sweep after the 2b additions: engine 37/37, matrix 53/53 (611 checks, 12 negatives), fixtures **38/38**, phase0 37/37 (0 KNOWN-GAP), oracle 150 files 86/0/0; `npx tsc --noEmit` exit 0.

## Phase 1 — in flight

- `script/m72/engine/run.ts`, `script/m72/store/run.ts` proofs (engine-core, pipeline-store).
- per-language fixtures for all lanes (19 fixture dirs today; specs-a/specs-b resuming).
- matrix `securityTier` axis + `verify-security-matrix/engine` gates (gates-matrix; matrix evidence has no tier yet).
- legacy verifier migration table (verifier-legacy).
- docs/website regen for final `limit`/`offset`/recordRun contract (answer-claims).
- Phase 2: per-language fixture gate runner, promotion to `scan`, CVE-fix oracle, regenerate REAL-CORPUS so the parameterized negative is a failure.

## Known red / not yet true

- `scan` tier is empty; no language has passed a precision oracle yet. 150 crafted fixtures is a rule-conformance result, not a real-code precision result.
- Recall is unmeasured: this host's corpora are shallow snapshots and no network is available, so no `(parent, fix)` pair can be formed. Unblock options are in `validation/m72/oracle/cve/README.md` (owner-supplied tarballs or a network policy decision).
- The one-hop reachability question is closed by measurement (zero connectable pairs today); it reopens only when analyzers capture callees for non-TS languages.
- The `bb_security` live answer on this repo still reads old indexed data (the repo index predates M72) until `bb index --post` is run; it declares the engine uninitialized or shows whatever the new table holds, never the retired token rows.
