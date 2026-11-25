# Protocol ↔ execution — the benchmark's own honesty ledger

Every benchmark claims a protocol and then does something slightly different. The gap is
where results rot. This page is the standing, commit-by-commit ledger of that gap: one
row per protocol statement, naming **the code that is supposed to implement it** and
whether it currently does.

This is the same discipline the tools already demand of themselves
(`docs/M14-HONESTY-CONTRACT.md`, `docs/DOC-TRUTH-EMISSIONS.md`), applied to the
benchmark instead of to `bb`.

**Status: W0 — the ledger is honest about being empty.** No implementation exists yet,
so every row that needs code says `not implemented`. A row may only move to
`implemented` when the named file exists **and** `script/bench/selftest.sh` demonstrates
it going red.

| # | protocol statement (where) | executor | status |
|---|---|---|---|
| 1 | same model, temperature 0, same prompts across arms (`DESIGN.md` §2) | `script/bench/run-arm.ts` | not implemented |
| 2 | arm A/B mount a profile with the `mcp-bb` row **removed** (`ARMS.md` §1) | `script/bench/profiles/` | not implemented |
| 3 | every run gets a private writable `DSH_HOME` (`OBSERVED-ENVIRONMENT.md` §6) | `run-arm.ts` | not implemented |
| 4 | no network, no installer during a run (`DESIGN.md` §6) | container entrypoint + `grade.ts` trace scan | not implemented |
| 5 | arm B's manual block is byte-identical to arms C/D's (`ARMS.md` §1) | `preregister.ts` digest | not implemented |
| 6 | invalid runs are recorded with a reason, never scored (`ARMS.md` §4) | `run-arm.ts` / `report.ts` | not implemented |
| 7 | grading is blind to arm (`ARMS.md` §5) | `grade.ts` (receives no arm field) | not implemented |
| 8 | non-discriminating tasks are dropped **before** the first run (`METHODOLOGY.md` §4) | `replay-anchor.ts --check` | not implemented |
| 9 | task roster and hypotheses are frozen before data, and hashed (`PREREGISTRATION-W1-draft.md`) | `preregister.ts` | not implemented |
| 10 | arms C/D quarantine a run whose `bb_health` is not green without a declared degradation (`DESIGN.md` §5.4) | `run-arm.ts` precondition | not implemented |
| 11 | fallback rate is recorded per run, not inferred (`OBSERVED-ENVIRONMENT.md` §4) | `run-arm.ts` trace parse | not implemented |
| 12 | the harness must be able to go **red**: cancel-arm ≈ 0, golden-arm ≈ 1.0 (`script/README.md` convention) | `script/bench/selftest.sh` | not implemented |
| 13 | `benchmarks/` ships text only — ground truth derived at run time, never committed (`DESIGN.md` §10) | repo layout + `replay-anchor.ts` | **implemented** (layout exists, no ground-truth files committed) |
| 14 | every number is reported with its conditions header (`METHODOLOGY.md` §1) | `report.ts` | not implemented |
| 15 | the arm really is the arm: A/B have no `mcp__bb__*` tool, C/D's bb tools answered (`HARNESS.md` §5) | `run-arm.ts` probe turn | not implemented (**this failure was personally observed** — a run with no bb tools returned a confident answer) |
| 16 | model is **pinned** (provider + model id), never the provider's `auto` default (`HARNESS.md` §2) | generated profile patch | **implemented** in the verified recipe; must be asserted by `run-arm.ts` |
| 17 | the run's DSH home is private and disposable; secrets are seeded, never committed (`HARNESS.md` §1) | `run-arm.ts` | recipe verified by hand; not implemented in code |
| 18 | published traces are path-normalised and contain no secret; a trace with a secret **refuses to publish** (`DESIGN.md` §9) | `report.ts` publish guard | not implemented |
| 19 | every figure in a report is **recomputed from the traces**, never from a stored summary (`DESIGN.md` §9) | `report.ts` | not implemented |
| 20 | the three report levels are built in one pass from one run store and each declares its counts (`DESIGN.md` §8) | `report.ts` | not implemented |
| 21 | an incomplete project/language is published as **incomplete with the gap named**, never omitted (`DESIGN.md` §8) | `report.ts` | not implemented |
| 22 | the embedder is named in every table and chart header, including "disabled" (`DESIGN.md` §7) | `report.ts` | not implemented |
| 23 | memory is a recorded condition; an OOM run is `invalid`, not missing (`DESIGN.md` §7) | `run-arm.ts` | not implemented |
| 24 | arms A/B **cannot reach the bb CLI**, and a successful invocation is `invalid`/`bb-leak` (`HARNESS.md` §4a) | PATH shim + `grade.ts` trace scan | not implemented — **hole confirmed by live probe** (`bb --version` returned `0.2.2` in a no-bb arm) |
| 25 | `arm_enforcement` (mcp mounted, CLI shimmed, invocation counts) is recorded on every run (`HARNESS.md` §4a) | `run-arm.ts` | not implemented |
| 26 | the trace carries no harness timestamps, so the runner stamps arrival time and marks it an **upper bound** (`HARNESS.md` §5a) | `run-arm.ts` + `report.ts` labelling | not implemented — gap confirmed in `json-stream.ts` |
| 27 | the primary discovery-tax measure is **tokens**, not ms (`DESIGN.md` §1) | `report.ts` | not implemented |
| 28 | every C/D run records the embedder and its config, and `bb_setup_show` verbatim (`EMBEDDINGS.md` §8) | `run-arm.ts` | not implemented |
| 29 | a `bb_ask` answering `method=keyword-fallback` in a C2 run is `invalid`, not scored (`EMBEDDINGS.md` §4) | `run-arm.ts` trace scan | not implemented |
| 30 | coverage is judged over **embeddable kinds**, and a `BACKFILL PENDING` warning is recorded verbatim rather than treated as failure (`EMBEDDINGS.md` §5) | `run-arm.ts` + `report.ts` | **behaviour verified** in `brain-index-health.ts:840-850`; recording not implemented |
| 31 | `--concurrency` is recorded, and a wave whose latency drifts >2× reference is re-run rather than published (`DESIGN.md` §12.1) | `run-arm.ts` + `report.ts` | not implemented |

## How a row is retired

1. the executor file exists, and
2. `script/bench/selftest.sh` has a case that breaks exactly this property and shows the
   suite going red for it, and
3. the row's `status` becomes `implemented` in the same commit that adds the case.

A row that is silently dropped from this table is a regression of the benchmark itself,
not a cleanup.
