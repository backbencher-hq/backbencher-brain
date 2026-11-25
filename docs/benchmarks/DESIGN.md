# Agent Benchmarking: does bb actually help an agent?

**Status:** design, not yet executed. No numbers in this document are results.
**Question under test:** *"Has bb ever been of any use to the agents?"*
**Owner:** lead. **Date:** 2026-11-25.

---

## 0 · The honest starting position

Two claims must be separated, because they are different products and only one of
them has ever been measured:

| claim | what it means | current evidence in this repo |
|---|---|---|
| **C1 — retrieval quality** | Given a query, `bb_ask`/`bb_search`/`bb_graph` return the right symbols, with declared freshness, truncation and confidence | Strong. Doctrine in `docs/EVIDENCE.md`, `docs/IDE-HONESTY-CONTRACT.md`, `docs/M14-HONESTY-CONTRACT.md`; 709 `verify-*.ts` gate files measured on this checkout (81 top-level + 628 under `script/m*/`), with per-tool contract gates among them |
| **C2 — agent utility** | An agent that has bb completes more real coding work, more correctly, than the same agent without it | **Not measured. Not once.** `grep -r 'SWE-bench\|swebench\|HumanEval'` over tracked source, docs, script and validation: no hits (the only matches are inside the untracked `.tmp-release/` third-party archive dump). The website review (`docs/website/MASTER-REVIEW-2026-11-08.md` line 103) names "no benchmark headline" as a defect |

Every question the marketing conversation keeps hitting is a **C2** question, and
the repository has been answering it with **C1** evidence. That mismatch is the
whole problem, and no amount of additional gate work closes it. This document is
the C2 instrument.

---

## 1 · What we are measuring, and against what

bb is a **finding** product: it changes how many search-rounds an agent burns before
it knows where to edit. It is not a reasoning product. So the benchmark must ask
"did the agent get to the right code faster / more often", which means:

**Primary endpoint (one number, pre-registered):** *centered task success* —
a run succeeds when (a) the repository's own test suite passes, **and** (b) the
"golden" behaviour the task is graded on is reached. Centered = we subtract, per
task, what the model does with no context at all, so a task the base model already
solves contributes nothing to the score. Without centering, a benchmark on familiar
code (a public JS library in the model's training data) reports the model's memory,
not bb's value.

> Provenance note: the centering / pass-to-pass / container-isolation conventions used
> here are community practice in the `SWE-bench`-family agent evaluations, not
> citations verified in this repository. **Web search was unavailable when this
> document was written** (`web_search` returned an HTTP 402 from the configured
> provider), so no external result is quoted as fact anywhere in this file. Any
> figure in this document is either measured here (see `OBSERVED-ENVIRONMENT.md`) or
> explicitly marked as an assumption.

**Secondary endpoints, all required, no cherry-picking:**

| endpoint | why it exists |
|---|---|
| discovery tax: **tokens** + tool-calls before the *first* edit to the right file — with arrival-time ms beside it, labelled an upper bound | the only mechanism by which bb can help at all; tokens are the primary measure because the harness reports them while the trace carries no timestamps (`HARNESS.md` §5a) |
| tool economy: count cannot be compared across arms (arms have different tool inventories), so report `Σ bytes + Σ latency` per agent invocation; for the no-bb arm add the measured manual-block token count as an explicit allowance, since the block is prepaid while a tool call is paid per use (the IV framing is in §6); the figure is measured when the frozen block is rendered, not asserted here | keeps the comparison honest |
| regression rate: files/lines touched outside the required change | agents with better navigation also break less |
| false-confidence rate: runs where the agent reports "this is how it works" and the test disagrees | bb's own honesty doctrine applied to the agent |
| bb-cost: index build minutes, index disk, per-call latency | a win must survive the bill |
| refuse-and-fallback rate | when bb returns a refusal or degradation, does the agent recover using host tools? |

**What this benchmark will never claim.** It cannot tell you bb makes *a model* better
without saying which model, which harness, which repository and which embedding
configuration — those are the experimental conditions, not footnotes. Its report
format forces them into the header of every table.

---

## 2 · The arm matrix

The naive two-arm design (same model, same prompt, with/without bb) is the right
*idea* and I keep it, but two arms confound three different things. A second arm
pair isolates context cost from capability:

| arm | tools available | what it isolates |
|---|---|---|
| **A — no-bb** | host tools only (`read`,`grep`,`glob`,`bash`), no bb server mounted at all | baseline |
| **B — bb-off** | same as A **plus** the frozen bb manual block in context (size recorded when the block is rendered), bb not mounted | **pure context cost** — the half of bb's damage that has nothing to do with the tools |
| **C — bb-on** | bb tools mounted, identical manual block | **net effect** = C − B |
| **D — bb-full-suite** | C plus the bb skills installed (`bb code-navigation`, `evidence-reading`, …); emits `bb-onboard`'s AGENTS.md section | **discovery effect** — what an agent does when told *when* to use the tools |

The headline comparison is **C vs A**. **B** exists so the first question a hostile
reader asks — "isn't your tool list just 15k tokens of overhead?" — has a
measured answer instead of a rhetorical one. **D vs C** answers the second:
"the tools are there but the agent never calls them" is an adoption failure,
not a product failure, and the two must not be conflated.

**Embedding sub-arms (these are the rate-limit answer, §7):**

| sub-arm | embedding config | question |
|---|---|---|
| **C0** | `BB_EMBEDDING_DISABLED=1` (local 50-dim word vectors only) | what does bb deliver with **zero** network dependency? |
| **C1** | the configured remote model (currently `nvidia/nemotron-3.5-embed-8b:free` via OpenRouter) | does semantic *quality* pay for rate-limit risk? |
| **C2** | a local OpenAI-compatible server (`http://localhost:8080/v1`, served by ollama) | is "unlimited local embeddings" better than the free tier? |

Headline = **C1** (best config, clearly labelled). C0 is the *floor*, and it is the
one that decides whether the free-tier risk matters at all.

---

## 3 · Task design: four tracks, and only one of them is the benchmark

This is where I disagree with the folder-first plan, and it matters.

### 3.1 Track 1 — Replay (24 tasks/language, saturating). Cheap, honest, and it validates the instrument.

Each task rewinds a public repository to a commit *just before* a fix commit,
**discards the real fix**, and asks the agent to implement the fix. Ground truth =
the real fix commit's test diff, which must fail before the real fix and pass after
it — checked mechanically, so a task that cannot discriminate is dropped before it
is ever run.

Why this first:
- It is the only boundary whose difficulty is **measured, not asserted** — real
  maintainers judged it worth fixing.
- The golden diff is independent of bb (authored by the project, not by us), so the
  task set carries **no bb bias**, which hand-authored tasks inevitably do.
- Bug-fix history is *reachable without local git history*: there are public datasets
  of (repo, base commit, fix commit, language) triples, so the repository itself can
  stay a plain pinned tarball. That matters because `.corpus/*` in this checkout are
  **depth-1 shallow clones** (`git rev-parse --is-shallow-repository` → `true`;
  `git log` returns one commit), so replay tasks cannot be rebuilt from those copies.

Stratify 24 tasks = **12 hot-path** (core module the agent will navigate) + **12
cold** (peripheral library, deliberately obscure). The stratification is there to
detect the failure mode most likely to embarrass us: bb helps on a 2,000-file
Flutter app and is *negative* on a 500-file React hook.

### 3.2 Track 2 — Multi-file change (8 tasks/language, mixed). Where a graph should win.

"Rename/route through N call sites so the suite still passes." This is the task
shape bb's own tools were built for (`bb_impact`, `bb_graph`). It is also the shape
where grep alone is weakest. Expect the largest effect here; report it as a
**separate** line, never folded into the headline (pre-registered below).

### 3.3 Track 3 — Comprehension (10 questions/language, binary-graded). The fairness leg.

Not code changes: "what happens if X fails", "which module owns Y", "what breaks if
we delete Z". Graded `true/false` against the repository's own test assertions and
symbol structure. Each question carries a **needle**: a file the note says the
*answer* lives in. `grep`-findable needles get scored separately ("search-spread"),
because for those bb mostly adds cost. This track is where the no-bb arm has an
unfair advantage we must measure rather than hide: with `read`/`grep` the agent can
in principle reach the same bytes.

### 3.4 Track 4 — Bug inject (12/language). The only *unbiased-for-bb* quality control.

Mutation-style: take a passing commit, inject a seeded defect (`off-by-one`,
`inverted condition`, `swap`), and ask for **exactly one file** to be corrected
without naming it. No human judgement in labelling, unlimited generation, provably
discriminating. Included because Track 1's bug history is biased toward
"interesting bugs humans reported", and because this track is the one that can be
generated for a *brand-new language lane* the day the analyzer ships.

### 3.5 The suite, and the number that gives it power

Per **language × project set**, 40 tasks in wave 1 (the per-track numbers above are the
ceiling each track reaches once full):

| track | wave 1 | full |
|---|---|---|
| T1 replay | 24 | 24 |
| T2 multifile | 8 | 8 |
| T3 comprehension | 4 (halved — see §12 "what I would cut") | 10 |
| T4 inject | 4 | 12 |
| **total** | **40** | 54 |

The restriction is one-directional: the suite is never **topped up** after a result is
seen. Trimming T3/T4 *before* the first run is not top-up, and the wave-1 roster is
hashed into the pre-registration.

**The primary endpoint uses T1 + T2 only** (n = 32 per project set, 96 pooled over
three projects). T3 and T4 are reported separately and never pooled into the headline —
a comprehension or mutation result cannot move the number the marketing claim rests on.

The suite size is set by arithmetic, not taste. One-sided sign test, α = 0.05, paired
per task. Every figure below is computed from the binomial directly
(`python3 -c` reproducible): `crit` is the smallest win count that clears α, and the
columns are the win rate under test, **stated as the assumption**, not borrowed.

| n (tasks) | crit | power if bb wins 70% | 65% | 60% |
|---|---|---|---|---|
| 15 | 12 | 0.30 | 0.17 | 0.09 |
| 24 | 17 | 0.56 | 0.36 | 0.19 |
| **32** (one project set) | 22 | 0.64 | **0.40** | 0.20 |
| 54 (one set, full suite) | 34 | 0.90 | 0.68 | 0.38 |
| **96** (three sets, headline) | **57** | **0.99** | **0.90** | 0.59 |

**The headline is the pooled n = 96 (crit 57), not a single project set.** This is the
most important line in this section, and it corrects an earlier draft that quoted
n = 40: **no single project set is sufficiently powered** — at a 65/35 split, one set
gives 0.40, i.e. a coin flip would look like a result often enough to be dangerous.
Three sets pooled reach 0.90 at that split. Consequences:

- a wave may only publish the headline when **all three project sets complete**; a
  partial wave is published as per-set descriptive statistics, never as a verdict;
- below 24 tasks a single set cannot distinguish a 70 % win rate from chance, and
  publishing it would be worse than publishing nothing — it would produce "no
  significant difference" that means "we did not look hard enough".

---

## 4 · What the harness actually is (verified, not assumed)

**Agent harness = DSH headless, one invocation per run.**

```bash
mkdir -p .tmp-bench/dshhome/profiles && cp -r ~/.dsh/profiles/headless .tmp-bench/dshhome/profiles/
DSH_HOME=$PWD/.tmp-bench/dshhome dsh --profile headless --json --permission-mode workspace-write "…task…"
```

Verified on this machine today:
- `dsh --profile headless --help` exposes `--json` (newline-delimited run events),
  `--permission-mode`, `--session-id`, `--add-dir`, and `-`/stdin task input.
- `DSH_HOME` **works as a redirect** — proven: `dsh --profile headless --dump-default-config`
  under a copied profile tree printed the composed config (`exit 0`). Without the
  redirect the same command dies `EROFS` because `~/.dsh/profiles/headless` is
  read-only in this session. So *every* run gets its own throwaway `DSH_HOME`, which
  is also what makes the per-run cost table below truthful.
- The **bb server is a preset plugin** (`mcp-bb`, `@deepseek-ai/dsh-mcp-client`,
  `args: ['mcp','--dir','/home/ishaq2321/ProxiCall']` in
  `~/.dsh/profiles/web/cordis.patch.yml:160`). It is **hardwired to the ProxiCall
  checkout**, so arm A must mount a profile with that row absent — not merely a
  profile with bb disabled — or arm A is contaminated.

**The boot itself has five undocumented failure traps**, all hit and solved in one
session — a read-only profile, a default provider with no key, a non-builtin provider
plugin, a plugin installer that fails in a sandbox, and a persistence-based credential.
The verified recipe and the required pre-run assertions are in
[`HARNESS.md`](./HARNESS.md); the arm-is-the-arm probe is the important part, because the
worst of those failures ran to completion with **no bb tools at all** while producing a
confident answer.

**Do not build a bespoke loop for v1.** Swapping the model/harness is the stated
future requirement (§11), and the cheapest way to keep that honest is to make the
harness a *parameter of the DSH profile file*, not code.

**Prompts.** A frozen template registry, hashed into the pre-registration: arm A+B
get repo facts + environment commands + task text; arm C+D additionally get the
bb manual block (identical to B) plus, in D, the skills and the `bb onboard` AGENTS.md
section. Prompt templates live in `benchmarks/<lang>/<project>/tasks/*.yaml` next to
the task, not in a global file, so a task cannot drift from its prompt.

**Per-run cost (drives the budget, §12):**

| per run | item | time |
|---|---|---|
| 1 | workspace clone/copy from the pinned snapshot | 1–10 s |
| 1 | `bb index .` (cold) — **only arms C/D**, stored in the image | 30 s – 6 min |
| 1 | agent invocation | 1–15 min |
| 1 | grading (test subset + golden diff + needle) | 30 s – 5 min |

≈ **3–20 min/run** → one language × one project set × 4 arms × 40 tasks ≈
**8–30 h**. That is the real cost of the first report, before parallelisation.

---

## 5 · Repository selection

Your suggestion was `benchmarks/<language>/project1,2,3` — three projects per
language, 2–4 languages at a time. I keep the shape and change the contents:
**a project set = one repository *pinned to a commit*, with 12 Track-1 tasks +
4 Track-2 + 4 Track-4**, so a "project" is a slot in a reproducible dataset rather
than a directory name.

Rules:
1. **Pinned by commit + a tarball digest**, never `main`. Anything that cannot be
   reproduced byte-for-byte in a year is not evidence.
2. **Two unseen + one in-distribution.** The first two must not be in the model's
   training-data sweet spot. DeepSeek-class models know lodash, express, axios,
   moment; a benchmark built only on those measures memory. The third slot is
   deliberately familiar — it checks the benchmark is not measuring *only* novelty.
3. **Not this repository.** `bb`'s own checkout is in its own index and its index
   is 31,354 files / 1,967,081 symbols / 9,277 syntax errors (verified `bb health`)
   — it is not representable as one repository experiment, and the author grading
   their own product on their own code is not a benchmark.
4. **The index must actually be healthy before an arm is counted.** Verified today
   on this checkout: **configured model `nvidia/nemotron-3.5-embed-8b:free` has
   0% coverage (0/1,967,081), `BACKFILL PENDING`, stored vectors are `tfidf-v1`
   (21,167 rows) and `bb doctor` reports "Model mismatch: … the stored vectors are
   unusable."** Every run in every arm needs `bb_health` green (or a *declared*
   degradation) or the run is quarantined rather than scored. This single line is
   why §7 exists.

**Locked v1 selection:** TypeScript, three pinned projects — one framework-scale
(hundreds of files), one library-scale (dozens of files), one app-scale with
`tsc` clean tests. Slots 2 and 3 to be named at pre-registration time with digests.

---

## 6 · The IV problem, and why a container is mandatory

Agents in docker-style benchmarks can `apt install`, `pip install pymupdf`, do
`pip show` in one call and reap the benefit in the next. **That contaminates the
A→C comparison**, because the extra *tools* (not just the extra *context*)
interact non-additively with the extra tokens bb injects. The rigorous fix is an
**info-value (IV) regression**: `tokens = β₀ + β₁(agent) + β₂(tool) + …`. That is
too expensive for v1, so it is deferred — but the *contamination* must be removed
now, and it costs nothing:

> **No tool that can install a tool. No network during a run.** The container ships
> a prebuilt base image with the project's toolchain and test runner already
> installed. An installer call is an immediate **invalid run**, logged, not scored.

The "B" arm is the cheap version of IV already in the matrix: it gives an upper
bound on pure context cost, so C−B is the honest net-of-toollist number.

---

## 7 · Embeddings: the rate-limit problem, answered

This is the question that decides whether the benchmark measures anything beyond
network luck. Facts first, all verified or read from the repo:

1. **Blast radius is smaller than the fear.** Only **two of the sixteen tools** can
   query embeddings at all: `bb_ask`, and `bb_doc`'s semantic expansion step in
   `feature` mode. Verified by import graph — only `quick-answer.ts:33` and
   `doc-engine.ts:33` import the semantic search module. `bb_search`, `bb_graph`,
   `bb_impact`, `bb_visualize`, `bb_patterns`, `bb_security`, `bb_analyze`,
   `bb_health`, `bb_migrate` and the rest are **index-only**
   (`OBSERVED-ENVIRONMENT.md` §5). The bulk of bb's *navigational* value — symbols, callers,
   callees, impact — never touches an embedding. That is the single most important
   fact in this whole document: **the value proposition does not die when the
   embedding provider does.**
2. **Memory is not the blocker — measured.** Peak RSS of a full index run with
   embeddings disabled was **~278 MB** on a 76-file project (`/usr/bin/time -v`:
   `MAXRSS_KB=284488`, `ELAPSED=1.25`). The desktop, not bb, owns the memory pressure;
   this is the number that makes a CPU-only benchmark defensible (measured and argued
   below, in "The RAM question").
3. **Index time already degrades gracefully.** `EMBEDDINGS.md` (line ~83): a 429
   degrades *only that batch* to local word vectors, honours `Retry-After`, and
   backs off 5s/10s/20s/30s; a 5xx/timeout degrades the batch with no wait; 401/404
   stops retrying for the process. It never wedges the run.
4. **Query time does not wedge a tool call either.** `EMBEDDING_WAIT_CEILING_MS =
   2000` in `src/intelligence/search/semantic-search.ts`: a query embedding may block
   a tool for **≤ 2 s** before the declared local fallback runs. `BB_EMBEDDING_TIMEOUT_MS`
   can be raised to the `EMBEDDING_WAIT_HARD_MAX_MS = 60_000` cap, but the default
   is the truth for an autonomous agent: **a remote rate limit costs one 2 s fallback
   and a lexical answer, not a hang.** (The provider's own bound is 30 s; it is
   pre-empted at 2 s.)
5. **The degraded answer is *declared*.** Verified live: `bb ask "where is the index
   lock enforced"` on this checkout answered from a **KEYWORD** match with
   `confidence: 0.2 (declared floor; no score was computed on that path)`. The agent
   is told, in the answer, that it is reading a lexical fallback — which is exactly
   the information a competent agent needs to switch to `bb_search`.
6. **Failure semantics are honest.** On a 429, the same query *succeeds* via the
   keyword path. **Recall@k can only improve or stay flat**, precision can drop, and
   **latency degrades**. So the arms must report the **fallback rate per arm** and
   the benchmark must not silently compare a degraded arm against a healthy one.

### The RAM question, answered with a measurement

The objection "we have no RAM, so a local embedder is impossible" is **wrong, and the
measurement says so**. Peak RSS of a full index run, measured with `/usr/bin/time -v` on
a 76-file JS project, **embeddings disabled**:

```
MAXRSS_KB=284488  ELAPSED=1.25     →  ~278 MB peak
```

278 MB. bb is not the memory pressure. The pressure is the *desktop* — and that pressure
is real and permanent: the operator runs VS Code, a browser, this harness, and bb's own
index workers all at once, and closing them recaptures the RAM only until the next open
window. So the correct response is **not** "find more RAM"; it is:

1. **The headline arm does not need an embedder at all.** `BB_EMBEDDING_DISABLED=1` was
   verified to resolve cleanly (`bb setup show` → *"Chain: disabled — local word vectors
   only"*, *"no embedding request will be made"*). Indexing then uses the built-in
   50-dimension word vectors and **consumes no additional RAM beyond the 278 MB above**,
   no network, no quota. That is C0, and it is the arm the top-line number comes from.
2. **A local embedder, if a wave wants one (C2), is a 0.7–1.5 GB reservation**, not an
   8 GB one. Ollama's own knobs make it bounded and releasable: `OLLAMA_MAX_LOADED_MODELS`
   (one model), `OLLAMA_KEEP_ALIVE` (evict when idle), `OLLAMA_NUM_PARALLEL` (one request).
   An 8B embedder is out — but an 8B embedder was never the only option.
3. **Memory is a recorded condition, not a hidden variable.** Every run records peak RSS
   of the indexer and of the agent invocation, plus the machine's total/available RAM at
   start. If a run OOMs, that is `status: invalid` with `reason: "memory"` — a result, not
   a silently missing row.

So: **the memory objection does not block the benchmark, and the answer to the marketing
question never depended on a local GPU.** It is worth stating plainly, because "we can't
afford to run it" is the most tempting reason to never publish.

### What I recommend (the decision, with its arithmetic)

> **Headline arm = network-free (`BB_EMBEDDING_DISABLED=1`). The remote model is a
> reported sub-arm, never the headline. A local Ollama embedder is optional (C2), bounded
> by `OLLAMA_MAX_LOADED_MODELS=1` + `OLLAMA_KEEP_ALIVE`, and never required. No GPU, no
> paid provider for v1.**

The arithmetic:
- **C0 costs 0 GB extra and 0 network calls.** Verified: `BB_EMBEDDING_DISABLED=1` is a
  clean, fully supported configuration that satisfies every tool except the semantic door.
- **C1 (remote) is not reproducible by a reader** — it depends on a free tier's 429 window
  and on an install secret that is not shareable. It may be *reported*; it may not be the
  headline.
- **C2 (local) is a 0.7–1.5 GB, one-command reservation.** It removes both the rate limit
  and the credential dependency, which makes it the only *reproducible* way to measure what
  semantic search actually adds. That is why it is the recommended optional arm rather than
  a stretch goal.
- **Expected quality loss is an assumption to measure, not a fact to quote.** The C2 vs C1
  comparison is what turns it into a number.

**What we will not do:** ship a benchmark that needs a GPU, or one whose headline depends
on someone's free-tier allowance. The reader evaluating bb on a laptop is the actual buyer.

### The embedder must be named in every table

Non-negotiable, and now a schema field (`SCHEMA.md` §3, `embedding_arm` +
`run-record.json.bb.embedding_config`). Every result table and chart carries a header:

```
model: deepseek-v4.1-flash · harness: dsh 0.2.2-rc.5 · bb: 0.2.2
embedder: disabled (local-word-vectors-v3, 50-dim)      <- or the exact model + dimension + host
machine: 8 cores / 15 GB · date: YYYY-MM-DD · prereg: sha256:…
```

A table without that header is not publishable. The reason is not pedantry: "bb helps"
means nothing if the reader cannot tell whether the semantic door was open, degraded, or
absent — and the difference is exactly what the embedding question is about.

---

## 8 · The report: three zoom levels, all from one dataset

The reader must be able to understand the result **by looking**, at three levels, and the
three are computed from **one** store of run records — never hand-assembled per page.
This is the same separation the product itself uses (`bb_visualize` scopes over one
projection), applied to our own results.

```
runs/*/run-record.json      (raw, per task × arm × rep)
        │
        ├── LEVEL 1  project    benchmarks/<lang>/projectN/RESULTS.md
        ├── LEVEL 2  language   docs/benchmarks/results/<lang>.md
        └── LEVEL 3  overall    docs/benchmarks/results/OVERALL.md
```

### Level 1 — per project

One page per pinned repository. Full task table (every task, every arm, success/fail,
tokens, edits), plus:

- a paired bar chart: success rate per arm (A/B/C/D) with the n and critical value printed
  on the chart as text, not in a caption;
- a discovery-tax chart: median tokens and median ms before the first *correct-file* edit;
- a scatter: per-task Δ (C − A) against repository size, so a single outlier cannot be
  mistaken for the pattern.

### Level 2 — per language

Aggregates the language's project set **only when all its projects completed**. Headline
bar chart = pooled centered success, A/B/C/D, with the sign-test p and the power of that
pooled n printed beside it. Below it, the per-project panels that compose it — so the
reader can see which project drove the pooled number.

### Level 3 — overall across languages

One chart per language, side by side, **never averaged into a single number across
languages.** A cross-language average would be an artefact of our project mix, not a
property of bb. The page shows: which languages are complete, which are in progress, the
model/embedder header, and the total run count. It is updated by adding a language, never
by rewriting history.

### How the levels stay consistent (the part that rots first)

Every level is regenerated by `script/bench/report.ts` from the same run store, in one
pass, and each level **declares the counts it was built from** (`tasks=40, runs=480,
valid=471, invalid=9`). A level that cannot be built (incomplete project, missing arm) is
published as **incomplete with the gap named**, never omitted — an absent chart reads as
"no finding" when the truth is "not measured".

### The rule that keeps it updatable

Adding a language, a project or a task is **additive only**:

- run records are immutable once written; a re-run creates `repN+1` or a new wave id;
- a REPORT page is a generated artefact, stamped with the `preregistration_digest` and
  the run-store commit; publishing regenerates all three levels;
- a superseded report is **kept** with its wave id and linked from the new one — the same
  `SUPERSEDED-MANIFEST.md` discipline `validation/` already uses.

So the archive grows monotonically, one language at a time, and the OVERALL page is
always a projection of what exists rather than a promise about what we intend.

### Charts are generated, never drawn by hand

`report.ts` emits **SVG from data** (no screenshot, no hand-edited figure), and each
chart's data table is printed beside or beneath it. A reader can therefore check any bar
against its numbers, which is the whole difference between a benchmark and a brochure.
Charts carry: axis labels with units, the n, the arm legend, and a footnote naming the
run-store commit they were built from.

### Tables carry the condition header

Every table and every chart group repeats the header from §7: model, harness, bb version,
**embedder**, machine, date, preregistration digest. Repeated per section rather than once
per document, because the thing this avoids is a reader seeing a number after scrolling
and no longer knowing what it was measured with.

---

### 8.7 · Grading methods (what each one catches)

| grade | method | failure it catches |
|---|---|---|
| test suite | project test subset, snapshot-tested the same commit in both arms | solves the wrong problem |
| golden diff | the real fix commit's changed tests must pass; `pass-to-pass` must not break | regressions |
| file localization | for Track 2 & 4, the edited file set vs the golden set (exact / containing) | shotgun edits |
| needle | Track 3 only: a file the note says the answer lives in, cited or not | confident wrong answers |
| behavior delta | Track 3: TRUE/FALSE pairs around a code change, both-fixture filtering (discard questions the base model already gets right) | memorised answer |

Grading is **blind to arm**: the grader sees `task_id` and a workspace, never which arm produced it. The arm label is joined back only at the analysis step.

**Pre-registered before the first measured run (fixed now, published with the
results):**
- H1: C beats A on the primary endpoint in **≥ 60%** of Track-1+2 tasks.
- H2: C beats B on the **discovery tax** (median tokens-to-first-correct-edit) by
  **≥ 25%**, within a **+2%** allowance on total invocations.
- H3: **C−A on Track 3 is ≥ −5 points** (bb is allowed to be useless, not harmful,
  at comprehension).
- H4: the semantic door is **not load-bearing** — C0 (embeddings disabled) is within
  **5 points primary** of C2 (local embedder). **Conditional:** H4 is only evaluated in a
  wave that runs C2. If C2 is not run, H4 is published as **not tested**, never as passed.
  If H4 fails, the finding is worth more than the benchmark: it would mean semantic search
  *is* the product's value and the tooling story needs re-telling.
- H5: `bb_ask` fallback rate is recorded per run and must be **0 % in C0** (there is no
  provider to fall back *from*) and **< 10 % in C2** (a local server has no 429 window;
  a higher rate means the local server, not the model, is the bottleneck).
- H7: **C1 (remote embedder) is reported, never pooled.** If C1 and C0 disagree by more
  than 10 points, that disagreement is the most important line in the report.

Any change to these after seeing data is a new pre-registration with a dated reason,
kept beside the old one.

---

## 9 · Evidence: the transcripts ARE the claim

A published number that a reader cannot audit is an advertisement. So every published
result in this benchmark is accompanied by **the complete transcript of every run behind
it**, in a form that re-derives the number.

### What ships per run (all committed, all checksummed)

| artefact | what it proves |
|---|---|
| `trace.ndjson` | every turn, every `tool_call` with its arguments, every `tool_result` with its payload, every `step_end` token count, every `final`. This is the primary evidence: the token totals, the bb call rate, the discovery-tax timestamps and the refusals are all *recomputed from it* — they are never stored as a summary the reader has to trust |
| `session.v4.jsonl.zstd` | DSH's own independent session record. If it disagrees with the trace, the run is flagged; two independent artefacts are the cross-check |
| `submission.patch` | the diff the agent actually produced — the only thing graded |
| `grade.json` | the blind grade, with `must_pass`/`must_not_break` counts |
| `checksums.txt` | sha256 of the four above, so a citation of a run cannot be swapped later |

`report.ts` recomputes every headline figure **from the traces**, not from a stored
summary. That is what makes "no lie" structural rather than a promise: a doctored number
would have to be accompanied by a doctored trace, and the trace is thousands of lines
that a reader can read.

### Scrubbing, and what is deliberately NOT published

Published traces are **path-normalised** (`$HOME` → `~`, each run workspace → `$WS`) and
scanned for `freepi-install.json` secrets, `.credentials.yaml` contents, bearer tokens and
API keys. A run whose trace contains any of them **refuses to publish** and is
regenerated. Machine-local absolute paths are stripped because they leak an operator's
layout without adding evidence; the token counts and tool calls are unaffected.

Never published: the operator's credentials, other sessions' transcripts, the harness
home directory, and any repository content we do not have the right to redistribute —
which is why `submission.patch` is kept for **our** pinned open-source projects and the
derived ground-truth patch is *not* committed (it is reconstructed from the pin, §10).

### Reading a transcript (the reader's 60-second check)

```bash
# the number in the table
jq -s '[.[]|select(.type=="step_end")|.usage.inputTokens // 0]|add' trace.ndjson
# the claim "the agent called bb 3 times"
jq -s '[.[]|select(.type=="tool_call")|.tool]|map(select(startswith("mcp__bb__")))|group_by(.)|map({(.[0]):length})' trace.ndjson
# the claim "it never touched a network"
jq -s '[.[]|select(.type=="tool_call")|.input]|map(tostring)|map(select(test("curl|wget|npm i|pip install|apt ")))' trace.ndjson
```

Those three commands verify the three claims the marketing narrative actually makes:
*it used the tools*, *it cost this much*, *it was not cheating*. They are printed in every
Level-1 report so a reader does not have to discover them.

### Why this is stronger than a confidence interval

A p-value says "this is unlikely to be chance". A transcript says "here is exactly what
happened". When someone outside the team asks *has bb ever been of any use to an agent*,
the honest answer needs both: the statistic to show it is not noise, and the transcript to
show it is not fabrication. **We publish both, or we publish nothing.**

---

## 10 · Repository layout (what goes where, and why)

```
benchmarks/                        reader-facing DATASET + contracts (tracked, text only)
  README.md                        how an outsider runs this and re-benchmarks us
  manifest.json                    every pinned repository: remote, revision, tarball sha256
  spec/ARMS.md                     arm definitions, frozen manual block, invalidity rules
  spec/SCHEMA.md                   task, project, run-record and grade schemas
  spec/PREREGISTRATION-<date>.md   hypotheses + critical values, committed BEFORE data
  typescript/project1/             one slot = one pinned repo + its tasks
    project.json                   pin, build cmd, test subset
    tasks/t1-rewind-001.yaml       Track 1 replay tasks
    tasks/t2-multifile-001.yaml
    tasks/t3-comprehension-001.yaml
    tasks/t4-inject-001.yaml
  typescript/project2/ project3/
  <language>/…                     same shape per language, added per wave (§12)

benchmarks/results/                PUBLISHED artefacts (generated, committed)
  <language>/RESULTS.md            Level 2: per-language report + charts
  <language>/project1/RESULTS.md   Level 1: per-project report + charts
  OVERALL.md                       Level 3: cross-language, never averaged (§8)
  <wave>/runs/<run-id>/
       run-record.json             the scored record (SCHEMA.md §3)
       grade.json                  the blind grade (SCHEMA.md §4)
       trace.ndjson                THE EVIDENCE: full event stream, scrubbed (§6)
       submission.patch            the agent's diff
       checksums.txt               sha256 of every file above

script/bench/
  run-arm.ts                       one run: profile → workspace → probe → agent → trace → record
  grade.ts                         blind grader: suite + golden + needle → grade.json
  report.ts                        run store → 3 levels of tables + SVG charts (§8)
  replay-anchor.ts                 reconstruct a counterfactual commit from a real fix commit
  preregister.ts                   hash prompts+tasks+arms → the frozen preregistration digest
  selftest.sh                      the gate: cancel-arm ≈ 0, golden-arm ≈ 1.0 (§10 below)

docs/benchmarks/
  DESIGN.md                        this document
  HARNESS.md                       the verified DSH-headless recipe + its five failure traps
  OBSERVED-ENVIRONMENT.md          every measurement the design rests on
  METHODOLOGY.md                   reader handbook: re-run, substitute model/harness/codebase
  PROTOCOL-VS-EXECUTION.md         honesty ledger: protocol statement ↔ the code that does it
```

**`script/bench/selftest.sh` is not optional.** A benchmark that has never produced
a *negative* is indistinguishable from a benchmark that cannot. It mirrors the repo's
own convention — `script/README.md`: "Negative cases are mandatory: where possible a
gate also shows a mutation that makes it fail."

It must prove, on every commit, that the harness can go red **for each specific reason**:

| case | what it does | must produce |
|---|---|---|
| **golden** | an agent handed the real fix | score ≈ 1.0 |
| **cancel** | bb tools present, graded against a workspace where bb is wrong | score ≈ 0.0 |
| **leak** | arm A with the bb shim removed | `invalid` / `bb-leak`, **never a scored number** |
| **no-tool** | arm C with the `mcp-bb` row broken | probe fails ⇒ `invalid` |
| **stale-index** | arm C with `bb_health` red | quarantined, not scored |
| **oom** | index forced over a low `ulimit` | `invalid` / `memory` |
| **secret** | a trace containing a fake bearer token | publish **refused** |
| **level-gap** | one project set missing | Level-2 published **incomplete with the gap named** |

A case that has never failed is a case that does not exist. Each of the six holes found by
hand (HARNESS.md) becomes one of these rows before W0 closes — the leak case exists
*because* the hole was measured, not because it was imagined.

**`benchmarks/` holds text only; no binaries, no cloned repos.** Ground truth for
Tasks 1 and 4 is *derived* by `script/bench/replay-anchor.ts` at run time and
verified with `git apply --check` against the pinned snapshot. Reason: licensing of
repositories we do not own, and the 2 GB-per-language-clone trap that
`.corpus*/`-style directories create. The pinned tarball digests in
`manifest.json` are what makes a derived ground truth reproducible.

**Milestone.** Per `docs/milestones.md` rule R1, this does not get a new milestone
number until its `docs/mNN/PLAN.md` exists in the same commit. It is registered here
as **a candidate lane of an existing milestone**, not as `m74`.

---

## 11 · Opening the path for other people

The requirement is not documentation — it is that a stranger can replace three
things without forking the harness:

| they bring | where it plugs in |
|---|---|
| **their own model** | `spec/ARMS.md` model row + the DSH provider block; the run record stores provider/model/context-window/quantisation |
| **their own harness** | `script/bench/run-arm.ts` speaks one contract: receive a prompt on stdin, emit a JSON trace (tool calls, bytes, latency per call, final diff). Any agent CLI that can be wrapped in that contract is a legal harness |
| **their own codebase** | `benchmarks/<lang>/<projectN>/project.json` + tasks; `manifest.json` gets their pin |

And the published report must carry, in a header nobody may edit:
`bb version`, `dsh version`, model id, embedding config, harness commit, machine
(cores/RAM), date, and the pre-registration digest. `docs/benchmarks/PROTOCOL-VS-EXECUTION.md`
is the standing ledger of every place this document and the code disagree — exactly
the discipline `docs/M14-HONESTY-CONTRACT.md` already demands of the tools.

---

## 12 · Waves, effort, and what I would cut

| wave | what | languages | effort |
|---|---|---|---|
| **W0** | harness + `selftest.sh` red/green + first project set, **no report** | TypeScript × 1 | 2–4 days |
| **W1** | the first report that answers the marketing question | TypeScript × 3 | 1–2 weeks (8–30 h compute + design time) |
| **W2** | second language, proves the dataset is a language *matrix* | +1 language | 1 week |
| W3+ | 2–4 projects per new language per wave, only after a lane's analyzer passes its own gates | +N | rolling |

Hold the 2–4-language-at-a-time ambition until **one** language has a green report.
Parallelising the *human* side (task authoring, judgement calls) is not the same as
parallelising the *runs*: eight lanes writing fixtures while the instrument is still
unvalidated is exactly how ~22 stale roster names happened last time — the standing
rule in the campaign memory is one lane per language, and a benchmark lane is no
different.

**What I would cut if time is short:** Track 3 (comprehension) — it is the leg where
bb is least likely to win and the leg whose grading is most subjective. Keep
Track 1 (replay) and Track 4 (inject) for v1.

### 12.1 · How the work is parallelised (and what must NOT be parallelised)

There are two different kinds of work here and they have opposite concurrency rules:

| work | parallelise? | why |
|---|---|---|
| **compute** (arms × tasks × reps) | **yes, aggressively** — this is embarrassingly parallel | each run is an isolated process with its own `DSH_HOME`, its own workspace copy and its own port-free stdio server; there is no shared mutable state to contend on |
| **the instrument** (`run-arm.ts`, `grade.ts`, `report.ts`, `selftest.sh`) | **no** — one author until the negative suite is green | a harness whose author, grader and reporter disagree about a schema produces numbers that look plausible and are not. This is the same failure the milestone registry calls out for analyzer lanes |
| **judgement** (task admission, hot/cold stratification, network-verification wiring) | **no** — one author, pre-registered | two people deciding which tasks "count" is how a benchmark becomes an argument |

So the concurrency question is not "how many teammates" — it is **where the parallelism
is allowed to sit**. Compute fans out; the instrument converges. A wave is:

```
W0  (serial, one author)     harness + selftest green  →  the instrument is trustworthy
W1  (parallel, fan-out)      arms × tasks × reps       →  compute only
W2  (serial, one author)     admit the next language   →  then fan-out again
```

**Capacity note.** Peak RSS is ~278 MB per index run (measured) and a run is one agent
process + one bb MCP child + one SQLite file. At 8 logical cores / ~3.8 GB free with the
desktop running, **4–6 concurrent runs** is the honest ceiling before swap (already 7.9 GB
in use) starts destroying the latency numbers. Concurrency above that does not produce more
results; it produces **slower and noisier** ones, and the discovery-tax endpoint is the
first thing to rot. The runner therefore takes an explicit `--concurrency` and records it,
so a result taken at 6-wide is not silently compared with one taken at 2-wide.

**Empirical stop rule:** if any arm's median `bb_ask` latency in a wave drifts by more than
~2× the reference in `OBSERVED-ENVIRONMENT.md` §4 (74.9 s cold, 2.7 s `bb_search`), the
machine was oversubscribed and the wave is re-run at lower concurrency rather than
published.

---

## 13 · The known ways this benchmark will lie to us

Listed here so they cannot be discovered later and treated as bad luck:

1. **Contamination** — public JS libraries are in the training set. Mitigated by
   centering + the two-unseen-one-known rule; never fully removed.
1a. **The control arm can use the product.** *Confirmed by probe, not theorised.* With the
   bb MCP server removed (the documented way to build arm A), the agent ran `bb --version`
   through `bash` and got `0.2.2` — the binary is on `PATH`. An unshimmed A/B arm measures
   *bb-with-tools* against *bb-through-bash*, which **understates** bb's benefit and makes
   the headline meaningless. Mitigation is three-part and mandatory: a `bb` PATH shim that
   fails for arms A/B, a trace scan for absolute-path invocations, and `arm_enforcement`
   recorded on every run (`HARNESS.md` §4a). This is the most dangerous defect found and it
   was found by running, not by reading.
2. **Rate-limit confound** — removed from the headline by construction (C0 and C2 are
   network-free); in the C1 sub-arm it is measured by the fallback-rate field and capped
   by H5 — a run above 10 % is quarantined and re-run, never averaged away.
3. **Toollist cost** — measured by arm B; headline must be reported as C vs A *and*
   C vs B side by side.
4. **Agent adoption failure** — arm D exists for this; a "no benefit" result with a
   near-zero bb call rate is a *usage* finding, not a product finding, and must be
   reported as such, never as "bb does not work".
5. **Author grading their own product** — blind grading, pre-registered
   hypotheses, and `selftest.sh`; a reader can verify all three from the repo.
6. **Task bias toward bb** — Track 1's ground truth is from maintainers, not from bb's
   index; Track 4 is auto-generated. Only Track 2/3 carry authored judgement and are
   reported separately.
7. **"No significant difference" is not "no difference"** — one project set (n = 32)
   has 0.40 power at a 65/35 split; the pooled headline (n = 96) has 0.90. Any result
   between +5 and −5 points is reported as
   **inconclusive-with-bounds**, never as a verdict.
