import * as fs from "fs"
import { RealTypeScriptAnalyzer } from "../../../src/ast/real-typescript-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-typescript.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const source = "export function f() { return 42 }\nclass C { @Get(\"items\") list() {} }\n"
  const tree = parser.parse(source)
  const az = new RealTypeScriptAnalyzer()
  const res: any = az.analyze(tree.rootNode, source, "probe.ts")
  const shape: any = {}
  for (const k of Object.keys(res)) shape[k] = Array.isArray(res[k]) ? res[k].length : typeof res[k]
  process.stderr.write("SHAPE: " + JSON.stringify(shape) + "\n")
  const syms = (res.symbols ?? []).slice(0, 6).map((s: any) => ({ n: s.name, k: s.kind, rt: s.returnType, api: s.apiContractPath }))
  process.stderr.write("SYMS: " + JSON.stringify(syms) + "\n")
  process.exit(0)
}
main()
