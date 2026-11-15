// Locate the reference-index walk cost: compare the engine's caller query with
// and without its owner-cascade JOIN, and read the query plans + indexes.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const pid = getProjectId(ROOT)
const raw: any = await (BrainDatabase as any).getRawInstance(pid)
const rows: any[] = []
const t = async (label: string, fn: () => any) => {
  const t0 = performance.now()
  let v: any
  try { v = fn() } catch (e) { v = { error: String((e as Error).message).slice(0, 200) } }
  const ms = Number((performance.now() - t0).toFixed(1))
  rows.push({ label, ms, value: v })
  console.log(`${label}: ${ms} ms ${JSON.stringify(v).slice(0, 300)}`)
}
const root = "1d3d57103be91b8f9716d70199fe28a3f39245d9:src/lsp/impact.ts:computeImpact:764"
const prefix = root.slice(0, root.lastIndexOf(":") + 1)
const upper = prefix + ";"
const kinds = ["calls", "instantiates", "extends", "implements"]
const ph = kinds.map(() => "?").join(",")
const kindRank = "CASE r.relationship_type WHEN 'calls' THEN 0 WHEN 'instantiates' THEN 1 WHEN 'extends' THEN 2 WHEN 'implements' THEN 3 ELSE 9 END"
const cols = "SELECT r.id AS rowId, r.line_number AS lineNumber, r.relationship_type AS relType, r.confidence AS confidence, s.id AS symId, s.name AS symName, s.line_start AS line, f.relative_path AS fileRel, " + kindRank + " AS kindRank "

// A. no cascade JOIN: target = root id exactly
const sqlA = cols + "FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id JOIN brain_file f ON f.id = s.file_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") AND r.target_symbol_id IN (SELECT id FROM brain_symbol WHERE id = ?) " +
  "ORDER BY kindRank, fileRel, lineNumber, rowId LIMIT ?"
await t("A-flat-in-list", () => raw.prepare(sqlA).all(pid, ...kinds, root, 201).length)

// B. cascade JOIN exactly as the engine writes it
const cascade = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
const sqlB = cols + "FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id JOIN brain_file f ON f.id = s.file_id " +
  "JOIN (" + cascade + ") casc ON casc.id = r.target_symbol_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") " +
  "ORDER BY kindRank, fileRel, lineNumber, rowId LIMIT ?"
await t("B-cascade-join", () => raw.prepare(sqlB).all(root, prefix, upper, pid, pid, ...kinds, 201).length)

// C. flat list form, no ORDER BY computed expression (rowid order)
const sqlC = cols.replace(", " + kindRank + " AS kindRank ", "") + "FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id JOIN brain_file f ON f.id = s.file_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") AND r.target_symbol_id IN (SELECT id FROM brain_symbol WHERE id = ?) LIMIT ?"
await t("C-flat-no-order", () => raw.prepare(sqlC).all(pid, ...kinds, root, 201).length)

// D. count only, flat
await t("D-count-flat", () => raw.prepare("SELECT COUNT(*) AS n FROM brain_relationship r WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") AND r.target_symbol_id = ?").get(pid, ...kinds, root))

// Plans
await t("plan-flat", () => raw.prepare("EXPLAIN QUERY PLAN " + sqlA).all(pid, ...kinds, root, 201))
await t("plan-cascade", () => raw.prepare("EXPLAIN QUERY PLAN " + sqlB).all(root, prefix, upper, pid, pid, ...kinds, 201))
// Indexes on the tables involved
await t("indexes-brain-symbol", () => raw.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='brain_symbol'").all())
await t("indexes-brain-relationship", () => raw.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='brain_relationship'").all())

writeFileSync(path.join(OUT, "latency-t2-query-cost.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  loadAverage: (await import("node:os")).loadavg(),
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2-query-cost.ts",
  rows,
}, null, 2) + "\n")
console.log("QUERYCOST_DONE")
