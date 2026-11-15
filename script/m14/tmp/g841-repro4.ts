// Isolate named-args ctor shapes; separate file per case to attribute cleanly
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "H3. new C(a: 1) alone", src: `def c = new C(a: 1)\n` },
    { cls: "H4. C(a: 1) no new", src: `def c = C(a: 1)\n` },
    { cls: "H5. method call m(a: 1)", src: `def r = m(a: 1)\n` },
    { cls: "H6. one-line class + new named", src: `class C { def a; def b }\ndef c = new C(a: 1, b: 2)\n` },
    { cls: "H7. multi-line class + new named", src: `class C {\n  def a\n  def b\n}\ndef c = new C(a: 1, b: 2)\n` },
    { cls: "H8. just the class decl (control)", src: `class C { def a; def b }\n` },
    { cls: "H9. new C(1,2) positional (control)", src: `def c = new C(1, 2)\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
    if (bad) {
      // walk ALL children, not just named
      const rows: string[] = []
      const walk = (n: any) => {
        if (n.type === "ERROR" || n.isMissing) rows.push(`  row ${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text||"").slice(0,50))}`)
        for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch) }
      }
      walk(tree.rootNode)
      console.log(rows.slice(0, 5).join("\n"))
    }
  }
}
main()
