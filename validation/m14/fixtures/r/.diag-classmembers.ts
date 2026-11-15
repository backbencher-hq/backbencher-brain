/** Dump classMembers as the analyzer builds it, for one file. */
import * as fs from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"
import { parseFile } from "../../../../src/ast/pool-worker"

const f = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories/R6/tests/testthat/test-portable-inheritance.R"
const content = fs.readFileSync(f, "utf8")
const parsed: any = await parseFile(f, content, "r")
const byOwner = new Map<string, string[]>()
for (const s of parsed.symbols ?? []) {
  if (!s.ownerName) continue
  if (s.kind !== ASTEngine.SymbolKind.Method && s.kind !== ASTEngine.SymbolKind.Property) continue
  const arr = byOwner.get(s.ownerName) ?? []
  arr.push(`${s.name}@${s.range?.startLine} kind=${s.kind} sys=${s.metadata?.objectSystem ?? "-"} line=${s.range?.startLine}-${s.range?.endLine}`)
  byOwner.set(s.ownerName, arr)
}
console.log("ownerName -> members (kind Method/Property), as classMembers sees them")
for (const [o, ms] of byOwner) {
  console.log(`  ${o} (${ms.length})`)
  for (const m of ms) console.log(`      ${m}`)
}
console.log("\nClass symbols and their baseClasses:")
for (const s of parsed.symbols ?? []) {
  if (s.kind !== ASTEngine.SymbolKind.Class) continue
  console.log(`  ${s.name}@${s.range?.startLine} baseClasses=${JSON.stringify(s.metadata?.baseClasses ?? null)} parent=${JSON.stringify(s.metadata?.parent ?? null)} sys=${s.metadata?.objectSystem ?? "-"}`)
}