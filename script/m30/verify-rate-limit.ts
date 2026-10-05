// script/m30/verify-rate-limit.ts — M30.Q1.
//
// Proves the rate-limit resilience of SemanticEngine.embedMany: a failed
// batch (429 or 5xx) degrades THAT batch to local word vectors and never
// permanently latches the run off the API; a 429 sets a bounded backoff
// window honoring Retry-After. Plants 4 mutants that must all be caught.
//
// Run: npx tsx script/m30/verify-rate-limit.ts
// Evidence: validation/m30/results/Q1.json (machine-emitted)

import { spawn, execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/brain/semantic/engine.ts")
const MUTANT_PATH = path.join(ROOT, "src/brain/semantic/.engine-q1-mutant.ts")
const EVIDENCE_PATH = path.join(ROOT, "validation/m30/results/Q1.json")

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

// ---------------------------------------------------------------------------
// Runner: prefer bun; fall back to node + tsx loader (house standard).
// ---------------------------------------------------------------------------

function runnerCommand(): { cmd: string; args: string[] } {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore", timeout: 10000 })
    return { cmd: "bun", args: ["run"] }
  } catch {
    const candidates: string[] = []
    for (const base of ["tsx", "tsx/dist/loader.mjs"]) {
      try {
        candidates.push(createRequire(import.meta.url).resolve(base, { paths: [ROOT] }))
      } catch {}
    }
    try {
      const npxRoot = path.join(os.homedir(), ".npm", "_npx")
      if (existsSync(npxRoot)) {
        for (const entry of readdirSync(npxRoot)) {
          candidates.push(path.join(npxRoot, entry, "node_modules", "tsx", "dist", "loader.mjs"))
        }
      }
    } catch {}
    try {
      const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim()
      candidates.push(path.join(npmRoot, "tsx", "dist", "loader.mjs"))
    } catch {}
    for (const cand of candidates) {
      try {
        statSync(cand)
        return { cmd: process.execPath, args: ["--import", cand] }
      } catch {}
    }
    console.error("VERIFIER ERROR: bun not found and tsx fallback not resolvable")
    process.exit(2)
  }
}
const RUNNER = runnerCommand()

type FixtureResult = { ok: boolean; stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }

async function runFixture(script: string, env: Record<string, string>, componentPath: string, timeoutMs = 30000): Promise<FixtureResult> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "m30-q1-"))
  const scriptPath = path.join(dir, "fixture.ts")
  const dataDir = path.join(dir, "bbdata")
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(scriptPath, script.replaceAll("__ENGINE__", JSON.stringify(componentPath)).replaceAll("__DATADIR__", JSON.stringify(dataDir)))
  const result = await new Promise<FixtureResult>((resolve) => {
    const child = spawn(RUNNER.cmd, [...RUNNER.args, scriptPath], {
      cwd: dir,
      env: {
        ...process.env,
        BB_DATA_DIR: dataDir,
        ...env,
        HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: "", https_proxy: "", ALL_PROXY: "", all_proxy: "",
        NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        child.kill("SIGKILL")
        finish(null, `timed out after ${timeoutMs}ms`, true)
      }
    }, timeoutMs)
    child.stdout?.on("data", (d) => (stdout += d))
    child.stderr?.on("data", (d) => (stderr += d))
    child.on("error", (e) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        finish(null, e.message, false)
      }
    })
    child.on("close", (code) => finish(code, "", false))
    function finish(code: number | null, errDetail: string, timedOut: boolean) {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({ ok: code === 0, stdout, stderr: errDetail ? `${errDetail}\n${stderr}` : stderr, exitCode: code, timedOut })
      }
    }
  })
  rmSync(dir, { recursive: true, force: true })
  return result
}

function fixtureJSON(res: FixtureResult): any[] {
  return res.stdout
    .split("\n")
    .filter((l) => l.startsWith("JSON:"))
    .map((l) => JSON.parse(l.slice(5)))
}

// ---------------------------------------------------------------------------
// Mock /embeddings server with programmable failure schedule
// ---------------------------------------------------------------------------

// Mode "storm": first call -> 429 Retry-After: 1, later calls -> 200.
// Mode "blip":  first call -> 500,              later calls -> 200.
// Mode "ok":    all calls -> 200.
async function withMockServer<T>(mode: "storm" | "blip" | "ok", fn: (base: string) => Promise<T>): Promise<{ calls: number; result: T }> {
  let calls = 0
  const server = createServer((req, res) => {
    if (req.url !== "/embeddings" || req.method !== "POST") {
      res.writeHead(404)
      return res.end("not found")
    }
    calls++
    let raw = ""
    req.on("data", (d) => (raw += d))
    req.on("end", () => {
      const body = JSON.parse(raw)
      const inputs = Array.isArray(body.input) ? body.input : [body.input]
      if (mode === "storm" && calls === 1) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" })
        return res.end(JSON.stringify({ error: "rate limited" }))
      }
      if (mode === "blip" && calls === 1) {
        res.writeHead(500, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ error: "provider down" }))
      }
      const data = {
        model: body.model,
        data: inputs.map((t: string) => ({ embedding: [0.25, 0.5, 0.75, 1.0], index: 0 })),
        usage: { total_tokens: inputs.length },
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify(data))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`
  let result!: T
  try {
    result = await fn(base)
  } finally {
    server.close()
  }
  return { calls, result }
}

// Fixture: drives embedMany through failure schedules and reports the model
// label + vector dimension at each step (API model 4-dim vs local vectors).
const FIXTURE = `
import { SemanticEngine } from __ENGINE__
const out = (v: unknown) => console.log("JSON:" + JSON.stringify(v))
async function main() {
  process.env.BB_EMBEDDING_BASE_URL = process.env.MOCK_BASE
  process.env.BB_EMBEDDING_API_KEY = "test-key"
  process.env.BB_EMBEDDING_MODEL = "mock-embed-4d"
  const mode = process.env.MOCK_MODE

  // Batch 1: first API call hits the failure schedule.
  const r1 = await SemanticEngine.embedMany(["alpha", "beta"])
  out({ step: "b1", model: SemanticEngine.getLastEmbeddingModel(), dim: r1[0]?.length ?? 0, count: r1.length })

  // Batch 2: immediate retry. Under "storm" this must NOT hit the API (backoff
  // window active) — local vectors. Under "blip" this MUST hit the API (no
  // latch) — API vectors.
  const r2 = await SemanticEngine.embedMany(["gamma"])
  out({ step: "b2", model: SemanticEngine.getLastEmbeddingModel(), dim: r2[0]?.length ?? 0, count: r2.length })

  if (mode === "storm") {
    // Wait past the Retry-After window (1s + <=500ms jitter + margin).
    await new Promise((r) => setTimeout(r, 2200))
    const r3 = await SemanticEngine.embedMany(["delta"])
    out({ step: "b3", model: SemanticEngine.getLastEmbeddingModel(), dim: r3[0]?.length ?? 0, count: r3.length })
  }
}
main()
`

// ---------------------------------------------------------------------------
// Positive checks
// ---------------------------------------------------------------------------

console.log("M30.Q1 rate-limit resilience verifier")
console.log(`  component: ${path.relative(ROOT, COMPONENT)}`)

// 1. 429 storm: batch 1 degrades to local; batch 2 respects the backoff
//    window (no API call); batch 3 (after window) is back on the API.
{
  const { calls, result: res } = await withMockServer("storm", async (base) => {
    return runFixture(FIXTURE, { MOCK_BASE: base, MOCK_MODE: "storm" }, COMPONENT)
  })
  check("Q1: storm fixture runs cleanly", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  const j = Object.fromEntries(fixtureJSON(res).map((o) => [o.step, o]))
  check("Q1: 429 batch falls back to local word vectors (batch degrades, run does not)", j.b1?.model === SemanticEngineLocalLabel() && j.b1?.count === 2, JSON.stringify(j.b1))
  check("Q1: immediate retry inside backoff window stays local (no API hammering)", j.b2?.model === SemanticEngineLocalLabel(), JSON.stringify(j.b2))
  check("Q1: after backoff window the API is used again (no permanent latch)", j.b3?.model === "mock-embed-4d" && j.b3?.dim === 4, JSON.stringify(j.b3))
  check("Q1: storm made exactly 2 API calls (b1 429 + b3 success; b2 skipped)", calls === 2, `calls=${calls}`)
}

// 2. Transient 5xx blip: batch 1 falls back locally; batch 2 retries the API
//    immediately (no latch) and succeeds.
{
  const { calls, result: res } = await withMockServer("blip", async (base) => {
    return runFixture(FIXTURE, { MOCK_BASE: base, MOCK_MODE: "blip" }, COMPONENT)
  })
  check("Q1: blip fixture runs cleanly", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  const j = Object.fromEntries(fixtureJSON(res).map((o) => [o.step, o]))
  check("Q1: 5xx batch falls back to local word vectors", j.b1?.model === SemanticEngineLocalLabel(), JSON.stringify(j.b1))
  check("Q1: next batch retries the API and succeeds (per-batch fallback, no latch)", j.b2?.model === "mock-embed-4d" && j.b2?.dim === 4, JSON.stringify(j.b2))
  check("Q1: blip made exactly 2 API calls (b1 500 + b2 success)", calls === 2, `calls=${calls}`)
}

// 3. Healthy path sanity: API used from the first batch.
{
  const { result: fixture } = await withMockServer("ok", async (base) => {
    return runFixture(FIXTURE, { MOCK_BASE: base, MOCK_MODE: "ok" }, COMPONENT)
  })
  check("Q1: healthy fixture runs cleanly", fixture?.ok === true && !fixture?.timedOut, fixture?.stderr.slice(0, 200))
  const j = Object.fromEntries(fixtureJSON(fixture!).map((o) => [o.step, o]))
  check("Q1: healthy first batch uses the API", j.b1?.model === "mock-embed-4d" && j.b1?.dim === 4, JSON.stringify(j.b1))
  check("Q1: healthy second batch stays on the API", j.b2?.model === "mock-embed-4d", JSON.stringify(j.b2))
}

// ---------------------------------------------------------------------------
// Mutants — each must be caught
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: (m: MutantProbe) => boolean }
type MutantProbe = {
  storm: Record<string, any>
  stormCalls: number
  blip: Record<string, any>
  blipCalls: number
}

const mutants: Mutant[] = [
  {
    name: "process-wide latch restored (any failure poisons the run)",
    mutate: (src) => src.replace(
      "if (e?.name === \"EmbeddingApiError\" && e?.status === 429) {",
      "if (true) {",
    ),
    // With a latch, the blip's batch-2 retry must NOT reach the API.
    probe: (m) => m.blip.b2?.model !== "mock-embed-4d",
  },
  {
    name: "429 backoff window removed (immediate retry hammers API)",
    mutate: (src) => src.replace(
      "if (Date.now() >= _apiRetryAt && isEmbeddingConfigured(config)) {",
      "if (isEmbeddingConfigured(config)) {",
    ),
    // Without the window, batch 2 hits the API -> 429 again -> local, but the
    // mock call count grows to 3 (b1, b2, b3) instead of 2.
    probe: (m) => m.stormCalls !== 2,
  },
  {
    name: "Retry-After ignored (fixed long backoff delays recovery)",
    mutate: (src) => src.replace(
      "const base = retryAfterSec && retryAfterSec > 0 ? retryAfterSec * 1000 : 5_000",
      "const base = 30_000",
    ),
    // A 30s fixed backoff is still active after 2.2s -> batch 3 stays local.
    probe: (m) => m.storm.b3?.model !== "mock-embed-4d",
  },
  {
    name: "per-batch fallback removed (failed batch returns empty)",
    mutate: (src) => src.replace(
      "log.debug(\"API embedding failed for this batch; next batch retries\", { error: e?.message?.slice(0, 60) })",
      "return []",
    ),
    // A failed batch must still produce local vectors (count 2, local label),
    // not an empty array that silently drops the documents.
    probe: (m) => m.blip.b1?.count !== 2 || m.blip.b1?.model !== SemanticEngineLocalLabel(),
  },
]

const mutantResults: { name: string; caught: boolean; detail: string }[] = []

for (const mut of mutants) {
  const src = readFileSync(COMPONENT, "utf8")
  const mutated = mut.mutate(src)
  if (mutated === src) {
    mutantResults.push({ name: mut.name, caught: false, detail: "mutation produced no change — fix mutant definition" })
    check(`mutant [${mut.name}] applied`, false, "no change")
    continue
  }
  writeFileSync(MUTANT_PATH, mutated)
  let probe: MutantProbe
  try {
    const stormMeta = await withMockServer("storm", async (base) => {
    const res = await runFixture(FIXTURE, { MOCK_BASE: base, MOCK_MODE: "storm" }, MUTANT_PATH)
    return fixtureJSON(res)
  })
  const blipMeta = await withMockServer("blip", async (base) => {
    const res = await runFixture(FIXTURE, { MOCK_BASE: base, MOCK_MODE: "blip" }, MUTANT_PATH)
    return fixtureJSON(res)
  })
  probe = {
    storm: Object.fromEntries((stormMeta.result as any[]).map((o) => [o.step, o])),
    stormCalls: stormMeta.calls,
    blip: Object.fromEntries((blipMeta.result as any[]).map((o) => [o.step, o])),
    blipCalls: blipMeta.calls,
  }
  } finally {
    if (existsSync(MUTANT_PATH)) rmSync(MUTANT_PATH, { force: true })
  }
  const caught = mut.probe(probe)
  mutantResults.push({ name: mut.name, caught, detail: caught ? "caught" : "survived" })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}

check("Q1: every planted defect was caught", mutantResults.every((m) => m.caught))

// ---------------------------------------------------------------------------
// Verdict + evidence
// ---------------------------------------------------------------------------

const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${mutants.length} mutants`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

let currentCommit = "unknown"
try {
  currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}
// `sha256sum` is GNU coreutils and is absent on macOS, where the equivalent is
// `shasum -a 256`. Calling it unconditionally made this verifier crash AFTER it
// had already printed its verdict, so a passing run still ended in a stack
// trace. Prefer whichever exists.
const sourceFingerprint = (() => {
  const opts = { cwd: ROOT, encoding: "utf8" as const }
  for (const [bin, args] of [
    ["sha256sum", [COMPONENT]],
    ["shasum", ["-a", "256", COMPONENT]],
  ] as const) {
    try {
      return execFileSync(bin, args as unknown as string[], opts).trim().split(/\s+/)[0]
    } catch {
      /* try the next one */
    }
  }
  throw new Error("no sha256 tool available (need sha256sum or shasum)")
})()

const result = {
  issue: "M30.Q1",
  code: "Q1",
  milestone: "M30",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutants.length,
  mutants: mutantResults,
  currentCommit,
  sourceFingerprint,
  verifierCommand: "npx tsx script/m30/verify-rate-limit.ts",
  evidenceFile: "Q1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Backoff timing is tested with a 2.2s sleep against Retry-After: 1; jitter (<=500ms) is bounded and the window math is declared (cap 30s).",
    "The verifier proves the quality cliff is fixed (batch degrades, run continues), not wall-clock index time; 429 storms still slow indexing by design.",
    "Local-word-vector fallback vectors are real but not asserted for semantic quality here; model-label separation is enforced by engine invariants tested elsewhere.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m30/results"), { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)

function SemanticEngineLocalLabel(): string {
  // Must track `LOCAL_MODEL_LABEL` in src/brain/semantic/engine.ts. It was
  // "local-word-vectors" and the engine bumped to "local-word-vectors-v3" during
  // branch consolidation, so this gate asserted a label nothing produces and
  // failed 3 checks against a correct implementation.
  return "local-word-vectors-v3"
}
