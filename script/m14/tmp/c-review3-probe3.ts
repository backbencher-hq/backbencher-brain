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
    ["G1", `int broken( {\nint okfn(int a) { return a; }\nint tailvar = 1;\n`],
    ["G2", `#ifdef NEVER_DEFINED\nint okfn(int a) { return a | ; }\n#endif\nint tailvar = 2;\n`],
    ["G3", `typedef struct { int x; } T;\nint broken( {\nint okfn(int a) { return a; }\nint tailvar = 3;\n`],
  ]
  for (const [name, src] of shapes) {
    const root = await parse(src)
    const errs: string[] = []
    const fds: string[] = []
    const walk = (n: any): void => {
      if (n.type === "ERROR") errs.push(n.startIndex + "-" + n.endIndex)
      if (n.type === "function_definition") {
        // is it inside an ERROR?
        let p = n.parent, inside = false
        while (p) { if (p.type === "ERROR") { inside = true; break } p = p.parent }
        fds.push(n.startIndex + (inside ? "(inERR)" : ""))
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(root)
    const r: any = await new RealCAnalyzer().analyze(root, src, name + ".c")
    console.log(name, "ERRORs=" + JSON.stringify(errs), "fns=" + JSON.stringify(fds), "syms=" + JSON.stringify(r.symbols.map((s: any) => s.name + ":" + s.kind)))
  }
}
main()
