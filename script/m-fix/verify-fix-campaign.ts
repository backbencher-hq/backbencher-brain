// script/m-fix/verify-fix-campaign.ts — campaign verifier runner (VERIFIER-OWNED)
//
// WHAT THIS IS — the independent verifier's runner for the bettercap fix campaign
// (docs/bb-bettercap-fix/FIX-CHARTER.md). It runs ONE lane gate command, captures its
// bounded stdout/stderr, and records a JSON verdict under
// docs/bb-bettercap-fix/evidence/verifier/runs/ so CP1/CP2 re-runs are reproducible and
// comparable instead of living in a chat transcript.
//
// WHY IT EXISTS — the charter's gate protocol is RED-first, GREEN-after, with a positive
// control. A lane running the gate itself is not independent verification; this runner is
// the verifier's record of what the gate actually printed and exited with, stamped with
// the git HEAD and the BB_DATA_DIR it ran under (fixture-index gates need a writable data
// dir in this sandbox: BB_DATA_DIR=<workspace>/.tools/verifier/bbdata).
//
// USAGE
//   npx tsx script/m-fix/verify-fix-campaign.ts --label <name> [options] -- <command...>
//   npx tsx script/m-fix/verify-fix-campaign.ts --label <name> [options] --cmd "<shell command>"
//
// Options
//   --label <name>        required, filename-safe label (e.g. cp1/edit-rename)
//   --json                print ONLY the JSON verdict record to stdout
//   --out <dir>           evidence dir (default: docs/bb-bettercap-fix/evidence/verifier/runs)
//   --cwd <dir>           working directory for the child (default: process.cwd())
//   --env KEY=VALUE       extra child env var(s), repeatable (inherits the parent env)
//   --timeout-ms <n>      child timeout, default 900000 (15 min); on expiry the child is
//                         SIGKILLed and the run is recorded as TIMEOUT (not a pass)
//   --expect-red          the gate is EXPECTED to fail pre-fix: a nonzero exit records
//                         RED_CONFIRMED (runner exits 0); exit 0 records UNEXPECTED_PASS
//                         (runner exits 1). Omit for the normal PASS/FAIL expectation.
//   --cmd "<string>"      run through a shell instead of argv after `--`
//
// Verdict vocabulary: PASS | FAIL | TIMEOUT | RED_CONFIRMED | UNEXPECTED_PASS
// Exit code mirrors the verdict: 0 for PASS/RED_CONFIRMED, 1 for FAIL/TIMEOUT/UNEXPECTED_PASS,
// 2 for a usage error. --json output is the ONLY stdout in --json mode (child stdout is
// captured into the record, never leaked to the runner's stdout).
//
// EDIT TOGETHER WHEN THIS FILE CHANGES — docs/bb-bettercap-fix/FIX-CHARTER.md §4/§5 (gate
// protocol and build/verifier protocol). This file is verifier-owned: lanes do not edit it.

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const DEFAULT_OUT = "docs/bb-bettercap-fix/evidence/verifier/runs"
const DEFAULT_TIMEOUT_MS = 900_000
const MAX_CAPTURE_BYTES = 262_144 // per stream; the middle is elided, both ends kept

export type Verdict = "PASS" | "FAIL" | "TIMEOUT" | "RED_CONFIRMED" | "UNEXPECTED_PASS"

export interface RunVerdict {
  schemaVersion: 1
  label: string
  command: string[]
  shell: boolean
  cwd: string
  startedAt: string
  endedAt: string
  durationMs: number
  timedOut: boolean
  exitCode: number | null
  signal: string | null
  verdict: Verdict
  expectRed: boolean
  gitHead: string | null
  gitDirtyFiles: number | null
  bbDataDir: string | null
  stdout: string
  stderr: string
  stdoutBytes: number
  stderrBytes: number
  stdoutTruncated: boolean
  stderrTruncated: boolean
  recordPath?: string
}

interface ParsedArgs {
  label: string | null
  json: boolean
  out: string
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  expectRed: boolean
  cmd: string | null
  argv: string[]
  error: string | null
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    label: null,
    json: false,
    out: DEFAULT_OUT,
    cwd: process.cwd(),
    env: {},
    timeoutMs: DEFAULT_TIMEOUT_MS,
    expectRed: false,
    cmd: null,
    argv: [],
    error: null,
  }
  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (arg === "--") {
      parsed.argv = args.slice(i + 1)
      break
    }
    const next = (): string | null => {
      const value = args[i + 1]
      if (value === undefined) return null
      i += 1
      return value
    }
    switch (arg) {
      case "--label": {
        const value = next()
        if (!value) parsed.error = "--label requires a value"
        else parsed.label = value
        break
      }
      case "--json":
        parsed.json = true
        break
      case "--out": {
        const value = next()
        if (!value) parsed.error = "--out requires a value"
        else parsed.out = value
        break
      }
      case "--cwd": {
        const value = next()
        if (!value) parsed.error = "--cwd requires a value"
        else parsed.cwd = path.resolve(value)
        break
      }
      case "--env": {
        const value = next()
        if (!value || !value.includes("=")) parsed.error = "--env requires KEY=VALUE"
        else {
          const eq = value.indexOf("=")
          parsed.env[value.slice(0, eq)] = value.slice(eq + 1)
        }
        break
      }
      case "--timeout-ms": {
        const value = next()
        const ms = Number(value)
        if (!value || !Number.isFinite(ms) || ms <= 0) parsed.error = "--timeout-ms requires a positive integer"
        else parsed.timeoutMs = Math.floor(ms)
        break
      }
      case "--expect-red":
        parsed.expectRed = true
        break
      case "--cmd": {
        const value = next()
        if (!value) parsed.error = "--cmd requires a value"
        else parsed.cmd = value
        break
      }
      default:
        parsed.error = `unknown option: ${arg}`
    }
    if (parsed.error) break
    i += 1
  }
  return parsed
}

function capture(value: string): { text: string; bytes: number; truncated: boolean } {
  const bytes = Buffer.byteLength(value)
  if (bytes <= MAX_CAPTURE_BYTES) return { text: value, bytes, truncated: false }
  const half = Math.floor(MAX_CAPTURE_BYTES / 2)
  const head = Buffer.from(value).subarray(0, half).toString("utf8")
  const tail = Buffer.from(value).subarray(bytes - half).toString("utf8")
  return {
    text: `${head}\n…[runner elided ${bytes - 2 * half} byte(s) of the middle]…\n${tail}`,
    bytes,
    truncated: true,
  }
}

function gitValue(args: string[]): string | null {
  const result = spawnSync("git", args, { encoding: "utf8", timeout: 15_000 })
  if (result.status !== 0 || typeof result.stdout !== "string") return null
  return result.stdout.trim()
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "run"
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
}

/** Runs one gate command and returns the verdict record (without recordPath). */
export async function runGate(parsed: ParsedArgs): Promise<RunVerdict> {
  const command = parsed.cmd !== null ? [parsed.cmd] : parsed.argv
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const env = { ...process.env, ...parsed.env }
  const gitHead = gitValue(["rev-parse", "HEAD"])
  const dirty = gitValue(["status", "--porcelain"])
  const gitDirtyFiles = dirty === null ? null : dirty === "" ? 0 : dirty.split("\n").filter((l) => l.length > 0).length

  const spawnOptions: Parameters<typeof spawn>[1] = {
    cwd: parsed.cwd,
    env,
    shell: parsed.cmd !== null,
    stdio: ["ignore", "pipe", "pipe"],
  }
  const child = spawn(command[0]!, parsed.cmd !== null ? [] : command.slice(1), spawnOptions)
  let stdout = ""
  let stderr = ""
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      child.kill("SIGKILL")
    } catch {
      // the child may already be gone; the exit event still fires
    }
  }, parsed.timeoutMs)
  if (typeof timer.unref === "function") timer.unref()

  const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
      if (stdout.length > MAX_CAPTURE_BYTES * 4) stdout = stdout.slice(-MAX_CAPTURE_BYTES * 2)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
      if (stderr.length > MAX_CAPTURE_BYTES * 4) stderr = stderr.slice(-MAX_CAPTURE_BYTES * 2)
    })
    child.on("error", reject)
    child.on("close", (code, signal) => resolve({ code, signal }))
  }).finally(() => clearTimeout(timer))

  const out = capture(stdout)
  const err = capture(stderr)
  const endedAt = new Date().toISOString()
  const durationMs = Date.now() - started

  let verdict: Verdict
  if (timedOut) verdict = "TIMEOUT"
  else if (exit.code === 0) verdict = parsed.expectRed ? "UNEXPECTED_PASS" : "PASS"
  else verdict = parsed.expectRed ? "RED_CONFIRMED" : "FAIL"

  return {
    schemaVersion: 1,
    label: parsed.label!,
    command,
    shell: parsed.cmd !== null,
    cwd: parsed.cwd,
    startedAt,
    endedAt,
    durationMs,
    timedOut,
    exitCode: exit.code,
    signal: exit.signal,
    verdict,
    expectRed: parsed.expectRed,
    gitHead,
    gitDirtyFiles,
    bbDataDir: env.BB_DATA_DIR ?? null,
    stdout: out.text,
    stderr: err.text,
    stdoutBytes: out.bytes,
    stderrBytes: err.bytes,
    stdoutTruncated: out.truncated,
    stderrTruncated: err.truncated,
  }
}

export function isVerdictOk(verdict: Verdict): boolean {
  return verdict === "PASS" || verdict === "RED_CONFIRMED"
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.error) {
    console.error(`verify-fix-campaign: ${parsed.error}`)
    console.error("usage: --label <name> [--json] [--out <dir>] [--cwd <dir>] [--env K=V]... [--timeout-ms N] [--expect-red] -- <command...>")
    process.exit(2)
  }
  if (!parsed.label) {
    console.error("verify-fix-campaign: --label is required")
    process.exit(2)
  }
  const command = parsed.cmd !== null ? [parsed.cmd] : parsed.argv
  if (command.length === 0 || (command[0] ?? "").trim() === "") {
    console.error("verify-fix-campaign: no command given (use `-- <command...>` or `--cmd \"<shell>\"`)")
    process.exit(2)
  }
  if (!existsSync(parsed.cwd)) {
    console.error(`verify-fix-campaign: --cwd does not exist: ${parsed.cwd}`)
    process.exit(2)
  }
  const outDir = path.resolve(parsed.out)
  mkdirSync(outDir, { recursive: true })

  const record = await runGate(parsed)
  const safeLabel = sanitizeLabel(parsed.label)
  const recordPath = path.join(outDir, `${stamp()}-${safeLabel}.json`)
  record.recordPath = recordPath
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8")
  appendFileSync(
    path.join(outDir, "index.ndjson"),
    JSON.stringify({
      label: record.label,
      verdict: record.verdict,
      exitCode: record.exitCode,
      durationMs: record.durationMs,
      gitHead: record.gitHead,
      recordPath,
    }) + "\n",
    "utf8",
  )
  if (parsed.json) {
    console.log(JSON.stringify(record, null, 2))
  } else {
    console.log(
      `[verifier] ${record.label}: ${record.verdict} (exit=${String(record.exitCode)}, ${(record.durationMs / 1000).toFixed(1)}s) -> ${recordPath}`,
    )
    if (!isVerdictOk(record.verdict)) {
      const tail = record.stdout.trim().split("\n").slice(-12).join("\n")
      if (tail) console.log(`[verifier] last output:\n${tail}`)
    }
  }
  process.exitCode = isVerdictOk(record.verdict) ? 0 : 1
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href : false
if (isMain) {
  main().catch((error) => {
    console.error(`verify-fix-campaign: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  })
}

// Kept exported for tests/gates that want to inspect a previously recorded run.
export function readVerdict(recordPath: string): RunVerdict {
  return JSON.parse(readFileSync(recordPath, "utf8")) as RunVerdict
}
