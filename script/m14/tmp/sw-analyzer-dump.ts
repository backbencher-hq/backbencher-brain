// Why does the analyzer not emit the bare uses the oracle derives?
// Dump symbols + every uses edge for the flagged file.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const NIO = "<corpus-root>/bb_tests/repositories/swift-nio"
const F = process.argv[2] ?? "Sources/NIOFS/FileType.swift"

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-swift.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  const src = fs.readFileSync(NIO + "/" + F, "utf8")
  const res: any = new RealSwiftAnalyzer().analyze(P.parse(src).rootNode, src, "FileType.swift")
  console.log("=== symbols mentioning regular/directory ===")
  for (const s of res.symbols ?? []) {
    if (String(s.name).match(/regular|directory/)) console.log("  " + JSON.stringify({ name: s.name, kind: s.kind, ownerName: s.ownerName, scope: s.scope }))
  }
  console.log("=== all uses edges ===")
  for (const r of (res.relationships ?? []).filter((x: any) => x.type === "uses")) {
    console.log("  " + r.source + " -> " + r.target + "  meta=" + JSON.stringify(r.metadata))
  }
  console.log("uses count = " + (res.relationships ?? []).filter((x: any) => x.type === "uses").length)
}
main()
