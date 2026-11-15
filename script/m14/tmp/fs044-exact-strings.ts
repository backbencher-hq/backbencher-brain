/**
 * fs044 — the two sides' strings for one label, DELIMITED, so a difference cannot hide.
 *
 * fs041 said `MISSING DummyForm -> Form` for a row the analyzer demonstrably emits, with truth 1
 * and analyzer 1. Two rows of one label that are the same length and the same to the eye are not
 * necessarily the same string, and the two likeliest culprits are invisible in aligned output:
 * a trailing character, or a case difference. So this prints the raw strings inside brackets
 * rather than in columns, and prints the ANALYZER's published symbol names alongside — because
 * "both sides emit `DummyForm -> Form`" is a statement about a JOIN KEY, and the join key is
 * built from a symbol name that neither row displays.
 *
 * Usage: bun fs044-exact-strings.ts <file> <label>
 */
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const file = process.argv[2]!
const label = process.argv[3]!

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const src = fs.readFileSync(file, "utf8")
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
const tree = parser.parse(src)
const r: any = await ASTEngine.parseFile(file, src)

const truth = deriveFsharpEdges(tree.rootNode, r.symbols ?? []).filter((e: any) => e.label === label)
const mine = (r.relationships ?? []).filter((x: any) => String(x.type) === label)
console.log(`\n${path.basename(file)}  label=${label}`)
console.log(`\nTRUTH (${truth.length}):`)
for (const e of truth) console.log(`  [${e.from}] -> [${e.target}]`)
console.log(`\nANALYZER (${mine.length}):`)
for (const x of mine) console.log(`  [${x.source}] -> [${x.target}]  L${x.line_number}`)
console.log(`\nANALYZER symbols whose name contains the target (what a join would resolve to):`)
for (const s of r.symbols ?? []) {
  if (truth.some((e: any) => String(s.name).includes(String(e.target)))) console.log(`  kind=${s.kind} [${s.name}] owner=[${s.ownerName}]`)
}
