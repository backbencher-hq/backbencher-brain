import * as fs from "node:fs"; import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts; const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const p = new P(); p.setLanguage(g)
for (const src of ["&double/1", "&Mod.double/1", "&(&1 + 1)"]) {
  console.log(`\n### ${src}`)
  const walk = (n: any, d: number) => {
    console.log(`${"  ".repeat(d)}${n.type}${n.childCount === 0 ? ` ${JSON.stringify(n.text).slice(0,30)}` : ""}${n.isNamed ? "" : " (anon)"}`)
    if (d >= 5) return
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, d + 1) }
  }
  walk(p.parse(src).rootNode, 0)
}
process.exit(0)
