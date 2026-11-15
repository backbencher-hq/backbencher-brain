// script/m14/tmp/c907-fixture-check.ts — negative/positive control for #907.
//
// Run before the fix: the two swallowed definitions must be ABSENT.
// Run after: they must be PRESENT at file scope, with the rest unchanged.
//
// Run: bun script/m14/tmp/c907-fixture-check.ts [path]
import { parseFile } from "../../../src/ast/pool-worker"

const F = process.argv[2] ?? "/home/ishaq2321/mcp/backbencher-brain/validation/m14/fixtures/c/swallowed-definitions-907.c"
const r: any = await parseFile(F, "/home/ishaq2321/mcp/backbencher-brain")
const fns = (r.symbols ?? []).filter((s: any) => String(s.kind) === "function")
console.log(`${F.split("/").pop()}: ${r.symbols?.length ?? 0} symbols, ${fns.length} functions, ${r.relationships?.length ?? 0} relationships`)
for (const f of fns) console.log(`   function ${f.name}  scope=${f.scope} line=${f.range?.startLine}`)
for (const n of ["jv_dumpf", "jv_dump", "jv_dump_term", "jv_show"]) {
  const hit = fns.find((s: any) => s.name === n)
  console.log(`   ${hit ? "PRESENT" : "ABSENT "} ${n}${hit ? ` (line ${hit.range?.startLine}, scope ${hit.scope})` : ""}`)
}
