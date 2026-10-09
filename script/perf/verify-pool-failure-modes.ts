#!/usr/bin/env npx tsx
/**
 * verify-pool-failure-modes.ts — the pool's two fail-open paths, injected for real.
 *
 * Why this exists
 * ---------------
 * An audit of the worker pool found two ways a whole index run could be lost:
 *
 *   A. A worker's IPC channel can fail ASYNCHRONOUSLY (send() returns true, the
 *      write then dies with EPIPE). With no `error` listener on the child, that
 *      unhandled event kills the PARENT — the entire run, not the worker.
 *   B. A worker that exits BEFORE signalling `ready` never advanced the startup
 *      counter (the `exit` handler disarms the startup watchdog first), so the
 *      restart cap could never be reached and the pool forked replacements
 *      forever: nothing parsed, nothing reported, the run simply hung.
 *
 * Both are claims about behaviour under fault, so they are tested by INJECTING the
 * faults into a real `bb index` run — not by asserting on a policy function:
 *
 *   S3  control              no injection — proves the harness can see a healthy run
 *   S1  die-before-ready     pool workers exit before `ready` (the fork-probe is let
 *                            through, or the indexer correctly falls back in-process)
 *   S2  crash-on-batch       every worker dies on its first batch (the EPIPE window)
 *
 * The contracts, which are what make this gate falsifiable:
 *
 *   S3  all files parsed, zero errors, zero startup failures
 *   S1  the run TERMINATES (an unbounded fork loop does not), the fork count stays
 *       within a small bound of the pool size, and the failure is VISIBLE in the
 *       run's own accounting
 *   S2  the parent survives (no unhandled-IPC signature in stderr), every file is
 *       accounted for as parsed-or-errored, and a follow-up run recovers whatever
 *       the crashes cost — nothing is permanently lost
 *
 * Usage: npx tsx script/perf/verify-pool-failure-modes.ts [--files N] [--keep]
 * Exit:  0 all contracts hold, 1 otherwise.
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs"
import path from "node:path"

const REPO = process.cwd()
const SCRATCH = path.join(REPO, ".pool-faults")
const HOOK = path.join(REPO, "script", "perf", "fixtures", "exit-before-ready.cjs")

const args = process.argv.slice(2)
const fileCount = Number(args.includes("--files") ? args[args.indexOf("--files") + 1] : 30)
const keep = args.includes("--keep")
// Run one scenario only. Used to capture before/after evidence for a single
// contract without paying for the others (the pre-fix fork storm is slow to kill).
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null
const wants = (s: string) => only === null || only === s

// The pool sizes itself as max(2, min(cpus-1, 12)); the bound below is generous on
// purpose — the contract is "bounded", and the measured pre-fix behaviour is not
// merely large, it does not stop: 1,064 worker processes in 100 seconds, with no
// completion line, against 9 with the fix.
const FORK_BOUND = 32
const RUN_TIMEOUT_MS = 120_000
// How many leading pool-worker invocations are the indexer's own PROBE(s) and must
// be allowed through. Measured: with 1 the probe itself is killed, the indexer
// correctly falls back to in-process, and the pool path under test is never
// entered — the gate then "passes" while measuring nothing. 2 is the value at
// which "worker pool available" appears.
const SURVIVE_FIRST = 2

let failures = 0
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

interface RunResult {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  ms: number
  timedOut: boolean
  workerStarts: number
}

/** One real `bb index` run against the scratch project, under whatever env is given. */
function runIndex(
  label: string,
  env: Record<string, string>,
  dataDir: string,
  projectDir: string,
  useWorkerCounter = false,
): Promise<RunResult> {
  const counterFile = path.join(SCRATCH, `workers-${label}.count`)
  writeFileSync(counterFile, "0")
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "src/cli/index.ts", "index", projectDir, "--no-setup"], {
      cwd: REPO,
      env: {
        ...process.env,
        BB_DATA_DIR: dataDir,
        ...env,
        // LAST, so a scenario cannot overwrite the counter path by accident — it
        // did once, and the gate then measured a run with no injection at all and
        // reported it as a pass.
        ...(useWorkerCounter ? { BB_TEST_WORKER_COUNTER: counterFile } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so that a timeout can kill the run AND every worker
      // it forked. Without this the pre-fix fork storm keeps the parent's stdio
      // pipes open after the parent is SIGKILLed and the harness waits forever for
      // a 'close' that cannot come.
      detached: true,
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { process.kill(-child.pid!, "SIGKILL") } catch {
        try { child.kill("SIGKILL") } catch {}
      }
    }, RUN_TIMEOUT_MS)
    child.stdout.on("data", (d) => { stdout += d.toString() })
    child.stderr.on("data", (d) => { stderr += d.toString() })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      let workerStarts = 0
      try { workerStarts = Number(readFileSync(counterFile, "utf8")) || 0 } catch {}
      resolve({ code, signal, stdout, stderr, ms: Date.now() - started, timedOut, workerStarts })
    })
  })
}

/** Parse the CLI's own breakdown line, which is the run's accounting of every file. */
function parseBreakdown(out: string): { parsed: number; errors: number; timeouts: number; unchanged: number } | null {
  const line = out.split("\n").find((l) => l.includes("breakdown:"))
  if (!line) return null
  const num = (re: RegExp) => Number((line.match(re)?.[1] ?? "0").replace(/,/g, ""))
  return {
    parsed: num(/([\d,]+) newly parsed/),
    unchanged: num(/([\d,]+) unchanged/),
    errors: num(/([\d,]+) errors/),
    timeouts: num(/([\d,]+) timeouts/),
  }
}

function makeProject(dir: string, n: number) {
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < n; i++) {
    writeFileSync(
      path.join(dir, `mod${String(i).padStart(3, "0")}.ts`),
      [
        `export interface Shape${i} { id: number; name: string }`,
        ``,
        `export class Widget${i} implements Shape${i} {`,
        `  id = ${i}`,
        `  name = "widget-${i}"`,
        `  render(): string { return helper${i}(this.name) }`,
        `}`,
        ``,
        `export function helper${i}(s: string): string { return s.trim() }`,
        ``,
      ].join("\n"),
    )
  }
}

async function main() {
  console.log(`\nPOOL FAILURE MODES — ${fileCount} files per scenario, injected faults, real runs\n`)
  rmSync(SCRATCH, { recursive: true, force: true })
  const projectDir = path.join(SCRATCH, "project")
  makeProject(projectDir, fileCount)

  // ── S3: control ────────────────────────────────────────────────────────────
  if (wants("s3")) {
  console.log("── S3 control: no injected fault (proves the harness sees a healthy run)")
  {
    const r = await runIndex("control", {}, path.join(SCRATCH, "data-control"), projectDir)
    const b = parseBreakdown(r.stdout)
    check("the control run completes", !r.timedOut && r.code === 0, `exit ${r.code} in ${(r.ms / 1000).toFixed(1)}s`)
    check("every file was parsed", !!b && b.parsed === fileCount, JSON.stringify(b))
    check("no errors and no timeouts in the control", !!b && b.errors === 0 && b.timeouts === 0)
    if (!b) check("the CLI printed its accounting line", false, "no 'breakdown:' line found")
  }
  }

  // ── S1: workers die before ready ───────────────────────────────────────────
  if (wants("s1")) {
  console.log("\n── S1: every pool worker dies BEFORE `ready` (the fork-loop path)")
  {
    const r = await runIndex(
      "pre-ready",
      { NODE_OPTIONS: `--require ${HOOK}`, BB_TEST_SURVIVE_FIRST: String(SURVIVE_FIRST) },
      path.join(SCRATCH, "data-preready"),
      projectDir,
      true,
    )
    const b = parseBreakdown(r.stdout)
    // EXPERIMENT VALIDITY, not a contract: without this the gate can pass while
    // measuring nothing, because if the injection kills the indexer's own probe the
    // run correctly falls back to in-process and completes happily. Counting
    // processes past the probes proves pool workers really ran — true in both the
    // pre-fix and post-fix runs, so the verdict rests on the checks below it.
    const poolEntered = r.workerStarts > SURVIVE_FIRST + 1
    check(
      "the worker pool was actually entered (workers ran beyond the probes)",
      poolEntered,
      `${r.workerStarts} worker process(es) started, ${SURVIVE_FIRST} allowed through as probes`,
    )
    check(
      "the run TERMINATES instead of forking forever",
      !r.timedOut,
      r.timedOut
        ? `still alive after ${RUN_TIMEOUT_MS / 1000}s with ${r.workerStarts} workers started`
        : `finished in ${(r.ms / 1000).toFixed(1)}s`,
    )
    check("worker starts stay bounded", r.workerStarts <= FORK_BOUND, `${r.workerStarts} worker process(es) started (bound ${FORK_BOUND})`)
    const visible =
      /startup repeatedly failed/i.test(r.stderr) ||
      /worker pool unavailable \(startup failure\)/i.test(r.stderr) ||
      /worker pool unavailable \(startup failure\)/i.test(r.stdout) ||
      (!!b && b.errors > 0)
    check("the failure is visible in the run's own output", visible, visible ? "" : "no startup-failure signal found")
    check("not a single file is silently reported as success", !b || b.parsed + b.errors + b.timeouts >= fileCount, JSON.stringify(b))
  }
  }

  // ── S2: every worker dies on its first batch ───────────────────────────────
  if (wants("s2")) {
  console.log("\n── S2: every worker dies on its first batch (the async-IPC-write window)")
  {
    const dataDir = path.join(SCRATCH, "data-crashbatch")
    const r = await runIndex("crashbatch", { BB_WORKER_CRASH_ON_BATCH: "1" }, dataDir, projectDir)
    const unhandled =
      /ERR_IPC_CHANNEL_CLOSED/.test(r.stderr) ||
      /EPIPE/.test(r.stderr) ||
      /Unhandled 'error' event/.test(r.stderr) ||
      /uncaughtException/i.test(r.stderr)
    check(
      "the parent SURVIVES the crashes",
      !r.timedOut && !unhandled && (r.code === 0 || r.code === 1),
      r.timedOut ? "hung" : unhandled ? "unhandled IPC error in stderr" : `exit ${r.code}`,
    )
    const b = parseBreakdown(r.stdout)
    check(
      "every file is accounted for as parsed-or-errored",
      !!b && b.parsed + b.errors + b.timeouts + b.unchanged >= fileCount,
      JSON.stringify(b),
    )
    // Recovery: a clean follow-up run must resolve whatever the crashes cost.
    const r2 = await runIndex("recover", {}, dataDir, projectDir)
    const b2 = parseBreakdown(r2.stdout)
    check(
      "a follow-up run recovers everything the crashes cost",
      !!b2 && (b2.parsed + b2.unchanged) === fileCount,
      `follow-up: ${JSON.stringify(b2)}`,
    )
  }
  }

  console.log(
    failures === 0
      ? `\nPOOL FAILURE MODES: ALL PASS (3 scenarios; S1 is deterministic, S2 depends on winning the IPC race)\n`
      : `\nPOOL FAILURE MODES: ${failures} FAILURE(S)\n`,
  )
  if (!keep) rmSync(SCRATCH, { recursive: true, force: true })
  else console.log(`scratch kept at ${SCRATCH}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("harness error:", e)
  process.exit(1)
})
