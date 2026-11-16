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
  const srcA = `int broken( {\nint okfn(int a) { return a; }\nint tailvar = 1;\n`
  const srcB = `{ {\n/*123456789012345*/\nint clean = 1;\n`
  const syms = (r: any) => (r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)
  const rootB = await parse(srcB)
  const errs: string[] = []
  const walk = (n: any): void => {
    if (n.type === "ERROR") errs.push(n.startIndex + "-" + n.endIndex)
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(rootB)
  console.log("B ERRORs=" + JSON.stringify(errs) + " cleanDeclAt=" + srcB.indexOf("int clean"))
  const rBf: any = await new RealCAnalyzer().analyze(rootB, srcB, "B.c")
  const shared: any = new RealCAnalyzer()
  await shared.analyze(await parse(srcA), srcA, "A.c")
  const rBs: any = await shared.analyze(await parse(srcB), srcB, "B.c")
  console.log("fresh B=" + JSON.stringify(syms(rBf)) + " shared B=" + JSON.stringify(syms(rBs)))
  const freshHas = syms(rBf).some((s: string) => s.startsWith("clean"))
  const sharedHas = syms(rBs).some((s: string) => s.startsWith("clean"))
  if (freshHas && !sharedHas) console.log("FAIL HC5-instance-contamination :: file-B declaration suppressed by file-A memo (claim TRUE)")
  else console.log("ok   HC5 (freshHas=" + freshHas + " sharedHas=" + sharedHas + ")")
}
main()
