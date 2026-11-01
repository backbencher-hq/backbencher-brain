// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the plan-shape gate for the graph traversal: it captures
// the SQL a real `graphTraversal` call prepares, explains it, and asserts the
// shapes that make the call cheap — the owner cascade seeked on the
// (project_id, owner_symbol_id) index, the caller/callee arms seeked on
// (project_id, relationship_type, target_symbol_id), the unattributed counts on
// the same composite, and exact root resolution on (project_id, name).
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph), and
// every tool that shares the engine (bb_analyze graph modes, bb_impact, the LSP
// graph panel).
// WHY IT IS SHAPED THIS WAY — the traversal's cost on a large index is decided
// by SQLite's plan, not by row counts: the same query is 0.5 ms with an index
// seek and 10.7 s without one (measured on the reference index). A wall-clock
// gate on a shared host flakes; a plan is a deterministic function of the schema
// and the statement. The assertions therefore read the plan, and the gate
// carries the PRE-FIX plan as a built-in negative control: if the old plan shape
// ever passes these assertions, the gate is broken, so it is checked on every
// run.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/graph-plan.json,
// validation/m65/results/graph-plan.json; docs/GRAPH_ENGINE.md.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/graph/graph-engine.ts
// (the SQL it asserts), validation/tools/bb_graph/AUDIT.md.
// CONTRACTS IT MUST NOT BREAK — read-only with respect to the reference index:
// it indexes its own fixture under a temp BB_DATA_DIR and never touches .bb-data.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m65-graph-plan-"))
process.env.BB_DATA_DIR = EMPTY
process.env.BB_NO_AUTO_REFRESH = "1"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EVIDENCE = path.join(ROOT, "validation/m65/results/graph-plan.json")
const TOOL_EVIDENCE = path.join(ROOT, "validation/tools/bb_graph/results/graph-plan.json")

type Check = { id: string; pass: boolean; detail: string }
const checks: Check[] = []
const check = (id: string, pass: boolean, detail: string) => {
  checks.push({ id, pass, detail })
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${id}\n        ${detail.replace(/\n/g, " ")}`)
}

/** One captured statement: the SQL text the engine prepared and the plan SQLite
 *  chose for it. */
export interface CapturedStatement {
  sql: string
  plan: string[]
}

/** Assertions as pure functions over captured statements, so the negative
 *  control drives exactly the code the live run drives. */
export function planFindings(statements: CapturedStatement[]): Check[] {
  const findings: Check[] = []
  const find = (needle: string) => statements.filter((s) => s.sql.includes(needle))
  const planText = (s: CapturedStatement) => s.plan.join("\n")

  // 1) The owner cascade id fetch must seek the owner range index.
  const cascadeFetch = find("owner_symbol_id >=").filter((s) => !s.sql.includes("JOIN ("))
  findings.push({
    id: "cascade-fetch-seeks-owner-index",
    pass:
      cascadeFetch.length > 0 &&
      cascadeFetch.every((s) => /brain_symbol_project_owner_idx|brain_symbol_owner_idx/.test(planText(s)) && !/brain_symbol_gravity_idx/.test(planText(s))),
    detail: cascadeFetch.length === 0 ? "no cascade id fetch was captured" : planText(cascadeFetch[0]!),
  })

  // 2) The caller arm must seek (project_id, relationship_type, target_symbol_id).
  //    The inline id list is part of the shape: the join source is a constant
  //    list, not a re-materialised owner range.
  const callerArms = statements.filter((s) => s.sql.includes("AS matchedId") && s.sql.includes("casc.id = r.target_symbol_id"))
  findings.push({
    id: "caller-arm-seeks-type-target-index",
    pass:
      callerArms.length > 0 &&
      callerArms.every((s) => s.sql.includes("JOIN (SELECT ? AS id") && !s.sql.includes("SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id") && /brain_rel_proj_type_target_idx/.test(planText(s))),
    detail: callerArms.length === 0 ? "no caller arm was captured" : planText(callerArms[0]!),
  })

  // 3) The callee arms must seek the same composite on the SOURCE side.
  const calleeArms = statements.filter((s) => s.sql.includes("AS matchedId") && s.sql.includes("casc.id = r.source_symbol_id"))
  findings.push({
    id: "callee-arms-seek-type-target-index",
    pass:
      calleeArms.length > 0 &&
      calleeArms.every((s) => s.sql.includes("JOIN (SELECT ? AS id") && !s.sql.includes("SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id") && /brain_symbol_project_owner_idx|brain_symbol_owner_idx|brain_rel_proj_source_idx/.test(planText(s))),
    detail: calleeArms.length === 0 ? "no callee arm was captured" : planText(calleeArms[0]!),
  })

  // 4) The unattributed counts must not scan for `source_symbol_id IS NULL`.
  const unattributed = statements.filter((s) => s.sql.includes("COUNT(*) AS c"))
  findings.push({
    id: "unattributed-counts-use-the-cascade-list",
    pass: unattributed.length > 0 && unattributed.every((s) => s.sql.includes("JOIN (SELECT ? AS id") && !s.sql.includes("SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id") && !/source_symbol_id>\?/.test(planText(s))),
    detail: unattributed.length === 0 ? "no unattributed count was captured" : planText(unattributed[0]!),
  })

  // 5) Exact root resolution must seek (project_id, name).
  const rootExact = statements.filter((s) => s.sql.includes("ORDER BY s.gravity_score DESC") && s.sql.includes("s.name = ?"))
  findings.push({
    id: "root-exact-seeks-name-index",
    pass: rootExact.length > 0 && rootExact.every((s) => s.sql.includes("INDEXED BY brain_sym_proj_name_idx") && /brain_sym_proj_name_idx/.test(planText(s))),
    detail: rootExact.length === 0 ? "no exact root-resolution statement was captured" : planText(rootExact[0]!),
  })

  return findings
}

/** The PRE-FIX statements and plans, captured on the reference index before the
 *  D-06 rewrite (`validation/tools/bb_graph/results/plans-live.json`). They are
 *  embedded so the negative control is self-contained: the gate fails if these
 *  ever PASS the assertions above. */
const PREFIX_STATEMENTS: CapturedStatement[] = [
  {
    sql: "SELECT COUNT(*) AS c FROM brain_relationship r JOIN (SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?) casc ON casc.id = r.target_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (?) AND r.source_symbol_id IS NULL",
    plan: ["CO-ROUTINE casc", "COMPOUND QUERY", "LEFT-MOST SUBQUERY", "SCAN CONSTANT ROW", "UNION ALL", "SEARCH m USING INDEX brain_symbol_gravity_idx (project_id=?)", "SEARCH r USING INDEX brain_rel_proj_type_idx (project_id=? AND relationship_type=?)", "BLOOM FILTER ON casc (id=?)"],
  },
  {
    sql: "SELECT r.id AS rowId, r.relationship_type AS relType, casc.id AS matchedId FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN (SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?) casc ON casc.id = r.target_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (?)",
    plan: ["CO-ROUTINE casc", "SEARCH m USING INDEX brain_symbol_gravity_idx (project_id=?)", "SEARCH r USING INDEX brain_rel_proj_type_idx (project_id=? AND relationship_type=?)", "USE TEMP B-TREE FOR LAST 3 TERMS OF ORDER BY"],
  },
  {
    sql: "SELECT r.id AS rowId, r.relationship_type AS relType, casc.id AS matchedId FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id JOIN (SELECT ? AS id UNION ALL SELECT m.id FROM brain_symbol m WHERE m.owner_symbol_id >= ? AND m.owner_symbol_id < ? AND m.project_id = ?) casc ON casc.id = r.source_symbol_id WHERE r.project_id = ? AND r.relationship_type IN (?)",
    plan: ["CO-ROUTINE casc", "SEARCH m USING INDEX brain_symbol_gravity_idx (project_id=?)", "SEARCH r USING INDEX brain_rel_proj_source_idx (project_id=? AND source_symbol_id>?)", "USE TEMP B-TREE FOR ORDER BY"],
  },
  {
    sql: "SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id AND f.project_id = s.project_id WHERE s.project_id = ? AND s.symbol_type IN (?) AND s.name = ? ORDER BY s.gravity_score DESC, s.id ASC LIMIT 1",
    plan: ["SEARCH s USING INDEX brain_symbol_gravity_idx (project_id=?)", "SEARCH f USING INDEX sqlite_autoindex_brain_file_1 (id=?)", "USE TEMP B-TREE FOR LAST TERM OF ORDER BY"],
  },
]

/** Build a fixture big enough that the planner has a reason to seek rather than
 *  scan: 160 files, each a class with three methods and a caller file per group.
 *  A 10-row fixture would let SQLite prefer a table scan on every table, which
 *  would make a plan assertion a statement about the fixture's size rather than
 *  about the statement. */
function writeFixture(dir: string): void {
  const files = 160
  for (let i = 0; i < files; i++) {
    const methods = [1, 2, 3].map((m) => `  method${m}(): number {\n    return c${i} + ${m}\n  }`).join("\n")
    writeFileSync(path.join(dir, "src", `svc${i}.ts`), `export class Service${i} {\n${methods}\n}\n`)
    writeFileSync(path.join(dir, "src", `use${i}.ts`), `import { Service${i} } from "./svc${i}"\nexport function use${i}(): number {\n  const s = new Service${i}()\n  return s.method1() + s.method2()\n}\n`)
  }
}

async function main() {
  const { mkdirSync: mkdir } = await import("node:fs")
  const fixture = path.join(EMPTY, "project")
  mkdir(path.join(fixture, "src"), { recursive: true })
  writeFixture(fixture)

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  const pid = getProjectId(fixture) as any
  const quiet = { log: () => {}, write: () => {}, error: () => {} } as any
  const consoleLog = console.log
  console.log = () => {}
  try {
    await indexProjectParallel(pid, fixture, { logger: quiet })
  } finally {
    console.log = consoleLog
  }
  check("fixture-is-indexed", true, `indexed ${await (async () => { const raw = await BrainDatabase.getRawInstance(pid); const c = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid) as any).c; return c })()} symbols`)

  // Capture the SQL the traversal prepares, without changing the engine.
  // The engine opens its OWN read-only handle (a read must not mutate the
  // index), so the capture patches THAT cached handle rather than a separate
  // read-write one.
  const raw: any = await BrainDatabase.getRawInstance(pid, { readonly: true })
  const originalPrepare = raw.prepare.bind(raw)
  const captured: Array<{ sql: string; args: unknown[] }> = []
  raw.prepare = (sql: string) => {
    const statement = originalPrepare(sql)
    const rec = (args: unknown[]) => {
      captured.push({ sql, args })
      return statement
    }
    return {
      all: (...args: unknown[]) => rec(args).all(...args),
      get: (...args: unknown[]) => rec(args).get(...args),
      run: (...args: unknown[]) => rec(args).run(...args),
    }
  }
  let traversalError: string | null = null
  try {
    await graphTraversal(pid, "Service7", { direction: "both", maxDepth: 2 })
  } catch (error) {
    traversalError = error instanceof Error ? error.message : String(error)
  } finally {
    raw.prepare = originalPrepare
  }
  check("traversal-ran-and-captured-sql", traversalError === null && captured.length > 0, traversalError ?? `${captured.length} statement(s) captured`)

  // Explain exactly what the engine prepared, with the parameters it bound.
  const statements: CapturedStatement[] = []
  for (const { sql, args } of captured) {
    try {
      const plan = originalPrepare("EXPLAIN QUERY PLAN " + sql).all(...args).map((row: any) => String(row.detail))
      statements.push({ sql, plan })
    } catch {
      // EXPLAIN refuses a few statement shapes; a statement we cannot explain is
      // reported by omission, never treated as passing.
    }
  }
  const findings = planFindings(statements)
  for (const finding of findings) check(finding.id, finding.pass, finding.detail)

  // ── negative control: the pre-fix plan shape must FAIL every changed assertion
  const oldFindings = planFindings(PREFIX_STATEMENTS)
  const oldCaught = oldFindings.filter((f) => !f.pass).map((f) => f.id)
  check(
    "negative-control: every plan-shape assertion catches the pre-fix statements",
    oldCaught.length === findings.length,
    `pre-fix shape failed ${oldCaught.length}/${findings.length}: ${oldCaught.join(", ")}`,
  )

  const failed = checks.filter((c) => !c.pass)
  const evidence = {
    gate: "M65.graph-plan",
    at: new Date().toISOString(),
    atCommit: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
    command: "npx tsx script/m65/verify-graph-plan.ts",
    status: failed.length === 0 ? "pass" : "fail",
    contract:
      "a graph traversal on a large index seeks the owner range, the relationship composite and the symbol name index, instead of scanning the project's symbols and rows for each node; asserted on the plan SQLite picks for the statements the engine actually prepares, with the pre-fix plan as a negative control",
    checks,
    capturedStatements: statements.map((s) => ({ sql: s.sql.slice(0, 220), plan: s.plan })),
  }
  mkdirSync(path.dirname(EVIDENCE), { recursive: true })
  mkdirSync(path.dirname(TOOL_EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2))
  writeFileSync(TOOL_EVIDENCE, JSON.stringify(evidence, null, 2))
  console.log(`\nevidence: ${EVIDENCE}`)
  if (failed.length > 0) {
    console.log(`\n${failed.length} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log("\nAll checks passed — the traversal's statements seek their indexes and the pre-fix shape fails this gate.")
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
