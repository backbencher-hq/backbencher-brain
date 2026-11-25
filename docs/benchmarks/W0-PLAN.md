# W0 — build the instrument

**Goal:** by the end of W0, `script/bench/selftest.sh` is green and every negative case in
`DESIGN.md` §10 has *demonstrated* it can go red. No benchmark number is published in W0.
The deliverable is a trustworthy instrument, not a result.

**DONE (2026-11-25).** `selftest.sh` is green at **17 checks**, and three of them were
mutation-tested — the bb shim, the chart's zero axis and the preregistration drift gate
were each broken deliberately and each turned its check red. Two real runs (arm A and arm
C) were executed end to end against the fixture and graded correctly. See
`PROTOCOL-VS-EXECUTION.md` for the per-row state (22 implemented, 6 partial, 3 not).

**Author:** one author (lead). This is deliberate — see `DESIGN.md` §12.1: compute fans
out, the instrument converges. A harness whose runner, grader and reporter disagree about a
schema produces plausible numbers that are not evidence.

**Exit criteria (all required):**

1. `run-arm.ts` executes one task in one arm and writes a complete `run-record.json`
   (`SCHEMA.md` §3) — including `memory`, `arm_enforcement`, `evidence` and `bb_usage`.
2. `grade.ts` grades blind and writes `grade.json` (`SCHEMA.md` §4).
3. `report.ts` builds all three levels from the run store and emits SVG + data tables.
4. `preregister.ts` computes a digest over tasks + prompts + manual block + arm spec, and
   **refuses** if any of them changed since the committed digest.
5. `selftest.sh` is green, and each of its 8 cases has been *seen* to fail when its
   property is broken.
6. The bb-leak hole (`HARNESS.md` §4a) is closed by construction and proved closed.

---

## Build order (each step depends on the one above)

| # | step | proves |
|---|---|---|
| 1 | **Profile generator** — builds per-arm `DSH_HOME` from a template: freepi plugin copied, install secret seeded, model **pinned**, `mcp-bb` present only for C/D, `bb` PATH shim present only for A/B | arms are real; no `auto` model; no credential in the repo |
| 2 | **Probe turn** — one cheap turn per run asserting arm identity (`HARNESS.md` §5) | the silent no-tools failure cannot pass |
| 3 | **Runner** — workspace copy from pin → index → agent → trace with arrival stamps → record | one reproducible run |
| 4 | **Grader** — suite subset + golden + needle, blind | a submission becomes a score |
| 5 | **Reporter** — 3 levels, SVG from data, condition headers, trace recomputation | the number is checkable |
| 6 | **Preregistrar** — digest + refusal on drift | no post-hoc hypothesis moving |
| 7 | **Selftest** — the 8 cases | the instrument can go red |
| 8 | **Docs reconciliation** — `PROTOCOL-VS-EXECUTION.md` rows flip to `implemented` **only** where a selftest case covers them | the ledger stops being aspirational |

### What W0 actually found (things the plan did not anticipate)

1. **The trace has no `token-before-first-tool-call` measure.** Measured: the harness emits
   `tool_call` *before* the `step_end` that reports that step's usage, so a prefix
   measurement is structurally impossible, not merely missing. The discovery tax was
   redefined as *tokens burned before the first edit to a golden file*, plus the first
   step's input tokens as the arm's fixed prefix cost.
2. **The fixture's test command must be a shell string.** `project.test` is a list of
   command strings; an earlier grader executed element 0 as a binary name and every test
   "failed" silently. Caught by grading a known-good submission and expecting 1.0.
3. **Chart bars needed a zero baseline.** Centered success is signed; a left-anchored
   negative bar claims the opposite of the measurement. That is now a selftest case.
4. **JSON, not YAML.** No YAML parser dependency exists in this repo, and adding one to
   read three fixture files is not a trade this project makes. `SCHEMA.md` §1 says so.

### What W0 did NOT finish (and why the ledger says so)

- `replay-anchor.ts` (dropping non-discriminating tasks before a run) — needs a pinned
  repository to be meaningful; W0 has only the fixture.
- Container-level network isolation — the trace scan detects installers/network calls and
  marks the run `invalid`, but does not *prevent* the call. A determined agent is detected,
  not blocked.
- `bb setup show` capture, child-process peak RSS, and automated concurrency drift re-runs.

None of these block W1; all are named rather than implied.

## The eight selftest cases (from `DESIGN.md` §10)

`golden` · `cancel` · `leak` · `no-tool` · `stale-index` · `oom` · `secret` · `level-gap`

The `leak` case is the one that matters most, because the hole was **measured** during
design (`bb --version` returned `0.2.2` in a no-bb arm) rather than imagined. A run that
successfully invokes bb in arm A/B must be `invalid`/`bb-leak` — never a scored number.

## What W0 explicitly does NOT do

- No pinned repositories (the manifest stays `status: W0-unpinned` until the operator picks).
- No published number, no README claim, no marketing sentence.
- No second language.
- No `results/` entry — an empty `results/` is the honest state.

## Definition of done for the *instrument*

> A stranger can clone the repo, read `docs/benchmarks/HARNESS.md`, swap in their own
> model and codebase, run `script/bench/run-arm.ts`, and get a `run-record.json` that
> `script/bench/report.ts` accepts — **without reading the source**.

That is the test. If it needs a conversation with us, W0 is not done.
