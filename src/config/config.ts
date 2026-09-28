// Core config for brain-core. Reads <data-dir>/config.json (default ~/.bb),
// then bb.json in the working directory, then environment variables. No
// opencode dependency.
import path from "path"
import { existsSync, readFileSync } from "fs"
import { bbDataDir } from "../util/bb-data-dir"

let cached: Record<string, unknown> | null = null

function readJson(p: string): Record<string, unknown> | null {
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"))
  } catch {}
  return null
}

// ── M40.A8: THE single source of truth for embedding config precedence ─────
// Precedence, highest tier first (per field, independently):
//   1. Environment:  BB_EMBEDDING_BASE_URL / BB_EMBEDDING_API_KEY / BB_EMBEDDING_MODEL
//   2. Config files: explicit BB_CONFIG_FILE > ./bb.json > <data-dir>/config.json
//      (already merged by Config.get() before this function runs)
//   3. Built-in default: api.openai.com/v1 + text-embedding-3-small
// Documented user-facing in `bb health --verbose`, `bb health --help`, and
// docs/m40/PLAN.md. Engine/openai-embed must consume THIS, not re-implement.
export interface EffectiveEmbeddingConfig {
  baseURL: string
  model: string
  apiKey: string
  /** False when neither model nor baseURL was set by env or file — callers should use the local/tfidf fallback. */
  configured: boolean
  /** Where each field came from: "env:<VAR>" | "file:<key>" | "default". */
  sources: { baseURL: string; model: string; apiKey: string }
}

export function resolveEmbeddingConfig(fileConfig: Record<string, unknown>): EffectiveEmbeddingConfig {
  const pick = (envVar: string, fileKey: string, fallback: string): [string, string] => {
    const env = process.env[envVar]
    if (env) return [env, `env:${envVar}`]
    const file = fileConfig[fileKey]
    if (typeof file === "string" && file) return [file, `file:${fileKey}`]
    return [fallback, "default"]
  }
  const [baseURL, baseURLSrc] = pick("BB_EMBEDDING_BASE_URL", "embedding_base_url", "https://api.openai.com/v1")
  const [model, modelSrc] = pick("BB_EMBEDDING_MODEL", "embedding_model", "text-embedding-3-small")
  const [apiKey, apiKeySrc] = pick("BB_EMBEDDING_API_KEY", "embedding_api_key", "")
  return {
    baseURL: baseURL.replace(/\/+$/, ""),
    model,
    apiKey,
    configured: baseURLSrc !== "default" && modelSrc !== "default",
    sources: { baseURL: baseURLSrc, model: modelSrc, apiKey: apiKeySrc },
  }
}

function withEnvironmentOverrides(config: Record<string, unknown>): Record<string, unknown> {
  // M40.A8: precedence lives in resolveEmbeddingConfig() alone. Inject the
  // resolved values only when explicitly configured (env or file) — injecting
  // defaults here would make unconfigured installs look remote-configured.
  const eff = resolveEmbeddingConfig(config)
  const merged = { ...config }
  if (eff.configured) {
    merged.embedding_base_url = eff.baseURL
    merged.embedding_model = eff.model
    merged.embedding_api_key = eff.apiKey
  }
  if (process.env.BB_PROVIDER) merged.provider = process.env.BB_PROVIDER
  return merged
}

export namespace Config {
  export async function get(): Promise<Record<string, unknown>> {
    if (cached) return withEnvironmentOverrides(cached)
    const home = readJson(path.join(bbDataDir(), "config.json"))
    const local = readJson(path.join(process.cwd(), "bb.json"))
    // Explicit config file (BB_CONFIG_FILE) wins — lets an MCP host point at a
    // workspace bb.json regardless of the process cwd.
    const explicit = process.env.BB_CONFIG_FILE ? readJson(path.resolve(process.env.BB_CONFIG_FILE)) : null
    const merged: Record<string, unknown> = { ...(home ?? {}), ...(local ?? {}), ...(explicit ?? {}) }
    cached = merged
    return withEnvironmentOverrides(merged)
  }

  export function clearCache(): void {
    cached = null
  }
}
