// script/profile/i13-anatomy.mts — why is the name-resolution pass 16.5 minutes?
//
//   npx tsx script/profile/i13-anatomy.mts
//
// READ-ONLY. Opens a COPY of the real index and measures the SHAPE of the work
// the `_i13_pick` statement does, without running it.
//
// The statement (src/ast/parallel-indexer.ts:4193) joins every bare-name edge to
// every symbol sharing that name and then ROW_NUMBER()s the result, so its cost
// is the size of that intermediate:
//
//     candidates = SUM over bare-name edges of |symbols with that name|
//
// which is a PRODUCT of two quantities that both grow with the project. This
// script measures both factors and the concentration, so the recommendation can
// be sized against the real distribution instead of a guess.

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { ROOT, stageCorpus } from "./lib.ts"

const PID = "818db37d8f54173ad1357ab24627373da2e9418c"

function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "bb-i13-"))
  stageCorpus(PID, dir)
  const db = new DatabaseSync(path.join(dir, "projects", PID, "brain.db"), { readOnly: true })
  const one = (sql: string, ...p: unknown[]) => Number((db.prepare(sql).get(...(p as never[])) as any)?.c ?? 0)
  const all = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[])) as any[]

  // The exact predicate the product uses to select the i13 population.
  const POP = `r.project_id = ? AND r.target_external IS NOT NULL
      AND r.relationship_type <> 'contains'
      AND instr(r.target_external, '.') = 0 AND instr(r.target_external, ':') = 0`

  const symbols = one("SELECT COUNT(*) c FROM brain_symbol")
  const edges = one("SELECT COUNT(*) c FROM brain_relationship")
  const bareEdges = one(`SELECT COUNT(*) c FROM brain_relationship r WHERE ${POP}`, PID)

  // The intermediate, exactly as the join produces it.
  const tCand = Date.now()
  const candidates = one(
    `SELECT COUNT(*) c FROM brain_relationship r
       JOIN brain_symbol s ON s.project_id = ? AND s.name = r.target_external
      WHERE ${POP}`, PID, PID)
  const candMs = Date.now() - tCand

  const out: any = {
    factors: { symbols, relationships: edges, bareNameEdges: bareEdges },
    candidates, candidatesMs: candMs,
    candidatesPerEdge: Math.round((candidates / Math.max(1, bareEdges)) * 100) / 100,
    candidatesPerSymbol: Math.round((candidates / Math.max(1, symbols)) * 100) / 100,
  }
  console.log(`symbols ${symbols.toLocaleString()} | relationships ${edges.toLocaleString()} | bare-name edges ${bareEdges.toLocaleString()}`)
  console.log(`intermediate: ${candidates.toLocaleString()} candidate rows (${out.candidatesPerEdge}/edge, ${out.candidatesPerSymbol}/symbol) counted in ${candMs}ms`)

  // Concentration. An earlier revision computed this as
  //   SELECT ... FROM <52.8M-row intermediate> GROUP BY name
  // which itself needs the whole intermediate and took >40 minutes — so the
  // measurement of the cost became as expensive as the cost. Split it instead:
  // symbol counts per name come from brain_symbol alone (453k rows), and each
  // top name's edge count is a single indexed probe on target_external.
  const tConc = Date.now()
  const nameSyms = all(`SELECT name, COUNT(*) c FROM brain_symbol GROUP BY name ORDER BY c DESC LIMIT 20`)
  const top = nameSyms.map((r: any) => {
    const edges = one(
      `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_external = ?
         AND relationship_type <> 'contains' AND instr(target_external,'.') = 0 AND instr(target_external,':') = 0`,
      PID, r.name,
    )
    return { name: r.name, syms: Number(r.c), edges, product: Number(r.c) * edges }
  })
  out.concentration = { top, queryMs: Date.now() - tConc }

  const topProduct = top.reduce((a: number, r: any) => a + r.product, 0)
  out.distribution = {
    top20NamesProduct: topProduct,
    top20ShareOfIntermediate: Math.round((topProduct / Math.max(1, candidates)) * 1000) / 10,
    note: "top 20 names BY SYMBOL COUNT; product = syms x edges = their share of the intermediate",
  }

  // What a same-file-first restriction would cost: how many edges have a
  // candidate IN THEIR OWN FILE, which is the population the ranking prefers
  // first and could therefore be resolved without touching the global
  // name space at all.
  const tSame = Date.now()
  const sameFile = one(`
    SELECT COUNT(*) c FROM (
      SELECT DISTINCT r.id
      FROM brain_relationship r
      JOIN brain_symbol src ON src.id = r.source_symbol_id
      JOIN brain_symbol s ON s.project_id = ? AND s.name = r.target_external AND s.file_id = src.file_id
      WHERE ${POP})`, PID, PID)
  const sameMs = Date.now() - tSame
  out.sameFileFirst = {
    edgesWithSameFileCandidate: sameFile,
    shareOfBareEdges: Math.round((sameFile / Math.max(1, bareEdges)) * 1000) / 10,
    queryMs: sameMs,
  }

  console.log(`\nconcentration (${out.distribution.top20ShareOfIntermediate}% of the intermediate comes from the top 20 names):`)
  for (const r of top) {
    console.log(`  ${String(r.name).slice(0, 22).padEnd(24)} syms=${String(r.syms).padStart(6)} edges=${String(r.edges).padStart(6)} product=${Number(r.product).toLocaleString().padStart(12)}`)
  }
  console.log(`\nsame-file-first: ${sameFile.toLocaleString()} of ${bareEdges.toLocaleString()} bare-name edges (${out.sameFileFirst.shareOfBareEdges}%) have a candidate symbol in the edge's OWN file (${sameMs}ms to count)`)

  writeFileSync(path.join(ROOT, "script/profile/results/i13-anatomy.json"), JSON.stringify(out, null, 2))
  console.log(`\nwrote ${path.join(ROOT, "script/profile/results/i13-anatomy.json")}`)
  db.close()
}

main()