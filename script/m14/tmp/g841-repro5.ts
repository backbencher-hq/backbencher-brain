// Class-body field variants: where exactly does the one-line class fail?
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "K1. class C { int a }", src: `class C { int a }\n` },
    { cls: "K2. class C { def a }", src: `class C { def a }\n` },
    { cls: "K3. class C { int a; int b }", src: `class C { int a; int b }\n` },
    { cls: "K4. class C { def a; def b }", src: `class C { def a; def b }\n` },
    { cls: "K5. class C { def a; int b }", src: `class C { def a; int b }\n` },
    { cls: "K6. multiline { def a }", src: `class C {\n  def a\n}\n` },
    { cls: "K7. class C { static x = 1 }", src: `class C { static x = 1 }\n` },
    { cls: "K8. class C { static def m() {} }", src: `class C { static def m() {} }\n` },
    { cls: "K9. class C { def m() {} }", src: `class C { def m() {} }\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    let detail = ""
    if (bad) {
      const rows: string[] = []
      const walk = (n: any) => {
        if (n.type === "ERROR" || n.isMissing) rows.push(`  ${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text||"").slice(0,40))}`)
        for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch) }
      }
      walk(tree.rootNode)
      detail = "\n" + rows.slice(0, 3).join("\n")
    }
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}${detail}`)
  }
}
main()
