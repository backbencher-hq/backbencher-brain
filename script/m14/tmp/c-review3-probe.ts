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
  // A: glued header inside ERROR -> declaration after it must suppress
  const srcA = `int broken(;\nint afterA = 1;\n`
  // B: ERROR span, NO glued header -> declaration must EMIT
  const srcB = `int ;\nint afterB = 2;\n`
  const rootA = await parse(srcA), rootB = await parse(srcB)
  const errA: any[] = [], errB: any[] = []
  const walk = (n: any, out: any[]): void => { if (n.type === "ERROR") out.push([n.startIndex, n.endIndex]); for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), out) }
  walk(rootA, errA); walk(rootB, errB)
  console.log("errA=" + JSON.stringify(errA) + " errB=" + JSON.stringify(errB))
  // fresh instances (control)
  const rAf: any = await new RealCAnalyzer().analyze(rootA, srcA, "A.c")
  const rBf: any = await new RealCAnalyzer().analyze(rootB, srcB, "B.c")
  console.log("fresh: A-syms=" + JSON.stringify(rAf.symbols.map((s: any) => s.name)) + " B-syms=" + JSON.stringify(rBf.symbols.map((s: any) => s.name)))
  // shared instance (A then B)
  const shared: any = new RealCAnalyzer()
  const rAs: any = await shared.analyze(rootA, srcA, "A.c")
  const rBs: any = await shared.analyze(await parse(srcB), srcB, "B.c")
  console.log("shared: A-syms=" + JSON.stringify(rAs.symbols.map((s: any) => s.name)) + " B-syms=" + JSON.stringify(rBs.symbols.map((s: any) => s.name)))
  const freshHas = rBf.symbols.some((s: any) => s.name === "afterB")
  const sharedHas = rBs.symbols.some((s: any) => s.name === "afterB")
  if (freshHas && !sharedHas) console.log("FAIL HC5-instance-contamination :: shared instance suppresses file-B declaration (claim TRUE)")
  else console.log("ok   HC5-instance-contamination (freshHas=" + freshHas + " sharedHas=" + sharedHas + ")")
}
main()
