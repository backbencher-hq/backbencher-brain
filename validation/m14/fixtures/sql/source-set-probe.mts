/**
 * Which sources does one relationship type carry, per file? Used to settle WHERE a source-spelling
 * change altered which owner an edge was attributed to, as opposed to only changing the string.
 *
 *   npx tsx validation/m14/fixtures/sql/source-set-probe.mts <type> <file>…
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const type = process.argv[2]
const files = process.argv.slice(3)
if (!type || files.length === 0) {
  console.error("source-set-probe: <type> <file>…")
  process.exit(2)
}
for (const f of files) {
  const r: any = await parseFile(f, "sql")
  const rows = (r?.relationships ?? []).filter((e: any) => String(e?.type ?? "") === type)
  const bySource = new Map<string, number>()
  for (const e of rows) {
    const s = String(e?.source ?? "")
    bySource.set(s, (bySource.get(s) ?? 0) + 1)
  }
  console.log(`${f.slice(f.lastIndexOf("/") + 1)}  ${type} edges ${rows.length}  distinct sources ${bySource.size}`)
  for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(5)}  ${s}`)
  }
}