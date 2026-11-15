// ER3 fixture authoring probe: every edge the analyzer emits for
// validation/m14/fixtures/erlang/refs-er2.erl after the type-dependency
// narrowing, printed with its site line so the expectation file can be
// authored per fact (semantics), not copied from the run.
import { Parser, Language } from "web-tree-sitter"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
import { readFileSync } from "node:fs"

const FILE = "validation/m14/fixtures/erlang/refs-er2.erl"

async function main() {
  await Parser.init()
  const parser = new Parser()
  parser.setLanguage(await Language.load(new URL("../../../wasm/tree-sitter-erlang.wasm", import.meta.url).pathname))
  const src = readFileSync(FILE, "utf8")
  const tree = parser.parse(src)!
  const result = new RealErlangAnalyzer().analyze(tree.rootNode, src, FILE)
  const lines = src.split("\n")
  console.log(`symbols=${result.symbols.length} relationships=${result.relationships.length}`)
  const rows = result.relationships.map((r: any) => ({
    type: r.type, from: r.source, target: r.target,
    line: r.line_number ?? r.lineNumber ?? null,
    ctx: r.metadata?.context ?? "", arity: r.metadata?.callArity ?? "",
  }))
  rows.sort((a: any, b: any) => (a.line ?? 0) - (b.line ?? 0) || a.type.localeCompare(b.type) || a.from.localeCompare(b.from))
  for (const r of rows) {
    const at = r.line ? `L${String(r.line).padStart(2)}  ${(lines[r.line - 2] ?? "").trim().slice(0, 52)}` : ""
    console.log(`  ${String(r.line ?? "-").padStart(2)} ${r.type.padEnd(12)} ${String(r.from).padEnd(14)} -> ${String(r.target).padEnd(22)} ${String(r.ctx).padEnd(22)} ${r.arity} | ${at.replace(/^L\d+\s+/, "")}`)
  }
  parser.delete()
}

main().catch((e) => { console.error(e); process.exit(1) })
