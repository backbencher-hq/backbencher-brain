import * as fs from "fs"
import * as path from "path"
import { RealRustAnalyzer } from "../../../src/ast/real-rust-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealRustAnalyzer().analyze(root, src, "T.rs")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any) => (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
  await run("R8-explicit-where", `fn f<T>(x: T) -> T where T: Clone + Send { x }\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r)))
    if (rels(r).some((s: string) => s === "references:f->T")) throw new Error("where-bound type param leaks (claim TRUE)")
  })
  await run("R18-shape", `#[get("/users")]\nasync fn list_users() {}\n`, (r, root) => {
    const findAll = (n: any, pred: (x: any) => boolean, out: any[] = []): any[] => {
      if (pred(n)) out.push(n)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) findAll(c, pred, out) }
      return out
    }
    const attrs = findAll(root, (n) => n.type === "attribute_item")
    console.log("   attrs=" + attrs.length + " parent=" + attrs[0]?.parent?.type + " text=" + JSON.stringify(attrs[0]?.text.slice(0, 20)))
    console.log("   exports=" + JSON.stringify((r.exports ?? []).map((e: any) => e.name)))
    if (!(r.exports ?? []).some((e: any) => e.name === "/users")) throw new Error("route export missing (claim TRUE)")
  })
}
main()
