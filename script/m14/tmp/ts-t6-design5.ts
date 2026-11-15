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

  // T6 observable shape: two top-level same-named ARROW functions in objects.
  // resolveCurrentSymbol uses byPos(name, Function, declarator.row) — with
  // dead byPos, the SECOND object's shorthand body attributed to the FIRST
  // object's member (first-name-match wins). The two objects' methods have
  // ownerName = their object variable.
  const src = [
    "const objA = {",
    "  handle() {",
    "    return callA()",
    "  },",
    "}",
    "const objB = {",
    "  handle() {",
    "    return callB()",
    "  },",
    "}",
  ].join("\n") + "\n"
  const tree = parser.parse(src)
  const res: any = az.analyze(tree.rootNode, src, "probe.ts")
  const rels = res.relationships ?? []
  const calls = rels.filter((r: any) => r.type === "calls")
  process.stderr.write("CALLS: " + JSON.stringify(calls.map((r: any) => ({ s: r.source, t: r.target }))) + "\n")
  process.exit(0)
}
main()
