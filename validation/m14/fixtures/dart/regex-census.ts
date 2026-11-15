/**
 * Lane-local REGEX census, by AST rather than by text.
 *
 * ## Why this exists
 *
 * `script/m12/verify-regex-census.ts` decides "this lane holds no regex" with a
 * set of TEXT patterns: `new RegExp`, `RegExp(`, `.match(`, `.replace(`,
 * `.test(`, `.search(`, `.matchAll(`. A regex LITERAL matches none of them. It
 * is not constructed through `RegExp`, and the `.test()` that uses it is
 * `.test(` only on the VARIABLE holding it — so
 *
 *   const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;  ...  IDENT.test(name)
 *
 * is invisible to that gate. This lane reported 0 regexes for several waves
 * while holding 9 of them, all in exactly that shape.
 *
 * That is the same failure class this whole workstream exists to correct: an
 * instrument that cannot see the construct it is measuring reports an ABSENCE,
 * and the absence is read as a pass. A source count is not evidence, and a text
 * scan that misses a literal is not a count either.
 *
 * So this walks the TypeScript AST and counts what is actually there:
 *
 *   - `RegExpLiteral`                — a regex literal, assigned or inline
 *   - `NewExpression`/`CallExpression` whose callee is `RegExp` — a construction
 *
 * Division and comment text are excluded by construction: a `/` that is not a
 * regex literal is a division operator and never forms a `RegExpLiteral` node.
 *
 * ## This file selects its own inputs with STRING HELPERS, on purpose
 *
 * The first version of this instrument picked its file set with regexes and then
 * counted itself: it reported 4 hits, every one of them its own filename
 * patterns. A census that measures its own selection criteria is not a census.
 * Every path test below is `startsWith` / `endsWith` / `indexOf`, which is also
 * the lane's analyzer convention — and a path test cannot be fooled by a string
 * that merely LOOKS like a pattern.
 *
 * ## Scope
 *
 * Everything this lane owns, as declared in
 * `docs/analyzers/dart.md` §Regex inventory:
 *
 *   src/ast/real-dart-analyzer.ts
 *   validation/m14/fixtures/dart/**      (this file excepted, below)
 *   script/m14/oracles/dart-*.ts
 *   script/m14/verify-dart-*.ts
 *
 * This file is excepted from its own scan and says so in its output, because a
 * tool that cannot list its own exclusions is a tool whose exclusions cannot be
 * checked.
 *
 * `--all` widens the scan to every `.ts` in the repository whose path contains
 * the segment `dart` or whose directory is `script/m14/tmp`, which is how the
 * pre-existing `script/m14/tmp/dart-*.ts` scratch files are surfaced. Those are
 * NOT lane-owned and NOT this lane's to fix; the flag exists so a reviewer can
 * see them rather than have them hidden by a flattering scope.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/regex-census.ts          # lane-owned set
 *   npx tsx validation/m14/fixtures/dart/regex-census.ts --all    # every dart-named .ts
 *
 * Exits 1 if the lane-owned set holds a regex, 0 if it holds none.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import * as ts from "typescript"

const ROOT = process.cwd()
const ALL = process.argv.includes("--all")
const SELF = "validation/m14/fixtures/dart/regex-census.ts"

const ANALYZER = "src/ast/real-dart-analyzer.ts"
const FIXTURE_DIR = "validation/m14/fixtures/dart"
const ORACLE_DIR = "script/m14/oracles"
const VERIFY_DIR = "script/m14"
const TMP_DIR = "script/m14/tmp"

/** `dir` or anything under it. Trailing slashes are the caller's problem. */
const under = (dir: string, rel: string) => rel === dir || rel.startsWith(dir + "/")

const isTmp = (rel: string) => under(TMP_DIR, rel)
/**
 * `script/m14/oracles/dart-*.ts` and `script/m14/verify-dart-*.ts`, by string only.
 *
 * The FIRST version of this predicate required the file to sit DIRECTLY in
 * `script/m14/`, which silently excluded all three oracles — the scan reported
 * 9 files and had never looked at `dart-imports.ts`, `dart-overrides.ts` or
 * `dart-references.ts`. The SECOND kept the trailing slash on `script/m14/`, so
 * `walk` built `script/m14//tmp/...` and every tmp guard missed by one slash.
 * A scope that drops or misfiles files without saying so is the same defect as
 * the text-pattern gate this file replaces, one level up. `OWNED_DIRS` below is
 * now an explicit list and is printed in the output, so the next version cannot
 * quietly lose a directory either.
 */
const isDartNamed = (rel: string) => {
  if (isTmp(rel)) return false
  if (!under(VERIFY_DIR, rel)) return false
  const base = rel.slice(rel.lastIndexOf("/") + 1)
  return base.startsWith("dart-") || base.startsWith("verify-dart-")
}
/** Anything whose path carries a `dart` path segment, plus the tmp scratch dir. */
const isDartPath = (rel: string) => {
  if (rel.endsWith("/dart.ts")) return true
  const parts = rel.split("/")
  for (let i = 0; i < parts.length - 1; i++) if (parts[i] === "dart") return true
  return isTmp(rel) && rel.indexOf("dart") !== -1
}

function walk(rel: string, out: string[]): string[] {
  let ents: import("node:fs").Dirent[]
  try {
    ents = readdirSync(path.join(ROOT, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of ents) {
    const child = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      walk(child, out)
    } else if (e.name.endsWith(".ts")) out.push(child)
  }
  return out
}

function candidates(): string[] {
  const seen = new Set<string>()
  const add = (rel: string) => {
    if (!rel.startsWith("..") && statSync(path.join(ROOT, rel), { throwIfNoEntry: false })) seen.add(rel)
  }
  if (statSync(path.join(ROOT, ANALYZER), { throwIfNoEntry: false })?.isFile()) add(ANALYZER)
  for (const f of walk(FIXTURE_DIR, [])) add(f)
  // OWNED_DIRS, explicitly and exhaustively: the oracles live one level down
  // from the verifiers and a path test that assumed otherwise lost all three.
  for (const f of walk(ORACLE_DIR, [])) if (isDartNamed(f)) add(f)
  for (const f of walk(VERIFY_DIR, [])) if (isDartNamed(f)) add(f)
  if (ALL) {
    for (const top of ["script", "src", "validation", "website"]) for (const f of walk(top, [])) if (isDartPath(f)) add(f)
  }
  return [...seen].sort()
}

type Hit = { file: string; line: number; col: number; kind: string; text: string }

const hits: Hit[] = []
const scanned: string[] = []
let linesRead = 0

for (const rel of candidates()) {
  const text = readFileSync(path.join(ROOT, rel), "utf8")
  scanned.push(rel)
  linesRead += text.split("\n").length
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const record = (n: ts.Node, kind: string) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
    hits.push({ file: rel, line: line + 1, col: character + 1, kind, text: n.getText(sf).slice(0, 90) })
  }
  const visit = (n: ts.Node) => {
    if (ts.isRegularExpressionLiteral(n)) record(n, "RegExpLiteral")
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "RegExp") record(n, "new RegExp()")
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "RegExp") record(n, "RegExp()")
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

const laneOwned = (rel: string) =>
  rel === ANALYZER || under(FIXTURE_DIR, rel) || (under(ORACLE_DIR, rel) && isDartNamed(rel)) || (rel.startsWith(VERIFY_DIR + "/") && isDartNamed(rel))

const mine = hits.filter(h => laneOwned(h.file) && h.file !== SELF)
const others = hits.filter(h => !laneOwned(h.file) || h.file === SELF)

console.log(`dart lane regex census — instrument: TypeScript AST (ts.createSourceFile), no text patterns`)
console.log(`scope: ${ALL ? "EVERY dart-named .ts (--all)" : "lane-owned set"}`)
console.log(`owned dirs: ${ANALYZER} | ${FIXTURE_DIR}/* | ${ORACLE_DIR}/dart-* | ${VERIFY_DIR}/dart-* | ${VERIFY_DIR}/verify-dart-*`)
console.log(`             (that is every directory the scan enters; a directory not named here is not scanned)\n`)
console.log(`files scanned: ${scanned.length}  (${linesRead} lines)   excluded from its own count: ${SELF}`)
console.log(`lane-owned files: ${scanned.filter(laneOwned).length}\n`)

if (others.length) {
  console.log(`OUTSIDE the lane-owned count (${others.length}) — listed, not fixed:`)
  for (const h of others) console.log(`  ${h.file}:${h.line}:${h.col}  ${h.kind}  ${h.text}`)
  console.log("")
}

if (mine.length === 0) {
  console.log(`RESULT: 0 regexes in the lane-owned set.`)
  console.log(`A RegExpLiteral node and a RegExp construction are the two things that count, and`)
  console.log(`there is neither. That is a MEASUREMENT over ${scanned.filter(laneOwned).length} files, not an`)
  console.log(`absence of a record — the text-pattern gate this replaces could not see a`)
  console.log(`literal at all, and read its own blindness as a pass.`)
  process.exit(0)
} else {
  console.log(`RESULT: ${mine.length} regex construct(s) in the lane-owned set:`)
  for (const h of mine) console.log(`  ${h.file}:${h.line}:${h.col}  ${h.kind}  ${h.text}`)
  process.exit(1)
}
