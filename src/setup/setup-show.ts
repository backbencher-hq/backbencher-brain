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
// It also prints the provider chain bb will actually use, in resolution order,
// with each layer's source env var — the answer to "which provider am I on and
// what do I change to move off it", which the tier table alone does not give
// (a tier can be complete and still be unusable: no key for a remote host, or
// a base URL that is not an endpoint). That block comes from
// src/brain/semantic/embedding-diagnosis.ts, the same module `bb doctor` and
// `bb health` read, so the three surfaces cannot disagree about what bb is
// going to do.
//
// Pure local state: no network, no prompts, non-TTY safe. The CLI exits 1
// when nothing is configured so scripts can branch on it.

import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"
import { fingerprintKey } from "./setup-wizard"
import {
  buildEmbeddingDiagnosis,
  embeddingChainVerdict,
  renderChainSummary,
  type EmbeddingDiagnosis,
} from "../brain/semantic/embedding-diagnosis"

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
  /**
   * The provider chain and its problems, attached at construction so a caller
   * that already has a state does not rebuild it. Optional because the tier view
   * alone remains a valid, self-contained description — the chain is additive.
   */
  diagnosis?: EmbeddingDiagnosis
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
  //
  // KNOWN DISAGREEMENT, reported rather than silently changed: the runtime merges
  // the two file tiers in the opposite order (Config.get() is
  // `{...home, ...local, ...explicit}`, so a project's bb.json overrides
  // ~/.bb/config.json) and EMBEDDINGS.md documents it that way too. So when both
  // file tiers are complete, the "Winner" line below names the global tier while
  // indexing actually uses the project one. script/m32/verify-setup-show.ts
  // asserts this order as the contract ("global still outranks project"), so it
  // is not changed here; `buildEmbeddingDiagnosis` surfaces the disagreement as
  // `tierOrderDisagreement` and `bb doctor` prints it.
  const winningTier = tiers.find((t) => t.complete)
  const state: SetupShowState = {
    winner: winningTier?.tier ?? "none",
    configured: Boolean(winningTier),
    tiers,
  }
  // The diagnosis needs the state, and the state gains the diagnosis: build it
  // here rather than in the renderer so every caller of the state sees it.
  state.diagnosis = buildEmbeddingDiagnosis({ state, env: env as NodeJS.ProcessEnv })
  return state
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

  // The chain, in the order bb resolves it. `bb setup show` is where a user goes
  // to find out what the machine is going to do, so it answers that here rather
  // than making them run `bb doctor`. Rendered from `state.diagnosis` when
  // present — the same object `bb doctor` prints, so the two cannot disagree.
  const diagnosis = state.diagnosis
  if (diagnosis) {
    lines.push("")
    lines.push(`Chain: ${embeddingChainVerdict(diagnosis)}`)
    for (const line of renderChainSummary(diagnosis)) lines.push(line)
    const problems = diagnosis.problems.filter((p) => !/^No embedding provider is configured/.test(p.message))
    for (const p of problems) {
      const varName = p.envVar ? `${p.envVar}: ` : ""
      lines.push(`  ! ${varName}${p.message}`)
    }
    for (const f of diagnosis.observedFailures) {
      lines.push(`  ✗ ${f.status} ${f.kind} from ${f.baseURL} — ${f.advice}`)
    }
    if (diagnosis.tierOrderDisagreement) {
      lines.push(`  ! ${diagnosis.tierOrderDisagreement.detail}`)
    }
  }
  return lines.join("\n") + "\n"
}
