// script/m14/tmp/rb-superclass-node.ts — probe for the LINE ROUND's `extends`
// site in the ruby analyzer.
//
// Question this answers by measurement, not assumption: for `class X < Base`, we
// must stamp the line where the TARGET (`Base`) is written. Two candidates:
//   (a) the `superclass` node's own start (its text may begin at `<`), or
//   (b) the first named child of that node.
// They differ exactly when the base is wrapped onto its own line.
//
// Run: bun script/m14/tmp/rb-superclass-node.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function parseSrc(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-ruby.wasm")))
  const p = new P()
  p.setLanguage(LANG)
  return p.parse(src).rootNode
}

function findChild(node: any, type: string): any {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

const CASES: Array<[string, string]> = [
  ["one line", "class Widget < Base\nend\n"],
  ["wrapped", "class Widget <\n  Base\nend\n"],
  ["namespaced", "class Widget < Foo::Bar\nend\n"],
  ["namespaced wrapped", "class Widget <\n  Foo::Bar\nend\n"],
  ["dynamic (no extends emitted)", "class Widget < Struct.new(:a, :b)\nend\n"],
]

for (const [label, src] of CASES) {
  const root = await parseSrc(src)
  const cls = findChild(root, "class")
  const sc = cls ? findChild(cls, "superclass") : null
  const firstNamed = sc && sc.namedChildCount > 0 ? sc.namedChild(0) : null
  console.log(`--- ${label}`)
  console.log(`    superclass node   : type=${sc?.type} line=${sc ? sc.startPosition.row + 1 : "-"} text=${JSON.stringify(sc?.text)}`)
  console.log(`    first named child : type=${firstNamed?.type} line=${firstNamed ? firstNamed.startPosition.row + 1 : "-"} text=${JSON.stringify(firstNamed?.text)}`)
}
