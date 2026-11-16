// Dump the #901 fixture's real analyzer output.
// Run: bun script/m14/tmp/c901-fixture-dump.ts
import { parseFile } from "../../../src/ast/pool-worker"
const F = "<corpus-root>/mcp/backbencher-brain/validation/m14/fixtures/c/macro-forward-read.c"
const r: any = await parseFile(F, "<corpus-root>/mcp/backbencher-brain/validation/m14/fixtures/c")
console.log("symbols:", (r.symbols ?? []).map((s: any) => `${s.name}:${s.kind}${s.ownerName ? "(@" + s.ownerName + ")" : ""}`).join(", "))
console.log("edges:")
for (const x of (r.relationships ?? [])) console.log(`  ${x.type} ${x.source} -> ${x.target}`)
