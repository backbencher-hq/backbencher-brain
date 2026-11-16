// #912 fixture authoring probe: for a candidate .c file, print whether the
// measured arrival shape is present (an ERROR holding identifier tokens plus a
// call-expression declarator, followed by a body) and what the PRODUCTION entry
// publishes for the names involved.
//   bun script/m14/tmp/c912-arrival-probe.ts <file.c> [names...]
import { readFileSync } from "node:fs"
import path from "node:path"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const p = new P(); p.setLanguage(lang)

const file = process.argv[2]
const names = process.argv.slice(3)
const src = readFileSync(file, "utf8")
const root = p.parse(src).rootNode
const lines = src.split("\n")
let found = 0
const st: any[] = [root]
while (st.length) {
  const n = st.pop()!
  if (n.type === "ERROR") {
    const kids: any[] = []
    for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i))
    const calls = kids.filter((k: any) => k.type === "call_expression")
    if (calls.length) {
      found++
      console.log(`ERROR rows ${n.startPosition.row + 1}..${n.endPosition.row + 1}: ${kids.map((k: any) => `${k.type}@${k.startPosition.row + 1}`).join(" ")}`)
    }
  }
  for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
}
console.log(`call-shaped ERROR sites: ${found}`)

const { parseFile } = await import(path.join(ROOT, "src", "ast", "engine.ts"))
const res: any = await parseFile(file, src, { language: "c" } as any)
const syms = (res.symbols ?? [])
if (names.length === 0) {
  console.log("--- all symbols")
  for (const s of syms) console.log(`  ${s.kind} ${s.name} @${s.range?.startLine} scope=${s.scope} vis=${s.visibility} rec=${(s.metadata||{}).glueNameShape ?? "-"}`)
  console.log("--- all relationships (sorted)")
  for (const r of [...(res.relationships ?? [])].map((r: any) => `${r.line_number}:${r.type}:${r.source}->${r.target}`).sort()) console.log(`  ${r}`)
} else {
  for (const nm of names) {
    const hits = syms.filter((s: any) => s.name === nm)
    console.log(`--- ${nm}: ${hits.length} symbol(s)`)
    for (const s of hits) console.log(`  ${s.kind} @${s.range?.startLine} scope=${s.scope} vis=${s.visibility} meta=${JSON.stringify(s.metadata)}`)
  }
}
const rels = (res.relationships ?? []).filter((r: any) => names.some((nm) => r.target === nm || r.source === nm))
for (const r of rels.slice(0, 12)) console.log(`REL ${r.type} ${r.source}->${r.target} @${r.line_number} ${JSON.stringify(r.metadata ?? {})}`)
