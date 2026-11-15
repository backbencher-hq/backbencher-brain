import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../../src/ast/real-groovy-analyzer"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P(); parser.setLanguage(lang)
  const az = new RealGroovyAnalyzer()
  // error-containing file: does the analyzer still emit recoverable content?
  const src = "class Svc {\n  def m() { def x = 1 }\n  def healthy() { 2 }\n}\n"
  const tree = parser.parse(src)
  const res: any = az.analyze(tree.rootNode, src, "probe.groovy")
  process.stdout.write("parseError=" + (tree.rootNode as any).hasError + "\n")
  process.stdout.write("symbols: " + JSON.stringify((res.symbols ?? []).map((s: any) => s.name)) + "\n")
  process.stdout.write("errors reported: " + JSON.stringify((res.errors ?? []).slice(0, 3).map((e: any) => e.message ?? e)) + "\n")
}
main().catch((e) => { console.error(e); process.exit(1) })
