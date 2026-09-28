import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../src/cli/index"
import { BrainDatabase } from "../src/brain/database"
import { indexProjectParallel } from "../src/ast/parallel-indexer"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const fixture = resolve(root, "validation/m11/fixtures/dart")
const project = join(tmpdir(), `bb-m11-dart-${process.pid}`)
rmSync(project, { recursive: true, force: true })
cpSync(fixture, project, { recursive: true })
const projectId = getProjectId(project)
const logger = { log: (..._args: any[]) => {}, write: (_text: string) => {} }

await indexProjectParallel(projectId as any, project, { logger })
const db = await BrainDatabase.getRawInstance(projectId as any)
const symbols = db.prepare("SELECT name, symbol_type AS kind, line_start AS start_line, line_end AS end_line FROM brain_symbol WHERE project_id = ? ORDER BY name, line_start").all(projectId) as Array<{ name: string; kind: string; start_line: number; end_line: number }>
const relationships = db.prepare("SELECT relationship_type AS relationship_type, COUNT(*) AS count FROM brain_relationship WHERE project_id = ? GROUP BY relationship_type ORDER BY relationship_type").all(projectId) as Array<{ relationship_type: string; count: number }>
const imports = db.prepare("SELECT import_path, imported_name, imported_as, import_type, is_external, package_name FROM brain_import WHERE project_id = ? ORDER BY import_path, imported_name").all(projectId) as Array<{ import_path: string; imported_name: string; imported_as: string | null; import_type: string; is_external: number; package_name: string | null }>
const files = db.prepare("SELECT path, language FROM brain_file WHERE project_id = ? ORDER BY path").all(projectId) as Array<{ path: string; language: string }>
const relDetail = db.prepare("SELECT relationship_type AS relationship_type, line_number, source_symbol_id, target_symbol_id, source_external, target_external FROM brain_relationship WHERE project_id = ? ORDER BY line_number, relationship_type").all(projectId) as Array<{ relationship_type: string; line_number: number; source_symbol_id: string | null; target_symbol_id: string | null; source_external: string | null; target_external: string | null }>
const symById = Object.fromEntries(symbols.map((s) => [`${s.name}:${s.start_line}`, s.name]))
const result = {
  schemaVersion: 1,
  fixture: "validation/m11/fixtures/dart",
  projectId,
  files,
  symbols,
  imports,
  relationships,
  relationshipsDetail: relDetail.map((r) => ({
    type: r.relationship_type,
    line: r.line_number,
    source: r.source_external ?? (r.source_symbol_id ? Object.values(symById).find((n, idx) => symbols[idx] && symbols[idx].name && r.source_symbol_id!.includes(symbols[idx].name)) : null) ?? r.source_symbol_id,
    target: r.target_external ?? (r.target_symbol_id ? Object.values(symById).find((n, idx) => symbols[idx] && symbols[idx].name && r.target_symbol_id!.includes(symbols[idx].name)) : null) ?? r.target_symbol_id,
  })),
}
const output = resolve(root, "validation/m11/results/dart-observed.json")
mkdirSync(resolve(output, ".."), { recursive: true })
writeFileSync(output, JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({ files: files.length, symbols: symbols.length, relationshipTypes: relationships, imports: imports.length }, null, 2))
rmSync(project, { recursive: true, force: true })
rmSync(BrainDatabase.getDbPath(projectId), { recursive: true, force: true })
