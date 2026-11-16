import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
const parser = new P(); parser.setLanguage(lang)
for (const src of ["println filtered", "println filtered\n", "def run() { println filtered }", "run() { println filtered }"]) {
  const t: any = parser.parse(src)
  const shapes: string[] = []
  const walk = (n: any, d: number): void => { if (d > 6) return; shapes.push(`${"  ".repeat(d)}${n.type}${n.isNamed ? "" : " (anon)"}`); for (let i=0;i<n.namedChildCount;i++) walk(n.namedChild(i), d+1) }
  walk(t.rootNode, 0)
  console.log(`\n=== ${JSON.stringify(src)} err=${t.rootNode.hasError}`)
  console.log(shapes.join("\n"))
}
process.exit(0)
