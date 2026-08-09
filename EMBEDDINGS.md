# Semantic Embeddings — Setup Guide

brain-core ships two embedding layers:

1. **API embeddings** (best quality) — any OpenAI-compatible `/embeddings`
   endpoint: Google Gemini, NVIDIA NIM, OpenAI, or a self-hosted vLLM /
   llama.cpp server. Off by default — one config file or 3 env vars turns it on.
2. **Local word vectors** (offline fallback) — always available, no API key.
   Quality is keyword-level, not true semantics.

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
bun run script/verify-embed.ts    # mock API + fallback, both runtimes
```
