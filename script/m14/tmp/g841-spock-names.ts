// Re-verification of the round-2 claim "single-quoted Spock method names".
//
// The claim was recorded in commit d59452a5 but its probe did not survive a
// session loss, and a best-effort reconstruction (`def 'x'() { }` in a class)
// fails on the committed grammar. So the shape space is enumerated here instead
// of assumed.
//
// Usage: bun script/m14/tmp/g841-spock-names.ts [wasm]
import * as fs from "fs"

const WASM = process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"

const cases: { cls: string; src: string }[] = [
  { cls: "1. class + def single-quote name", src: "class S {\n  def 'a test name'() { }\n}\n" },
  { cls: "2. class + def double-quote name", src: 'class S {\n  def "a test name"() { }\n}\n' },
  { cls: "3. class + void single-quote name", src: "class S {\n  void 'a test name'() { }\n}\n" },
  { cls: "4. class + single-quote name + body stmt", src: "class S {\n  def 'a test name'() { assert true }\n}\n" },
  { cls: "5. class + single-quote name + label", src: "class S {\n  def 'a test name'() {\n    expect:\n    true\n  }\n}\n" },
  { cls: "6. class + double-quote name + label", src: 'class S {\n  def "a test name"() {\n    expect:\n    true\n  }\n}\n' },
  { cls: "7. class + String single-quote name", src: "class S {\n  String 'a test name'() { return 'x' }\n}\n" },
  { cls: "8. class + annotation + single-quote name", src: "class S {\n  @Test\n  def 'a test name'() { }\n}\n" },
  { cls: "9. class + single-quote name no def (typed)", src: "class S {\n  void \"a test name\"() { }\n}\n" },
  { cls: "10. class + single-quote name, plain identifier control", src: "class S {\n  def aTestName() { }\n}\n" },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(WASM))
  const parser = new P()
  parser.setLanguage(lang)
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const err = (tree.rootNode as any).hasError
    console.log(`${err ? "FAIL" : "OK  "} ${c.cls}`)
    if (err) {
      let first: string | null = null
      const walk = (n: any) => {
        if (first) return
        if (n.type === "ERROR" || n.isMissing) {
          first = `      ${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text || "").split("\n")[0].slice(0, 50))}`
          return
        }
        for (let i = 0; i < n.childCount; i++) {
          const ch = n.child(i)
          if (ch) walk(ch)
        }
      }
      walk(tree.rootNode)
      if (first) console.log(first)
    }
  }
}
main()
