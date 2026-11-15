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

  // What labels exist at all in this file?
  const src = [
    "function job() { return 1 }",
    "export function callOne() { job() }",
    "function job() { return 2 }",
    "export function callTwo() { job() }",
  ].join("\n") + "\n"
  const tree = parser.parse(src)
  const res: any = az.analyze(tree.rootNode, src, "probe.ts")
  const counts: any = {}
  for (const r of res.relationships ?? []) counts[r.label ?? "NULLLABEL"] = (counts[r.label] ?? 0) + 1
  process.stderr.write("LABELCOUNTS: " + JSON.stringify(counts) + "\n")
  const calls = (res.relationships ?? []).filter((r: any) => (r.label ?? "NULLLABEL") === "calls")
  process.stderr.write("ALLCALLS: " + JSON.stringify(calls.map((r: any) => ({ s: r.source, t: r.target }))) + "\n")
  process.exit(0)
}
main()
