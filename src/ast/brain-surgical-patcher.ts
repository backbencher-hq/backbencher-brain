import * as fs from "fs"
import { execSync } from "child_process"
import * as path from "path"

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

    // Auto-Format
    if (format) {
      BrainSurgicalPatcher.tryAutoFormat(absolutePath)
    }

    return true
  }

  static async tryAutoFormat(absolutePath: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const ext = path.extname(absolutePath)
        const cwd = path.dirname(absolutePath)

        // M66: keep the file's OWN line ending. These formatters are invoked with
        // their defaults, and the defaults are LF: prettier's `endOfLine` defaults
        // to "lf", so `prettier --write` on a CRLF file rewrote EVERY line ending
        // to LF. bb_edit's splice was already fixed to emit the file's line ending,
        // but the formatter ran afterwards and undid it — so a CRLF file still
        // came back LF-only, and (before the splice fix) mixed. A formatter is
        // supposed to normalise style, not to rewrite a whole file's line endings
        // behind the caller's back.
        //
        // The fix is per-formatter, and each is passed the detected ending:
        //   prettier  --end-of-line auto  → prettier keeps the file's first line
        //                                  ending rather than forcing "lf".
        //   black/ruff already preserve the ending they read; nothing to pass.
        //   gofmt / rustfmt / clang-format preserve endings natively.
        let endOfLine = ""
        try {
          const head = fs.readFileSync(absolutePath).subarray(0, 4096).toString("utf8")
          const crlf = (head.match(/\r\n/g) ?? []).length
          const lf = (head.match(/(?<!\r)\n/g) ?? []).length
          if (crlf > lf) endOfLine = " --end-of-line crlf"
          else if (crlf > 0 && lf === 0) endOfLine = " --end-of-line crlf"
        } catch { /* cannot read: leave the formatter default, it is best-effort */ }

        let cmd = ""
        if ([".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".md"].includes(ext)) {
          cmd = `npx prettier --write${endOfLine} "${absolutePath}"`
        } else if (ext === ".rs") {
          cmd = `rustfmt "${absolutePath}"`
        } else if (ext === ".go") {
          cmd = `gofmt -w "${absolutePath}"`
        } else if ([".c", ".cpp", ".h", ".hpp"].includes(ext)) {
          cmd = `clang-format -i "${absolutePath}"`
        } else if (ext === ".py") {
          cmd = `black "${absolutePath}" || ruff format "${absolutePath}"`
        }

        if (!cmd) return resolve()

        import("child_process").then(({ exec }) => {
          // Timeout after 1.5s to prevent hanging
          const child = exec(cmd, { cwd, timeout: 1500 }, () => {
            resolve()
          })
        })
      } catch (err) {
        resolve()
      }
    })
  }
}
