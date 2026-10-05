// script/m24/no-inline-position-arithmetic.ts — the §5 RULE 1 lint (M24 lane 4).
//
// Contract §5: "No feature code converts positions inline; all conversion goes
// through the mapping component" (src/lsp/positions.ts). That rule was prose
// until this file. The bypass it forbids was found live in
// src/lsp/navigation.ts:228-238 (a hand-rolled 1-based-byte-column ->
// 0-based-UTF-16 walk plus a `jsCol -= 0` no-op) — and because that walk is
// behaviorally ALMOST right, no oracle on results ever sees it. A source-level
// lint is the only gate that can.
//
// SCOPE — stated plainly, because a lint that looks broader than it is is its
// own lie. These are the bypass PRIMITIVES, not all arithmetic on a number:
//   P1 Buffer.byteLength(        — byte arithmetic outside the owner
//   P2 charCodeAt / codePointAt  — surrogate handling outside the owner
//   P3 the owner's PRIVATE converters, called from anywhere but positions.ts
//   P4 a byte-accumulating walk over a line's code units
//   P5 a surrogate-range literal outside the owner
// A lint claiming to forbid "position arithmetic" would have to forbid `x - 1`
// on an array index, which is not a position conversion and is not what §5
// means. What §5 means is: nobody outside positions.ts computes a BYTE column,
// a UTF-16 column, or inspects a surrogate. That is exactly this list.
//
// The file list is DATA-DRIVEN (readdirSync over src/lsp) so a new module is
// covered the moment it lands, and findings are reported as findings with a
// file:line and the matched rule — never as prose.

import { readFileSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"

export interface PositionFinding {
  /** repo-relative path, posix-separated */
  file: string
  /** 1-based line number */
  line: number
  /** the rule id, e.g. "P1" */
  rule: string
  /** what the rule forbids, in words */
  law: string
  /** the offending source line, trimmed */
  text: string
}

/** The ONE module permitted to touch bytes and surrogates. */
export const POSITION_OWNER = "src/lsp/positions.ts"

interface Rule {
  id: string
  law: string
  /** the pattern whose presence outside the owner is a finding */
  pattern: RegExp
  /** comments and string literals are prose, not code — skip them */
  codeOnly: boolean
}

const RULES: Rule[] = [
  {
    id: "P1",
    law: "byte arithmetic (Buffer.byteLength) belongs to the position mapper; feature code reads positions through it",
    pattern: /\bBuffer\.byteLength\s*\(/,
    codeOnly: true,
  },
  {
    id: "P2",
    law: "surrogate handling (charCodeAt/codePointAt) belongs to the position mapper",
    pattern: /\.(charCodeAt|codePointAt)\s*\(/,
    codeOnly: true,
  },
  {
    id: "P3",
    law: "the mapper's private converters are private: only positions.ts calls them",
    pattern: /\b(utf16OffsetToByteOffset|byteOffsetToUtf16Offset)\s*\(/,
    codeOnly: true,
  },
  {
    id: "P4",
    law: "a byte-accumulating walk over a line's code units is the bypass §5 rule 1 forbids",
    pattern: /Buffer\.byteLength\s*\(\s*\w+\s*\[\s*\w+\s*\]\s*,/,
    codeOnly: true,
  },
  {
    id: "P5",
    law: "surrogate-range literals belong to the position mapper's boundary validation",
    pattern: /0x(d800|dbff|dc00|dfff)/i,
    codeOnly: true,
  },
]

/** Strip line comments and block comments and string/template literals so a
 *  rule cannot fire on prose that NAMES a forbidden construct (this file's own
 *  header names several). Replaces the contents with spaces, keeping offsets. */
function stripNonCode(source: string): string {
  const out = source.split("")
  let i = 0
  const n = source.length
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " "
  }
  while (i < n) {
    const c = source[i]
    const next = source[i + 1]
    if (c === "/" && next === "/") {
      let j = i
      while (j < n && source[j] !== "\n") j++
      blank(i, j)
      i = j
    } else if (c === "/" && next === "*") {
      let j = i + 2
      while (j < n && !(source[j] === "*" && source[j + 1] === "/")) j++
      j = Math.min(j + 2, n)
      blank(i, j)
      i = j
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (source[j] === "\\") {
          j += 2
          continue
        }
        if (source[j] === quote) {
          j++
          break
        }
        j++
      }
      blank(i, j)
      i = j
    } else {
      i++
    }
  }
  return out.join("")
}

/**
 * The lint. `files` is a list of repo-relative paths; the file list is built by
 * the caller (readdirSync) so it covers whatever is on disk right now.
 * A finding is a violation of the owner's exemption, or — for the owner itself
 * — never: the owner is exempt by construction.
 */
export function noInlinePositionArithmetic(files: Array<{ path: string; text: string }>): PositionFinding[] {
  const findings: PositionFinding[] = []
  for (const file of files) {
    if (file.path === POSITION_OWNER) continue
    if (file.path.endsWith(".d.ts")) continue
    const rawLines = file.text.split("\n")
    // Strip ONCE over the whole source, then split: a block comment or a
    // template literal spanning lines must not leave its middle lines looking
    // like code. Stripping line-by-line would.
    const codeLines = stripNonCode(file.text).split("\n")
    for (const rule of RULES) {
      if (!rule.codeOnly) continue
      codeLines.forEach((code, idx) => {
        if (!rule.pattern.test(code)) return
        findings.push({
          file: file.path,
          line: idx + 1,
          rule: rule.id,
          law: rule.law,
          text: (rawLines[idx] ?? "").trim().slice(0, 160),
        })
      })
    }
  }
  // Stable order so the evidence regenerates byte-identically.
  findings.sort((a, b) => (a.file === b.file ? a.line - b.line || a.rule.localeCompare(b.rule) : a.file.localeCompare(b.file)))
  return findings
}

/** Every TypeScript file under `dir`, repo-relative and posix-separated. */
export function listLspSources(repoRoot: string, dir = join(repoRoot, "src", "lsp")): Array<{ path: string; text: string }> {
  const names = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()
  return names.map((f) => ({
    path: relative(repoRoot, join(dir, f)).split(sep).join("/"),
    text: readFileSync(join(dir, f), "utf8"),
  }))
}