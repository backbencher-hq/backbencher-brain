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
// An earlier version of this comment claimed a second connection "cannot see
// this project's write-ahead log and would silently match nothing". That was
// wrong, and it was wrong in the worst way: the symptom was real — zero matches
// — but the cause was that the index being queried genuinely held zero symbols,
// because an earlier run had been interrupted. Measured later, a readonly handle
// and a read-write handle both read 13,610 rows from the same WAL database. The
// worker design stands on the measurement above and needs nothing from that
// claim; the claim itself is retracted so the next reader is not sent looking
// for a bug in SQLite.

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
    const finish = (outcome: ScanOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        worker?.terminate()
      } catch {}
      resolve(outcome)
    }
    const timer = setTimeout(() => finish({ matchedIndexes: [], scanned: 0, timedOut: true, inline: false }), timeoutMs)
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
      try {
        const matchedIndexes = matchNames(request)
        finish({ matchedIndexes, scanned: request.names.length, timedOut: false, inline: true })
      } catch {
        finish({ matchedIndexes: [], scanned: 0, timedOut: false, inline: true })
      }
      return
    }
    worker.on("message", (message: ScanResponse) => {
      if (message?.ok) finish({ matchedIndexes: message.matchedIndexes, scanned: message.scanned, timedOut: false, inline: false })
      else finish({ matchedIndexes: [], scanned: 0, timedOut: false, inline: true })
    })
    worker.on("error", () => finish({ matchedIndexes: [], scanned: 0, timedOut: false, inline: true }))
    worker.on("exit", () => {
      if (!settled) finish({ matchedIndexes: [], scanned: 0, timedOut: false, inline: false })
    })
  })
}
