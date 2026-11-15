// #824 probe — verify-first: what does a REAL index actually put on a call
// site, end to end (analyzer → store → graphTraversal)? Read-only with respect
// to the repo; builds its own tmp workspace + data dir and cleans up.
//
// The question the M59.A6 gate must be able to answer: is `callSite.line` the
// line where the call is WRITTEN (derived here from the fixture's own source),
// or is it the caller symbol's declaration line substituted for it?
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

// The fixture is deliberately DISCRIMINATING: the call to `gamma` is written
// two lines below `beta`'s declaration, so a substituted declaration line
// (2) can never be mistaken for the call's line (4).
const CHAIN = [
  "export function gamma(): number { return 1 }", // 1
  "", // 2
  "export function beta(): number {", // 3
  "  const t = 1", // 4
  "  return gamma() + t", // 5
  "}", // 6
  "", // 7
  "export function alpha(): number {", // 8
  "  return beta() + 1", // 9
  "}", // 10
].join("\n")

async function main(): Promise<void> {
  const ws = mkdtempSync(path.join(tmpdir(), "m59-a6-ws-"))
  const dataDir = mkdtempSync(path.join(tmpdir(), "m59-a6-data-"))
  mkdirSync(path.join(ws, "src"), { recursive: true })
  writeFileSync(path.join(ws, "src", "chain.ts"), CHAIN)
  process.env.BB_DATA_DIR = dataDir

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  const projectId = getProjectId(ws)
  await indexProjectParallel(projectId, ws, {})

  // Expected lines, derived from the SOURCE, never from the pipeline.
  const lines = CHAIN.split("\n")
  const expected: Record<string, number> = {}
  lines.forEach((l, i) => {
    const m = l.match(/\b(gamma|beta)\(\)/)
    if (m && /return/.test(l)) expected[m[1]] = i + 1
  })
  console.log("expected (from source):", JSON.stringify(expected))

  for (const [symbol, callee] of [["beta", "gamma"], ["alpha", "beta"]]) {
    const g: any = await graphTraversal(projectId, symbol, { direction: "callees", maxDepth: 3 })
    const edge = (g.callees ?? []).find((e: any) => g.nodes?.[e.to]?.name === callee)
    console.log(
      `${symbol} -> ${callee}: line=${JSON.stringify(edge?.callSite?.line)} file=${JSON.stringify(edge?.callSite?.file)} type=${JSON.stringify(edge?.relationshipType)} expected=${expected[callee]}`,
    )
  }

  // What the raw table holds, for the same rows.
  const { Database } = await import("bun:sqlite")
  const dbPath = path.join(dataDir, "projects", projectId, "brain.db")
  const db = new Database(dbPath, { readonly: true })
  const rows = db
    .query(
      "SELECT relationship_type t, line_number ln, target_external te, metadata md FROM brain_relationship ORDER BY id",
    )
    .all() as any[]
  console.log("stored rows:")
  for (const r of rows) console.log("  ", JSON.stringify(r).slice(0, 190))
  db.close()

  rmSync(ws, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
  void readFileSync
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
