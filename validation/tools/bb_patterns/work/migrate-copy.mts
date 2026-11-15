// Prepare a measurement copy for the pattern coverage schema and RECORD the evidence:
// the additive migration on the open path, the generated column, the covering index,
// and the query plan the engine will actually get. Migration is a WRITE and belongs to
// this prepared COPY only; every measured call afterwards opens the copy read-only.
//
// Usage: BB_DATA_DIR=<lane dir holding the copy> npx tsx migrate-copy.mts <tier> <projectDir> <out.json>
import { writeFileSync, statSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"

const [tier, projectDir, outPath] = process.argv.slice(2)
if (!tier || !projectDir || !outPath) { console.error("usage: migrate-copy.mts <tier> <projectDir> <out.json>"); process.exit(2) }
if (!process.env.BB_DATA_DIR) { console.error("BB_DATA_DIR required"); process.exit(2) }
const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => ({ bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() })
const before = statOf(dbPath)

const t0 = performance.now()
const raw: any = await BrainDatabase.getRawInstance(projectId) // writable open: runs the additive migration
const migrationMs = Math.round((performance.now() - t0) * 100) / 100

const columns = (raw.prepare("PRAGMA table_xinfo(brain_relationship)").all() as any[]).map((c) => ({ name: c.name, type: c.type, hidden: c.hidden }))
const evidenceClass = columns.find((c) => c.name === "evidence_class") ?? null
const indexes = (raw.prepare("PRAGMA index_list(brain_relationship)").all() as any[]).map((i) => ({ name: i.name, unique: i.unique, origin: i.origin }))
const cover = indexes.find((i) => i.name === "brain_rel_pattern_cover_idx") ?? null
const coverColumns = cover
  ? (raw.prepare("PRAGMA index_info(brain_rel_pattern_cover_idx)").all() as any[]).map((c) => c.name)
  : []
const symbolIndexes = (raw.prepare("PRAGMA index_list(brain_symbol)").all() as any[]).map((i) => i.name)
const symbolCoverColumns = symbolIndexes.includes("brain_symbol_type_cover_idx")
  ? (raw.prepare("PRAGMA index_info(brain_symbol_type_cover_idx)").all() as any[]).map((c) => c.name)
  : []
// The engine's own shaped statements (gate names the generated column; the planner must
// answer them from the covering index).
const plan = (sql: string) => (raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as any[]).map((p) => p.detail)
const usageTypes = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides", "renders", "decorates", "mixes_in"]
const ph = usageTypes.map((_, i) => `@t${i}`).join(",")
const bind: Record<string, any> = { projectId, minConf: 0.7 }
usageTypes.forEach((t, i) => { bind[`t${i}`] = t })
const usedPlan = plan(
  `SELECT r.target_symbol_id AS id, ` +
    `MAX(CASE WHEN (CASE WHEN r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NOT NULL AND r.source_symbol_id = r.target_symbol_id THEN 1 ` +
    `WHEN r.evidence_class = 'inferred' THEN 2 WHEN r.confidence < @minConf THEN 3 ELSE NULL END) IS NULL AND r.source_symbol_id IS NOT NULL THEN 1 ELSE 0 END) AS used ` +
    `FROM brain_relationship r WHERE r.project_id = @projectId AND r.relationship_type IN (${ph}) AND r.target_symbol_id IS NOT NULL GROUP BY r.target_symbol_id`,
)
const distinctPlan = plan(
  `SELECT DISTINCT r.target_symbol_id AS id FROM brain_relationship r ` +
    `WHERE r.project_id = @projectId AND r.relationship_type IN (${ph}) AND r.evidence_class IS NOT 'inferred' AND r.confidence >= @minConf AND r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NOT NULL`,
)
const externalPlan = plan(
  `SELECT DISTINCT r.target_external AS ext FROM brain_relationship r WHERE r.project_id = @projectId AND r.relationship_type IN (${ph}) AND r.target_external IS NOT NULL AND r.evidence_class IS NOT 'inferred' AND r.confidence >= @minConf`,
)
const symbolPlan = plan(
  `SELECT s.id, s.name, s.symbol_type AS symbolType, s.visibility, COALESCE(s.line_start,0) AS line, COALESCE(s.line_end,0) AS lineEnd, f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = @projectId AND s.symbol_type IN ('function','method','class','interface','struct','enum')`,
)
const fileAggPlan = plan(
  `SELECT t.file_id AS f, COUNT(*) AS edges, COUNT(DISTINCT COALESCE(r.source_symbol_id, '?')) AS sources FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id WHERE r.project_id = @projectId AND r.relationship_type IN (${ph}) AND r.target_symbol_id IS NOT NULL AND (r.source_symbol_id IS NULL OR r.source_symbol_id <> r.target_symbol_id) AND t.file_id IS NOT NULL GROUP BY t.file_id`,
)
const countInferred = (raw.prepare(
  `SELECT COUNT(*) AS c FROM brain_relationship r WHERE r.project_id = @projectId AND r.relationship_type IN (${ph}) AND r.evidence_class = 'inferred'`,
).get(bind) as any).c
BrainDatabase.closeAll()
const after = statOf(dbPath)
const report = {
  tier, projectId, dbPath,
  migration: { ms: migrationMs, dbBefore: before, dbAfter: after, wrote: JSON.stringify(before) !== JSON.stringify(after) },
  schema: {
    evidenceClass,
    coverIndex: cover,
    coverColumns,
    symbolCoverIndex: symbolIndexes.includes("brain_symbol_type_cover_idx") ? "brain_symbol_type_cover_idx" : null,
    symbolCoverColumns,
    indexes: indexes.map((i) => i.name),
  },
  plans: { usedIncoming: usedPlan, distinctTarget: distinctPlan, distinctExternal: externalPlan, reportedSymbols: symbolPlan, fileCoverage: fileAggPlan },
  inferredRows: countInferred,
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ tier, migrationMs, evidenceClass, coverIndex: cover?.name, plans: report.plans, inferredRows: countInferred, dbBytes: after.bytes }, null, 1))
