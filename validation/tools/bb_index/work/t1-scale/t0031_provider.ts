// Minimal provider registry for brain-core. Providers that expose an
// OpenAI-compatible embeddings endpoint are discovered from config:
//   { "providers": { "<id>": { "baseURL": "...", "apiKey": "...", "models": { "<id>": {} } } } }
// plus the BB_* environment overrides.
import { Config } from "../config/config"

export interface CoreProviderModel {
  id: string
}

export interface CoreProvider {
  id: string
  baseURL?: string
  apiKey?: string
  models: Record<string, CoreProviderModel>
}

export namespace Provider {
  export async function list(): Promise<Record<string, CoreProvider>> {
    const config = await Config.get()
    const providers = (config.providers ?? {}) as Record<string, any>
    const result: Record<string, CoreProvider> = {}
    for (const [id, p] of Object.entries(providers)) {
      result[id] = {
        id,
        baseURL: p?.baseURL ?? p?.baseUrl,
        apiKey: p?.apiKey ?? p?.api_key,
        models: (p?.models ?? {}) as Record<string, CoreProviderModel>,
      }
    }
    // env-driven single provider ("bb") when BB_EMBEDDING_BASE_URL is set
    if (process.env.BB_EMBEDDING_BASE_URL) {
      result["bb"] = {
        id: "bb",
        baseURL: process.env.BB_EMBEDDING_BASE_URL,
        apiKey: process.env.BB_EMBEDDING_API_KEY,
        models: { [process.env.BB_EMBEDDING_MODEL ?? "text-embedding-3-small"]: { id: process.env.BB_EMBEDDING_MODEL ?? "text-embedding-3-small" } },
      }
    }
    return result
  }
}
