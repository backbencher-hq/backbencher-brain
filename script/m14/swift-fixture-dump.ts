/**
 * FIXTURE DUMP — print what the analyzer produces for one fixture file, through
 * the PRODUCTION entry point (`ASTEngine.parseFile` via the pool worker, the
 * same path the fixture runner uses).
 *
 * This exists so a fixture's expectation file can be checked against real output
 * with the whole relationship set in view — including the types a fixture does
 * not pin, which is where an unasserted regression hides. It ASSERTS NOTHING: a
 * dump that failed would be a way of never seeing a difference.
 *
 * Usage: bun script/m14/swift-fixture-dump.ts validation/m14/fixtures/swift/<name>.swift
 */
import { parseFile } from "../../src/ast/pool-worker"
import * as path from "node:path"

const target = process.argv[2]
if (!target) { console.error("usage: swift-fixture-dump.ts <file.swift>"); process.exit(2) }
const abs = path.resolve(target)
const r: any = await parseFile(abs, path.dirname(abs))
const rels = (r.relationships ?? []) as any[]
const byType = new Map<string, any[]>()
for (const x of rels) {
  const t = String(x.type ?? x.relationshipType ?? "")
  if (!byType.has(t)) byType.set(t, [])
  byType.get(t)!.push(x)
}
console.log(`== ${target}`)
console.log(`symbols: ${(r.symbols ?? []).length}`)
for (const s of r.symbols ?? []) {
  console.log(`   ${String(s.kind).padEnd(12)} ${String(s.name).padEnd(28)} owner=${s.ownerName ?? "-"} vis=${s.visibility} line=${s.range?.startLine}`)
}
console.log(`\nimports: ${(r.imports ?? []).length}`)
for (const i of r.imports ?? []) console.log(`   module=${i.module} line=${i.range?.startLine} meta=${JSON.stringify(i.metadata)}`)
console.log(`\nexports: ${(r.exports ?? []).length}`)
for (const e of r.exports ?? []) console.log(`   ${JSON.stringify(e)}`)
console.log(`\nrelationships: ${rels.length}`)
for (const t of [...byType.keys()].sort()) {
  console.log(`  ${t} (${byType.get(t)!.length})`)
  for (const x of byType.get(t)!) {
    console.log(`     ${String(x.source).padEnd(24)} -> ${String(x.target).padEnd(28)} conf=${x.confidence} line=${x.line_number ?? "-"} ec=${x.metadata?.evidenceClass ?? "-"} md=${JSON.stringify(x.metadata)}`)
  }
}