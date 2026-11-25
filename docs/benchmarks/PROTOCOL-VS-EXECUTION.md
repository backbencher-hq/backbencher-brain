# Protocol ↔ execution — the benchmark's own honesty ledger

Every benchmark claims a protocol and then does something slightly different. The gap is
where results rot. This page is the standing, commit-by-commit ledger of that gap: one
row per protocol statement, naming **the code that is supposed to implement it** and
whether it currently does.

This is the same discipline the tools already demand of themselves
(`docs/M14-HONESTY-CONTRACT.md`, `docs/DOC-TRUTH-EMISSIONS.md`), applied to the
benchmark instead of to `bb`.

**Status: W0 landed (2026-11-25).** `script/bench/` exists and `selftest.sh` is green at
17 checks. A row says `implemented` ONLY when the code exists **and** a selftest case
covers it; where a case exists but the code does not, the row says `partial` and names
which half is missing. Three cases were mutation-tested — the shim, the chart zero-axis
and the preregistration drift gate were each broken deliberately and each turned the
corresponding check red — so "green" here means a gate that has been seen to fail, not a
gate that merely ran.

| # | protocol statement (where) | executor | status |
|---|---|---|---|
| 1 | same model, temperature 0, same prompts across arms (`DESIGN.md` §2) | `run-arm.ts` fixed providers + frozen prompt files | **implemented** (temperature is recorded, not enforced by the harness — `partial`) |
| 2 | arm A/B mount a profile with the `mcp-bb` row **removed** (`ARMS.md` §1) | `lib/profile.ts` `buildProfile()` | **implemented** (row omitted unless `bbMcp`) |
| 3 | every run gets a private writable `DSH_HOME` (`OBSERVED-ENVIRONMENT.md` §6) | `lib/profile.ts` + `runEnv()` | **implemented** (per-arm home, verified by a live run) |
| 4 | no network, no installer during a run (`DESIGN.md` §6) | `lib/trace.ts` `suspiciousCalls` → `run-arm.ts` invalid gate | **partial** — the trace scan exists and the container does not; a determined agent is not prevented, only detected |
| 5 | arm B's manual block is byte-identical to arms C/D's (`ARMS.md` §1) | `preregister.ts` digest | not implemented |
| 6 | invalid runs are recorded with a reason, never scored (`ARMS.md` §4) | `run-arm.ts` `finish()`, `report.ts` invalid section | **implemented** (7 named reasons; report prints them) |
| 7 | grading is blind to arm (`ARMS.md` §5) | `grade.ts` takes run dir + task + project only | **implemented** (the function has no arm parameter) |
| 8 | a task must be a real task: tests fail at base and pass after the fix, verified BEFORE admission | `replay-anchor.ts` | **implemented** — measured: a non-fix commit is DROPPED with "no test moves from fail->pass" |
| 9 | task roster and hypotheses are frozen before data, and hashed | `preregister.ts` freeze/check | **implemented** + selftest case 9 (drift refused; mutation-tested) |
| 10 | arms C/D quarantine a run whose `bb_health` is not green (`DESIGN.md` §5.4) | `run-arm.ts` health probe + record | **partial** — health is captured and recorded verbatim, and a MODEL MISMATCH demotes it, but the run is not yet refused |
| 11 | fallback rate is recorded per run, not inferred | `lib/trace.ts` `bbFallbackAnswers` | **implemented** (counted from tool_result text) |
| 12 | the harness must be able to go **red** | `script/bench/selftest.sh` | **implemented** — 17 checks, 3 mutation-tested (shim, chart axis, drift gate) |
| 13 | `benchmarks/` ships text only — ground truth derived at run time, never committed (`DESIGN.md` §10) | repo layout + `replay-anchor.ts` | **implemented** (layout exists, no ground-truth files committed) |
| 14 | every number is reported with its conditions header | `report.ts` `conditionHeader()` | **implemented** (model/harness/bb/**embedder**/machine/date/runs) |
| 15 | the arm really is the arm: A/B have no `mcp__bb__*`, C/D's bb answered (`HARNESS.md` §5) | `run-arm.ts` probe turn | **implemented** — the silent no-tools failure was OBSERVED, so the probe exists because it happened |
| 16 | model is **pinned**, never `auto` (`HARNESS.md` §2) | `lib/profile.ts` | **implemented** (refuses to build a profile on `auto`) |
| 17 | private disposable `DSH_HOME`; secrets seeded, never committed | `lib/profile.ts` + `.gitignore` | **implemented** (`benchmarks/.work/` ignored; secrets symlinked from the operator's home) |
| 18 | a trace containing a secret **refuses to publish**; paths normalised | `lib/scrub.ts` + `run-arm.ts` gate | **implemented** + selftest case 7 (mutation-tested) |
| 19 | every figure is **recomputed** from evidence, never a stored summary | `report.ts` | **partial** — recomputed from run records that cite traces; the report does not yet re-read the trace files itself |
| 20 | three report levels from one store, each declaring counts | `report.ts` | **implemented** (`levelOne`/`levelTwo`/`levelOverall` share `loadStore`) |
| 21 | incomplete language published as incomplete, gap named | `report.ts` `levelTwo` | **implemented** + selftest case 8 |
| 22 | the embedder is named in every table header, including `disabled` | `report.ts` `conditionHeader` | **implemented** (mandatory row) |
| 23 | memory is a recorded condition; an OOM run is `invalid`, not missing (`DESIGN.md` §7) | `run-arm.ts` memory block + `finish("invalid", "index-failed")` | **partial** — RAM totals and peak index RSS are recorded and a killed index is `invalid`, but peak RSS is measured on the RUNNER process, not the child index process |
| 24 | arms A/B cannot reach the bb CLI; an invocation is `invalid`/`bb-leak` (`HARNESS.md` §4a) | `lib/profile.ts` shim + `run-arm.ts` scan | **implemented** + selftest case 3, mutation-tested (shim removed ⇒ `REACHED:0.1.5`) |
| 25 | `arm_enforcement` recorded on every run | `run-arm.ts` | **implemented** (mounted / shimmed / invocation counts) |
| 26 | the trace has no timestamps; the runner stamps arrival and marks it an upper bound | `lib/exec.ts` `streamStamped` | **implemented** (labelled in every record and table) |
| 32 | a **placebo arm E** (tools return unrelated content) is run, so a C-vs-A gain is attributed to content rather than to tool presence (`PRIOR-WORK.md` §1) | `lib/placebo-proxy.ts` + `ARM_SPECS.E` | **implemented** — arm E live, probe proves the rewrite fired; selftest 10d, mutation-tested |
| 33 | the headline reports **C0 and C2** both, because published evidence attributes the gain to the embedding index which C0 disables (`PRIOR-WORK.md` §1) | `EMBEDDINGS.md` + `report.ts` | **partial** — the report records and prints the embedder per arm, but the co-headline rule is a protocol statement, not yet enforced by a gate |
| 34 | every task records a **training-cutoff check** (`fix_commit_date > model_cutoff`), the published zero-leakage protocol (`PRIOR-WORK.md` §2) | `replay-anchor.ts` | **implemented** — `anchor` records `fix_date`/`model_cutoff`/`post_cutoff` per task and WARNS at admission on a pre-cutoff fix |
| 35 | **exposure** (was the golden file ever shown) is reported separately from **conversion** (did it act on it) (`PRIOR-WORK.md` §1.4) | `lib/trace.ts` `exposureOf()` + `report.ts` | **implemented** — `conversion: null` when never exposed, so it cannot read as a failed conversion |
| 27 | the discovery tax is measured in **tokens**, not ms | `lib/trace.ts` `discoveryTax()` | **implemented** — the naive "tokens before first tool call" was measured to be structurally impossible (tool_call precedes step_end) |
| 28 | every C/D run records the embedder config and `bb_setup_show` verbatim (`EMBEDDINGS.md` §8) | `run-arm.ts` | **partial** — `embedding_arm` + `embedding_config` are recorded per run and the health output is stored verbatim; `bb setup show` is not captured yet |
| 29 | a lexical fallback in a C2 run is `invalid`, not scored | `run-arm.ts` invalid gate | **implemented** (from `bbFallbackAnswers`) |
| 30 | coverage is judged over **embeddable kinds**, and a `BACKFILL PENDING` warning is recorded verbatim rather than treated as failure (`EMBEDDINGS.md` §5) | `run-arm.ts` + `report.ts` | **behaviour verified** in `brain-index-health.ts:840-850`; recording not implemented |
| 31 | `--concurrency` is recorded; a drifting wave is re-run | `run-arm.ts` | **partial** — recorded, drift re-run not automated |

## How a row is retired

1. the executor file exists, and
2. `script/bench/selftest.sh` has a case that breaks exactly this property and shows the
   suite going red for it, and
3. the row's `status` becomes `implemented` in the same commit that adds the case.

A row that is silently dropped from this table is a regression of the benchmark itself,
not a cleanup.

| 36 | a record may not contradict its own `grade.json` or `trace.ndjson` | `verify-record.ts` | **implemented** — retroactively caught all four recorded contradictions; selftest 10c, mutation-tested |
| 37 | a turn that did not end `completed` is `infra_error`, never a scored failure | `run-arm.ts` `finalReason` gate | **implemented** — the harness reported the reason and the runner used to ignore it |
| 38 | expected-but-unmeasured fields are DECLARED per run, not left null | `run-arm.ts` `unrecorded[]` | **implemented** — 10 fields named rather than silently absent |