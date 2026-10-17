// script/m71/diagnose-refactor-caller-edges.ts — REVIEW PROBE for bb_edit (not a gate).
//
// The cross-file review probe showed a plain cross-file call NOT renamed, with
// `refactor … 1 site(s) across 1 file(s)`. That is either
//   (a) the index has no `calls` edge from b.ts to the a.ts symbol, or
//   (b) the edge exists and the refactor's caller query ignores it.
// This prints the stored rows and the exact query the engine runs.
//
// Run: npx tsx script/m71/diagnose-refactor-caller-edges.ts

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { ASTEngine } from "../../src/ast/engine"

const root = mkdtempSync(path.join(tmpdir(), "bb-review-edges-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), `export function target(): number {\n  return 1\n}\n`)
writeFileSync(path.join(root, "src", "b.ts"), `import { target } from './a'\nexport const n = target()\n`)
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const found: any = await ASTEngine.findSymbol(projectId, "target", "src/a.ts")
  const match = (found.matches ?? [])[0]
  console.log("symbol match:", JSON.stringify(match))
  const all = raw.prepare(
    "SELECT r.relationship_type AS type, r.source_symbol_id AS src, r.target_symbol_id AS tgt, s.name AS srcName, f.path AS srcFile " +
    "FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id LEFT JOIN brain_file f ON f.id = s.file_id " +
    "WHERE r.project_id = ?",
  ).all(projectId) as any[]
  console.log(`relationships rows: ${all.length}`)
  for (const row of all) console.log("  ", JSON.stringify(row))
  if (match) {
    const callerRows = raw.prepare("SELECT DISTINCT f.id AS fileId, f.path AS path, s.byte_start AS byteStart, s.byte_end AS byteEnd, r.relationship_type AS relType FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id JOIN brain_file f ON f.id=s.file_id WHERE r.target_symbol_id=? AND r.relationship_type IN ('calls','instantiates','references','uses')").all(match.id)
    console.log(`engine caller query rows: ${callerRows.length}`, JSON.stringify(callerRows))
  }
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
