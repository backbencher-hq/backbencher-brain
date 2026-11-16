import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  const f = "<corpus-root>/bb_tests/repositories/cargo/crates/cargo-util-schemas/src/manifest/mod.rs"
  const src = fs.readFileSync(f, "utf8")
  const root = p.parse(src).rootNode
  const r: any = await new RealRustAnalyzer().analyze(root, src, "mod.rs")
  for (const e of (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === "instantiates" && /Toml|Registry|Profile|Feature|PathBase/.test(x.target))) {
    console.log(`${e.source}->${e.target} meta=${JSON.stringify(e.metadata)}`)
  }
}
main()
