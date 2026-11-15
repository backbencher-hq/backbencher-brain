// Dump the haskell fixture's relationships with each edge's `line_number` AND the
// fixture's own text at that line, so a line pin can be authored against the
// SOURCE (the name-bearing node is on that line) instead of copied from the run.
//
// Usage: bun script/m14/tmp/hs-fixture-line-dump.ts [file]
import { Parser, Language } from "web-tree-sitter"
import { readFileSync } from "node:fs"
import { RealHaskellAnalyzer } from "../../../src/ast/real-haskell-analyzer"

const FILE = process.argv[2] ?? "validation/m14/fixtures/haskell/payload-and-complexity.hs"

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-haskell.wasm", import.meta.url).pathname))
  const src = readFileSync(FILE, "utf8")
  const tree = parser.parse(src)!
  const r: any = new RealHaskellAnalyzer().analyze(tree.rootNode, src, FILE)
  const lines = src.split("\n")
  console.log(`${FILE}: symbols=${r.symbols.length} relationships=${r.relationships.length}`)
  const rows = (r.relationships ?? []).map((e: any) => ({
    type: String(e.type),
    source: e.source,
    target: e.target,
    line: e.line_number ?? null,
  }))
  rows.sort((a: any, b: any) => (a.line ?? 0) - (b.line ?? 0) || a.type.localeCompare(b.type))
  for (const e of rows) {
    const text = e.line ? (lines[e.line - 1] ?? "").trim().slice(0, 62) : "(no line)"
    console.log(`  ${String(e.line ?? "-").padStart(3)}  ${e.type.padEnd(12)} ${String(e.source).padEnd(16)} -> ${String(e.target).padEnd(26)} | ${text}`)
  }
  const unlined = rows.filter((e: any) => e.line === null)
  console.log(`unlined=${unlined.length}`)
  // Symbol naming lines too: a `contains` pin anchors on the CHILD's own line.
  for (const s of r.symbols ?? []) {
    if (["User", "UserId", "Ticket", "Mergeable", "recount", "signed", "Person"].includes(s.name))
      console.log(`  symbol ${String(s.name).padEnd(12)} kind=${s.kind} startLine=${s.range?.startLine}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
