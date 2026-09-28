// Direct OpenAI-compatible embeddings client for brain-core. Works with any
// provider exposing POST /embeddings: Google (generativelanguage OpenAI
// compatibility), NVIDIA NIM (api.nvidia.com/v1), OpenAI, and self-hosted
// vLLM/llama.cpp servers. No provider SDK required.
//
// M40.A8: precedence (env BB_EMBEDDING_* > config file > built-in default) is
// defined ONCE in src/config/config.ts resolveEmbeddingConfig(). This module
// consumes it — it must not re-implement or re-document a different order.
import { Config, resolveEmbeddingConfig } from "../../config/config"

export interface EmbeddingConfig {
  baseURL: string
  apiKey: string
  model: string
  dimension?: number
}

export function isEmbeddingConfigured(config: Record<string, unknown>): boolean {
  // M40.A8: single source of truth — no local env-probing.
  return resolveEmbeddingConfig(config).configured
}

export async function getEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const config = await Config.get()
  const eff = resolveEmbeddingConfig(config)
  if (!eff.configured) return null
  return {
    baseURL: eff.baseURL,
    apiKey: eff.apiKey,
    model: eff.model,
    dimension: typeof config.embedding_dimension === "number" ? config.embedding_dimension : undefined,
  }
}

// Typed API error: carries the HTTP status and (for 429) the Retry-After
// seconds so callers can apply backoff instead of a blanket fallback latch.
export class EmbeddingApiError extends Error {
  status: number
  retryAfterSec?: number
  constructor(status: number, message: string, retryAfterSec?: number) {
    super(message)
    this.name = "EmbeddingApiError"
    this.status = status
    this.retryAfterSec = retryAfterSec
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
    // Retry-After may be delta-seconds or an HTTP-date; only delta-seconds
    // are actionable here (dates require clock math we do not do).
    let retryAfterSec: number | undefined
    if (status === 429) {
      const raw = res.headers.get("retry-after")
      const secs = raw ? Number(raw) : NaN
      if (Number.isFinite(secs) && secs > 0) retryAfterSec = secs
    }
    throw new EmbeddingApiError(status, `embedding API ${status}: ${body.slice(0, 200)}`, retryAfterSec)
  }
  const data = JSON.parse(body) as { data: Array<{ embedding: number[] }> }
  const embeddings = data.data.map((d) => d.embedding)
  if (embeddings.length !== texts.length) {
    throw new Error(`embedding API returned ${embeddings.length} vectors for ${texts.length} inputs`)
  }
  return embeddings
}
