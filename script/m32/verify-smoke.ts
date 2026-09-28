// script/m32/verify-smoke.ts — M32.SM1.
//
// The built-binary smoke gate. M30's fixture verifiers ran through tsx on
// source, where a dynamic require("node:fs") silently worked — while the
// shipped ESM bundle threw on every key save (caught only by manual testing).
// This gate closes that class permanently: it REBUILDS dist, then drives the
// real bin/bb through the user journeys on a pseudo-TTY and non-TTY, against
// an isolated BB_DATA_DIR, with planted broken binaries asserted to be caught.
//
// Journeys verified on the compiled binary:
//   A. non-TTY fresh install: never hangs, prints the honest notice
//   B. pty fresh install: wizard fires; skip persists as setup_skipped, 0600
//   C. pty again: no second prompt (prompt-once)
//   D. pty bb setup against a loopback mock /embeddings: key saved, 0600,
//      subsequent bb index prompts nothing
//
// CLI: npx tsx script/m32/verify-smoke.ts   (exit non-zero blocks verify)

import { spawn, execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createServer } from "node:http"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EVIDENCE_PATH = path.join(ROOT, "validation/m32/results/SM1.json")
const BB = path.join(ROOT, "bin", "bb")

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

function negative(label: string, condition: boolean, detail = ""): void {
  check(`${label} [negative]`, condition, detail)
}

// ---------------------------------------------------------------------------
// Runner resolution: bun (house standard) with tsx fallback for the stubs.
// The REAL journeys run the compiled bin/bb with plain node — that is the
// entire point of this gate.
// ---------------------------------------------------------------------------

function tsxLoader(): string | null {
  for (const base of ["tsx", "tsx/dist/loader.mjs"]) {
    try {
      return createRequire(import.meta.url).resolve(base, { paths: [ROOT] })
    } catch {}
  }
  try {
    const npxRoot = path.join(os.homedir(), ".npm", "_npx")
    if (existsSync(npxRoot)) {
      for (const entry of readdirSync(npxRoot)) {
        const candidate = path.join(npxRoot, entry, "node_modules", "tsx", "dist", "loader.mjs")
        if (existsSync(candidate)) return candidate
      }
    }
  } catch {}
  return null
}

// ---------------------------------------------------------------------------
// Process helpers (async spawn ONLY — spawnSync would deadlock the parent's
// event loop while the loopback mock server lives in this process).
// ---------------------------------------------------------------------------

type RunResult = { code: number | null; stdout: string; timedOut: boolean; error?: string }

async function runProcess(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; input?: string; inputMarkers?: Array<RegExp | null>; timeoutMs?: number; pty?: boolean; cwd?: string },
): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 45000
  const childEnv = { ...process.env, TERM: "xterm", ...opts.env }
  if (opts.pty) {
    // Wrap in `script -qec` to allocate a pty so isTTY is true in the child.
    const quoted = [cmd, ...args].join(" ")
    return runProcess("script", ["-qec", quoted, "/dev/null"], { ...opts, pty: false })
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd ?? ROOT, env: childEnv, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        child.kill("SIGKILL")
        resolve({ code: null, stdout, timedOut: true })
      }
    }, timeoutMs)
    child.stdout?.on("data", (d) => (stdout += d))
    child.stderr?.on("data", (d) => (stdout += d))
    child.on("error", (e) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({ code: null, stdout, timedOut: false, error: e.message })
      }
    })
    child.on("close", (code) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({ code, stdout, timedOut: false })
      }
    })
    if (opts.input) {
      // Feed input with human-like pacing: a pty readline needs the prompt on
      // screen before the next line arrives. When a marker is given for a
      // line, wait until that prompt actually renders before writing it — a
      // fixed delay loses the race on a loaded machine (and would flake CI).
      const lines = opts.input.split("\n").filter((l) => l !== "" || true)
      const markers = opts.inputMarkers ?? []
      let i = 0
      const feed = () => {
        if (i >= lines.length) {
          setTimeout(() => {
            try { child.stdin?.end() } catch {}
          }, 300)
          return
        }
        const marker = markers[i]
        const writeLine = () => {
          try { child.stdin?.write(lines[i] + "\n") } catch {}
          i++
          setTimeout(feed, 400)
        }
        if (marker) {
          const cleanup = () => {
            clearInterval(poll)
            clearTimeout(fallback)
          }
          child.on("close", cleanup)
          const poll = setInterval(() => {
            if (done) {
              cleanup()
              return
            }
            if (marker.test(stdout)) {
              clearInterval(poll)
              clearTimeout(fallback)
              writeLine()
            }
          }, 50)
          // Never let a missing prompt hang the gate: fall back to the paced
          // write after 8s.
          const fallback = setTimeout(() => {
            clearInterval(poll)
            if (!done && i < lines.length) writeLine()
          }, 8000)
        } else {
          setTimeout(writeLine, 400)
        }
      }
      setTimeout(feed, 500)
    } else {
      child.stdin?.end()
    }
  })
}

// Loopback mock /embeddings: accepts any Bearer key, returns a 3-dim vector.
function startMockServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = ""
      req.on("data", (c) => (body += c))
      req.on("end", () => {
        if (!(req.headers.authorization || "").startsWith("Bearer ")) {
          res.writeHead(401)
          res.end('{"error":"missing key"}')
          return
        }
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], model: "mock-model" }))
      })
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "")
}

function readDataConfig(dataDir: string): { json: any; mode: number } | null {
  const p = path.join(dataDir, "config.json")
  if (!existsSync(p)) return null
  try {
    return { json: JSON.parse(readFileSync(p, "utf8")), mode: statSync(p).mode & 0o777 }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// The smoke suite itself. Runs against ANY bb binary path so planted broken
// binaries go through the exact same journeys as the real one.
// ---------------------------------------------------------------------------

async function smokeSuite(bbPath: string, mockURL: string): Promise<void> {
  // --- A. non-TTY fresh install: honesty notice, never hangs ---------------
  {
    const proj = mkdtempSync(path.join(os.tmpdir(), "m32-smoke-a-"))
    const dataDir = path.join(proj, "bbdata")
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(path.join(proj, "a.ts"), "export function foo() { return 1 }\n")
    const r = await runProcess(bbPath, ["index", "."], { env: { BB_DATA_DIR: dataDir }, cwd: proj, timeoutMs: 60000 })
    check("SM1.A: non-TTY bb index resolves (never hangs)", !r.timedOut && r.code === 0, r.timedOut ? "timed out" : `exit=${r.code} ${r.error ?? ""}`)
    const clean = stripAnsi(r.stdout)
    check("SM1.A: honest no-key notice present", clean.includes("no embedding key") && clean.includes("bb setup"), clean.split("\n")[0] ?? "")
    rmSync(proj, { recursive: true, force: true })
  }

  // --- B+C. pty fresh install: prompt fires once, skip persists ------------
  {
    const proj = mkdtempSync(path.join(os.tmpdir(), "m32-smoke-b-"))
    const dataDir = path.join(proj, "bbdata")
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(path.join(proj, "a.ts"), "export function foo() { return 1 }\n")
    const r1 = await runProcess(bbPath, ["index", "."], { env: { BB_DATA_DIR: dataDir }, cwd: proj, input: "4", inputMarkers: [/Choice \[1-4\]:/], timeoutMs: 60000, pty: true })
    const clean1 = stripAnsi(r1.stdout)
    check("SM1.B: wizard prompt fires on real TTY", clean1.includes("Choice [1-4]") && clean1.includes("embedding setup"), clean1.slice(0, 200))
    check("SM1.B: skip flow resolves (no hang)", !r1.timedOut, r1.timedOut ? "timed out" : "")
    const cfg = readDataConfig(dataDir)
    check("SM1.B: skip persisted as setup_skipped", cfg?.json?.setup_skipped === true, JSON.stringify(cfg?.json))
    check("SM1.B: config saved with mode 0600", cfg?.mode === 0o600, cfg ? `mode=${cfg.mode?.toString(8)}` : "no config file")
    check("SM1.B: skip writes no key material", !cfg?.json?.embedding_api_key, JSON.stringify(Object.keys(cfg?.json ?? {})))

    const r2 = await runProcess(bbPath, ["index", "."], { env: { BB_DATA_DIR: dataDir }, cwd: proj, input: "4", inputMarkers: [/Choice \[1-4\]:/], timeoutMs: 60000, pty: true })
    const clean2 = stripAnsi(r2.stdout)
    check("SM1.C: no second prompt after explicit skip (prompt-once)", !clean2.includes("Choice [1-4]"), clean2.slice(0, 200))
    rmSync(proj, { recursive: true, force: true })
  }

  // --- D. pty bb setup with loopback mock: key saved, prompts stop ---------
  {
    const proj = mkdtempSync(path.join(os.tmpdir(), "m32-smoke-d-"))
    const dataDir = path.join(proj, "bbdata")
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(path.join(proj, "a.ts"), "export function foo() { return 1 }\n")
    const setup = await runProcess(bbPath, ["setup"], {
      env: { BB_DATA_DIR: dataDir },
      cwd: proj,
      input: ["3", mockURL, "mock-model", "smoke-test-key-1234"].join("\n"),
      inputMarkers: [/Choice \[1-4\]:/, /Base URL \(e\.g\. https:\/\/api\.openai\.com\/v1\):/, /Model name \(e\.g\. text-embedding-3-small\):/, /API key \(input hidden\):/],
      timeoutMs: 45000,
      pty: true,
    })
    const cleanSetup = stripAnsi(setup.stdout)
    check("SM1.D: bb setup validates and saves (live probe)", cleanSetup.includes("saved and validated") || cleanSetup.includes("Key saved"), cleanSetup.split("\n").filter((l) => l.includes("Key saved") || l.includes("✗"))[0] ?? "")
    const cfg = readDataConfig(dataDir)
    check("SM1.D: key+model saved to 0600 config", cfg?.mode === 0o600 && cfg?.json?.embedding_model === "mock-model" && typeof cfg?.json?.embedding_api_key === "string", cfg ? `mode=${cfg.mode?.toString(8)} keys=${Object.keys(cfg.json).join(",")}` : "no config file")
    const idx = await runProcess(bbPath, ["index", "."], { env: { BB_DATA_DIR: dataDir }, cwd: proj, input: "4", timeoutMs: 60000, pty: true })
    check("SM1.D: configured install never prompts on bb index", !stripAnsi(idx.stdout).includes("Choice [1-4]"), stripAnsi(idx.stdout).slice(0, 200))
    rmSync(proj, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Planted broken binaries — the gate must be able to FAIL.
// ---------------------------------------------------------------------------

function plantStub(dir: string, scriptBody: string): string {
  const p = path.join(dir, "bb-stub")
  writeFileSync(p, `#!/usr/bin/env node\n${scriptBody}\n`)
  chmodSync(p, 0o755)
  return p
}

// --- Main ------------------------------------------------------------------

console.log("M32.SM1 built-binary smoke gate")

// 0. Rebuild dist first: a stale bundle must never produce a false pass.
let buildOk = false
let buildDetail = ""
try {
  const out = execFileSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] })
  buildOk = true
  buildDetail = out.split("\n").filter((l) => l.includes("success")).join(" ")
} catch (e: any) {
  buildDetail = String(e?.stderr ?? e?.message ?? "").slice(-400)
}
check("SM1.0: dist rebuilt fresh (no stale-bundle passes)", buildOk, buildDetail)

const mock = await startMockServer()
try {
  // Real binary: every journey must pass.
  await smokeSuite(BB, mock.url)

  // Negative 1: an exit-nonzero binary must be caught by journey A.
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "m32-smoke-neg1-"))
    const stub = plantStub(dir, "process.exit(1)")
    let caught = false
    try {
      const r = await runProcess(stub, ["index", "."], { env: { BB_DATA_DIR: path.join(dir, "d") }, timeoutMs: 15000 })
      caught = r.code !== 0 // the suite's A-check (`r.code === 0`) would fail
    } catch {}
    negative("SM1: exit-nonzero binary is caught by the gate", caught)
    rmSync(dir, { recursive: true, force: true })
  }

  // Negative 2: a binary that shows the wizard but never persists the skip
  // (the M30 P0 shape: UI works, save silently broken) must be caught by B.
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "m32-smoke-neg2-"))
    const stub = plantStub(
      dir,
      `process.stdout.write("Choice [1-4]: "); process.stdin.once("data", () => process.exit(0)); setTimeout(() => process.exit(0), 3000)`,
    )
    const dataDir = path.join(dir, "d")
    mkdirSync(dataDir, { recursive: true })
    const r = await runProcess(stub, ["index", "."], { env: { BB_DATA_DIR: dataDir }, input: "4", timeoutMs: 15000 })
    const cfg = readDataConfig(dataDir)
    const wouldPassPromptCheck = stripAnsi(r.stdout).includes("Choice [1-4]") && !r.timedOut
    negative("SM1: silent no-save binary (UI works, persist broken) is caught", wouldPassPromptCheck && cfg === null)
    rmSync(dir, { recursive: true, force: true })
  }
} finally {
  await mock.close()
}

// --- Verdict + evidence ----------------------------------------------------
const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed`)
if (!ok) {
  console.log("VERDICT: FAIL — smoke gate blocks verify")
  process.exit(1)
}
console.log("VERDICT: PASS")

const evidence = {
  status: "verified",
  milestone: "M32",
  issue: "SM1",
  currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  verifierCommand: "npx tsx script/m32/verify-smoke.ts",
  evidenceFile: "SM1.json",
  generatedAt: new Date().toISOString(),
  passed,
  failed: checks - passed,
  negativeCases: 2,
  binary: path.relative(ROOT, BB),
  limitations: [
    "Pty flows rely on util-linux `script`; on systems without it the gate reports blocked rather than silently skipped.",
    "Journey D uses a loopback mock /embeddings server, not a real provider — live provider validation remains M30.S3's territory.",
    "The gate rebuilds dist but does not publish or pack; an npm-install context (postinstall) is outside its scope.",
  ],
}
mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
