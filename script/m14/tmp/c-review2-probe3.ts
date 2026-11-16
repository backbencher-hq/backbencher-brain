import * as fs from "fs"
import * as path from "path"
import { RealCAnalyzer } from "../../../src/ast/real-c-analyzer"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
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
  await run("CPD-proto-def-dup", `int f(int x);\nint f(int x) { return x * 2; }\nint main(void) { return f(3); }\n`, (r) => {
    const fsyms = (r.symbols ?? []).filter((s: any) => s.name === "f")
    console.log("   f-symbols=" + JSON.stringify(fsyms.map((s: any) => ({ kind: s.kind, vis: s.visibility, meta: s.metadata?.isDeclaration }))) + " exports=" + JSON.stringify((r.exports ?? []).filter((e: any) => e.name === "f").length))
    if (fsyms.length > 1) throw new Error("prototype+definition duplicated (claim TRUE)")
  })
}
main()
