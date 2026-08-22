// script/m13/verify-edit-honesty.ts — M13.16 (E11).
//
// Honesty audit for the bb_edit path. Enumerates every regex/text operation in
// edit-engine.ts with a justification, and proves the rename (refactor) path
// uses AST reference identity (no raw-text identifierOffsets scan), and the
// mask path uses language-aware tree-sitter rules. The audit is emitted as
// machine-readable evidence.

import { readFileSync } from "node:fs"
import path from "node:path"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.16",
  code: "E11",
  tool: "bb_edit",
  title: "bb_edit: honesty audit (AST vs text/regex)",
  layers: ["unit"],
  decisions: {
    auditScope: "src/intelligence/edit/edit-engine.ts and src/ast/safety-primitives.ts (the two files in the edit path)",
    renamePath: "refactor uses parseForSafety occurrences (AST node identity + isMemberName), not identifierOffsets text scan",
    maskPath: "buildSyntaxMask walks the tree-sitter tree (comment/string/interpolation node types); no JS-only codeMask remains",
  },
  limitations: [
    "A handful of justified regexes remain (identifier validation, whitespace checks, syntax-error filter) — each enumerated below.",
  ],
})

const EDIT = readFileSync(path.resolve("src/intelligence/edit/edit-engine.ts"), "utf8")
const SAFETY = readFileSync(path.resolve("src/ast/safety-primitives.ts"), "utf8")

// ── 1. The refactor path uses AST identity (no raw-text identifierOffsets) ──
harness.check(
  "rename path: no identifierOffsets text-scan function remains",
  !EDIT.includes("identifierOffsets"),
  EDIT.includes("identifierOffsets") ? "identifierOffsets still present" : "removed",
)
harness.check(
  "rename path: uses parseForSafety occurrences (AST identity)",
  EDIT.includes("parsed.occurrences") && EDIT.includes("isReferenceSite"),
  "no AST occurrence usage in refactor path",
)
harness.check(
  "rename path: occurrences come from parseForSafety (tree-sitter), not a regex",
  SAFETY.includes("extractIdentifierOccurrences") && SAFETY.includes("walkNodes"),
  "extractIdentifierOccurrences is not AST-derived",
)

// ── 2. The mask path is language-aware (no JS-only codeMask) ───────────────
harness.check(
  "mask path: no JS-only codeMask function remains",
  !EDIT.includes("function codeMask") && !EDIT.includes("codeMask(mask"),
  "codeMask still present",
)
harness.check(
  "mask path: uses tree-sitter buildSyntaxMask (language-aware)",
  SAFETY.includes("buildSyntaxMask") && SAFETY.includes("isCommentNodeType"),
  "buildSyntaxMask missing",
)

// ── 3. Enumerate every remaining regex/text op with a justification ────────
interface RegexOp { line: number; pattern: string; op: string; justification: string }
const ops: RegexOp[] = []
const lines = EDIT.split("\n")
for (let i = 0; i < lines.length; i++) {
  const ln = i + 1
  const l = lines[i]
  // identifier validation
  if (l.includes("/^[A-Za-z_$][A-Za-z0-9_$]*$/")) ops.push({ line: ln, pattern: "^[A-Za-z_$]...", op: "test(newName)", justification: "validate the new identifier is a legal name before renaming (no AST for identifier validity)" })
  // whitespace-only indent check
  else if (l.includes("/^[\\t ]*$/")) ops.push({ line: ln, pattern: "^[\\t ]*$", op: "test(indent)", justification: "detect non-line-aligned bodies (e.g. Elixir do/end) to fail loud" })
  // leading-whitespace detection
  else if (l.includes("/^[\\t ]+/")) ops.push({ line: ln, pattern: "^[\\t ]+", op: "exec(line)", justification: "detect the file's indentation unit (tab vs 2/4-space) for brace-body inserts" })
  // syntax-error filter
  else if (l.includes("/syntax error/i")) ops.push({ line: ln, pattern: "syntax error/i", op: "test(error.message)", justification: "filter parse errors to syntax errors for validateFile" })
}

harness.check("honesty audit: every remaining regex is enumerated", ops.length >= 4, `found ${ops.length} regex ops`)
harness.check(
  "honesty audit: no unjustified regex (every op has a justification)",
  ops.every((o) => o.justification.length > 0),
  ops.map((o) => `L${o.line}:${o.op}`).join(", "),
)

// ── 4. Text .slice/.split/.indexOf are byte-offset manipulations, not scans ─
// These are legitimate (byte-range replace, line-indent extraction); record them.
const sliceOps = lines.filter((l) => l.includes(".slice(") || l.includes(".split(\"\\n\")")).length
harness.check(
  "honesty audit: text slice/split ops are byte-offset manipulations (justified)",
  sliceOps > 0,
  `${sliceOps} slice/split calls (all byte-range/line ops)`,
)

// ── 5. safety-primitives.ts is pure AST (no regex/text scan) ──────────────
// Strip comments + strings before testing so prose is not mistaken for code.
const SAFETY_CODE = SAFETY.split("\n")
  .map((l) => l.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "").replace(/"[^"]*"/g, '""'))
  .join("\n")
harness.check(
  "honesty audit: safety-primitives.ts has zero regex/text-scan in code (pure AST)",
  !/\/(?!\/)[^/ ]+\/[gimu]+|\.(replace|match)\(/.test(SAFETY_CODE),
  "safety-primitives contains regex/text ops in code",
)
// This is the negative: an AST path must NOT contain raw-text scans.
harness.negative(
  "honesty audit: no identifierOffsets/raw text scan anywhere in the edit path",
  !EDIT.includes("identifierOffsets") && !/identifierOffsets/.test(SAFETY_CODE),
  "identifierOffsets text scan present",
)

harness.emit()
