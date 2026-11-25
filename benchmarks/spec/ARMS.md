# Arms, plugs and invalidity rules

Three things are replaceable without touching the harness: the **model**, the
**harness**, and the **codebase**. Everything else in this file is frozen for a
wave and hashed into that wave's pre-registration.

---

## 1 · The four arms

An arm is a fully specified (agent configuration, manual block, tool inventory) triple.
The only difference between arms in a wave is the row below — same tasks, same model,
same temperature, same harness contract, same grading.

| arm | bb MCP server | bb manual block | bb skills + `bb onboard` section | what it is for |
|---|---|---|---|---|
| **A** | absent from the profile | absent | absent | baseline |
| **B** | absent from the profile | **present** (size measured per block revision) | absent | isolates *pure context cost* |
| **C** | present | present | absent | **headline: net effect = C − A** |
| **D** | present | present | present | isolates *discovery / adoption* = D − C |

Implementation rule that is easy to get wrong: **arm A/B must mount a profile whose
`mcp-bb` row is removed**, not a profile where bb is "disabled". The bb MCP child is a
plugin under the preset (`~/.dsh/profiles/web/cordis.patch.yml:160`), so a disabled
flag inside one shared home would leave the child running for every arm. Each run gets
its own `DSH_HOME` (verified redirectable — see `docs/benchmarks/OBSERVED-ENVIRONMENT.md` §6).

### The manual block (arms B, C, D — byte-identical)

A frozen, version-stamped rendering of:

- what the 16 bb tools are and what each answers,
- the one-page evidence contract (read the declaration: freshness, truncation,
  confidence kind, declared absence),
- when *not* to call bb (new/unsaved files, files outside the index, a graph tool
  that refused — fall back to host tools and say so).

**The block is identical in B, C and D.** If it differs by even one token between B and
C, C − B stops being a context-cost measurement. Its digest goes in the
pre-registration; a change requires a new wave.

### The skills block (arm D only)

The published `@backbencher/skills` set (code-navigation, evidence-reading,
index-onboarding, edit-safety…) plus the `bb onboard` AGENTS.md section. This is
exactly what a user who follows the install docs would have, which is the point: D
measures the *documented* experience, C measures the *bare* experience.

---

## 1a · Arm E — the placebo (required control)

Arm E is arm C with the retrieval arguments scrambled: the same 16 tools, the same manual
block, the same real bb server, but every task-bearing argument (`query`, `symbol`, `target`)
is replaced by the fixed token `__bench_placebo__`. bb answers with real, schema-correct,
entirely unrelated output.

**Why it is not optional.** Without E, a C-vs-A difference cannot be attributed to *content*.
A model handed 16 tools may try harder, restructure its search, or spend its budget
differently — none of which is bb being useful. Published evidence (arXiv:2610.33958) used a
placebo arm and found the gain came from *what the tools returned*, not from *having them*,
and that random output actively **harmed** two small models.

**The three comparisons, and what each answers:**

| comparison | question |
|---|---|
| C vs A | did mounting bb change the outcome? (the product effect) |
| **C vs E** | did the **content** do it, or just the presence of tools? |
| E vs A | does irrelevant tool output help or hurt? |

**Declared limitation.** This is an *argument-randomised* placebo, not a random-entity
placebo. Fabricating schema-correct random entities for twelve differently-shaped tools would
make the proxy a second implementation of bb whose fidelity we could not claim. The
`placebo_mode` field records which variant ran so the two are never conflated.

**The failure this control can suffer, and its guard.** An arm labelled E whose proxy
injected nothing is arm C wearing a label, and would fake a content effect. The runner
therefore asks the probe for a symbol that exists, then marks the run `invalid` if any tool
*result* contains it. `arm_enforcement.placebo_injected` records the outcome.

## 2 · Embedding sub-arms

Applied to arms C and D (bb tool calls are what can hit a provider). Each run records
which one it used; a mixed run is invalid.

| sub-arm | configuration | question it answers | status |
|---|---|---|---|
| **C0** | `BB_EMBEDDING_DISABLED=1` — local 50-dim word vectors, no HTTP, **+0 RAM** | what does bb deliver with **zero** network dependency? | **headline** |
| **C2** | self-hosted OpenAI-compatible endpoint (`http://localhost:8080/v1`), ≤1.5 GB embedder, `OLLAMA_MAX_LOADED_MODELS=1` | what does semantic search add, reproducibly? | optional; recommended once a wave wants it |
| **C1** | configured remote model (today `nvidia/nemotron-3.5-embed-8b:free`) | does a server-side 8B embedder beat a local small one? | **reported, never pooled** (H7) |

**The headline arm is network-free (C0).** A headline that depends on a free tier's 429
window — or on an install secret a reader cannot obtain — is not reproducible, and
reproducibility is the product being sold. C0 was measured at **~278 MB peak RSS** for a
76-file index, so "we have no RAM" is not a blocker for it. Rationale and arithmetic:
`docs/benchmarks/DESIGN.md` §7.

### The embedder is a recorded condition

`embedding_arm` (`C0`/`C1`/`C2`) **and** the concrete configuration
(`local-word-vectors-v3:50`, or model id + dimension + endpoint host) go in every run
record and in the header of every table and chart. A result that does not say which
embedder produced it is not publishable, because the embedding question is exactly what
the benchmark is trying to settle.

---

## 3 · The three plugs

### 3.1 Plug in your own model

Add a provider block to the run's profile and set the arm's model row. The run record
**must** store: provider id, model id, context window, max output, quantisation (if
local), temperature, and whether the model is served remotely or locally.

```yaml
# in the arm spec
model:
  provider: freepi            # any provider the harness profile defines
  model: deepseek-v4.1-flash
  temperature: 0
```

Nothing else in the pipeline changes. If your model's context cannot hold the bb
manual block (arm B/C), that is a **declared condition** (arm B is skipped and said so),
not a reason to shorten the block — shortening it silently would make your result
incomparable with ours.

### 3.2 Plug in your own harness

`script/bench/run-arm.ts` speaks exactly one contract. A harness is legal if it:

1. accepts a task prompt (stdin) and a working directory,
2. executes with **no network and no package installation capability** (DESIGN §6),
3. emits, on stdout, one NDJSON record per step:
   `{type:"tool_call"|"message"|"final", name?, args?, bytes?, ms?, text?}`
4. leaves the working tree as its final state (the diff is the submission),
5. exits non-zero on infrastructure failure (that run is invalid, not a zero).

That is the whole interface. Claude Code, opencode, a plain ReAct loop, or an
in-house harness can all be wrapped in it — and the point of publishing the interface
is that a reader can check our number with a different harness rather than trust ours.

### 3.3 Plug in your own codebase

```yaml
# benchmarks/<language>/<project>/project.json
id: ts-project9
language: typescript
remote: https://github.com/<you>/<repo>
revision: <40-hex>              # pinned commit, never a branch
tarball_sha256: <sha256 of the export at that revision>
setup:  [ "npm ci --offline" ]  # must run with the network down
test:   [ "npx tsc --noEmit", "npx vitest run --reporter=json" ]
test_subset: <path to a list of test files that must pass>
size_class: medium
```

Then add tasks under `tasks/`. `manifest.json` gets your pin. The harness treats your
project exactly like ours; nothing in the runner is project-specific.

---

## 4 · Invalidity rules (a run that violates these is recorded, not scored)

| rule | why |
|---|---|
| Any network call during the run | contaminates A→C (DESIGN §6) |
| Any package install (`npm i`, `pip install`, `apt`) | same |
| Missing or non-green `bb_health` in arms C/D without a declared degradation | measures the fallback, not the product (OBSERVED-ENVIRONMENT §3) |
| Embedding sub-arms mixed within one run | the arms stop being comparable |
| Agent exceeded the step/token cap | the result is about the cap, not the task |
| Grading harness error | not the agent's fault |
| bb manual block differs between B and C | C − B loses its meaning |

Every invalid run is kept with `status: "invalid"` and its reason. An invalid run is
never silently dropped and never counted as a failure of either arm.

---

## 5 · Blind grading

The grader receives `task_id`, the workspace, and the pinned snapshot. It does not
receive the arm, the model, or the trace. The arm label is joined back in the analysis
step only. This is a structural safeguard, not a promise of good faith.
