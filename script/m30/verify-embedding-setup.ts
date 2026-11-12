// script/m30/verify-embedding-setup.ts — M30 embedding setup v2.
//
// Deterministic verifier for the key-first setup flow
// (src/setup/embedding-setup.ts). No network and no real terminal: the model
// listing and the /embeddings probe are injected, and the prompt streams are
// in-memory. The checks cover the defects that made the legacy wizard loop:
//   - provider detection from the key prefix
//   - embedding-model filtering (there is no capability flag; the name filter is
//     a hint and the live probe is the proof)
//   - the model menu + manual model id
//   - validation failure keeps the user in the menu (r/m/k/s)
//   - skip marker + reset preserving unrelated config
//   - hidden input never writes the key to the output buffer
//
// Run: npx tsx script/m30/verify-embedding-setup.ts

import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  detectProviderFromKey,
  isEmbeddingModelId,
  listEmbeddingModels,
  maybeRunEmbeddingSetup,
  readHidden,
  readLine,
  resetEmbeddingConfig,
  runEmbeddingWizard,
  saveEmbeddingSelection,
  saveSetupSkipped,
  type ModelListing,
  type SetupInput,
} from "../../src/setup/embedding-setup"

let checks = 0
let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    failures.push(label + (detail ? ` — ${detail}` : ""))
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function section(name: string): void {
  console.log(`\n${name}`)
}

// --- in-memory streams -------------------------------------------------------

class FakeInput implements SetupInput {
  isTTY = false
  isRaw = false
  private listeners = new Set<(chunk: Buffer) => void>()
  setRawMode(mode: boolean): void {
    this.isRaw = mode
  }
  on(_event: string, listener: (...args: any[]) => void): this {
    this.listeners.add(listener as (chunk: Buffer) => void)
    return this
  }
  removeListener(_event: string, listener: (...args: any[]) => void): this {
    this.listeners.delete(listener as (chunk: Buffer) => void)
    return this
  }
  pause(): this {
    return this
  }
  resume(): this {
    return this
  }
  push(text: string): void {
    const chunk = Buffer.from(text)
    for (const listener of [...this.listeners]) listener(chunk)
  }
}

class Capture {
  out = ""
  write(chunk: string): boolean {
    this.out += chunk
    return true
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function waitForText(capture: Capture, needle: string, from: number, timeoutMs = 4000): Promise<number> {
  const started = Date.now()
  return new Promise<number>((resolve, reject) => {
    const tick = (): void => {
      const index = capture.out.indexOf(needle, from)
      if (index >= 0) return resolve(index + needle.length)
      if (Date.now() - started > timeoutMs) {
        return reject(new Error(`timed out waiting for ${JSON.stringify(needle)}; output:\n${capture.out.slice(-800)}`))
      }
      setTimeout(tick, 5)
    }
    tick()
  })
}

/** Feed the scripted answers only after their prompt appears. */
async function drive(input: FakeInput, capture: Capture, steps: Array<{ when: string; send: string }>): Promise<void> {
  let cursor = 0
  for (const step of steps) {
    cursor = await waitForText(capture, step.when, cursor)
    await sleep(2)
    input.push(step.send)
  }
}

function tempDataDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bb-setup-v2-"))
  mkdirSync(dir, { recursive: true })
  return dir
}

function configOf(dataDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(dataDir, "config.json"), "utf8")) as Record<string, unknown>
}

const OK_VALIDATION = {
  softPass: false,
  status: 200,
  model: "ignored",
  dimension: 1024,
  fingerprint: "key1",
}

function listing(models: string[], listed = Math.max(models.length, 0)): Promise<ModelListing> {
  return Promise.resolve({ models, listed })
}

async function main(): Promise<void> {
  section("M30 embedding setup v2 verifier")

  section('provider detection')
  // --- provider detection ----------------------------------------------------
  check(
    "detects NVIDIA NIM from nvapi- keys",
    detectProviderFromKey("nvapi-abc123")?.id === "nvidia-nim",
    JSON.stringify(detectProviderFromKey("nvapi-abc123")),
  )
  check(
    "detects OpenRouter before the generic sk- family",
    detectProviderFromKey("sk-or-v1-abc123")?.id === "openrouter",
    JSON.stringify(detectProviderFromKey("sk-or-v1-abc123")),
  )
  check("detects OpenAI from sk-proj- keys", detectProviderFromKey("sk-proj-abc123")?.id === "openai")
  check("detects Gemini from AIza keys", detectProviderFromKey("AIzaSyABC123")?.id === "google")
  check("unknown key prefix is not guessed", detectProviderFromKey("gsk_abc123") === null)
  check(
    "OpenRouter carries the no-embedding-models note",
    (detectProviderFromKey("sk-or-v1-abc")?.note ?? "").includes("no embedding models"),
  )

  section('model heuristic')
  // --- model name heuristic --------------------------------------------------
  for (const id of ["nvidia/nemotron-3-embed-1b", "text-embedding-3-small", "BAAI/bge-m3", "gte-large", "voyage-3", "jina-embeddings-v3"]) {
    check(`embedding model accepted: ${id}`, isEmbeddingModelId(id))
  }
  for (const id of ["meta/llama-3.1-70b-instruct", "gpt-4o", "dall-e-3", "claude-sonnet-4.5"]) {
    check(`chat model rejected: ${id}`, !isEmbeddingModelId(id))
  }

  section('model listing')
  // --- /models listing -------------------------------------------------------
  {
    const calls: Array<{ url: string; auth: string | null }> = []
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url: String(url), auth: headers.authorization ?? headers.Authorization ?? null })
      return new Response(
        JSON.stringify({ data: [{ id: "nvidia/nemotron-3-embed-1b" }, { id: "meta/llama-3.1-70b" }, { id: "BAAI/bge-m3" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch
    const result = await listEmbeddingModels({ baseURL: "https://example.test/v1", apiKey: "nvapi-x", fetchImpl: fetchMock })
    check("listing keeps only embedding-named models", result.models.length === 2 && result.models.includes("BAAI/bge-m3"), JSON.stringify(result))
    check("listing reports the total returned", result.listed === 3, JSON.stringify(result))
    check("listing sends the bearer key", calls[0]?.auth === "Bearer nvapi-x", JSON.stringify(calls[0]))
  }
  {
    let calls = 0
    const fetchMock = (async () => {
      calls++
      if (calls === 1) return new Response("unauthorized", { status: 401 })
      return new Response(JSON.stringify({ data: [{ id: "nvidia/nemotron-3-embed-1b" }] }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await listEmbeddingModels({ baseURL: "https://example.test/v1", apiKey: "bad", fetchImpl: fetchMock })
    check("401 from /models retries once without auth to still show the catalogue", calls === 2 && result.models.length === 1, JSON.stringify({ calls, result }))
  }
  {
    const fetchMock = (async () => {
      throw new Error("connect ECONNREFUSED")
    }) as unknown as typeof fetch
    const result = await listEmbeddingModels({ baseURL: "https://example.test/v1", apiKey: "x", fetchImpl: fetchMock })
    check("unreachable /models reports an error instead of throwing", result.error?.includes("ECONNREFUSED") === true && result.models.length === 0)
  }

  section('hidden input')
  // --- hidden input ----------------------------------------------------------
  {
    const input = new FakeInput()
    const capture = new Capture()
    const resultP = readHidden(input, capture, "key: ")
    input.push("secret-key\r")
    const value = await resultP
    check("hidden input returns the typed value", value === "secret-key", String(value))
    check("hidden input never writes the key to the output", !capture.out.includes("secret-key"), capture.out)
    check("hidden input masks each character exactly once", (capture.out.match(/\*/g) ?? []).length === "secret-key".length, capture.out)
    check("hidden input restores raw mode", input.isRaw === false)
  }
  {
    const input = new FakeInput()
    const capture = new Capture()
    const resultP = readHidden(input, capture, "key: ")
    input.push("\u0003")
    check("Ctrl+C in hidden input resolves null", (await resultP) === null)
  }
  {
    const input = new FakeInput()
    const capture = new Capture()
    const resultP = readLine(input, capture, "name: ")
    input.push("hello\r")
    check("line input returns the line", (await resultP) === "hello")
  }

  section('wizard menu')
  // --- wizard: NVIDIA menu, choose the first model ---------------------------
  {
    const dataDir = tempDataDir()
    const input = new FakeInput()
    const capture = new Capture()
    const resultP = runEmbeddingWizard(
      { input, output: capture },
      {
        dataDir,
        listImpl: () => listing(["nvidia/nemotron-3-embed-1b", "nvidia/nemotron-3.5-embed-8b"], 9),
        validateImpl: async () => ({ ...OK_VALIDATION }),
      },
    )
    await drive(input, capture, [
      { when: "API key (hidden", send: "nvapi-SECRETVALUE\n" },
      { when: "Choice [1-2/m/s]", send: "1\n" },
    ])
    const result = await resultP
    check("wizard saves the chosen model", result.saved === true && result.model === "nvidia/nemotron-3-embed-1b", JSON.stringify(result))
    check("wizard writes the config file", configOf(dataDir).embedding_model === "nvidia/nemotron-3-embed-1b", JSON.stringify(configOf(dataDir)))
    check("wizard config is 0600", process.platform === "win32" || (statSync(path.join(dataDir, "config.json")).mode & 0o777) === 0o600)
    check("wizard shows both listed models", capture.out.includes("nvidia/nemotron-3.5-embed-8b") && capture.out.includes("nvidia/nemotron-3-embed-1b"))
    check(
      "wizard tells the user how to change/reset later",
      capture.out.includes("bb setup") && capture.out.includes("bb setup reset") && capture.out.includes("re-embed automatically"),
    )
    check("wizard never prints the key", !capture.out.includes("SECRETVALUE"), capture.out.slice(-400))
    rmSync(dataDir, { recursive: true, force: true })
  }

  section('wizard manual')
  // --- wizard: no models listed -> manual model id ---------------------------
  {
    const dataDir = tempDataDir()
    const input = new FakeInput()
    const capture = new Capture()
    const resultP = runEmbeddingWizard(
      { input, output: capture },
      {
        dataDir,
        listImpl: () => Promise.resolve({ models: [], listed: 5 }),
        validateImpl: async () => ({ ...OK_VALIDATION }),
      },
    )
    await drive(input, capture, [
      { when: "API key (hidden", send: "nvapi-SECRETVALUE\n" },
      { when: "Model id (Enter to skip)", send: "acme/embed-large\n" },
    ])
    const result = await resultP
    check("manual model id is accepted and saved", result.saved === true && result.model === "acme/embed-large", JSON.stringify(result))
    check("empty list states that no embedding-named models were listed", capture.out.includes("no embedding-named models listed"))
    rmSync(dataDir, { recursive: true, force: true })
  }

  section('wizard retry')
  // --- wizard: validation failure keeps the menu and retries ----------------
  {
    const dataDir = tempDataDir()
    const input = new FakeInput()
    const capture = new Capture()
    let attempts = 0
    const resultP = runEmbeddingWizard(
      { input, output: capture },
      {
        dataDir,
        listImpl: () => listing(["nvidia/nemotron-3-embed-1b"]),
        validateImpl: async () => {
          attempts++
          if (attempts === 1) throw new Error("Model not found (404). Check the model name.")
          return { ...OK_VALIDATION }
        },
      },
    )
    await drive(input, capture, [
      { when: "API key (hidden", send: "nvapi-SECRETVALUE\n" },
      { when: "Choice [1-1/m/s]", send: "1\n" },
      { when: "r) retry", send: "r\n" },
    ])
    const result = await resultP
    check("validation failure is shown with the provider error", capture.out.includes("✗ Model not found (404)"), capture.out.slice(-500))
    check("retry after a failed probe saves on success", result.saved === true && attempts === 2, JSON.stringify({ result, attempts }))
    rmSync(dataDir, { recursive: true, force: true })
  }

  section('wizard skip')
  // --- wizard: skip persists ------------------------------------------------
  {
    const dataDir = tempDataDir()
    const input = new FakeInput()
    const capture = new Capture()
    const resultP = runEmbeddingWizard({ input, output: capture }, { dataDir, listImpl: () => listing([]) })
    await drive(input, capture, [{ when: "API key (hidden", send: "\n" }])
    const result = await resultP
    check("empty key is an explicit skip", result.saved === false && result.skipped === true)
    check("skip is persisted", configOf(dataDir).setup_skipped === true, JSON.stringify(configOf(dataDir)))
    check("skip tells the user how to add it later", capture.out.includes("bb setup") && capture.out.includes("bb setup reset"))
    rmSync(dataDir, { recursive: true, force: true })
  }

  section('save + reset')
  // --- save + reset ---------------------------------------------------------
  {
    const dataDir = tempDataDir()
    saveSetupSkipped(dataDir)
    saveEmbeddingSelection({ baseURL: "https://example.test/v1", apiKey: "sk-test", model: "acme/embed" }, dataDir)
    check("saving clears the skip marker", !("setup_skipped" in configOf(dataDir)), JSON.stringify(configOf(dataDir)))
    // unrelated key survives a reset
    const config = configOf(dataDir)
    config.some_other_setting = "keep-me"
    writeFileSync(path.join(dataDir, "config.json"), JSON.stringify(config, null, 2))
    const reset = resetEmbeddingConfig(dataDir)
    check("reset removes the embedding keys", reset.removed.sort().join(",") === "embedding_api_key,embedding_base_url,embedding_model", JSON.stringify(reset))
    check("reset keeps unrelated config", configOf(dataDir).some_other_setting === "keep-me", JSON.stringify(configOf(dataDir)))
    check("reset result points at the config path", reset.path === path.join(dataDir, "config.json"))
    rmSync(dataDir, { recursive: true, force: true })
  }

  section('hook flags')
  // --- hook flags -----------------------------------------------------------
  {
    const flag = await maybeRunEmbeddingSetup({ noSetup: true })
    check("--no-setup reports flag", flag.prompted === false && flag.reason === "flag", JSON.stringify(flag))
    const prevBase = process.env.BB_EMBEDDING_BASE_URL
    const prevModel = process.env.BB_EMBEDDING_MODEL
    process.env.BB_EMBEDDING_BASE_URL = "https://example.test/v1"
    process.env.BB_EMBEDDING_MODEL = "acme/embed"
    const configured = await maybeRunEmbeddingSetup({ quiet: true })
    check("configured env skips the wizard", configured.prompted === false && configured.reason === "configured", JSON.stringify(configured))
    if (prevBase === undefined) delete process.env.BB_EMBEDDING_BASE_URL
    else process.env.BB_EMBEDDING_BASE_URL = prevBase
    if (prevModel === undefined) delete process.env.BB_EMBEDDING_MODEL
    else process.env.BB_EMBEDDING_MODEL = prevModel
  }

  console.log(`\nchecks: ${passed}/${checks} passed`)
  if (failed > 0) {
    console.log(`FAIL: ${failed} check(s) failed`)
    for (const failure of failures) console.log(`  - ${failure}`)
    process.exit(1)
  }
  console.log("VERDICT: PASS")
}

await main()
