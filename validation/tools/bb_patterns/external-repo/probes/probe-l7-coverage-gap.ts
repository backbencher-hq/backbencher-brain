// 258 findings lost their COVERAGE GAP INDICATOR in the SQL-side rewrite. Find
// which of statements (4) and (5) is wrong, on a real symbol.
//
// The indicator fires when `symbolsWithAnyIncoming.has(sym.id)` is FALSE and
// `fileIncomingUsage.get(sym.fileId)` exists. The indicator vanishing means
// either the symbol is now wrongly in `symbolsWithAnyIncoming`, or its file is
// now missing from `fileIncomingUsage`. Those are different bugs with different
// fixes, so this checks both, per statement, against the raw rows.

import path from "node:path"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")

const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides"]
const typeParams: Record<string, string> = {}
const typeList = USAGE_TYPES.map((t, i) => { typeParams[`t${i}`] = t; return `@t${i}` }).join(",")
const usageFilter = `r.project_id = @projectId AND r.relationship_type IN (${typeList})`
const NOT_SELF_LOOP_SQL = `(r.target_symbol_id IS NOT NULL AND (r.source_symbol_id IS NULL OR r.source_symbol_id <> r.target_symbol_id))`

const pid = process.argv[2]
const symbol = process.argv[3]
const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })
const BIND = { projectId: pid, ...typeParams }

const sym = db.prepare(
  "SELECT s.id, s.name, s.file_id, s.symbol_type, f.relative_path FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id=? AND s.name=?",
).all(pid, symbol)
console.log(`symbol ${symbol}: ${sym.length} declaration(s)\n`)
for (const s of sym as any[]) {
  console.log(`  ${s.relative_path}  id=${s.id}  type=${s.symbol_type}`)

  // (5) as written.
  const inSet = db.prepare(
    `SELECT DISTINCT r.target_symbol_id AS id FROM brain_relationship r WHERE ${usageFilter} AND ${NOT_SELF_LOOP_SQL}`,
  ).all(BIND).some((r: any) => r.id === s.id)
  console.log(`    (5) symbolsWithAnyIncoming contains it: ${inSet}   (needs to be FALSE for the indicator)`)

  // (5) with the JOIN that ties the row to a real symbol -- maybe rows exist for
  // ids that are NOT in brain_symbol, and DISTINCT on the raw column keeps them.
  const joined = db.prepare(
    `SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id ` +
      `WHERE ${usageFilter} AND r.target_symbol_id = ?`,
  ).get(BIND, s.id) as any
  console.log(`    raw rows with target_symbol_id = this id: ${joined.c}`)

  const howTheyArrive = db.prepare(
    `SELECT r.relationship_type rt, r.source_symbol_id src, r.target_symbol_id tgt, r.confidence, ` +
      `json_extract(r.metadata,'$.evidenceClass') ev, r.target_external ext, t.id AS joined_ok ` +
      `FROM brain_relationship r LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id ` +
      `WHERE ${usageFilter} AND (r.target_symbol_id = ? OR r.target_external = ? OR r.target_external LIKE ?)`,
  ).all(BIND, s.id, symbol, `%${symbol}%`) as any[]
  console.log(`    rows naming it: ${howTheyArrive.length}`)
  for (const r of howTheyArrive.slice(0, 6)) {
    console.log(`      ${r.rt} src=${r.src ?? "NULL"} conf=${r.confidence} ev=${r.ev} joined=${r.joined_ok ? "yes" : "NO"}`)
  }

  // (4) as written, for this file.
  const fileEdges = db.prepare(
    `SELECT t.file_id AS f, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id ` +
      `WHERE ${usageFilter} AND ${NOT_SELF_LOOP_SQL} AND t.file_id = ? GROUP BY t.file_id`,
  ).get(BIND, s.file_id) as any
  console.log(`    (4) fileEdges for its file: ${fileEdges ? fileEdges.n : "NO ROW — file absent from fileIncomingUsage"}`)

  // The old pass, for the same file: every usage row whose target resolves to it.
  const oldWay = db.prepare(
    `SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id ` +
      `WHERE ${usageFilter} AND t.file_id = ? AND (r.source_symbol_id IS NULL OR r.source_symbol_id <> r.target_symbol_id)`,
  ).get(BIND, s.file_id) as any
  console.log(`    old pass, same file, same predicate: ${oldWay.c}`)
  console.log("")
}
db.close()
