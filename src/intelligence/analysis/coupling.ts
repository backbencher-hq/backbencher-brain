// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — class fan-in/fan-out computation. NOT exposed by any public tool mode; kept because downstream analysis imports it.
// WHICH TOOL IT SERVES — bb_analyze (mutability read, requiresIndex true, modes
//   (no public mode — engine only)).
// WHY IT IS SHAPED THIS WAY — the tool has no coupling mode by decision; a gate that tests only this file would say nothing about the shipped surface.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_analyze.md, docs/BB_ANALYZE.md, validation/tools/bb_analyze/**;
//   gates: npx tsx script/m13/verify-analyze-modes.ts, npx tsx script/verify-analyze.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/handler.ts,
//   script/tool-docs/curation/bb_analyze.ts, and the gates named above.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   the read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type { CouplingEntry } from "../contracts"

// Class coupling: incoming (fan-in) = edges where the class is the target,
// outgoing (fan-out) = edges where the class is the source. The previous
// implementation counted target_symbol_id for BOTH directions (bug); here they
// are computed with two correct grouped aggregates in a single pass each,
// avoiding the old N+1 per-class queries.
export async function getCoupling(
  projectId: ProjectID,
  options: { limit?: number; minScore?: number } = {},
): Promise<CouplingEntry[]> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const limit = options.limit ?? 20
  const minScore = options.minScore ?? 0

  const classes = raw.prepare(
    "SELECT s.id, s.name, f.relative_path AS file " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND s.symbol_type = 'class'",
  ).all(projectId) as Array<{ id: string; name: string; file: string }>

  const incomingRows = raw.prepare(
    "SELECT target_symbol_id AS id, COUNT(*) AS c FROM brain_relationship " +
      "WHERE project_id = ? AND target_symbol_id IS NOT NULL GROUP BY target_symbol_id",
  ).all(projectId) as Array<{ id: string; c: number }>

  const outgoingRows = raw.prepare(
    "SELECT source_symbol_id AS id, COUNT(*) AS c FROM brain_relationship " +
      "WHERE project_id = ? AND source_symbol_id IS NOT NULL GROUP BY source_symbol_id",
  ).all(projectId) as Array<{ id: string; c: number }>

  const incoming = new Map(incomingRows.map((r) => [r.id, Number(r.c)]))
  const outgoing = new Map(outgoingRows.map((r) => [r.id, Number(r.c)]))

  const results: CouplingEntry[] = []
  for (const cls of classes) {
    const inC = incoming.get(cls.id) ?? 0
    const outC = outgoing.get(cls.id) ?? 0
    const score = inC + outC
    if (score >= minScore) {
      results.push({ symbolId: cls.id, name: cls.name, file: cls.file, incoming: inC, outgoing: outC, score })
    }
  }
  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return results.slice(0, limit)
}
