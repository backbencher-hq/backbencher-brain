// #841 r24: micro-shape A/B across base and r24 builds
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const CASES: Array<[string, string]> = [
  ["C1a recv3 arg4", "a.b.c().contains(d.e.f.location.toExternalForm())\n"],
  ["C1b recv3 arg3", "a.b.c().contains(d.e.f.toExternalForm())\n"],
  ["C1e no-parens recv3 arg3", "a.b.c.contains(d.e.f.toExternalForm())\n"],
  ["C9 recv3 paren arg3", "a.b.c(d.e.f.toExternalForm())\n"],
  ["C10 recv3 arg3 stmt+comma", "a.b.c.contains(d.e.f.toExternalForm()), x\n"],
]
for (const W of process.argv.slice(2)) {
  const lang = await L.load(fs.readFileSync(W))
  const parser = new P(); parser.setLanguage(lang)
  console.log("===== " + W)
  for (const [n, s] of CASES) {
    const t = parser.parse(s).rootNode
    let bad = false
    const walk = (x: any): void => { if (x.type === "ERROR" || x.isMissing) bad = true; for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
    walk(t)
    console.log(`  ${n.padEnd(28)} ${bad ? "ERR" : "CLEAN"}`)
  }
}
