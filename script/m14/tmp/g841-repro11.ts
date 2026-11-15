// Round-4 probes: multi-closure command chains + typed closure params.
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "X1 two trailing closures", src: `class A {\n  def f() {\n    promise = promise.then { it * 2 } then { throw new RuntimeException('x') }\n  }\n}\n` },
    { cls: "X2 call then closure", src: `class A {\n  def f() {\n    exts.any() { e -> e.endsWith('x') }\n  }\n}\n` },
    { cls: "X3 juxt + typed closure", src: `class A {\n  def f() {\n    props.each { String k, Object v -> use(k, v) }\n  }\n}\n` },
    { cls: "X4 def <T> T method", src: `class A {\n  def <T> T grab(String key, Class<T> type) throws Exception {\n    return null\n  }\n}\n` },
    { cls: "X5 generic method no def", src: `class A {\n  public <T> T grab(String key, Class<T> type) {\n    return null\n  }\n}\n` },
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
