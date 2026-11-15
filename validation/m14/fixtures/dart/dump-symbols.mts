import * as path from "node:path"
import { readFileSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = (import.meta as any).dirname
const f = path.join(HERE, process.argv[2])
const r: any = await parseFile(f, HERE)
const kinds = new Map<string, number>()
for (const s of r.symbols ?? []) {
  const k = String(s.kind)
  kinds.set(k, (kinds.get(k) ?? 0) + 1)
}
console.log(`symbols ${(r.symbols ?? []).length}  rels ${(r.relationships ?? []).length}`)
console.log("kinds:", JSON.stringify([...kinds.entries()]))
console.log("")
console.log("name".padEnd(34) + "kind".padEnd(14) + "owner".padEnd(20) + "line")
console.log("-".repeat(88))
for (const s of r.symbols ?? []) {
  console.log(
    String(s.name).padEnd(34) +
      String(s.kind).padEnd(14) +
      String(s.ownerName ?? "").padEnd(20) +
      String(s.range?.start?.line ?? s.startLine ?? ""),
  )
}
console.log("")
console.log("relationships:")
for (const x of r.relationships ?? []) {
  console.log(`  ${String(x.type).padEnd(14)}${String(x.source).padEnd(20)}-> ${String(x.target).padEnd(24)} line ${x.line_number} conf ${x.confidence}`)
}