// script/m50/probe-complexity-phases.ts — M50.A2 residual (bb_analyze complexity 2.25s)
//
// Phase attribution on the real index, then a PARITY proof for the bounded
// rewrite: the pre-fix algorithm (fetch every joined symbol row, build an
// object per symbol, sort in JS) vs the post-fix one (aggregate in SQL, fetch
// only the top-N rows). Both are executed here on the same DB so the numbers
// and the outputs can be compared directly — a "faster" that changes an answer
// is not a fix.
//
// Writes validation/m50/results/A2-complexity-parity.json.

import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { analyzeComplexity } from "../../src/intelligence/analysis/complexity"

const ROOT = "$HOME/mcp/backbencher-brain"
const pid = getProjectId(ROOT) as any

type Row = {
  id: string
  name: string
  symbolType: string
  complexity: number
  line: number
  lineEnd: number
  file: string
  fileId: string
}

const BASE =
  "SELECT s.id, s.name, s.symbol_type AS symbolType, COALESCE(s.complexity,0) AS complexity, " +
  "COALESCE(s.line_start,0) AS line, COALESCE(s.line_end,0) AS lineEnd, " +
  "f.relative_path AS file, f.id AS fileId " +
  "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ?"

async function main() {
  const raw = await BrainDatabase.getRawInstance(pid)
  const phases: Record<string, number> = {}

  // ── OLD path, phase by phase ─────────────────────────────────────────────
  let t = Date.now()
  const symbols = raw.prepare(BASE).all(pid) as Row[]
  phases.oldFetchAllRowsMs = Date.now() - t
  phases.symbolRows = symbols.length

  t = Date.now()
  let totalCyclomatic = 0
  const breakdown: Array<{ name: string; type: string; complexity: number; file: string; line: number }> = []
  for (const sym of symbols) {
    totalCyclomatic += sym.complexity
    breakdown.push({ name: sym.name, type: sym.symbolType, complexity: sym.complexity, file: sym.file, line: sym.line })
  }
  phases.oldBuildAndAccumulateMs = Date.now() - t

  t = Date.now()
  breakdown.sort((a, b) => b.complexity - a.complexity)
  phases.oldSortMs = Date.now() - t

  const oldSymbolCount = symbols.length
  const oldAvg = oldSymbolCount > 0 ? Math.round((totalCyclomatic / oldSymbolCount) * 100) / 100 : null
  const oldTop = breakdown.slice(0, 20)
  t = Date.now()
  const oldLoc = Number((raw.prepare("SELECT COALESCE(SUM(line_count),0) AS lc FROM brain_file WHERE project_id = ?").get(pid) as any).lc)
  const oldCoupling = Number((raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ?").get(pid) as any).c)
  phases.oldAggregatesMs = Date.now() - t

  // ── NEW path: the shipped function, twice (warm second call) ─────────────
  const newTimes: number[] = []
  let report: any = null
  for (let i = 0; i < 2; i++) {
    const s = Date.now()
    report = await analyzeComplexity(pid, { scope: "project" })
    newTimes.push(Date.now() - s)
  }

  // ── SQL-side aggregates, measured alone (what the rewrite relies on) ────
  t = Date.now()
  const agg = raw.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(complexity,0)),0) AS total FROM brain_symbol WHERE project_id = ?",
  ).get(pid) as any
  phases.aggregateQueryMs = Date.now() - t
  t = Date.now()
  const topRows = raw.prepare(
    "SELECT s.name AS name, s.symbol_type AS type, COALESCE(s.complexity,0) AS complexity, f.relative_path AS file, COALESCE(s.line_start,0) AS line " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? " +
      "ORDER BY COALESCE(s.complexity,0) DESC, s.name ASC, s.id ASC LIMIT 20",
  ).all(pid) as any[]
  phases.topNRowsMs = Date.now() - t
  phases.topNRows = topRows.length

  const newAvg = report?.metrics?.cyclomaticAvg?.value ?? null
  const top20SetEqual =
    JSON.stringify(oldTop.map((r) => `${r.name}|${r.file}|${r.complexity}`).sort()) ===
    JSON.stringify((report?.breakdown ?? []).map((r: any) => `${r.name}|${r.file}|${r.complexity}`).sort())

  const out = {
    probe: "M50.A2-complexity-phases",
    at: new Date().toISOString(),
    projectId: pid,
    dbPath: BrainDatabase.getDbPath(pid),
    phases,
    old: { symbolCount: oldSymbolCount, cyclomaticAvg: oldAvg, linesOfCode: oldLoc, couplingEdges: oldCoupling, top20: oldTop.slice(0, 3) },
    new: {
      perCallMs: newTimes,
      symbolCount: report?.symbolCount,
      cyclomaticAvg: newAvg,
      linesOfCode: report?.metrics?.linesOfCode?.value,
      couplingEdges: report?.metrics?.couplingEdges?.value,
      maintainability: report?.metrics?.maintainability?.value,
      top20: (report?.breakdown ?? []).slice(0, 3),
    },
    parity: {
      symbolCount: report?.symbolCount === oldSymbolCount,
      cyclomaticAvg: newAvg === oldAvg,
      linesOfCode: (report?.metrics?.linesOfCode?.value ?? null) === oldLoc,
      couplingEdges: (report?.metrics?.couplingEdges?.value ?? null) === oldCoupling,
      top20SetEqual,
      rankedSubsetOfOldTop: (report?.breakdown ?? []).every((r: any) => oldTop.some((o) => o.name === r.name && o.file === r.file && o.complexity === r.complexity)),
    },
  }
  const { writeFileSync, mkdirSync } = await import("node:fs")
  const path = await import("node:path")
  const dir = path.resolve("validation/m50/results")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "A2-complexity-parity.json"), JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
  BrainDatabase.closeAll()
}

main().catch((e) => {
  console.error("FAIL", e?.stack ?? e)
  process.exit(1)
})
