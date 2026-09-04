# Semantic Embeddings — Setup Guide

brain-core ships two embedding layers:

1. **API embeddings** (best quality) — any OpenAI-compatible `/embeddings`
   endpoint: Google Gemini, NVIDIA NIM, OpenAI, or a self-hosted vLLM /
   llama.cpp server. Off by default — one config file or 3 env vars turns it on.
2. **Local word vectors** (offline fallback) — always available, no API key.
   Quality is keyword-level, not true semantics.

## Interactive setup: `bb setup` (recommended first run)

`bb setup` walks you through provider choice with prefilled base URL and model
so you only paste the API key (input is hidden). It validates the key with one
live `/embeddings` call before saving, writes `~/.bb/config.json` with mode
0600 (owner-only), and never stores the key anywhere else. The built-in free
options are:

| Provider | base_url (prefilled) | model (prefilled) |
|---|---|---|
| OpenRouter free | `https://openrouter.ai/api/v1` | `liquid/lfm-2.5-embedding-350m:free` |
| NVIDIA NIM free | `https://integrate.api.nvidia.com/v1` | `nvidia/nemotron-3-embed-1b` |
| Custom / paid | you supply both | you supply both |

If you skip setup or have no key, `bb index` shows exactly this notice (one
line, non-interactive environments never block on it):

```
note: no embedding key — semantic search will use local vectors (weaker). Setup: bb setup
```

The wizard runs **once**: an explicit skip is remembered (a `setup_skipped`
marker in the 0600 config), so `bb index` never re-prompts after you chose to
skip. Entering a key later via `bb setup` replaces the skip automatically.

### What a failed key validation means (pre-save, `bb setup`)

A key is validated before it is saved. The exact messages users see:

- `Key rejected (401). Check the key and provider — copy-paste may have dropped or added characters.`
- `Rate limit (429). The key looks valid; free-tier limit. It can be saved — indexing backs off and retries.`
- `Provider error (503). The key may be valid; the provider is temporarily failing. It can be saved — indexing retries automatically.`
- `Model not found (404). Check the model name: the provider's /embeddings endpoint does not recognize it.`
- `Provider did not respond (timeout). Check your internet connection and the base URL.`
- `Could not reach the provider: <error>. Check the base URL.`
- `Provider returned invalid JSON. The base URL must be a /v1 endpoint.`
- `Provider returned no embedding. Check the base URL and model name.`

429 and 5xx are treated as "key shape accepted" (rate/provider side issue) and
saved; index-time resilience (per-batch fallback + 429 backoff) retries them.
A 401/403/404 or malformed response is a hard error: the key is NOT saved.

## Inspecting and diagnosing: `bb setup show` and `bb doctor` (M32)

`bb setup show` prints the effective embedding configuration without ever
displaying the full key — the key appears only as its last four characters:

```
bb — embedding configuration
Precedence: env > ~/.bb/config.json > bb.json

env    : — (not set)
global : ✓ https://g.example/v1 · g-model · key: ••••2345 · mode: 600
project: — (not set)

Winner: global
```

It names the winning precedence tier, shows incomplete tiers with what is
missing (an incomplete tier can never win), warns when a config file's mode is
not 0600, and exits 1 when nothing is configured (scripts can branch on it).
A corrupt config file is treated as an absent tier — it never crashes.

`bb doctor` diagnoses degradation from real local state (config file, file
permissions, and the embedding models actually stored in the project index —
read-only, no network). Every finding names the exact fix command:

```
bb doctor — diagnostics

✗ No embedding configuration.
  Fix: bb setup
! global config file has mode 644 — the key may be world-readable.
  Fix: bb doctor --fix
· No stored vectors for this project (no index or empty). Config model: g-model.
  Fix: bb index .
```

A model mismatch (config says one model, the index was built with another) is
reported as a hard failure with `Fix: bb index --force` — stored vectors
from different models are never compared. `bb doctor` exits 1 when a fail-level
finding exists.

### `bb doctor --fix`: the only mutating arm

`bb doctor --fix` repairs **only file permissions** of embedding config files
to 0600. It prints every change it makes; config content, keys, and the index
are never modified by `--fix`. Everything else remains advice naming the exact
command — diagnosis never auto-mutates, and `--fix` never touches anything
beyond permissions:

```
bb doctor --fix — applied

✓ /root/.bb/config.json: mode 644 -> 600 (applied)
```

## Discovering these commands

Every command documents itself: `bb --help` lists all commands,
`bb <command> --help` shows that command's options, and `bb -v`,
`bb version`, and `bb --version` all print the version. A mistyped command
suggests the closest real one (`bb docter` suggests `doctor`). The full
manual ships with npm installs and is available as `man bb`.

## Quick start (3 environment variables)

```bash
export BB_EMBEDDING_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
export BB_EMBEDDING_API_KEY=your-google-api-key
export BB_EMBEDDING_MODEL=text-embedding-004

bb index ./my-project          # vectors stored under text-embedding-004
```

## Config file (per machine)

`~/.bb/config.json`:

```json
{
  "embedding_model": "text-embedding-004",
  "embedding_base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
  "embedding_api_key": "your-google-api-key"
}
```

`bb.json` in the project root overrides it per project. Environment variables
(`BB_EMBEDDING_*`) always win.

## Known-good providers

| Provider | base_url | model | notes |
|---|---|---|---|
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | `text-embedding-004` (768d) or `gemini-embedding-001` (3072d) | OpenAI-compatible endpoint |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | `nvidia/nv-embedqa-e5-v5` (1024d) or `nvidia/bge-m3` | OpenAI-compatible |
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` (1536d) or `-3-large` (3072d) | native |
| Self-hosted vLLM | `http://localhost:8000/v1` | any served model | OpenAI-compatible |
| Self-hosted llama.cpp | `http://localhost:8080/v1` | any served model | OpenAI-compatible |

### Google (Gemini API key from aistudio.google.com)

```
BB_EMBEDDING_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
BB_EMBEDDING_MODEL=text-embedding-004
```

### NVIDIA NIM (key from build.nvidia.com)

```
BB_EMBEDDING_BASE_URL=https://integrate.api.nvidia.com/v1
BB_EMBEDDING_MODEL=nvidia/nv-embedqa-e5-v5
```

## What changes when it's on

- `bb index` stores real embedding vectors (`brain_semantic_embedding`,
  `embedding_model` = your model, `vector_dimension` = the model's dimension)
- Semantic search ranks by cosine similarity over those vectors
- No key configured? The index falls back to local word vectors and semantic
  search degrades to keyword-level matching — nothing breaks.

## How indexing generates them (background queue)

Embedding generation is **non-blocking**: `bb index` completes and returns
usable code intelligence immediately, while vectors populate lazily on a
shared background queue (one serialized drainer per process). To wait for the
queue before reading vectors back programmatically, call
`flushBackgroundEmbeddings()` from `src/ast/parallel-indexer`. Call it before
closing or deleting a project database; queued jobs must never outlive their
SQLite handle.

Two knobs bound the work so huge repositories never stall indexing or exhaust
memory:

- `BB_EMBEDDING_BATCH_LIMIT` (default `50000`) — a single storeResults batch
  at or above this limit is skipped entirely (no vectors).
- `BB_EMBEDDING_QUEUE_LIMIT` (default `25000`) — total queued snippet-items
  across the process. Once the queue is at capacity, further batches are
  dropped with a debug log rather than accumulated in memory.

Dropped batches are recoverable: run `bb index --force <project>` (or re-run
`bb_refresh(force)`) to generate vectors for the whole project at once. For
measurement harnesses that must not touch the embedding API at all (e.g. the
M11 corpus benchmarks), set `BB_EMBEDDING_BATCH_LIMIT=0` in the harness scope.

## The no-key trade-off, in plain terms

Without any embedding key, semantic search uses **local word vectors
(`local-word-vectors`, keyword-level matching)**. That is a real, declared
quality cost — not "the same, just offline". It is the honest default: nothing
is silently degraded, and the notice above says so. Adding a real model later
**requires `bb index --force <project>`** to re-embed the whole index; old
vectors are never reused or mixed with new ones.

## Vector-space mixing rule

Vectors produced by different models live in **different vector spaces** and
are **never compared or mixed**. Every stored vector records the model that
produced it (`embedding_model`); the search only compares vectors with the
same label, and the query vector's producing model
(`SemanticEngine.getLastEmbeddingModel()`) is authoritative. Changing model or
dimension therefore requires a forced reindex (`bb index --force`), and a rate
limit or provider blip degrades one batch to the local fallback — never a
silent cross-space comparison.

## Tool evidence semantics

`bb_ask` uses embeddings to discover and rank candidate symbols. Similarity is
not proof: factual claims should resolve to indexed symbols, source locations,
and relationships. `bb_doc` follows the same rule and classifies unsupported
claims as unknown rather than treating semantic proximity as evidence. `bb_health`
reports the active model, vector dimensions, and coverage; coverage describes
stored vectors, not answer quality. Changing model or dimensions requires a
forced reindex because vectors from different spaces are never compared.

## Verification

```bash
bun run script/verify-embed.ts                 # mock API + fallback
bun run script/m16/verify-embedding-lifecycle.ts # durable vectors + cleanup ordering
```
