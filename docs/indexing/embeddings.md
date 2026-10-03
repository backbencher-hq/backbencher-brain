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
| Dimensions | 50 (`WORD_DIM`, `src/brain/semantic/local-embed.ts:7`) |
| Dependencies | none — no downloads, no model files |
| Strength | weaker than a real embedding model; lexical similarity over project vocabulary |

The label is **versioned** and the `-v3` is load-bearing: a tokenizer change makes
old and new vectors occupy different spaces even though both are 50-dimensional,
so the label is what lets the model-consistency guard refuse to compare them
(`src/brain/semantic/engine.ts:38-49`). If you see `local-word-vectors` without a
suffix anywhere in the docs, that is a bug — the constant is
`local-word-vectors-v3`. (`describeEmbeddingChain` reports the *provider role* as
`local word vectors` with model `local-word-vectors`, `src/brain/semantic/openai-embed.ts:514`;
that is a provider description, not the stored label. Do not confuse the two.)

`bb setup show` says so plainly when nothing is configured:

```
Winner: none — semantic search will use local vectors (weaker). Setup: bb setup
```

and `bb doctor` reports it as a warning, not a failure (`src/setup/doctor.ts:191-198`;
the `!` glyph is the warn severity, `src/setup/doctor.ts:213`):

```
! Semantic search will use local-word-vectors-v3 (weaker).
  Fix: bb setup
```

**This is a supported configuration, not a broken one.** It is also what CI and
MCP hosts get by default, because they have no TTY to prompt on
(`src/setup/setup-wizard.ts:355-370`). If you never configure anything, indexing
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
(`src/setup/setup-wizard.ts:181-182`), and re-checks the mode afterwards
(`:191-192`).

`bb setup` requires an interactive terminal and exits with
`✗ bb setup requires an interactive terminal.` otherwise
(`src/cli/index.ts:783-786`). In a non-TTY, `bb index` never blocks: it prints a
one-line notice instead (`src/setup/setup-wizard.ts:363-368`).

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

Highest tier wins, per field, independently (`src/config/config.ts:17-24`,
`:35-53`, `:70-81`):

1. **Environment** — `BB_EMBEDDING_BASE_URL` / `BB_EMBEDDING_API_KEY` /
   `BB_EMBEDDING_MODEL`
2. **Config files** — explicit `BB_CONFIG_FILE` > `./bb.json` >
   `<data-dir>/config.json` (`~/.bb/config.json` by default)
3. **Built-in default** — `https://api.openai.com/v1` and
   `text-embedding-3-small`

Two things that surprise people:

- The built-in defaults are **not** treated as "configured". A tier only counts
  as configured when both a base URL and a model were set by env or file
  (`configured: baseURLSrc !== "default" && modelSrc !== "default"`,
  `src/config/config.ts:50`). Without that, an untouched install would look
  remotely configured and would fail every request. An API key alone is not
  enough either.
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
  (`src/setup/setup-show.ts:133-168`).
- An incomplete tier is shown with what's missing and can never win, even if it
  appears first: the winner is the first *complete* tier in env → global →
  project order (`src/setup/setup-show.ts:121-127`).
- A file mode other than `600` is flagged, because the file holds a key
  (`src/setup/setup-show.ts:153-158`).
- `bb setup show` exits non-zero if nothing is configured
  (`src/cli/index.ts:796`).

## What is required

| Field | Required? | Notes |
| --- | --- | --- |
| base URL | **Yes**, together with the model | Must be a `/v1`-style OpenAI-compatible base; the client posts to `<baseURL>/embeddings` (`src/brain/semantic/openai-embed.ts:207`). Trailing slashes are stripped (`src/config/config.ts:47`). A base URL that is not a usable http(s) endpoint makes `getEmbeddingConfig()` return null, so remote embeddings turn off with a debug log rather than failing every batch (`src/brain/semantic/openai-embed.ts:60-64`). |
| model | **Yes** | Its name becomes the stored `embedding_model` label. |
| API key | Not for the tier to be *configured*; yes for most hosted providers | The `Authorization: Bearer` header is only sent when a key is present (`src/brain/semantic/openai-embed.ts:239`). Self-hosted servers that do not authenticate can omit it. |
| dimension | No | `embedding_dimension` in the config file, when your provider returns a fixed width (`src/brain/semantic/openai-embed.ts:56`). |

Any OpenAI-compatible `/embeddings` endpoint works — OpenAI, Google, NVIDIA
NIM, or a self-hosted vLLM / llama.cpp server. Loopback endpoints get
`NO_PROXY`/`no_proxy` handling so a local server behind a proxy configuration is
not unreachable: the loopback hosts `127.0.0.1`, `localhost` and `::1` are
appended to the no-proxy set (`src/brain/semantic/openai-embed.ts:215-226`).

## Diagnose with `bb doctor`

```
bb doctor
```

Read-only by default. It checks configuration presence, tier completeness, file
permissions, model consistency against the vectors actually stored in the
project index, and semantic degradation (`src/setup/doctor.ts:104-202`):

| Finding | Severity | Glyph | Fix it prints |
| --- | --- | --- | --- |
| `no-config` | fail | `✗` | `bb setup` |
| `incomplete-{env,global,project}` | fail | `✗` | `bb setup` |
| `mode-{env,global,project}` | warn | `!` | `bb doctor --fix` |
| `model-mismatch` | fail | `✗` | `bb index --force` |
| `model-mixed` | warn | `!` | `bb index --force` |
| `no-index` | info | `·` | `bb index .` |
| `semantic-degraded` | warn | `!` | `bb setup` |

That is **seven** findings, not the "four things" an earlier draft of this page
claimed. `no-index` is informational, not a problem: it just means there are no
stored vectors to compare against yet. `bb doctor` exits 1 when a **fail**
finding exists (`src/setup/doctor.ts:200`, `src/cli/index.ts:815`).

`bb doctor --fix` applies exactly one repair: file permissions back to `0600`,
for at most 8 files per run (`MAX_FIX_ACTIONS`, `src/setup/doctor.ts:250`); a
file that changed between diagnosis and `chmod` becomes a printed refusal, never
a silent no-op (`:299-316`). It is read-only without the flag
(`src/cli/index.ts:804-816`).

## When you change the model, you must re-embed

Vectors from different models occupy different vector spaces and are **never**
compared with each other, even at the same dimension
(`docs/EMBEDDINGS.md` §2). Changing `BB_EMBEDDING_MODEL` therefore does not
re-embed anything; it makes every previously stored vector unusable for search.

The symptom is that `bb doctor` reports (`src/setup/doctor.ts:163-168`; the
message is one line in the source — the counts are illustrative, not measured):

```
✗ Model mismatch: config has <new-model>, index has <old-model> (412 rows). Vectors from different models cannot be compared — the stored vectors are unusable.
  Fix: bb index --force
```

Note the `✗` glyph and the trailing `Fix:` line: the message text itself does not
contain the fix. A doc that quotes a doctor finding without the `Fix:` line is
quoting half of what you will see.

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
| `BB_DATA_DIR` | `~/.bb` | Where `config.json`, `status/`, `projects/` and `logs/` live (`src/util/bb-data-dir.ts:11-13`). |
| `BB_EMBEDDING_DISABLED` | unset | Kill switch. `1`/`true`/`yes`/`on` forces local word vectors with **zero** HTTP requests (`src/brain/semantic/embedding-config.ts:91-95`). An unrecognised value counts as OFF, so a typo cannot silently disable a paid provider. |
| `BB_EMBEDDING_TIMEOUT_MS` | `30000` | Bounds a single provider HTTP call (clamped 1 000–600 000) — `src/brain/semantic/embedding-config.ts:103`. Distinct from `BB_EMBEDDING_CALL_TIMEOUT_MS`, which bounds the indexer's drainer. |
| `BB_EMBEDDING_MAX_INPUTS` | `256` | Ceiling on inputs per `/embeddings` request (clamped 1–2048) — `src/brain/semantic/embedding-config.ts:117`. The default is load-bearing: the indexer already chunks to 100 snippets per call, so 256 keeps every real indexing request a **single** request. |
| `BB_EMBEDDING_DIMENSION` | unset | Declares the vector width you expect the provider to return. `src/brain/semantic/openai-embed.ts:452` REFUSES to store vectors whose width disagrees with this, because mixing widths in one index is the same defect as mixing models: search compares only one. Leave it unset unless you know the provider's real output width; if you set it wrongly, reindex with `bb index --force`. |
| `BB_EMBEDDING_FALLBACK_BASE_URL` | unset | Second provider used when the primary fails. Must be set together with `BB_EMBEDDING_FALLBACK_MODEL` — the fallback object is built only when both are non-empty (`src/brain/semantic/embedding-config.ts:126`), and setting one without the other is reported as an error by `describeEmbeddingSetup` (`:263-270`). |
| `BB_EMBEDDING_FALLBACK_MODEL` | unset | The fallback provider's model. See above. |
| `BB_EMBEDDING_FALLBACK_API_KEY` | unset | The fallback provider's key. |
| `BB_EMBEDDING_FALLBACK_RETRIES` | `2` | Retries **for the fallback provider only** (clamped 0–5) — `src/brain/semantic/embedding-config.ts:123`. See the retry-ownership note below before assuming your primary provider retries. |
| `BB_EMBEDDING_RETRY_BASE_MS` | `250` | Exponential backoff base for those retries (clamped 10–10 000) — `:124`. |
| `BB_EMBEDDING_RETRY_CAP_MS` | `4000` | Cap on that backoff (clamped 100–60 000) — `:125`. |

### Who retries, precisely

This is worth stating because getting it wrong produces a confident, false
assurance about a provider outage:

| Provider | Retries? | Where |
| --- | --- | --- |
| **Primary** | **No client-side retry.** One attempt per call (`src/brain/semantic/openai-embed.ts:395` passes `maxAttempts = 1`). Its resilience is the *per-batch* path in `engine.ts` (`_apiRetryAt`): the failing batch degrades to local vectors, and **later batches** try the API again. On 429 specifically there is a bounded backoff honouring `Retry-After` (`src/brain/semantic/engine.ts:315-322`). | `src/brain/semantic/openai-embed.ts:361-379` states the ownership rule |
| **Fallback** | Yes, bounded exponential backoff, default 2 attempts. | `src/brain/semantic/openai-embed.ts:373-375`, `:441-483` |
| **401/403/404** | Never, on either. Latched per `(baseURL, model)` for the rest of the process — one 401 is enough to know retrying will not help (`src/brain/semantic/openai-embed.ts:391-392`, `:398-409`). | — |

So "indexing retries automatically" is true of a 429 and of later batches after
a transient 5xx. It is **not** true of the failed call itself, which is not
reissued — it degrades to local vectors, and the stored `embedding_model` for
those rows records the local label. That is why `bb index` prints the
`embeddings incomplete:` and multi-model warnings when it happens
(`src/cli/index.ts:318-340`), and why `bb doctor` reports `model-mixed`.

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