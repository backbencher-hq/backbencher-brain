// script/m14/js-ontology/js-default-export-probe.ts — attribute JD2.4
// (script/m40/verify-import-resolution.ts): `import Def from "./lib.js"` must
// resolve through lib.js's `export default class Main`. This prints exactly what
// the analyzer stored for the same fixture, so the failure is located at the
// analysis or at the resolution step rather than guessed at.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const EMPTY = mkdtempSync(path.join(tmpdir(), "js-default-export-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const PROJ = path.join(EMPTY, "proj")
mkdirSync(path.join(PROJ, "src"), { recursive: true })
writeFileSync(path.join(PROJ, "bb.json"), JSON.stringify({ project: { name: "default-export", embedding: { provider: "none" } } }))

writeFileSync(path.join(PROJ, "src/lib.js"), `export function draw() { return 1 }\nexport class Widget { render() { return 2 } }\nexport default class Main { go() { return 3 } }\n`)
writeFileSync(path.join(PROJ, "src/app.js"), `import { draw as render } from "./lib.js"\nimport Def from "./lib.js"\nrender()\nDef()\n`)

const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const pid = getProjectId(PROJ) as any
const s = await indexProjectParallel(pid, PROJ, {})
console.log(`indexed: files=${s.totalFiles} rels=${s.relationshipsFound}`)
const raw = await BrainDatabase.getRawInstance(pid)

console.log("\nsymbols in src/lib.js:")
for (const sym of raw.prepare(`SELECT id, name, qualified_name FROM brain_symbol WHERE project_id = ? AND file_id = ? ORDER BY name`).all(pid, `${pid}:src/lib.js`) as any[]) {
  console.log(`  ${String(sym.name).padEnd(10)} qn=${String(sym.qualified_name).padEnd(14)} ${sym.id}`)
}

console.log("\nrelationship rows touching src/lib.js (as stored by the analyzer + resolution):")
const rows = raw
  .prepare(
    `SELECT r.relationship_type t, r.source_external se, r.target_external te, r.target_symbol_id tid, r.confidence c, r.metadata m
       FROM brain_relationship r
      WHERE r.project_id = ? AND (r.target_external LIKE '%lib.js%' OR r.source_external LIKE '%lib.js%')
      ORDER BY r.relationship_type, r.target_external`,
  )
  .all(pid) as any[]
for (const r of rows) {
  console.log(`  ${String(r.t).padEnd(9)} src=${String(r.se).padEnd(12)} target=${String(r.te).padEnd(26)} resolved=${r.tid ? "yes" : "NO"} conf=${r.c} meta=${r.m ? String(r.m).slice(0, 90) : "(none)"}`)
}

console.log("\nimports rows of src/app.js (what JD2.4 needs one of):")
for (const r of raw
  .prepare(
    `SELECT r.target_external te, r.target_symbol_id tid, r.metadata m
       FROM brain_relationship r JOIN brain_file f ON f.id = (SELECT file_id FROM brain_symbol WHERE id = r.source_symbol_id)
      WHERE r.project_id = ? AND r.relationship_type = 'imports'
      UNION ALL
     SELECT r.target_external te, r.target_symbol_id tid, r.metadata m
       FROM brain_relationship r
      WHERE r.project_id = ? AND r.relationship_type = 'imports' AND r.source_symbol_id IS NULL AND r.id LIKE '%:file:src/app.js:%'`,
  )
  .all(pid, pid) as any[]) {
  console.log(`  ${String(r.te).padEnd(28)} resolved=${r.tid ? "yes" : "NO"} meta=${r.m ? String(r.m).slice(0, 110) : "(none)"}`)
}
