# Prior work — what exists, and what it says about our design

**Status: this page is load-bearing.** Several external studies bear directly on how this
benchmark must be built. Ignoring them would mean re-deriving known results and, worse,
publishing a number that a reviewer can dismiss with one citation.

Method: `web_search` is broken on this machine (HTTP 402, DeepSeek search endpoint out of
balance). `web_fetch` works, so these were found via the **arXiv API** (Atom feed) rather
than a search engine. Every row below was read from the paper's own abstract export; where
a claim is paraphrased it is marked.

---

## 1 · The paper we must not ignore — ours is nearly a replication

**Bellam, S. (2026). _How Much Do Structural Tools Help Small Coding Agents? A
Pre-Registered Scale Study of Code Localization._ arXiv:2610.33958v2.**
<https://arxiv.org/abs/2610.33958>

This is the same question, run at a scale we cannot match:

| | their study | this benchmark |
|---|---|---|
| arms | grep-only · +embedding · +code-graph · both · **placebo** | A · B · C · D |
| models | 9 open-weight (Qwen3 0.6B–32B, Gemma 4) | one (deepseek-v4.1-flash) |
| tasks | 500 held-out SWE-bench localizations | ~40 hand-anchored replay tasks |
| episodes | **170,500** | 1 so far |
| pre-registration | frozen before runs | drafted, not frozen |

### Their four findings, and what each does to our design

1. **The embedding index carries the gain; the code graph does not.**
   → **Our headline arm C0 runs with `BB_EMBEDDING_DISABLED=1`, which disables exactly the
   component their study found to be the active ingredient.** C0 was chosen for
   reproducibility (no network, no quota, +0 RAM). That trade is now suspect: we may be
   measuring the part that does not work and calling it the headline. C2 (local
   `nomic-embed-text`) is no longer "recommended local arm" — it is a **co-headline
   requirement**.
2. **A placebo arm is essential.** Their placebo (structural tools returning *random
   entities*) showed the gain comes from *what the tools return*, not from *having them* —
   and that random output **harms** two small models.
   → **We have no placebo arm.** Without one, a C-vs-A difference cannot be attributed to
   content at all: it is equally consistent with "the agent tried harder because tools
   existed". This is a genuine hole in the four-arm matrix.
3. **Benefit shrinks with model size** (+0.06–0.10 up to 14B, +0.03 at 32B, none for one
   model). Their 32B already finds the code without tools.
   → We run **deepseek-v4.1-flash**, a large model. On their evidence we should *expect a
   small effect*, and a null result here is a **predicted** outcome, not a failure. That
   must be stated before the data, not after.
4. **The gain is mostly exposure** — the tools show the gold code more often; they do not
   make the model reason better. Small models "act on a shown answer" less often
   (conversion 0.09 / 0.24 / 0.40 at 1.7B / 4B / 32B).
   → This gives us a **mechanism to test explicitly**: if bb helps, it should show the gold
   file *earlier* (discovery tax), not merely produce a better patch. Our discovery-tax
   endpoint is the right proxy — and we should report **exposure** (was the golden file
   ever shown?) separately from **conversion** (did the agent act on it?).

### Consequence: the arm matrix must gain a fifth arm

`E` = **placebo**: bb mounted, probe passes, but `bb_search`/`bb_ask` return arbitrary
indexed symbols instead of ranked ones. Then:

- **C vs A** = the product effect (what we want to claim)
- **C vs E** = how much of it is *content* rather than *context presence*
- **E vs A** = the harm/help of noise (their study: negative for some models)

A benchmark without C vs E cannot distinguish "bb is good" from "having 16 tools makes an
agent try harder". That is the single most important change to `ARMS.md`.

---

## 2 · Contamination: our mitigation is weaker than the published standard

**arXiv:2611.17388 — _Time-Consistent Evaluation of Hierarchical Code Graphs for SWE
Agents_**

Locks repository snapshots and knowledge graphs at a historical cutoff `T0` and evaluates
only **post-`T0`** pull requests ("strict zero-leakage isolation"). Reports +15.6 % to
+86.2 % relative F1 across every model/repo/granularity, `p < 1e-4`.

→ Our `DESIGN.md` §13 lists contamination as risk #1 and mitigates it with *centering* +
a "two-unseen-one-known" repository rule. **That is inference, not isolation.** The
stronger, published protocol is a **dated cutoff**: for each task, require
`fix_commit_date > model_training_cutoff`. Our pinned repositories have commit dates; we
can enforce this mechanically in `replay-anchor.ts` and record the cutoff in the
preregistration. This is cheap and closes the largest hole in our validity story.

---

## 3 · Code retrieval has its own benchmarks — and we should cite them honestly

| paper | what it gives us |
|---|---|
| **CoIR** (arXiv:2407.02883, ACL 2025 Main) | the standard code-retrieval benchmark: 10 datasets, 8 tasks, 7 domains. This is the citation `DESIGN.md` §1 originally wanted and I had **removed** because I could not verify it. It is verifiable now — restore it. |
| **CORE-Bench** (arXiv:2606.11864, EMNLP 2026) | 180 K queries; shows a **sharp drop** from docstring-to-function search to agentic repository retrieval. Exactly the gap bb claims to close, and it argues our T1 replay choices are well-targeted. |
| **CoQuIR** (arXiv:2506.11066) | quality-aware retrieval: top retrievers **fail to distinguish buggy from correct code**. Directly relevant to a tool that returns "the" symbol. |
| **CodeXEmbed** (arXiv:2411.12644) | SOTA code embedders (400M–7B), +20 % over Voyage-Code on CoIR. Relevant to our `nomic-embed-text` choice: it is a *general text* embedder, not a code one. |
| **MMTEB** (arXiv:2502.13595, ICLR) | 500+ embedding tasks incl. code; useful for choosing a better local embedder. |

→ Two concrete actions. **(a)** Restore the CoIR citation I deleted. **(b)** Our embedder is
a general-purpose text model; a code-specialised one is available and could change results.
The embedder is already recorded per run (`EMBEDDINGS.md` §8), so this is an experiment, not
a redesign — but the headline must name the embedder and the choice must be justified, not
defaulted to.

---

## 4 · What "structural tools" already achieve — the bar we are measured against

| paper | result |
|---|---|
| **Code Graph Model** (arXiv:2505.16901) | code graph fused into attention: **43.00 %** on SWE-bench Lite with Qwen2.5-72B, no agent loop |
| **RepoAtlas** (arXiv:2609.16936) | evolving multimodal repo views: **+2.4 pts** resolve, −5.8 % tokens, −7.8 % calls on SWE-bench Verified |
| **GraphCodeAgent** (arXiv:2504.10046) | dual graph (requirement + structure) beats baselines on DevEval/CoderEval |
| **CodexGraph** (arXiv:2408.03910) | graph-DB interface for agents; CrossCodeEval/SWE-bench/EvoCodeBench |
| **RAIM** (arXiv:2603.01814) | architecture-aware multi-design: **39.47 %** on NoCode-bench Verified |
| **Echo** (arXiv:2603.07326) | graph-enhanced retrieval for reproducing tests: **66.28 %** SWT-Bench Verified |

→ None of these is bb, and none measures *agent utility of a pre-installed MCP tool server*.
The gap bb occupies is real. But the numbers set the expectation: **graph tools in the
literature produce low-single-digit-to-single-digit-point gains on resolve rate**, not
multiples. A marketing claim of a large effect is not supported by adjacent literature, and
we should say so before we measure.

---

## 5 · Process/evaluation methodology we should borrow

- **arXiv:2608.22960 — _What Process Evaluation of Coding Agents Actually Measures_**: shows
  action / task / step are three different levels and that **full-trace judges exhibit
  systematic collider bias** — i.e. grading a whole trace measures semantic relevance, not
  causal contribution. → Our blind grader grades the *patch against tests*, not a judge
  reading the trace. That choice is correct and now has a citation.
- **arXiv:2609.36319 — StateTape / TraceBench**: models the repo as a symbol-level code graph
  and asks *which evidence the agent held vs which it needed*. This is a rigorous version of
  our discovery tax and a candidate replacement metric.

---

## 6 · MCP-specific work that touches bb directly

| paper | relevance |
|---|---|
| **MCPCrawler** (arXiv:2509.25292): 8,401 projects measured | >half of MCP listings are invalid/low-value; sets context for "is this server worth installing" |
| **MCPZoo** (arXiv:2512.15144): 129,059 servers, 16,356 verified runnable | the dataset an MCP-tool benchmark should sample from |
| **MPMA** (arXiv:2505.11154): preference manipulation attack | **tool descriptions are an attack surface** — a server can manipulate model choice via name/description. bb's 16 tool descriptions are exactly this surface |
| **NetMCP** (arXiv:2510.13467) | network-aware MCP routing + benchmark; latency is a first-class variable, which our arrival-time measurement only approximates |
| **ToolRosetta** (arXiv:2610.24055) | tool-call guards behave differently under shell vs JSON surface form — warns that our bash-observable behaviour is not identical to JSON-tool behaviour |

---

## 7 · What this page changes (concrete)

1. **Add arm E (placebo)** to `ARMS.md` and the harness; report C vs E as the content effect.
2. **Promote the embedder**: C0 cannot be the headline alone. Run **C0 and C2 both**, report
   both, and state that published evidence attributes the gain to the embedding index.
3. **Enforce a training-cutoff rule** in the preregistration: `fix_commit_date >
   model_cutoff`, recorded per task.
4. **Report exposure and conversion separately** in the discovery section.
5. **Restore the CoIR citation** and cite CORE-Bench / CoQuIR / CodeXGraph / CGM in §1.
6. **State the expected effect size before the data** — low single digits — so a null is not
   retrofitted into a win.

Items 1–4 are code changes. They are cheap now and structurally expensive later; they should
land **before** the roster is built, not after.
