/**
 * Fixture parse census — does each new .proto fixture parse CLEANLY?
 *
 * WHY THIS RUNS FIRST. A tree-sitter ERROR node is a successful parse of a
 * damaged region, so a fixture written on a file with ERROR nodes in it asserts
 * whatever the error recovery happened to produce. Every expectation in the four
 * fixtures added with this lane's mutant battery would then be a statement about
 * the grammar's recovery rather than about protobuf, and the mutants those
 * fixtures are supposed to catch would be caught or missed for the wrong reason.
 * So the ERROR/MISSING census is a PRECONDITION here, not an afterthought.
 *
 * Usage: tsx parse-census.mts
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { ROOT, WASM } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(readFileSync(WASM)))

const dir = path.join(ROOT, "validation/m14/fixtures/protobuf")
let bad = 0
for (const f of readdirSync(dir).filter((f) => f.endsWith(".proto")).sort()) {
  const content = readFileSync(path.join(dir, f), "utf8")
  const root = parser.parse(content).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if (n.type === "ERROR" || n.isMissing) errs.push(`${n.type}@L${n.startPosition.row + 1}${n.isMissing ? " (MISSING)" : ""} ${JSON.stringify(n.text.slice(0, 40))}`)
    for (const c of n.children) walk(c)
  }
  walk(root)
  if (errs.length) bad++
  console.log(`${errs.length === 0 ? "CLEAN" : "ERRORS"}  ${f}  (${errs.length})`)
  for (const e of errs.slice(0, 8)) console.log(`        ${e}`)
}
console.log("")
console.log(bad === 0 ? `all fixtures parse clean` : `${bad} fixture(s) carry ERROR/MISSING nodes — expectations written on these would measure error recovery, not protobuf`)
process.exit(bad === 0 ? 0 : 1)
