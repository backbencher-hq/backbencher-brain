// script/m24/position-inline-gate.ts — the LANE-SCOPED source gate for
// "no feature code converts positions inline" (IDE Honesty Contract §5
// Rule 1), covering ONLY the two files this lane owns:
//
//   src/lsp/symbols.ts
//   src/lsp/call_hierarchy.ts
//
// WHY THIS EXISTS. The index stores 1-based lines and 1-based per-line BYTE
// columns; LSP speaks 0-based lines and UTF-16 code units. Every conversion
// belongs to src/lsp/positions.ts (the single owner). At this lane's HEAD all
// four of the emitters below bypassed it:
//
//   symbols.ts         line: Math.max(0, (row.line_start ?? 1) - 1)
//   call_hierarchy.ts  const start0 = Math.max(0, node.line - 1)
//                      const end0   = Math.max(start0, node.lineEnd - 1)
//                      { start: (symbol.line_start ?? 1) - 1, ... }
//                      { start: Math.max(0, node.line - 1), ... }
//   plus, in the same class: line0 + 1 and Buffer.byteLength(...) + 1, which
//   convert an LSP line back into an index line / an index byte column by hand.
//
// The `?? 1` is the sharper defect: it INVENTS line 1 for a row that stored no
// line at all, and the emitted LSP range then points at the top of the file
// with the confidence of a real answer (§15.3: never a fabricated line).
//
// SCOPE. Another lane owns the repo-wide version of this lint. This module is
// deliberately NOT it: it names no other file, imports no other lane's rule,
// and duplicates no registry — so the two cannot collide. The rule set here is
// expressed as an explicit list of FORBIDDEN SHAPES (not a heuristic "looks
// like arithmetic" scan), because a lint that cries wolf on legitimate clamp
// code is a lint that gets deleted.
//
// It is a LIBRARY, not a gate: it runs no checks and writes no record. The
// verifiers that own the two components (script/m24/verify-symbols.ts,
// script/m24/verify-call-hierarchy.ts) call `findInlinePositionArithmetic` on
// the real component source and on planted defects — the gate can therefore
// fail, and its failure is a real failure of those two gates.

/** The two files this gate is scoped to. Anything else is another lane's. */
export const INLINE_POSITION_GATE_FILES = [
  "src/lsp/symbols.ts",
  "src/lsp/call_hierarchy.ts",
] as const

export interface InlinePositionFinding {
  /** 1-based line number in the scanned source. */
  line: number;
  /** The offending source line, trimmed. */
  text: string;
  /** The stable name of the forbidden shape that matched. */
  shape: string
}

/**
 * One forbidden shape. `pattern` must not match a comment line: prose may
 * legitimately name `node.line - 1` while describing the bug it replaced.
 */
interface ForbiddenShape {
  name: string
  pattern: RegExp
}

/**
 * The forbidden shapes, in the order they are reported. Each is the textual
 * form of "a coordinate was converted outside the position owner":
 *
 *  A stored INDEX line walked one step toward LSP format (`.line - 1`,
 *    `.lineEnd - 1`, `line_start ?? 1) - 1`).
 *  A stored index line DEFAULTED into existence (`?? 1`) — the fabrication.
 *  A line window clamped into LSP format at the source (`Math.max(0, …line…)`),
 *    which is where `node.line - 1` hides once it is written indirectly.
 *  An LSP line walked back toward index format (`line0 + 1`).
 *  An index BYTE column manufactured by hand (`Buffer.byteLength(…) + 1`).
 */
const FORBIDDEN: ForbiddenShape[] = [
  { name: "index-line-minus-one", pattern: /\.\s*line(?:Start|End)?\s*-\s*1\b/ },
  { name: "index-line-minus-one", pattern: /\bline_(?:start|end)\b[^;\n]*?[-(]\s*1\b/ },
  { name: "fabricated-line-default", pattern: /\?\?\s*1\s*\)?\s*[-(]/ },
  // A clamp only counts when it CLAMPS A CONVERSION: `Math.max(0, x.line - 1)`.
  // `Math.max(0, lines0.start)` — clamping an already-0-based LSP window — is
  // legitimate bounds work and must not be flagged (a lint that cries wolf on
  // correct code is a lint that gets deleted).
  { name: "index-line-clamped-inline", pattern: /Math\.max\(\s*0\s*,\s*[^)]*-\s*1\b/ },
  { name: "lsp-line-plus-one", pattern: /\bline0\s*\+\s*1\b/ },
  { name: "handmade-byte-column", pattern: /Buffer\.byteLength\(.*\)\s*\+\s*1\b/ },
]

/** True for a line that is prose (a comment or a doc-block continuation). */
function isCommentLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*/")
  )
}

/**
 * Scan one component source for inline position conversion.
 *
 * @param source the component's TypeScript source
 * @param file   the path, used only in messages
 */
export function findInlinePositionArithmetic(
  source: string,
  file: string,
): InlinePositionFinding[] {
  const out: InlinePositionFinding[] = []
  const lines = source.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? ""
    const trimmed = raw.trim()
    if (trimmed === "" || isCommentLine(trimmed)) continue
    for (const shape of FORBIDDEN) {
      // A fresh RegExp per line: the patterns are module-level and a shared
      // lastIndex would make the scan order-dependent.
      const re = new RegExp(shape.pattern.source, shape.pattern.flags.replace("g", ""))
      const m = re.exec(raw)
      if (m !== null) {
        out.push({ line: i + 1, text: trimmed, shape: `${shape.name} (${file}:${i + 1})` })
        break
      }
    }
  }
  return out
}

/**
 * The planted defects that prove this gate can fail. Each is a real shape the
 * component shipped before this lane; each must be CAUGHT. A shape listed here
 * that the scan does not flag makes the gate's own self-test fail — which is
 * the point: a lint whose mutant set is empty proves nothing.
 */
export const GATE_SELF_TEST_SHAPES: Array<{ name: string; code: string }> = [
  { name: "symbols.ts: the `?? 1` fabrication", code: "    line: Math.max(0, (row.line_start ?? 1) - 1)," },
  { name: "call_hierarchy.ts: the clamped node line", code: "  const start0 = Math.max(0, node.line - 1);" },
  { name: "call_hierarchy.ts: the clamped node end line", code: "  const end0 = Math.max(start0, node.lineEnd - 1);" },
  { name: "call_hierarchy.ts: the clamped caller scan window", code: "      ? { start: Math.max(0, node.line - 1), end: Math.max(0, node.lineEnd - 1) }" },
  { name: "call_hierarchy.ts: the `?? 1` name-token window", code: "    { start: (symbol.line_start ?? 1) - 1, end: (symbol.line_end ?? 1) - 1 }," },
  { name: "call_hierarchy.ts: the LSP line walked back to index format", code: "          start: mapper.indexToLsp({ line: line0 + 1, column: startByte })," },
  { name: "call_hierarchy.ts: the hand-made index byte column", code: "      const startByte = Buffer.byteLength(line.slice(0, at), \"utf8\") + 1" },
]

/**
 * Run the gate's own self-test: every planted shape must be caught.
 * Returns the shapes that SURVIVED (empty = the gate can fail).
 */
export function selfTestSurvivors(): string[] {
  const survived: string[] = []
  for (const planted of GATE_SELF_TEST_SHAPES) {
    const findings = findInlinePositionArithmetic(planted.code, "planted.ts")
    if (findings.length === 0) survived.push(planted.name)
  }
  return survived
}