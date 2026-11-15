// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — read-only degree reconnaissance for bb_graph's audits: how
// many stored rows each candidate target has, so a measurement can pick a leaf,
// a mid symbol and a hub deliberately instead of discovering the cost by waiting.
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/recon.json.
// CONTRACTS IT MUST NOT BREAK — read-only: the database is opened `readonly`.
import { writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../src/brain/database"
import { getProjectId } from "../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const pid = getProjectId(ROOT)
const db = BrainDatabase.openByPath(BrainDatabase.getDbPath(pid), { readonly: true }) as any
const q = (sql: string, ...p: any[]) => db.prepare(sql).all(...p)

const out: Record<string, unknown> = { projectId: pid }
out.symbols = (q("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?", pid) as any)[0].c
out.relationships = (q("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?", pid) as any)[0].c
out.incomingTop = q(`SELECT s.name, s.symbol_type, COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id=r.target_symbol_id WHERE r.project_id=? GROUP BY s.id ORDER BY c DESC LIMIT 12`, pid)
out.outgoingTop = q(`SELECT s.name, s.symbol_type, COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id=r.source_symbol_id WHERE r.project_id=? GROUP BY s.id ORDER BY c DESC LIMIT 12`, pid)
const names = ["traverseGraph", "graphTraversal", "classifyTier", "getProjectId", "relationshipFilterReason", "resolveGraphRootDetailed", "matchedMember", "cascadeMatch", "nodeFromEdge", "likeContains", "countUnattributedRows", "edgeMetadata"]
const candidates: any[] = []
for (const n of names) {
  const r = q(`SELECT s.id, s.symbol_type, s.line_start,
    (SELECT COUNT(*) FROM brain_relationship x WHERE x.target_symbol_id=s.id) inc,
    (SELECT COUNT(*) FROM brain_relationship x WHERE x.source_symbol_id=s.id) out
    FROM brain_symbol s WHERE s.project_id=? AND s.name=? ORDER BY s.gravity_score DESC LIMIT 1`, pid, n)[0]
  candidates.push({ name: n, ...(r ? { type: r.symbol_type, line: r.line_start, incoming: r.inc, outgoing: r.out } : {}) })
}
out.candidates = candidates
out.classes = q(`SELECT s.name, COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id=r.target_symbol_id WHERE r.project_id=? AND s.symbol_type IN ('class','interface','struct','trait','enum') GROUP BY s.id ORDER BY c DESC LIMIT 8`, pid)
out.smallClasses = q(`SELECT s.name, COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id=r.target_symbol_id WHERE r.project_id=? AND s.symbol_type IN ('class','interface','struct','trait','enum') GROUP BY s.id HAVING c BETWEEN 3 AND 15 ORDER BY c DESC LIMIT 8`, pid)
out.methodRows = q(`SELECT s.name, s.symbol_type, COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id=r.target_symbol_id WHERE r.project_id=? AND s.symbol_type IN ('method','function') GROUP BY s.id HAVING c BETWEEN 4 AND 30 ORDER BY c DESC LIMIT 8`, pid)
db.close()
writeFileSync(path.join(ROOT, "validation/tools/bb_graph/results/recon.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({ symbols: out.symbols, relationships: out.relationships, candidates: out.candidates, smallClasses: out.smallClasses, methodRows: out.methodRows }, null, 2))
