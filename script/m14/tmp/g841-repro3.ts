// Probe the two corpus-derived shapes from ExtractDependenciesTask
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "G. typed for-in: for (def x : list)", src: `def l = [1]\nfor (def x : l) { println(x) }\n` },
    { cls: "G2. plain for-in: for (x in list)", src: `def l = [1]\nfor (x in l) { println(x) }\n` },
    { cls: "G3. typed classic for: for (int i = 0; ...)", src: `for (int i = 0; i < 3; i++) { println(i) }\n` },
    { cls: "H. multi-line named-args ctor", src: `class C { def a; def b }\ndef c = new C(\n  a: 1,\n  b: 2\n)\n` },
    { cls: "H2. single-line named-args ctor (control)", src: `class C { def a; def b }\ndef c = new C(a: 1, b: 2)\n` },
    { cls: "I. slashy + for-in combo (Extract pattern)", src: `for (def d : deps) {\n  def rx = /a.b/\n}\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
    if (bad) {
      const rows: string[] = []
      const walk = (n: any) => { if (n.type === "ERROR" || n.isMissing) rows.push(`  row ${n.startPosition.row + 1} ${n.isMissing ? "MISSING " : ""}${n.type}: ${JSON.stringify((n.text||"").slice(0,50))}`); for (const ch of (n.namedChildren ?? [])) walk(ch) }
      walk(tree.rootNode)
      console.log(rows.slice(0, 3).join("\n"))
    }
  }
}
main()
