/**
 * Print the edges a fixture file actually produces, so an expectation is written from a
 * measurement rather than from a guess about what the analyzer does.
 *
 * Usage: npx tsx validation/m14/fixtures/sql/tmp/dump-edges.mts <file.sql>
 */
import { parseFile } from "../../../../../src/ast/pool-worker"
import { readFileSync } from "node:fs"

const file = process.argv[2]
const r: any = await parseFile(file, readFileSync(file, "utf8"))
const rels = r?.relationships ?? []
console.log(`symbols: ${(r?.symbols ?? []).length}  relationships: ${rels.length}`)
console.log("\n-- relationships --")
for (const e of rels) {
  const m = e.metadata ?? {}
  const shown = Object.keys(m).length ? JSON.stringify(m) : "-"
  console.log(`${String(e.type).padEnd(11)} ${String(e.source).padEnd(20)} -> ${String(e.target).padEnd(24)} ${shown}`)
}