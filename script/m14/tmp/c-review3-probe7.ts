import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
async function parse(src: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  return p.parse(src).rootNode
}
async function main() {
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = await parse(src)
    const r: any = await new RealCAnalyzer().analyze(root, src, "T.c")
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any) => (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
  await run("HC7b-preshadow-read", `int g;\nint h;\nvoid f(void) { h = g; { int g; g = 2; } }\n`, (r) => {
    console.log("   rels=" + JSON.stringify(rels(r)))
    if (!rels(r).some((s: string) => s === "uses:f->g")) throw new Error("pre-shadow global READ lost (claim TRUE)")
    if (!rels(r).some((s: string) => s === "uses:f->h")) throw new Error("sanity: uses h lost")
  })
}
main()
