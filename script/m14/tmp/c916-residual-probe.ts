// #916 residual triage: the whole-corpus c lane leaves exactly two unexplained
// edges that my change did NOT create (verified: identical PRE/POST at the
// analyzer level). Characterize each so it can be fixed or registered honestly.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(path.join(ROOT, "src/ast/engine.ts"))

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))

const SITES: Array<{ file: string; line: number; target: string; ctx: number }> = [
  { file: "/home/ishaq2321/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c", line: 8752, target: "BufSize", ctx: 8 },
  { file: "/home/ishaq2321/bb_tests/repositories/sqlite/src/resolve.c", line: 1336, target: "if", ctx: 6 },
]

for (const s of SITES) {
  const src = readFileSync(s.file, "utf8")
  const lines = src.split("\n")
  console.log(`\n================ ${s.file.split("/").pop()} :: L${s.line} target "${s.target}"`)
  for (let i = Math.max(0, s.line - 1 - s.ctx); i < Math.min(lines.length, s.line + s.ctx); i++) {
    console.log(`  ${i + 1 === s.line ? ">>" : "  "} ${i + 1}: ${lines[i]}`)
  }
  const parser = new P()
  parser.setLanguage(lang)
  const root = parser.parse(src).rootNode
  // The node covering the reported line, and its ancestry.
  const st: any[] = [root]
  const hits: any[] = []
  while (st.length) {
    const n = st.pop()
    const ln = n.startPosition.row + 1
    if (ln === s.line && (n.type === "identifier" || n.type === "type_identifier") && n.text === s.target) hits.push(n)
    if (n.startPosition.row + 1 <= s.line && n.endPosition.row + 1 >= s.line) {
      for (let k = 0; k < n.namedChildCount; k++) st.push(n.namedChild(k))
    }
  }
  for (const n of hits) {
    const chain: string[] = []
    let c: any = n
    while (c) {
      const field = c.parent ? (() => {
        for (const f of ["declarator", "type", "name", "function", "body"]) if (c.parent.childForFieldName?.(f) === c) return f
        return ""
      })() : ""
      chain.push(`${c.type}${field ? "#" + field : ""}`)
      c = c.parent
    }
    console.log(`  TREE at L${s.line}: ${chain.join(" < ")}`)
  }
  if (hits.length === 0) console.log(`  TREE: no identifier node named "${s.target}" at L${s.line}`)

  const res: any = await parseFile(s.file, src, { language: "c" })
  const rels = (res.relationships ?? []).filter((r: any) => r.target === s.target && r.line_number === s.line)
  console.log(`  ANALYZER edges at L${s.line} -> "${s.target}": ${rels.length}`)
  for (const r of rels) console.log(`    ${r.type} ${r.source} -> ${r.target} [${r.metadata?.relationshipType ?? ""}]`)
  const sym = (res.symbols ?? []).find((x: any) => x.name === s.target)
  console.log(`  symbol "${s.target}": ${sym ? `${sym.kind}@${sym.range?.startLine} scope=${sym.scope ?? "?"} owner=${sym.ownerName ?? "-"}` : "ABSENT"}`)
}
