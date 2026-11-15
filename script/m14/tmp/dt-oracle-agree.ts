// #752 lockstep check: analyzer `uses` targets vs oracle `uses` targets.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"
import { RealDartAnalyzer } from "../../../src/ast/real-dart-analyzer"
import { deriveDartBareUses, deriveDartEdges } from "../differential"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILES = [
  "validation/m14/fixtures/dart/bare-member-read-uses.dart",
  "validation/m14/fixtures/dart/member-value-reads.dart",
  "validation/m14/fixtures/dart/family-closure-cascades.dart",
]

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-dart.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  const az: any = new RealDartAnalyzer()

  let bad = 0
  for (const f of FILES) {
    const src = fs.readFileSync(ROOT + "/" + f, "utf8")
    const tree = P.parse(src)
    const res: any = az.analyze(tree.rootNode, src, f.split("/").pop()!)
    const aUses = new Set<string>(
      (res.relationships ?? []).filter((r: any) => r.type === "uses").map((r: any) => String(r.target))
    )
    const oUses = new Set<string>([
      ...deriveDartEdges(tree.rootNode).filter((e) => e.label === "uses").map((e) => e.target),
      ...deriveDartBareUses(tree.rootNode, res.symbols ?? []).map((e) => e.target),
    ])
    const analyzerOnly = [...aUses].filter((x) => !oUses.has(x))
    const oracleOnly = [...oUses].filter((x) => !aUses.has(x))
    console.log("=== " + f)
    console.log("  analyzer-only targets: " + JSON.stringify(analyzerOnly))
    console.log("  oracle-only   targets: " + JSON.stringify(oracleOnly))
    if (analyzerOnly.length || oracleOnly.length) bad++
  }
  console.log(bad === 0 ? "AGREEMENT OK" : "DIVERGENCE in " + bad + " file(s)")
}

main()
