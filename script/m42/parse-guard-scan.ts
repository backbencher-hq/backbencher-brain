// script/m42/parse-guard-scan.ts — the RECURRENCE SCAN for the bug class
// "an LSP handler calls parseForSafety unguarded, so an unroutable file
// becomes a -32603 wire error".
//
// Why a scan and not another try/catch. The guard belongs in the handler that
// owns the declared-absence tier (each surface has its OWN absence vocabulary:
// document_highlight returns "not_indexed" / "ambiguous", hover returns null),
// so the guard cannot move up into one shared helper without losing the tier.
// What CAN be shared is the RULE — "no LSP surface may call parseForSafety
// unguarded" — and a rule nobody checks is a rule that decays. This scan is
// that check, and it is the part of the fix that survives a third handler
// being written tomorrow.
//
// It reads SOURCE, not behaviour, so it covers every surface in src/lsp/
// including ones no fixture exercises. The behavioural half of the same bug
// class lives in verify-highlight.ts (R6/M5); this is the structural half.
//
// Scope note (honest): this is a lexical check over `try {` blocks. It cannot
// prove a handler's catch clause does the RIGHT thing — only that the call has
// some guard. The behavioural gate owns that half. A handler that swallows the
// parse failure and then fabricates highlights would pass this scan and fail
// R2/R6.

import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

/** The identifier whose unguarded call is the defect class. */
const PARSE_FN = "parseForSafety"

export interface UnguardedCall {
  /** 1-based line of the call. */
  line: number
  /** The source line, trimmed, for the failure message. */
  text: string
}

/**
 * True when `index` (an offset into `src`) sits lexically inside a `try {`
 * block: scanning backwards, the nearest unmatched `{` must be opened by a
 * `try`, not by an `if`/`for`/`while`/function body. Braces inside strings,
 * comments and template literals are counted as if present — a false "inside a
 * try" is possible on source containing brace-bearing string literals, and
 * this is declared rather than defended against: the gate is a floor against
 * the common shape, and the behavioural gate is the authority.
 */
function insideTryBlock(src: string, index: number): boolean {
  let depth = 0
  for (let i = index - 1; i >= 0; i--) {
    const ch = src[i]
    if (ch === "}" || ch === ")" || ch === "]") {
      depth++
      continue
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      if (depth === 0) {
        // The opener for this call's enclosing block. `try {` is the only
        // accepted form; `catch {`/`finally {` open a sibling, not a guard.
        return /\btry\s*$/.test(src.slice(Math.max(0, i - 6), i))
      }
      depth--
      continue
    }
  }
  return false
}

/** Every `parseForSafety(` call site in `source` that is not inside a `try`. */
export function unguardedParseCallSites(source: string): UnguardedCall[] {
  const out: UnguardedCall[] = []
  const lines = source.split("\n")
  // Offset of the first character of each line, so a found index maps to a line.
  const lineStarts: number[] = []
  let off = 0
  for (const l of lines) {
    lineStarts.push(off)
    off += l.length + 1
  }
  const re = new RegExp(`\\b${PARSE_FN}\\s*\\(`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    // An import specifier is not a call site.
    if (/\bfrom\s*$/.test(source.slice(Math.max(0, m.index - 12), m.index))) continue
    if (insideTryBlock(source, m.index)) continue
    let lineIdx = 0
    while (lineIdx + 1 < lineStarts.length && lineStarts[lineIdx + 1]! <= m.index) lineIdx++
    out.push({ line: lineIdx + 1, text: lines[lineIdx]!.trim() })
  }
  return out
}

/** Recursively every .ts file under `dir` (sorted, so output is deterministic). */
export function tsFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const p = path.join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p))
    else if (entry.endsWith(".ts")) out.push(p)
  }
  return out
}

/**
 * Scan a directory of LSP sources. Returns one entry per UNGUARDED call, each
 * naming its file — an empty array is the passing state.
 */
export function scanDirectoryForUnguardedParses(dir: string): Array<{ file: string; call: UnguardedCall }> {
  const out: Array<{ file: string; call: UnguardedCall }> = []
  for (const file of tsFilesUnder(dir)) {
    for (const call of unguardedParseCallSites(readFileSync(file, "utf8"))) {
      out.push({ file: path.relative(dir, file), call })
    }
  }
  return out
}