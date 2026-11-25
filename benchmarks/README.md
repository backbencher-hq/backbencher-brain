# benchmarks/ — the agent-utility dataset

This directory answers one question, and only one:

> **Does an agent with `bb` do more real coding work, correctly, than the same agent without it?**

It is **not** the place where bb's analyzer correctness is proven. That is
`script/m14/` + `validation/`, and it is a different claim.

**Status: W0 — the instrument is designed, the harness is proven end-to-end, no results
exist yet.** A full headless run with bb tools returning real payloads was executed on
2026-11-25 (`../docs/benchmarks/HARNESS.md`). `docs/benchmarks/DESIGN.md` is the design of record;
`docs/benchmarks/OBSERVED-ENVIRONMENT.md` is the machine/version evidence the design
rests on.

## Read this first

| I want to… | read |
|---|---|
| know how the benchmark is designed and what it may not claim | [`../docs/benchmarks/DESIGN.md`](../docs/benchmarks/DESIGN.md) |
| **run it myself** — the verified harness recipe and its six failure traps | [`../docs/benchmarks/HARNESS.md`](../docs/benchmarks/HARNESS.md) |
| see which hypotheses were frozen before any data | [`spec/PREREGISTRATION-W1-draft.md`](spec/PREREGISTRATION-W1-draft.md) |
| re-run our numbers, or swap the model/harness/codebase | [`../docs/benchmarks/METHODOLOGY.md`](../docs/benchmarks/METHODOLOGY.md) |
| benchmark **my own** model, harness or codebase | [`spec/ARMS.md`](spec/ARMS.md) — three replaceable plugs |
| check a published result against what the code actually did | [`../docs/benchmarks/PROTOCOL-VS-EXECUTION.md`](../docs/benchmarks/PROTOCOL-VS-EXECUTION.md) |
| read a published result **and its transcripts** | [`results/`](results/) — every number is backed by the run trace |

## Layout

```
benchmarks/
  README.md            <- you are here
  manifest.json        every pinned repository: remote, revision, tarball sha256
  spec/                ARMS.md · SCHEMA.md · PREREGISTRATION-W1-draft.md
  typescript/project{1,2,3}/
    project.yml        pin, build command, test subset
    tasks/             t1-rewind-* · t2-multifile-* · t3-comprehension-* · t4-inject-*
  results/             PUBLISHED: per-project, per-language, OVERALL + every run's
                       trace.ndjson, submission.patch, grade.json, checksums
```

`benchmarks/` holds **text only** — no cloned repositories and no binaries. Ground
truth is derived from the pinned commits at run time by
`script/bench/replay-anchor.ts`, and checked with `git apply --check`. This keeps the
tree licensable and keeps a per-language clone from becoming a 2 GB artefact.

## The four arms (full definitions in `spec/ARMS.md`)

| arm | bb present | manual block | skills | isolates |
|---|---|---|---|---|
| A | no | no | no | baseline |
| B | no | **yes** | no | pure context cost |
| C | yes | yes | no | **net effect (headline: C − A)** |
| D | yes | yes | **yes** | discovery / adoption |

Embedding sub-arms C0 (local word vectors, no network), C1 (remote), C2 (self-hosted
OpenAI-compatible). The headline arm is **network-free** — see DESIGN §7.

## Rules this directory follows

1. **Pre-register before measuring.** Hypotheses, critical values and the task
   roster are committed and hashed before the first arm runs. A refusal to publish
   an unfavourable result is a defect of the benchmark, not of the product.
2. **Every number has provenance** — the command, the pin, the arm, the embedding
   config and the `bb`/`dsh` version. Same rule as `validation/README.md`.
3. **Negatives are mandatory.** `script/bench/selftest.sh` must show the cancel-arm
   scoring ~0 and the golden-arm ~1.0. A benchmark that has never gone red is not a
   benchmark.
4. **No arm is invalidated after the fact.** Invalid runs are recorded with their
   reason, not deleted.
5. **Every published number ships its transcript.** The run's `trace.ndjson`,
   `submission.patch`, `grade.json` and `checksums.txt` are committed beside the report,
   and the report's figures are recomputed from the traces. A number without its trace
   is removed, not explained.
6. **The embedder is named in every table** — including `disabled`, which is the
   headline configuration. A reader must be able to tell whether the semantic door was
   open, degraded, or absent.
