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
  const srcA = `int broken( {\nint okfn(int a) { return a; }\nint tailvar = 1;\n`
  const srcB = `{ {\nint clean = 1;\n`
  const syms = (r: any) => (r.symbols ?? []).map((s: any) => s.name + ":" + s.kind)
  // control: fresh instance per file
  const rAf: any = await new RealCAnalyzer().analyze(await parse(srcA), srcA, "A.c")
  const rBf: any = await new RealCAnalyzer().analyze(await parse(srcB), srcB, "B.c")
  // shared instance: A then B
  const shared: any = new RealCAnalyzer()
  const rAs: any = await shared.analyze(await parse(srcA), srcA, "A.c")
  const rBs: any = await shared.analyze(await parse(srcB), srcB, "B.c")
  console.log("fresh A=" + JSON.stringify(syms(rAf)) + " fresh B=" + JSON.stringify(syms(rBf)))
  console.log("shared A=" + JSON.stringify(syms(rAs)) + " shared B=" + JSON.stringify(syms(rBs)))
  const freshHas = syms(rBf).some((s: string) => s.startsWith("clean"))
  const sharedHas = syms(rBs).some((s: string) => s.startsWith("clean"))
  if (freshHas && !sharedHas) console.log("FAIL HC5-instance-contamination :: file-B declaration suppressed by file-A memo (claim TRUE)")
  else console.log("ok   HC5 (freshHas=" + freshHas + " sharedHas=" + sharedHas + ")")
}
main()
