import * as fs from "fs"
import * as path from "path"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-go.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  for (const f of process.argv.slice(2)) {
    const src = fs.readFileSync(f, "utf8")
    const root = await parse(src)
    const r: any = await new RealGoAnalyzer().analyze(root, src, "T.go")
    console.log("=== " + f.split("/").pop())
    console.log("USES:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.source + "->" + x.target)))
    console.log("SYMS:", JSON.stringify((r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)))
  }
}
main()
