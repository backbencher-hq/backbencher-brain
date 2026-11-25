# Methodology — how to reproduce our numbers, and how to replace us

This is the reader handbook. It assumes you have the repository checked out and nothing
else. Design rationale lives in [`DESIGN.md`](./DESIGN.md); the environment our own
numbers were taken in is [`OBSERVED-ENVIRONMENT.md`](./OBSERVED-ENVIRONMENT.md).

**Status:** W0. The harness entry points named below are the committed contract; the
implementation lands with W0 (`script/bench/`). Anything marked *planned* does not exist
yet, and saying so is the point of this page.

---

## 1 · Reproduce a published result

```bash
# 1. the pins: every repository, its commit and its tarball digest
jq . benchmarks/manifest.json

# 2. the conditions that result was taken under
jq . benchmarks/results/<wave>/conditions.json

# 3. re-run one arm on one task
script/bench/run-arm.ts \
  --wave  W1-typescript \
  --task  benchmarks/typescript/project1/tasks/t1-rewind-001.yaml \
  --arm   C \
  --embedding-arm C0 \
  --reps  3

# 4. grade blind, then analyse
script/bench/grade.ts  --run runs/<run-id>
script/bench/report.ts --wave W1-typescript
```

Boot the harness first: the verified, complete recipe — including the six failure traps
that cost a whole session to find — is [`HARNESS.md`](./HARNESS.md). Do not re-derive it.

A reproduction is **comparable** only when these match the published
`conditions.json`: `bb` version, `dsh` version, model id, **embedding arm and its concrete configuration**
(`local-word-vectors-v3:50`, or model + dimension + endpoint host), `preregistration_digest`.
The runner refuses to write a run record that omits any of them — a number without its
conditions is not evidence.

## 2 · Replace the model

Add the provider to the harness profile and change the arm's model row. Nothing else.

```yaml
model:
  provider: <your provider id>
  model:    <your model id>
  temperature: 0
```

If your model cannot hold the frozen bb manual block, the run is **declared
ineligible for arms B/C/D** and reported as such. Do not shorten the block to fit: a
shortened block is a different experiment and its numbers are not comparable to ours.

## 3 · Replace the harness

Your harness is required to do five things (`benchmarks/spec/ARMS.md` §3.2):

1. take a task prompt on stdin and a working directory,
2. run with **no network and no installer capability**,
3. emit NDJSON: `{type, name?, args?, bytes?, ms?, text?}` per step,
4. leave its work as the working tree (the diff is the submission),
5. exit non-zero only on infrastructure failure.

Then point `run-arm.ts --harness <your-adapter>` at it. The trace format is the entire
interface; it is deliberately small so that a reader can verify us with a harness we
have never run.

## 4 · Replace the codebase

Add `benchmarks/<language>/<project>/project.yml` + `tasks/`, register the pin in
`manifest.json`, and run. Requirements that are not negotiable, because they are what
makes a run gradeable:

- a pinned 40-hex revision and a tarball digest;
- `setup` and `test` that succeed **offline** inside the base image;
- a test subset that (a) fails at `base_revision` and (b) passes at `fix_revision`
  for every replay task — `script/bench/replay-anchor.ts --check` enforces this and
  drops non-discriminating tasks before they are ever run.

## 5 · Reading a result honestly

| field in the report | what you may conclude | what you may not |
|---|---|---|
| centered success, with sign-test p | a paired direction and its significance over this task roster | a general claim about "agents" or "all codebases" |
| discovery tax (median tokens/ms to first correct edit) | the mechanism by which a win happened | a wall-clock speedup claim for interactive use |
| fallback rate | how often the semantic door degraded to lexical | anything about recall without also reading precision |
| stratified hot/cold split | whether the pooled number hides a loss | that the pooled number is the only number |
| `status: invalid` count | how much of the suite was usable | a pass/fail verdict on the excluded runs |

Three reading rules, taken from this repository's own evidence culture
(`docs/EVIDENCE.md`, `validation/README.md`):

1. **A truncated or declared-degraded run is reported, not silently averaged.**
2. **"No significant difference" is not "no difference."** One project set (n = 32) has
   only 0.40 power at a 65/35 split; the pooled headline (n = 96) has 0.90
   (`DESIGN.md` §3.5): a null result is reported as
   *inconclusive with bounds*.
3. **Every number carries its conditions** in the same table header.

## 6 · Cost of a reproduction

≈ 3–20 min per run (clone + index + agent + grading). A full wave of 4 arms × 40 tasks
× 3 repetitions is roughly 8–30 h of compute. A single-arm spot check is therefore
cheap; the full comparison is not. This is why the published per-task run records ship
with the report — a reader can sample three tasks and cheaply see whether our pipeline
behaves the way we say it does.
