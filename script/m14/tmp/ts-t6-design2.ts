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

  // T6 design 2: same-named TOP-LEVEL functions + plain calls. byPos with
  // owner=undefined must resolve each call to ITS OWN line's declaration.
  // Pre-fix (dead byPos): both resolve to the first 'job' (first-name-match).
  const src = [
    "function job() { return 1 }",
    "export function callOne() { job() }",
    "function job() { return 2 }",
    "export function callTwo() { job() }",
  ].join("\n") + "\n"
  const tree = parser.parse(src)
  const res: any = az.analyze(tree.rootNode, src, "probe.ts")
  const rels = (res.relationships ?? []).filter((r: any) => r.label === "calls" && r.target === "job")
  const sources = rels.map((r: any) => r.source)
  const jobs = (res.symbols ?? []).filter((s: any) => s.name === "job")
  process.stderr.write("JOBS: " + JSON.stringify(jobs.map((s: any) => ({ ln: s.range?.startLine }))) + "\n")
  process.stderr.write("CALLSOURCES: " + JSON.stringify(sources) + "\n")
  process.exit(0)
}
main()
