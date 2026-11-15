// Single-quoted Spock method names (census shape: id 'id'() {)
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "Q1. void 'single quoted name'()", src: `class Spec {\n  void 'createPromise with a null closures list returns a completed promise'() {\n    expect: 1 == 1\n  }\n}\n` },
    { cls: "Q2. def 'quoted name'() with body", src: `class Spec {\n  def 'addition works'() {\n    given: def a = 1\n  }\n}\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
  }
}
main()
