# W1 · ts-project1 (p-queue) · first completed wave

**Date:** 2026-11-25 · **Model:** deepseek-v4.1-flash (`freepi`) · **Embedder:** C0
(`BB_EMBEDDING_DISABLED=1`, local 50-dim) · **Wave:** W1 · **Isolation:** C0

This is the **first wave that completed end to end**: 6 replay tasks × 5 arms = 30 cells, of
which 17 produced a valid measurement and 13 were correctly invalidated.

## Headline

**Every arm solved every task. bb was called zero times, in every arm, on every run.**

| arm              | valid runs | solved | tokens in (median) | of which cached | billed-equivalent | static prefix |
| ---------------- | ---------- | ------ | ------------------ | --------------- | ----------------- | ------------- |
| A (no bb)        | 4          | 4/4    | 483,963            | 436,480         | 91,131            | 6,789         |
| B (manual block) | 5          | 5/5    | 902,473            | 840,448         | 146,070           | 7,531         |
| C (bb mounted)   | 3          | 3/3    | 982,116            | 923,904         | 150,602           | 23,022        |
| D (C + skills)   | 3          | 3/3    | 1,267,664          | 1,197,824       | 189,622           | 23,505        |
| E (placebo)      | 2          | 2/2    | 1,361,961          | 1,308,800       | 184,041           | 23,311        |

| arm | bb calls (median) | runs with 0 bb calls |
| --- | ----------------- | -------------------- |
| A   | 0                 | 4 / 4                |
| B   | 0                 | 5 / 5                |
| C   | 0                 | 3 / 3                |
| D   | 0                 | 3 / 3                |
| E   | 0                 | 2 / 2                |

## What this means, stated plainly

**On these tasks, bb provided no measurable benefit — because it was never used.**

This is not "bb does not work". It is the **adoption gap**, measured: with 16 tools mounted and
a manual block telling the agent exactly what they answer, a capable model chose `bash`/`read`/
`edit` every single time. Three separate facts point the same way:

1. **Correctness is saturated.** 17/17 valid runs scored 1.0. A task every arm solves cannot
   discriminate, no matter how many runs are added. These six p-queue fixes are each ~1 source
   file and a small, well-localised change — exactly where a strong model needs no help.
   This is the outcome arXiv:2610.33958 predicts: benefit shrinks as model capability grows,
   and a 32B-class model already finds the code unaided.
2. **Adoption is zero.** The `bb_usage.calls` counter is 0 across all arms, and the probe
   proves the server was mounted and answering (C/D/E all passed `bb_mcp_available`).
   This is not a wiring failure; it is a **choice** the agent made.
3. **Cost rose anyway.** Arm C spent 2.4× the billed tokens of arm A for an identical result,
   and D 2.1×. The static prefix alone (23,022 vs 6,789) explains a fixed 16,233-token
   handicap per turn that bb must earn back and did not here.

## The honest caveat, and why the placebo matters

Without arm E, a reader could argue the mounts "help the agent think". E answers that: its
output is _unrelated_ content, and it scored identically (2/2) at the same cost. So on this
corpus, **having the tools changed nothing** — neither the real ones nor the scrambled ones.

## What invalidated 13 of 30 cells (all correctly)

| count | reason                                                      | what it means                                                                                                                                                                               |
| ----- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | `network/install: curl`                                     | the agent fetched the **actual upstream fix commit** from GitHub. Real contamination, correctly caught by the trace scan. Would have been a false "success" in a harness that did not look. |
| 5     | `turn ended with reason "error"`                            | the turn crashed. Not a measurement of the arm — recorded as `infra_error`, not scored 0.                                                                                                   |
| 3     | `arm C/D/E made 0 bb calls → server did not load` — _probe_ | the MCP server failed to start in those containers. Correctly refused rather than silently measuring an agent without tools.                                                                |
| 1     | `no terminal final event`                                   | the run died mid-stream.                                                                                                                                                                    |

A 43 % invalidation rate is high and is itself a signal: the provider (`freepi`) is flaky under
concurrent load, and three MCP mounts failed to start. Those need fixing before a larger wave,
not hiding.

## What this wave establishes

- The **instrument works end to end**: profile isolation, probe, trace, grading, evidence
  hashes, three report levels, and a gate that caught contamination and crashes.
- The **p-queue corpus is exhausted as a discriminator.** Six tasks, all saturated. Adding
  more p-queue tasks will produce more 1.0s.
- The **adoption problem is the binding constraint**, not correctness. Any further measurement
  needs tasks (or conditions) where the agent _must_ reach for retrieval — and the medium/
  large repositories are where that becomes plausible.

## Next, in order

1. **Finish the roster** on immer (6 tasks, ready) and execa (large, in progress) — the
   scale-asymmetric slots where navigation should matter.
2. **Diagnose adoption directly**: arm C made zero bb calls. The trace holds the reason
   (never considered / considered and rejected), which is the difference between a product
   problem and a documentation problem. That is the single most valuable next measurement.
3. **Reduce invalidation**: cap concurrency for the provider, and retry MCP mount failures
   rather than reporting them as arm failures.

> Reproduction: `npx tsx script/bench/run-wave.ts --tasks benchmarks/typescript/project1/tasks
--arms A,B,C,D,E --wave W1 --jobs 3 --project benchmarks/typescript/project1/project.json`.
> Every number above traces to a `run-record.json` whose `trace.ndjson` is sha256-recorded.
