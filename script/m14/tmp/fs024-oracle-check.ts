// FS024 — run the F# truth oracle against the production analyzer on the lane's own
// fixtures, and report the two directions separately: an edge truth derives and the
// analyzer does not (MISSING), and an edge the analyzer emits and truth does not
// (UNEXPLAINED). A summary line is not evidence; the rows are.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const dir = path.join(ROOT, "validation/m14/fixtures/fsharp")
let tm = 0, te = 0, ta = 0
for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith(".fs"))) {
  const src = fs.readFileSync(path.join(dir, f), "utf8")
  const r: any = await ASTEngine.parseFile(path.join(dir, f), src)
  // parseFile does not hand back the tree, so the oracle is fed a fresh parse of the
  // SAME source — the differential harness's own arrangement, and the reason the
  // comparison is two implementations over one grammar rather than a re-read of the
  // analyzer's own tree.
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  if (!P.__init) { await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") }); (P as any).__init = true }
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))
  const tree = parser.parse(src)
  const truth = deriveFsharpEdges(tree.rootNode, r.symbols ?? [])
  const key = (l: string, a: string, b: string) => `${l}|${a}|${b}`
  const tk = new Set(truth.map((e) => key(e.label, e.from, e.to)))
  const ak = new Set((r.relationships ?? []).map((x: any) => key(String(x.type), String(x.source ?? x.from), String(x.target ?? x.to))))
  const missing = [...tk].filter((k) => !ak.has(k))
  const unexplained = [...ak].filter((k) => !tk.has(k))
  tm += missing.length; te += unexplained.length; ta += tk.size
  console.log(`\n${f}: truth ${tk.size}  analyzer ${ak.size}  MISSING ${missing.length}  UNEXPLAINED ${unexplained.length}`)
  for (const m of missing.slice(0, 14)) console.log(`   MISSING    ${m}`)
  for (const u of unexplained.slice(0, 14)) console.log(`   UNEXPLAINED ${u}`)
}
console.log(`\nTOTAL truth ${ta}  MISSING ${tm}  UNEXPLAINED ${te}`)
