// Debug dump: the analyzer's own output for one fixture, with the tree's
// top-level shapes, so a fixture failure can be read against the parse.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const file = process.argv[2] ?? path.join(ROOT, "validation/m14/fixtures/erlang/behaviour-otp.erl")

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new P()
  parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))
  const content = fs.readFileSync(file, "utf8")
  const tree = parser.parse(content)
  console.log(`hasError=${tree!.rootNode.hasError}`)
  let i = 0
  for (; i < tree!.rootNode.childCount; i++) {
    const c = tree!.rootNode.child(i)
    if (!c?.isNamed) continue
    let kids = ""
    for (let j = 0; j < c.namedChildCount; j++) {
      const k = c.namedChild(j)
      if (k) kids += `${k.type}@${k.startPosition.row + 1} `
    }
    console.log(`  [${c.startPosition.row + 1}] ${c.type}: ${kids}`)
  }
  const { RealErlangAnalyzer } = await import("../../../src/ast/real-erlang-analyzer")
  const r = new RealErlangAnalyzer().analyze(tree!.rootNode, content, file)
  console.log("\nSYMBOLS:")
  for (const s of r.symbols as any[]) {
    console.log(`  ${s.kind.padEnd(9)} ${s.name}/${(s.metadata ?? {}).arity ?? "-"} owner=${s.ownerName ?? "-"} line=${s.range.startLine} cx=${s.complexity} meta=${JSON.stringify(s.metadata)}`)
  }
  console.log("\nRELATIONSHIPS:")
  for (const e of r.relationships as any[]) {
    console.log(`  ${e.type.padEnd(11)} ${e.source} -> ${e.target} @${e.line_number ?? "-"} ${JSON.stringify(e.metadata)}`)
  }
  console.log("\nEXPORTS:", JSON.stringify(r.exports))
  console.log("IMPORTS:", JSON.stringify(r.imports))
  console.log("ERRORS:", (r.errors as any[]).length, JSON.stringify((r.errors as any[]).slice(0, 3)))
  console.log("METADATA:", JSON.stringify(r.metadata))
}
main().catch(e => { console.error(e); process.exit(1) })
