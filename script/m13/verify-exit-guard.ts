// script/m13/verify-exit-guard.ts
//
// Companion to verify-index-exits-when-provider-limits.ts.
//
// That gate drives a real `bb index` and asserts the process exits. This one pins the
// MECHANISM directly, because the failure it guards against cannot be reproduced on a
// small project: a handle left on the event loop keeps a CLI alive forever after its
// work is done. Reported by the owner on a 1,972-file run — full report printed, then
// it sat there until Ctrl+C.
//
// Three properties, and the middle one is the reason this is safe to ship:
//   1. a leaked handle is cut short, and the message NAMES it (so the next report is
//      actionable instead of "it hung");
//   2. a clean run is UNAFFECTED — same exit code, exits immediately, no warning,
//      because the watchdog is unref'd and never delays a healthy process;
//   3. a non-zero exitCode is preserved, so the guard cannot turn a failure into 0.

import { spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const ROOT = path.resolve(import.meta.dirname, "../..")
const SCRATCH = path.join(ROOT, ".tools/exit-guard")
const GUARD = path.join(ROOT, "src/cli/exit-guard.ts")
const TSX = path.join(ROOT, "node_modules/.bin/tsx")

console.log("M13 exit guard\n")
rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(SCRATCH, { recursive: true })

function runScenario(name: string, body: string, env: Record<string, string> = {}) {
  const file = path.join(SCRATCH, `${name}.ts`)
  writeFileSync(file, `import { exitWhenDone } from ${JSON.stringify(GUARD)}\n${body}\n`)
  const started = Date.now()
  const r = spawnSync(TSX, [file], {
    cwd: ROOT,
    encoding: "utf8",
    // A generous ceiling: the point is that the guard ends the wait, not that tsx is fast.
    timeout: 60_000,
    env: { ...process.env, ...env },
  })
  return { ...r, elapsedMs: Date.now() - started, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

// ── 1. a leaked handle is cut short and NAMED ────────────────────────────────
{
  const r = runScenario(
    "leak",
    `setInterval(() => {}, 1000)   // a handle nobody cleared: the hang
     process.exitCode = 0
     exitWhenDone("bb demo")`,
    { BB_EXIT_WATCHDOG_MS: "900" },
  )
  check("THE REPORTED DEFECT: a leaked handle does not hang the command", r.status === 0, `status=${r.status} elapsed=${r.elapsedMs}ms`)
  check("it exits promptly instead of waiting out the process", r.elapsedMs < 20_000, `${r.elapsedMs}ms`)
  // Deliberately NOT asserted: that the guard names the specific culprit. Node 22 does
  // not expose timers through _getActiveHandles() (measured: `[Socket, Socket]` while an
  // interval is live), so claiming to identify it would be a false diagnostic.
}

// ── 2. a clean run is unaffected ─────────────────────────────────────────────
{
  const r = runScenario(
    "clean",
    `process.exitCode = 0
     exitWhenDone("bb demo")`,
    { BB_EXIT_WATCHDOG_MS: "30000" },
  )
  check("a clean run exits without waiting for the watchdog", r.status === 0 && r.elapsedMs < 25_000, `status=${r.status} elapsed=${r.elapsedMs}ms`)
  check("a clean run prints NO warning", !/handle\(s\) were still open|forcing the exit/i.test(r.out), r.out.trim().slice(0, 200))
}

// ── 3. a failure stays a failure ────────────────────────────────────────────
{
  const r = runScenario(
    "fails",
    `process.exitCode = 3
     exitWhenDone("bb demo")`,
    { BB_EXIT_WATCHDOG_MS: "30000" },
  )
  check("a non-zero exitCode is preserved (the guard cannot report success)", r.status === 3, `status=${r.status}`)
}

// ── 3b. diagnostics are opt-in and truthful about their own limits ──────────
{
  const r = runScenario(
    "diag",
    `setInterval(() => {}, 1000)
     process.exitCode = 0
     exitWhenDone("bb demo")`,
    { BB_EXIT_DIAGNOSTICS: "1" },
  )
  check("BB_EXIT_DIAGNOSTICS=1 reports the exit", /finished its work; exiting with code 0/.test(r.out), r.out.trim().slice(0, 200))
  // The assertion is that it does not CLAIM to have identified the handle — not that the
  // word "timer" is absent, because the honest message says timers are invisible to the
  // check. (A first version asserted the word and failed on the guard's own honesty.)
  check(
    "it does NOT claim to have identified the handle it cannot see",
    !/still open at exit:/i.test(r.out) && /not visible|no non-stdio handles/i.test(r.out),
    r.out.trim().slice(0, 220),
  )
}

// ── 4. the watchdog can be disabled ─────────────────────────────────────────
{
  const r = runScenario(
    "disabled",
    `process.exitCode = 0
     exitWhenDone("bb demo")`,
    { BB_EXIT_WATCHDOG_MS: "0" },
  )
  check("BB_EXIT_WATCHDOG_MS=0 exits normally with no guard", r.status === 0 && !/forcing the exit/i.test(r.out), `status=${r.status}`)
}

rmSync(SCRATCH, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "EXIT GUARD: PASS" : `EXIT GUARD: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
