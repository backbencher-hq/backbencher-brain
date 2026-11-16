// #918 verification: the six sites through the PRODUCTION entry — symbol? name?
// return type? parameters? and is the body now a Function scope (edges sourced
// from the recovered function)?
import path from "node:path"
import fs from "node:fs"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))

const FILE = "<corpus-root>/bb_tests/repositories/sqlite/ext/wasm/libcmpp.c"
const EXPECT: Array<[number, string, string]> = [
  [5514, "cmpp_rc_cstr", "char const *"],
  [5529, "cmpp_mrealloc", "void *"],
  [5533, "cmpp_malloc", "void *"],
  [6102, "cmpp_dx_delim", "char const *"],
  [9526, "cmpp_b_reuse", "cmpp_b *"],
  [9714, "cmpp_b_borrow", "cmpp_b *"],
]
const LINES = EXPECT.map(([l]) => l)

const src = fs.readFileSync(FILE, "utf8")
const res: any = await parseFile(FILE, src, { language: "c" })
const syms: any[] = res.symbols ?? []
const rels: string[] = (res.relationships ?? []).map((r: any) => `${r.type}:${r.source}->${r.target}`)

console.log(`symbols=${syms.length} relationships=${rels.length}`)
for (const [line, name, ret] of EXPECT) {
  const sym = syms.find((s) => s.name === name && s.kind === "function") ?? syms.find((s) => s.name === name)
  const onLine = syms.filter((s) => Math.abs(s.range.startLine - line) <= 1)
  console.log(`\nL${line} ${name}:`)
  console.log(`   symbol=${sym ? "YES" : "NO"} kind=${sym?.kind ?? "-"} ret=${JSON.stringify(sym?.returnType ?? null)} meta=${JSON.stringify(sym?.metadata ?? null)}`)
  if (sym) {
    console.log(`   range=L${sym.range.startLine}:${sym.range.startColumn}-L${sym.range.endLine}:${sym.range.endColumn} params=${JSON.stringify(sym.parameters ?? [])}`)
  }
  console.log(`   symbols within 1 line: ${onLine.map((s) => `${s.kind}:${s.name}@L${s.range.startLine}`).join(", ") || "(none)"}`)
  // body edges sourced from this function
  const mine = rels.filter((r) => r.startsWith(`calls:${name}->`) || r.startsWith(`uses:${name}->`) || r.startsWith(`references:${name}->`))
  console.log(`   edges from ${name}: ${mine.slice(0, 8).join(" | ") || "(none)"}`)
}
// Any phantom symbols in the region?
const region = syms.filter((s) => s.range.startLine >= 5510 && s.range.startLine <= 9720)
console.log(`\nregion symbols (L5510-9720): ${region.map((s) => `${s.kind}:${s.name}@L${s.range.startLine}`).join(", ")}`)
