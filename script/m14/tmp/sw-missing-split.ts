// #754 MISSING triage: for each flagged file, attribute each oracle-only `uses`
// target to deriveSwiftEdges (PRE-EXISTING truth) or deriveSwiftBareUses (NEW).
// Also locate the node path responsible, so the ruling is evidence-based.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"
import { RealSwiftAnalyzer } from "../../../src/ast/real-swift-analyzer"
import { deriveSwiftEdges, deriveSwiftBareUses } from "../differential"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const NIO = "/home/ishaq2321/bb_tests/repositories/swift-nio"
const FILES = [
  "Sources/NIOFS/FileType.swift",
  "Sources/NIOCore/EventLoop.swift",
  "Tests/NIOHTTP1Tests/TestUtils.swift",
  "Tests/NIOPosixTests/IPv4Header.swift",
  "Sources/NIOPosix/Bootstrap.swift",
]
const norm = (s: string) => String(s).replace(/[`()]/g, "")

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-swift.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  const az: any = new RealSwiftAnalyzer()

  for (const f of FILES) {
    const src = fs.readFileSync(NIO + "/" + f, "utf8")
    const tree = P.parse(src)
    const res: any = az.analyze(tree.rootNode, src, f.split("/").pop()!)
    const aUses = new Set<string>((res.relationships ?? []).filter((r: any) => r.type === "uses").map((r: any) => norm(r.target)))
    const pre = deriveSwiftEdges(tree.rootNode).filter((e) => e.label === "uses").map((e) => norm(e.target))
    const bare = deriveSwiftBareUses(tree.rootNode, res.symbols ?? []).map((e) => norm(e.target))
    const onlyA = [...aUses].filter((x) => !new Set([...pre, ...bare]).has(x))
    const onlyO = [...new Set([...pre, ...bare])].filter((x) => !aUses.has(x))
    console.log("=== " + f)
    console.log("  analyzer-only: " + JSON.stringify(onlyA))
    console.log("  oracle-only  : " + JSON.stringify(onlyO))
    console.log("    of which PRE-EXISTING (deriveSwiftEdges): " + JSON.stringify(onlyO.filter((x) => new Set(pre).has(x))))
    console.log("    of which NEW (bare mirror)             : " + JSON.stringify(onlyO.filter((x) => !new Set(pre).has(x))))
  }
}
main()
