/** Raw dump: what the parse result actually contains for R6Class assignments. */
import * as fs from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const f = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories/R6/tests/testthat/test-portable-inheritance.R"
const content = fs.readFileSync(f, "utf8")
const parsed: any = await parseFile(f, content, "r")
const syms: any[] = parsed.symbols ?? []
console.log(`symbols: ${syms.length}`)
const classes = syms.filter((s) => String(s.kind).toLowerCase().includes("class"))
console.log(`class-kind symbols: ${classes.length}`)
console.log("first 3 raw:")
for (const s of classes.slice(0, 3)) console.log(JSON.stringify(s, null, 1))
console.log("\nrel types:")
const t = new Map<string, number>()
for (const r of parsed.relationships ?? []) {
  const k = String((r as any).type)
  t.set(k, (t.get(k) ?? 0) + 1)
}
for (const [k, n] of [...t.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`)
console.log("\nfirst 3 extends rels raw:")
for (const r of (parsed.relationships ?? []).filter((x: any) => String((x as any).type).includes("xtend")).slice(0, 3)) console.log(JSON.stringify(r, null, 1))