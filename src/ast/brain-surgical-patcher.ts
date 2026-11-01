// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the formatter layer of bb_edit: resolve the formatter a
//   file's extension maps to, run it with an argv array under a time budget, and
//   report what actually happened in a measured FormatOutcome.
// WHICH TOOL IT SERVES — bb_edit, on the `format` option of every mode (write,
//   update, insert, delete, refactor, batch).
// WHY IT IS SHAPED THIS WAY — `formatted` is a measurement of the FILE, never
//   `request.format !== false` (the request restated as an outcome); every
//   outcome here is measured:
//   whether a formatter was mapped, whether it ran, whether it exited 0, and why
//   not when it did not. The binary is resolved from the nearest
//   node_modules/.bin walking up from the edited file and then from PATH, and it
//   is invoked with execFile — an argv array, no shell — so a FILE NAME can never
//   be interpreted as a command. The 1.5 s budget is a hard kill: a hung
//   formatter must not turn an edit into an unbounded wait. Line endings are the
//   file's, not the formatter's; the engine repairs a CRLF file a formatter
//   rewrote and declares it, which is why the ending helpers live next door.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_edit/artifacts/formatting.json;
//   gates: script/m13/verify-edit-unit.ts (the formatter contract: no mapping,
//   success, non-zero exit, timeout kill, PATH-scrubbed, format:false, dry run,
//   multi-file aggregate, a file NAME that must not execute).
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/edit/edit-engine.ts
//   (the caller that declares lineEndingRestored), docs/BB_EDIT.md,
//   script/tool-docs/curation/bb_edit.ts, and the unit gate.
// CONTRACTS IT MUST NOT BREAK — no shell; a missing formatter is reported, never
//   installed or improvised; the timeout kills the child; a formatter that ran and
//   exited 0 is the ONLY success; arguments never include the file's content or a
//   command string.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs"
import { execFile } from "child_process"
import * as path from "path"

/**
 * D5: what the formatter step actually DID, as opposed to what was asked for.
 *
 * `formatted` in an EditResult is a measurement, never `request.format !== false`
 * — a claim about the request, not the file. Measured shapes (recorded in
 * script/m71/probe-format-truth.ts): it is `true` for a `.rb` file only if a
 * formatter actually ran, which cannot happen because that extension has no
 * mapping at all; `true` on a machine with no prettier, where the step spent
 * 1573ms on an npx that could not install one; and `true` for a formatter that
 * exited 3, with `warnings: []`. Every caller who trusted the field was told a
 * file had been formatted while the bytes on disk were whatever the splice left.
 *
 * This is the measurement instead: whether a formatter process started at all,
 * which one, and whether it exited 0.
 */
export interface FormatOutcome {
  /** The formatter this extension maps to — and the one that ran, when one did.
   *  null means the extension has no formatter mapping at all, which is why
   *  `no formatter mapped for .rb` and `prettier not found` are different facts. */
  formatter: string | null
  /** True when a formatter process was actually started. */
  ran: boolean
  /** True when that process exited 0. False when it failed, timed out, or never ran. */
  ok: boolean
  /** One line explaining a non-ok outcome. */
  reason?: string
}

/** The formatter step's own budget. A formatter that has not returned by then is killed. */
const FORMAT_TIMEOUT_MS = 1500

export class BrainSurgicalPatcher {
  static async patch(
    absolutePath: string,
    startIndex: number,
    endIndex: number,
    newContent: string,
    isDelete: boolean = false,
    format: boolean = true,
  ): Promise<boolean> {
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`[BrainSurgicalPatcher] File not found: ${absolutePath}`)
    }

    if (startIndex < 0 || endIndex < 0 || startIndex > endIndex) {
      throw new Error(`[BrainSurgicalPatcher] Invalid bounds: [${startIndex}, ${endIndex}]`)
    }

    const originalContent = fs.readFileSync(absolutePath, "utf8")

    if (endIndex > originalContent.length) {
      throw new Error(`[BrainSurgicalPatcher] endIndex (${endIndex}) exceeds file length (${originalContent.length})`)
    }

    let actualStart = startIndex
    let actualEnd = endIndex
    let finalContent = newContent

    if (isDelete) {
      // SMART DELETE: Cleanup surrounding whitespace

      // Look backwards to consume leading spaces/tabs on the same line
      while (actualStart > 0) {
        const char = originalContent[actualStart - 1]
        if (char === " " || char === "\t") {
          actualStart--
        } else {
          break
        }
      }

      // If we are now at the start of a line (or start of file)
      const isAtLineStart = actualStart === 0 || originalContent[actualStart - 1] === "\n"

      if (isAtLineStart) {
        // Look forwards to consume the trailing newline if the line is now empty
        if (actualEnd < originalContent.length && originalContent[actualEnd] === "\r") {
          actualEnd++
        }
        if (actualEnd < originalContent.length && originalContent[actualEnd] === "\n") {
          actualEnd++
        }
      }
    } else {
      // SMART PATCH (Update/Insert): Fix indentation if LLM provided flush-left code

      // Find base indentation of the target location
      let baseIndent = ""
      let tempStart = startIndex
      while (tempStart > 0) {
        const char = originalContent[tempStart - 1]
        if (char === "\n") break
        if (char === " " || char === "\t") {
          baseIndent = char + baseIndent
        } else {
          // If there are non-whitespace chars before the symbol on the same line,
          // the "base indent" is just the whitespace at the start of the line.
          baseIndent = ""
        }
        tempStart--
      }

      if (baseIndent.length > 0 && finalContent.includes("\n")) {
        const lines = finalContent.split("\n")

        // Check if LLM already provided indentation on the second line
        const secondLine = lines.length > 1 ? lines[1] : ""
        const hasOwnIndent = secondLine.startsWith(" ") || secondLine.startsWith("\t")

        if (!hasOwnIndent && secondLine.trim().length > 0) {
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim().length > 0) {
              lines[i] = baseIndent + lines[i]
            }
          }
          finalContent = lines.join("\n")
        }
      }
    }

    const before = originalContent.substring(0, actualStart)
    const after = originalContent.substring(actualEnd)

    const patchedContent = before + finalContent + after

    fs.writeFileSync(absolutePath, patchedContent, "utf8")

    // Auto-Format (best-effort: this legacy entry point has no caller to report to).
    if (format) {
      void BrainSurgicalPatcher.tryAutoFormat(absolutePath)
    }

    return true
  }

  /**
   * D5: the extension → formatter mapping, as data rather than a built shell string.
   *
   * The invocation is argv, never a command line that interpolates the path:
   * `exec(\`npx prettier --write "${absolutePath}"\`)`. Two consequences, both
   * measured before the rewrite (script/m71/probe-format-truth.ts):
   *
   *   1. `npx` without a local install is an INSTALL attempt. On a machine with no
   *      prettier it hit the network and was killed by the 1500ms timeout —
   *      1573ms of wall time per edited file, on a tool whose performance claim is
   *      "only affected files are written", with the result saying
   *      `formatted: true` regardless.
   *   2. A filename is not trusted input. `resolveSafeEditPath` validates
   *      containment, not characters, so a file NAMED `inj$(touch pwned).ts` is a
   *      legal in-project path — and the shell expanded the substitution. The
   *      marker file appeared; that is command execution triggered by the name of
   *      a file being formatted, through the public edit path.
   *
   * So the binary is resolved explicitly (nearest node_modules/.bin walking up from
   * the file, then PATH) and invoked with execFile: an argv array, no shell, and
   * nothing in the path can be expanded.
   */
  private static readonly FORMATTERS: ReadonlyArray<{ ext: string[]; candidates: ReadonlyArray<{ name: string; args: string[] }> }> = [
    { ext: [".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".md"], candidates: [{ name: "prettier", args: ["--write"] }] },
    { ext: [".rs"], candidates: [{ name: "rustfmt", args: [] }] },
    { ext: [".go"], candidates: [{ name: "gofmt", args: ["-w"] }] },
    { ext: [".c", ".cpp", ".h", ".hpp"], candidates: [{ name: "clang-format", args: ["-i"] }] },
    { ext: [".py"], candidates: [{ name: "black", args: [] }, { name: "ruff", args: ["format"] }] },
  ]

  /** Executable `<name>` in the nearest node_modules/.bin at or above `startDir`. */
  private static resolveInNodeModules(startDir: string, name: string): string | null {
    let dir = startDir
    for (;;) {
      const candidate = path.join(dir, "node_modules", ".bin", name)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      } catch { /* not here; keep walking up */ }
      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }

  /** Executable `<name>` on PATH. */
  private static resolveOnPath(name: string): string | null {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (!dir) continue
      const candidate = path.join(dir, name)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      } catch { /* not here */ }
    }
    return null
  }

  static async tryAutoFormat(absolutePath: string): Promise<FormatOutcome> {
    const ext = path.extname(absolutePath)
    const mapping = BrainSurgicalPatcher.FORMATTERS.find((m) => m.ext.includes(ext))
    if (!mapping) return { formatter: null, ran: false, ok: false, reason: `no formatter mapped for ${ext}` }
    const names = mapping.candidates.map((candidate) => candidate.name)

    // keep the file's OWN line ending. These formatters are invoked with
    // their defaults, and the defaults are LF: prettier's `endOfLine` defaults
    // to "lf", so `prettier --write` on a CRLF file rewrote EVERY line ending
    // to LF. bb_edit's splice was already fixed to emit the file's line ending,
    // but the formatter ran afterwards and undid it — so a CRLF file still
    // came back LF-only, and (before the splice fix) mixed. A formatter is
    // supposed to normalise style, not to rewrite a whole file's line endings
    // behind the caller's back.
    //
    // The fix is per-formatter, and each is passed the detected ending:
    //   prettier  --end-of-line crlf → prettier keeps the file's line ending
    //                                  rather than forcing "lf".
    //   black/ruff already preserve the ending they read; nothing to pass.
    //   gofmt / rustfmt / clang-format preserve endings natively.
    let endOfLine: string[] = []
    try {
      const head = fs.readFileSync(absolutePath).subarray(0, 4096).toString("utf8")
      const crlf = (head.match(/\r\n/g) ?? []).length
      const lf = (head.match(/(?<!\r)\n/g) ?? []).length
      if (crlf > lf || (crlf > 0 && lf === 0)) endOfLine = ["--end-of-line", "crlf"]
    } catch { /* cannot read: leave the formatter default, it is best-effort */ }

    let firstFailure: FormatOutcome | null = null
    for (const candidate of mapping.candidates) {
      const bin = BrainSurgicalPatcher.resolveInNodeModules(path.dirname(absolutePath), candidate.name)
        ?? BrainSurgicalPatcher.resolveOnPath(candidate.name)
      if (!bin) continue
      const args = [...candidate.args, ...(candidate.name === "prettier" ? endOfLine : []), absolutePath]
      const outcome = await new Promise<FormatOutcome>((resolve) => {
        execFile(bin, args, { cwd: path.dirname(absolutePath), timeout: FORMAT_TIMEOUT_MS, windowsHide: true }, (error, _stdout, stderr) => {
          if (!error) return resolve({ formatter: candidate.name, ran: true, ok: true })
          if (error.killed || error.signal) {
            return resolve({ formatter: candidate.name, ran: true, ok: false, reason: `${candidate.name} timed out after ${FORMAT_TIMEOUT_MS}ms` })
          }
          const code = error.code
          const detail = String(stderr ?? "").split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? error.message
          const how = typeof code === "number" ? `exited ${code}` : code === "ENOENT" ? "could not be started" : "failed"
          resolve({ formatter: candidate.name, ran: true, ok: false, reason: `${candidate.name} ${how}: ${detail.slice(0, 160)}` })
        })
      })
      if (outcome.ok) return outcome
      // `black || ruff` semantics are preserved: a candidate that RAN and failed
      // does not stop the list, but the FIRST real failure is what gets reported
      // when nothing succeeds — a later "not found" is not the interesting fact.
      if (!firstFailure) firstFailure = outcome
    }
    return firstFailure ?? {
      formatter: names[0] ?? null,
      ran: false,
      ok: false,
      reason: `no formatter found: tried ${names.join(", ")} in node_modules/.bin (walking up from the file) and on PATH`,
    }
  }
}
