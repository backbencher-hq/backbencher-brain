// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_edit regex gate: an AST census of every regular
// expression the edit surface executes, compared against a reviewed snapshot.
// WHICH TOOL IT SERVES — bb_edit (mutability write, modes: write, update, insert,
// delete, refactor, batch).
// WHY IT IS SHAPED THIS WAY — the previous version of this verifier declared a
// local array of four patterns and asserted `runtimeRegexes.length === 4`; it
// never read a regex out of a source file and could not go red when a fifth was
// added. Measured with this gate's detector, the edit surface executes thirteen
// regex operations across two files, so the old "exactly 4" verdict was both
// unfalsifiable and wrong. This gate parses each file with the TypeScript AST
// (so a regex-shaped STRING or comment is not a use, and a literal is never
// hidden), compares the uses to `validation/tools/bb_edit/regex-surface.json`
// by file + kind + source with multiplicities, and fails on a new use, a stale
// snapshot row, a missing justification, or a file outside the reviewed list.
// It also cross-checks the repository's authoritative policy baseline for the shared
// files it covers, and a `--selftest` mode proves the detector sees literals,
// `new RegExp(...)` and misses strings/comments — the gate's own can-fail proof.
// WHERE ITS EVIDENCE LIVES — validation/m15/results/e2.json (this run), the
// snapshot next to it, validation/tools/regex-baseline.json (the policy baseline).
// EDIT TOGETHER WHEN THIS FILE CHANGES — validation/tools/bb_edit/regex-surface.json
// and the code files in SCAN_FILES.
// CONTRACTS IT MUST NOT BREAK — a green run means every regex executed by the
// edit surface is in the reviewed snapshot with a written reason, the snapshot
// has no rows the code no longer uses, and no new regex has appeared.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SNAPSHOT_PATH = path.join(ROOT, "validation/tools/bb_edit/regex-surface.json")
const BASELINE_PATH = path.join(ROOT, "validation/tools/regex-baseline.json")
const ALLOWLIST_PATH = path.join(ROOT, "validation/tools/regex-allowlist.json")
const EVIDENCE_PATH = path.join(ROOT, "validation/m15/results/e2.json")

/**
 * The files whose executed regexes this gate owns: the bb_edit code surface.
 * `src/mcp/tool-validation.ts` is deliberately absent — it belongs to the MCP
 * boundary layer, and the repository policy gate already scans all of `src/mcp`.
 */
const SCAN_FILES = [
  "src/intelligence/edit/edit-engine.ts",
  "src/ast/import-pruner.ts",
  "src/ast/brain-surgical-patcher.ts",
  "src/ast/safety-primitives.ts",
  "src/mcp/tools/bb_edit/handler.ts",
  "src/mcp/tools/bb_edit/descriptor.ts",
] as const

interface RegexUse { file: string; kind: "literal" | "constructor"; source: string; line: number }
interface SnapshotRow { file: string; kind: "literal" | "constructor"; source: string; reason: string }

let positive = 0
let positivePassed = 0
let negative = 0
let negativePassed = 0
let failed = 0
const checks: Array<{ name: string; pass: boolean; negative?: boolean; detail?: string }> = []

function ck(name: string, pass: boolean, detail = ""): void {
  positive++
  checks.push({ name, pass, detail })
  if (pass) positivePassed++
  else { failed++; console.log(`  FAIL: ${name}${detail ? " — " + detail : ""}`) }
}
function nk(name: string, pass: boolean, detail = ""): void {
  negative++
  checks.push({ name, pass, negative: true, detail })
  if (pass) negativePassed++
  else { failed++; console.log(`  FAIL: ${name} (negative)${detail ? " — " + detail : ""}`) }
}

/** Every regex literal and `RegExp(...)`/`new RegExp(...)` call in one source text. */
function detect(sourceText: string, fileName: string): RegexUse[] {
  const out: RegexUse[] = []
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      out.push({ file: fileName, kind: "literal", source: (node as ts.RegularExpressionLiteral).text, line: lineOf(node) })
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === "RegExp") {
        out.push({ file: fileName, kind: "constructor", source: node.getText(source).replace(/\s+/g, " "), line: lineOf(node) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

function census(): RegexUse[] {
  const uses: RegexUse[] = []
  for (const file of SCAN_FILES) {
    const text = readFileSync(path.join(ROOT, file), "utf8")
    uses.push(...detect(text, file))
  }
  return uses
}

function key(row: { file: string; kind: string; source: string }): string {
  return `${row.file}\u0000${row.kind}\u0000${row.source}`
}

function multiplicity(rows: Array<{ file: string; kind: string; source: string }>): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? 0) + 1)
  return out
}

function selftest(): void {
  const synthetic = [
    "const a = /^x$/g",
    'const b = "not a /regex/"',
    "// const c = /^comment$/",
    "const d = new RegExp('^' + name + '$')",
    "const e = RegExp(`y`)",
    "const f = x / y / z",
  ].join("\n")
  const found = detect(synthetic, "selftest.ts")
  nk("selftest: detects a regex literal", found.some((r) => r.kind === "literal" && r.source === "/^x$/g"), JSON.stringify(found))
  nk("selftest: detects `new RegExp(...)`", found.some((r) => r.kind === "constructor" && r.source.includes("new RegExp")), JSON.stringify(found))
  nk("selftest: detects the `RegExp(...)` call form", found.some((r) => r.kind === "constructor" && r.source.startsWith("RegExp(")), JSON.stringify(found))
  nk("selftest: a regex-shaped STRING is not counted as a use", !found.some((r) => r.source.includes("not a /regex/")), JSON.stringify(found))
  nk("selftest: a regex in a COMMENT is not counted as a use", !found.some((r) => r.source.includes("comment")), JSON.stringify(found))
  nk("selftest: division is not counted as a regex", found.length === 3, JSON.stringify(found.map((r) => r.source)))
  const planted = compare([{ file: SCAN_FILES[0], kind: "literal", source: "/planted/", line: 1 }], [])
  nk("selftest: the comparator fails on a planted use", planted.added.length === 1 && planted.added[0].source === "/planted/", JSON.stringify(planted))
  const stale = compare([], [{ file: SCAN_FILES[0], kind: "literal", source: "/gone/", reason: "a gone use" }])
  nk("selftest: the comparator fails on a stale snapshot row", stale.stale.length === 1, JSON.stringify(stale))
  nk("selftest: a snapshot row without a written reason fails", validateReasons([{ file: SCAN_FILES[0], kind: "literal", source: "/x/", reason: "  " }]).length === 1)
}

interface Diff { added: RegexUse[]; stale: SnapshotRow[]; countMismatch: string[] }
function compare(uses: RegexUse[], snapshot: SnapshotRow[]): Diff {
  const actual = multiplicity(uses)
  const expected = multiplicity(snapshot)
  const added: RegexUse[] = []
  const seen = new Map<string, number>()
  for (const use of uses) {
    const k = key(use)
    const seenCount = (seen.get(k) ?? 0) + 1
    seen.set(k, seenCount)
    if (seenCount > (expected.get(k) ?? 0)) added.push(use)
  }
  const stale: SnapshotRow[] = []
  const seenExpected = new Map<string, number>()
  for (const row of snapshot) {
    const k = key(row)
    const seenCount = (seenExpected.get(k) ?? 0) + 1
    seenExpected.set(k, seenCount)
    if (seenCount > (actual.get(k) ?? 0)) stale.push(row)
  }
  const countMismatch: string[] = []
  for (const [k, count] of expected) {
    const found = actual.get(k) ?? 0
    if (found !== count && found > 0) countMismatch.push(`${k.split("\u0000")[2]} expected ${count} found ${found}`)
  }
  return { added, stale, countMismatch }
}

function validateReasons(snapshot: SnapshotRow[]): string[] {
  return snapshot.filter((row) => !row.reason || row.reason.trim().length < 20).map((row) => `${row.file}: ${row.source}`)
}

const args = process.argv.slice(2)
const writeSnapshot = args.includes("--write-snapshot")
const uses: RegexUse[] = census()

if (args.includes("--selftest")) {
  selftest()
  emit("selftest-verified")
}

if (writeSnapshot) {
  const existing: SnapshotRow[] = existsSync(SNAPSHOT_PATH) ? (JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as { entries: SnapshotRow[] }).entries : []
  const byKey = new Map(existing.map((row) => [key(row), row]))
  const entries: SnapshotRow[] = uses.map((use) => ({
    file: use.file,
    kind: use.kind,
    source: use.source,
    reason: byKey.get(key(use))?.reason ?? "",
  }))
  mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true })
  writeFileSync(SNAPSHOT_PATH, JSON.stringify({ schemaVersion: 1, tool: "bb_edit", note: "Every regex the bb_edit surface executes, each with a written reason. Regenerate with --write-snapshot after reviewing a new use; an empty/short reason fails the gate.", entries }, null, 2) + "\n")
  ck("snapshot: written from the AST census", entries.length === uses.length, `${entries.length} entries`)
  emit("verified")
}

const snapshot = (JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as { entries: SnapshotRow[] }).entries
ck(
  "census: the snapshot names only files this gate owns and covers every file that has a use",
  snapshot.every((row) => (SCAN_FILES as readonly string[]).includes(row.file)) && uses.every((use) => snapshot.some((row) => row.file === use.file)),
  JSON.stringify([...new Set(snapshot.map((r) => r.file))]),
)
const diff = compare(uses, snapshot)
ck("census: no regex use outside the reviewed snapshot", diff.added.length === 0, JSON.stringify(diff.added))
ck("census: no stale snapshot row (every reviewed use still exists)", diff.stale.length === 0, JSON.stringify(diff.stale))
ck("census: multiplicities match", diff.countMismatch.length === 0, JSON.stringify(diff.countMismatch))
const unreasoned = validateReasons(snapshot)
ck("census: every reviewed use carries a written reason", unreasoned.length === 0, JSON.stringify(unreasoned))

// The snapshot carries reasons; these two directory-level rules hold regardless
// of any row's justification.
const prunerUses = uses.filter((use) => use.file.endsWith("import-pruner.ts"))
ck("rules: the import pruner executes no regex (no regex may rewrite source)", prunerUses.length === 0, JSON.stringify(prunerUses))
const safetyUses = uses.filter((use) => use.file.endsWith("safety-primitives.ts"))
ck("rules: safety-primitives (the code/comment/string classifier) executes no regex", safetyUses.length === 0, JSON.stringify(safetyUses))

if (existsSync(BASELINE_PATH) && existsSync(ALLOWLIST_PATH)) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { entries: Array<{ file: string; kind: string; source: string }> }
  const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as { entries: Array<{ file: string; match: string }> }
 // The policy gate stores literal rows by source text and constructor rows as
 // "<dynamic>" (the constructed PATTERN is caller-dependent, so only the file
 // and the count are stable). Mirror that representation when cross-checking.
  const literalBudget = new Map<string, number>()
  const dynamicBudget = new Map<string, number>()
  for (const row of baseline.entries ?? []) {
    if (row.kind === "constructor" || row.source === "<dynamic>") dynamicBudget.set(row.file, (dynamicBudget.get(row.file) ?? 0) + 1)
    else literalBudget.set(`${row.file}\u0000${row.source}`, (literalBudget.get(`${row.file}\u0000${row.source}`) ?? 0) + 1)
  }
  for (const row of allowlist.entries ?? []) literalBudget.set(`${row.file}\u0000${row.match}`, (literalBudget.get(`${row.file}\u0000${row.match}`) ?? 0) + 1)
  const coveredFiles = new Set([...literalBudget.keys()].map((k) => k.split("\u0000")[0]).concat([...dynamicBudget.keys()]))
  const unaccounted: RegexUse[] = []
  for (const use of uses) {
    if (!coveredFiles.has(use.file)) continue
    if (use.kind === "constructor") {
      const left = dynamicBudget.get(use.file) ?? 0
      if (left > 0) dynamicBudget.set(use.file, left - 1)
      else unaccounted.push(use)
      continue
    }
    const k = `${use.file}\u0000${use.source}`
    const left = literalBudget.get(k) ?? 0
    if (left > 0) literalBudget.set(k, left - 1)
    else unaccounted.push(use)
  }
  ck("policy: every use in a file the repository policy gate scans is frozen or allowlisted there", unaccounted.length === 0, JSON.stringify(unaccounted))
  const engineRows = (baseline.entries ?? []).filter((row) => row.file === "src/intelligence/edit/edit-engine.ts").length
  nk("policy: the engine's regex debt is frozen in the repository baseline (fails if that baseline lost this module)", engineRows >= 1, `baseline rows for edit-engine: ${engineRows}`)
} else {
  nk("policy: a cross-check is not silently skipped — the baseline/allowlist must exist", false, `${BASELINE_PATH} or ${ALLOWLIST_PATH} missing`)
}

emit("verified")

function emit(state: string): never {
  const total = positive + negative
  const passed = positivePassed + negativePassed
  const doc = {
    issue: "M15.E2",
    code: "E2",
    tool: "bb_edit",
    verified: failed === 0,
    state: failed === 0 ? state : "known-gap",
    checks: total,
    passed,
    failed,
    negatives: negative,
    surface: { files: SCAN_FILES, uses: uses.length, snapshotRows: existsSync(SNAPSHOT_PATH) ? (JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as { entries: SnapshotRow[] }).entries.length : 0 },
    generatedAt: new Date().toISOString(),
  }
  mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true })
  writeFileSync(EVIDENCE_PATH, JSON.stringify(doc, null, 2) + "\n")
  console.log(`\nE2: ${doc.verified ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${total} passed, ${negative} negatives) — ${uses.length} regex operations across ${SCAN_FILES.length} files`)
  process.exit(failed === 0 ? 0 : 1)
}
