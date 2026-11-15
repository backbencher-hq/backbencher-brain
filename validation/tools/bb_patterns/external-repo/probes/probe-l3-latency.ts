// bb_tests/bb_patterns/probes/probe-l3-latency.ts
// L3 — where does the time go on a 20k-57k symbol index?
//
// The language coverage probe's own assertion caught this: three corpora exceed
// 30 seconds — gleam 31.3s, solidity 33.7s, v 40.6s — on indexes of 19,462,
// 56,738 and 54,483 symbols. The god-class query was already fixed and the
// orphan path is index-bound, so this is new behaviour, not a leftover.
//
// This attributes the wall clock to its statements. A fix that is chosen from
// "it felt slow" is a fix that guesses; each phase here is timed separately so
// the expensive one is named rather than assumed.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))
const { detectIndexRules } = await import(path.join(REPO, "src/intelligence/patterns/rules.ts"))

const USAGE = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides"]
const ph = USAGE.map(() => "?").join(",")

const targets = process.argv[2].split(",").map((s) => { const [pid, name] = s.split("="); return { pid, name } })

const time = (label: string, fn: () => number) => {
  const t0 = process.hrtime.bigint()
  const n = fn()
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`   ${ms.toFixed(0).padStart(7)}ms  rows=${String(n).padStart(7)}  ${label}`)
  return ms
}

for (const { pid, name } of targets) {
  const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })
  const syms = db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid) as { c: number }
  const rels = db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(pid) as { c: number }
  console.log(`\n=== ${name}  ${syms.c} symbols  ${rels.c} relationships ===`)
  if (syms.c === 0) { db.close(); continue }

  const PHASES: Array<[string, string, unknown[]]> = [
    ["ALL SYMBOLS (file-referenced map)", "SELECT s.id, s.file_id AS fileId FROM brain_symbol s WHERE s.project_id = ?", [pid]],
    ["SIX REPORTED TYPES", `SELECT s.id, s.name, s.symbol_type, f.relative_path, f.language, f.line_count FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.symbol_type IN ('function','method','class','interface','struct','enum')`, [pid]],
    ["USAGE ROWS (evidence gate input)", `SELECT r.relationship_type, r.target_symbol_id, r.target_external, r.source_symbol_id, r.confidence, json_extract(r.metadata,'$.evidenceClass'), t.name FROM brain_relationship r LEFT JOIN brain_symbol t ON t.id=r.target_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph})`, [pid, ...USAGE]],
    ["DUPLICATE NAMES (ambiguity)", `SELECT s.name, COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.symbol_type IN ('function','method','class','interface','struct','enum') GROUP BY s.name HAVING COUNT(*)>1`, [pid]],
    ["FILE INCOMING USAGE (coverage-gap indicator)", `SELECT t.file_id, COALESCE(r.source_symbol_id,'?') src, COUNT(*) n FROM brain_relationship r JOIN brain_symbol t ON t.id=r.target_symbol_id WHERE r.project_id=? AND r.relationship_type IN (${ph}) AND (r.source_symbol_id IS NULL OR r.source_symbol_id<>r.target_symbol_id) GROUP BY t.file_id, COALESCE(r.source_symbol_id,'?')`, [pid, ...USAGE]],
    ["SYMBOLS WITH ANY INCOMING", `SELECT DISTINCT target_symbol_id id FROM brain_relationship WHERE project_id=? AND target_symbol_id IS NOT NULL AND source_symbol_id<>target_symbol_id AND relationship_type IN (${ph})`, [pid, ...USAGE]],
    ["IMPORT ROWS (resolution)", "SELECT r.target_external ext, r.source_symbol_id src, s.file_id srcFile FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id=r.source_symbol_id WHERE r.project_id=? AND r.relationship_type='imports'", [pid]],
  ]

  let sqlTotal = 0
  for (const [label, sql, params] of PHASES) sqlTotal += time(label, () => db.prepare(sql).all(...(params as any[])).length)

  const t0 = process.hrtime.bigint()
  const report = await detectOrphans(pid, { minConfidence: 0, maxResults: 1_000_000 })
  const orphanMs = Number(process.hrtime.bigint() - t0) / 1e6

  const t1 = process.hrtime.bigint()
  const rules = await detectIndexRules(pid, { confidenceThreshold: 0, maxResults: 1_000_000, includeFramework: true, includeAntiPatterns: true })
  const rulesMs = Number(process.hrtime.bigint() - t1) / 1e6

  console.log(`   ${orphanMs.toFixed(0).padStart(7)}ms  cands=${String(report.findings.length).padStart(7)}  detectOrphans TOTAL`)
  console.log(`   ${rulesMs.toFixed(0).padStart(7)}ms  rules=${String(rules.length).padStart(7)}  detectIndexRules TOTAL`)
  console.log(`   ${sqlTotal.toFixed(0).padStart(7)}ms             the statements above, summed`)
  const unexplained = orphanMs - sqlTotal
  console.log(`   ${unexplained.toFixed(0).padStart(7)}ms  = JS work: finding construction, the per-file import resolution, and the sort.`)
  if (unexplained > sqlTotal) {
    console.log("        -> the cost is in JS, not SQL. The per-file import resolution walks")
    console.log("           RESOLVABLE_SUFFIXES x INDEX_STEMS for every unattributable row.")
  }
  db.close()
}
