// #917 fixture teeth: the SAME fixture through HEAD's analyzer (imported side
// by side, so the working tree is never swapped) vs the fixed one.
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const { RealCAnalyzer: Post } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const { RealCPreAnalyzer917: Pre } = await import(path.join(ROOT, "src/ast/zz-c917-pre-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const F = path.join(ROOT, "validation/m14/fixtures/c/macro-wrapped-heading-917.c")
const src = readFileSync(F, "utf8")
const parser = new P()
parser.setLanguage(lang)
const root = parser.parse(src).rootNode
for (const [tag, A] of [["PRE ", Pre], ["POST", Post]] as const) {
  const res: any = new A().analyze(root, src, F)
  const syms = (res.symbols ?? []).map((s: any) => `${s.kind}:${s.name}@${s.range?.startLine}${s.metadata?.recoveredFromMacroWrappedHeader ? "(rec)" : ""}`)
  const rels = (res.relationships ?? []).map((r: any) => `${r.type} ${r.source}->${r.target}@${r.line_number}`)
  console.log(`\n== ${tag} symbols (${syms.length})`)
  for (const s of syms) console.log(`   ${s}`)
  console.log(`== ${tag} edges (${rels.length})`)
  for (const r of rels) console.log(`   ${r}`)
}
