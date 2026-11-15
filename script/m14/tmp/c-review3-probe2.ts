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
  const shapes: [string, string][] = [
    ["A-glued", `int f( {\nint victim = 1;\n`],
    ["B-bare", `{ {\nint clean = 1;\n`],
    ["A2-glued", `static broken(x) int x;\n{ broken body }\nint victim2 = 1;\n`],
  ]
  for (const [name, src] of shapes) {
    const root = await parse(src)
    const errs: any[] = []
    const walk = (n: any): void => {
      if (n.type === "ERROR") errs.push(n.startIndex + "-" + n.endIndex)
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(root)
    const r: any = await new RealCAnalyzer().analyze(root, src, name + ".c")
    console.log(name, "ERRORs=" + JSON.stringify(errs), "syms=" + JSON.stringify(r.symbols.map((s: any) => s.name + ":" + s.kind)))
  }
}
main()
