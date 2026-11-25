# Observed environment — the measurements this benchmark design rests on

**Method:** every line below was run on the reference workstation on **2026-11-25**
and is a command a reader can repeat. Where a number comes from a file, the file and
line are cited. This page exists so that no design decision in
[`DESIGN.md`](./DESIGN.md) is taken on trust.

> Read rule: this is a **dated observation**, not a standing contract. The `bb`
> version, the ProxiCall index state and the embedding configuration can all change
> and these numbers become wrong together.

---

## 1 · Toolchain versions

| what | observed | command |
|---|---|---|
| `bb` | `0.2.2` | `bb --version` |
| `dsh` | `0.2.2-rc.5` | `dsh --version` |
| node | `v22.22.1` | `node -v` |
| agent model | `deepseek-v4.1-flash` via provider `freepi` | `~/.dsh/profiles/web/cordis.patch.yml:11-12` |
| embeddings (configured) | `nvidia/nemotron-3.5-embed-8b:free` @ `https://openrouter.ai/api/v1` | `bb setup show` |

## 2 · Machine (this is why the local-embedding decision is CPU-bound)

| resource | observed |
|---|---|
| CPU | 8 logical cores |
| RAM | 15 GB total, **~3.8 GB available** while the desktop + harness are running |
| swap | 19.9 GB total — **7.9 GB in use**, so the machine is already leaning on swap |
| GPU | none — `nvidia-smi` absent |
| local model runner | `ollama` 0.40.6 at `/usr/local/bin/ollama`; vLLM/llama.cpp absent |
| ollama models pulled | `nomic-embed-text:latest` (**274 MB, 768-dim embedder** — pulled for this benchmark) and `hf.co/DreamFast/qwen3-4b-heretic:Q4_K_M` (7.3 GB, a *generation* model) |
| ollama `/v1` endpoint | **OpenAI-compatible and working** — returns 768 dims, unit norm. So bb needs **no code change** to use it |
| benchmark embedder, verified | `nomic-embed-text` @ `http://127.0.0.1:11434/v1`, via a project `bb.json`; `bb setup show` → `Winner: project`, `bb index` → `embeddings: nomic-embed-text (768d)`, `bb_ask` → `method=vector` |

**The RAM pressure is real and permanent** — the desktop owns it, and closing windows only
frees it until the next window opens. But it is not bb's: see §2a.

### 2a · bb's own footprint, measured

`/usr/bin/time -v` around a full `bb index` of a 76-file JS project, with
`BB_EMBEDDING_DISABLED=1`:

```
MAXRSS_KB=284488   ELAPSED=1.25   →  ~278 MB peak RSS
files 76 | symbols 3576 | relationships 54810
```

And `BB_EMBEDDING_DISABLED=1` resolves cleanly — `bb setup show` reports
*"Chain: disabled (BB_EMBEDDING_DISABLED) — local word vectors only"* and
*"no embedding request will be made"*. So the zero-network configuration is a
first-class, supported mode, not a degradation path.

Consequence for the design: **the headline arm needs no embedder and no extra RAM.**
A local embedder, if a wave opts into C2, is a **bounded 0.7–1.5 GB reservation** made
releasable by `OLLAMA_MAX_LOADED_MODELS=1` + `OLLAMA_KEEP_ALIVE`; an 8B embedder does not
fit. DESIGN §7.

## 3 · The index is NOT healthy on this checkout (the run-quarantine rule)

`bb health` on the `backbencher-brain` checkout:

```
files=31354 symbols=1967081 relationships=3250175 imports=123528 syntaxErrors=9277
embeddings: 21167 rows / 1 spot(s) · configured nvidia/nemotron-3.5-embed-8b:free:
            0% (0/1967081) — BACKFILL PENDING
```

`bb doctor` on the same checkout:

```
✗ Model mismatch: config has nvidia/nemotron-3.5-embed-8b:free, index has tfidf-v1
  (21167 rows). Vectors from different models cannot be compared — the stored
  vectors are unusable.
```

So on the reference machine **the configured semantic space has 0 % coverage** and the
stored vectors are unlabelled-unusable. Any benchmark run taken in that state measures
the lexical fallback, not the product. This is the direct justification for the
**quarantine rule** in DESIGN §5.4: an arm whose `bb_health` is not green (or whose
degradation is not declared) is quarantined, never scored.

## 4 · Latency, measured (this is the discovery-cost baseline)

| call | observed wall time | note |
|---|---|---|
| `bb tool bb_search --args '{"query":"acquireIndexLock","limit":3}'` | **2.7 s** | exact symbol lookups on a 31 k-file index |
| `bb tool bb_ask --args '{"query":"…","limit":5}'` | **74.9 s** | cold start + semantic path; returned the **keyword** fallback |
| `bb health` | **19.8 s** | status only, no refresh |

The `bb_ask` result is the important one for the benchmark: with 0 % coverage the
answer was still *useful* (it found `src/ast/index-lock.ts:355` and `:172` through
lexical matching) and it **declared itself**:

```
Note: semantic embeddings are unavailable or insufficient for this query (coverage
too low), so the matches below are lexical, not semantic …
confidence: 0.2 (declared floor; no score was computed on that path)
```

Two benchmark consequences: (a) the fallback must be a **recorded arm field**, not an
error; (b) a 75 s `bb_ask` is a **cost** that the "discovery tax" endpoint must
include, not hide.

## 5 · The embedding blast radius (which tools can be rate-limited at all)

Read from source, not from documentation prose:

Only **two files in `src/` import the semantic search module at all** (verified with
`grep -rn 'from ".*semantic-search"' src/`), and each one belongs to exactly one tool:

| tool | can call the embedding provider at query time | source |
|---|---|---|
| `bb_ask` | **yes** — every non-stats query | `src/intelligence/search/quick-answer.ts:33` |
| `bb_doc` | **yes** — only the semantic *expansion* step of `feature` mode | `src/intelligence/documentation/doc-engine.ts:33`, call site `:709` |
| `bb_search`, `bb_graph`, `bb_impact`, `bb_visualize`, `bb_patterns`, `bb_security`, `bb_analyze`, `bb_health`, `bb_migrate`, `bb_cross_language`, `bb_annotate`, `bb_annotations`, `bb_edit`, `bb_index` | **no** — no import path to the embedding client | index-only engines |

The blast radius is therefore **two tools out of sixteen**. (This table is a correction:
an earlier draft of this page listed `bb_visualize`, which does not import semantic
search — `grep` on the visualization sources finds no such reference.)

**This table is the answer to "what happens when the embedding model is rate limited":**
the navigational core of the product — symbols, callers, callees, impact — is
*structurally* independent of the embedding provider. Only the natural-language door
degrades, and it degrades into a declared lexical answer.

Time bounds read from source:

- `EMBEDDING_WAIT_CEILING_MS = 2000` — a query embedding may block a tool for ≤ 2 s,
  then the local fallback runs (`src/intelligence/search/semantic-search.ts:56`).
- `EMBEDDING_WAIT_HARD_MAX_MS = 60_000` — the hard ceiling an explicit
  `BB_EMBEDDING_TIMEOUT_MS` cannot exceed (same file).
- Index-time 429 handling: per-batch degradation to local word vectors, `Retry-After`
  honoured, backoff 5 s → 10 s → 20 s → 30 s cap (`EMBEDDINGS.md`, "What a saved key
  actually gets at index time").

## 6 · The agent harness is redirectable (this is what makes the runs clean)

| probe | result |
|---|---|
| `dsh --profile headless --help` | exposes `--json` (NDJSON run events), `--permission-mode`, `-`/stdin task input, `--session-id` |
| `dsh --profile headless …` with the default `~/.dsh` | **fails** `EROFS: read-only file system, open '~/.dsh/profiles/headless/cordis.yml'` |
| same command with `DSH_HOME=$PWD/.tmp-bench/dshhome` (profile tree copied in) | **works**, `--dump-default-config` printed the composed config, `exit 0` |

So every benchmark run can get a private, writable, disposable DSH home. That is what
makes per-run cost accounting truthful and arms non-contaminating.

**A complete run was then executed**, not just a config dump. Isolated profile + copied
`dsh-free-pi-official` plugin + seeded `freepi-install.json`:

```
{"type":"text","text":"TAPE"}
{"type":"status","phase":"step_end","usage":{"inputTokens":7260,"outputTokens":4}}
{"type":"final","reason":{"kind":"completed"},"text":"TAPE"}
```

and with the `mcp-bb` row present, a real tool call:

```
{"type":"tool_call","tool":"mcp__bb__bb_search","input":{"query":"mul","mode":"symbol"}}
{"type":"tool_result","status":"completed","result":"{ … "relativePath":"src/math.js", … }"}
```

Session transcripts persist under `$DSH_HOME/sessions/<workspace-slug>/<sessionId>/`
as `session.v4.jsonl.zstd`, independent of the NDJSON trace. **Six failure traps were
hit and solved** getting there — they are recorded in [`HARNESS.md`](./HARNESS.md), and
one of them (a missing `transport: stdio`) silently produced a run with **no bb tools**. 

`/tmp` is **ephemeral per command** in this session (`mkdir /tmp/x` in one call is absent
in the next), so the harness must build its homes under the workspace, not `$TMPDIR`.

## 7 · Where bb is mounted today (and why arm A needs a synthetic profile)

`~/.dsh/profiles/web/cordis.patch.yml:160-167`:

```yaml
- id: mcp-bb
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: bb
    transport: stdio                                   # REQUIRED — see HARNESS.md
    command: /home/ishaq2321/.nvm/versions/node/v22.22.1/bin/bb
    args: [ 'mcp', '--dir', '/home/ishaq2321/ProxiCall' ]
    toolCallTimeoutMs: 120000
    failOnStartupError: true
```

Two facts follow: (a) bb is mounted as a **preset plugin**, so it cannot be toggled
from outside a profile file; (b) it is **hardwired to the ProxiCall checkout**. Arm A
therefore needs a profile with this row *absent* — disabling bb inside a single
shared DSH home would leave the MCP child running for every arm.

## 8 · Local model-server feasibility (the C2 arm)

`EMBEDDINGS.md` known-good providers include, verbatim:

```
| Self-hosted vLLM    | http://localhost:8000/v1 | any served model | OpenAI-compatible |
| Self-hosted llama.cpp | http://localhost:8080/v1 | any served model | OpenAI-compatible |
```

So the local-embedding arm needs **no code change** — only a config file
(`bb.json` at the project root, precedence `env > ~/.bb/config.json > bb.json`).
What it needs is an embedding model small enough for §2's headroom.

## 9 · Corpus state in this checkout (why the dataset ships without clones)

- `.corpus/*` are **depth-1 shallow clones**, not full history. Verified:
  `git rev-parse --is-shallow-repository` → `true`, `.git/shallow` is populated, and
  `git log` inside `.corpus/lodash` returns exactly one commit
  (`2b5e6f7 ci: update actions to latest versions (#6279)`). The working tree is
  complete; the *history* a replay task needs (base commit → fix commit) is not there.
- `.corpus*/` is **gitignored** — `git check-ignore -v .corpus/lodash` →
  `.gitignore:161:/.corpus*/`.
- `validation/m11/corpus-manifest.json` pins revisions for large corpora
  (e.g. `microsoft/TypeScript` @ `b465fdbfe175304d9b977da137b2c178ae1091d3`) outside
  the repo tree.

Consequence: the benchmark dataset cannot copy this pattern. It ships **pins + text**
and reconstructs ground truth at run time (DESIGN §9).
