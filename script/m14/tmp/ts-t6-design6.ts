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

  // T6 payload-observable shape: same-named methods on two objects; each body
  // calls a DISTINCT function. Correct: objA.handle.qualified_calls=["callA"],
  // objB.handle.qualified_calls=["callB"]. Dead byPos: first-name-match
  // resolves BOTH bodies to one handle symbol -> payloads collide/split wrong.
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
  const hs = (res.symbols ?? []).filter((s: any) => s.name === "handle")
  process.stderr.write("HANDLES: " + JSON.stringify(hs.map((s: any) => ({ o: s.ownerName, ln: s.range?.startLine, qc: s.qualified_calls }))) + "\n")
  process.exit(0)
}
main()
