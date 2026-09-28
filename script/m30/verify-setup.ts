// script/m30/verify-setup.ts — M30.S1 (+ S2 hang regression, S3 mock paths).
//
// Proves the setup wizard (src/setup/setup-wizard.ts) is correct against
// fixtures, and proves the suite CAN FAIL by planting defects and asserting
// each one is caught.
//
// Run: npx tsx script/m30/verify-setup.ts
// Evidence: validation/m30/results/S1.json (machine-emitted)

import { spawn, execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/setup/setup-wizard.ts")
const MUTANT_PATH = path.join(ROOT, "src/setup/.setup-mutant.ts")
const EVIDENCE_PATH = path.join(ROOT, "validation/m30/results/S1.json")

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
// Fixture runner: executes the real component (or a mutant) in a child bun
// process with an isolated BB_DATA_DIR, so precedence/mode checks never touch
// the developer's real ~/.bb. Each fixture is a self-contained script that
// imports the component by absolute path and prints JSON lines.
// ---------------------------------------------------------------------------

type FixtureResult = { ok: boolean; stdout: string; stderr: string; exitCode: number | null }

// Prefer bun (house standard); fall back to node + tsx when bun is not
// installed on this machine. The tsx loader must be resolvable from the
// fixture's temp cwd, so we pass an absolute path resolved from THIS script's
// own node_modules (tsx is a dependency of the verify toolchain).
function runnerCommand(): { cmd: string; args: string[] } {  try {
    execFileSync("bun", ["--version"], { stdio: "ignore", timeout: 10000 })
    return { cmd: "bun", args: ["run"] }
  } catch {
    // Locate a resolvable tsx entry: local node_modules first, then the npx
    // cache under ~/.npm/_npx (works regardless of how argv[1] looks), then a
    // global npm root. `--import <loader.mjs>` registers the TS loader.
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

async function runFixture(script: string, env: Record<string, string>, componentPath: string, timeoutMs = 20000): FixtureResult {
  const dir = mkdtempSync(path.join(os.tmpdir(), "m30-s1-"))
  const scriptPath = path.join(dir, "fixture.ts")
  const dataDir = path.join(dir, "bbdata")
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(scriptPath, script.replaceAll("__COMPONENT__", JSON.stringify(componentPath)).replaceAll("__DATADIR__", JSON.stringify(dataDir)))
  // Async spawn on purpose: the mock /embeddings server lives in THIS
  // process, and a blocking spawnSync would freeze the event loop so the
  // server could never answer the child's request (guaranteed deadlock).
  const result = await new Promise<FixtureResult>((resolve) => {
    const child = spawn(RUNNER.cmd, [...RUNNER.args, scriptPath], {
      cwd: dir,
      env: {
        ...process.env,
        BB_DATA_DIR: dataDir,
        ...env,
        // Loopback mock must not be routed through a proxy (mirrors the
        // component's own NO_PROXY handling; env vars are read at startup).
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
        finish(null, `timed out after ${timeoutMs}ms`)
      }
    }, timeoutMs)
    child.stdout?.on("data", (d) => (stdout += d))
    child.stderr?.on("data", (d) => (stderr += d))
    child.on("error", (e) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        finish(null, e.message)
      }
    })
    child.on("close", (code) => finish(code))
    function finish(code: number | null, errDetail = "") {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({
          ok: code === 0,
          stdout,
          stderr: errDetail ? `${errDetail}\n${stderr}` : stderr,
          exitCode: code,
        })
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
// Fixtures — precedence detection
// ---------------------------------------------------------------------------

const PRECEDENCE_SCRIPT = `
import { hasEmbeddingConfig, saveEmbeddingConfig } from __COMPONENT__
import { statSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
const dataDir = __DATADIR__
const out = (v: unknown) => console.log("JSON:" + JSON.stringify(v))

// 1. nothing configured
out({ case: "none", state: hasEmbeddingConfig(dataDir, {}) })

// 2. project bb.json only (written to the CWD the hook would read)
writeFileSync(path.join(process.cwd(), "bb.json"), JSON.stringify({ embedding_base_url: "https://p.example", embedding_model: "p-model" }))
out({ case: "project", state: hasEmbeddingConfig(process.cwd(), {}) })

// 3. partial env (base url only) does NOT count as configured
out({ case: "partial-env", state: hasEmbeddingConfig(dataDir, { BB_EMBEDDING_BASE_URL: "https://e.example" }) })

// 4. global config.json beats project; pre-existing unrelated key must survive the merge
writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ other_key: "keep" }), { mode: 0o600 })
saveEmbeddingConfig({ embedding_base_url: "https://g.example", embedding_model: "g-model", embedding_api_key: "g-key" }, dataDir)
out({ case: "global", state: hasEmbeddingConfig(dataDir, {}) })

// 5. env beats global
out({ case: "env", state: hasEmbeddingConfig(dataDir, { BB_EMBEDDING_BASE_URL: "https://e.example", BB_EMBEDDING_MODEL: "e-model" }) })

// 6. global file mode is 0600
out({ case: "mode", mode: (statSync(path.join(dataDir, "config.json")).mode & 0o777) })

// 7. unrelated keys preserved on save
const cfg = JSON.parse(readFileSync(path.join(dataDir, "config.json"), "utf8"))
out({ case: "preserved", hasOther: cfg.other_key === "keep" })

// 8. fixConfigMode corrects a bad mode (chmod — the file already exists)
import { chmodSync } from "node:fs"
chmodSync(path.join(dataDir, "config.json"), 0o644)
import { fixConfigMode } from __COMPONENT__
const fixed = fixConfigMode(path.join(dataDir, "config.json"))
out({ case: "fixed", fixed, mode: (statSync(path.join(dataDir, "config.json")).mode & 0o777) })
`

// ---------------------------------------------------------------------------
// Fixtures — key validation against a local mock /embeddings server
// ---------------------------------------------------------------------------

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
}
main()
`

async function withMockServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    const c = (req.url ?? "").slice(1).split("/")[0] ?? ""
    const reply = (status: number, body: any) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(typeof body === "string" ? body : JSON.stringify(body))
    }
    // Consume request body so the client can finish writing.
    let body = ""
    req.on("data", (d) => (body += d))
    req.on("end", () => {
      // The key travels in the Authorization header, not the body.
      if (!(req.headers.authorization ?? "").includes("test-key-123456")) return reply(401, { error: "missing auth" })
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

// ---------------------------------------------------------------------------
// Fixtures — first-run hook must never hang on non-TTY stdin
// ---------------------------------------------------------------------------

const HOOK_SCRIPT = `
import { maybeRunFirstRunSetup } from __COMPONENT__
const out = (v: unknown) => console.log("JSON:" + JSON.stringify(v))
async function main() {
  const r = await maybeRunFirstRunSetup({ noSetup: process.env.HOOK_NO_SETUP === "1", quiet: process.env.HOOK_QUIET === "1" })
  out(r)
}
main()
`

// ---------------------------------------------------------------------------
// Load the real component and run fixtures
// ---------------------------------------------------------------------------

console.log("M30.S1 setup-wizard verifier")
console.log(`  component: ${path.relative(ROOT, COMPONENT)}`)

// Positive: precedence + save + mode
{
  const res = await runFixture(PRECEDENCE_SCRIPT, {}, COMPONENT)
  check("S1: precedence fixture runs cleanly", res.ok, res.stderr.slice(0, 200))
  const j = Object.fromEntries(fixtureJSON(res).map((o) => [o.case, o]))
  check("S1: nothing configured detected as none", j.none?.state?.configured === false && j.none?.state?.source === "none", JSON.stringify(j.none))
  check("S1: project bb.json detected", j.project?.state?.configured === true && j.project?.state?.source === "project", JSON.stringify(j.project))
  check("S1: global config beats project", j.global?.state?.source === "global", JSON.stringify(j.global))
  check("S1: env beats global", j.env?.state?.source === "env", JSON.stringify(j.env))
  check("S1: partial env (base url only) is not configured", j["partial-env"]?.state?.configured === false, JSON.stringify(j["partial-env"]))
  check("S1: config saved with mode 0600", j.mode?.mode === 0o600, JSON.stringify(j.mode))
  check("S1: unrelated keys preserved on save", j.preserved?.hasOther === true, JSON.stringify(j.preserved))
  check("S1: fixConfigMode corrects 0644 to 0600", j.fixed?.fixed === true && j.fixed?.mode === 0o600, JSON.stringify(j.fixed))
}

// Positive: key validation against mock server
await withMockServer(async (base) => {
  const cases = ["ok", "soft429", "soft500", "notfound", "badjson", "noembedding", "teapot"]
  const res = await runFixture(VALIDATION_SCRIPT, { MOCK_BASE: base, MOCK_CASES: cases.join(",") }, COMPONENT)
  check("S1: validation fixture runs cleanly", res.ok, res.stderr.slice(0, 200))
  const j = Object.fromEntries(fixtureJSON(res).map((o) => [o.case, o]))
  check("S1: 200 with embedding vector validates", j.ok?.kind === "ok" && j.ok?.softPass === false && j.ok?.dimension === 3, JSON.stringify(j.ok))
  check("S1: fingerprint is last 4 chars", j.ok?.fingerprint === "3456", JSON.stringify(j.ok?.fingerprint))
  check("S1: 429 is a soft pass", j.soft429?.kind === "ok" && j.soft429?.softPass === true && j.soft429?.status === 429, JSON.stringify(j.soft429))
  check("S1: 5xx is a soft pass", j.soft500?.kind === "ok" && j.soft500?.softPass === true, JSON.stringify(j.soft500))
  check("S1: 404 is a hard error mentioning model", j.notfound?.kind === "error" && /model/i.test(j.notfound.message ?? ""), JSON.stringify(j.notfound))
  check("S1: malformed JSON is a hard error", j.badjson?.kind === "error", JSON.stringify(j.badjson))
  check("S1: missing embedding array is a hard error with actionable message", j.noembedding?.kind === "error" && /returned no embedding/i.test(j.noembedding?.message ?? ""), JSON.stringify(j.noembedding))
  check("S1: unexpected status mapped with status code", j.teapot?.kind === "error" && String(j.teapot.message).includes("418"), JSON.stringify(j.teapot))
  check("S1: mapValidationError 401 branch", /401/i.test(j.map401?.msg ?? ""), j.map401?.msg)
  check("S1: mapValidationError 429 branch", /429/i.test(j.map429?.msg ?? ""), j.map429?.msg)
  check("S1: mapValidationError 5xx branch", /503/i.test(j.map500?.msg ?? ""), j.map500?.msg)
  check("S1: mapValidationError 404 branch", /404/i.test(j.map404?.msg ?? ""), j.map404?.msg)
  check("S1: mapValidationError fallback includes status", /418/.test(j.mapOther?.msg ?? ""), j.mapOther?.msg)
})

// Positive: first-run hook never hangs on non-TTY (this whole verifier runs
// with piped stdio, so a TTY-guard regression would block until timeout).
{
  const res = await runFixture(HOOK_SCRIPT, { HOOK_QUIET: "1" }, COMPONENT, 15000)
  check("S2: hook resolves on non-TTY stdin (never hangs)", res.ok, res.stderr.slice(0, 200))
  const j = fixtureJSON(res)[0]
  check("S2: non-TTY hook reports non-tty reason", j?.reason === "non-tty" && j?.prompted === false, JSON.stringify(j))

  const resFlag = await runFixture(HOOK_SCRIPT, { HOOK_NO_SETUP: "1" }, COMPONENT, 15000)
  const jFlag = fixtureJSON(resFlag)[0]
  check("S2: --no-setup skips hook entirely", jFlag?.reason === "flag" && jFlag?.prompted === false, JSON.stringify(jFlag))

  const resConfigured = await runFixture(HOOK_SCRIPT, { BB_EMBEDDING_BASE_URL: "https://x.example", BB_EMBEDDING_MODEL: "m" }, COMPONENT, 15000)
  const jCfg = fixtureJSON(resConfigured)[0]
  check("S2: configured env skips hook", jCfg?.reason === "configured" && jCfg?.prompted === false, JSON.stringify(jCfg))
}

// ---------------------------------------------------------------------------
// Mutants — each must be caught by the suite above (run against the mutant)
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: (m: MutantProbe) => boolean }
type MutantProbe = {
  precedence: Record<string, any>
  validation: Record<string, any>
  hook: any
  hookFlag: any
  hookConfigured: any
  fixtureOk: boolean
}

const mutants: Mutant[] = [
  {
    name: "env precedence tier dropped",
    mutate: (src) => src.replace(
      'if (env.BB_EMBEDDING_BASE_URL && env.BB_EMBEDDING_MODEL) return { configured: true, source: "env" }',
      "if (false) return { configured: true, source: \"env\" }",
    ),
    probe: (m) => m.precedence.env?.state?.source !== "env",
  },
  {
    name: "global tier dropped",
    mutate: (src) => src.replace(
      'if (home && home.embedding_base_url && home.embedding_model) return { configured: true, source: "global" }',
      "if (false) return { configured: true, source: \"global\" }",
    ),
    probe: (m) => m.precedence.global?.state?.source !== "global",
  },
  {
    name: "project tier dropped",
    mutate: (src) => src.replace(
      'if (local && local.embedding_base_url && local.embedding_model) return { configured: true, source: "project" }',
      "if (false) return { configured: true, source: \"project\" }",
    ),
    probe: (m) => m.precedence.project?.state?.source !== "project",
  },
  {
    name: "config written world-readable (0600 + fixConfigMode call removed)",
    mutate: (src) => src
      .replace("writeFileSync(tmp, JSON.stringify(merged, null, 2) + \"\\n\", { mode: 0o600 })", "writeFileSync(tmp, JSON.stringify(merged, null, 2) + \"\\n\")")
      .replace("  fixConfigMode(cfgPath)\n", ""),
    probe: (m) => m.precedence.mode?.mode !== 0o600,
  },
  {
    name: "fixConfigMode never corrects",
    mutate: (src) => src.replace("if (mode !== 0o600) {", "if (false) {"),
    probe: (m) => !(m.precedence.fixed?.fixed === true && m.precedence.fixed?.mode === 0o600),
  },
  {
    name: "unrelated keys clobbered on save",
    mutate: (src) => src.replace("const merged = { ...existing, ...partial }", "const merged = { ...partial }"),
    probe: (m) => m.precedence.preserved?.hasOther !== true,
  },
  {
    name: "429 no longer soft-pass",
    mutate: (src) => src.replace("if (res.status === 429 || res.status >= 500) {", "if (false) {"),
    probe: (m) => !(m.validation.soft429?.kind === "ok" && m.validation.soft429?.softPass === true),
  },
  {
    name: "401 error mapping removed",
    mutate: (src) => src.replace('if (status === 401 || status === 403) {', "if (false) {"),
    probe: (m) => !/401/i.test(m.validation.map401 ?? ""),
  },
  {
    name: "embedding-array check removed",
    mutate: (src) => src.replace("if (!Array.isArray(vec) || vec.length === 0) {", "if (false) {"),
    // Guard removed, the next line (dimension: vec.length) throws a raw
    // TypeError instead of the actionable message — must be caught.
    probe: (m) => !(m.validation.noembedding?.kind === "error" && /embedding döndürmedi/i.test(m.validation.noembedding?.message ?? "")),
  },
  {
    name: "TTY guard removed (hook would hang non-TTY)",
    mutate: (src) => src.replace("if (!process.stdin.isTTY) {", "if (false) {"),
    probe: (m) => !m.fixtureOk || m.hook?.reason !== "non-tty",
  },
  {
    name: "--no-setup flag ignored",
    mutate: (src) => src.replace("if (opts.noSetup) return { prompted: false, reason: \"flag\" }", "if (false) return { prompted: false, reason: \"flag\" }"),
    probe: (m) => m.hookFlag?.reason !== "flag",
  },
]

// Because validateKey needs the mock server, mutant probing runs the
// validation fixture inside withMockServer as well.
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
    const precedenceRes = await runFixture(PRECEDENCE_SCRIPT, {}, MUTANT_PATH, 20000)
    const precedence = Object.fromEntries(fixtureJSON(precedenceRes).map((o) => [o.case, o]))
    let validation: Record<string, any> = {}
    let validationRan = true
    await withMockServer(async (base) => {
      const cases = ["ok", "soft429", "soft500", "notfound", "badjson", "noembedding", "teapot"]
      const res = await runFixture(VALIDATION_SCRIPT, { MOCK_BASE: base, MOCK_CASES: cases.join(",") }, MUTANT_PATH, 20000)
      validation = Object.fromEntries(fixtureJSON(res).map((o) => [o.case, o]))
      validationRan = res.ok || Object.keys(validation).length > 0
    })
    const hookRes = await runFixture(HOOK_SCRIPT, { HOOK_QUIET: "1" }, MUTANT_PATH, 15000)
    const hookFlagRes = await runFixture(HOOK_SCRIPT, { HOOK_NO_SETUP: "1" }, MUTANT_PATH, 15000)
    const hookCfgRes = await runFixture(HOOK_SCRIPT, { BB_EMBEDDING_BASE_URL: "https://x.example", BB_EMBEDDING_MODEL: "m" }, MUTANT_PATH, 15000)
    probe = {
      precedence,
      validation,
      hook: fixtureJSON(hookRes)[0],
      hookFlag: fixtureJSON(hookFlagRes)[0],
      hookConfigured: fixtureJSON(hookCfgRes)[0],
      fixtureOk: precedenceRes.ok && validationRan,
    }
  } finally {
    if (existsSync(MUTANT_PATH)) rmSync(MUTANT_PATH, { force: true })
  }
  const caught = mut.probe(probe)
  mutantResults.push({ name: mut.name, caught, detail: caught ? "caught" : "survived" })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}

check("S1: every planted defect was caught", mutantResults.every((m) => m.caught))

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
const sourceFingerprint = execFileSync("sha256sum", [COMPONENT], { cwd: ROOT, encoding: "utf8" }).trim().split(/\s+/)[0]

const result = {
  issue: "M30.S1",
  code: "S1",
  milestone: "M30",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutants.length,
  mutants: mutantResults,
  currentCommit,
  sourceFingerprint,
  verifierCommand: "npx tsx script/m30/verify-setup.ts",
  evidenceFile: "S1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Interactive TTY prompt path (runSetupWizard readline flow) is exercised only via the non-TTY guard tests; full keystroke-level TTY interaction is not simulated here.",
    "Live provider key validation (real OpenRouter/NVIDIA endpoints) is gated behind BB_M30_LIVE_KEYS=1 and covered by S3, not this verifier.",
    "Hidden-input masking (raw-mode keypress capture) is not asserted by this suite; it is covered by manual/TTY verification.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m30/results"), { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
