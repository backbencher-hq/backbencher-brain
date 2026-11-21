// src/cli/exit-guard.ts
//
// A command must EXIT when its work is done.
//
// Reported by the owner on bettercap (1,972 files): the index printed its whole report
// ending at `consistency: every internal relationship is attached to a symbol`, and
// then sat there — "i had to press ctrl c after at least 2 minutes of waiting".
//
// The CLI sets `process.exitCode` instead of calling `process.exit()`, which is the
// right default: it lets buffered stdout flush and lets in-flight writes finish. The
// cost is that ANY handle still on the event loop — a worker thread, a socket, an
// interval nobody cleared — keeps the process alive after the work is complete, with no
// output to say why. A hang with no diagnosis is the worst shape this can take, because
// the user cannot tell it from slowness.
//
// So the exit is made DETERMINISTIC here: once a command has printed its report, the
// process exits with its own exit code after stdout drains. Two properties keep that
// safe:
//
//  · stdout is flushed BEFORE exiting, because turning a fixed hang into truncated
//    piped output would be a worse bug than the one being fixed;
//  · the watchdog that covers a stdout that never drains is `unref()`d, so it can never
//    be the reason a healthy process stays alive — it can only end a wait that
//    something else is already prolonging.
//
// What this does NOT do is name the culprit. Node 22 reports stdio and sockets through
// `_getActiveHandles()` but NOT timers — measured: a process holding one live interval
// reports `[Socket, Socket]`. Claiming to identify the handle would be a false
// diagnostic, so the handle list is printed only when `BB_EXIT_DIAGNOSTICS=1` asks.

/**
 * Names of whatever is still keeping the event loop alive — DIAGNOSTICS ONLY, and
 * explicitly incomplete (see the note above: timers are invisible here).
 */
function describeLiveHandles(): string[] {
  const labels = new Set<string>()
  try {
    for (const handle of (process as any)._getActiveHandles?.() ?? []) {
      const name = handle?.constructor?.name ?? typeof handle
      // stdio is always present and is never the cause.
      if (name === "Socket" || name === "WriteStream") continue
      labels.add(name)
    }
    const requests = (process as any)._getActiveRequests?.() ?? []
    if (requests.length > 0) labels.add(`${requests.length} pending request(s)`)
  } catch {
    // Diagnostics must never be the thing that fails.
  }
  return [...labels]
}

/**
 * Exit once stdout is flushed. Call at the END of a command that has finished its work
 * and printed its report.
 *
 * Do NOT call from a long-lived command (the MCP server) — those are meant to stay up.
 *
 * `BB_EXIT_WATCHDOG_MS` bounds the wait for a stdout that never drains (default 5000,
 * 0 disables the watchdog). `BB_EXIT_DIAGNOSTICS=1` prints what was still open.
 */
export function exitWhenDone(command: string): void {
  const code = process.exitCode ?? 0

  // A CLOSED OUTPUT PIPE MUST NOT BE AN ERROR.
  //
  // This guard ends the process, so it can end it while stdout still has a write in flight to
  // a pipe whose reader has gone — CI log capture, `| head`, a host that stops reading. Node
  // raises EPIPE on the socket, and with no listener that is an UNHANDLED 'error' event: the
  // process dies with a stack instead of the exit code it was given. Measured on CI:
  //
  //   Error: write EPIPE
  //   Emitted 'error' event on Socket instance
  //   ##[error]Process completed with exit code 1
  //
  // A CLI whose reader closed the pipe has not failed at anything, so EPIPE on stdio is
  // swallowed here. Any other stream error is also non-fatal for the same reason: the report
  // has already been printed, and the exit code is the command's own.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err: any) => {
      if (err?.code === "EPIPE" || err?.code === "ERR_STREAM_DESTROYED") return
      // Nothing useful can be done with a broken output stream, and throwing here would turn
      // a completed command into a crash.
      void err
    })
  }

  if (process.env.BB_EXIT_DIAGNOSTICS === "1") {
    const handles = describeLiveHandles()
    const detail = handles.length > 0
      ? ` (still open at exit: ${handles.join(", ")})`
      : " (no non-stdio handles reported; timers are not visible to this check)"
    process.stderr.write(`bb: ${command} finished its work; exiting with code ${code}${detail}\n`)
  }

  let exited = false
  const finish = (): void => {
    if (exited) return
    exited = true
    process.exit(code)
  }

  try {
    process.stdout.write("", () => finish())
  } catch {
    finish()
  }

  const rawMs = Number(process.env.BB_EXIT_WATCHDOG_MS ?? 5000)
  const ms = Number.isFinite(rawMs) && rawMs >= 0 ? rawMs : 5000
  if (ms === 0) return

  const watchdog = setTimeout(() => {
    if (exited) return
    process.stderr.write(
      `bb: ${command} finished its work but the process did not exit within ${ms}ms ` +
        `(stdout did not drain, or a handle is held); forcing the exit. ` +
        `Re-run with BB_EXIT_DIAGNOSTICS=1 to see what was still open.\n`,
    )
    finish()
  }, ms)
  // The whole point: the guard must not itself be the reason the process stays alive.
  watchdog.unref?.()
}
