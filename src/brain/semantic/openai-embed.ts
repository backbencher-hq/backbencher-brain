// Direct OpenAI-compatible embeddings client for brain-core. Works with any
// provider exposing POST /embeddings: Google (generativelanguage OpenAI
// compatibility), NVIDIA NIM (api.nvidia.com/v1), OpenAI, and self-hosted
// vLLM/llama.cpp servers. No provider SDK required.
//
// Config (highest priority first):
//   env  BB_EMBEDDING_BASE_URL, BB_EMBEDDING_API_KEY, BB_EMBEDDING_MODEL
//   file ~/.bb/config.json  { "embedding_base_url", "embedding_api_key", "embedding_model" }
import { Config } from "../../config/config"

export interface EmbeddingConfig {
  baseURL: string
  apiKey: string
  model: string
  dimension?: number
}

export function isEmbeddingConfigured(config: Record<string, unknown>): boolean {
  return Boolean(
    (config.embedding_base_url || process.env.BB_EMBEDDING_BASE_URL) &&
      (config.embedding_model || process.env.BB_EMBEDDING_MODEL),
  )
}

export async function getEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const config = await Config.get()
  const baseURL = (config.embedding_base_url as string) || process.env.BB_EMBEDDING_BASE_URL
  const apiKey = (config.embedding_api_key as string) || process.env.BB_EMBEDDING_API_KEY
  const model = (config.embedding_model as string) || process.env.BB_EMBEDDING_MODEL
  if (!baseURL || !model) return null
  return {
    baseURL: baseURL.replace(/\/+$/, ""),
    apiKey: apiKey ?? "",
    model,
    dimension: typeof config.embedding_dimension === "number" ? config.embedding_dimension : undefined,
  }
}

export async function embedOpenAICompatible(
  texts: string[],
  cfg: EmbeddingConfig,
): Promise<number[][]> {
  const url = `${cfg.baseURL}/embeddings`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        input: texts.length === 1 ? texts[0] : texts,
        encoding_format: "float",
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`embedding API ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>
    }
    const embeddings = data.data.map((d) => d.embedding)
    if (embeddings.length !== texts.length) {
      throw new Error(`embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`)
    }
    return embeddings
  } finally {
    clearTimeout(timer)
  }
}
