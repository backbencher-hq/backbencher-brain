// Author the #868 expectation from LIVE emission, never from memory.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"

const FILES = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ["validation/m14/fixtures/javascript/decorator-metadata-868.js"]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-javascript-analyzer.ts"))
  for (const rel of FILES) {
    const src = readFileSync(path.join(ROOT, rel), "utf8")
    const parser = new P()
    parser.setLanguage(grammar)
    const tree = parser.parse(src)
    const analyzer = new mod.RealJavaScriptAnalyzer()
    const res = await analyzer.analyze(tree.rootNode, src, path.basename(rel))
    console.log(`===== ${rel} =====`)
    console.log("--- symbols ---")
    for (const s of res.symbols ?? []) {
      console.log(`   { "name": "${s.name}", "kind": "${String(s.kind)}"${s.ownerName ? `, "ownerName": "${s.ownerName}"` : ""} }  // L${s.range?.startLine} decorators=${JSON.stringify(s.decorators ?? [])} lines=${JSON.stringify(s.metadata?.decoratorLines ?? null)}`)
    }
    console.log("--- relationships ---")
    for (const r of res.relationships ?? []) {
      console.log(`   { "type": "${String(r.type)}", "from": "${r.source}", "target": "${r.target}", "line_number": ${r.line_number ?? null} }  // ${JSON.stringify(r.metadata ?? {})}`)
    }
    console.log("")
  }
}
main()
