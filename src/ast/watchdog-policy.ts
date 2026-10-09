/**
 * watchdog-policy.ts — when is an expired per-file watchdog a WORKER failure, and
 * when is it the PARENT's fault?
 *
 * MEASURED on this repository (2026-10-08, full index, `--force`): 99 workers
 * were killed in a single run, and they died in bursts of exactly SEVEN — the
 * whole pool — at the same timestamp, every 3-5 minutes:
 *
 *     7 killed at 21:13:29      7 at 21:24:47      7 at 21:37:30
 *     7 killed at 21:17:53      7 at 21:32:10      (99 total)
 *
 * The workers never touch SQLite: they parse and `process.send` their results,
 * and the PARENT stores them synchronously through better-sqlite3. Parsing those
 * same files in-process took 82-520 ms, and the machine was idle all along
 * (load average 4.1 on 8 cores), so no worker was slow. What happened is that a
 * `flushDbBatch` blocked the parent's event loop for longer than
 * `fileTimeoutMs`: the per-file timers of every in-flight batch expired DURING
 * that block, and the moment the loop came back, all seven expired callbacks ran
 * and killed seven healthy workers.
 *
 * The cost is not the 45 s wait — it is the work. Each killed worker's batch is
 * retried, and its replacement re-pays Node + WASM grammar startup. A full index
 * that should take ~30 minutes at the measured healthy rate (0.165 s/file,
 * profile-stages n200) took 151.
 *
 * So an expired timer is only evidence about a worker if the PARENT was able to
 * observe it. This module is that rule, kept pure so it can be exercised without
 * a pool, a child process or a database: `script/perf/verify-watchdog-policy.ts`.
 */

/** How often the parent samples its own event-loop lateness. */
export const WATCHDOG_TICK_MS = 250

/** A lateness below this is scheduling noise, not a block. */
export const WATCHDOG_MIN_STALL_MS = 1000

/**
 * How many times one batch may be deferred before the worker is killed anyway.
 * A genuinely hung worker still has to die: without a cap, a stall that repeats
 * forever would mask it.
 */
export const WATCHDOG_MAX_DEFERRALS = 3

/**
 * The share of the timeout window the parent must have spent blocked before a
 * worker is excused. Half is deliberately conservative: below it, the worker had
 * at least half its budget with a responsive parent and did not use it.
 */
export const WATCHDOG_STALL_FRACTION = 0.5

export interface WatchdogClock {
  /** Epoch ms at which the watchdog fired. */
  now: number
  /** Duration of the most recent observed block of the parent's event loop. */
  lastStallMs: number
  /** Epoch ms at which that block ended. */
  lastStallEndedAt: number
  /** The configured per-file timeout. */
  timeoutMs: number
  /** Deferrals already granted to THIS batch. */
  deferrals: number
}

export type WatchdogDecision =
  | { action: "kill"; reason: "deferral-cap" | "stall-too-short" | "no-recent-stall" }
  | { action: "defer"; reason: "parent-event-loop-blocked" }

/**
 * Decide what an expired watchdog means. Pure: no clock, no timers, no state.
 */
export function decideWatchdog(clock: WatchdogClock): WatchdogDecision {
  if (clock.deferrals >= WATCHDOG_MAX_DEFERRALS) {
    return { action: "kill", reason: "deferral-cap" }
  }

  const requiredMs = Math.max(WATCHDOG_MIN_STALL_MS, clock.timeoutMs * WATCHDOG_STALL_FRACTION)
  if (clock.lastStallMs < requiredMs) {
    return { action: "kill", reason: "stall-too-short" }
  }

  // A block that ended longer ago than a whole timeout window cannot explain
  // THIS expiry: the worker has had a full responsive window since and did not
  // report. That is a worker problem.
  if (clock.now - clock.lastStallEndedAt > clock.timeoutMs) {
    return { action: "kill", reason: "no-recent-stall" }
  }

  return { action: "defer", reason: "parent-event-loop-blocked" }
}
