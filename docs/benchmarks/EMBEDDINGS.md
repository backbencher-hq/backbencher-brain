# Embedding setup for benchmark runs — verified recipe

**Purpose:** every benchmark teammate indexes their project through a **known, recorded
embedder**. This page is the configuration of record. If a lane's index does not match
this, its run is not comparable and is quarantined.

**Verified on the reference workstation, 2026-11-25.** Every command below was run.

---

## 1 · The decision

| arm | embedder | config | why |
|---|---|---|---|
| **C0 — headline** | `local-word-vectors-v3` (built in, 50-dim) | `BB_EMBEDDING_DISABLED=1` | zero network, zero extra RAM, zero quota; measured 278 MB peak index RSS |
| **C2 — recommended local** | `nomic-embed-text` (768-dim, 274 MB) via Ollama | `bb.json`, below | real semantic search with **no** rate limit and **no** credential a reader lacks |
| **C1 — reported only** | `nvidia/nemotron-3.5-embed-8b:free` (remote) | `bb setup` | has an as-yet-unfixed 0 % coverage state on this machine; never the headline |

**This is why the benchmark is reproducible:** C0 and C2 both run with the network down.
A reader with a laptop and no API key can reproduce the headline.

## 2 · Prepare the local embedder (once per machine)

```bash
ollama serve &                              # 0.40.6 here; serves OpenAI-compatible /v1
ollama pull nomic-embed-text                # 274 MB, 768 dimensions

# verify: must return 768 dims and a unit-norm vector
curl -s http://127.0.0.1:11434/v1/embeddings \
  -H 'content-type: application/json' \
  -d '{"model":"nomic-embed-text","input":"acquire index lock"}' \
  | python3 -c "import json,sys; v=json.load(sys.stdin)['data'][0]['embedding']; print(len(v))"
# → 768
```

`OLLAMA_KEEP_ALIVE` defaults to `5m`; a model leaves RAM when idle. For a wave, pin it
once to avoid cold-start noise:

```bash
OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_KEEP_ALIVE=-1 ollama serve &
```

## 3 · Configure a benchmark project (per project, committed)

Write `bb.json` at the **project root** (not the repo root — precedence is
`env > ~/.bb/config.json > ./bb.json`, so the project file wins for a run and does not
affect anyone else's index):

```json
{
  "embedding_base_url": "http://127.0.0.1:11434/v1",
  "embedding_model": "nomic-embed-text",
  "embedding_api_key": "ollama"
}
```

```bash
chmod 600 bb.json          # bb warns at mode 664: "expected: 600 — fix with bb doctor"
bb setup show              # must say: Winner: project · Chain: remote ready
```

The `embedding_api_key` is a **dummy** for a local server; it is not a secret and is safe
to commit. A real remote key must **never** be committed — use an env var for those.

## 4 · Index and VERIFY (the gate before a run may be scored)

```bash
BB_DATA_DIR=<wave>/bbdata bb index . --no-setup
```

The run report must print the model it actually used:

```
embeddings: nomic-embed-text (768d)
```

Then assert, before any run counts:

```bash
bb tool bb_health --args '{}'      # via MCP: structured, has a boolean `healthy`
```

| check | must be |
|---|---|
| `bb setup show` | `Winner: project`, `Chain: remote ready` (C2) or `disabled` (C0) |
| index report | `embeddings: nomic-embed-text (768d)` — **not** `tfidf-v1` |
| `bb_ask` retrieval | `method=vector`, `queryModel=nomic-embed-text`, `indexModel=nomic-embed-text` |
| `bb_health` | no `MODEL_MISMATCH`; a coverage warning is **declared**, not fatal |

**A run whose `bb_ask` reports `method=keyword-fallback` is quarantined**, not scored — it
measured the lexical path, not the product. (See §6 for the one benign exception.)

## 5 · Coverage is measured over *embeddable kinds* — read this before panicking

Measured: a project with 8 functions + 4 modules shows `8/12 symbols` and a
`BACKFILL PENDING` warning. **That is not a fault.**

From `src/brain/brain-index-health.ts:840-850`:

> the symbol kinds that DO appear in the embedding table are the kinds the embedder
> targets for this project, and coverage is measured over those … A user told "48 of 60
> functions are embedded" can act; a user told "22% of 45,018 symbols" cannot.

Verified empirically: exactly the **functions** got vectors; `constant`, `module` and
`property` never do. So:

- **43 % of all symbols** and **100 % of functions** are the same index, both true.
- Do **not** "fix" coverage by re-running `bb index` repeatedly — measured: coverage did
  **not** rise across three consecutive passes (12 → 12 → 12). It is a kind ceiling, not a
  backlog.
- The `BACKFILL PENDING` warning persists on a fully-embedded functions set. Treat it as
  **declared state**, and record it verbatim in the run record rather than treating it as
  a failure.

## 6 · Cold start can spend the query budget (operational note)

`bb_ask` may block on a query embedding for at most `EMBEDDING_WAIT_CEILING_MS = 2000`
(2 s). On a **cold** model, the first query of a run can exceed that and fall back to
keyword — declared in the answer as `reason=degenerate-query-vector` or a
`keyword-fallback` method.

Measured: a cold query took **2.39 s** total and still reached `method=vector`; a warm
query is faster. To remove the variable entirely, warm the model once per wave:

```bash
curl -s http://127.0.0.1:11434/v1/embeddings -H 'content-type: application/json' \
  -d '{"model":"nomic-embed-text","input":"warmup"}' >/dev/null
```

Record whether the probe ran in `run-record.json.bb.embedding_warmup: true|false`.

## 7 · RAM: the ceiling is real and it bit us

During this setup, indexing a mid-size corpus (lodash, 77 files) **with** the local
embedder, while ~8 GB of swap was already in use, **hung the machine** — it had to be
restarted. That is not a theoretical caveat.

| fact | measured |
|---|---|
| index peak RSS, embeddings **disabled** | **~278 MB** |
| `nomic-embed-text` resident | **~335 MB** (plus the server process) |
| the box | 8 cores, 15 GB, and the desktop already consumes most of it |
| what went wrong | indexing + embedder + desktop exceeded RAM; the kernel thrashed |

**Consequences for every teammate, non-negotiable:**

1. **Index with `--no-setup` and watch memory**; do not index several large projects
   concurrently in one lane.
2. **Never run more concurrent runs than the machine can hold** — `run-arm.ts` takes
   `--concurrency` and records it (DESIGN §12.1).
3. **C0 (no embedder) is the safe default** if the machine is already loaded. It costs no
   additional RAM and is the headline arm anyway.
4. Free swap before a wave: `free -m` and `swapon --show`. A wave launched with swap
   already full will produce latency numbers that are artefacts of the kernel.

## 8 · What each teammate must hand back

For the lane's project, before its first scored run:

```json
{
  "embedding_arm": "C0" | "C2" | "C1",
  "embedding_config": "local-word-vectors-v3:50" | "nomic-embed-text:768@http://127.0.0.1:11434/v1",
  "bb_setup_show_verbatim": "…",
  "index_report_verbatim": "embeddings: nomic-embed-text (768d)",
  "health_warning_verbatim": "…BACKFILL PENDING…" | null,
  "embedding_warmup": true,
  "peak_rss_index_mb": 278
}
```

The lead refuses a lane that cannot produce these: an unrecorded embedder makes the
result unpublishable, because "bb helps" is a different claim depending on which semantic
door was open.
