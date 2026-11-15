// Compare the counting walk's level statement form on the hub: the current
// IN(subquery over ids + owner ranges) form versus a flat, target-indexed IN
// list built from the same ids and their cascade-range members.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/work/t2-count-form.json")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { IMPACT_REL_TYPES } = await import(path.join(ROOT, "src/lsp/impact.ts"))

const pid = getProjectId(ROOT)
const raw: any = await (BrainDatabase as any).getRawInstance(pid, { readonly: true })
const SYMBOL = "getRawInstance"
const kinds = [...IMPACT_REL_TYPES]
const ph = kinds.map(() => "?").join(",")
const root = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1").get(pid, SYMBOL) as { id: string }

const rows: any[] = []
const time = async (label: string, fn: () => unknown) => {
  const t0 = performance.now()
  let v: any
  try { v = fn() } catch (e) { v = { error: String((e as Error).message).slice(0, 160) } }
  rows.push({ label, ms: Number((performance.now() - t0).toFixed(1)), value: v })
  console.log(`${label}: ${rows[rows.length - 1].ms} ms ${JSON.stringify(v).slice(0, 200)}`)
}
const cascade = (id: string) => (id.includes(":") ? id.slice(0, id.lastIndexOf(":") + 1) : "")

const levelSqlSubquery = (ids: number, ranges: number) =>
  "SELECT s.id AS id, s.name AS name, f.relative_path AS file, r.target_symbol_id AS targetId FROM brain_relationship r " +
  "JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
  "JOIN brain_file f ON f.id = s.file_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") " +
  "AND r.target_symbol_id IN (SELECT m.id FROM brain_symbol m WHERE m.project_id = ? AND (m.id IN (" +
  new Array(ids).fill("?").join(",") +
  ")" + new Array(ranges).fill(" OR (m.owner_symbol_id >= ? AND m.owner_symbol_id < ?)").join("") + "))"

const flatSql = (n: number) =>
  "SELECT s.id AS id, s.name AS name, f.relative_path AS file, r.target_symbol_id AS targetId FROM brain_relationship r " +
  "JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id " +
  "JOIN brain_file f ON f.id = s.file_id " +
  "WHERE r.project_id = ? AND r.relationship_type IN (" + ph + ") AND r.target_symbol_id IN (" + new Array(n).fill("?").join(",") + ")"

// Level 0: who depends on the root?
const level0 = raw.prepare(levelSqlSubquery(1, 1)).all(pid, ...kinds, pid, root.id, cascade(root.id), cascade(root.id) + ";") as Array<{ id: string; name: string }>
console.log(`level0 rows=${level0.length}`)
const batch = [...new Set(level0.map((r) => r.id))].slice(0, 200)
console.log(`batch=${batch.length}`)
const prefixes = [...new Set(batch.map(cascade))]

// Current form: batch ids + one OR term per distinct range.
await time("current-subquery-form", () => {
  const params: unknown[] = [pid, ...kinds, pid, ...batch]
  for (const prefix of prefixes) params.push(prefix, prefix + ";")
  return raw.prepare(levelSqlSubquery(batch.length, prefixes.length)).all(...params).length
})

// Flat form: resolve the cascade-range members with indexed owner lookups, then
// one target-indexed IN list.
await time("range-member-lookup", () => {
  const members: string[] = []
  for (const prefix of prefixes) {
    const found = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND owner_symbol_id >= ? AND owner_symbol_id < ?").all(pid, prefix, prefix + ";") as Array<{ id: string }>
    for (const row of found) members.push(row.id)
  }
  return members.length
})
const members: string[] = []
for (const prefix of prefixes) {
  const found = raw.prepare("SELECT id FROM brain_symbol WHERE project_id = ? AND owner_symbol_id >= ? AND owner_symbol_id < ?").all(pid, prefix, prefix + ";") as Array<{ id: string }>
  for (const row of found) members.push(row.id)
}
const targets = [...new Set([...batch, ...members])]
console.log(`flat targets=${targets.length} (members=${members.length})`)
await time("flat-in-form", () => raw.prepare(flatSql(targets.length)).all(pid, ...kinds, ...targets).length)
await time("flat-in-form-repeat", () => raw.prepare(flatSql(targets.length)).all(pid, ...kinds, ...targets).length)

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), symbol: SYMBOL, level0Rows: level0.length, batch: batch.length, prefixes: prefixes.length, members: members.length, targets: targets.length, rows }, null, 2) + "\n")
console.log("COUNT_FORM_DONE")
