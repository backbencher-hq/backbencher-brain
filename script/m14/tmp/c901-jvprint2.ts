import { parseFile } from "../../../src/ast/pool-worker"
const F = "/home/ishaq2321/bb_tests/repositories/jq/src/jv_print.c"
const r: any = await parseFile(F, "/home/ishaq2321/bb_tests/repositories/jq")
for (const s of (r.symbols ?? [])) {
  if (String(s.name).includes("dump") || String(s.name) === "jv_show") {
    console.log(`${s.name} | kind=${s.kind} | scope=${s.scope} | line=${s.range?.startLine ?? JSON.stringify(s.range)}`)
  }
}
console.log("--- total symbols:", (r.symbols ?? []).length)
console.log("--- edges with jv_dumpf/jv_dump targets or sources:")
for (const x of (r.relationships ?? [])) {
  if (String(x.target).includes("jv_dump") || String(x.source).includes("jv_dump")) console.log(`  ${x.type} ${x.source} -> ${x.target}`)
}
