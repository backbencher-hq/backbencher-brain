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

## THIS WAVE IS VOID AS A CORRECTNESS MEASURE

Eleven of the seventeen valid runs **read their own answer key**. The 100% success rate above
is withdrawn: it is not a result.

While investigating why bb was never called, I read the tool calls in the transcripts:

```
cat ~/mcp/backbencher-brain/benchmarks/typescript/project1/golden/t1-rewind-d9cf2be.patch
cat ../prompt.txt
ls -la ~/mcp/backbencher-brain/benchmarks/.work/W1/runs/...
```

The workspace lived at `benchmarks/.work/<wave>/runs/<id>/workspace`, i.e. **inside the
checkout**, so `../../../typescript/project1/golden/<id>.patch` was the fix itself. Eleven of
seventeen valid runs read it and then scored 1.0. The measurement was "can the agent find the
answer key" -- and it can. A harness that read only the score column would have published a
100% success rate that means nothing.

Two fixes, both landed:

1. **Isolation by location.** The workspace now lives in a sibling directory
   (`../.bench-workspaces-<repo>/<runId>/workspace`) that contains nothing but the run, so no
   relative path reaches the benchmark. The prompt is not trusted to enforce this.
2. **A contamination gate.** Every tool call is scanned for `golden/*.patch`, `tasks/*.json`,
   `prompt.txt` and the wave directory; a hit invalidates the run with
   `benchmark-contamination`. Checked against this wave's own traces the gate flags 18 of 27,
   so it catches the class rather than the instance. Selftest `10h` mutation-tests it.

The cost and adoption numbers below still stand: reading the patch does not change what a turn
costs, and a contaminated run also made 0 bb calls. They are reported because adoption is what
this wave can actually support.

## What the surviving evidence says

**bb was never used, so bb's usefulness was never tested.** That is not a "no" -- a feature
never exercised cannot be scored. It is a discoverability result.

1. **Correctness is unmeasured, not saturated.** The apparent 17/17 came from contaminated
   runs. What remains true is that these six p-queue fixes are each ~1 source file and a small,
   well-localised change -- the regime arXiv:2610.33958 says help shrinks to nothing -- so even
   a clean re-run is unlikely to discriminate. That argues for fixing the corpus before
   re-running it, not for reporting a number from it.
2. **Adoption is zero, and one agent said why.** The probe proves the server was mounted and
   answering (C/D/E all passed it, making real `bb_search` calls). Across 27 traces exactly one
   thinking event names a bb tool, and that agent declined on a premise that was **false** --
   claiming the workspace "isn't indexed" when the index had been built there before the turn
   (`memory.peak_rss_index_mb = 87`; a failed index would have invalidated the run). See
   ADOPTION.md for the full quote. That is the most actionable finding in the wave.
3. **Cost rose anyway.** Arm C spent 2.4x the billed tokens of arm A for an identical result,
   and D 2.1x. The static prefix alone (23,022 vs 6,789) is a fixed 16,233-token handicap per
   turn that bb must earn back and did not here.

## The placebo's narrower role

Arm E's scrambled output cost the same and its runs touched the harness the same way, so the
placebo is indistinguishable in **cost and behaviour**. With correctness void it cannot carry a
correctness claim, and this document does not make one.

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
- The **p-queue corpus is too easy to discriminate**, contaminated runs aside: each task is
  one source file and one localised change. Adding more p-queue tasks will keep producing
  ceiling results.
- The **adoption problem is the binding constraint**, not correctness. Any further measurement
  needs tasks (or conditions) where the agent _must_ reach for retrieval — and the medium/
  large repositories are where that becomes plausible.

## Next, in order

1. **Finish the roster** on immer (6 tasks, ready) and execa (large, in progress) — the
   scale-asymmetric slots where navigation should matter.
2. **Fix the two defects that voided this wave before running another**: the workspace is now
   outside the checkout and the contamination gate is armed, but the **43% invalidation rate**
   (provider flakiness under concurrency, three MCP mounts that failed to start) has to come
   down or a large wave will burn most of its cells.

3. **Diagnose adoption directly**: arm C made zero bb calls. The one trace that does mention
   the tools rejects them on a false premise ("the workspace isn't indexed"), which points at
   how the agent is told what it is working on. That is the most valuable next measurement.

> Reproduction: `npx tsx script/bench/run-wave.ts --tasks benchmarks/typescript/project1/tasks
--arms A,B,C,D,E --wave W1 --jobs 3 --project benchmarks/typescript/project1/project.json`.
> Every number above traces to a `run-record.json` whose `trace.ndjson` is sha256-recorded.
