// #903 adjudication probe: dump the analyzer's own edges for the two files the
// red depth draws named, so each of the eight edges is decided on evidence
// (analyzer gap vs oracle artifact) rather than by reading the issue text.
//
// Run: bun script/m14/tmp/v903-vue-probe.ts
import { parseFile } from "../../../src/ast/pool-worker"

const ROOT = "<corpus-root>/bb_tests/repositories/element-plus"
const FILES = [
  `${ROOT}/docs/examples/table-v2/cell-templating.vue`,
  `${ROOT}/docs/examples/table-v2/inline-editing.vue`,
]

for (const file of FILES) {
  const r: any = await parseFile(file, ROOT)
  const rels = (r.relationships ?? []).filter((x: any) => ["calls", "references"].includes(String(x.type)))
  console.log(`\n=== ${file.split("/").pop()} ===`)
  console.log(`symbols: ${(r.symbols ?? []).map((s: any) => `${s.name}(${s.ownerName ?? "-"})`).join(", ")}`)
  const interesting = rels.filter((x: any) =>
    /dayjs|withKeys|\bkey\b|\breturn\b|\bmap\b|\bfrom\b|generateColumns|generateData|format/.test(`${x.source} ${x.target}`))
  for (const x of interesting) {
    console.log(`  ${x.type}  ${x.source} -> ${x.target}  line=${x.line_number ?? "-"} conf=${x.confidence} ${JSON.stringify(x.metadata)}`)
  }
  console.log(`  (total calls+references in file: ${rels.length}; interesting: ${interesting.length})`)
}
