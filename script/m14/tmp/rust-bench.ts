import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const files: string[] = []
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true }) as any[]) { const q = path.join(d, e.name); if (e.isDirectory()) { if (!/^(\.|target)/.test(e.name)) walk(q) } else if (e.name.endsWith(".rs")) files.push(q) } }
  walk("<corpus-root>/bb_tests/repositories/ripgrep")
  const p = new P(); p.setLanguage(LANG)
  const ana = new RealRustAnalyzer()
  const t0 = performance.now()
  let n = 0
  for (const f of files.slice(0, 20)) {
    const src = fs.readFileSync(f, "utf8")
    const root = p.parse(src).rootNode
    const a0 = performance.now()
    await ana.analyze(root, src, f)
    n += performance.now() - a0
  }
  console.log(`20 files: analyze total ${n.toFixed(0)}ms, avg ${(n / 20).toFixed(1)}ms/file (parse excluded)`)
}
main()
