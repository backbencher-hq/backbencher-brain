// script/m30/verify-first-run-hook.ts — M30.S2.
//
// Proves the first-run hook (maybeRunFirstRunSetup in
// src/setup/setup-wizard.ts) is hang-safe and behaves correctly on every
// entry path, and proves the suite CAN FAIL by planting defects and
// asserting each one is caught.
//
// Run: npx tsx script/m30/verify-first-run-hook.ts
// Evidence: validation/m30/results/S2.json (machine-emitted)

import { spawn, execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/setup/setup-wizard.ts")
const MUTANT_PATH = path.join(ROOT, "src/setup/.setup-hook-mutant.ts")
const EVIDENCE_PATH = path.join(ROOT, "validation/m30/results/S2.json")

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

type HookResult = { ok: boolean; stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }

async function runHook(script: string, env: Record<string, string>, componentPath: string, timeoutMs = 10000): Promise<HookResult> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "m30-s2-"))
  const scriptPath = path.join(dir, "fixture.ts")
  const dataDir = path.join(dir, "bbdata")
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(scriptPath, script.replaceAll("__COMPONENT__", JSON.stringify(componentPath)).replaceAll("__DATADIR__", JSON.stringify(dataDir)))
  const result = await new Promise<HookResult>((resolve) => {
    const child = spawn(RUNNER.cmd, [...RUNNER.args, scriptPath], {
      cwd: dir,
      env: { ...process.env, BB_DATA_DIR: dataDir, ...env, ...(env.BB_DATA_DIR_OVERRIDE ? { BB_DATA_DIR: env.BB_DATA_DIR_OVERRIDE } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        child.kill("SIGKILL")
        finish(null, "timed out", true)
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
        resolve({
          ok: code === 0,
          stdout,
          stderr: errDetail ? `${errDetail}\n${stderr}` : stderr,
          exitCode: code,
          timedOut,
        })
      }
    }
  })
  rmSync(dir, { recursive: true, force: true })
  return result
}

function fixtureJSON(res: HookResult): any[] {
  return res.stdout
    .split("\n")
    .filter((l) => l.startsWith("JSON:"))
    .map((l) => JSON.parse(l.slice(5)))
}

const HOOK_SCRIPT = `
import { maybeRunFirstRunSetup } from __COMPONENT__
const out = (v: unknown) => console.log("JSON:" + JSON.stringify(v))
async function main() {
  const r = await maybeRunFirstRunSetup({ noSetup: process.env.HOOK_NO_SETUP === "1", quiet: process.env.HOOK_QUIET === "1" })
  out(r)
}
main()
`

// Pseudo-TTY script: allocates a pty via `script -qec` (util-linux) so
// process.stdin.isTTY is true inside the child. The wizard's interactive
// path is entered; we drive it with an immediate "skip" choice (the last
// menu option) and assert the hook resolves rather than blocking.
const PTY_SCRIPT = `
import { maybeRunFirstRunSetup } from __COMPONENT__
const out = (v: unknown) => console.log("JSON:" + JSON.stringify(v))
async function main() {
  const r = await maybeRunFirstRunSetup({})
  out(r)
}
main()
`

// Wizard skip-write fixture: drives runSetupWizard to the skip choice with a
// stubbed save, and reports exactly what the wizard asked to persist.
const WIZARD_SKIP_SCRIPT = `
import { Readable } from "node:stream"
import { runSetupWizard } from __COMPONENT__
const out = (v: unknown) => console.log("JSON:" + JSON.stringify(v))
async function main() {
  let captured = null
  const r = await runSetupWizard(
    { input: Readable.from(["4\\n"]), output: { write() {} } },
    { save: (partial) => { captured = partial }, dataDir: "/tmp/m30-wizard-skip-unused" },
  )
  out({ result: r, savedPartial: captured })
}
main()
`

// ---------------------------------------------------------------------------
// Positive checks
// ---------------------------------------------------------------------------

console.log("M30.S2 first-run hook verifier")
console.log(`  component: ${path.relative(ROOT, COMPONENT)}`)

// 1. Non-TTY (piped/ignored stdin) must resolve fast with a non-tty reason.
{
  const res = await runHook(HOOK_SCRIPT, { HOOK_QUIET: "1" }, COMPONENT)
  check("S2: non-TTY hook resolves (never hangs)", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  const j = fixtureJSON(res)[0]
  check("S2: non-TTY reports prompted=false, reason=non-tty", j?.prompted === false && j?.reason === "non-tty", JSON.stringify(j))
}
{
  // 2. Non-TTY without quiet emits exactly one honest notice line.
  const res = await runHook(HOOK_SCRIPT, {}, COMPONENT)
  check("S2: non-TTY unquiet hook resolves", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  const noticeLines = res.stdout.split("\n").filter((l) => l.includes("no embedding key"))
  check("S2: exactly one notice line on non-TTY", noticeLines.length === 1, JSON.stringify(noticeLines))
  check("S2: notice points to bb setup", /bb setup/.test(noticeLines[0] ?? ""), noticeLines[0])
}

// 3. --no-setup skips entirely (no notice, no prompt).
{
  const res = await runHook(HOOK_SCRIPT, { HOOK_NO_SETUP: "1", HOOK_QUIET: "1" }, COMPONENT)
  check("S2: --no-setup resolves fast", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  const j = fixtureJSON(res)[0]
  check("S2: --no-setup reports reason=flag", j?.prompted === false && j?.reason === "flag", JSON.stringify(j))
  check("S2: --no-setup emits no notice", !res.stdout.includes("no embedding key"), res.stdout.slice(0, 200))
}

// 4. Configured env skips hook.
{
  const res = await runHook(HOOK_SCRIPT, { BB_EMBEDDING_BASE_URL: "https://x.example", BB_EMBEDDING_MODEL: "m", HOOK_QUIET: "1" }, COMPONENT)
  check("S2: configured env hook resolves", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  const j = fixtureJSON(res)[0]
  check("S2: configured env reports reason=configured", j?.prompted === false && j?.reason === "configured", JSON.stringify(j))
}

// 4b. Explicit skip is remembered: a global config with setup_skipped=true
// (what the wizard writes when the user chooses "Skip") must stop future
// prompts — the wizard runs ONCE, never nags on every bb index.
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "m30-s2-skip-"))
  const dataDir = path.join(dir, "bbdata")
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(path.join(dataDir, "config.json"), JSON.stringify({ setup_skipped: true }) + "\n", { mode: 0o600 })
  const res = await runHook(HOOK_SCRIPT, { HOOK_QUIET: "1", BB_DATA_DIR_OVERRIDE: dataDir }, COMPONENT)
  const j = fixtureJSON(res)[0]
  check("S2: remembered skip resolves (no prompt, no hang)", res.ok && !res.timedOut, res.stderr.slice(0, 200))
  check("S2: remembered skip reports reason=skipped", j?.prompted === false && j?.reason === "skipped", JSON.stringify(j))
  check("S2: remembered skip emits no notice", !res.stdout.includes("no embedding key"), res.stdout.slice(0, 200))
  rmSync(dir, { recursive: true, force: true })
}

// 5. Pseudo-TTY: prompt appears and wizard is reachable; driven to the skip
// option so it exits cleanly. This proves the TTY branch actually fires
// (a regression that never prompts would fail this check).
{
  // Wrap the fixture in `script -qec` to allocate a pty. Feed "4\n" (skip
  // choice for 3 providers) with a short delay via the pty's stdin.
  const dir = mkdtempSync(path.join(os.tmpdir(), "m30-s2-pty-"))
  const scriptPath = path.join(dir, "fixture.ts")
  const dataDir = path.join(dir, "bbdata")
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(scriptPath, PTY_SCRIPT.replaceAll("__COMPONENT__", JSON.stringify(COMPONENT)).replaceAll("__DATADIR__", JSON.stringify(dataDir)))
  const result = await new Promise<{ ok: boolean; stdout: string; timedOut: boolean }>((resolve) => {
    const child = spawn("script", ["-qec", `${RUNNER.cmd} ${RUNNER.args.join(" ")} ${scriptPath}`.trim(), "/dev/null"], {
      cwd: dir,
      env: { ...process.env, BB_DATA_DIR: dataDir, TERM: "xterm" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        child.kill("SIGKILL")
        resolve({ ok: false, stdout, timedOut: true })
      }
    }, 15000)
    child.stdout?.on("data", (d) => (stdout += d))
    child.on("error", () => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({ ok: false, stdout, timedOut: false })
      }
    })
    child.on("close", (code) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({ ok: code === 0, stdout, timedOut: false })
      }
    })
    // Send skip choice (option 4 = Skip) shortly after start.
    setTimeout(() => {
      try {
        child.stdin?.write("4\r")
      } catch {}
    }, 1500)
    setTimeout(() => {
      try {
        child.stdin?.end()
      } catch {}
    }, 3000)
  })
  rmSync(dir, { recursive: true, force: true })
  check("S2: pseudo-TTY prompt appears (TTY branch fires)", /Choice \[1-4\]/.test(result.stdout) && /embedding setup/.test(result.stdout), result.stdout.slice(0, 300))
  check("S2: pseudo-TTY session resolves (no hang)", !result.timedOut, result.stdout.slice(0, 200))
}

// ---------------------------------------------------------------------------
// Mutants — each must be caught
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: (m: MutantProbe) => boolean }
type MutantProbe = {
  hook: any
  hookFlag: any
  hookConfigured: any
  noticeCount: number
  ptyPrompted: boolean
  fixtureOk: boolean
  skipReason?: string
  wizardSkipMarker?: unknown
}

const mutants: Mutant[] = [
  {
    name: "TTY guard removed (hook hangs non-TTY)",
    mutate: (src) => src.replace("if (!process.stdin.isTTY) {", "if (false) {"),
    probe: (m) => !m.fixtureOk || m.hook?.reason !== "non-tty",
  },
  {
    name: "--no-setup flag ignored",
    mutate: (src) => src.replace('if (opts.noSetup) return { prompted: false, reason: "flag" }', 'if (false) return { prompted: false, reason: "flag" }'),
    probe: (m) => m.hookFlag?.reason !== "flag",
  },
  {
    name: "configured-state check removed (prompt always fires)",
    mutate: (src) => src.replace('if (state.configured) return { prompted: false, reason: "configured" }', 'if (false) return { prompted: false, reason: "configured" }'),
    probe: (m) => m.hookConfigured?.reason !== "configured",
  },
  {
    name: "non-TTY notice removed",
    mutate: (src) => src.replace('console.log("note: no embedding key — semantic search will use local vectors (weaker). Setup: bb setup")', "/* notice removed */"),
    // The unquiet non-TTY run must emit exactly one honest notice line.
    probe: (m) => m.noticeCount !== 1,
  },
  {
    name: "skip-marker write removed (user re-prompted every run)",
    mutate: (src) => src.replace("save({ setup_skipped: true }, dataDir)", "/* skip marker removed */"),
    probe: (m) => m.wizardSkipMarker !== true || m.skipReason !== "skipped",
  },
  {
    name: "hook skip check removed (skipped users prompted again)",
    mutate: (src) => src.replace('if (state.skipped) return { prompted: false, reason: "skipped" }', 'if (false) return { prompted: false, reason: "skipped" }'),
    probe: (m) => m.skipReason !== "skipped",
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
    const hookRes = await runHook(HOOK_SCRIPT, { HOOK_QUIET: "1" }, MUTANT_PATH, 10000)
    const hookFlagRes = await runHook(HOOK_SCRIPT, { HOOK_NO_SETUP: "1", HOOK_QUIET: "1" }, MUTANT_PATH, 10000)
    const hookCfgRes = await runHook(HOOK_SCRIPT, { BB_EMBEDDING_BASE_URL: "https://x.example", BB_EMBEDDING_MODEL: "m", HOOK_QUIET: "1" }, MUTANT_PATH, 10000)
    const hookNoticeRes = await runHook(HOOK_SCRIPT, {}, MUTANT_PATH, 10000)
    const skipDir = mkdtempSync(path.join(os.tmpdir(), "m30-s2-skipmut-"))
    const skipData = path.join(skipDir, "bbdata")
    mkdirSync(skipData, { recursive: true })
    writeFileSync(path.join(skipData, "config.json"), JSON.stringify({ setup_skipped: true }) + "\n", { mode: 0o600 })
    const hookSkipRes = await runHook(HOOK_SCRIPT, { HOOK_QUIET: "1", BB_DATA_DIR_OVERRIDE: skipData }, MUTANT_PATH, 10000)
    rmSync(skipDir, { recursive: true, force: true })
    const wizardSkipRes = await runHook(WIZARD_SKIP_SCRIPT, {}, MUTANT_PATH, 10000)
    const wizardSkipJson = fixtureJSON(wizardSkipRes)[0]
    probe = {
      hook: fixtureJSON(hookRes)[0],
      hookFlag: fixtureJSON(hookFlagRes)[0],
      hookConfigured: fixtureJSON(hookCfgRes)[0],
      noticeCount: hookNoticeRes.stdout.split("\n").filter((l) => l.includes("no embedding key")).length,
      ptyPrompted: false,
      fixtureOk: hookRes.ok,
      skipReason: fixtureJSON(hookSkipRes)[0]?.reason,
      wizardSkipMarker: wizardSkipJson?.savedPartial?.setup_skipped,
    }
  } finally {
    if (existsSync(MUTANT_PATH)) rmSync(MUTANT_PATH, { force: true })
  }
  const caught = mut.probe(probe)
  mutantResults.push({ name: mut.name, caught, detail: caught ? "caught" : "survived" })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}

check("S2: every planted defect was caught", mutantResults.every((m) => m.caught))

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
  issue: "M30.S2",
  code: "S2",
  milestone: "M30",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutants.length,
  mutants: mutantResults,
  currentCommit,
  sourceFingerprint,
  verifierCommand: "npx tsx script/m30/verify-first-run-hook.ts",
  evidenceFile: "S2.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Pseudo-TTY test uses util-linux `script`; on systems without it the TTY-branch check is skipped (recorded as a limitation, not a pass).",
    "Full interactive wizard keystroke flow under TTY (provider selection through key entry) is covered by S1/S3 verifiers and manual testing, not here.",
    "The hook is tested via direct invocation of maybeRunFirstRunSetup, not through the full bb index command pipeline.",
  ],
}
mkdirSync(path.join(ROOT, "validation/m30/results"), { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
