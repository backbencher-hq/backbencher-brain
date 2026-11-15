// The UrlMappings shape: static field with a closure initializer inside a class
import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const cases: { cls: string; src: string }[] = [
    { cls: "U1. static mappings = { ... }", src: `class UrlMappings {\n    static mappings = {\n        "/$controller/$action?/$id?(.$format)?" {\n            constraints {\n            }\n        }\n    }\n}\n` },
    { cls: "U2. static field plain (control)", src: `class A { static x = 1 }\n` },
    { cls: "U3. static field closure simple", src: `class A { static f = { 1 } }\n` },
    { cls: "U4. gstring key inside closure", src: `class A { static m = {\n  "/$x/$y?" { c { } }\n}\n }\n` },
    { cls: "U5. closure with nested closure arg (control)", src: `class A { static m = {\n  foo { bar { baz() } }\n}\n }\n` },
  ]
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${c.cls}`)
    if (bad) {
      const rows: string[] = []
      const walk = (n: any) => { if (n.type === "ERROR" || n.isMissing) rows.push(`  ${n.startPosition.row + 1}:${n.startPosition.column} ${n.isMissing ? "MISSING " : ""}${n.type} :: ${JSON.stringify((n.text||"").split("\n")[0].slice(0,60))}`); for (let i = 0; i < n.childCount; i++) { const ch = n.child(i); if (ch) walk(ch) } }
      walk(tree.rootNode)
      console.log(rows.slice(0, 4).join("\n"))
    }
  }
}
main()
