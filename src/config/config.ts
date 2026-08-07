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

export namespace Config {
  export async function get(): Promise<Record<string, unknown>> {
    if (cached) return cached
    const home = readJson(path.join(bbDataDir(), "config.json"))
    const local = readJson(path.join(process.cwd(), "bb.json"))
    // Explicit config file (BB_CONFIG_FILE) wins — lets an MCP host point at a
    // workspace bb.json regardless of the process cwd.
    const explicit = process.env.BB_CONFIG_FILE ? readJson(path.resolve(process.env.BB_CONFIG_FILE)) : null
    const merged: Record<string, unknown> = { ...(home ?? {}), ...(local ?? {}), ...(explicit ?? {}) }
    // env overrides: BB_EMBEDDING_MODEL, BB_EMBEDDING_BASE_URL, BB_EMBEDDING_API_KEY, BB_PROVIDER
    if (process.env.BB_EMBEDDING_MODEL) merged.embedding_model = process.env.BB_EMBEDDING_MODEL
    if (process.env.BB_EMBEDDING_BASE_URL) merged.embedding_base_url = process.env.BB_EMBEDDING_BASE_URL
    if (process.env.BB_EMBEDDING_API_KEY) merged.embedding_api_key = process.env.BB_EMBEDDING_API_KEY
    if (process.env.BB_PROVIDER) merged.provider = process.env.BB_PROVIDER
    cached = merged
    return merged
  }

  export function clearCache(): void {
    cached = null
  }
}
