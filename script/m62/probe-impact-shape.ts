// script/m62/probe-impact-shape.ts — development probe: what depths does the
// engine stamp, and which entries does M63.T2's measurement MOVE? Not a gate.
//
// Run: npx tsx script/m62/probe-impact-shape.ts

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { IMPACT_FILES, IMPACT_ROOT } from "./a2-impact-fixture.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "m62a2-imp-"))
  const ws = mkdtempSync(path.join(tmpdir(), "m62a2-impws-"))
  process.env.BB_DATA_DIR = dataDir
  for (const [rel, body] of Object.entries(IMPACT_FILES)) writeFileSync(path.join(ws, rel), body)
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(ws) as string
  await indexProjectParallel(pid, ws, {})
  const raw = await BrainDatabase.getRawInstance(pid as never)

  const rels = raw
    .prepare(`SELECT r.id, r.relationship_type rt, r.line_number ln, s.name src, t.name tgt
               FROM brain_relationship r
               LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
               LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
               WHERE r.project_id = ? ORDER BY r.line_number`)
    .all(pid) as Array<Record<string, unknown>>
  console.log("stored rows:")
  for (const r of rels) console.log(`  ${String(r.src)} -> ${String(r.tgt)} ${r.rt} line=${r.ln} id=${String(r.id)}`)

  const engine: any = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))
  const trav = await engine.graphTraversal(pid, IMPACT_ROOT, {
    direction: "callers", maxDepth: 5, relationshipTypes: ["calls", "instantiates", "extends", "implements"],
  })
  console.log("\nengine stamps (name -> depth):")
  for (const e of trav.callers ?? []) console.log(`  ${e.from.split(":").pop()} d=${e.depth} row=${e.rowId.slice(0, 12)} callSite=${JSON.stringify(e.callSite)}`)

  const impact: any = await import(path.join(ROOT, "src/lsp/impact.ts"))
  const res = await impact.computeImpact(raw, pid, IMPACT_ROOT)
  console.log(`\ncountVerification=${JSON.stringify(res.countVerification)} truncated=${res.truncated} reason=${res.truncationReason}`)
  console.log("impact entries:")
  for (const d of res.impact) {
    console.log(`  ${d.name} depth=${d.depth} ev@depth=${d.evidenceAtDepth} decl=${d.declarationLine} row=${(d.rowId ?? "-").slice(0, 12)} callSite=${JSON.stringify(d.callSite)}`)
  }
  try { rmSync(ws, { recursive: true, force: true }) } catch {}
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}
void main()