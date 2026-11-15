// Minimal-shape probe for the multi-closure command chain class.
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "Y1 single closure assign", src: `class A {\n  def f(p) {\n    p = p.then { it * 2 }\n  }\n}\n` },
    { cls: "Y2 two closures bare stmt", src: `class A {\n  def f(p) {\n    p.then { it * 2 } then { println it }\n  }\n}\n` },
    { cls: "Y3 two closures in assign", src: `class A {\n  def f(p) {\n    p = p.then { it * 2 } then { println it }\n  }\n}\n` },
    { cls: "Y4 two closures + empty args", src: `class A {\n  def f(p) {\n    p.then() { it * 2 } then() { println it }\n  }\n}\n` },
    { cls: "Y5 three closures", src: `class A {\n  def f(p) {\n    p.then { a } then { b } then { c }\n  }\n}\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
    if (bad) {
      const rows: string[] = []
      const walk = (n: any) => { if (n.type === "ERROR" || n.isMissing) rows.push(`  ${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text || "").split("\n")[0].slice(0, 60))}`); for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch) } }
      walk(tree.rootNode)
      console.log(rows.slice(0, 3).join("\n"))
    }
  }
}
main()
