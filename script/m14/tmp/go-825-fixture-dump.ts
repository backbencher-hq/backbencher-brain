// Dump the go/callsite-lines-825 fixture's relationships through the production
// entry, so the expectation file records MEASURED lines rather than guessed ones.
// Run: bun script/m14/tmp/go-825-fixture-dump.ts
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"

const F = "validation/m14/fixtures/rust/callsite-lines-825.rs"
const src = readFileSync(F, "utf8")
const res: any = await ASTEngine.parseFile(F, src)
console.log("errors:", (res.errors ?? []).length)
for (const e of res.errors ?? []) console.log("  ERR", e.range?.startLine, e.message?.slice(0, 80))
console.log("symbols:")
for (const s of res.symbols ?? []) {
  console.log(`  ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(14)} owner=${s.ownerName ?? "-"} line=${s.range?.startLine}`)
}
console.log("relationships:")
for (const r of res.relationships ?? []) {
  const rt = (r.metadata ?? {}).relationshipType ?? r.type
  console.log(`  ${String(rt).padEnd(34)} ${String(r.source).padEnd(8)} -> ${String(r.target).padEnd(12)} line=${r.line_number}`)
}
const lines = src.split("\n")
console.log("\nsource lines:")
lines.forEach((l, i) => console.log(`${String(i + 1).padStart(3)}| ${l}`))
