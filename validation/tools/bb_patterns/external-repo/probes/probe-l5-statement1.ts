// Why did statement (1) — the refusal counters plus rejectedFor — come back with
// no rejected symbols?
//
// The fingerprint diff was unambiguous: after the SQL-side rewrite every
// "REFUSED EVIDENCE: N row(s) about this symbol were excluded as unverified"
// disclosure disappeared, on every corpus, while the COVERAGE GAP INDICATOR text
// and its numbers stayed byte-identical. So statement (4) works and statement (1)
// does not, and the difference between them is one GROUP BY.
//
// This runs statement (1) exactly as orphans.ts builds it, then the same query
// with the GROUP BY reduced, and the same query with the parameter list the file
// actually passes, so the fault is named rather than guessed at.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")

const SELF_LOOP_EXCLUDED = "selfLoop"
const INFERRED_EXCLUDED = "inferred"
const LOW_CONFIDENCE_EXCLUDED = "lowConfidence"
const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides"]
const MIN_EDGE_CONFIDENCE = 0.7

const pid = process.argv[2]
const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })

const typeList = USAGE_TYPES.map(() => "?").join(",")
const usageFilter = `r.project_id = ? AND r.relationship_type IN (${typeList})`
const GATE_SQL =
  `(CASE WHEN r.source_symbol_id IS NOT NULL AND r.target_symbol_id IS NOT NULL ` +
  `AND r.source_symbol_id = r.target_symbol_id THEN '${SELF_LOOP_EXCLUDED}' ` +
  `WHEN json_extract(r.metadata, '$.evidenceClass') = 'inferred' THEN '${INFERRED_EXCLUDED}' ` +
  `WHEN r.confidence < ? THEN '${LOW_CONFIDENCE_EXCLUDED}' ELSE NULL END)`

const q = (sql: string) => db.prepare(sql).all(pid, ...USAGE_TYPES, MIN_EDGE_CONFIDENCE, MIN_EDGE_CONFIDENCE) as any[]

console.log(`project ${pid.slice(0, 10)}\n`)

const withNullId = q(
  `SELECT r.relationship_type AS rt, ${GATE_SQL} AS reason, r.target_symbol_id AS id, COUNT(*) AS n ` +
    `FROM brain_relationship r WHERE ${usageFilter} AND ${GATE_SQL} IS NOT NULL ` +
    `GROUP BY r.relationship_type, reason, r.target_symbol_id`,
)
console.log(`A  exactly as orphans.ts builds it`)
console.log(`   rows=${withNullId.length}  withNonNullId=${withNullId.filter((r) => r.id).length}`)
console.log(`   sample: ${JSON.stringify(withNullId.slice(0, 3))}`)

// Is the problem the GROUP BY, the CASE, or the parameter binding?
const noGroup = q(
  `SELECT ${GATE_SQL} AS reason, COUNT(*) AS n FROM brain_relationship r ` +
    `WHERE ${usageFilter} AND ${GATE_SQL} IS NOT NULL GROUP BY reason`,
)
console.log(`\nB  same, but GROUP BY reason only (no id)`)
console.log(`   ${JSON.stringify(noGroup)}`)

const onlyReason = db.prepare(
  `SELECT ${GATE_SQL} AS reason, COUNT(*) AS n FROM brain_relationship r ` +
    `WHERE ${usageFilter} AND ${GATE_SQL} IS NOT NULL GROUP BY reason`,
).all(pid, ...USAGE_TYPES, MIN_EDGE_CONFIDENCE, MIN_EDGE_CONFIDENCE) as any[]
console.log(`\nC  B but with the reason read in the WHERE clause only`)
console.log(`   ${JSON.stringify(onlyReason)}`)

// The decisive one: does the WHERE-clause CASE bind the SAME placeholder index as
// the SELECT-clause CASE? Print what SQLite actually returns for the bare
// expression, with the confidence placeholder supplied twice.
const bare = db.prepare(
  `SELECT ${GATE_SQL} AS reason, COUNT(*) AS n FROM brain_relationship r ` +
    `WHERE ${usageFilter} GROUP BY reason`,
).all(pid, ...USAGE_TYPES, MIN_EDGE_CONFIDENCE) as any[]
console.log(`\nD  the CASE alone, GROUP BY over the whole usage set`)
console.log(`   ${JSON.stringify(bare)}`)

db.close()
