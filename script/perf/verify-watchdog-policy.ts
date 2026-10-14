// verify-watchdog-policy.ts — the per-file watchdog must not kill healthy workers
// for a window the PARENT spent blocked.
//
// This is the regression for the measured incident of 2026-10-08: a full index
// killed 99 workers in bursts of exactly SEVEN (the whole pool) at one timestamp,
// every 3-5 minutes, while the machine sat at load 4.1 on 8 cores and the same
// files parsed in 82-520 ms in-process. The workers never touch SQLite; the parent
// does, synchronously, so one long `flushDbBatch` expired every in-flight timer at
// once and the pool died as a unit — each death costing a retried batch and a
// fresh Node + WASM startup. The run took 151 minutes against a ~30 minute healthy
// rate.
//
//   npx tsx script/perf/verify-watchdog-policy.ts
//
// It is pure: no pool, no child process, no database.

import { decideWatchdog, WATCHDOG_MAX_DEFERRALS, WATCHDOG_MIN_STALL_MS, type WatchdogClock } from "../../src/ast/watchdog-policy"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}

const TIMEOUT = 45_000
const now = 1_800_000_000_000

function clock(over: Partial<WatchdogClock> = {}): WatchdogClock {
  return { now, lastStallMs: 0, lastStallEndedAt: 0, timeoutMs: TIMEOUT, deferrals: 0, ...over }
}

console.log("watchdog policy — an expired timer is only evidence about a worker when the parent could observe it")

// ---- the incident -----------------------------------------------------------------
{
  // All seven workers are mid-batch when the parent blocks for 60s in a store.
  // Every timer expires during that block, and all seven callbacks run the moment
  // the loop frees. Not one of them is a worker failure.
  const blockedForMs = 60_000
  const stallEndedAt = now // the loop just came back; the callbacks run together
  const decisions = Array.from({ length: 7 }, () =>
    decideWatchdog(clock({ lastStallMs: blockedForMs, lastStallEndedAt: stallEndedAt })),
  )
  check(
    "the measured incident: 7 simultaneous expiries during one parent stall defer 7 and kill 0",
    decisions.filter((d) => d.action === "defer").length === 7,
    JSON.stringify(decisions),
  )
}

// ---- a genuinely hung worker must still die ---------------------------------------
check(
  "responsive parent, worker silent past its window -> kill",
  decideWatchdog(clock({ lastStallMs: 0, lastStallEndedAt: 0 })).action === "kill",
)
check(
  "a stall shorter than half the window does not excuse the worker -> kill",
  decideWatchdog(clock({ lastStallMs: TIMEOUT * 0.4, lastStallEndedAt: now })).action === "kill",
)
check(
  "a stall that ended more than one full window ago -> kill (the worker had a responsive window since)",
  decideWatchdog(clock({ lastStallMs: 60_000, lastStallEndedAt: now - TIMEOUT - 1 })).action === "kill",
)
check(
  `the deferral cap (${WATCHDOG_MAX_DEFERRALS}) still kills, so a repeating stall cannot mask a hang`,
  decideWatchdog(clock({ lastStallMs: 60_000, lastStallEndedAt: now, deferrals: WATCHDOG_MAX_DEFERRALS })).action === "kill",
)

// ---- boundaries -------------------------------------------------------------------
const required = Math.max(WATCHDOG_MIN_STALL_MS, TIMEOUT * 0.5)
check(
  `a stall exactly at the required threshold (${required}ms) defers`,
  decideWatchdog(clock({ lastStallMs: required, lastStallEndedAt: now })).action === "defer",
)
check(
  "one millisecond below the threshold kills",
  decideWatchdog(clock({ lastStallMs: required - 1, lastStallEndedAt: now })).action === "kill",
)
check(
  "a deferral below the cap still defers",
  decideWatchdog(clock({ lastStallMs: 60_000, lastStallEndedAt: now, deferrals: WATCHDOG_MAX_DEFERRALS - 1 })).action === "defer",
)
check(
  "the threshold never falls below the noise floor on a short timeout",
  decideWatchdog(clock({ timeoutMs: 500, lastStallMs: WATCHDOG_MIN_STALL_MS, lastStallEndedAt: now })).action === "defer",
)

// ---- the reason is reported, so a log can be read --------------------------------
{
  const deferred = decideWatchdog(clock({ lastStallMs: 60_000, lastStallEndedAt: now }))
  const killed = decideWatchdog(clock())
  check(
    "a deferral names the parent, a kill names the worker",
    deferred.action === "defer" && deferred.reason === "parent-event-loop-blocked" && killed.action === "kill",
    `${JSON.stringify(deferred)} / ${JSON.stringify(killed)}`,
  )
}

console.log(failures === 0 ? "\nWATCHDOG POLICY: ALL PASS" : `\nWATCHDOG POLICY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
