// @ts-nocheck — pre-existing Effect/Provider API migration issues
import * as Log from "../../tool/brain-log"
import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { initLocalModel, embedLocal, projectVocabulary } from "./local-embed"
import { isEmbeddingConfigured, getEmbeddingConfig, embedOpenAICompatible } from "./openai-embed"


const log = Log.create({ service: "brain-semantic-engine" })
import { resolveEmbeddingConfig } from "../../config/config"

function loadConfigWorkerFallback(): Record<string, unknown> {
  try {
    const bbJsonPath = process.env.BB_CONFIG_FILE
      ? path.resolve(process.env.BB_CONFIG_FILE)
      : path.join(process.cwd(), "bb.json")
    if (fs.existsSync(bbJsonPath)) {
      return JSON.parse(fs.readFileSync(bbJsonPath, "utf8"))
    }
  } catch (_) {}
  return {}
}

export namespace SemanticEngine {
  // Cache embedding availability so we only check once per process
  let _embeddingAvailable: boolean | null = null
  let _checked = false
  let _localAvailable: boolean | null = null
  // Canonical label for offline word-vector embeddings. Distinct from any API
  // model name so the vector search never compares across vector spaces.
  //
  // The version suffix is load-bearing, not decoration:
  //   v2  tokenizes identifiers (camelCase, snake_case, scope) where v1
  //       tokenized on whitespace alone;
  //   v3  derives each word's vector from the word itself, so a project
  //       vocabulary is a pure coverage increase and both sides of a
  //       comparison can use different vocabularies.
  // A v1/v2 vector and a v3 vector are points in different spaces even though
  // all are 50-dimensional. Bumping the label lets the model-consistency guard
  // refuse to compare them, which reports an honest
  // `no-matching-model-embeddings` until a project is re-embedded. Reusing an
  // old label would have produced confident garbage: real-looking cosines
  // between two unrelated vector constructions, for every existing index, with
  // no way to tell.
  let _lastModel: string | null = null
  export const LOCAL_MODEL_LABEL = "local-word-vectors-v3"

  /** Model name that produced the most recent embedding (API model or local). */
  export function getLastEmbeddingModel(): string {
    return _lastModel || LOCAL_MODEL_LABEL
  }

  export async function isEmbeddingAvailable(): Promise<boolean> {
    if (_checked) return _embeddingAvailable === true
    _checked = true
    // Check word vectors first (embedded in binary, always works)
    if (_localAvailable === null) {
      try { _localAvailable = await initLocalModel() } catch { _localAvailable = false }
    }
    if (_localAvailable) { _embeddingAvailable = true; return true }
    // Fall back to API-based embeddings (OpenAI-compatible config)
    try {
      const config = await loadConfig()
      if (!isEmbeddingConfigured(config)) { _embeddingAvailable = false; return false }
      _embeddingAvailable = true
      return true
    } catch {
      _embeddingAvailable = false
      return false
    }
  }

  export async function getEmbeddingModel(configModel?: string): Promise<string> {
    if (configModel) return configModel

    // If an OpenAI-compatible API is configured, its raw model name is the
    // canonical label — it must match what embed()/embedMany() record.
    try {
      const cfg = await getEmbeddingConfig()
      if (cfg) return cfg.model
    } catch {}

    try {
      const providers = await Provider.list()
      const providerMap: Record<string, { id?: string; models?: Record<string, { id: string }> }> = providers as any

      if (providerMap["openai"]?.models?.["text-embedding-3-small"]) return "openai/text-embedding-3-small"
      if (providerMap["azure"]?.models?.["text-embedding-3-small"]) return "azure/text-embedding-3-small"
      if (providerMap["mistral"]?.models?.["mistral-embed"]) return "mistral/mistral-embed"
      if (providerMap["google"]?.models?.["text-embedding-004"]) return "google/text-embedding-004"
      if (providerMap["google-vertex"]?.models?.["text-embedding-004"]) return "google-vertex/text-embedding-004"
      if (providerMap["cohere"]?.models?.["embed-english-v3.0"]) return "cohere/embed-english-v3.0"
      if (providerMap["nvidia"]?.models?.["nvidia/nv-embedqa-e5-v5"]) return "nvidia/nvidia/nv-embedqa-e5-v5"
      if (providerMap["cloudflare-workers-ai"]?.models?.["@cf/baai/bge-small-en-v1.5"])
        return "cloudflare-workers-ai/@cf/baai/bge-small-en-v1.5"

      if (providerMap["opencode"]?.models?.["text-embedding-3-small"]) return "opencode/text-embedding-3-small"

      for (const p of Object.values(providerMap)) {
        for (const m of Object.values(p.models || {})) {
          if (m.id.toLowerCase().includes("embed")) return `${p.id}/${m.id}`
        }
      }
    } catch (e) {
      log.debug("Failed to list providers for embedding model", { error: e })
    }

    log.debug("No embedding model configured — defaulting to opencode/text-embedding-3-small")
    return "opencode/text-embedding-3-small"
  }

  async function loadConfig(): Promise<Record<string, unknown>> {
    // Check for config injected by brain.ts (bypasses Config system for compiled binary)
    if ((SemanticEngine as any).__config) {
      return (SemanticEngine as any).__config
    }
    // Try bb.json first (project-level config)
    const bbJson = loadConfigWorkerFallback()
    if (bbJson && (bbJson.embedding_model || bbJson.provider)) {
      // M40.A8: precedence (env BB_EMBEDDING_* > config file > default) lives
      // in ONE function — src/config/config.ts resolveEmbeddingConfig(). The
      // old hand-rolled merge here duplicated it and could drift.
      const eff = resolveEmbeddingConfig(bbJson)
      const merged = { ...bbJson }
      if (eff.configured) {
        merged.embedding_base_url = eff.baseURL
        merged.embedding_model = eff.model
        merged.embedding_api_key = eff.apiKey
      }
      return merged
    }
    // Fall back to global Config
    try {
      return (await Config.get()) as Record<string, unknown>
    } catch (_) {
      return bbJson
    }
  }

  // ══ M50.A2 (#764): bounded query-embedding cache ════════════════════════════
  // A1 convicted bb_ask at 4.8s: the provider round-trip for the QUERY text was
  // the dominant irreducible cost inside the call (measured 0.65-1.27s of the
  // 1.1s that remained after the vector-blob fix). Agents re-ask identical
  // questions constantly — retries, warm-ups, follow-ups, "what changed?" — so
  // the same text is embedded over and over.
  //
  // Rules (a cache must never be able to change an answer):
  //  - key includes the effective model AND the endpoint, so a config change
  //    can never serve a vector from a different embedding space;
  //  - only successful, non-empty dense vectors are stored — a failure is
  //    never cached as a failure, nor as an empty vector;
  //  - entries are copied in and copied out, so no caller can mutate the cache;
  //  - LRU-bounded (default 128 texts) — memory stays a few MB at 2048 dims.
  const EMBED_CACHE_MAX = Number(process.env.BB_EMBEDDING_CACHE_MAX || 128)
  const _embedCache = new Map<string, number[]>()
  let _embedCacheHits = 0
  let _embedCacheMisses = 0

  function embedCacheKey(space: string, text: string): string {
    return `${space}\u0000${createHash("sha1").update(text).digest("hex")}`
  }

  function embedCacheGet(key: string): number[] | null {
    const hit = _embedCache.get(key)
    if (!hit) {
      _embedCacheMisses++
      return null
    }
    _embedCacheHits++
    // LRU touch: re-insert so the oldest key is genuinely the least recent.
    _embedCache.delete(key)
    _embedCache.set(key, hit)
    return hit.slice()
  }

  function embedCachePut(key: string, vec: number[]): void {
    if (!Array.isArray(vec) || vec.length === 0) return
    if (!Number.isFinite(EMBED_CACHE_MAX) || EMBED_CACHE_MAX <= 0) return
    if (_embedCache.has(key)) _embedCache.delete(key)
    _embedCache.set(key, vec.slice())
    while (_embedCache.size > EMBED_CACHE_MAX) {
      const oldest = _embedCache.keys().next().value
      if (oldest === undefined) break
      _embedCache.delete(oldest)
    }
  }

  /** Observability for probes/gates: cache size and hit/miss counters. */
  export function embeddingCacheStats(): { size: number; max: number; hits: number; misses: number } {
    return { size: _embedCache.size, max: EMBED_CACHE_MAX, hits: _embedCacheHits, misses: _embedCacheMisses }
  }

  /** Test seam: drop cached query vectors (e.g. between gate phases). */
  export function clearEmbeddingCache(): void {
    _embedCache.clear()
    _embedCacheHits = 0
    _embedCacheMisses = 0
  }

  export async function embed(text: string, projectId?: string): Promise<number[]> {
    if (_checked && !_embeddingAvailable) return []
    // Layer 1: OpenAI-compatible embedding API (Google / NVIDIA NIM / any)
    const config = await loadConfig()
    if (isEmbeddingConfigured(config)) {
      try {
        const cfg = await getEmbeddingConfig()
        if (cfg) {
          const key = embedCacheKey(`${cfg.model}|${cfg.baseURL}`, text)
          const cached = embedCacheGet(key)
          if (cached) {
            _embeddingAvailable = true
            _checked = true
            _lastModel = cfg.model
            return cached
          }
          const res = await embedOpenAICompatible([text], cfg)
          if (res.length > 0) {
            _embeddingAvailable = true
            _checked = true
            _lastModel = cfg.model
            embedCachePut(key, res[0])
            return res[0]
          }
        }
      } catch (e: any) {
        log.debug("API embedding failed", { error: e?.message?.slice(0, 80) })
      }
    }
    // Layer 2: local word vectors (always available, offline)
    try {
      if (_localAvailable === null) _localAvailable = await initLocalModel()
      if (_localAvailable) {
        // The cache key carries the project, because the LOCAL vector space
        // depends on the project's vocabulary: one key shared across projects
        // would hand project B a vector computed against project A's words.
        const key = embedCacheKey(projectId ? `${LOCAL_MODEL_LABEL}|${projectId}` : LOCAL_MODEL_LABEL, text)
        const cachedLocal = embedCacheGet(key)
        if (cachedLocal) {
          _embeddingAvailable = true; _checked = true
          _lastModel = LOCAL_MODEL_LABEL
          return cachedLocal
        }
        const localResult = await embedLocal([text], await localVocabulary(projectId))
        if (localResult.length > 0 && localResult[0].length > 0) {
          _embeddingAvailable = true; _checked = true
          _lastModel = LOCAL_MODEL_LABEL
          embedCachePut(key, localResult[0])
          return localResult[0]
        }
      }
    } catch {}
    return []
  }

  /**
   * The project's own vocabulary, or null when there is no project or its
   * index cannot be read.
   *
   * This is what makes an identifier representable at all. The base vocabulary
   * is 190 common programming words, so `CpuCounter` -> `cpu`, `counter` is all
   * zeros and the dense path never runs for it — measured at 8 of 14 real
   * symbol names on rake before this and 0 of 14 after. The project vocabulary
   * is a SUPERSET of the base one and word vectors are position-independent,
   * so adding it cannot change a vector the base vocabulary already produced;
   * the index side gets the same treatment, so both sides agree on the space.
   */
  async function localVocabulary(projectId?: string): Promise<Record<string, number> | null> {
    if (!projectId) return null
    try {
      const { BrainDatabase } = await import("../../brain/database")
      const raw = await BrainDatabase.getRawInstance(projectId as any)
      return projectVocabulary(raw, String(projectId))
    } catch {
      return null
    }
  }

  // Q1 rate-limit resilience: NO process-wide latch. A failed API batch
  // falls back to word vectors for THAT batch only; later batches retry the
  // API. On 429 we back off until the Retry-After window (bounded, with
  // jitter) instead of permanently degrading the run.
  let _apiRetryAt = 0 // epoch ms; API attempts are skipped until this time
  export const API_BACKOFF_CAP_MS = 30_000 // declared cap for Retry-After
  export const API_BACKOFF_JITTER_MS = 500 // bounded jitter

  function backoffMs(retryAfterSec?: number): number {
    const base = retryAfterSec && retryAfterSec > 0 ? retryAfterSec * 1000 : 5_000
    const capped = Math.min(base, API_BACKOFF_CAP_MS)
    return capped + Math.floor(Math.random() * API_BACKOFF_JITTER_MS)
  }

  export async function embedMany(texts: string[], projectId?: string): Promise<number[][]> {
    if (_checked && !_embeddingAvailable) return []
    if (!texts || texts.length === 0) return []

    // Layer 1: OpenAI-compatible embedding API (Google / NVIDIA NIM / any).
    // Direct fetch-based client — no provider SDK required.
    const config = await loadConfig()
    if (Date.now() >= _apiRetryAt && isEmbeddingConfigured(config)) {
      try {
        const cfg = await getEmbeddingConfig()
        if (cfg) {
          const embeddings = await embedOpenAICompatible(texts, cfg)
          if (embeddings.length > 0) {
            _apiRetryAt = 0
            _embeddingAvailable = true
            _checked = true
            _lastModel = cfg.model
            return embeddings
          }
        }
      } catch (e: any) {
        // Per-batch fallback: this batch degrades, the run does not.
        if (e?.name === "EmbeddingApiError" && e?.status === 429) {
          _apiRetryAt = Date.now() + backoffMs(e?.retryAfterSec)
          log.debug("API 429 — backing off before next attempt", { retryAfterSec: e?.retryAfterSec })
        } else {
          log.debug("API embedding failed for this batch; next batch retries", { error: e?.message?.slice(0, 60) })
        }
      }
    }

    // Layer 2: Word vectors (always available, offline)
    try {
      if (_localAvailable === null) _localAvailable = await initLocalModel()
      if (_localAvailable) {
        // Built ONCE for the batch, not per document: the vocabulary is a
        // per-project constant, so re-deriving it per text would dominate the
        // cost of embedding a whole file.
        const vocabulary = await localVocabulary(projectId)
        const localResult = await embedLocal(texts, vocabulary)
        if (localResult.length > 0) {
          _embeddingAvailable = true; _checked = true
          _lastModel = LOCAL_MODEL_LABEL
          return localResult
        }
      }
    } catch (e: any) {
      log.debug("local embedding failed", { error: e?.message })
    }

    return []
  }


  /**
   * Google AI Studio embedding via REST API.
   * Google's embedding endpoint is NOT OpenAI-compatible — uses its own REST format.
   */

  export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0
    let dotProduct = 0,
      normA = 0,
      normB = 0
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i]
      normA += vecA[i] * vecA[i]
      normB += vecB[i] * vecB[i]
    }
    if (normA === 0 || normB === 0) return 0
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  export function hashContent(text: string): string {
    return createHash("md5").update(text).digest("hex")
  }
}
