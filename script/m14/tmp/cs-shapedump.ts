import * as fs from "fs"
import * as path from "path"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join("<corpus-root>/mcp/backbencher-brain", "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync("<corpus-root>/mcp/backbencher-brain/wasm/tree-sitter-c_sharp.wasm"))
  const p = new P(); p.setLanguage(LANG)
  for (const src of [
    `class A { void M() { try { F(); } catch { G(); } } }`,
    `class A { void M() { try { F(); } catch (System.Exception e) { G(); } } }`,
  ]) {
    const root = p.parse(src).rootNode
    const find = (n: any, pred: (x: any) => boolean): any => {
      if (!n) return null
      if (pred(n)) return n
      for (let i = 0; i < (n.namedChildCount ?? 0); i++) { const r = find(n.namedChild(i), pred); if (r) return r }
      return null
    }
    const t = find(root, (x) => x.type === "try_statement")
    console.log("try children:", Array.from({length: t.namedChildCount}, (_, i) => t.namedChild(i)?.type).join(","))
  }
}
main()
