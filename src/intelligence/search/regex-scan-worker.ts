// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the isolated regex scan for bb_search's user-pattern
//   option: a worker body, the inline fallback that runs the SAME matching loop,
//   and a deadline that starts when the thread is online.
// WHICH TOOL IT SERVES — bb_search (read; `regex:true`, the documented regex
//   exception — a caller-supplied pattern is data, matched against indexed
//   symbol names only).
// WHY IT IS SHAPED THIS WAY — a single `test()` call on one name can take longer
//   than any cooperative check would catch, so the match runs in a worker the
//   parent can terminate. The clock starts on `online` because worker startup is
//   engine cost, not pattern cost: charging startup to the pattern made trivial
//   scans report a time-budget cut on a loaded machine. If isolation is
//   unavailable the answer runs inline and says so (`inline: true`), and a worker
//   that never comes online is treated as an isolation failure, not a timeout.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_search/work/regex-edge-tests.ts,
//   docs/BB_SEARCH.md; gates: script/verify-search-modes.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/regex-search.ts,
//   validation/tools/regex-allowlist.json, docs/BB_SEARCH.md.
// CONTRACTS IT MUST NOT BREAK — one matching implementation (worker body and
//   inline fallback are the same function), a hard kill on the matching budget,
//   and a truthful `timedOut` / `inline` outcome.
// ─────────────────────────────────────────────────────────────────────────────

// A regex scan that cannot be made to hang.
//
// `RegExp.prototype.test` has no timeout, and a nested-quantifier pattern on a
// short identifier is unbounded in practice. Measured on this machine, in a
// fresh process, one call on ONE name:
//
//   (a+)+b  vs  "a"*30                      > 15,000ms  (killed)
//   (a+)+b  vs  "pre_handleRequestInner"       2,076ms
//   (a+)+b  vs  "handleRequestExact"             235ms
//
// So a deadline checked between rows is NOT protection: a single row can exceed
// any budget, and the MCP server is one stdio thread that also owns the
// database handle. An agent calling `{ regex: true, query: "(a+)+b" }` freezes
// the process — not just the call, the whole server.
//
// The only correct fix is isolation with a hard kill. The MATCHING runs in a
// worker thread that the parent terminates on a deadline, and the DATABASE READ
// stays on the caller's connection because it is bounded and measured (~1s for
// 20k rows).
//
// The database read stays on the caller's connection deliberately: a separate
// connection is not required for WAL visibility (a readonly handle and a
// read-write one read the same rows), and keeping it on the caller's handle keeps
// the candidate read inside the same transaction discipline as the rest of the
// answer. Isolation is needed for the MATCHING, which is the only unbounded part.

import { Worker, parentPort, workerData } from "node:worker_threads"

/** What the parent needs to answer after a scan. */
export type ScanOutcome = {
  /** Indices into the names array the pattern matched, in scan order. */
  matchedIndexes: number[]
  /** Rows the scan actually looked at. */
  scanned: number
  /** True when the deadline fired and the worker was killed. */
  timedOut: boolean
  /** True when no worker could be started and the scan ran inline. */
  inline: boolean
}

export type ScanRequest = {
  pattern: string
  caseSensitive: boolean
  /** Candidate names, index-aligned with whatever the caller holds. */
  names: string[]
}

export type ScanResponse = { ok: true; matchedIndexes: number[]; scanned: number } | { ok: false; error: string }

/**
 * The matching loop, and nothing else.
 *
 * Split out so the same function is both the worker's body and the inline
 * fallback: there is ONE implementation of the unbounded operation, not two
 * that can diverge.
 */
export function matchNames(request: ScanRequest): number[] {
  const expression = new RegExp(request.pattern, request.caseSensitive ? "" : "i")
  const matched: number[] = []
  const names = request.names
  for (let i = 0; i < names.length; i++) {
    if (expression.test(names[i]!)) matched.push(i)
  }
  return matched
}

if (parentPort && workerData && (workerData as { __regexScanWorker?: boolean }).__regexScanWorker) {
  const request = (workerData as { request: ScanRequest }).request
  try {
    const matchedIndexes = matchNames(request)
    parentPort.postMessage({ ok: true, matchedIndexes, scanned: request.names.length } satisfies ScanResponse)
  } catch (error: any) {
    parentPort.postMessage({ ok: false, error: error?.message ?? String(error) } satisfies ScanResponse)
  }
}

/**
 * Match with a hard wall-clock limit.
 *
 * `timeoutMs` bounds the WHOLE match, including the pathological single call,
 * because the worker is terminated rather than asked politely. On a timeout the
 * outcome is empty and DECLARED-bounded — never a partial answer presented as
 * complete.
 */
export function scanWithDeadline(request: ScanRequest, timeoutMs: number): Promise<ScanOutcome> {
  return new Promise<ScanOutcome>((resolve) => {
    let settled = false
    let worker: Worker | null = null
    let budgetTimer: ReturnType<typeof setTimeout> | null = null
    const timers: Array<ReturnType<typeof setTimeout>> = []
    const finish = (outcome: ScanOutcome) => {
      if (settled) return
      settled = true
      for (const timer of timers) clearTimeout(timer)
      try {
        worker?.terminate()
      } catch {}
      resolve(outcome)
    }
    /**
     * The worker did not produce a scan result: run the ONE matching loop here.
     *
     * `matchNames` is the same function the worker body calls, so this is not a
     * second implementation. It runs only when the worker could not be created,
     * failed to start, or exited without a message — i.e. when isolation is
     * unavailable, which the outcome declares (`inline: true`).
     */
    const runInline = () => {
      if (settled) return
      try {
        const matchedIndexes = matchNames(request)
        finish({ matchedIndexes, scanned: request.names.length, timedOut: false, inline: true })
      } catch {
        finish({ matchedIndexes: [], scanned: 0, timedOut: false, inline: true })
      }
    }
    try {
      worker = new Worker(new URL(import.meta.url), {
        workerData: { __regexScanWorker: true, request },
        // A catastrophic regex can exhaust the stack, and an uncaught exception
        // in a worker must not take the server with it.
        stdout: true,
        stderr: true,
      })
    } catch {
      // No worker available (restricted environment). The inline path is the one
      // that can hang, so the caller is told the answer was NOT isolated.
      runInline()
      return
    }
    /**
     * Start the matching budget when the thread is ONLINE, not before.
     *
     * The timer used to be armed at construction, so worker-thread startup (load
     * the chunk and its import graph inside the thread) was charged against the
     * PATTERN's budget. On a loaded machine a trivial `^handle.*` scan over 41
     * names reported "scan was cut short (time-budget)" and answered "no results"
     * on about 3 of 10 consecutive runs. Startup is engine cost, not pattern
     * cost, so the clock starts at the moment matching can begin.
     */
    const startBudget = () => {
      if (settled || budgetTimer !== null) return
      budgetTimer = setTimeout(
        () => finish({ matchedIndexes: [], scanned: 0, timedOut: true, inline: false }),
        timeoutMs,
      )
      timers.push(budgetTimer)
    }
    worker.on("online", startBudget)
    worker.on("message", (message: ScanResponse) => {
      if (message?.ok) finish({ matchedIndexes: message.matchedIndexes, scanned: message.scanned, timedOut: false, inline: false })
      else runInline()
    })
    worker.on("error", () => runInline())
    worker.on("exit", () => {
      if (!settled) runInline()
    })
    // A worker that never comes online cannot be running the pattern: it is not
    // a time-budget hit, it is an isolation failure. Bound startup separately so
    // the answer says which one happened instead of blaming the pattern.
    timers.push(
      setTimeout(() => {
        if (!settled && budgetTimer === null) runInline()
      }, Math.max(1000, timeoutMs)),
    )
  })
}
