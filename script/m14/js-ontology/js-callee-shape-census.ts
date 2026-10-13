/**
 * JS CALLEE-SHAPE CENSUS — the measurement for lane finding §2 ("1,236 `calls`
 * targets on the ts corpus are expressions, not names").
 *
 * WHY THIS FILE EXISTS. §2's number was produced by a probe that lived in the
 * git-excluded `script/m14/tmp/`, so the finding a reader is asked to act on had
 * no committed instrument — the same defect `javascript-two-path-loss.ts`
 * records for JSD36. This file is that instrument, and it is lane-owned.
 *
 * WHAT IT MEASURES. Every `calls` row the analyzer publishes, split by whether
 * its TARGET is a NAME or a piece of SOURCE TEXT:
 *
 *   name-shaped   the target matches the JS identifier grammar (optionally
 *                 `#`-prefixed, which is a legitimate call target — see below).
 *   NOT a name    everything else, bucketed by the shape that let it through.
 *
 * The buckets exist because the guard this measures is a BOOLEAN over token
 * membership (`hasBraceEquals`, newline, backtick, `${`, 100 chars), not a test
 * of name shape: a parenthesised or conditional callee contains none of those
 * tokens, so the leaf published is whatever text the node spans. The buckets
 * name which syntactic form produced each row, which is what decides the fix.
 *
 * `#name` IS ADMITTED ON PURPOSE. 124 of the ts rows are `#private` call
 * targets, and they are CORRECT: `this.#x()` names the private method `#x`,
 * which this lane already publishes as a symbol (`#events`). Any fix that
 * filters to alphanumerics would delete them, which is why the fix is a
 * name-shape rule and not an alphanumeric one.
 *
 * READS ONLY: corpus files. Writes nothing.
 *
 *   bun run script/m14/js-ontology/js-callee-shape-census.ts [--corpus typescript] [--limit N]
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Dirent } from "node:fs"
import { getParser } from "../../../src/ast/engine"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

const DEFAULT_CORPUS = "$HOME/fixtures/repositories"
// .js/.mjs/.cjs only — this is the JAVASCRIPT analyzer. The typescript corpus is
// the population §2 measured (13,203 tracked `.js` files, its build output), and
// it is admitted here by EXTENSION, not by `detectLanguageFromPath`, so the
// instrument does not silently skip a file the language detector disagrees about.
const JS_EXTS = [".js", ".mjs", ".cjs"]

/**
 * NO REGEX (lane brief rule 2): both tests below are char-code walks. A regex over
 * a published target would match text the grammar distinguishes — and this file's
 * whole subject is the analyzer publishing TEXT where a NAME belongs.
 */

/** `ID_Start`, as char codes: `$`, `_`, ASCII letters, any non-ASCII code point. */
function isIdentifierStartCode(c: number): boolean {
  if (c === 0x24 || c === 0x5f) return true
  if (c >= 0x41 && c <= 0x5a) return true
  if (c >= 0x61 && c <= 0x7a) return true
  return c > 0x7f
}

/** `ID_Continue`: everything that can start one, plus ASCII digits and the joiners. */
function isIdentifierContinueCode(c: number): boolean {
  if (isIdentifierStartCode(c)) return true
  if (c >= 0x30 && c <= 0x39) return true
  return c === 0x200c || c === 0x200d
}

/**
 * The name-shape rule — the same rule the analyzer's `isNameShapedCallTarget`
 * applies, restated here so this instrument can report WHAT THE ANALYZER DOES
 * rather than what a second implementation of the rule thinks it should do. `#name`
 * is a name (`this.#x()` calls the private method `#x`).
 */
function isNameShape(target: string): boolean {
  if (!target) return false
  let i = 0
  if (target.charCodeAt(0) === 0x23) {
    i = 1
    if (i >= target.length) return false
  }
  if (!isIdentifierStartCode(target.charCodeAt(i))) return false
  for (i = i + 1; i < target.length; i++) {
    if (!isIdentifierContinueCode(target.charCodeAt(i))) return false
  }
  return true
}

/**
 * The test the ORIGINAL §2 measurement used, kept here on purpose. It is an
 * alphanumeric filter with no `#` clause, so it reports a private-method call
 * (`#x`) as a non-name target — which is why §2's table carries its own
 * "of which `#private` (CORRECT, must be preserved)" column, and why the numbers
 * here reconcile with that table instead of replacing it: the difference between
 * the two tests IS the `#` clause.
 */
function failsAsciiAlphanumeric(target: string): boolean {
  let i = 0
  if (target.charCodeAt(0) === 0x24 || target.charCodeAt(0) === 0x5f) i = 1
  else if (target.length > 0 && target.charCodeAt(0) >= 0x41 && target.charCodeAt(0) <= 0x5a) i = 1
  else if (target.length > 0 && target.charCodeAt(0) >= 0x61 && target.charCodeAt(0) <= 0x7a) i = 1
  else return true
  for (; i < target.length; i++) {
    const c = target.charCodeAt(i)
    const alnum = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
    if (!alnum && c !== 0x24 && c !== 0x5f) return true
  }
  return false
}

/** Which syntactic form produced a non-name target — text cues only, no regex. */
function shapeOf(target: string): string {
  // `(0, ral_1.default)`, `(await $.save(1))`, `(h ? xs : Ws)` — one bucket, because
  // the guard on the far side of this measurement cannot see inside the parentheses
  // either way, so the distinction is not one a fix would branch on.
  if (target.startsWith("(")) return "paren"
  if (target.includes(")")) return "call-expr"
  if (target.includes("?")) return "ternary"
  if (target.includes("'") || target.includes('"') || target.includes("[")) return "literal-or-subscript"
  if (target.includes(" ") || target.includes("\t")) return "spaced"
  return "other"
}

function hasExt(name: string, exts: string[]): boolean {
  for (const e of exts) if (name.endsWith(e)) return true
  return false
}

function walkFiles(dir: string, out: string[] = []): string[] {
  let ents: Dirent[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== ".git" && e.name !== "coverage") walkFiles(p, out)
    } else if (hasExt(e.name, JS_EXTS)) out.push(p)
  }
  return out
}

function getArg(name: string, dflt: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

const corpus = getArg("--corpus", "typescript")
const limit = Number(getArg("--limit", "0"))
const dir = join(DEFAULT_CORPUS, corpus)

let files = walkFiles(dir).sort()
const total = files.length
if (limit > 0) files = files.slice(0, limit)

const parser = await getParser("javascript")

let filesRun = 0
let parseFail = 0
let callsRows = 0
let nameShaped = 0
let privateTargets = 0
let asciiAlnumFail = 0
const bad = new Map<string, number>()
const examples = new Map<string, string[]>()
const rows: { target: string; source: string }[] = []

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { parseFail++; continue }
  let pr: any
  try { pr = await parser.parse(content) } catch { parseFail++; continue }
  if (!pr) { parseFail++; continue }
  filesRun++
  const res: any = new RealJavaScriptAnalyzer().analyze(pr.rootNode, content, f)
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "").toLowerCase()
    if (t !== "calls") continue
    callsRows++
    const target = String(r.target ?? "")
    if (target.startsWith("#")) privateTargets++
    if (failsAsciiAlphanumeric(target)) asciiAlnumFail++
    if (isNameShape(target)) { nameShaped++; continue }
    rows.push({ target, source: String(r.source ?? "") })
    const s = shapeOf(target)
    bad.set(s, (bad.get(s) ?? 0) + 1)
    const ex = examples.get(s) ?? []
    if (ex.length < 5) { ex.push(`${target}  [${f.replace(dir + "/", "")}]`); examples.set(s, ex) }
  }
}

console.log(`js-callee-shape-census  corpus=${corpus}  files=${filesRun}/${total}  parseFail=${parseFail}`)
console.log(`calls rows = ${callsRows}`)
console.log(`name-shaped = ${nameShaped}  (of which #private targets = ${privateTargets})`)
console.log(
  `ASCII-alphanumeric test (§2's original): fails ${asciiAlnumFail}` +
    `${callsRows ? ` (${(100 * asciiAlnumFail / callsRows).toFixed(3)}%)` : ""}` +
    ` — of which ${privateTargets} are the #private targets the name-shape rule must ADMIT`,
)
const badTotal = callsRows - nameShaped
console.log(`name-shape test (the fix's contract): NOT a name = ${badTotal}${callsRows ? ` (${(100 * badTotal / callsRows).toFixed(3)}%)` : ""}`)
for (const [s, n] of [...bad.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`\n  ${s}: ${n}`)
  for (const e of examples.get(s) ?? []) console.log(`     ${e}`)
}
