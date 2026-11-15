// Microbenchmark for the orphan engine's relationship predicates on one tier.
// Times the exact access-path choices so the P-03 fix is chosen by measurement, not
// by taste: row scan, plausible index use, and the two spellings of the evidence-class
// test (json_extract vs a text substring that does not parse).
//
// Usage: BB_DATA_DIR=<tier data dir> npx tsx bench-predicates.mts <projectDir> <out.json>
import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) { console.error("usage: bench-predicates.mts <projectDir> <out.json>"); process.exit(2) }
const projectId = getProjectId(projectDir)
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const USAGE = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides", "renders", "decorates", "mixes_in"]
const ph = USAGE.map(() => "?").join(",")
const time = (label: string, sql: string, params: any[]) => {
  const stmt = raw.prepare(sql)
  const t0 = performance.now()
  const value = stmt.all(...params)
  const ms = Math.round((performance.now() - t0) * 100) / 100
  return { label, ms, rows: value.length, first: (value[0] as any) ?? null }
}
const results: any[] = []
results.push(time("count-usage-rows", `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph})`, [projectId, ...USAGE]))
results.push(time("usage-anchored", `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL`, [projectId, ...USAGE]))
results.push(time("usage-anchored-conf07", `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL AND confidence >= 0.7`, [projectId, ...USAGE]))
results.push(time("inferred-via-json_extract", `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND json_extract(metadata, '$.evidenceClass') = 'inferred'`, [projectId, ...USAGE]))
results.push(time("inferred-via-instr", `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND instr(metadata, '"evidenceClass":"inferred"') > 0`, [projectId, ...USAGE]))
results.push(time("inferred-via-instr-spaced", `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND instr(metadata, '"evidenceClass": "inferred"') > 0`, [projectId, ...USAGE]))
results.push(time("clean-via-json_extract", `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL AND source_symbol_id <> target_symbol_id AND confidence >= 0.7 AND json_extract(metadata, '$.evidenceClass') IS NOT 'inferred'`, [projectId, ...USAGE]))
results.push(time("clean-via-instr", `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL AND source_symbol_id <> target_symbol_id AND confidence >= 0.7 AND instr(metadata, '"evidenceClass":"inferred"') = 0`, [projectId, ...USAGE]))
results.push(time("distinct-target-instr", `SELECT DISTINCT target_symbol_id id FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL AND source_symbol_id <> target_symbol_id`, [projectId, ...USAGE]))
results.push(time("distinct-target-json", `SELECT DISTINCT target_symbol_id id FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL AND source_symbol_id <> target_symbol_id AND json_extract(metadata, '$.evidenceClass') IS NOT 'inferred' AND confidence >= 0.7`, [projectId, ...USAGE]))
results.push(time("all-symbol-id-file", "SELECT id, file_id FROM brain_symbol WHERE project_id = ?", [projectId]))
results.push(time("all-symbols-fileId", "SELECT s.id, s.file_id FROM brain_symbol s WHERE s.project_id = ?", [projectId]))
// Sample the metadata spellings that actually occur for the evidence-class test.
const samples = raw.prepare(`SELECT metadata FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND metadata LIKE '%inferred%' LIMIT 5`).all(projectId, ...USAGE)
const explain = (sql: string, params: any[]) => {
  try { return raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) } catch (e: any) { return [{ detail: `plan failed: ${e?.message ?? e}` }] }
}
const usedSql = `SELECT DISTINCT target_symbol_id id FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL AND source_symbol_id <> target_symbol_id AND json_extract(metadata, '$.evidenceClass') IS NOT 'inferred' AND confidence >= 0.7`
const report = {
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? null,
  loadavg: (await import("node:os")).loadavg(),
  benchmarks: results,
  metadataSamples: samples,
  plans: {
    usedIds: explain(usedSql, [projectId, ...USAGE]),
    inferredInstr: explain(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${ph}) AND instr(metadata, '"evidenceClass":"inferred"') > 0`, [projectId, ...USAGE]),
  },
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ loadavg: report.loadavg, benchmarks: results.map((r) => ({ label: r.label, ms: r.ms, rows: r.rows })), samples: samples.slice(0, 2) }, null, 1))
BrainDatabase.closeAll()
