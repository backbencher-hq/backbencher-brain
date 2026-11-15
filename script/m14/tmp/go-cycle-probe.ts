import * as fs from "fs"
import * as path from "path"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("/home/ishaq2321/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-go.wasm"))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = `package p\ntype A interface { B }\ntype B interface { A }\ntype S interface { S }\n`
  const root = await parse(src)
  console.log("parsing ok, hasError=" + root.hasError)
  const t0 = Date.now()
  const r: any = await new RealGoAnalyzer().analyze(root, src, "T.go")
  console.log("analyze took", Date.now() - t0, "ms; implements:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "implements")))
}
main()
