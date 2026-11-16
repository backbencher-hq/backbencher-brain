// Round-6 (GOD9): dump the REAL Go analyzer output for one fixture, so its
// expectation is authored from live emission and never predicted. The CONTRACT
// comes from the god8/god9 rulings; only the values are read back.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function main() {
  const file = process.argv[2]!
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const abs = path.join(ROOT, "validation/m14/fixtures", file)
  const content = fs.readFileSync(abs, "utf8")
  const tree = parser.parse(content)
  const mod: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))
  const analyzer = new mod.RealGoAnalyzer()
  const res = await analyzer.analyze(tree.rootNode, content, `fixtures/${file}`)
  console.log(`===== ${file} =====`)
  for (const rel of res.relationships ?? []) {
    const m: any = rel.metadata ?? {}
    console.log(
      `${rel.type}\t${rel.source} -> ${rel.target}\t${m.relationshipType ?? "-"}\t${m.operationType ?? "-"}\tline ${rel.line_number ?? 0}`,
    )
  }
}
main()
