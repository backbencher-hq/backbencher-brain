import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-rust.wasm"))
  const p = new P(); p.setLanguage(LANG)
  for (const src of [
    `fn f(x: u32) -> u32 { match x { Some(v) => v, _ => 0, } }`,
    `fn f(x: u32) -> u32 { match x { (a, _) => a, _ => 0, } }`,
  ]) {
    const root = p.parse(src).rootNode
    const find = (n: any, t: string): any => {
      if (n.type === t) return n
      for (let i = 0; i < n.namedChildCount; i++) { const r = find(n.namedChild(i), t); if (r) return r }
      return null
    }
    const ma = find(root, "match_arm")
    const pat = ma.childForFieldName("pattern")
    console.log("pattern:", pat?.type, "| kids:", Array.from({length: pat.namedChildCount}, (_, i) => pat.namedChild(i)?.type).join(","))
  }
}
main()
