/**
 * script/m14/parse-check.ts — SYNTAX-ONLY guard over every TypeScript file outside src/.
 *
 * WHY THIS EXISTS
 * ---------------
 * tsconfig.json's include list covers only the src tree. That means `tsc --noEmit` — the check this
 * repo has leaned on, and the one reported as "0 errors" throughout the m14/m60 work — NEVER
 * COMPILED A SINGLE FILE UNDER script/. Every m14 harness, every differential, every mutant
 * analyzer, and every corpus tool was invisible to it.
 *
 * That gap let commit 1ce88e40 ship a differential.ts that does not parse at all: a trailing
 * comma left the LANGS object literal unterminated, `hcl: {` sat where the parser expected a
 * statement end, and `error: Expected ";" but found ":"` was the first thing to notice —
 * only when the harness was actually run, and by a different machine, hours later.
 *
 * This check is deliberately SYNTAX ONLY. A syntax error means the file cannot run at all, and
 * that is unambiguous, mechanical, and worth failing a build on. It does not attempt to
 * typecheck the harnesses: they are large, half are probes, and many carry deliberate
 * `any` escapes that a maintainer has chosen. Turning this into a full typecheck of script/
 * would produce a wall of pre-existing findings and train people to ignore the gate. A wall of
 * unfixable warnings is the same as no gate at all.
 *
 * So: this catches "the file is not a program". It deliberately leaves "the program is
 * questionable" to the harnesses' own gates and to review.
 */
import * as ts from "typescript"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOTS = ["script", "tests", "src"]
const SKIP = new Set(["node_modules", "dist", ".git", "coverage", "artifacts", "validation"])

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(full)
  }
}

const files: string[] = []
for (const r of ROOTS) walk(r, files)
files.sort()

let broken = 0
let checked = 0
for (const file of files) {
  const text = fs.readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
  const diags = sf.parseDiagnostics ?? []
  checked++
  if (diags.length === 0) continue
  broken++
  for (const d of diags.slice(0, 3)) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start)
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ")
    console.error(`  ${file}:${line + 1}:${character + 1}  ${msg}`)
    const src = (text.split("\n")[line] ?? "").trim()
    if (src) console.error(`      | ${src.slice(0, 120)}`)
  }
}

console.log(`  parsed ${checked} TypeScript file(s) outside src/; ${broken} unparseable`)
if (broken > 0) {
  console.error(`  SYNTAX CHECK FAILED: ${broken} file(s) do not parse. A harness that cannot parse cannot run.`)
  process.exit(1)
}
console.log("  SYNTAX CHECK PASS")
