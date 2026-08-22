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
  // Explicit BB_* values are runtime overrides and must win over repository
  // config. This is required for MCP hosts, local test endpoints, and workers
  // that intentionally point at a different OpenAI-compatible service.
  const baseURL = process.env.BB_EMBEDDING_BASE_URL || (config.embedding_base_url as string)
  const apiKey = process.env.BB_EMBEDDING_API_KEY || (config.embedding_api_key as string)
  const model = process.env.BB_EMBEDDING_MODEL || (config.embedding_model as string)
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
  const payload = JSON.stringify({
    model: cfg.model,
    input: texts.length === 1 ? texts[0] : texts,
    encoding_format: "float",
  })
  const parsedUrl = new URL(url)
  const isLocal = parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1" || parsedUrl.hostname === "[::1]" ||
    parsedUrl.hostname === "::1"

  if (isLocal) {
    // Do not send loopback traffic through HTTP_PROXY/ALL_PROXY. Some hosts
    // reject proxy connections to local IPs, which makes the built-in mock and
    // self-hosted embedding endpoints appear unavailable. Keep existing values
    // and append only the loopback hosts used by local embedding servers.
    const loopbackHosts = ["127.0.0.1", "localhost", "::1"]
    for (const key of ["NO_PROXY", "no_proxy"] as const) {
      const existing = process.env[key] ?? ""
      const values = new Set(existing.split(",").map((v) => v.trim()).filter(Boolean))
      for (const host of loopbackHosts) values.add(host)
      process.env[key] = [...values].join(",")
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: payload,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  const status = res.status
  const body = await res.text()

  if (status < 200 || status >= 300) {
    throw new Error(`embedding API ${status}: ${body.slice(0, 200)}`)
  }
  const data = JSON.parse(body) as { data: Array<{ embedding: number[] }> }
  const embeddings = data.data.map((d) => d.embedding)
  if (embeddings.length !== texts.length) {
    throw new Error(`embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`)
  }
  return embeddings
}
