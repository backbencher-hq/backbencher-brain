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
  const az = new RealTypeScriptAnalyzer()

  const src = [
    "function job() { return 1 }",
    "export function callOne() { job() }",
    "function job() { return 2 }",
    "export function callTwo() { job() }",
  ].join("\n") + "\n"
  const tree = parser.parse(src)
  const res: any = az.analyze(tree.rootNode, src, "probe.ts")
  const rels = res.relationships ?? []
  process.stderr.write("NRELS: " + rels.length + "\n")
  for (const r of rels.slice(0, 8)) {
    process.stderr.write("RELKEYS " + JSON.stringify(Object.keys(r)) + "\n")
    break
  }
  process.stderr.write("RELS: " + JSON.stringify(rels.slice(0, 6)) + "\n")
  process.exit(0)
}
main()
