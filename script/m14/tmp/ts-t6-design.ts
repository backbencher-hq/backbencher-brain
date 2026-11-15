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

  // T6 design: two classes with same-named method; calls inside each must
  // attribute to the OWNER-CORRECT symbol. Pre-fix (byPos dead), the second
  // class's definition re-attributed to the first class's symbol.
  const src = [
    "class A {",
    "  run() { return this.helperA() }",
    "  helperA() { return 1 }",
    "}",
    "class B {",
    "  run() { return this.helperB() }",
    "  helperB() { return 2 }",
    "}",
  ].join("\n") + "\n"
  const tree = parser.parse(src)
  const res: any = az.analyze(tree.rootNode, src, "probe.ts")
  const calls = (res.relationships ?? []).filter((r: any) => r.label === "calls")
  process.stderr.write("CALLS: " + JSON.stringify(calls.map((r: any) => ({ s: r.source, t: r.target }))) + "\n")
  process.exit(0)
}
main()
