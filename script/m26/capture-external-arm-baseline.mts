#!/usr/bin/env tsx
// script/m26/capture-external-arm-baseline.mts — record what the walk returned
// BEFORE the index pin, so the gate has something to compare against that is not
// itself.
//
// WHY THIS FILE EXISTS. verify-external-arm-plan.ts originally compared two arms
// of the SAME code: arm A against a schema that has brain_rel_proj_source_idx,
// arm B against a copy that does not. That proves the pin does not change the
// answer — but it CANNOT prove the answer is the right one. Its mutant M1 dropped
// a conjunct from the external arm's predicate, which changed both arms
// identically, so they still agreed and the gate passed. A-vs-B agreed with
// itself over a wrong answer, which is the oldest failure mode in this program.
//
// So the oracle is a GOLDEN FILE: the edge signatures the walk produced on this
// index, from the code as it stood before the pin. The gate then compares the
// current walk against that, so changing the predicate, the join, or the ORDER BY
// all move the signature and all fail.
//
// Usage:  npx tsx script/m26/capture-external-arm-baseline.mts
// Run it only when the change is intentional, and say so in the commit.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../src/brain/database"
import { traverseGraph } from "../../src/intelligence/graph/graph-engine"

const ROOT = process.cwd()
const PROJECT_ID = process.argv[2] ?? "064be526733c31e95c0ac2beb42d209af9bab8e6"
const PID = PROJECT_ID as never
const OUT = path.join(ROOT, "validation", "m26", "results", "external-arm-baseline.json")

const raw = BrainDatabase.openByPath(BrainDatabase.getPath(PID)) as never as {
  prepare: (s: string) => { all: (...a: unknown[]) => unknown[] }
}
const roots = raw
  .prepare(
    `SELECT s.id, s.name, s.symbol_type, s.line_start, s.line_end, f.relative_path AS rel
     FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
     WHERE f.path LIKE '%/backbencher-brain/%' AND s.symbol_type IN ('function','method','class')
     ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.source_symbol_id = s.id) DESC
     LIMIT 12`,
  )
  .all() as Array<Record<string, unknown>>

const sig = (rows: Array<Record<string, any>>): string =>
  rows
    .map((e) => `${String(e.rowId)}|${String(e.relationshipType ?? "")}|${String(e.from)}|${String(e.to)}`)
    .sort()
    .join("\n")

// THE INDEX'S IDENTITY, recorded with the golden.
//
// The golden's first purpose was to catch a behaviour change. Its second, and the
// one it was silently failing, is distinguishing "the code changed" from "the
// world changed": the owner's 201-file index was re-indexed by something outside
// this session (relationships 58,324 -> 62,043), and the golden then reported 8
// roots of behavioural difference that were really one index rebuild. A golden
// that cannot say which index it came from cannot tell those apart, and the
// honest response to an unexplained failure is to distrust the instrument.
const fingerprint = (): Record<string, number> => {
  const one = (sql: string): number => Number((raw as unknown as { prepare: (s: string) => { get: (q?: unknown[]) => { n: number } } }).prepare(sql).get().n)
  return {
    symbols: one("SELECT COUNT(*) AS n FROM brain_symbol"),
    files: one("SELECT COUNT(*) AS n FROM brain_file"),
    relationships: one("SELECT COUNT(*) AS n FROM brain_relationship"),
    externalRelationships: one("SELECT COUNT(*) AS n FROM brain_relationship WHERE target_symbol_id IS NULL AND target_external IS NOT NULL"),
  }
}
const indexFingerprint = fingerprint()

const baseline: Array<{ root: string; callees: string[]; callers: string[]; nodes: number }> = []
let externalEdges = 0
for (const root of roots) {
  const r = await traverseGraph(
    PID,
    {
      id: root.id as string,
      name: root.name as string,
      symbolType: root.symbol_type as string,
      file: root.rel as string,
      lineStart: root.line_start as number,
      lineEnd: root.line_end as number,
      language: "typescript",
      complexity: 0,
    } as never,
    { timeBudgetMs: 30000 } as never,
  )
  const callees = (r.callees as unknown as Array<Record<string, unknown>>).map((e) => String(e.rowId))
  const callers = (r.callers as unknown as Array<Record<string, unknown>>).map((e) => String(e.rowId))
  externalEdges += (r.callees as unknown as Array<Record<string, any>>).filter((e) =>
    String(e.to ?? "").startsWith("ext:"),
  ).length
  baseline.push({
    root: `${String(root.rel)}:${String(root.line_start)} ${String(root.name)}`,
    callees: callees.sort(),
    callers: callers.sort(),
    nodes: Object.keys(r.nodes).length,
  })
  process.stdout.write(`  captured ${baseline.length} roots, ${externalEdges} external callee edges so far\n`)
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      note: "Edge rowIds per root, captured from the walk BEFORE the UNRESOLVED arm's index pin. The oracle for verify-external-arm-plan.ts: comparing two arms of the same code proves self-consistency, not correctness.",
      projectId: PROJECT_ID,
      indexFingerprint,
      roots: baseline.length,
      externalCalleeEdges: externalEdges,
      entries: baseline,
    },
    null,
    2,
  )}\n`,
)
console.log(`\n  wrote ${OUT}`)
console.log(`  ${baseline.length} roots, ${externalEdges} external callee edges recorded`)