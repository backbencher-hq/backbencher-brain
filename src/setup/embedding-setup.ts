/**
 * Embedding setup v2 — key-first, provider-detected, model-picker flow.
 *
 * Why this exists
 * ---------------
 * The first-run wizard asked the user to choose a PROVIDER before pasting a key,
 * and offered OpenRouter as a "free tier" embedding provider. OpenRouter exposes
 * an /embeddings route but lists no embedding models, so that branch could never
 * validate: the key was never saved and every `bb index` re-prompted — an infinite
 * setup loop, measured against the live provider catalogue (0 embedding models).
 *
 * This flow starts from the only thing that identifies a provider in practice:
 * the key. It detects the provider from the key prefix, lists the embedding models
 * that provider actually returns for that key, and lets the user pick one or type
 * a model id by hand (providers do not expose an "embeddings" capability flag, so
 * name filtering is a heuristic and the selection is validated with a real
 * /embeddings probe before anything is written).
 *
 * It also fixes the hidden-input leak: the legacy readline-based reader echoed the
 * typed characters interleaved with the mask stars. This module reads the key from
 * raw bytes with terminal echo off, writes only `*`, and never puts the key in the
 * output buffer it writes to.
 *
 * The legacy `setup-wizard.ts` is kept untouched because three lane gates mutate
 * its pinned source strings; the CLI no longer calls it. It can be removed together
 * with those gates in a later cleanup.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync, unlinkSync } from "node:fs"
import path from "node:path"
import { bbDataDir } from "../util/bb-data-dir"
import { hasEmbeddingConfig, validateKey, fingerprintKey } from "./setup-wizard"
import type { KeyValidationResult } from "./setup-wizard"

// --- Stream surface (the only members this module touches) -------------------

export interface SetupInput {
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?: (mode: boolean) => void
  pause?: () => unknown
  resume?: () => unknown
}

export interface SetupOutput {
  write(chunk: string): unknown
}

export interface SetupIo {
  input: SetupInput
  output: SetupOutput
}

// --- Provider detection ------------------------------------------------------

export interface DetectedProvider {
  id: string
  label: string
  baseURL: string
  /** Where to get a free key, when the provider has one. */
  keyHint: string
  /** A truthful note shown after detection (e.g. a catalogue gap). */
  note?: string
}

/**
 * Detection is by key prefix, and order matters: `sk-or-v1-` must win over the
 * generic `sk-` OpenAI family. Unknown keys fall through to the custom base-URL
 * prompt, which is also the path for a future OpenRouter embedding model.
 */
const PROVIDER_PREFIXES: Array<{ provider: DetectedProvider; prefix: RegExp }> = [
  {
    provider: {
      id: "nvidia-nim",
      label: "NVIDIA NIM (free tier)",
      baseURL: "https://integrate.api.nvidia.com/v1",
      keyHint: "build.nvidia.com — free key, rate-limited",
    },
    prefix: /^nv(?:api|cf)-/i,
  },
  {
    provider: {
      id: "openrouter",
      label: "OpenRouter",
      baseURL: "https://openrouter.ai/api/v1",
      keyHint: "openrouter.ai/keys",
      note: "OpenRouter lists no embedding models today; you can still type a model id manually.",
    },
    prefix: /^sk-or-v1-/i,
  },
  {
    provider: {
      id: "google",
      label: "Google Gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      keyHint: "aistudio.google.com — free tier",
    },
    prefix: /^AIza/i,
  },
  {
    provider: {
      id: "openai",
      label: "OpenAI",
      baseURL: "https://api.openai.com/v1",
      keyHint: "platform.openai.com/api-keys",
    },
    prefix: /^sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9]/,
  },
]

export function detectProviderFromKey(key: string): DetectedProvider | null {
  for (const { provider, prefix } of PROVIDER_PREFIXES) {
    if (prefix.test(key)) return provider
  }
  return null
}

// --- Embedding-model heuristic ----------------------------------------------

/**
 * There is no provider-wide "this model produces embeddings" flag: NVIDIA and
 * OpenAI both return only id/object/owned_by from /v1/models. Name patterns are
 * therefore a HINT for the menu, never the proof. The proof is the live
 * /embeddings probe on the chosen model (validateKey), which is what gates the
 * save.
 */
const EMBEDDING_NAME_PATTERNS: RegExp[] = [
  /embed/i,
  /(?:^|[/_.-])bge(?:$|[/_.-])/i,
  /(?:^|[/_.-])gte(?:$|[-_.])/i,
  /(?:^|[/_.-])e5(?:$|[-_.])/i,
  /nomic/i,
  /jina/i,
  /voyage/i,
  /mxbai/i,
  /snowflake[^a-z0-9]*arctic/i,
]

export function isEmbeddingModelId(id: string): boolean {
  return EMBEDDING_NAME_PATTERNS.some((re) => re.test(id))
}

export interface ModelListing {
  /** Embedding-named models for this key, sorted. */
  models: string[]
  /** How many models the provider returned in total. */
  listed: number
  /** Present when /models could not be read at all. */
  error?: string
}

function modelIdsFrom(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return []
  const root = body as Record<string, unknown>
  const list = Array.isArray(root.data) ? root.data : Array.isArray(body) ? body : []
  const ids: string[] = []
  for (const entry of list) {
    if (typeof entry === "string") ids.push(entry)
    else if (typeof entry === "object" && entry !== null) {
      const id = (entry as Record<string, unknown>).id
      if (typeof id === "string" && id.length > 0) ids.push(id)
    }
  }
  return ids
}

/**
 * List the provider's models and narrow them to embedding-looking ids.
 *
 * NVIDIA's /v1/models is public, so a key that /embeddings would reject can still
 * show the menu; validation catches the bad key afterwards. When the authenticated
 * call is rejected we therefore retry once without auth, purely to render the list.
 */
export async function listEmbeddingModels(opts: {
  baseURL: string
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<ModelListing> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `${opts.baseURL.replace(/\/+$/, "")}/models`
  const timeoutMs = opts.timeoutMs ?? 15000

  const get = async (withAuth: boolean): Promise<{ status: number; ids: string[] }> => {
    const headers: Record<string, string> = { accept: "application/json" }
    if (withAuth) headers.authorization = `Bearer ${opts.apiKey}`
    const res = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { status: res.status, ids: [] }
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      return { status: res.status, ids: [] }
    }
    return { status: res.status, ids: modelIdsFrom(body) }
  }

  let first: { status: number; ids: string[] }
  try {
    first = await get(true)
    if ((first.status === 401 || first.status === 403) && first.ids.length === 0) {
      first = await get(false)
    }
  } catch (caught) {
    return { models: [], listed: 0, error: caught instanceof Error ? caught.message : String(caught) }
  }
  if (first.ids.length === 0) {
    return { models: [], listed: 0, error: first.status >= 400 ? `HTTP ${first.status} from /models` : undefined }
  }
  const all = [...new Set(first.ids)].sort()
  const models = all.filter(isEmbeddingModelId)
  return { models, listed: all.length }
}

// --- Config write/reset (atomic, 0600) --------------------------------------

function configPath(dataDir: string): string {
  return path.join(dataDir, "config.json")
}

function readConfigFile(dataDir: string): Record<string, unknown> {
  const p = configPath(dataDir)
  try {
    if (!existsSync(p)) return {}
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"))
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeConfigFile(dataDir: string, config: Record<string, unknown>): string {
  mkdirSync(dataDir, { recursive: true })
  const p = configPath(dataDir)
  const tmp = `${p}.tmp`
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, p)
  chmodSync(p, 0o600)
  return p
}

/** Save a validated selection and clear the "user skipped" marker. */
export function saveEmbeddingSelection(
  selection: { baseURL: string; apiKey: string; model: string },
  dataDir: string = bbDataDir(),
): string {
  const config = readConfigFile(dataDir)
  delete config.setup_skipped
  config.embedding_base_url = selection.baseURL
  config.embedding_api_key = selection.apiKey
  config.embedding_model = selection.model
  return writeConfigFile(dataDir, config)
}

/** Remember an explicit skip so the first-run hook never nags again. */
export function saveSetupSkipped(dataDir: string = bbDataDir()): string {
  const config = readConfigFile(dataDir)
  config.setup_skipped = true
  return writeConfigFile(dataDir, config)
}

export interface ResetResult {
  path: string
  existed: boolean
  removed: string[]
}

const EMBEDDING_KEYS = ["embedding_base_url", "embedding_api_key", "embedding_model", "setup_skipped"] as const

/** Remove only the embedding keys; unrelated config keys are preserved. */
export function resetEmbeddingConfig(dataDir: string = bbDataDir()): ResetResult {
  const p = configPath(dataDir)
  const existed = existsSync(p)
  const config = readConfigFile(dataDir)
  const removed: string[] = []
  for (const key of EMBEDDING_KEYS) {
    if (key in config) {
      delete config[key]
      removed.push(key)
    }
  }
  if (!existed) return { path: p, existed: false, removed: [] }
  if (Object.keys(config).length === 0) unlinkSync(p)
  else writeConfigFile(dataDir, config)
  return { path: p, existed: true, removed }
}

// --- Prompt primitives (raw-mode key input, no echo) ------------------------

function pause(input: SetupInput): void {
  try {
    input.pause?.()
  } catch {}
}

function resume(input: SetupInput): void {
  try {
    input.resume?.()
  } catch {}
}

/** One line of ordinary input. Terminal line discipline echoes it for us. */
export function readLine(input: SetupInput, output: SetupOutput, prompt: string): Promise<string> {
  output.write(prompt)
  resume(input)
  return new Promise<string>((resolve) => {
    let buffer = ""
    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      input.removeListener("data", onData)
      input.removeListener("end", onEnd)
      pause(input)
    }
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString()
      // A TTY delivers CR (or CRLF); a pipe usually delivers LF. Accept either so
      // the line reader behaves the same in a terminal and in a scripted test.
      const terminator = buffer.search(/[\r\n]/)
      if (terminator < 0) return
      const line = buffer.slice(0, terminator)
      cleanup()
      resolve(line)
    }
    const onEnd = (): void => {
      if (done) return
      cleanup()
      resolve(buffer)
    }
    input.on("data", onData)
    input.on("end", onEnd)
  })
}

/**
 * Hidden input. Raw mode turns terminal echo off; every accepted character writes
 * exactly one `*`. Ctrl+C resolves null, Backspace edits the buffer. Resolves null
 * on EOF so a caller can treat it as a skip, never as a hang.
 */
export function readHidden(input: SetupInput, output: SetupOutput, prompt: string): Promise<string | null> {
  output.write(prompt)
  const stdin = input
  const wasRaw = stdin.isRaw === true
  if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(true)
  resume(input)
  return new Promise<string | null>((resolve) => {
    let value = ""
    let done = false
    const restore = (): void => {
      if (done) return
      done = true
      try {
        input.removeListener("data", onData)
        input.removeListener("end", onEnd)
      } catch {}
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        try {
          stdin.setRawMode(wasRaw)
        } catch {}
      }
      pause(input)
    }
    const finish = (line: string | null): void => {
      restore()
      output.write("\n")
      resolve(line)
    }
    const onData = (chunk: Buffer | string): void => {
      const text = chunk.toString("utf8")
      for (const ch of text) {
        const code = ch.charCodeAt(0)
        if (ch === "\r" || ch === "\n") return finish(value)
        if (code === 3) return finish(null) // Ctrl+C
        if (code === 8 || code === 127) {
          if (value.length > 0) {
            value = value.slice(0, -1)
            output.write("\b \b")
          }
          continue
        }
        if (code < 32) continue // ignore other control keys
        value += ch
        output.write("*")
      }
    }
    const onEnd = (): void => finish(null)
    input.on("data", onData)
    input.on("end", onEnd)
  })
}

// --- Wizard -----------------------------------------------------------------

export interface EmbeddingWizardDeps {
  fetchImpl?: typeof fetch
  dataDir?: string
  /** Replaces the /models listing (tests, custom transport). */
  listImpl?: (args: { baseURL: string; apiKey: string }) => Promise<ModelListing>
  /** Replaces the pre-save /embeddings probe. */
  validateImpl?: (baseURL: string, apiKey: string, model: string) => Promise<KeyValidationResult>
}

export type EmbeddingWizardOutcome =
  | { saved: false; skipped: true; reason: "user-skipped" | "empty-key" | "cancelled" | "empty-base-url" | "empty-model"; error?: string }
  | { saved: false; skipped: true; reason: "validation-failed"; error: string }
  | { saved: true; provider: string; baseURL: string; model: string; fingerprint: string; softPass: boolean; configPath: string }

const SKIP_GUIDANCE =
  "Skipped — local word vectors are used for now. Add or change embeddings any time with `bb setup`; remove them with `bb setup reset`."

export async function runEmbeddingWizard(io: SetupIo, deps: EmbeddingWizardDeps = {}): Promise<EmbeddingWizardOutcome> {
  const out = io.output
  const dataDir = deps.dataDir ?? bbDataDir()
  const fetchImpl = deps.fetchImpl ?? fetch
  const list =
    deps.listImpl ??
    ((args: { baseURL: string; apiKey: string }) => listEmbeddingModels({ ...args, fetchImpl }))
  const validate = deps.validateImpl ?? ((baseURL: string, apiKey: string, model: string) => validateKey(baseURL, apiKey, model, fetchImpl))

  out.write("\nbb — embeddings\n")
  out.write("Semantic search (bb_search, bb_ask) is better with embeddings. It is optional.\n")
  out.write("Without a key bb uses local word vectors — weaker results.\n")
  out.write("Free, rate-limited embedding models: NVIDIA NIM (build.nvidia.com).\n")
  out.write("OpenRouter currently lists no embedding models; type a model id if you have one.\n")
  out.write("Change or remove this later with `bb setup` / `bb setup reset`.\n\n")

  // The key identifies the provider; an empty key is the explicit skip.
  const key = (await readHidden(io.input, out, "API key (hidden, Enter to skip): "))?.trim() ?? ""
  if (!key) {
    saveSetupSkipped(dataDir)
    out.write(`${SKIP_GUIDANCE}\n`)
    return { saved: false, skipped: true, reason: "user-skipped" }
  }

  let currentKey = key
  let currentProvider = detectProviderFromKey(currentKey)

  for (;;) {
    let baseURL: string
    if (currentProvider) {
      baseURL = currentProvider.baseURL
      out.write(`Detected provider: ${currentProvider.label} — ${currentProvider.keyHint}\n`)
      if (currentProvider.note) out.write(`  note: ${currentProvider.note}\n`)
    } else {
      const answer = (await readLine(io.input, out, "Base URL (OpenAI-compatible /v1 endpoint): ")).trim()
      if (!answer) {
        saveSetupSkipped(dataDir)
        out.write(`${SKIP_GUIDANCE}\n`)
        return { saved: false, skipped: true, reason: "empty-base-url" }
      }
      baseURL = answer
    }

    out.write(`Fetching embedding models from ${baseURL}…\n`)
    let listing: ModelListing
    try {
      listing = await list({ baseURL, apiKey: currentKey })
    } catch (caught) {
      listing = { models: [], listed: 0, error: caught instanceof Error ? caught.message : String(caught) }
    }
    if (listing.error) out.write(`  ⚠ could not list models (${listing.error}); you can type the model id.\n`)
    else if (listing.models.length === 0) {
      out.write(`  no embedding-named models listed (${listing.listed} model(s) returned); type the model id.\n`)
    } else {
      out.write("\nEmbedding models available to this key:\n")
      listing.models.forEach((model, index) => out.write(`  ${index + 1}) ${model}\n`))
      out.write("  m) type a model id\n  s) skip for now\n")
    }

    // Model selection, validation, and the retry menu all live in this loop: a
    // failed probe keeps the key (and, on "retry", the same model) rather than
    // dumping the user out. `model` lives outside the loop so "r" re-validates
    // the SAME id; only "m" clears it and re-opens the menu.
    let model: string | null = null
    for (;;) {
      if (model === null) {
        if (listing.models.length > 0) {
          const choice = (await readLine(io.input, out, `Choice [1-${listing.models.length}/m/s]: `)).trim()
          if (choice === "s") {
            saveSetupSkipped(dataDir)
            out.write(`${SKIP_GUIDANCE}\n`)
            return { saved: false, skipped: true, reason: "user-skipped" }
          }
          if (choice === "m") {
            model = (await readLine(io.input, out, "Model id: ")).trim() || null
          } else {
            const index = Number.parseInt(choice, 10)
            if (Number.isFinite(index) && index >= 1 && index <= listing.models.length) model = listing.models[index - 1]
            else {
              out.write(`Invalid choice "${choice}" — enter a number, m, or s.\n`)
              continue
            }
          }
        } else {
          const answer = (await readLine(io.input, out, "Model id (Enter to skip): ")).trim()
          model = answer || null
        }

        if (!model) {
          saveSetupSkipped(dataDir)
          out.write(`${SKIP_GUIDANCE}\n`)
          return { saved: false, skipped: true, reason: "empty-model" }
        }
      }

      const selectedModel = model
      out.write(`Validating ${selectedModel}…\n`)
      let validation: KeyValidationResult
      try {
        validation = await validate(baseURL, currentKey, selectedModel)
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        out.write(`✗ ${message}\n`)
        const action = (await readLine(io.input, out, "r) retry  m) change model  k) change key  s) skip: ")).trim().toLowerCase()
        if (action === "s") {
          saveSetupSkipped(dataDir)
          out.write(`${SKIP_GUIDANCE}\n`)
          return { saved: false, skipped: true, reason: "user-skipped", error: message }
        }
        if (action === "k" || action === "3") break // back to the provider/key loop
        if (action === "m" || action === "2") {
          model = null
          continue // re-open the model menu
        }
        continue // "r" and anything else: retry the SAME model
      }

      model = selectedModel
      const configPath = saveEmbeddingSelection({ baseURL, apiKey: currentKey, model }, dataDir)
      if (validation.softPass) {
        out.write("✓ Key saved (provider returned a rate limit — indexing retries automatically).\n")
      } else {
        out.write(`✓ Key saved and validated (${model}, ${validation.dimension} dimensions).\n`)
      }
      out.write(`Saved to: ${configPath} (only your account can read it)\n`)
      out.write("Change later: bb setup · reset: bb setup reset\n")
      out.write("Existing indexes re-embed automatically on the next `bb index`; a full parse rebuild is `bb index --force`.\n")
      return {
        saved: true,
        provider: currentProvider?.id ?? "custom",
        baseURL,
        model,
        fingerprint: validation.fingerprint,
        softPass: validation.softPass === true,
        configPath,
      }
    }

    // Only the "change key" action reaches here.
    const nextKey = (await readHidden(io.input, out, "API key (hidden, Enter to skip): "))?.trim() ?? ""
    if (!nextKey) {
      saveSetupSkipped(dataDir)
      out.write(`${SKIP_GUIDANCE}\n`)
      return { saved: false, skipped: true, reason: "empty-key" }
    }
    currentKey = nextKey
    currentProvider = detectProviderFromKey(currentKey)
  }
}

// --- First-run hook (mirrors the legacy contract) ---------------------------

export interface FirstRunOpts {
  noSetup?: boolean
  quiet?: boolean
}

export type FirstRunOutcome =
  | { prompted: false; reason: "flag" | "configured" | "skipped" | "non-tty" }
  | ({ prompted: true } & EmbeddingWizardOutcome)

export async function maybeRunEmbeddingSetup(opts: FirstRunOpts = {}): Promise<FirstRunOutcome> {
  if (opts.noSetup) return { prompted: false, reason: "flag" }
  const state = hasEmbeddingConfig(process.cwd(), process.env)
  if (state.configured) return { prompted: false, reason: "configured" }
  if (state.skipped) return { prompted: false, reason: "skipped" }
  if (!process.stdin.isTTY) {
    if (!opts.quiet) {
      console.log("note: no embedding key — semantic search will use local vectors (weaker). Setup: bb setup")
    }
    return { prompted: false, reason: "non-tty" }
  }
  const result = await runEmbeddingWizard({ input: process.stdin, output: process.stdout })
  return { prompted: true, ...result }
}

/** Re-exported for callers that want the same fingerprint rule. */
export { fingerprintKey }
