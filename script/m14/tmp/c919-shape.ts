// #919: the parse shape of a macro-call heading followed by a block, and what
// the analyzer currently publishes inside that body.
//   bun script/m14/tmp/c919-shape.ts <file> <line>
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-cpp.wasm")))
const parser = new P(); parser.setLanguage(lang)

const file = process.argv[2]
const line = Number(process.argv[3])
const src = readFileSync(file, "utf8")
const lines = src.split("\n")
const root = parser.parse(src).rootNode

// every expression_statement with a missing token near the line, plus its next sibling
const hits: any[] = []
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.type === "expression_statement" && n.startPosition.row + 1 >= line - 2 && n.startPosition.row + 1 <= line + 2) {
    let missing = false
    for (let i = 0; i < n.childCount; i++) if (n.child(i)?.isMissing) missing = true
    hits.push({ n, missing })
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
console.log(`file=${path.basename(file)}:${line}`)
console.log(`heading text: ${JSON.stringify((lines[line - 1] ?? "").trim().slice(0, 100))}`)
for (const h of hits) {
  const n = h.n
  console.log(`\nexpression_statement @${n.startPosition.row + 1} missing=${h.missing}`)
  console.log(`  parent: ${n.parent?.type}`)
  console.log(`  children: ${(() => { const o: string[] = []; for (let i = 0; i < n.childCount; i++) { const c = n.child(i)!; o.push(c.type + (c.isMissing ? "(MISSING)" : "")) } return o.join(" ") })()}`)
  console.log(`  first child: ${n.child(0)?.type} → ${JSON.stringify((n.child(0)?.text ?? "").slice(0, 70))}`)
  const nx = n.nextSibling
  console.log(`  nextSibling: ${nx?.type}${nx?.isMissing ? "(MISSING)" : ""} @${(nx?.startPosition.row ?? 0) + 1}`)
  if (nx?.type === "compound_statement") console.log(`    body spans lines ${nx.startPosition.row + 1}..${nx.endPosition.row + 1}`)
  console.log(`  sexp: ${n.toString().split("\n")[0].slice(0, 160)}`)
}

const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const res: any = await parseFile(file, src, { language: "cpp" })
const win = (r: any) => r?.line_number >= line - 1 && r?.line_number <= line + 70
const syms = (res.symbols ?? []).filter((s: any) => s.range?.startLine >= line - 1 && s.range?.startLine <= line + 70)
console.log(`\nanalyzer: ${res.symbols?.length} symbols, ${res.relationships?.length} relationships`)
console.log(`symbols in window: ${syms.map((s: any) => `${s.range.startLine}:${s.kind}:${s.name}`).join(", ") || "(none)"}`)
const rels = (res.relationships ?? []).filter(win)
const owners = new Map<string, number>()
for (const r of rels) owners.set(String(r.source), (owners.get(String(r.source)) ?? 0) + 1)
console.log(`relationships in window: ${rels.length} — sources: ${[...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(", ")}`)
