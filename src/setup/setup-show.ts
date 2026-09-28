// src/setup/setup-show.ts — M32.S1.
//
// `bb setup show`: a SAFE view of the effective embedding config. M30 gave
// users a wizard and a 0600 config file; the immediate follow-up demand is
// "did my key actually save, and which config wins?" — answerable here
// without opening the file (which would expose the key) or guessing the
// precedence.
//
// What it shows, per the M32 master plan:
//   - every precedence tier that exists (env BB_EMBEDDING_* / global
//     ~/.bb/config.json / project bb.json) and which tier WINS
//   - base URL and model per tier (not secret)
//   - the key as a last-4 fingerprint ONLY — the full key is never returned
//     or rendered by this module
//   - the config file's permission mode, with a warning when it is not 0600
//
// Pure local state: no network, no prompts, non-TTY safe. The CLI exits 1
// when nothing is configured so scripts can branch on it.

import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"
import { fingerprintKey } from "./setup-wizard"

export type TierId = "env" | "global" | "project"

export type TierView = {
  tier: TierId
  present: boolean
  complete: boolean
  baseURL?: string
  model?: string
  /** last 4 chars of the key, or undefined when no key is set — never the full key */
  keyFingerprint?: string
  /** numeric mode (e.g. 0o600) of the backing file; env tier has none */
  fileMode?: number
  /** path of the backing file; env tier has none */
  file?: string
  /** why a present tier cannot produce embeddings */
  incompleteReason?: string
  /** the user explicitly skipped the wizard (global setup_skipped marker) */
  skippedMarker?: boolean
}

export type SetupShowState = {
  winner: TierId | "none"
  configured: boolean
  tiers: TierView[]
}

function readJsonSafe(p: string): any | null {
  try {
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, "utf8"))
  } catch {
    return null // corrupt JSON counts as absent — show must never crash on it
  }
}

function fileMode(p: string): number | undefined {
  try {
    return statSync(p).mode & 0o777
  } catch {
    return undefined
  }
}

function completeTier(tier: TierId, baseURL: unknown, model: unknown, key: unknown, file?: string, skippedMarker?: boolean): TierView {
  const present = baseURL !== undefined || model !== undefined || key !== undefined || skippedMarker === true
  const complete = typeof baseURL === "string" && baseURL.length > 0 && typeof model === "string" && model.length > 0
  const missing: string[] = []
  if (!baseURL) missing.push("base URL")
  if (!model) missing.push("model")
  return {
    tier,
    present,
    complete,
    baseURL: typeof baseURL === "string" ? baseURL : undefined,
    model: typeof model === "string" ? model : undefined,
    keyFingerprint: typeof key === "string" && key.length > 0 ? fingerprintKey(key) : undefined,
    file,
    fileMode: file ? fileMode(file) : undefined,
    incompleteReason: present && !complete ? `missing: ${missing.join(" + ")}` : undefined,
  }
}

// Inspect all precedence tiers with explicit inputs (cwd, env, dataDir) so the
// function is deterministic and testable — the CLI calls it with defaults.
export function describeEmbeddingConfig(cwd = process.cwd(), env: Record<string, string | undefined> = process.env, dataDir: string = bbDataDir()): SetupShowState {
  const globalFile = path.join(dataDir, "config.json")
  const global = readJsonSafe(globalFile)
  const projectFile = path.join(cwd, "bb.json")
  const project = readJsonSafe(projectFile)

  const envTier = completeTier(
    "env",
    env.BB_EMBEDDING_BASE_URL,
    env.BB_EMBEDDING_MODEL,
    env.BB_EMBEDDING_API_KEY,
  )

  const globalTier = completeTier(
    "global",
    global?.embedding_base_url,
    global?.embedding_model,
    global?.embedding_api_key,
    globalFile,
    global?.setup_skipped === true,
  )
  if (global && global.setup_skipped === true) globalTier.skippedMarker = true

  const projectTier = completeTier(
    "project",
    project?.embedding_base_url,
    project?.embedding_model,
    project?.embedding_api_key,
    projectFile,
  )

  const tiers = [envTier, globalTier, projectTier]
  // Winner mirrors hasEmbeddingConfig(): first COMPLETE tier in env > global
  // > project order. An incomplete tier is shown but can never win.
  const winningTier = tiers.find((t) => t.complete)
  return {
    winner: winningTier?.tier ?? "none",
    configured: Boolean(winningTier),
    tiers,
  }
}

// Render human-readable output. Only fingerprints may appear here — the full
// key is structurally absent from SetupShowState.
export function renderSetupShow(state: SetupShowState): string {
  const lines: string[] = []
  lines.push("bb — embedding configuration")
  lines.push("Precedence: env > ~/.bb/config.json > bb.json")
  lines.push("")
  const tierLabel: Record<TierId, string> = { env: "env", global: "global", project: "project" }
  for (const t of state.tiers) {
    const label = tierLabel[t.tier].padEnd(7)
    if (!t.present) {
      lines.push(`${label}: — (not set)`)
      continue
    }
    if (!t.complete) {
      const key = t.keyFingerprint ? ` (key: ••••${t.keyFingerprint})` : ""
      const skipped = t.skippedMarker ? " · wizard skipped" : ""
      lines.push(`${label}: ✗ ${t.incompleteReason ?? "incomplete"}${key}${skipped}`)
      continue
    }
    const key = t.keyFingerprint ? `key: ••••${t.keyFingerprint}` : "key: none"
    let line = `${label}: ✓ ${t.baseURL} · ${t.model} · ${key}`
    if (t.fileMode !== undefined && t.fileMode !== 0o600) {
      line += ` · mode: ${t.fileMode.toString(8)} (expected: 600 — fix with bb doctor)`
    } else if (t.fileMode !== undefined) {
      line += ` · mode: 600`
    }
    if (t.skippedMarker) line += " · wizard skipped"
    lines.push(line)
  }
  lines.push("")
  if (state.configured) {
    const w = state.winner as TierId
    lines.push(`Winner: ${tierLabel[w]}`)
  } else {
    lines.push("Winner: none — semantic search will use local vectors (weaker). Setup: bb setup")
  }
  return lines.join("\n") + "\n"
}
