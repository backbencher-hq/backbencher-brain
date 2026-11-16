// #912 part 1: `jq/src/builtin.c:2067 gen_last_1` — the site #907 refused. Print
// the tree around it (with the preceding #undef block and the macro-driven
// initializer list above), what the analyzer currently publishes there, and
// whether any STRUCTURAL discriminator exists that a macro invocation cannot
// also present.
//   bun script/m14/tmp/c912-site.ts [file] [fromLine] [toLine]
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const parser = new P(); parser.setLanguage(lang)

const file = process.argv[2] ?? "<corpus-root>/bb_tests/repositories/jq/src/builtin.c"
const from = Number(process.argv[3] ?? 2055)
const to = Number(process.argv[4] ?? 2075)
const src = readFileSync(file, "utf8")
const lines = src.split("\n")
const root = parser.parse(src).rootNode

const interesting = new Set([
  "translation_unit", "preproc_ifdef", "preproc_def", "preproc_call", "declaration",
  "expression_statement", "call_expression", "compound_statement", "function_definition",
  "initializer_list", "init_declarator", "ERROR",
])
const st: any[] = [root]
const rows: any[] = []
while (st.length) {
  const n = st.pop()!
  const s = n.startPosition.row + 1, e = n.endPosition.row + 1
  if (e >= from && s <= to && (interesting.has(n.type) || n.isMissing || n.isError)) {
    rows.push({ s, e, type: n.type, missing: n.isMissing, err: n.isError, text: n.text.slice(0, 60).replace(/\n/g, "\\n") })
  }
  if (e >= from && s <= to) for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
rows.sort((a, b) => a.s - b.s || a.e - b.e)
for (const r of rows) console.log(`${String(r.s).padStart(5)}..${String(r.e).padEnd(5)} ${r.type}${r.missing ? " MISSING" : ""}${r.err ? " ERROR" : ""}  ${r.text}`)
console.log("\n--- source ---")
for (let i = from; i <= to; i++) console.log(`${String(i).padStart(5)}| ${lines[i - 1]}`)

const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const a: any = new RealCAnalyzer()
const res: any = await a.analyze(root, src, { language: "c" })
const hits = (res.symbols ?? []).filter((s: any) => s.name.includes("gen_last") || (s.range?.startLine >= from && s.range?.startLine <= to))
console.log("\n--- analyzer symbols in the window ---")
for (const h of hits) console.log(`  ${h.kind} ${h.name} @${h.range?.startLine} owner=${h.ownerName ?? "-"}`)
const rels = (res.relationships ?? []).filter((r: any) => r.line_number >= from && r.line_number <= to)
console.log(`--- analyzer relationships in the window: ${rels.length} ---`)
for (const r of rels.slice(0, 12)) console.log(`  ${r.type} ${r.source} -> ${r.target} @${r.line_number}`)
