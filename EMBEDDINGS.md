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
saved; A 401/403/404 or malformed response is a hard error: the key is NOT saved.

**What a saved key actually gets at index time.** The wording above is
`bb setup`'s pre-save validation, and one of those messages is optimistic about
what follows: indexing does not re-run key validation, so a 503 seen here is not
proof that indexing will retry the same way. Concretely, at index time:

- A **429** degrades only that batch, per-batch, to local word vectors, and
  further batches are held off by a bounded `Retry-After` window in the engine
  (never a process-wide latch, so the run recovers by itself).
- A **5xx, timeout, or unreachable provider** degrades that batch to local word
  vectors. The next batch tries again — there is no wait, so a provider that is
  down for a whole run costs one degraded batch per batch, not one at the end.
- A **401 or 404** stops being retried for the rest of the process: further
  embedding requests fail immediately with the same classified error, and `bb
  doctor` reports the status and what to change. Re-running the command after
  fixing the key picks it up again.
- **No batch is silently lost**: a batch that cannot be embedded by any provider
  falls back to sparse `tfidf-v1` rows, and the run reports how many were
  embedded, fell back, or failed.

If you want a second provider tried when the first one fails, configure
`BB_EMBEDDING_FALLBACK_*` (below) — that provider is the one with a client-side
retry loop, bounded by `BB_EMBEDDING_FALLBACK_RETRIES`.

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

## Environment variables

The three above decide **which** provider is used, and their precedence is
`env BB_EMBEDDING_*` > config file (`BB_CONFIG_FILE` > `bb.json` > `config.json`)
> built-in default. Everything below tunes how that provider is called. None of
them has a config-file equivalent: they are operational knobs, read from the
environment only.

| Variable | Default | What it does |
|---|---|---|
| `BB_EMBEDDING_DISABLED` | unset | `1`/`true`/`yes`/`on` turns remote embeddings off entirely. Indexing stores local word vectors and makes no embedding request. An unrecognised value is treated as OFF, so a typo cannot silently drop a provider you pay for. |
| `BB_EMBEDDING_FALLBACK_BASE_URL` | unset | A second provider to try when the primary fails. Requires `BB_EMBEDDING_FALLBACK_MODEL`. |
| `BB_EMBEDDING_FALLBACK_MODEL` | unset | Model for the fallback provider. |
| `BB_EMBEDDING_FALLBACK_API_KEY` | unset | Key for the fallback provider. A loopback fallback needs none. |
| `BB_EMBEDDING_FALLBACK_RETRIES` | `2` | Retries for the FALLBACK provider only, exponential backoff with jitter. `0` means one attempt, no retry loop. |
| `BB_EMBEDDING_TIMEOUT_MS` | `30000` | Bound on one embedding request, covering headers **and** body. Floored at 1000ms, so a typo cannot instant-fail every request. |
| `BB_EMBEDDING_MAX_INPUTS` | `256` | Ceiling on inputs per `/embeddings` request. A ceiling, not a partition: the indexer already batches 100 snippets, so ordinary indexing stays one request. |
| `BB_EMBEDDING_RETRY_BASE_MS` | `250` | First backoff step; doubles per attempt. Fallback provider only. |
| `BB_EMBEDDING_RETRY_CAP_MS` | `4000` | Ceiling on one backoff wait. Fallback provider only. |
| `BB_EMBEDDING_CACHE_MAX` | `128` | How many recent query vectors are cached in memory (LRU). Cached only when they came back non-empty; a config change keys the cache so a different model or endpoint can never serve a vector from another vector space. |
| `BB_EMBEDDING_CALL_TIMEOUT_MS` | `60000` | Bound on one whole `embedMany` call inside the background drainer, above the client's own per-request bound. Exceeding it counts as a provider failure for that batch, which is what routes it to the local fallback instead of wedging the queue. |
| `BB_EMBEDDING_DIMENSION` | unset | Assertion, not a request parameter: the vector width you expect from the configured model. A response of a different width is refused rather than written, because vectors of two widths cannot share one `embedding_model` label. Unset it if the real width differs. |

Two of these deserve the emphasis, because the defaults are not the only
sensible choice for everyone:

- **`BB_EMBEDDING_DISABLED`** is the switch to reach for when you would rather
  pay the local quality cost than any network call — an air-gapped machine, a CI
  runner with no provider key, or a debugging session where you want indexing to
  stop waiting on someone else's uptime.
- **`BB_EMBEDDING_MAX_INPUTS`** exists because a failure in any chunk of a
  multi-chunk request discards the whole request, so needless fragmentation turns
  an unrelated later failure into a loss of earlier completed work.

## The fallback chain, in order

1. `BB_EMBEDDING_DISABLED` on → local word vectors only, no HTTP.
2. The primary provider (env / config file / default, by the precedence above).
3. The fallback provider, if `BB_EMBEDDING_FALLBACK_*` is configured. Reached
   only when the primary fails, and the only layer with a client-side retry loop.
4. Local word vectors (`local-word-vectors-v3`, 50-dimensional) — always
   available, offline, and the reason the chain has no dead end.

The chain has no dead end by design: no configuration makes indexing fail to
produce vectors. What a misconfiguration costs is quality (layer 4 instead of
layer 2), which is why the diagnosis below is worth reading.

## When something is wrong: `bb doctor` and `bb setup show`

Both print the chain in the order above with the env var each layer came from,
so "which provider am I on and what do I change to move off it" is answerable
without reading a config file. `bb health --verbose` prints the same chain, from
the same code, so the three surfaces cannot disagree.

```
$ bb doctor
bb doctor — diagnostics

! Embeddings are switched off (BB_EMBEDDING_DISABLED), so indexing stores only local word vectors.
  Fix: unset BB_EMBEDDING_DISABLED
✗ env tier is incomplete: missing model.
  Fix: bb setup
embedding provider chain (embeddings disabled — local only):
   1. embeddings disabled: none · none  [env:BB_EMBEDDING_DISABLED]
  →2. local word vectors: offline · 50-dim  [built in]
```

What each surface adds:

- **`bb doctor`** — the findings, each naming the exact command or env var that
  resolves it, and the exit code (1 when a FAIL-level finding exists, so CI can
  branch). It also reports failures the provider has already given this process:
  a 401 and a 404 are FAILs because neither is fixed by waiting, while a 429 or a
  5xx is a WARN because indexing degrades that batch and carries on.
- **`bb setup show`** — the tier table (base URL, model, and the key as its last
  four characters) plus the chain and any problem found in it.
- **`bb health --verbose`** — the chain, and `embeddingChain` in the JSON for a
  machine consumer.

Diagnosis is read-only and makes no network call, so it is safe in CI and on a
machine that cannot reach the provider. The one exception is a live probe,
available as `runDoctorChecksWithProbe` in `src/setup/doctor.ts`: it makes a
single bounded request through the same client indexing uses, and it does not
affect what indexing does next. `bb health` never probes.

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
(`local-word-vectors-v3`, keyword-level matching)**. That label is what appears
in the `embedding_model` column of `brain_semantic_embedding`, so it is the
string to query when you want the offline vectors:

```sql
SELECT embedding_model, vector_dimension, COUNT(*)
FROM brain_semantic_embedding
WHERE embedding_model = 'local-word-vectors-v3'
GROUP BY 1, 2;
```

(The `-v3` suffix is load-bearing, not decoration: earlier versions of this
model tokenized and combined words differently, so those vectors occupy a
different space and are never compared with current ones. Bumping the version is
how a model change is prevented from producing a confident nonsense score; an
index built by an older version reports `no-matching-model-embeddings` until it
is re-embedded with `bb index --force`.) That is a real, declared
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
