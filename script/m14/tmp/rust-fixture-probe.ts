import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-cpp.wasm".replace("cpp", "rust")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const src = fs.readFileSync("<corpus-root>/mcp/backbencher-brain/validation/m14/fixtures/rust/bare-value-reads.rs", "utf8")
  const root = await parse(src)
  const r: any = await new RealRustAnalyzer().analyze(root, src, "T.rs")
  console.log("USES:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "uses").map((x: any) => x.source + "->" + x.target)))
  console.log("CALLS:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "calls").map((x: any) => x.source + "->" + x.target)))
  console.log("REFS:", JSON.stringify((r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "references").map((x: any) => x.source + "->" + x.target)))
}
main()
