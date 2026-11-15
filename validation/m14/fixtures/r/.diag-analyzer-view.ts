/** The analyzer's own view: class symbol ranges, member lines, and emitted overrides. */
import * as fs from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"
import { parseFile } from "../../../../src/ast/pool-worker"

const f = process.argv[2]
const content = fs.readFileSync(f, "utf8")
const parsed: any = await parseFile(f, content, "r")
const syms: any[] = parsed.symbols ?? []

console.log("Class symbols as the pipeline reports them (startLine..endLine):")
for (const s of syms.filter(x => x.kind === ASTEngine.SymbolKind.Class)) {
  const bases = s.metadata?.baseClasses
  console.log(`  ${s.name}  ${s.startLine}..${s.endLine}  baseClasses=${JSON.stringify(bases ?? null)}`)
}

console.log("\nMethod/Property symbols with ownerName, by line:")
const byOwner = new Map<string, any[]>()
for (const s of syms) {
  if (!s.ownerName) continue
  if (s.kind !== ASTEngine.SymbolKind.Method && s.kind !== ASTEngine.SymbolKind.Property) continue
  const arr = byOwner.get(s.ownerName) ?? []
  arr.push(s)
  byOwner.set(s.ownerName, arr)
}
for (const [o, ms] of byOwner) {
  console.log(`  ${o} (${ms.length})`)
  for (const s of ms) console.log(`      ${s.name}  ${s.startLine}..${s.endLine}`)
}

console.log("\nemitted overrides edges:")
for (const r of parsed.relationships ?? []) {
  if (String(r.type) !== String(ASTEngine.RelationshipType.Overrides)) continue
  console.log(`  ${(r as any).source} -overrides-> ${(r as any).target} (overrides ${(r as any).metadata?.overriddenClass}) @line ${(r as any).line_number}`)
}