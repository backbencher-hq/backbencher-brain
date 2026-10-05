// src/setup/setup-wizard.ts — M30.S1 + M30.S2 + M30.S3.
//
// First-run embedding setup. The user demand: bb is installed, the user runs
// `bb index`, and nothing tells them embeddings exist or that semantic search
// silently degrades to local word vectors without a key. This module provides:
//
//   - hasEmbeddingConfig(): config detection across all precedence tiers
//   - validateKey(): pre-save live /embeddings probe, actionable error mapping
//   - runSetupWizard(): interactive readline flow (numbered menu, hidden key)
//   - maybeRunFirstRunSetup(): the bb index hook — TTY-gated, never hangs
//
// Config precedence (must match Config.get()): env BB_EMBEDDING_* >
// ~/.bb/config.json > project bb.json. The wizard writes ONLY to
// ~/.bb/config.json and always with mode 0600.
//
// Honesty contract: the skip path states exactly what the user gets without a
// key (local word vectors, declared weaker) and that adding a model later
// requires `bb index --force` to re-embed. No "it just works" claims.
//
// ── Why this module was untyped, and what fixed it ──────────────────────────
// `// @ts-nocheck` hid 32 errors in 371 lines, which is a density that means a
// structural cause rather than 32 typos. There was exactly ONE cause, with three
// distinct faces:
//
//   1. NOT ONE function parameter in the file was annotated. Fifteen of them
//      (`readJson(p)`, `mapValidationError(status, bodyText)`,
//      `validateKey(baseURL, apiKey, model)`, `question(rl, prompt)`,
//      `fingerprintKey(key)`, `fixConfigMode(cfgPath)`, the `onKeypress`
//      callback, …) were implicitly `any` — TS7006, 16 errors.
//   2. Three parameters were defaulted to `{}` (`runSetupWizard(io, deps = {})`,
//      `maybeRunFirstRunSetup(opts = {})`). A `= {}` default infers the type
//      `{}`, NOT `any`, so every property read off it — `deps.fetchImpl`,
//      `deps.dataDir`, `deps.saveImpl`, `deps.validateImpl`, `opts.noSetup`,
//      `opts.quiet` — was TS2339, 6 more errors. That is why the two failure
//      shapes looked unrelated but had one root cause.
//   3. Under `strict`, a caught value is `unknown`; `e && …` narrows `unknown`
//      to `{}`, so `e.name` / `e.message` after the truthiness guard were TS2339
//      again. And because `question`'s `resolve` was implicit-any, the helper
//      inferred `Promise<unknown>`, which is why the three `(await question(…))
//      .trim()` call sites were TS2571 "Object is of type 'unknown'" — a crash
//      class, not a typing nit: `.trim()` on a value readline had not yet
//      guaranteed was a string.
//
// It was NOT an untyped fs/process boundary (those return typed values), and not
// genuinely dynamic data. The fix is the missing annotations plus explicit types
// for the three injection seams (`io`, `deps`, `opts`) that had been leaning on
// `{}`. Behaviour is unchanged: every cast added below is erased at runtime, and
// each one is commented with why the compiler cannot do it alone.
//
// Two source strings in this file are load-bearing for the gates that mutate it
// (script/m30/verify-setup.ts, verify-first-run-hook.ts,
// verify-key-validation.ts all `src.replace(...)` on them), so they are left
// byte-identical and marked `[pin]` below.

import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync, renameSync, chmodSync } from "node:fs"
import path from "node:path"
import * as readline from "node:readline"
import { bbDataDir } from "../util/bb-data-dir"

// --- Provider catalogue -----------------------------------------------------
// The user only pastes a key; base URL and model come prefilled.

export interface EmbeddingProvider {
  id: string
  label: string
  /** `null` on the "custom" entry, which asks the user for both instead. */
  baseURL: string | null
  model: string | null
  keyHint: string
}

export const PROVIDERS: EmbeddingProvider[] = [
  {
    id: "openrouter-free",
    label: "OpenRouter (free tier)",
    baseURL: "https://openrouter.ai/api/v1",
    model: "liquid/lfm-2.5-embedding-350m:free",
    keyHint: "openrouter.ai/keys — free key, rate-limited",
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM (free tier)",
    baseURL: "https://integrate.api.nvidia.com/v1",
    model: "nvidia/nemotron-3-embed-1b",
    keyHint: "build.nvidia.com — free key, rate-limited",
  },
  {
    id: "custom",
    label: "Custom / paid provider",
    baseURL: null,
    model: null,
    keyHint: "OpenAI-compatible /embeddings endpoint",
  },
]

// --- Config detection --------------------------------------------------------

export type EmbeddingSetupState = {
  configured: boolean
  source: "env" | "global" | "project" | "none"
  skipped?: boolean
}

/**
 * A config file as this module reads it: a bag of unknown-valued keys.
 *
 * `unknown` rather than `any` on purpose. `readJson` returns whatever
 * `JSON.parse` produced, and the wizard never assumes a type for a value it did
 * not write — the implicit `any` return let a string be used as a URL and a
 * nested object be spread as a config without anything objecting. Truthiness
 * tests on `unknown` are still allowed, which is all these call sites need.
 */
type ConfigFile = Record<string, unknown>

function readJson(p: string): ConfigFile | null {
  try {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")) as ConfigFile
  } catch {}
  return null
}

// Mirrors Config.get() precedence: env > ~/.bb/config.json > bb.json.
// A tier "counts" only when it can actually produce embeddings: base URL AND
// model must both be present (isEmbeddingConfigured's contract).
// skipped: the user explicitly chose "Skip" in the wizard — remembered so the
// wizard only ever runs once. `bb setup` (or deleting the key) re-enables it.
export function hasEmbeddingConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): EmbeddingSetupState {
  if (env.BB_EMBEDDING_BASE_URL && env.BB_EMBEDDING_MODEL) return { configured: true, source: "env" }
  const home = readJson(path.join(bbDataDir(), "config.json"))
  if (home && home.embedding_base_url && home.embedding_model) return { configured: true, source: "global" }
  const local = readJson(path.join(cwd, "bb.json"))
  if (local && local.embedding_base_url && local.embedding_model) return { configured: true, source: "project" }
  if (home && home.setup_skipped === true) return { configured: false, source: "none", skipped: true }
  return { configured: false, source: "none" }
}

// --- Key validation (M30.S3) -------------------------------------------------

// Maps a failed /embeddings probe to an actionable message. Exported for the
// verifier's mutation suite: removing a branch must fail the suite.
export function mapValidationError(status: number, bodyText: string): string {
  if (status === 401 || status === 403) { // [pin]
    return "Key rejected (401). Check the key and provider — copy-paste may have dropped or added characters."
  }
  if (status === 429) {
    return "Rate limit (429). The key looks valid; free-tier limit. It can be saved — indexing backs off and retries."
  }
  if (status >= 500) {
    return `Provider error (${status}). The key may be valid; the provider is temporarily failing. It can be saved — indexing retries automatically.`
  }
  if (status === 404) {
    return `Model not found (404). Check the model name: the provider's /embeddings endpoint does not recognize it.`
  }
  return `Unexpected response (${status}): ${(bodyText || "").slice(0, 120)}`
}

/** What a successful pre-save probe reports. Never carries the key itself. */
export interface KeyValidationResult {
  /**
   * True when the provider ACCEPTED the request shape but rate-limited or
   * failed (429 / 5xx). The key shape is accepted, so the wizard saves it; the
   * index-time backoff deals with the condition.
   */
  softPass: boolean
  status: number
  model: string
  /** Present only on a hard pass — the width the provider actually returned. */
  dimension?: number
  /** Last 4 characters of the key. `fingerprintKey` only ever emits 4. */
  fingerprint: string
}

/**
 * A value that may have been thrown, shaped the way this module reads it.
 *
 * Not a lie: `catch` gives `unknown`, and the two places below that inspect a
 * thrown value read `.name` and `.message` off it and, in one case, interpolate
 * the value itself. Modelling the fields makes those reads checked instead of
 * arbitrary.
 */
type ThrownLike = { name?: string; message?: unknown }

/**
 * `data[0].embedding` out of an unknown provider response, or undefined.
 *
 * Written as explicit shape tests rather than the optional chaining it replaces.
 * `res.json()` is `Promise<any>`, and the previous `data?.data?.[0]?.embedding`
 * returned undefined for anything that was not a matching object — so every
 * branch below returns undefined in exactly the cases the old chain did, and the
 * caller still reports "no embedding". The difference is that a response shaped
 * wrongly is now a checked path rather than a chain of `any`s.
 */
function firstEmbedding(response: unknown): unknown {
  if (typeof response !== "object" || response === null) return undefined
  if (!("data" in response)) return undefined
  const list: unknown = response.data
  if (!Array.isArray(list) || list.length === 0) return undefined
  const first: unknown = list[0]
  if (typeof first !== "object" || first === null) return undefined
  if (!("embedding" in first)) return undefined
  return first.embedding
}

// One tiny live probe before saving. Throws Error with an actionable
// message on failure; resolves to { model, fingerprint } on success.
// 429/5xx are treated as soft-pass (key shape accepted, rate/provider issue),
// because the rate-limit resilience (Q1) handles them at index time.
export async function validateKey(baseURL: string, apiKey: string, model: string, fetchImpl: typeof fetch = fetch): Promise<KeyValidationResult> {
  const url = `${baseURL.replace(/\/+$/, "")}/embeddings` // [pin]
  // Do not send loopback traffic through HTTP_PROXY/ALL_PROXY — mirrors
  // embedOpenAICompatible so local mock/self-hosted endpoints stay reachable.
  try {
    const parsed = new URL(url)
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]" || parsed.hostname === "::1") {
      const loopbackHosts = ["127.0.0.1", "localhost", "::1"]
      for (const key of ["NO_PROXY", "no_proxy"] as const) {
        const existing = process.env[key] ?? ""
        const values = new Set(existing.split(",").map((v) => v.trim()).filter(Boolean))
        for (const host of loopbackHosts) values.add(host)
        process.env[key] = [...values].join(",")
      }
    }
  } catch {}
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`, // [pin]
      },
      body: JSON.stringify({ model, input: "test", encoding_format: "float" }),
      signal: AbortSignal.timeout(15000), // [pin]
    })
  } catch (caught) {
    // `catch` yields `unknown`. The Error arm needs no assertion at all; the
    // other arm is the one cast in this function, because the code below
    // deliberately interpolates WHATEVER was thrown (`e?.message || e`) rather
    // than stringifying it, and `unknown` can hold a primitive. The cast is
    // erased at runtime, so the value, the message and the control flow are
    // identical to the previous `e` — including the `✗ undefined` a thrown
    // primitive used to produce.
    const e = caught instanceof Error ? caught : (caught as ThrownLike)
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) { // [pin]
      throw new Error("Provider did not respond (timeout). Check your internet connection and the base URL.")
    }
    throw new Error(`Could not reach the provider: ${e?.message || e}. Check the base URL.`)
  }
  if (res.status === 429 || res.status >= 500) { // [pin]
    // Soft-pass: the provider accepted the request shape; failure is rate or
    // provider side, which Q1's backoff handles at index time.
    return { softPass: true, status: res.status, model, fingerprint: fingerprintKey(apiKey) }
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(mapValidationError(res.status, await res.text().catch(() => "")))
  }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new Error("Provider returned invalid JSON. The base URL must be a /v1 endpoint.")
  }
  const vec = firstEmbedding(data)
  if (!Array.isArray(vec) || vec.length === 0) { // [pin]
    throw new Error("Provider returned no embedding. Check the base URL and model name.")
  }
  return { softPass: false, status: res.status, model, dimension: vec.length, fingerprint: fingerprintKey(apiKey) }
}

export function fingerprintKey(key: string): string {
  return key && key.length >= 4 ? key.slice(-4) : "****"
}

// --- Config save (M30.S1) ----------------------------------------------------

// Writes ~/.bb/config.json with mode 0600. Preserves unrelated keys.
export function saveEmbeddingConfig(partial: ConfigFile, dataDir = bbDataDir()): string {
  const dir = dataDir
  mkdirSync(dir, { recursive: true })
  const cfgPath = path.join(dir, "config.json")
  const existing = readJson(cfgPath) || {}
  const merged = { ...existing, ...partial } // [pin]
  // 0600: the file holds an API key. Write via a temp file so a crash mid-
  // write never leaves a world-readable partial config.
  const tmp = cfgPath + ".tmp"
  writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { mode: 0o600 }) // [pin]
  renameSync(tmp, cfgPath)
  // [pin] the call below is pinned as `"  fixConfigMode(cfgPath)\n"` — the
  // trailing newline is part of what the gate matches, so no comment may follow.
  fixConfigMode(cfgPath)
  return cfgPath
}

// Existing configs may predate the 0600 rule; correct them on save.
export function fixConfigMode(cfgPath: string): boolean {
  try {
    const mode = statSync(cfgPath).mode & 0o777
    if (mode !== 0o600) { // [pin]
      chmodSync(cfgPath, 0o600)
      return true
    }
  } catch {}
  return false
}

// --- Interactive wizard (M30.S1) ---------------------------------------------

/**
 * Ask one question and resolve with the line read.
 *
 * Declared `Promise<string>` rather than left to inference. The untyped
 * `resolve` made the helper infer `Promise<unknown>`, which is what turned three
 * downstream `.trim()` calls into "Object is of type 'unknown'" — and, before
 * the types existed, into a real crash if readline ever resolved without a
 * string.
 */
function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise<string>((resolve) => rl.question(prompt, resolve))
}

/**
 * The TTY-only members `hiddenQuestion` touches.
 *
 * `NodeJS.ReadableStream` does not model `isTTY` / `isRaw` / `setRawMode` even
 * though a TTY stream has all three — a gap in @types/node, not a mistake here.
 * The guard below
 * (`stdin.isTTY && stdin.setRawMode`) already treats the stream as possibly not
 * a TTY, so this describes the TTY shape and every member is optional. Because
 * they are all optional, `NodeJS.ReadableStream` is assignable to this type with
 * no assertion at all.
 */
type RawCapableInput = NodeJS.ReadableStream & {
  isTTY?: boolean
  isRaw?: boolean
  setRawMode?: (mode: boolean) => void
}

/** The fields readline's `keypress` event supplies; only these are read. */
interface KeypressKey {
  name?: string
  ctrl?: boolean
  meta?: boolean
}

/**
 * Hidden input: read a line with muted output. Readline has no built-in mask;
 * we intercept the keypress stream and echo '*' instead of the character.
 *
 * Resolves the line, or `null` if the user pressed Ctrl-C.
 *
 * Takes the INPUT STREAM rather than the readline interface. `@types/node` v22
 * declares neither `input` nor `output` on `readline.Interface`, even though both
 * have existed on the runtime object since Node 0.x — so `rl.input` is a real
 * property the types do not model, and reaching for it means either an assertion
 * or nothing. The stream handed to `createInterface` IS stored on the interface
 * unchanged (`Interface` does `this.input = input`), so passing the same stream
 * in is the same object, from the caller's own typed field, with no assertion.
 */
function hiddenQuestion(input: NodeJS.ReadableStream, prompt: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const stdin: RawCapableInput = input
    const wasRaw: boolean = stdin.isRaw === true
    if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(true)
    process.stdout.write(prompt)
    let value = ""
    const onKeypress = (ch: string, key?: KeypressKey) => {
      if (key && key.name === "enter") {
        cleanup()
        process.stdout.write("\n")
        resolve(value)
        return
      }
      if (key && key.name === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1)
          process.stdout.write("\b \b")
        }
        return
      }
      if (key && key.ctrl && key.name === "c") {
        cleanup()
        process.stdout.write("\n")
        resolve(null)
        process.exit(130)
      }
      if (ch && !key?.ctrl && !key?.meta) {
        value += ch
        process.stdout.write("*")
      }
    }
    const { emitKeypressEvents } = readline
    emitKeypressEvents(stdin)
    stdin.on("keypress", onKeypress)
    function cleanup() {
      stdin.removeListener("keypress", onKeypress)
      if (stdin.isTTY && stdin.setRawMode) stdin.setRawMode(wasRaw)
    }
  })
}

/** The streams the wizard talks to. Injectable so the flow can be driven headless. */
export interface WizardIo {
  input: NodeJS.ReadableStream
  // `NodeJS.WritableStream`, not `{ write }`: that is what `readline.createInterface`
  // requires, so this states the real requirement rather than the one method the
  // wizard happens to call.
  output: NodeJS.WritableStream
}

/**
 * The wizard's three injection seams.
 *
 * These were a `deps = {}` default, which inferred the type `{}` and made every
 * read off it an error (TS2339) — the clearest symptom of the file's single
 * untyped cause. Declared, they also document what a caller may replace.
 *
 * NOTE for whoever wires a test double: the key for the save seam is `saveImpl`.
 * A double passed as `save` is silently ignored and the real
 * `saveEmbeddingConfig` runs. That is a real trap and is reported for master
 * rather than papered over here, because changing the accepted key would change
 * which mutants script/m30/verify-first-run-hook.ts catches.
 */
export interface WizardDeps {
  /** Replaces `fetch` in the pre-save probe. */
  fetchImpl?: typeof fetch
  /** Replaces the data directory the config is written to. */
  dataDir?: string
  /** Replaces `saveEmbeddingConfig`. */
  saveImpl?: (partial: ConfigFile, dataDir: string) => string
  /** Replaces `validateKey`. */
  validateImpl?: (baseURL: string, apiKey: string, model: string) => Promise<KeyValidationResult>
}

/** Every way the wizard can end, with the reason it ended. */
export type WizardOutcome =
  | { saved: false; skipped: true; reason: "invalid-choice" | "user-skipped" | "empty-base-url" | "empty-model" | "empty-key" | "provider-incomplete" }
  | { saved: false; skipped: true; reason: "validation-failed"; error: string }
  | { saved: true; provider: string; model: string; fingerprint: string; softPass: boolean }

export async function runSetupWizard(io: WizardIo = { input: process.stdin, output: process.stdout }, deps: WizardDeps = {}): Promise<WizardOutcome> {
  const out = io.output
  const rl = readline.createInterface({ input: io.input, output: io.output })
  const fetchImpl = deps.fetchImpl || fetch
  const dataDir = deps.dataDir || bbDataDir()
  const save = deps.saveImpl || saveEmbeddingConfig
  const validate = deps.validateImpl || validateKey

  out.write("\nbb — embedding setup\n")
  out.write("Semantic search (bb_search, bb_ask) works with embedding vectors.\n")
  out.write("Without a key: local word vectors are used — weaker results.\n")
  out.write("After adding a model, `bb index --force` is required to refresh the old index.\n\n")

  const providers = PROVIDERS
  out.write("Choose an embedding provider:\n")
  providers.forEach((p, i) => {
    out.write(`  ${i + 1}. ${p.label}\n`)
    if (p.baseURL) out.write(`     ${p.model} — ${p.keyHint}\n`)
    else out.write(`     ${p.keyHint}\n`)
  })
  out.write(`  ${providers.length + 1}. Skip — continue with local vectors\n\n`)

  const answer = (await question(rl, `Choice [1-${providers.length + 1}]: `)).trim()
  const choice = parseInt(answer, 10)

  if (!choice || choice < 1 || choice > providers.length + 1) {
    out.write("Invalid choice — setup skipped.\n")
    rl.close()
    return { saved: false, skipped: true, reason: "invalid-choice" }
  }

  if (choice === providers.length + 1) {
    out.write("Continuing with local word vectors. They give weaker results;\n")
    out.write("when you add a real model, refresh the index with `bb index --force`.\n")
    // Remember the explicit skip (M30.S1 follow-up): the wizard runs once.
    // Entering a key later via `bb setup` clears the marker automatically
    // (saveEmbeddingConfig merges, and a real config outranks the flag).
    save({ setup_skipped: true }, dataDir) // [pin]
    rl.close()
    return { saved: false, skipped: true, reason: "user-skipped" }
  }

  const provider = providers[choice - 1]
  let baseURL: string | null = provider.baseURL
  let model: string | null = provider.model

  if (provider.id === "custom") {
    const b = (await question(rl, "Base URL (e.g. https://api.openai.com/v1): ")).trim()
    if (!b) {
      out.write("Base URL is empty — setup skipped.\n")
      rl.close()
      return { saved: false, skipped: true, reason: "empty-base-url" }
    }
    baseURL = b
    const m = (await question(rl, "Model name (e.g. text-embedding-3-small): ")).trim()
    if (!m) {
      out.write("Model name is empty — setup skipped.\n")
      rl.close()
      return { saved: false, skipped: true, reason: "empty-model" }
    }
    model = m
  }

  // Non-null from here, by construction: the custom branch replaced both from
  // validated non-empty input, and every other catalogue entry has them
  // prefilled. Stated as a check rather than an assertion, because
  // `PROVIDERS` is a module constant a future entry could join without them —
  // and previously that would have reached `baseURL.replace(...)` as a TypeError.
  if (typeof baseURL !== "string" || typeof model !== "string") {
    out.write("Provider entry has no base URL or model — setup skipped.\n")
    rl.close()
    return { saved: false, skipped: true, reason: "provider-incomplete" }
  }

  const key = await hiddenQuestion(io.input, "API key (input hidden): ")
  rl.close()
  if (!key || !key.trim()) {
    out.write("Key is empty — setup skipped.\n")
    return { saved: false, skipped: true, reason: "empty-key" }
  }

  // Pre-save live probe (M30.S3): fail fast with the provider's own error
  // instead of poisoning the index with a dead key.
  out.write("Validating key…\n")
  let validation: KeyValidationResult
  try {
    validation = await validate(baseURL, key.trim(), model)
  } catch (caught) {
    // Same reasoning as validateKey's catch, minus the throw path: read the
    // message off whatever came out, and keep printing it in the template so a
    // thrown primitive still shows `undefined` exactly as before. A thrown
    // `null` used to crash here on `null.message`; it now prints `undefined`.
    const e: ThrownLike = caught instanceof Error ? caught : (typeof caught === "object" && caught !== null ? (caught as ThrownLike) : {})
    out.write(`✗ ${e.message}\n`)
    out.write("Key NOT saved. Fix the settings and try again with `bb setup`.\n")
    return { saved: false, skipped: true, reason: "validation-failed", error: String(e.message) }
  }

  save({
    embedding_base_url: baseURL,
    embedding_api_key: key.trim(),
    embedding_model: model,
  }, dataDir)

  if (validation.softPass) {
    out.write(`✓ Key saved (provider returned a rate limit — indexing retries automatically).\n`)
  } else {
    out.write(`✓ Key saved and validated (${model}, ${validation.dimension} dimensions).\n`)
  }
  out.write(`Saved to: ${path.join(dataDir, "config.json")} (only your account can read it)\n`)
  return {
    saved: true,
    provider: provider.id,
    model,
    fingerprint: validation.fingerprint,
    softPass: validation.softPass === true,
  }
}

// --- First-run hook (M30.S2) --------------------------------------------------

/** Options for the `bb index` first-run hook. */
export interface FirstRunOpts {
  /** `--no-setup`: never prompt, and never print the notice. */
  noSetup?: boolean
  /** Suppress the non-TTY notice line. */
  quiet?: boolean
}

/** Why the hook did or did not prompt. */
export type FirstRunOutcome =
  | { prompted: false; reason: "flag" | "configured" | "skipped" | "non-tty" }
  | ({ prompted: true } & WizardOutcome)

// Called from bb index. Interactive prompt ONLY when: no config anywhere AND
// stdin is a TTY AND --no-setup not passed. Non-TTY (CI, MCP hosts, piped
// stdin) must NEVER hang — one-line notice at most.
export async function maybeRunFirstRunSetup(opts: FirstRunOpts = {}): Promise<FirstRunOutcome> {
  if (opts.noSetup) return { prompted: false, reason: "flag" } // [pin]
  const state = hasEmbeddingConfig(process.cwd(), process.env)
  if (state.configured) return { prompted: false, reason: "configured" } // [pin]
  // Explicit skip is remembered: prompt only the first time.
  if (state.skipped) return { prompted: false, reason: "skipped" } // [pin]
  if (!process.stdin.isTTY) { // [pin]
    if (!opts.quiet) {
      console.log("note: no embedding key — semantic search will use local vectors (weaker). Setup: bb setup") // [pin]
    }
    return { prompted: false, reason: "non-tty" }
  }
  const result = await runSetupWizard()
  return { prompted: true, ...result }
}