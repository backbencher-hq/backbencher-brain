// @ts-nocheck — pre-existing Effect/Provider API migration issues
import * as Log from "../../tool/brain-log"
import { createHash } from "crypto"
import * as fs from "fs"
import * as path from "path"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { initLocalModel, embedLocal } from "./local-embed"
import { isEmbeddingConfigured, getEmbeddingConfig, embedOpenAICompatible } from "./openai-embed"


const log = Log.create({ service: "brain-semantic-engine" })

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
  let _lastModel: string | null = null
  export const LOCAL_MODEL_LABEL = "local-word-vectors"

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
      return bbJson
    }
    // Fall back to global Config
    try {
      return (await Config.get()) as Record<string, unknown>
    } catch (_) {
      return bbJson
    }
  }

  export async function embed(text: string): Promise<number[]> {
    if (_checked && !_embeddingAvailable) return []
    // Layer 1: OpenAI-compatible embedding API (Google / NVIDIA NIM / any)
    const config = await loadConfig()
    if (isEmbeddingConfigured(config)) {
      try {
        const cfg = await getEmbeddingConfig()
        if (cfg) {
          const res = await embedOpenAICompatible([text], cfg)
          if (res.length > 0) {
            _embeddingAvailable = true
            _checked = true
            _lastModel = cfg.model
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
        const localResult = await embedLocal([text])
        if (localResult.length > 0 && localResult[0].length > 0) {
          _embeddingAvailable = true; _checked = true
          _lastModel = LOCAL_MODEL_LABEL
          return localResult[0]
        }
      }
    } catch {}
    return []
  }

  let _apiFailed = false  // Module-level: skip API after first failure per process

  export async function embedMany(texts: string[]): Promise<number[][]> {
    if (_checked && !_embeddingAvailable) return []
    if (!texts || texts.length === 0) return []

    // Layer 1: OpenAI-compatible embedding API (Google / NVIDIA NIM / any).
    // Direct fetch-based client — no provider SDK required.
    const config = await loadConfig()
    if (!_apiFailed && isEmbeddingConfigured(config)) {
      try {
        const cfg = await getEmbeddingConfig()
        if (cfg) {
          const embeddings = await embedOpenAICompatible(texts, cfg)
          if (embeddings.length > 0) {
            _embeddingAvailable = true
            _checked = true
            _lastModel = cfg.model
            return embeddings
          }
        }
      } catch (e: any) {
        _apiFailed = true
        log.debug("API embedding failed, falling back to word vectors", { error: e?.message?.slice(0, 60) })
      }
    }

    // Layer 2: Word vectors (always available, offline)
    try {
      if (_localAvailable === null) _localAvailable = await initLocalModel()
      if (_localAvailable) {
        const localResult = await embedLocal(texts)
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
