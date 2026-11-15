// Discover, per real corpus repo: the most cross-language-connected symbols, plannable
// candidates per language, ambiguous names, and a path cohort that exceeds the cap.
import { readFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { generateMigrationPlans } from "../../../src/intelligence/migration/migration-engine"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const indexInfo = JSON.parse(readFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/real-corpus-index.json"), "utf8"))
const out: any[] = []
for (const repo of indexInfo.repos) {
  if (!repo.counts) continue
  const projectId = repo.projectId
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const crossSymbols = raw.prepare(
    `SELECT s.id id, s.name name, f.language language, f.relative_path file,
            COUNT(r.id) AS edges,
            SUM(CASE WHEN r.is_cross_language=1 THEN 1 ELSE 0 END) AS crossEdges
     FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
     JOIN brain_relationship r ON r.source_symbol_id=s.id OR r.target_symbol_id=s.id
     WHERE s.project_id=? AND s.symbol_type IN ('function','method','class','module','macro')
     GROUP BY s.id HAVING crossEdges > 0 ORDER BY crossEdges DESC, edges DESC LIMIT 10`,
  ).all(projectId) as any[]
  const ambiguous = raw.prepare(
    `SELECT lower(s.name) name, COUNT(DISTINCT s.file_id) files, COUNT(*) symbols
     FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
     WHERE s.project_id=? AND f.language IN ('elixir','erlang','clojure','javascript','typescript') AND s.symbol_type IN ('function','method','class','module','macro')
     GROUP BY lower(s.name) HAVING files > 1 ORDER BY symbols DESC LIMIT 5`,
  ).all(projectId) as any[]
  const dirs = raw.prepare(
    `SELECT substr(f.relative_path, 0, length(f.relative_path) - length(f.relative_path) + 1) dummy, COUNT(*) c FROM brain_file f WHERE f.project_id=? GROUP BY dummy LIMIT 1`,
  ).all(projectId)
  out.push({ id: repo.id, projectId, crossSymbols: crossSymbols.map((r: any) => ({ ...r, edges: Number(r.edges), crossEdges: Number(r.crossEdges) })), ambiguous: ambiguous.map((r: any) => ({ name: r.name, files: Number(r.files), symbols: Number(r.symbols) })) })
  console.log(JSON.stringify(out[out.length - 1]))
}
