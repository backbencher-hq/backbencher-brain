// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the regex policy gate for tool code. It parses the tool
//   sources with the TypeScript AST (never a text scan) and enforces three rules:
//     1. a NEW regex literal or `RegExp(...)` construction is a failure;
//     2. a regex accepted as unavoidable must be in validation/tools/regex-allowlist.json
//        with a written reason and an existing edge-case test file;
//     3. an allowlist row that no longer matches a real use, or whose test file is
//        missing/empty, is a failure — the list cannot rot into an allowlist.
// WHY THIS SHAPE — the analyzer layer's own no-regex gate once reported 187 uses
//   where an AST census found 5, because a text scan counts strings and comments.
//   One arbiter per question: this gate walks syntax nodes, so a regex-shaped
//   string is not a use and a real literal is never hidden inside a comment.
// WHERE ITS EVIDENCE LIVES — validation/tools/regex-policy.json (every run),
//   validation/tools/regex-baseline.json (the debt register this gate freezes).
// EDIT TOGETHER WHEN THIS FILE CHANGES — validation/tools/regex-allowlist.json,
//   docs/tools-campaign/CHARTER.md §7.
// CONTRACTS IT MUST NOT BREAK — a green run must mean: zero unallowlisted new
//   regex, zero allowlist rows without tests, zero stale allowlist rows.
//
// Usage:
//   npx tsx script/tools/verify-regex-policy.ts                # gate (exit 1 on violation)
//   npx tsx script/tools/verify-regex-policy.ts --write-baseline  # freeze current debt
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import ts from "typescript"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SCAN_DIRS = ["src/mcp", "src/intelligence", "src/lsp", "src/brain", "src/security"]
const BASELINE_PATH = "validation/tools/regex-baseline.json"
const ALLOWLIST_PATH = "validation/tools/regex-allowlist.json"
const EVIDENCE_PATH = "validation/tools/regex-policy.json"

interface RegexUse {
  file: string
  kind: "literal" | "constructor"
  source: string
  line: number
}

interface AllowlistRow {
  file: string
  match: string
  reason: string
  testFile: string
}

interface BaselineRow {
  file: string
  kind: string
  source: string
  firstSeenCommit: string
}

function walk(dir: string, out: string[]): void {
  const abs = path.join(ROOT, dir)
  if (!existsSync(abs)) return
  for (const entry of readdirSync(abs)) {
    const rel = path.join(dir, entry)
    const st = statSync(path.join(ROOT, rel))
    if (st.isDirectory()) walk(rel, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(rel.split(path.sep).join("/"))
  }
}

function scanFile(rel: string, out: RegexUse[]): void {
  const text = readFileSync(path.join(ROOT, rel), "utf8")
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      const literal = node as ts.RegularExpressionLiteral
      out.push({ file: rel, kind: "literal", source: literal.text, line: lineOf(node) })
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === "RegExp" && node.arguments && node.arguments.length > 0) {
        const first = node.arguments[0]
        const value = ts.isStringLiteralLike(first) ? first.text : ts.isTemplateExpression(first) ? "<template>" : "<dynamic>"
        out.push({ file: rel, kind: "constructor", source: value, line: lineOf(node) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

function key(row: { file: string; kind: string; source: string }): string {
  return `${row.file}::${row.kind}::${row.source}`
}

function loadJson<T>(rel: string, fallback: T): T {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs)) return fallback
  return JSON.parse(readFileSync(abs, "utf8")) as T
}

function writeJson(rel: string, value: unknown): void {
  const abs = path.join(ROOT, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, JSON.stringify(value, null, 2) + "\n")
}

const files: string[] = []
for (const dir of SCAN_DIRS) walk(dir, files)
const uses: RegexUse[] = []
for (const file of files) scanFile(file, uses)
console.log(`scanned ${files.length} tool source files; found ${uses.length} regex uses`)

const allowlist = loadJson<{ schemaVersion?: number; note?: string; entries: AllowlistRow[] }>(ALLOWLIST_PATH, {
  schemaVersion: 1,
  note: "Regex accepted as unavoidable in tool code. Every row needs a written reason and an existing edge-case test file (charter §7).",
  entries: [],
})
const baseline = loadJson<{ schemaVersion?: number; note?: string; commit?: string; entries: BaselineRow[] }>(
  BASELINE_PATH,
  { schemaVersion: 1, note: "Regex debt frozen at campaign start. Pay it down or promote a row to the allowlist with tests.", commit: "", entries: [] },
)

const head = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
})()

if (process.argv.includes("--write-baseline")) {
  const allowCount = allowlist.entries.length
  const rows: BaselineRow[] = uses
    .filter((use) => !allowlist.entries.some((row) => row.file === use.file && row.match === use.source))
    .map((use) => ({ file: use.file, kind: use.kind, source: use.source, firstSeenCommit: head }))
  writeJson(BASELINE_PATH, {
    schemaVersion: 1,
    note: "Regex debt frozen at campaign start. Pay it down or promote a row to the allowlist with tests.",
    commit: head,
    generatedAt: new Date().toISOString(),
    entries: rows.sort((a, b) => key(a).localeCompare(key(b))),
  })
  console.log(`baseline written: ${rows.length} rows (allowlist had ${allowCount} explicit rows; they are excluded from debt)`)
  process.exit(0)
}

const allowKeys = new Map(allowlist.entries.map((row) => [`${row.file}::${row.match}`, row]))
const baselineKeys = new Set(baseline.entries.map((row) => key(row)))

const newUses: RegexUse[] = []
const baselinedUses: RegexUse[] = []
const allowedUses: RegexUse[] = []
for (const use of uses) {
  const allow = allowKeys.get(`${use.file}::${use.source}`)
  if (allow) allowedUses.push(use)
  else if (baselineKeys.has(key(use))) baselinedUses.push(use)
  else newUses.push(use)
}

const staleAllow: AllowlistRow[] = []
const allowWithoutTest: string[] = []
for (const row of allowlist.entries) {
  const seen = uses.some((use) => use.file === row.file && use.source === row.match)
  if (!seen) staleAllow.push(row)
  const testAbs = path.join(ROOT, row.testFile)
  if (!row.testFile || !existsSync(testAbs) || readFileSync(testAbs, "utf8").trim().length === 0) {
    allowWithoutTest.push(`${row.file} :: ${row.match} -> ${row.testFile || "<no test file>"}`)
  }
}

let failed = 0
if (newUses.length > 0) {
  failed++
  console.log("\nFAIL — new regex use not in the allowlist (charter §7):")
  for (const use of newUses) console.log(`  ${use.file}:${use.line}  [${use.kind}] ${use.source.slice(0, 120)}`)
}
if (staleAllow.length > 0) {
  failed++
  console.log("\nFAIL — allowlist rows that no longer match a real use (remove them):")
  for (const row of staleAllow) console.log(`  ${row.file} :: ${row.match.slice(0, 120)}`)
}
if (allowWithoutTest.length > 0) {
  failed++
  console.log("\nFAIL — allowlisted regex with no edge-case test file (charter §7):")
  for (const row of allowWithoutTest) console.log(`  ${row}`)
}

const staleBaseline = baseline.entries.filter((row) => !uses.some((use) => key(use) === key(row)))
writeJson(EVIDENCE_PATH, {
  schemaVersion: 1,
  status: failed === 0 ? "verified" : "violations",
  currentCommit: head,
  scannedFiles: files.length,
  regexUses: uses.length,
  allowlisted: allowedUses.length,
  baselinedDebt: baselinedUses.length,
  newUses,
  staleAllow,
  allowWithoutTest,
  staleBaseline: staleBaseline.map((row) => key(row)),
  generatedAt: new Date().toISOString(),
})
console.log(
  `\nREGEX POLICY: ${failed === 0 ? "PASS" : failed + " VIOLATION GROUP(S)"} — ` +
    `${allowedUses.length} allowlisted, ${baselinedUses.length} frozen debt, ` +
    `${newUses.length} new, ${staleBaseline.length} baseline rows now paid`,
)
process.exit(failed === 0 ? 0 : 1)
