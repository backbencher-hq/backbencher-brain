# Pre-registration — W1 (TypeScript), draft

**Status: DRAFT, not yet frozen.** It becomes an executable pre-registration only when
`script/bench/preregister.ts` computes `preregistration_digest` over
(tasks + prompts + manual block + arm spec) and this file is committed with that
digest in it. Until then it is a stated intention, and it must not be quoted as if a
result already exists under it.

Rule: **any change to a hypothesis, a task, a prompt or the manual block after the
first measured run is a NEW pre-registration with a dated reason**, kept beside this
one. No exceptions, including "we just fixed a typo in the prompt".

---

## 1 · Conditions (frozen for the wave)

| field | value |
|---|---|
| language | TypeScript |
| project slots | 3 pinned repositories (`benchmarks/typescript/project{1,2,3}`) |
| tasks | 40 per project set: T1 rewind 24 · T2 multifile 8 · T3 comprehension 4 (first wave) · T4 inject 4 |
| arms | A · B · C (embedding: **C0 = headline**, C2 optional, C1 reported, never pooled) |
| model | `deepseek-v4.1-flash` (provider `freepi`), temperature 0 |
| harness | `dsh --profile headless --json`, one private `DSH_HOME` per run |
| repetitions | 3 for T1/T2/T4 (variance), 1 for T3 |
| machine | 8 logical cores, 15 GB RAM, no GPU — recorded per run |

## 2 · Primary endpoint (one number)

**Centered success** on T1 + T2 pooled:

```
centered(task, arm) = success(task, arm) − max_over_reps(success(task, A))
```

Reported with a one-sided sign test at α = 0.05 over tasks. **The headline unit is the
pooled n = 96** (T1+T2: 32 per project set × 3 sets). Per-set results (n = 32, crit 22)
are descriptive only: at a 65/35 split a single set has 0.40 power, so a per-set number
may not be published as a verdict. Pooled, crit = 57 and power at 65/35 is 0.90.

## 3 · Hypotheses (fixed before data)

| id | hypothesis | decision rule |
|---|---|---|
| **H1** | bb improves task success | C beats A on ≥ 60 % of T1+T2 tasks, one-sided sign test p < 0.05 |
| **H2** | bb reduces the discovery tax | median tokens-to-first-correct-edit C ≤ 0.75 × A, with total invocations within +2 % of A |
| **H3** | bb is not harmful at comprehension | C − A on T3 ≥ −5 points |
| **H4** | the semantic door is not load-bearing | C0 within 5 points primary of C2 — **conditional on C2 being run**; otherwise published as *not tested*, never as passed |
| **H5** | the headline arm never touches a provider | `bb_ask` fallback rate **0 %** in C0; `< 10 %` in C2 |
| **H7** | the remote embedder is a sub-arm, not the product | C1 vs C0 disagreement > 10 points is reported as the headline finding, not averaged |
| **H6** | context cost alone is not the benefit | C − B > 0 with the same sign-test rule as H1 |

H6 is the one I expect a hostile reader to care about most: it separates "the tools
helped" from "the manual block happened to contain the answer".

## 4 · Secondary endpoints (reported, never substituted for the primary)

- discovery tax (median, and full distribution);
- tool economy: `Σ bytes + Σ ms` per invocation, with the B arm's manual-block token
  count (measured at freeze time) stated as an explicit allowance;
- regression rate: files and lines changed outside the golden set;
- false-confidence rate on T3 (agent asserted a behaviour the test contradicts);
- bb cost per task: index build minutes amortised, **peak RSS of the index run**, index
  disk, per-call latency (memory is a recorded condition, never a hidden variable);
- the **embedder named in every table**, including `disabled`;
- fallback rate and refusal rate per arm;
- per-stratum (hot vs cold) split, because a pooled number can hide the failure mode.

## 5 · Stopping and reporting rules

1. The task roster is fixed; **no top-up after seeing a result**.
2. A result that contradicts a hypothesis is published with the same prominence.
3. Any result between −5 and +5 points on the primary endpoint is reported as
   **inconclusive with bounds**, never as a verdict (a single project set has 0.40
   power at a 65/35 split; the pooled n = 96 has 0.90 — see DESIGN §3.5).
4. Invalid runs are published with their reasons and counts.
5. The publication header carries: `bb version`, `dsh version`, model, embedding arm,
   machine, date, `preregistration_digest`.

## 6 · Report levels this wave must produce

Per project (Level 1), per language (Level 2), and a cross-language OVERALL that is a
projection, not an average (`DESIGN.md` §8). **All three are generated in one pass from the
same run store**, and a language whose projects are incomplete is published as incomplete
with the gap named. Charts are SVG generated from the data, each with its data table, its
`n`, and the condition header naming the **embedder**.

The headline is the **pooled n = 96** over the three project sets; a per-project number is
descriptive only (§2 above).

## 7 · Evidence this wave must publish

Every run's `trace.ndjson`, `submission.patch`, `grade.json` and `checksums.txt`, in
`benchmarks/results/<wave>/runs/<run-id>/` (`DESIGN.md` §9). The report recomputes its
figures from the traces. A run whose trace fails the secret/scrub check refuses to publish.
This is the mechanism by which the wave is *checkable* rather than merely *published*.

## 8 · What this wave explicitly does NOT test

- Whether bb helps *small models* (one model only).
- Whether bb helps across many languages (TypeScript only).
- Whether bb is faster in wall-clock for interactive use (agent latency only).
- Analyzer correctness (that is `validation/` and `script/m14/`, a different claim).
