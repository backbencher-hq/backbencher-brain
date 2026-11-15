<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — Phase A audit of bb_migrate: contract, plan honesty, docs truth, gates,
latency, regex/§9, real MCP door, real-corpus evidence, and the defect register Phase B fixes.
WHO IT IS FOR — the Lead integrating the tools campaign and the permanent owner of bb_migrate.
EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_migrate/{GATES,LATENCY,MCP-DOOR,REAL-CORPUS}.json,
src/mcp/tools/bb_migrate/{handler,descriptor}.ts, src/intelligence/migration/**, script/m13/verify-migrate-*.ts,
script/m20/verify-migration-*.ts.
-->

# bb_migrate — Phase A audit

Audited commit: `755157b7fa1ebb9606a6284699e5b3ff4ff3d060` (2026-11-02). Working tree was clean for
this lane's files at audit start. `npx tsc --noEmit` exit 0 on the audited tree.

**Phase B is complete: see `PHASE-B.md` beside this file.** It records every defect below
with its fix, the command that proved it red and the same command proving it green, six
planted mutants (all killed and byte-restored), the final gate battery, the before/after
latency, the fixed-tree hashes and the final blocked legs. The Phase A register below is
kept unchanged as the red-side evidence.

Scope read: `src/mcp/tools/bb_migrate/{handler,descriptor}.ts`, `src/intelligence/migration/{migration-engine,migration-source,migration-evidence}.ts`,
`src/ast/cross-language-migration-assistant.ts`, `script/tool-docs/curation/bb_migrate.ts`, `docs/tools/bb_migrate.md`,
`docs/BB_MIGRATE.md`, and every gate that names the tool.

Method: every claim below is backed by a command whose exit code or output was read. Raw measurements and
gate logs live beside this file: `raw/*.json`, `logs/*.log`, `REAL-CORPUS.json`, `LATENCY.json`, `GATES.json`,
`MCP-DOOR.json`. Index copies and fixture indexes live under `bbdata/`, `work/`, `realdata/` (gitignored
working state).

## 1 · Defect register

### Critical

| ID | Defect | Evidence |
|---|---|---|
| **C1** | **The read path writes the index.** The handler and `migration-source.ts` open the database through `BrainDatabase.getRawInstance(projectId)` — the read-write open, which runs the additive migrations/healers on every fresh process. One MCP stdio `bb_migrate` read call against a settled index created a **98,912-byte WAL**, and after the process closed the **database bytes had changed** (sha256 `e5a360e7…` → `60ff3fc7…`). A second call in the same process grew the WAL to 197,792 bytes. A direct handler call against a project with no index **created** `projects/<id>/brain.db` and answered `isError: false` (`migration target: python`) instead of refusing. The public MCP and CLI doors refuse unindexed projects before the handler runs, so the creation leg is reachable only through the handler/engine API — but the WAL movement on every indexed read is reachable through the public door. | `raw/door-write-probe.json`, `raw/readonly-probe-before.json` (both docs), `logs/readonly-probe-readonly-before.err` |

Fix: every read open is `getRawInstance(projectId, { readonly: true })`; missing/uninitialised index is the
loud error `getRawInstance` already throws in read-only mode; re-prove `dbUnchanged:true` through both doors.

### High

| ID | Defect | Evidence |
|---|---|---|
| **H1** | **Batch-by-name work is not bounded by the request.** On the T2 reference index a 12-name request loaded **844 symbols / 46,753 relationships** to produce **one** plan (11 names were ambiguous refusals), and measured **p50 9,532 ms / p95 29,041 ms** — over the 5 s read-tool budget and close to the 30 s client timeout. The 100-component cap is applied to request ENTRIES; a name expands to every same-named symbol before the relationship pass runs, so the cap does not bound what is read. This contradicts the tool's own bounded-work claim (`cohort.work` exists to prove it). | `raw/latency-phaseA-t2.json`, `raw/t2-diagnose.json`; `LATENCY.json → tiers.T2` |
| **H2** | **The same component can be planned twice.** `symbolNames:["basePrice","basePrice"]` returned **two identical plans** while reporting `truncation.deduplicated: 1` (a count that implies they were merged). A name plus its own symbol id also plans twice — the pre-existing `m65/verify-migrate-selectors` check fails exactly there: `plans 2 (2 for the component)`. Duplicate plans double-count the 4 h base charge and lie about the reduction. | `raw/door-extra-t0.json`, `logs/bun_script_m65_verify-migrate-selectors.log` |
| **H3** | **`symbolName` is silently dropped when `symbolNames` is present.** `{symbolName:"basePrice", symbolNames:["applyDiscount"]}` planned only `applyDiscount`; `basePrice` vanished with no `unsupported` entry. The descriptor calls `symbolName` a legacy alias, so a caller supplying both loses a component without a trace. | `raw/door-extra-t0.json → both-name-forms` |
| **H4** | **Docs claim a refusal the tool does not perform.** `docs/BB_MIGRATE.md` says a target with no route is refused as `unsupported-target` (`go → haskell`). The code plans a KNOWN target with the missing-data gap declared; only an unknown target is refused (`normalizeMigrationLanguage` gate in `buildPlan`). | `src/ast/cross-language-migration-assistant.ts:1409-1470`; `REAL-CORPUS.json` unrouted cases (all four repos) |

### Medium

| ID | Defect | Evidence |
|---|---|---|
| **M1** | **First call cost.** First handler call in a cold process on T2 measured **9,793.7 ms** (T0 33.4 ms, T1 207.6 ms) because of the read-write open (C1). | `raw/latency-phaseA-t*.json → firstCall` |
| **M2** | **Blank entries are silently dropped instead of refused.** `symbolNames:["","  "]` → success, 0 plans, `requested: 0`; `paths:[""]` → success, 0 plans. A request that names nothing is answered as a clean empty page. The handler's guard is `symbolNames.length`, not non-blank content. | `raw/door-extra-t0.json` |
| **M3** | **Blank `targetLanguage` is accepted.** `targetLanguage:"   "` in text mode returned `isError:false` with `migration target: ` and 0 plans. The handler checks truthiness before trimming. | `raw/door-edges-t0.json` |
| **M4** | **Stale/missing remediation text promises a capability the tool does not have.** Text footer and JSON `freshness.remediation` say "reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false". `bb_migrate` never auto-refreshes and has no `refresh` option; the handler imports `FRESHNESS_REMEDIATION_MANUAL_ONLY` and does not use it. The generated page's Staleness section repeats the same false sentence (generator is Lead-owned). | `raw/door-stale.json`, `raw/door-stale-missing.json`, `docs/tools/bb_migrate.md` Staleness |
| **M5** | **The dictionary audit is red and the docs quote stale numbers.** `m20/verify-migration-dictionary.ts` fails `M4: no declared non-import key is missing` for `react context`, `next.js`, `tailwind` — those rows were renamed when the source/target tables were un-inverted (`react`, `next`, `tailwindcss`), so the gate's declared list is stale. The measured declared class is **53 of 486 rows (10.9%)**, not the 56/11.5% in the curation and `docs/BB_MIGRATE.md`; the "mis-keyed dart→typescript block" that the docs describe no longer exists. | `logs/run_script_m20_verify-migration-dictionary.log`, `raw/route-matrix.json`, `script/tool-docs/curation/bb_migrate.ts` |
| **M6** | **Dead imports and banned process-attribution comments in the handler.** `handler.ts` imports 30+ symbols it never uses (left over from the monolith split), and the import block carries `M28.T1 (issue #624)`, `M48.P1 (#696)`, `M55.T5 / §15.1`, `M35.S3` — §9 violations. The three `src/intelligence/migration/**` files have no §8 author header. | `src/mcp/tools/bb_migrate/handler.ts:12-54`; grep inventory §8 |
| **M7** | **Malformed cohort statement and misplaced advice.** With no language buckets the statement reads `The cohort's language mix is ; the 0 component(s)…`, and the "so scope paths to the code you mean" advice is appended to refusals caused by the TARGET language, where scoping paths cannot help. | `raw/door-edges-t0.json → missing-name-json, unknown-target-json` |
| **M8** | **m13 docs gate is red on a stale anchor and a fleet-red dependency.** `doc.split("\n")[2]` is now the blank line inside the generated page's author header, and the gate spawns the FULL docs generator instead of `--only bb_migrate`. | `logs/bun_script_m13_verify-migrate-docs.log` |
| **M9** | **m13 e2e gate is red because the MCP child loses BB_DATA_DIR.** `StdioClientTransport` inherits the SDK's allowlisted environment; the fixture index is invisible to the child (`No index found for /tmp/bb-mig-mcp-…`). This is the exact defect LEAD-FINDINGS records fixed in `script/verify-mcp.ts`; the migrate gate was not fixed with it. | `logs/bun_script_m13_verify-migrate-e2e-corpus.log` |
| **M10** | **The `symbolIds` example cannot be a real id.** Descriptor/curation/docs show `["sym_01H..."]`; real ids are `<projectId>:<relative file>:<name>:<line>` (e.g. `1d3d57…:lib/elixir/src/elixir_expand.erl:format_error:1169`). A caller copying the example gets `missing-symbol`. | `src/mcp/tools/bb_migrate/descriptor.ts:24`, `docs/tools/bb_migrate.md`, `REAL-CORPUS.json → cases single-cross-language` |
| **M11** | **Docs truth: BB_MIGRATE.md is process narrative, not a reference.** No §8 markdown header; "round 1/3/6/…", "the lane", "my first version", "I had treated", "six rounds" throughout (§9); truncation fields are described in name-only terms after ids/paths landed; "a 12-symbol request stays in the same order of magnitude" is contradicted by H1; the dictionary section carries M5's stale counts and the deleted mis-keyed block; H4's "no route → refused" sentence is wrong. | `docs/BB_MIGRATE.md` (read in full), grep inventory §9 |

### Low

| ID | Defect | Evidence |
|---|---|---|
| **L1** | `m13/verify-migrate-accuracy.ts` is a text-scan gate: it asserts substrings like `!engineSrc.includes("generateTargetCode")`, which passes when a feature is absent for unrelated reasons. It cannot catch any H-level defect. Strengthen in Phase B with behavioural checks and a planted mutant. | `script/m13/verify-migrate-accuracy.ts` |
| **L2** | `m15/verify-visualize-migrate-deep.ts` crashes on the post-split registry (`reg.split('name: "bb_visualize"')`); cross-scope shared gate — reported to the Lead, not edited here. | `logs/bun_script_m15_verify-visualize-migrate-deep.log` |
| **L3** | `refusedByReason` and `cohort.byLanguage.refused` attribute a refusal to a language by matching the refused NAME against loaded symbols; two same-named symbols can be attributed to the wrong bucket. | `migration-engine.ts` language-bucket pass |
| **L4** | T2 measurements ran at load average **26.27 / 10.61 / 4.65** (shared fleet); the p50 is the honest figure and p95 is contended. Declared, not averaged away. | `LATENCY.json → environment` |
| **L5** | 22 regex uses in this lane's files (handler 2, migration-source 4, cross-language assistant 16); the assistant file is outside `verify-regex-policy.ts` scan roots, so 16 are invisible debt. All are convertible to explicit string operations and are paid down in Phase B. | `raw/regex-inventory.json` |

### Behaviours that LOOK like defects and are not

* **Same-language and unknown-target requests answer `isError:false` with an `unsupported` entry.** These are
  per-component refusals in a batch answer, not request-level input errors: the payload names the reason
  (`same-language`, `unsupported-target`), plans 0 components, and says `NO PLANS WERE PRODUCED`. The door
  cannot distinguish "batch produced refusals" from "batch produced plans" by `isError` without breaking the
  batch semantics; the descriptor and docs describe them as unsupported cases. Keep as data.
* **`planMigrationById` with no match is refused as `missing-symbol`.** Correct: an id that no symbol carries
  must be reported, and the handler turns it into an `isError` naming the id.
* **A recently-indexed plan is not stale.** `freshness.mode:"complete"`, `stale:0`, per-plan `stale:false` on a
  just-built index; a changed file flips `plan.stale` plus the up-front notice; a deleted file counts in
  `freshness.missing` and keeps the plan (the plan is a claim about the indexed component, and the footer
  names the missing file). All three legs verified through the door.

## 2 · Contract audit (descriptor ↔ handler ↔ engine)

| Contract point | Descriptor | Handler/engine | Verdict |
|---|---|---|---|
| Subject selection | `symbolName`, `symbolNames`, `paths`, `symbolIds`, `targetLanguage`; required `targetLanguage` | handler accepts subject as any of names/ids/paths and refuses when all are empty; `symbolName` alias | matches, except H3 (silent alias drop) and M2 (blank entries) |
| `targetLanguage` required | `required:["targetLanguage"]` | shared door refuses missing; handler refuses falsy; blank string is not falsy in text mode (M3) | M3 |
| `format` default text, enum text/json | enum documented | handler treats only `"json"` specially, everything else renders text; the door's enum validation refuses other values, so the handler's tolerance is unreachable through the public door | matches on the public surface |
| 100-component cap | documented in curation/docs | cap over ENTRIES; `capped`/`cappedNames`, identity `requested = returned + capped` does not account for H2 duplicates | truncation identity corrected in Phase B |
| Refusals | error cases list missing language/subject/path/unknown option | docs also refuse unknown target, same-language, unsupported-source, ambiguous, missing-symbol as payload data | docs should say request-level vs data-level |
| Unsupported cases | narration | engine emits typed reasons: `missing-symbol`, `ambiguous-symbol` (+candidates), `same-language`, `unsupported-target`, `unsupported-source` | matches |
| Dependency order / waves / scope / effort / methodology | descriptor description names ordering/effort/mappings/risks/truncation/unsupported | all present in the result; arithmetic identities hold on real corpora (REAL-CORPUS 4/4 effort checks + negative control) | matches |
| Staleness | `freshnessModes:["plan"]`, JSON envelope | handler builds envelope + per-plan `stale`; text notice/footer; remediation text false (M4) | M4 |
| Mutability read / requiresIndex true | declared | read-only SHOULD hold; currently opens read-write (C1) | C1 |

## 3 · Plan honesty, measured

* **Dependency order.** `dependencyOrder` respects every in-scope edge on all four real corpora
  (`order` check + reversed-order negative control in `REAL-CORPUS.json`); `orderingStatus` distinguishes
  `complete`/`partial`/`cyclic`/`no-edges`; the wave plan accounts for every plan exactly once (wave-partition
  check + plant). Cycles are accounted for as a trailing wave.
* **Effort vs measured.** `totalHours = 4·plans + 2·distinct-chargeable-edges + 6·unmapped-libraries` holds on
  every real plan; the per-kind split sums to `relationshipHours`; `perPlanSum − total = sharedRelationshipHours`
  and is never negative on real corpora. The constants are declared as methodology, not fitted.
* **Library mappings.** Dependencies carry only observed imports; an unrouted pair carries `target:null`,
  `confidence:0`, `status:"uncertain"` plus the `MISSING DATA` note and a risk factor — no invented target
  (verified on elixir/rebar3/clojure/graphql-js with the `inventedTargets` check). H4/M5 are docs/gate issues,
  not fabrication.
* **Unsupported cases.** All five typed reasons observed on real corpora; ambiguous names return candidate ids
  that resolve to exactly one plan; a bogus id is an `isError` naming the id.
* **Truncation.** A directory cohort on real corpora returns ≤100 plans and names every dropped component
  (`cappedNames.length === capped`); `requested = returned + capped` holds on single/batch shapes; H2 breaks it
  for duplicate requests (Phase B fixes the identity).
* **Stale-plan flags.** Changed file → `plan.stale:true` + `⚠ N of M plans reference files changed`; deleted
  file → `freshness.missing` + footer; fresh index → clean envelope. All through the door.

## 4 · Docs truth

`docs/tools/bb_migrate.md` is byte-congruent with the registry+curation (`verify-tool-docs --only bb_migrate`
exit 0). Its Staleness section repeats the false auto-refresh sentence (M4, generator-owned) and its
limitations quote the stale dictionary census (M5, curation-owned). `docs/BB_MIGRATE.md` needs the Phase B
rewrite (M11). The descriptor/curation examples need real id shapes (M10).

## 5 · Gates (command → exit; full table in `GATES.json`)

| Gate | Command | Exit | Status |
|---|---|---|---|
| M13 M1 | `npx tsx script/m13/verify-migrate-accuracy.ts` | 0 | verified 9/9, 2 negatives (shallow — L1) |
| M13 M2 | `bun run script/m13/verify-migrate-e2e-corpus.ts` | 1 | known-gap: MCP env dropped (M9) |
| M13 M3 | `bun run script/m13/verify-migrate-docs.ts` | 1 | known-gap: stale anchor + full generator (M8) |
| M20 order | `bun run script/m20/verify-migration-order.ts` | 0 | verified 13/13, 3 negatives |
| M20 methodology | `bun run script/m20/verify-migration-methodology.ts` | 0 | verified 17/17, 3 negatives |
| M20 mappings | `bun run script/m20/verify-migration-mappings.ts` | 0 | verified 15/15, 5 negatives |
| M20 dictionary | `bun run script/m20/verify-migration-dictionary.ts` | 1 | known-gap 29/30 (M5) |
| M35 S3 | `bun run script/m35/verify-s3-graph-migrate.ts` | 0 | verified |
| M48 C2 | `bun run script/m48/verify-c2-edge-mutations.ts` | 0 | verified 73/0/3 (includes bb_migrate calm + required-refusal rows) |
| M48 P4 | `bun run script/m48/verify-p4-param-matrix.ts` | 0 | verified 10/0/2 |
| M65 latency | `bun run script/m65/verify-migrate-latency.ts` | 0 | verified, negative controls included |
| M65 selectors | `bun run script/m65/verify-migrate-selectors.ts` | 1 | **failed — H2 reproduced** |
| M15 deep | `bun run script/m15/verify-visualize-migrate-deep.ts` | 2 | blocked/cross-scope crash (L2) |
| visualize-migrate | `bun run script/verify-visualize-migrate.ts` | 0 | verified |
| docs-only | `npx tsx script/verify-tool-docs.ts --only bb_migrate` | 0 | verified |
| M31 corpus | `bun run script/m31/tool-mode-corpus.ts --check` | 1 | blocked/fleet-wide; bb_migrate row NOT drifting |
| M31 doc truth | `bun run script/m31/verify-bb-docs-truth.ts` | 1 | blocked/other lanes (BB_EDIT, BB_HEALTH) |
| regex policy | `npx tsx script/tools/verify-regex-policy.ts` | 0 | PASS, 0 new |
| typecheck | `npx tsc --noEmit` | 0 | clean |
| evidence format | all gate rows emit machine-readable JSON under `validation/m13|m20|m65` | — | read |

## 6 · Latency (full data in `LATENCY.json`)

| Tier | Population | Shape | p50 / p95 ms | Budget | Verdict |
|---|---|---|---|---|---|
| T0 | 5 files / 13 sym / 26 rels | single text | 6.4 / 7.3 | 250 p95 | PASS |
| T0 | | single JSON | 4.4 / 6.7 | | PASS |
| T0 | | 12 names | 5.9 / 12.5 | | PASS |
| T0 | | dir cohort | 6.2 / 9.0 | | PASS |
| T1 | 97 / 3,512 / 17,068 | single text | 19.7 / 24.0 | 1,000 | PASS |
| T1 | | 12 names | 95.3 / 102.2 | | PASS |
| T1 | | dir cohort | 73.3 / 88.7 | | PASS |
| T2 | 6,452 / 310,423 / 820,040; db 3,639,963,648 B; mtime 2026-11-02T04:29:55Z (copy: 2026-11-01T22:22:08Z) | single text | **805.2 / 909.3** | 5,000 | PASS |
| T2 | | single JSON | **1,054.9 / 2,310.5** | | PASS |
| T2 | | 12 names | **9,532 / 29,041** | 5,000 | **FAIL (H1)** |
| T2 | | first call, cold | **9,793.7** | | **FAIL (C1)** |
| T2 | | dir cohort | — | | BLOCKED: reference index predates the split (no `src/mcp` paths); tool refused by name |
| Real corpus | elixir 692 f / 14,725 s / 77,697 r | single JSON, door | 41 / 90 | | PASS |
| Real corpus | rebar3 303 / 7,012 / 38,143 | single JSON, door | 60 / 80 | | PASS |
| Real corpus | clojure 347 / 12,764 / 65,458 | single JSON, door | 74 / 91 | | PASS |
| Real corpus | graphql-js 564 / 13,620 / 61,917 | single JSON, door | 123 / 248 | | PASS |

Load averages recorded at measurement: T0 3.06/3.43/6.75, T1 4.74/3.79/6.73, T2 26.27/10.61/4.65.
`BB_NO_AUTO_REFRESH=1` on every measurement; T2 ran on a byte copy so the shared reference index was never
written; the reference itself was read only through the byte-read-only open for counts/mtime.

## 7 · Regex and §9 inventory

Regex (AST inventory, `raw/regex-inventory.json`): **22 uses** — `handler.ts` 2 (path separator), 
`migration-source.ts` 4 (path normalisation and LIKE escaping), `cross-language-migration-assistant.ts` 16
(language-label normalisation, quote stripping, Go module/version rules, node_modules scoping, test-path
detection, import classification, data-shaped classifier). The policy gate passes because these are frozen
baseline debt; the assistant file is not in the gate's scan roots, so its 16 are invisible to it. Phase B
converts all 22 to explicit string operations and adds boundary tests.

§9 banned process-attribution comments found (fix in Phase B):
* `src/mcp/tools/bb_migrate/handler.ts` import block: `M28.T1 (issue #624)`, `M48.P1 (#696)`,
  `M55.T5 / §15.1`, `M35.S3` (all on dead imports that are removed).
* `src/intelligence/migration/migration-source.ts`: "Round 2", "round 6", "reviews/migrate/REVIEW.md".
* `src/intelligence/migration/migration-engine.ts`: `F18`, "Round 1", "Since round 6", `F21`.
* `src/ast/cross-language-migration-assistant.ts`: "round 9", "round 1", "round 3", "Round 2", "round 4".
* `docs/BB_MIGRATE.md`: "the lane", "round 1/3/6/…", "my first version", "I had treated", "six rounds".
No §8 headers on `migration-engine.ts`, `migration-source.ts`, `migration-evidence.ts`, or `docs/BB_MIGRATE.md`.

## 8 · Real MCP stdio door (`MCP-DOOR.json`)

Door: `npx tsx src/mcp/server.ts --dir <project>` with `BB_DATA_DIR` forwarded explicitly and
`BB_NO_AUTO_REFRESH=1`. Protocol: initialize → notifications/initialized → tools/list → tools/call.
Wire hygiene: zero non-JSON stdout lines, no unhandled rejection, no crash across 40+ calls on five
project indexes.

* `bb_migrate` is registered with the expected schema (props, required, `format` enum `text|json`).
* Success cases: single text, single JSON, legacy alias, 2-name batch, name+path union (planned once).
* Refusals observed: missing `targetLanguage`, missing subject, unknown option (teaches accepted set),
  invalid `format` enum, path outside project, bogus symbol id (names the id), blank `symbolName`,
  unindexed project (public door refuses before the handler, with the `bb index` remediation).
* Contract-level data refusals: same-language and unknown-target answer `unsupported` entries, not `isError`.
* Defects reproduced through the door: C1 (write probe), H2 (duplicate plans), H3 (alias drop), M2 (blanks),
  M3 (blank target), M4 (remediation text), M7 (statement wording).

## 9 · Real-corpus evidence (`REAL-CORPUS.json`)

Four repositories from `/home/ishaq2321/bb_tests/repositories`, indexed into
`BB_DATA_DIR=validation/tools/bb_migrate/realdata` (isolated), queried through the real MCP stdio door:
`elixir` (Elixir 10,722 + Erlang 1,215 symbols; 714 cross-language relationships — the Elixir/Erlang pair),
`rebar3` (Erlang), `clojure` (Clojure + Java; 2,759 cross-language), `graphql-js` (TypeScript + JavaScript;
980 cross-language). **82/82 checks, 6 planted negative controls, exit 0.** Covered per repo: single plan by
symbol id with cross-language relationship evidence, 5-name batch accounting, dependency order, wave
partition, effort arithmetic, directory-cohort cap + naming, unknown target, same-language, missing symbol,
bogus id, ambiguous name with resolvable candidate ids, unrouted pair with `MISSING DATA` and no invented
target, freshness envelope. Negative controls prove each predicate can fail: reversed order, unnamed cap,
broken arithmetic, missing freshness, cleared cross-language flags, empty wave plan.

Reproduce: `BB_DATA_DIR=$PWD/validation/tools/bb_migrate/realdata npx tsx validation/tools/bb_migrate/index-real-corpus.ts`
then `BB_DATA_DIR=$PWD/validation/tools/bb_migrate/realdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_migrate/real-corpus.ts`.

## 10 · Blocked legs

1. `m13/verify-migrate-docs`' full-generator dependency (fleet-red mid-campaign; `--only bb_migrate` green).
2. `m15/verify-visualize-migrate-deep` crash at the pre-split registry anchor — outside this task's write
   scope, reported to the Lead.
3. `m48/verify-c1-corpus` not run (corpus-scale central gate; bb_migrate edge cases covered by M48 C2 and
   REAL-CORPUS).
4. T2 directory-cohort shape blocked by the reference index's staleness (the tool refused by name).
5. Compiled (`dist`) door deferred by ruling; all door evidence uses the source entry.
6. Fleet-wide gates red for reasons outside this tool: `m31/tool-mode-corpus` (23 drifting invocations, none
   bb_migrate), `m31/verify-bb-docs-truth` (BB_EDIT/BB_HEALTH fences).

## 11 · Phase B plan (ordered by severity)

1. **C1** — read-only opens in handler + migration-source; unindexed loud error; `dbUnchanged:true` re-proven
   through MCP and CLI doors; re-measure T2 (first-call cost should collapse).
2. **H1** — bound the relationship pass to the components the request will plan/refuse (cheapest correct
   design: resolve/refuse names against symbols first, then load relationships only for planned symbols and
   capped id/path entries); re-measure the 12-name T2 shape; extend `m65/verify-migrate-latency` with a
   loaded-symbols bound on this shape.
3. **H2/H3/M2/M3** — dedupe by resolved symbol identity and make `truncation` identities hold; union
   `symbolName`; refuse blank subject entries/target; door tests.
4. **M4/M7/M10/M11 + M5 curation** — handler remediation text manual-only, cohort statement wording, real id
   examples, rewrite `docs/BB_MIGRATE.md` with §8 header and facts, correct the dictionary census in the
   curation and generated page; m20 dictionary declared list repaired (M5).
5. **M6/L5** — delete dead imports, §8 headers, convert all 22 regexes to string operations with boundary
   tests, regex-policy row accounting.
6. **M8/M9/L1** — fix the three m13 gates (description anchor, `--only` docs check, env forwarding) and
   strengthen the accuracy gate into a behavioural falsifiable gate with a planted mutant (red then green).
7. Evidence: re-run every gate plus the REAL-CORPUS door battery, record red→green per defect, commit per
   policy (`git add` of owned paths only, verified `git diff --cached --name-only`).

## 12 · Files written in Phase A

`validation/tools/bb_migrate/`: `AUDIT.md` (this file), `GATES.json`, `LATENCY.json`, `MCP-DOOR.json`,
`REAL-CORPUS.json`, `raw/*.json` (measurements, door results, index metadata, regex inventory, route matrix),
`logs/*.log` (every gate run and probe stderr), harness scripts (`bench.ts`, `db-shape.ts`, `discover.ts`,
`door*.ts`, `index-*.ts`, `probe-readonly.ts`, `real-corpus.ts`, `regex-inventory.ts`, `assemble-phaseA.ts`).
`bbdata/`, `realdata/`, `work/` are gitignored measurement state (index copies, fixture indexes).
