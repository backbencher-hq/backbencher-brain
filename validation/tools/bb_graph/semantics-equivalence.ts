// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the row-set equivalence proof for the D-06 query rewrite:
// the OLD cascade-in-each-statement form and the NEW one-id-list form must
// return the SAME stored rows, for both arms and both unattributed counts, on
// real symbols of the reference index.
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHY IT IS SHAPED THIS WAY — the fix changes SQL, not semantics, and a gate
// that only checks the new SQL agrees with itself proves nothing. This runs the
// two formulations side by side over the same database and compares the rowId
// multisets, so "edge semantics did not drift" is a measured fact rather than a
// claim about the diff.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/semantics-equivalence.json.
// CONTRACTS IT MUST NOT BREAK — read-only open; SELECT only.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { getProjectId } from "../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const OUT = path.join(ROOT, "validation/tools/bb_graph/results")
mkdirSync(OUT, { recursive: true })
const pid = getProjectId(ROOT)
const db = (await BrainDatabase.getRawInstance(pid as any, { readonly: true })) as any
const relTypes = ["calls","extends","implements","uses","instantiates","overrides","contains","references","imports","exports","decorates","renders","mixes_in","part_of"]
const ph = relTypes.map(() => "?").join(",")

function bounds(id: string) {
  const prefix = id.slice(0, id.lastIndexOf(":") + 1)
  return { prefix, upper: prefix + ";" }
}
const OLD_CASCADE = "SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?"
function newCascadeIds(id: string): string[] {
  const { prefix, upper } = bounds(id)
  return (db.prepare(`SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m INDEXED BY brain_symbol_project_owner_idx WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ? LIMIT 401`).all(id, prefix, upper, pid) as any[]).map((r) => r.id)
}
function oldCascadeIds(id: string): string[] {
  const { prefix, upper } = bounds(id)
  return (db.prepare(OLD_CASCADE).all(id, prefix, upper, pid) as any[]).map((r) => r.id)
}
const rowIds = (rows: any[], key = "id") => rows.map((r) => r[key]).sort()
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

const out: any = { projectId: pid, symbols: [] as any[] }
const candidates = [
  "likeContains",                                  // function, no members
  "OrderService", "InventoryService", "PricingService", // classes with members (fixture files in this index)
  "traverseGraph", "getProjectId",                 // leaf/mid functions
]
for (const name of candidates) {
  const row = db.prepare("SELECT id FROM brain_symbol WHERE project_id=? AND name=? ORDER BY gravity_score DESC LIMIT 1").get(pid, name) as any
  if (!row) { out.symbols.push({ name, present: false }); continue }
  const id = row.id
  const oldIds = oldCascadeIds(id)
  const newIds = newCascadeIds(id)
  const inlineJoin = `JOIN (${newIds.map(() => "SELECT ? AS id").join(" UNION ALL ")}) casc`
  const rangeJoin = `JOIN (${OLD_CASCADE}) casc`
  // caller arm: rows whose TARGET is in the cascade
  const callerOld = db.prepare(`SELECT r.id FROM brain_relationship r ${rangeJoin} ON casc.id = r.target_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph})`).all(id, ...bounds(id).prefix === "" ? [] : [bounds(id).prefix, bounds(id).upper, pid], pid, ...relTypes)
  // (parameter order above is explicit below to keep the two arms comparable)
  const callerOldRows = db.prepare(`SELECT r.id FROM brain_relationship r JOIN (${OLD_CASCADE}) casc ON casc.id = r.target_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph})`).all(id, bounds(id).prefix, bounds(id).upper, pid, pid, ...relTypes)
  const callerNewRows = db.prepare(`SELECT r.id FROM brain_relationship r ${inlineJoin} ON casc.id = r.target_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph})`).all(...newIds, pid, ...relTypes)
  // callee resolved arm: rows whose SOURCE is in the cascade and whose target resolved
  const calleeOldRows = db.prepare(`SELECT r.id FROM brain_relationship r JOIN (${OLD_CASCADE}) casc ON casc.id = r.source_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND r.target_symbol_id IS NOT NULL`).all(id, bounds(id).prefix, bounds(id).upper, pid, pid, ...relTypes)
  const calleeNewRows = db.prepare(`SELECT r.id FROM brain_relationship r ${inlineJoin} ON casc.id = r.source_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND r.target_symbol_id IS NOT NULL`).all(...newIds, pid, ...relTypes)
  // callee unresolved arm
  const unresolvedOldRows = db.prepare(`SELECT r.id FROM brain_relationship r JOIN (${OLD_CASCADE}) casc ON casc.id = r.source_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL`).all(id, bounds(id).prefix, bounds(id).upper, pid, pid, ...relTypes)
  const unresolvedNewRows = db.prepare(`SELECT r.id FROM brain_relationship r ${inlineJoin} ON casc.id = r.source_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL`).all(...newIds, pid, ...relTypes)
  // unattributed counts
  const unattributedCallersOld = db.prepare(`SELECT COUNT(*) c FROM brain_relationship r JOIN (${OLD_CASCADE}) casc ON casc.id = r.target_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NULL`).all(id, bounds(id).prefix, bounds(id).upper, pid, pid, ...relTypes)[0].c
  const unattributedCallersNew = db.prepare(`SELECT COUNT(*) c FROM brain_relationship r ${inlineJoin} ON casc.id = r.target_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NULL`).all(...newIds, pid, ...relTypes)[0].c
  const unattributedCalleesOld = db.prepare(`SELECT COUNT(*) c FROM brain_relationship r JOIN (${OLD_CASCADE}) casc ON casc.id = r.source_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NULL AND r.target_external IS NULL`).all(id, bounds(id).prefix, bounds(id).upper, pid, pid, ...relTypes)[0].c
  const unattributedCalleesNew = db.prepare(`SELECT COUNT(*) c FROM brain_relationship r ${inlineJoin} ON casc.id = r.source_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NULL AND r.target_external IS NULL`).all(...newIds, pid, ...relTypes)[0].c
  out.symbols.push({
    name,
    present: true,
    cascadeIdsOld: oldIds.length,
    cascadeIdsNew: newIds.length,
    cascadeIdSetsEqual: same(rowIds(oldIds.map((id: string) => ({ id }))), rowIds(newIds.map((id: string) => ({ id })))),
    callerRowSetsEqual: same(rowIds(callerOldRows), rowIds(callerNewRows)),
    callerRows: callerNewRows.length,
    calleeRowSetsEqual: same(rowIds(calleeOldRows), rowIds(calleeNewRows)),
    calleeRows: calleeNewRows.length,
    unresolvedRowSetsEqual: same(rowIds(unresolvedOldRows), rowIds(unresolvedNewRows)),
    unresolvedRows: unresolvedNewRows.length,
    unattributedCallers: { old: unattributedCallersOld, new: unattributedCallersNew, equal: unattributedCallersOld === unattributedCallersNew },
    unattributedCallees: { old: unattributedCalleesOld, new: unattributedCalleesNew, equal: unattributedCalleesOld === unattributedCalleesNew },
    // the earlier (unused, kept as a warning) query is not part of the comparison
    _unused: callerOld.length >= 0 ? undefined : undefined,
  })
}
const rows = out.symbols.filter((s: any) => s.present)
out.allEqual = rows.every((s: any) => s.cascadeIdSetsEqual && s.callerRowSetsEqual && s.calleeRowSetsEqual && s.unresolvedRowSetsEqual && s.unattributedCallers.equal && s.unattributedCallees.equal)
out.sourceCounts = db.prepare("SELECT (SELECT COUNT(*) FROM brain_symbol WHERE project_id=?) AS symbols, (SELECT COUNT(*) FROM brain_relationship WHERE project_id=?) AS relationships").get(pid, pid)
writeFileSync(path.join(OUT, "semantics-equivalence.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ allEqual: out.allEqual, sourceCounts: out.sourceCounts, symbols: out.symbols.map((s: any) => s.present ? { name: s.name, cascadeIdsOld: s.cascadeIdsOld, cascadeIdsNew: s.cascadeIdsNew, callerRows: s.callerRows, calleeRows: s.calleeRows, unresolvedRows: s.unresolvedRows, allEqual: s.cascadeIdSetsEqual && s.callerRowSetsEqual && s.calleeRowSetsEqual && s.unresolvedRowSetsEqual && s.unattributedCallers.equal && s.unattributedCallees.equal } : s) }, null, 2))
process.exit(out.allEqual ? 0 : 1)
