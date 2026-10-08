/**
 * GO LANE — fixture emission dump. Read-only: prints what the PRODUCTION entry
 * (`parseFile`) emits for one fixture file, so an expectation row can be
 * diagnosed against real emission instead of guessed at.
 *
 * CLI: npx tsx script/m14/go-fixture-dump.ts validation/m14/fixtures/go/<name>.go [--type overrides]
 */
import { parseFile } from "../../src/ast/pool-worker"
import * as path from "node:path"

const target = process.argv[2]
const only = process.argv.includes("--type") ? process.argv[process.argv.indexOf("--type") + 1] : undefined
if (!target) {
  console.error("usage: go-fixture-dump.ts <file> [--type t]")
  process.exit(2)
}
const abs = path.resolve(process.cwd(), target)
const r: any = await parseFile(abs, path.dirname(abs))
const rels = (r.relationships ?? []) as any[]
const shown = only ? rels.filter((x) => String(x.type) === only) : rels
console.log(`\n${target}: ${r.symbols?.length ?? 0} symbols, ${rels.length} relationships`)
if (only) console.log(`(filtered to type=${only}: ${shown.length})`)
const byType = new Map<string, number>()
for (const x of rels) byType.set(String(x.type), (byType.get(String(x.type)) ?? 0) + 1)
console.log("types:", JSON.stringify(Object.fromEntries([...byType].sort((a, b) => b[1] - a[1]))))
for (const x of shown.sort((a, b) => String(a.source).localeCompare(String(b.source)) || String(a.target).localeCompare(String(b.target)))) {
  console.log(
    `  ${String(x.type).padEnd(12)} ${String(x.source).padEnd(24)} -> ${String(x.target).padEnd(24)} conf=${x.confidence} line=${x.line_number ?? "-"} md=${JSON.stringify(x.metadata ?? {})}`,
  )
}
console.log("\nsymbols:")
for (const s of (r.symbols ?? []) as any[]) {
  console.log(`  ${String(s.kind).padEnd(10)} ${String(s.name).padEnd(16)} vis=${s.visibility} owner=${s.ownerName ?? "-"} recv=${s.metadata?.receiverType ?? "-"} params=${(s.parameters ?? []).map((p: any) => p.type).join(",")} ret=${s.returnType ?? "-"}`)
}
process.exit(0)