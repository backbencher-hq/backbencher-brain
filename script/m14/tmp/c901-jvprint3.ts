import { parseFile } from "../../../src/ast/pool-worker"
const F = "/home/ishaq2321/bb_tests/repositories/jq/src/jv_print.c"
const r: any = await parseFile(F, "/home/ishaq2321/bb_tests/repositories/jq")
for (const s of (r.symbols ?? [])) {
  const rng = s.range ? JSON.stringify(s.range).slice(0, 80) : "?"
  console.log(`${String(s.name).padEnd(26)} kind=${String(s.kind).padEnd(9)} ${rng}`)
}
