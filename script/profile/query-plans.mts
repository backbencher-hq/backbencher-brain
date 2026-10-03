// script/profile/query-plans.mts — READ-ONLY. What plan does the planner choose
// for the statements the derived pass runs, and what do the indexes cost?
//
//   npx tsx script/profile/query-plans.mts [--db <path>] [--plan <n>]
//
// READ-ONLY BY CONSTRUCTION: the handle is opened with readonly:true and no
// statement here writes. EXPLAIN QUERY PLAN does not execute the query.
//
// WHY IT MATTERS: three of the derived pass's statements are correlated
// subqueries or window functions over brain_symbol / brain_relationship. Whether
// they are index lookups or full scans decides whether the cost is linear or
// quadratic, and that cannot be assumed from the SQL text — a `WHERE
// target_symbol_id = brain_symbol.id` inside a subquery is an indexed lookup
// ONLY if an index on that column exists AND the planner can see it is selective.

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { ROOT, stageCorpus } from "./lib.ts"

const argv = process.argv.slice(2)
const argOf = (k: string, d: string) => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

/**
 * The statements that matter, transcribed from the source with their provenance.
 * Each is run EXPLAIN-only against the real corpus.
 */
const STATEMENTS: Array<{ id: string; where: string; sql: string }> = [
  {
    id: "gravity-1-reset",
    where: "src/ast/parallel-indexer.ts:77 — calculateGravityScores step 1",
    sql: `UPDATE brain_symbol SET gravity_score = (complexity * (CASE WHEN visibility = 'public' THEN 1.5 ELSE 1.0 END)) WHERE 1=1`,
  },
  {
    id: "gravity-2-pagerank",
    where: "src/ast/parallel-indexer.ts:85 — step 2, correlated COUNT + EXISTS",
    sql: `UPDATE brain_symbol SET gravity_score = gravity_score + (SELECT COUNT(*) * 5.0 FROM brain_relationship r WHERE r.target_symbol_id = brain_symbol.id) WHERE EXISTS (SELECT 1 FROM brain_relationship r WHERE r.target_symbol_id = brain_symbol.id)`,
  },
  {
    id: "gravity-3-core",
    where: "src/ast/parallel-indexer.ts:98 — step 3, layer filter",
    sql: `UPDATE brain_symbol SET gravity_score = gravity_score * 2.0 WHERE layer = 'core'`,
  },
  {
    id: "res-i13-pick",
    where: "src/ast/parallel-indexer.ts:4193 — name-resolution window function over the _i13_src temp table",
    sql: `SELECT rel_id, target_symbol_id FROM (SELECT t.rel_id AS rel_id, s.id AS target_symbol_id, ROW_NUMBER() OVER (PARTITION BY t.rel_id ORDER BY COALESCE(s.is_declaration,0) ASC, (s.file_id = t.src_file) DESC, (COALESCE(f.language,'') = t.src_lang) DESC, s.id ASC) AS rn FROM _i13_src t JOIN brain_relationship r ON r.id = t.rel_id JOIN brain_symbol s ON s.project_id = 'X' AND s.name = r.target_external LEFT JOIN brain_file f ON f.id = s.file_id WHERE r.project_id = 'X' AND r.target_external IS NOT NULL AND r.relationship_type <> 'contains' AND instr(r.target_external,'.') = 0 AND instr(r.target_external,':') = 0) WHERE rn = 1`,
  },
  {
    id: "res-i13-crosslang",
    where: "src/ast/parallel-indexer.ts:4248 — cross-language normalisation, 2 correlated EXISTS",
    sql: `UPDATE brain_relationship SET is_cross_language = CASE WHEN EXISTS (SELECT 1 FROM brain_symbol ss LEFT JOIN brain_file sf ON sf.id = ss.file_id JOIN brain_symbol ts ON ts.id = brain_relationship.target_symbol_id LEFT JOIN brain_file tf ON tf.id = ts.file_id WHERE ss.id = brain_relationship.source_symbol_id AND COALESCE(sf.language,'') <> '' AND COALESCE(tf.language,'') <> '' AND lower(sf.language) <> lower(tf.language)) THEN 1 ELSE brain_relationship.is_cross_language END WHERE brain_relationship.project_id = 'X' AND brain_relationship.target_symbol_id IS NOT NULL`,
  },
  {
    id: "res-i13-crossfile",
    where: "src/ast/parallel-indexer.ts:4225 — is_cross_file recompute, implicit self-join",
    sql: `UPDATE brain_relationship SET is_cross_file = CASE WHEN t.file_id <> s.file_id THEN 1 ELSE 0 END FROM brain_symbol t, brain_symbol s WHERE t.id = brain_relationship.target_symbol_id AND s.id = brain_relationship.source_symbol_id AND brain_relationship.project_id = 'X' AND brain_relationship.relationship_type <> 'contains' AND instr(brain_relationship.target_external,'.') = 0 AND instr(brain_relationship.target_external,':') = 0`,
  },
  {
    id: "enrich-page",
    where: "src/brain/brain-relationship-enrichment.ts:607 — one page of 20k rows",
    sql: `SELECT r.id, r.rowid AS rowid, r.relationship_type, r.source_symbol_id, r.target_symbol_id, r.metadata, s.layer, s.symbol_type, s.name, t.id, t.layer, t.symbol_type, t.name, sf.relative_path, sf.language FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id AND t.project_id = r.project_id LEFT JOIN brain_file sf ON sf.id = s.file_id WHERE r.project_id = 'X' AND r.rowid > 0 ORDER BY r.rowid LIMIT 20000`,
  },
  {
    id: "enrich-indegree",
    where: "src/brain/brain-relationship-enrichment.ts:259 — the one O(project) memory term",
    sql: `SELECT target_symbol_id, COUNT(*) as c FROM brain_relationship WHERE project_id = 'X' AND target_symbol_id IS NOT NULL AND target_symbol_id != '' GROUP BY target_symbol_id`,
  },
  {
    id: "enrich-update",
    where: "src/brain/brain-relationship-enrichment.ts:310 — one row",
    sql: `UPDATE brain_relationship SET metadata = ? WHERE id = ? AND project_id = ?`,
  },
  {
    id: "res-unresolved-count",
    where: "src/ast/parallel-indexer.ts:4025 — the phase's entry guard",
    sql: `SELECT count(*) as c FROM brain_relationship WHERE target_symbol_id IS NULL AND target_external IS NOT NULL AND project_id = 'X'`,
  },
  {
    id: "res-strategy1",
    where: "src/ast/parallel-indexer.ts:4060 — UPDATE ... FROM temp lookup",
    sql: `UPDATE brain_relationship SET target_symbol_id = 'X' FROM brain_symbol WHERE brain_relationship.target_external = brain_symbol.qualified_name AND brain_relationship.target_symbol_id IS NULL AND brain_relationship.project_id = 'X'`,
  },
]

function main() {
  let dbPath = argOf("--db", "")
  if (!dbPath) {
    // Default: a throwaway copy, so a stray ANALYZE-free read never touches the
    // user's index and no WAL is left behind by the copy.
    const dir = mkdtempSync(path.join(tmpdir(), "bb-qplan-"))
    stageCorpus("818db37d8f54173ad1357ab24627373da2e9418c", dir)
    dbPath = path.join(dir, "projects", "818db37d8f54173ad1357ab24627373da2e9418c", "brain.db")
  }
  const db = new DatabaseSync(dbPath, { readOnly: true })

  const counts: Record<string, number> = {}
  for (const t of ["brain_file", "brain_symbol", "brain_relationship", "brain_taint_flow", "brain_semantic_embedding"]) {
    counts[t] = Number((db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any)?.c ?? 0)
  }
  const distinctNames = Number((db.prepare("SELECT COUNT(DISTINCT name) c FROM brain_symbol").get() as any)?.c ?? 0)
  const distinctQn = Number((db.prepare("SELECT COUNT(DISTINCT qualified_name) c FROM brain_symbol WHERE qualified_name IS NOT NULL").get() as any)?.c ?? 0)
  const unresolved = Number((db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE target_symbol_id IS NULL AND target_external IS NOT NULL").get() as any)?.c ?? 0)
  const bareNameEdges = Number((db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE target_external IS NOT NULL AND instr(target_external,'.') = 0 AND instr(target_external,':') = 0 AND relationship_type <> 'contains'").get() as any)?.c ?? 0)

  let hasStat1 = true
  let stat1Rows = 0
  try {
    stat1Rows = Number((db.prepare("SELECT COUNT(*) c FROM sqlite_stat1").get() as any)?.c ?? 0)
    db.prepare("SELECT tbl,idx,stat FROM sqlite_stat1 LIMIT 1").get()
  } catch {
    hasStat1 = false
  }
  // The i13 pick statement reads two TEMP tables it builds itself. EXPLAIN on
  // the real statement therefore needs them to exist, so they are created here
  // exactly as parallel-indexer.ts creates them (empty — the plan does not
  // depend on their contents).
  try {
    db.exec(`
      CREATE TEMP TABLE _i13_src AS
        SELECT r.id AS rel_id, src.file_id AS src_file, COALESCE(sf.language,'') AS src_lang
        FROM brain_relationship r
        LEFT JOIN brain_symbol src ON src.id = r.source_symbol_id
        LEFT JOIN brain_file sf ON sf.id = src.file_id WHERE 0;
      CREATE TEMP TABLE _i13_pick (rel_id, target_symbol_id);
    `)
  } catch (e: any) {
    console.log("could not stage the i13 temp tables:", e?.message)
  }

  const results: any[] = []
  for (const st of STATEMENTS) {
    let plan: any[] = []
    let err: string | null = null
    try {
      plan = db.prepare(`EXPLAIN QUERY PLAN ${st.sql}`).all() as any[]
    } catch (e: any) {
      err = String(e?.message ?? e)
    }
    const detail = plan.map((p) => p.detail ?? p).join(" | ")
    results.push({
      ...st,
      error: err,
      plan: plan.map((p) => ({ id: p.id, parent: p.parent, detail: p.detail ?? String(p) })),
      // The planner's own scan labels are the evidence; a query with no
      // "SCAN brain_symbol" and several "SEARCH ... USING INDEX" is indexed.
      scansBrainSymbol: /SCAN brain_symbol/.test(detail),
      scansBrainRelationship: /SCAN brain_relationship/.test(detail),
      usesIndex: /USING (INDEX|COVERING INDEX)/.test(detail),
      usesTempBtree: /USING TEMP B-TREE/.test(detail),
      usesCoroutine: /COROUTINE/.test(detail),
    })
  }

  const out = { dbPath, counts, derived: { distinctNames, distinctQn, unresolved, bareNameEdges }, hasStat1, stat1Rows, statements: results }
  writeFileSync(path.join(ROOT, "script/profile/results/query-plans.json"), JSON.stringify(out, null, 2))

  console.log(`corpus: ${JSON.stringify(counts)}`)
  console.log(`distinct symbol names: ${distinctNames.toLocaleString()} | distinct qualified_name: ${distinctQn.toLocaleString()}`)
  console.log(`unresolved edges: ${unresolved.toLocaleString()} | bare-name edges (i13 population): ${bareNameEdges.toLocaleString()}`)
  console.log(`sqlite_stat1 rows: ${stat1Rows} (present=${hasStat1}) — the planner HAS statistics from a previous ANALYZE\n`)
  for (const r of results) {
    console.log(`\n[${r.id}] ${r.where}`)
    if (r.error) { console.log(`  ERROR ${r.error}`); continue }
    for (const p of r.plan) console.log(`  ${String(p.id).padStart(3)}: ${p.detail}`)
  }
}

main()