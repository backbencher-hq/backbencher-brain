// Per-statement profiling of the project-scope hot path on the reference index,
// through a BYTE-READ-ONLY handle so the measurement itself moves nothing.
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..")
process.env.BB_DATA_DIR = path.join(ROOT, ".bb-data")
process.env.BB_NO_AUTO_REFRESH = "1"
const { BrainDatabase } = await import("../../../src/brain/database")
const { getProjectId } = await import("../../../src/util/project-id")
const { DependencyGraphVisualizer } = await import("../../../src/ast/dependency-graph-visualizer")
const projectId = getProjectId(ROOT)
const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
const time = (label: string, fn: () => any) => { const t0 = performance.now(); const value = fn(); console.log(`${label}: ${(performance.now()-t0).toFixed(1)} ms`); return value }
const plan = (label: string, sql: string, ...params: any[]) => { console.log(`  plan ${label}:`, (raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as any[]).map((r) => r.detail).join(" | ")) }
time("count project (no join)", () => raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId))
const symbolSql = "SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? ORDER BY s.gravity_score DESC, s.line_start, s.id LIMIT ?"
plan("symbol fetch", symbolSql, projectId, 400)
const symbols: any[] = time("symbol fetch 400", () => raw.prepare(symbolSql).all(projectId, 400))
const ids = symbols.map((s) => s.id)
const relSql = `SELECT id AS row_id,source_symbol_id AS source_id,target_symbol_id AS target_id,relationship_type,confidence,is_cross_language,is_cross_file,bridge_mechanism,line_number FROM brain_relationship WHERE project_id = ? AND source_symbol_id IN (${ids.map(()=>"?").join(",")}) AND target_symbol_id IN (${ids.map(()=>"?").join(",")})`
const relationships: any[] = time("relationships among 400", () => raw.prepare(relSql).all(projectId, ...ids, ...ids))
const classOwners = symbols.filter((s) => ["class","struct","interface","enum","trait","type","protocol","object"].includes(String(s.symbol_type))).map((s) => s.id)
console.log("class-like owners in fetch:", classOwners.length)
if (classOwners.length) {
  const memberSql = `SELECT r.source_symbol_id AS owner_id, r.target_symbol_id AS member_id, child.name AS member_name, child.symbol_type AS member_type FROM brain_relationship r JOIN brain_symbol child ON child.id = r.target_symbol_id WHERE r.project_id = ? AND r.relationship_type = 'contains' AND r.source_symbol_id IN (${classOwners.map(()=>"?").join(",")}) AND r.target_symbol_id NOT IN (${ids.map(()=>"?").join(",")}) LIMIT ?`
  plan("member scan", memberSql, projectId, ...classOwners, ...ids, 3000)
  const members: any[] = time("member scan", () => raw.prepare(memberSql).all(projectId, ...classOwners, ...ids, 3000))
  console.log("members:", members.length)
  const memberIds = [...new Set(members.map((m) => m.member_id))]
  if (memberIds.length) {
    const rowsSql = `SELECT id FROM brain_relationship WHERE project_id = ? AND relationship_type <> 'contains' AND (source_symbol_id IN (${memberIds.map(()=>"?").join(",")}) OR target_symbol_id IN (${memberIds.map(()=>"?").join(",")})) LIMIT ?`
    plan("rows on members", rowsSql, projectId, ...memberIds, ...memberIds, 20000)
    time(`rows on ${memberIds.length} members`, () => raw.prepare(rowsSql).all(projectId, ...memberIds, ...memberIds, 20000))
  }
}
const all: any[] = time("graphData projection (400 syms)", () => DependencyGraphVisualizer.generateGraphData(symbols, relationships, {}))
console.log("projected:", all.nodes.length, "nodes", all.links.length, "links")
const names = [...new Set(all.nodes.map((n) => String(n.name)))].slice(0, 200)
time(`annotations by ${names.length} names`, () => raw.prepare(`SELECT symbol_name FROM brain_annotation WHERE project_id = ? AND symbol_name IN (${names.map(()=>"?").join(",")}) ORDER BY time_updated DESC LIMIT 50`).all(projectId, ...names))
