# Configuring embeddings

> Source of truth: the precedence resolver `resolveEmbeddingConfig`
> (`src/config/config.ts:35-53`), the client `src/brain/semantic/openai-embed.ts`,
> the local fallback in `src/brain/semantic/local-embed.ts`, the wizard and
> reporter in `src/setup/`, and `docs/EMBEDDINGS.md` for retrieval semantics.
>
> **This document contains no API key and never will.** It references environment
> variable *names* only. Do not commit a key to `bb.json`, to a docs file, to a
> test fixture, or to a log.

## What embeddings are for

The brain stores one dense vector per indexed symbol in
`brain_semantic_embedding`. Those vectors power `bb_ask` — natural-language
questions. They do **not** power `bb_search`, which has no semantic mode
(`docs/EMBEDDINGS.md` §6).

Embeddings are generated **in the background after indexing**, in batches. So a
run's summary line showing `0 embeddings` is normal — the vectors land
afterwards. Coverage is a per-run measurement, never a fixed product number
(`docs/EMBEDDINGS.md` §3).

## The free/local fallback: you do not need a key

With no configuration at all, semantic search still works. It falls back to
built-in local word vectors:

| Property | Value |
| --- | --- |
| Model label | `local-word-vectors-v3` (`src/brain/semantic/engine.ts:49`) |
| Dimensions | 50 (`src/brain/semantic/local-embed.ts:6`) |
| Dependencies | none — no downloads, no model files |
| Strength | weaker than a real embedding model; lexical similarity over project vocabulary |

`bb setup show` says so plainly when nothing is configured:

```
Winner: none — semantic search will use local vectors (weaker). Setup: bb setup
```

and `bb doctor` reports it as a warning, not a failure:

```
warn  Semantic search will use local-word-vectors-v3 (weaker).
```

**This is a supported configuration, not a broken one.** It is also what CI and
MCP hosts get by default, because they have no TTY to prompt on
(`src/setup/setup-wizard.ts:357-371`). If you never configure anything, indexing
still runs, `bb_ask` still answers, and it reports its own degradation rather
than pretending.

## Configure a provider

### Option A — the wizard (recommended)

```
bb setup
```

It validates the endpoint with a real request before saving, maps failures to
actionable messages (a 401 means the key was rejected, a 429 means the key is
fine and you are rate-limited, a 404 means the model name is wrong), and writes
`~/.bb/config.json` with mode **0600** via a temp file and an atomic rename
(`src/setup/setup-wizard.ts:170-183`).

`bb setup` requires an interactive terminal and exits with
`bb setup requires an interactive terminal.` otherwise
(`src/cli/index.ts:701-711`).

### Option B — environment variables

```bash
export BB_EMBEDDING_BASE_URL="https://<your-endpoint>/v1"
export BB_EMBEDDING_MODEL="<your-embedding-model>"
export BB_EMBEDDING_API_KEY="<your-key>"
```

Read the key from your secret store, your shell profile, or your CI secret
manager. Do not hardcode it.

### Option C — a config file

`bb.json` in the project root, or `~/.bb/config.json` globally:

```json
{
  "embedding_base_url": "https://<your-endpoint>/v1",
  "embedding_model": "<your-embedding-model>",
  "embedding_api_key": "<your-key>"
}
```

Prefer environment variables over `bb.json` for the key if the file is ever
going to be committed. `bb.json` at the project root is the tier most likely to
be shared with other people or checked into git.

## Precedence

Highest tier wins, per field, independently (`src/config/config.ts:18-25`,
`:35-53`, `:69-83`):

1. **Environment** — `BB_EMBEDDING_BASE_URL` / `BB_EMBEDDING_API_KEY` /
   `BB_EMBEDDING_MODEL`
2. **Config files** — explicit `BB_CONFIG_FILE` > `./bb.json` >
   `<data-dir>/config.json` (`~/.bb/config.json` by default)
3. **Built-in default** — `https://api.openai.com/v1` and
   `text-embedding-3-small`

Two things that surprise people:

- The built-in defaults are **not** treated as "configured". A tier only counts
  as configured when both a base URL and a model were set by env or file
  (`src/config/config.ts:50`). Without that, an untouched install would look
  remotely configured and would fail every request.
- **`BB_CONFIG_FILE` exists** so an MCP host can point at a workspace `bb.json`
  regardless of the process's working directory
  (`src/config/config.ts:77`).

Verify what is actually winning:

```
bb setup show
```

```
bb — embedding configuration
Precedence: env > ~/.bb/config.json > bb.json

env:     ✓ https://<endpoint>/v1 · <model> · key: ••••<last-4>
global:  — (not set)
project: ✓ https://<other>/v1 · <other-model> · key: none · mode: 600

Winner: env
```

Notes on that output:

- The key is printed as a **fingerprint only** — the last four characters. The
  full key is structurally absent from the rendered output
  (`src/setup/setup-show.ts:133-176`, `src/setup/setup-wizard.ts:166-168`).
- An incomplete tier is shown with what's missing and can never win, even if it
  appears first.
- A file mode other than `600` is flagged, because the file holds a key.
- `bb setup show` exits non-zero if nothing is configured.

## What is required

| Field | Required? | Notes |
| --- | --- | --- |
| base URL | **Yes**, together with the model | Must be a `/v1`-style OpenAI-compatible base; the client posts to `<baseURL>/embeddings` (`src/brain/semantic/openai-embed.ts:52`). Trailing slashes are stripped. |
| model | **Yes** | Its name becomes the stored `embedding_model` label. |
| API key | Not for the tier to be *configured*; yes for most hosted providers | The `Authorization: Bearer` header is only sent when a key is present (`src/brain/semantic/openai-embed.ts:85`). Self-hosted servers that do not authenticate can omit it. |
| dimension | No | `embedding_dimension` in the config file, when your provider returns a fixed width. |

Any OpenAI-compatible `/embeddings` endpoint works — OpenAI, Google, NVIDIA
NIM, or a self-hosted vLLM / llama.cpp server. Loopback endpoints get
`NO_PROXY` handling so a local server behind a proxy configuration is not
unreachable (`src/brain/semantic/openai-embed.ts:59-72`).

## Diagnose with `bb doctor`

```
bb doctor
```

Read-only by default. It checks four things (`src/setup/doctor.ts:104-202`):

| Finding | Severity | Fix it prints |
| --- | --- | --- |
| `no-config` | fail | `bb setup` |
| `incomplete-{env,global,project}` | fail | `bb setup` |
| `mode-{env,global,project}` | warn | `bb doctor --fix` |
| `model-mismatch` | fail | `bb index --force` |
| `model-mixed` | warn | `bb index --force` |
| `semantic-degraded` | warn | `bb setup` |

`bb doctor --fix` applies exactly one repair: file permissions back to `0600`.
It is read-only without the flag (`src/cli/index.ts:723-738`).

## When you change the model, you must re-embed

Vectors from different models occupy different vector spaces and are **never**
compared with each other, even at the same dimension
(`docs/EMBEDDINGS.md` §2). Changing `BB_EMBEDDING_MODEL` therefore does not
re-embed anything; it makes every previously stored vector unusable for search.

The symptom is that `bb doctor` reports:

```
fail  Model mismatch: config has <new-model>, index has <old-model> (412 rows).
      Vectors from different models cannot be compared — the stored vectors are unusable.
```

The fix is the one it names:

```
bb index --force
```

This is the correct and only fix — a full re-index is what re-embeds. The
storage query is what enforces the invariant: only rows whose `embedding_model`
equals the query model **and** whose `vector_dimension` equals the query vector
length are ever candidates.

## Environment variables that control embedding behaviour

| Variable | Default | Effect |
| --- | --- | --- |
| `BB_EMBEDDING_BASE_URL` | — | OpenAI-compatible base URL. |
| `BB_EMBEDDING_MODEL` | — | Embedding model name; becomes the stored label. |
| `BB_EMBEDDING_API_KEY` | — | Sent as `Authorization: Bearer`. Read it from your secret store. |
| `BB_EMBEDDING_QUEUE_LIMIT` | `25000` | Cap on queued items for the background embedder (`src/ast/parallel-indexer.ts:1821`). Beyond it, work is dropped rather than queued forever. |
| `BB_EMBEDDING_CALL_TIMEOUT_MS` | `60000` | Bounds a single provider call, so a wedged or hanging server cannot permanently stall the drainer (`src/ast/parallel-indexer.ts:1832`). A timeout is treated as a provider failure and routed to the fallback. |
| `BB_EMBEDDING_BATCH_LIMIT` | `50000` | A batch at or above this size is not queued for embedding at all (`src/ast/parallel-indexer.ts:1897`). |
| `BB_EMBEDDING_CACHE_MAX` | `128` | LRU entry cap on the in-process embedding cache (`src/brain/semantic/engine.ts:157`). The cache key includes the effective model *and* endpoint, so a config change can never serve a vector from a different space. |
| `BB_VECTOR_SCAN_CAP` | `20000` | Cap on candidate rows loaded by a semantic query (`src/intelligence/search/semantic-search.ts:15`). When hit, `provenance.truncated` is `true` and `metadata.scannedRows` reports exactly how many were read. |
| `BB_DATA_DIR` | `~/.bb` | Where `config.json`, `status/`, `projects/` and `logs/` live (`src/util/bb-data-dir.ts:11`). |

## Honest limits

- **A key in a config file is a key on disk.** `bb setup` writes `0600` and
  `bb doctor --fix` repairs the mode, but nothing stops you from committing a
  `bb.json` to git. Use environment variables for anything shared.
- **Coverage is volatile.** The embedding API batches and rate-limits, so one
  run may embed a different fraction of the same corpus than the next
  (`docs/EMBEDDINGS.md` §3). `bb health` reports what was actually measured.
- **The query vector may not be the configured model.** The API layer can fall
  back to local word vectors; the model that *actually produced* the last
  vector is authoritative (`docs/EMBEDDINGS.md` §2). This is why the stored
  label is written from the real producer.
- **`bb_search` does not use embeddings at all.** No semantic mode exists. Any
  documentation or UI implying otherwise is wrong.
- **Embedding time as a share of index time is not measured.**
  `docs/m20/PERFORMANCE-DIAGNOSTIC.md:24` explicitly declines to attribute a
  slow run to embeddings for lack of evidence.

## Related

- [`../EMBEDDINGS.md`](../EMBEDDINGS.md) — vector semantics, coverage, retrieval
  measurements, fallback reasons
- [`README.md`](README.md) — flag semantics
- [`performance.md`](performance.md) — where index time actually goes