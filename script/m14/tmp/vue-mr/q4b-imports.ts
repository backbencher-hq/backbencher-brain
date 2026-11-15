// Q4b — the import payload. The vue analyzer's imports were printed with only
// `line` and `module`; what do the fields look like before/after the seam, and
// how do they compare with the .ts/.js analyzer on identical source?
import * as path from "path"
import { vue, plain, rels } from "./harness"

const ENGINE = path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts")

const IMPORT_SRC = [
  "import Child from './Child.vue'",
  "import { helper as h, other } from './util'",
  "import * as ns from './ns'",
  "export { a } from './a'",
  "export * from './b'",
  "export const named = 1",
  "export default class Foo {}",
].join("\n")

function show(label: string, r: any) {
  console.log(`\n--- ${label}`)
  console.log(`  imports (${(r.imports ?? []).length}):`)
  for (const i of r.imports ?? []) {
    console.log(`    ${JSON.stringify(i)}`)
  }
  console.log(`  exports (${(r.exports ?? []).length}):`)
  for (const e of r.exports ?? []) {
    console.log(`    ${JSON.stringify(e)}`)
  }
}

async function main() {
  show("as .ts (typescript analyzer, direct)", await plain(IMPORT_SRC, "/tmp/probe/I.ts"))
  show("as .js (javascript analyzer, direct)", await plain(IMPORT_SRC, "/tmp/probe/I.js"))
  show("as .vue <script>", await vue(`<template><p/></template>\n<script>\n${IMPORT_SRC}\n</script>`, "/tmp/probe/I.vue"))
  show("as .vue <script lang=ts>", await vue(`<template><p/></template>\n<script lang="ts">\n${IMPORT_SRC}\n</script>`, "/tmp/probe/I.vue"))

  // Is the loss in the seam or in the sub-analyzer? Compare the SAME sub-result
  // before and after the merge by looking at the relationship targets, which the
  // analyzer does keep.
  const r = await vue(`<template><p/></template>\n<script>\n${IMPORT_SRC}\n</script>`, "/tmp/probe/I2.vue")
  console.log("\n--- import-derived relationships in the .vue result")
  for (const rel of rels(r, "imports")) console.log(`    ${rel.source} -> ${rel.target} @${(rel as any).line_number}`)
  const t = await plain(IMPORT_SRC, "/tmp/probe/I2.ts")
  console.log("--- the same in the .ts result")
  for (const rel of rels(t, "imports")) console.log(`    ${rel.source} -> ${rel.target} @${(rel as any).line_number}`)

  // And the import -> relationship reconciliation the store depends on
  console.log("\n=== Q4b.2  is every import reachable from a relationship? ===")
  for (const [label, rr] of [["vue", r], ["ts", t]] as const) {
    const impSources = new Set((rr.imports ?? []).map((i: any) => String(i.source ?? "")))
    const relSources = new Set(rels(rr, "imports").map((x: any) => String(x.source)))
    console.log(`  ${label}: imports.source values=${JSON.stringify([...impSources])} rels.source values=${JSON.stringify([...relSources])}`)
  }
}
main()
