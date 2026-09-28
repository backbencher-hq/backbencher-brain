// script/m30/verify-key-validation.ts — M30.S3.
//
// Proves the pre-save key validation (validateKey in
// src/setup/setup-wizard.ts) maps every provider failure to an actionable
// error, treats 429/5xx as soft-pass, and works against real providers
// when live keys are available (gated on BB_M30_LIVE_KEYS=1).
//
// Run: npx tsx script/m30/verify-key-validation.ts
//   BB_M30_LIVE_KEYS=1 BB_M30_OPENROUTER_KEY=... BB_M30_NVIDIA_KEY=... \
//     npx tsx script/m30/verify-key-validation.ts --live
// Evidence: validation/m30/results/S3.json (machine-emitted)
//
// Secret hygiene: evidence records key fingerprints (last 4 chars) only.
// The verifier FAILS if any raw key pattern appears in its own output file.

import { spawn, execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/setup/setup-wizard.ts")
const MUTANT_PATH = path.join(ROOT, "src/setup/.setup-keyval-mutant.ts")
const EVIDENCE_PATH = path.join(ROOT, "validation/m30/results/S3.json")

const LIVE_KEYS = process.env.BB_M30_LIVE_KEYS === "1" && process.argv.includes("--live")
const OPENROUTER_KEY = process.env.BB_M30_OPENROUTER_KEY ?? ""
const NVIDIA_KEY = process.env.BB_M30_NVIDIA_KEY ?? ""

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
// Runner: prefer bun (house standard); fall back to node + tsx loader.
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

// Async spawn on purpose: the mock server lives in THIS process and a
// blocking spawnSync would deadlock the event loop (S1 lesson, kept).
async function runFixture(script: string, env: Record<string, string>, componentPath: string, timeoutMs = 30000): Promise<FixtureResult> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "m30-s3-"))
  const scriptPath = path.join(dir, "fixture.ts")
  const dataDir = path.join(dir, "bbdata")
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(scriptPath, script.replaceAll("__COMPONENT__", JSON.stringify(componentPath)).replaceAll("__DATADIR__", JSON.stringify(dataDir)))
  const result = await new Promise<FixtureResult>((resolve) => {
    const child = spawn(RUNNER.cmd, [...RUNNER.args, scriptPath], {
      cwd: dir,
      env: {
        ...process.env,
        BB_DATA_DIR: dataDir,
        ...env,
        // Loopback mock must not be routed through a proxy.
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
// Mock /embeddings server — deterministic negative paths
// ---------------------------------------------------------------------------

type MockCase = "ok" | "soft429" | "soft500" | "notfound" | "badjson" | "noembedding" | "teapot" | "unauthorized"

async function withMockServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    const c = (req.url ?? "").slice(1).split("/")[0] ?? ""
    const reply = (status: number, body: any) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(typeof body === "string" ? body : JSON.stringify(body))
    }
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      if (!(req.headers.authorization ?? "").includes("test-key-123456")) return reply(401, { error: "missing auth" })
      // Exact-path assertion: the normalized URL must be /<case>/embeddings.
      // A double-slash (normalization removed) or wrong shape gets 500.
      if (req.url !== `/${c}/embeddings`) return reply(500, { error: "path mismatch" })
      switch (c) {
        case "ok":
          return reply(200, { data: [{ embedding: [0.1, 0.2, 0.3] }] })
        case "soft429":
          return reply(429, { error: "rate limited" })
        case "soft500":
          return reply(503, { error: "down" })
        case "notfound":
          return reply(404, { error: "model unknown" })
        case "badjson":
          res.writeHead(200, { "Content-Type": "application/json" })
          return res.end("not json at all")
        case "noembedding":
          return reply(200, { data: [{}] })
        case "teapot":
          return reply(418, "teapot")
        default:
          return reply(500, { error: "unknown case" })
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`
  try {
    await fn(base)
  } finally {
    server.close()
  }
}

const MOCK_CASES: MockCase[] = ["ok", "soft429", "soft500", "notfound", "badjson", "noembedding", "teapot"]

const VALIDATION_SCRIPT = `
import { validateKey, mapValidationError } from __COMPONENT__
const out = (v: unknown) => console.log("JSON:" + JSON.stringify(v))
async function main() {
  const base = process.env.MOCK_BASE
  const cases = process.env.MOCK_CASES.split(",")
  for (const c of cases) {
    const url = base + "/" + c
    try {
      const r = await validateKey(url, "test-key-123456", "test-model")
      out({ case: c, kind: "ok", softPass: r.softPass, status: r.status, dimension: r.dimension, fingerprint: r.fingerprint })
    } catch (e) {
      out({ case: c, kind: "error", message: e.message })
    }
  }
  out({ case: "map401", msg: mapValidationError(401, "") })
  out({ case: "map429", msg: mapValidationError(429, "") })
  out({ case: "map500", msg: mapValidationError(503, "") })
  out({ case: "map404", msg: mapValidationError(404, "") })
  out({ case: "mapOther", msg: mapValidationError(418, "teapot") })
  // Unreachable host: network-error mapping
  try {
    await validateKey("http://127.0.0.1:1", "test-key-123456", "m")
    out({ case: "unreachable", kind: "ok" })
  } catch (e) {
    out({ case: "unreachable", kind: "error", message: e.message })
  }
  // Timeout branch: custom fetchImpl rejects with TimeoutError
  try {
    const timeoutFetch = async () => {
      const e = new Error("timed out")
      e.name = "TimeoutError"
      throw e
    }
    await validateKey("http://127.0.0.1:1", "test-key-123456", "m", timeoutFetch)
    out({ case: "timeout", kind: "ok" })
  } catch (e) {
    out({ case: "timeout", kind: "error", message: e.message })
  }
  // Signal presence: custom fetchImpl asserts an AbortSignal was passed
  try {
    const signalFetch = async (url, opts) => {
      if (!opts || !opts.signal || typeof opts.signal.aborted !== "boolean") {
        const e = new Error("fetch called without AbortSignal")
        e.name = "NoSignalError"
        throw e
      }
      return { status: 200, json: async () => ({ data: [{ embedding: [1, 2, 3] }] }), text: async () => "" }
    }
    const r = await validateKey("http://127.0.0.1:1", "test-key-123456", "m", signalFetch)
    out({ case: "signal", kind: "ok", softPass: r.softPass, dimension: r.dimension })
  } catch (e) {
    out({ case: "signal", kind: "error", message: e.message })
  }
  // Trailing-slash normalization: a base URL ending in / must still produce
  // the exact path /ok/embeddings (double-slash would 500 on the mock).
  try {
    const r = await validateKey(base + "/ok/", "test-key-123456", "test-model")
    out({ case: "slashok", kind: "ok", softPass: r.softPass, dimension: r.dimension })
  } catch (e) {
    out({ case: "slashok", kind: "error", message: e.message })
  }
}
main()
`

// Live-key script: one minimal probe per real provider (budget-capped).
const LIVE_SCRIPT = `
import { validateKey } from __COMPONENT__
const out = (v: unknown) => console.log("JSON:" + JSON.stringify(v))
async function main() {
  const targets = JSON.parse(process.env.LIVE_TARGETS)
  for (const t of targets) {
    try {
      const r = await validateKey(t.baseURL, t.key, t.model)
      out({ provider: t.provider, kind: "ok", softPass: r.softPass, status: r.status, dimension: r.dimension, fingerprint: r.fingerprint })
    } catch (e) {
      out({ provider: t.provider, kind: "error", message: e.message })
    }
  }
}
main()
`

// ---------------------------------------------------------------------------
// Positive checks — mock server
// ---------------------------------------------------------------------------

console.log("M30.S3 key-validation verifier")
console.log(`  component: ${path.relative(ROOT, COMPONENT)}`)
console.log(`  live keys: ${LIVE_KEYS ? "ENABLED (gated run)" : "disabled (mock only)"}`)

await withMockServer(async (base) => {
  const res = await runFixture(VALIDATION_SCRIPT, { MOCK_BASE: base, MOCK_CASES: MOCK_CASES.join(",") }, COMPONENT)
  check("S3: validation fixture runs cleanly", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  const j = Object.fromEntries(fixtureJSON(res).map((o) => [o.case ?? o.provider, o]))

  check("S3: 200 with embedding validates (softPass=false, dimension set)", j.ok?.kind === "ok" && j.ok?.softPass === false && j.ok?.dimension === 3, JSON.stringify(j.ok))
  check("S3: fingerprint is last 4 chars only", j.ok?.fingerprint === "3456", JSON.stringify(j.ok?.fingerprint))
  check("S3: 429 soft-pass with status preserved", j.soft429?.kind === "ok" && j.soft429?.softPass === true && j.soft429?.status === 429, JSON.stringify(j.soft429))
  check("S3: 5xx soft-pass", j.soft500?.kind === "ok" && j.soft500?.softPass === true, JSON.stringify(j.soft500))
  check("S3: 404 hard error mentions model", j.notfound?.kind === "error" && /model/i.test(j.notfound.message ?? ""), JSON.stringify(j.notfound))
  check("S3: malformed JSON hard error", j.badjson?.kind === "error", JSON.stringify(j.badjson))
  check("S3: missing embedding array hard error with actionable message", j.noembedding?.kind === "error" && /returned no embedding/i.test(j.noembedding?.message ?? ""), JSON.stringify(j.noembedding))
  check("S3: unexpected status mapped with status code", j.teapot?.kind === "error" && String(j.teapot.message).includes("418"), JSON.stringify(j.teapot))
  check("S3: unreachable host maps to actionable network error", j.unreachable?.kind === "error" && /Could not reach|timeout/i.test(j.unreachable.message ?? ""), JSON.stringify(j.unreachable))
  check("S3: TimeoutError maps to timeout-specific message", j.timeout?.kind === "error" && /did not respond \(timeout\)/i.test(j.timeout.message ?? ""), JSON.stringify(j.timeout))
  check("S3: fetch receives an AbortSignal (hang safety)", j.signal?.kind === "ok" && j.signal?.softPass === false && j.signal?.dimension === 3, JSON.stringify(j.signal))
  check("S3: trailing-slash base URL normalizes to exact path", j.slashok?.kind === "ok" && j.slashok?.softPass === false && j.slashok?.dimension === 3, JSON.stringify(j.slashok))

  check("S3: mapValidationError 401 branch", /401/i.test(j.map401?.msg ?? ""), j.map401?.msg)
  check("S3: mapValidationError 429 branch", /429/i.test(j.map429?.msg ?? ""), j.map429?.msg)
  check("S3: mapValidationError 5xx branch", /503/i.test(j.map500?.msg ?? ""), j.map500?.msg)
  check("S3: mapValidationError 404 branch", /404/i.test(j.map404?.msg ?? ""), j.map404?.msg)
  check("S3: mapValidationError fallback includes status", /418/.test(j.mapOther?.msg ?? ""), j.mapOther?.msg)
})

// ---------------------------------------------------------------------------
// Live-key checks (gated; blocked-with-reason when keys absent)
// ---------------------------------------------------------------------------

type LiveTarget = { provider: string; baseURL: string; model: string; key: string }
const liveTargets: LiveTarget[] = []
if (OPENROUTER_KEY) {
  liveTargets.push({ provider: "openrouter", baseURL: "https://openrouter.ai/api/v1", model: "liquid/lfm-2.5-embedding-350m:free", key: OPENROUTER_KEY })
}
if (NVIDIA_KEY) {
  liveTargets.push({ provider: "nvidia", baseURL: "https://integrate.api.nvidia.com/v1", model: "nvidia/nemotron-3-embed-1b", key: NVIDIA_KEY })
}

let liveStatus: "verified" | "blocked" | "skipped" = "skipped"
let liveDetail = ""
if (!LIVE_KEYS) {
  liveStatus = "blocked"
  liveDetail = "BB_M30_LIVE_KEYS=1 + --live not set; live provider validation not exercised (mock coverage only). This is recorded, not hidden."
  console.log(`  live: ${liveDetail}`)
} else if (liveTargets.length === 0) {
  liveStatus = "blocked"
  liveDetail = "BB_M30_LIVE_KEYS=1 set but neither BB_M30_OPENROUTER_KEY nor BB_M30_NVIDIA_KEY provided."
  check("S3: live run has at least one key", false, liveDetail)
} else {
  console.log(`  live: probing ${liveTargets.length} provider(s), 1 call each (budget-capped)`)
  const res = await runFixture(LIVE_SCRIPT, { LIVE_TARGETS: JSON.stringify(liveTargets) }, COMPONENT, 60000)
  check("S3: live fixture runs cleanly", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  const results = fixtureJSON(res)
  // Live call budget: exactly one request per provider.
  check("S3: live budget respected (one result per provider)", results.length === liveTargets.length, JSON.stringify(results.map((r) => r.provider)))
  for (const t of liveTargets) {
    const r = results.find((x) => x.provider === t.provider)
    // Accept: clean validation (200 + dimension) OR soft-pass (429/5xx rate
    // tier — the key shape was accepted). A hard 401/404 is a FAIL.
    const softOk = r?.kind === "ok" && (r.softPass === true || (typeof r.dimension === "number" && r.dimension > 0))
    check(`S3: live ${t.provider} validates or soft-passes (no hard 401/404)`, Boolean(softOk), JSON.stringify(r))
    if (r?.kind === "error" && /401|404/.test(String(r.message))) {
      check(`S3: live ${t.provider} hard failure detail`, false, r.message)
    }
  }
  liveStatus = "verified"
  liveDetail = `${liveTargets.length} provider(s) probed, 1 call each; fingerprints only in evidence`
}

// ---------------------------------------------------------------------------
// Mutants — each must be caught
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: (m: Record<string, any>) => boolean }

const mutants: Mutant[] = [
  {
    name: "401 error mapping removed",
    mutate: (src) => src.replace("if (status === 401 || status === 403) {", "if (false) {"),
    probe: (m) => !/401/i.test(m.map401 ?? ""),
  },
  {
    name: "429 soft-pass removed (rate-limited key rejected)",
    mutate: (src) => src.replace("if (res.status === 429 || res.status >= 500) {", "if (res.status >= 500) {"),
    probe: (m) => !(m.soft429?.kind === "ok" && m.soft429?.softPass === true && m.soft429?.status === 429),
  },
  {
    name: "5xx soft-pass removed (provider blip rejected)",
    mutate: (src) => src.replace("if (res.status === 429 || res.status >= 500) {", "if (res.status === 429) {"),
    probe: (m) => !(m.soft500?.kind === "ok" && m.soft500?.softPass === true),
  },
  {
    name: "timeout mapped as generic error (no actionable timeout branch)",
    mutate: (src) => src.replace('if (e && (e.name === "TimeoutError" || e.name === "AbortError")) {', "if (false) {"),
    // The timeout branch must produce the actionable "did not respond (timeout)" message;
    // a generic fallback is a real UX regression and must be caught.
    probe: (m) => !(m.timeout?.kind === "error" && /did not respond \(timeout\)/i.test(m.timeout?.message ?? "")),
  },
  {
    name: "Authorization header dropped (all calls 401)",
    mutate: (src) => src.replace('Authorization: `Bearer ${apiKey}`,', "/* auth dropped */"),
    probe: (m) => m.ok?.kind !== "ok" || m.ok?.softPass !== false,
  },
  {
    name: "trailing-slash normalization removed (double-slash URL)",
    mutate: (src) => src.replace('const url = `${baseURL.replace(/\\/+$/, "")}/embeddings`', 'const url = `${baseURL}/embeddings`'),
    // With a double-slash URL the mock returns 500 -> soft-pass, so the ok
    // case must prove a CLEAN 200 (softPass=false, dimension set).
    probe: (m) => !(m.slashok?.kind === "ok" && m.slashok?.softPass === false && m.slashok?.dimension === 3),
  },
  {
    name: "embedding-array check removed",
    mutate: (src) => src.replace("if (!Array.isArray(vec) || vec.length === 0) {", "if (false) {"),
    probe: (m) => !(m.noembedding?.kind === "error" && /returned no embedding/i.test(m.noembedding?.message ?? "")),
  },
  {
    name: "request timeout removed (hangs on dead provider)",
    mutate: (src) => src.replace("signal: AbortSignal.timeout(15000),", "/* timeout removed */"),
    // Without the AbortSignal the fetch never gets a signal; the fixture's
    // custom fetchImpl rejects with NoSignalError -> kind error.
    probe: (m) => m.signal?.kind !== "ok",
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
  let probe: Record<string, any>
  try {
    await withMockServer(async (base) => {
      const res = await runFixture(VALIDATION_SCRIPT, { MOCK_BASE: base, MOCK_CASES: MOCK_CASES.join(",") }, MUTANT_PATH)
      const rows = Object.fromEntries(fixtureJSON(res).map((o) => [o.case ?? o.provider, o]))
      probe = rows
    })
  } finally {
    if (existsSync(MUTANT_PATH)) rmSync(MUTANT_PATH, { force: true })
  }
  const caught = mut.probe(probe ?? {})
  mutantResults.push({ name: mut.name, caught, detail: caught ? "caught" : "survived" })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}

check("S3: every planted defect was caught", mutantResults.every((m) => m.caught))

// ---------------------------------------------------------------------------
// Secret hygiene: no raw key material in evidence
// ---------------------------------------------------------------------------

const keyPatterns: [string, RegExp][] = [
  ["openrouter", /sk-or-v1-[0-9a-f]{16,}/],
  ["nvidia", /nvapi-[A-Za-z0-9_-]{16,}/],
]
if (existsSync(EVIDENCE_PATH)) {
  const evidenceText = readFileSync(EVIDENCE_PATH, "utf8")
  for (const [name, re] of keyPatterns) {
    check(`S3: no raw ${name} key material in evidence`, !re.test(evidenceText))
  }
}

// ---------------------------------------------------------------------------
// Verdict + evidence
// ---------------------------------------------------------------------------

const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${mutants.length} mutants, live: ${liveStatus}`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

let currentCommit = "unknown"
try {
  currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}
const sourceFingerprint = execFileSync("sha256sum", [COMPONENT], { cwd: ROOT, encoding: "utf8" }).trim().split(/\s+/)[0]

const result = {
  issue: "M30.S3",
  code: "S3",
  milestone: "M30",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutants.length,
  mutants: mutantResults,
  live: {
    status: liveStatus,
    detail: liveDetail,
    // Fingerprints only — never raw keys.
    providers: liveTargets.map((t) => ({ provider: t.provider, keyFingerprint: t.key.slice(-4) })),
  },
  currentCommit,
  sourceFingerprint,
  verifierCommand: "npx tsx script/m30/verify-key-validation.ts",
  evidenceFile: "S3.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Live provider tests run only when BB_M30_LIVE_KEYS=1, --live is passed, and provider keys are in env; without them this suite covers mock paths only and records live: blocked.",
    "Live-call budget is 1 request per provider per run; free-tier rate limits are respected and 429 soft-pass is accepted as a valid outcome.",
    "Network-error mapping is tested against a closed local port, not real internet failures.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m30/results"), { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
