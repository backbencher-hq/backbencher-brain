// Round 2 classes from the post-fix census residue
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "S1. Spock string-named method", src: `class Spec {\n  void "some behaviour happens"() {\n    expect: 1 == 1\n  }\n}\n` },
    { cls: "S2. Spock def string method", src: `class Spec {\n  def "addition works"() {\n    given:\n    def a = 1\n  }\n}\n` },
    { cls: "C1. leading-dot chain 2 lines", src: `def b = X.f()\n    .g(1)\n` },
    { cls: "C2. leading-dot chain 3 lines", src: `def o = Options.builder()\n    .standalone(false)\n    .attributes(attrs)\n` },
    { cls: "A1. attribute access x.@f", src: `class C { def f }\ndef v = c.@f\n` },
    { cls: "A2. attribute assign x.@f = 1", src: `class C { def f }\nc.@f = 1\n` },
    { cls: "A3. attribute string name x.@\"f\"", src: `class C { def f }\ndef v = c.@"f"\n` },
    { cls: "M1. spread-map map literal [*:m]", src: `def m = [x: 1]\ndef n = [*: m]\n` },
    { cls: "J1. string command chain with closure", src: `'svc'.find { it.id > 1 }\n` },
    { cls: "J2. label: block (Spock blocks)", src: `class Spec {\n  def m() {\n    given:\n    def a = 1\n    when:\n    a = 2\n    then:\n    a == 2\n  }\n}\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
    if (bad) {
      const rows: string[] = []
      const walk = (n: any) => { if (n.type === "ERROR" || n.isMissing) rows.push(`  ${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text||"").split("\n")[0].slice(0,50))}`); for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch) } }
      walk(tree.rootNode)
      console.log(rows.slice(0, 3).join("\n"))
    }
  }
}
main()
