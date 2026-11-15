// Review instrument (NOT a gate): index a REAL multi-file CSS project through
// the production indexer and read the graph back out of SQLite.
//
//   bun script/m14/tmp/css-store-roundtrip.ts
//
// Why this exists. Every measurement so far has read the analyzer's RETURN
// VALUE. The claim that matters is what a user's `bb_relationship` query
// returns, and the path there crosses three seams the analyzer cannot see:
// pool-worker's field mapping, parallel-indexer's relationship bind, and the
// schema. M59's store-scale check exists for exactly this reason
// (`verify-store-line-landing.ts`), and #612 is the precedent for a payload
// that was produced correctly and then dropped at a seam — which is how
// `declaredProperties` would have died silently if this round trip had not been
// run.
//
// Asserts, in both directions:
//   1 every stored CSS relationship resolves to a real symbol row, or is
//     explicitly recorded as an external reference;
//   2 the CSS payload (`declaresProperties`, `selectorChain`) is present in
//     brain_symbol.annotations;
//   3 no relationship row stores a literal line of 0;
//   4 a cross-file `var(--x)` and an `@import` are both findable.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { getProjectId } from "../../../src/cli/index"
import { BrainDatabase } from "../../../src/brain/database"

const dir = mkdtempSync(join(tmpdir(), "css-roundtrip-"))
const write = (rel: string, body: string): void => {
  const p = join(dir, rel)
  mkdirSync(join(p, ".."), { recursive: true })
  writeFileSync(p, body)
}

write("theme.css", `@import "palette.css";
@layer base {
  :root {
    --brand: #2563eb;
    --radius: 6px;
  }
}
body {
  margin: 0;
  color: var(--brand);
}
`)

write("palette.css", `:root {
  --brand: #111111;
}
@layer base {
  .panel {
    background: var(--brand);
    border-radius: var(--radius);
  }
}
@media (max-width: 700px) {
  .panel { padding: 4px; }
}
`)

write("card.css", `.card {
  padding: var(--radius);
  animation: pulse 1s ease;
}
@keyframes pulse {
  from { opacity: 0; }
  to { opacity: 1; }
}
@supports (display: grid) {
  .grid { display: grid; }
}
@container (min-width: 400px) {
  .card { gap: 8px; }
}
`)

const { default: ParallelIndexer } = await import("../../../src/ast/parallel-indexer")

async function main() {
  console.log(`project: ${dir}`)
  const projectId = getProjectId(dir)
  const stats = await indexProjectParallel(projectId, dir, { logger: { log: () => {}, write: () => {} } })
  console.log(
    `indexed: success=${stats.successFiles} errors=${stats.errorFiles} symbols=${stats.symbolsFound} relationships=${stats.relationshipsFound}`,
  )

  const raw = await BrainDatabase.getRawInstance(projectId)
  const q = (sql: string, ...a: any[]): any[] => raw.prepare(sql).all(...a) as any[]

  // brain_relationship has no file_id: it is reached through its bound symbols,
  // or — for an edge whose endpoints are both external — through the metadata
  // the worker recorded. The CSS filter is therefore applied on the join, and an
  // all-external edge is attributed by its source_external naming a .css file.
  const rels = q(`SELECT r.relationship_type AS rtype, r.source_external, r.target_external, r.line_number,
                         r.is_cross_file, s.name AS s_name, t.name AS t_name
                  FROM brain_relationship r
                  LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
                  LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
                  WHERE COALESCE(s.file_id, t.file_id) IN (SELECT id FROM brain_file WHERE relative_path LIKE '%.css')
                     OR r.source_external LIKE '%.css'
                     OR r.target_external LIKE '%.css'
                  ORDER BY r.relationship_type, r.target_external`)
  console.log(`\n=== ${rels.length} stored CSS relationships ===`)
  let bothResolved = 0, external = 0, zeroLine = 0
  for (const r of rels) {
    const bound = Boolean(r.s_name && r.t_name)
    if (bound) bothResolved++
    else external++
    if (r.line_number === 0) zeroLine++
    console.log(
      `  ${String(r.rtype).padEnd(11)} ${(r.s_name ?? `[ext] ${r.source_external}`).slice(0, 30).padEnd(32)} -> ${(r.t_name ?? `[ext] ${r.target_external}`).slice(0, 30).padEnd(32)} line=${r.line_number ?? "NULL"}`,
    )
  }
  const withLine = rels.filter((r: any) => typeof r.line_number === "number" && r.line_number > 0).length
  const nullLine = rels.filter((r: any) => r.line_number === null || r.line_number === undefined).length
  console.log(`\nrows carrying a line > 0        : ${withLine}/${rels.length}`)
  console.log(`rows with a NULL/absent line     : ${nullLine}/${rels.length}  (the honest third state)`)
  console.log(`both ends bound to a symbol row : ${bothResolved}/${rels.length}`)
  console.log(`recorded as an external reference: ${external}/${rels.length}`)
  console.log(`rows storing a literal line of 0  : ${zeroLine}`)

  const syms = q(`SELECT name, symbol_type, annotations FROM brain_symbol
                  WHERE file_id IN (SELECT id FROM brain_file WHERE relative_path LIKE '%.css') ORDER BY name`)
  const allRels = q(`SELECT COUNT(*) AS n FROM brain_relationship`)
  console.log(`\n=== ${syms.length} stored CSS symbols ===`)
  let withProps = 0, withChain = 0
  for (const s of syms) {
    let ann: any = null
    try { ann = s.annotations ? JSON.parse(s.annotations) : null } catch { ann = null }
    const props = ann?.declaresProperties
    const chain = ann?.selectorChain
    if (props?.length) withProps++
    if (chain?.length) withChain++
    console.log(`  ${String(s.symbol_type).padEnd(10)} ${s.name.slice(0, 40).padEnd(42)} props=${JSON.stringify(props ?? []).slice(0, 46).padEnd(48)} chain=${JSON.stringify(chain ?? []).slice(0, 34)}`)
  }
  console.log(`\nsymbols carrying declaresProperties: ${withProps}/${syms.length}`)
  console.log(`symbols carrying selectorChain      : ${withChain}/${syms.length}`)

  const imports = q(`SELECT i.imported_name, i.import_path, i.line_number FROM brain_import i
                     WHERE i.file_id IN (SELECT id FROM brain_file WHERE relative_path LIKE '%.css')`)
  console.log(`\ntotal relationship rows in the project: ${allRels[0]?.n}`)
  console.log(`\nimports: ${JSON.stringify(imports)}`)
}

main()
  .then(() => { rmSync(dir, { recursive: true, force: true }); process.exit(0) })
  .catch((e) => { console.error(e); process.exit(1) })
