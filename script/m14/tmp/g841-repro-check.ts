// The reducer reports `fails=true` for the candidate it just emitted, but a
// fresh process reading the emitted FILE reports no error ("nothing to
// reduce"). One of those two is wrong, and a repro that does not reproduce is
// the exact defect class this project keeps catching. Measure it directly.
import * as fs from "fs"

const file = process.argv[2]
if (!file) throw new Error("usage: bun script/m14/tmp/g841-repro-check.ts <reduced.groovy>")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P()
parser.setLanguage(lang)

const raw = fs.readFileSync(file, "utf8")
const stripped = raw.endsWith("\n") ? raw.slice(0, -1) : raw
const lines = stripped.split("\n")

const firstError = (root: any): any => {
  let found: any = null
  const walk = (n: any): void => {
    if (found) return
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) { found = n; return }
    for (let i = 0; i < n.childCount && !found; i++) walk(n.child(i))
  }
  walk(root)
  return found
}

console.log(`bytes=${raw.length}  endsWithNewline=${raw.endsWith("\n")}  splitElements=${lines.length}`)
console.log(`last line: ${JSON.stringify(lines[lines.length - 1])}`)

for (const [label, text] of [["as written (raw)", raw], ["trailing newline stripped", stripped], ["stripped + newline re-added", stripped + "\n"]] as Array<[string, string]>) {
  const root = parser.parse(text)?.rootNode
  const err = firstError(root)
  console.log(`${label.padEnd(30)} hasError=${root?.hasError}  err=${err ? `${err.isMissing ? "MISSING" : "ERROR"} row ${err.startPosition.row + 1} :: ${JSON.stringify(String(err.text).slice(0, 60))}` : "(none)"}`)
}

// Guard (4): are the code delimiters balanced once comments/strings are blanked?
// The reducer blanks using the ORIGINAL file's offsets against RECONSTRUCTED
// text; here the ranges come from the candidate's OWN tree, which is the only
// measurement that means anything for a candidate that is not the whole file.
function blankOwnRanges(text: string): string {
  const ranges: Array<{ start: number; end: number }> = []
  const collect = (n: any): void => {
    if (/comment|string|gstring/.test(n.type)) {
      if (n.endIndex > n.startIndex) ranges.push({ start: n.startIndex, end: n.endIndex })
      return
    }
    for (let i = 0; i < n.childCount; i++) collect(n.child(i))
  }
  collect(parser.parse(text)?.rootNode)
  const chars = text.split("")
  for (const r of ranges) for (let i = r.start; i < r.end && i < chars.length; i++) chars[i] = " "
  return chars.join("")
}

const code = blankOwnRanges(stripped)
const count = (ch: string) => code.split(ch).length - 1
const braces = count("{") - count("}")
const parens = count("(") - count(")")
const brackets = count("[") - count("]")
console.log(`\nDELIMITER BALANCE (candidate's own tree-derived ranges):`)
console.log(`  { } delta = ${braces}   ( ) delta = ${parens}   [ ] delta = ${brackets}`)
console.log(`  balanced = ${braces === 0 && parens === 0 && brackets === 0}`)
