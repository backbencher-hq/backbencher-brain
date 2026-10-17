// script/m71/diagnose-refactor-evidence.ts — REVIEW PROBE (not a gate).
//
// Before changing the refactor's coverage I need to know WHAT EVIDENCE THE INDEX
// ACTUALLY HOLDS for each cross-file shape: brain_import rows (imported_name /
// imported_as / import_path / resolved_symbol_id) and brain_relationship rows
// (with the source symbol or without). The fix must be built on rows that exist,
// not on rows I assume exist.
//
// Run: npx tsx script/m71/diagnose-refactor-evidence.ts

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { ASTEngine } from "../../src/ast/engine"

const DECL = `export function target(): number {\n  return 1\n}\n`

const CASES: Array<{ id: string; what: string; files: Record<string, string> }> = [
  { id: "A", what: "unaliased import + module-top-level call", files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const n = target()\n` } },
  { id: "B", what: "unaliased import + call inside a function", files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport function caller(): number {\n  return target()\n}\n` } },
  { id: "C", what: "ALIASED import + call through the alias", files: { "src/a.ts": DECL, "src/b.ts": `import { target as t } from './a'\nexport const n = t()\n` } },
  { id: "D", what: "import specifier only, no call", files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const x = 1\n` } },
  { id: "E", what: "re-export barrel", files: { "src/a.ts": DECL, "src/index.ts": `export { target } from './a'\n` } },
  { id: "F", what: "typeof target", files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const t = typeof target\n` } },
  { id: "G", what: "side-effect import only", files: { "src/a.ts": DECL, "src/b.ts": `import './a'\nexport const x = 1\n` } },
  { id: "H", what: "imports a DIFFERENT export, local named target", files: { "src/a.ts": DECL + `export function other(): number {\n  return 2\n}\n`, "src/b.ts": `import { other } from './a'\nconst target = 1\nexport const y = target + other()\n` } },
  { id: "I", what: "two unaliased importers, both module-top-level", files: { "src/a.ts": DECL, "src/b.ts": `import { target } from './a'\nexport const n = target()\n`, "src/c.ts": `import { target } from './a'\nexport const m = target()\n` } },
  { id: "M", what: "python: from a import target + call", files: { "a.py": `def target():\n    return 1\n`, "b.py": `from a import target\n\nvalue = target()\n` } },
  { id: "N", what: "cross-directory import", files: { "src/models/a.ts": DECL, "src/views/b.ts": `import { target } from '../models/a'\nexport const n = target()\n` } },
]

for (const c of CASES) {
  const root = mkdtempSync(path.join(tmpdir(), `bb-evid-${c.id}-`))
  for (const [rel, content] of Object.entries(c.files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), content)
  }
  const projectId = getProjectId(root)
  const declFile = Object.keys(c.files)[0] ?? "src/a.ts"
  try {
    await indexProjectParallel(projectId, root, {})
    const raw = await BrainDatabase.getRawInstance(projectId as any)
    console.log(`── ${c.id}: ${c.what}`)
    const found: any = await ASTEngine.findSymbol(projectId, "target", declFile)
    const match = (found.matches ?? [])[0]
    console.log(`   declaration symbol: ${match ? `${match.id} (type=${match.symbolType ?? match.type ?? "?"})` : "NOT FOUND"}`)

    const imports = raw.prepare(
      "SELECT f.relative_path AS rel, i.imported_name AS name, i.imported_as AS as_, i.import_path AS spec, " +
      "       i.import_type AS type, i.resolved_symbol_id AS resolved FROM brain_import i " +
      "JOIN brain_file f ON f.id = i.file_id WHERE i.project_id = ? ORDER BY f.relative_path",
    ).all(projectId) as any[]
    console.log(`   brain_import rows: ${imports.length}`)
    for (const r of imports) console.log(`     ${JSON.stringify(r)}`)

    const rels = raw.prepare(
      "SELECT r.relationship_type AS type, r.source_symbol_id AS src, s.name AS srcName, " +
      "       f.relative_path AS srcFile, s.byte_start AS bStart, s.byte_end AS bEnd, r.line_number AS line " +
      "FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id " +
      "LEFT JOIN brain_file f ON f.id = s.file_id WHERE r.project_id = ?",
    ).all(projectId) as any[]
    console.log(`   relationship rows: ${rels.length}`)
    for (const r of rels) console.log(`     ${JSON.stringify(r)}`)
  } catch (e: any) {
    console.log(`── ${c.id}: SETUP ERROR ${e?.message ?? String(e)}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}
console.log("PROBE COMPLETE")
