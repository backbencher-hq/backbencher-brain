// script/m50/probe-pattern-phases.ts — M50.A2 residual (bb_patterns scope=all ~1.6s)
//
// Where do the ~1.6s actually go? Times the two sub-engines (detectOrphans,
// detectIndexRules) and, inside the rules engine, each individual SQL phase on
// the real index. Numbers only — no verdicts from prose.
//
// Writes validation/m50/results/A2-pattern-phases.json.

import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { detectOrphans } from "../../src/intelligence/patterns/orphans"
import { detectIndexRules } from "../../src/intelligence/patterns/rules"
import { PatternBrainTools } from "../../src/ast/tools"

const ROOT = "$HOME/mcp/backbencher-brain"
const pid = getProjectId(ROOT) as any

const COMPLEXITY_THRESHOLD = 15
const GOD_CLASS_MEMBER_THRESHOLD = 10

async function main() {
  const raw = await BrainDatabase.getRawInstance(pid)
  const phases: Record<string, number> = {}

  // ── sub-engine: orphans ────────────────────────────────────────────────
  let t = Date.now()
  const orphans = await detectOrphans(pid, { minConfidence: 0, maxResults: Number.MAX_SAFE_INTEGER })
  phases.detectOrphansMs = Date.now() - t
  phases.orphanFindings = orphans.findings.length

  // ── sub-engine: index rules (whole) ────────────────────────────────────
  t = Date.now()
  const rules = await detectIndexRules(pid, { confidenceThreshold: 0, maxResults: 500, includeFramework: true, includeAntiPatterns: true })
  phases.detectIndexRulesTotalMs = Date.now() - t
  phases.ruleFindings = rules.length

  // ── individual SQL phases inside detectIndexRules ──────────────────────
  t = Date.now()
  const complex = raw.prepare(
    "SELECT s.name, s.complexity, f.relative_path AS file, COALESCE(s.line_start, 0) AS line " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND s.complexity IS NOT NULL AND s.complexity >= ? " +
      "ORDER BY s.complexity DESC",
  ).all(pid, COMPLEXITY_THRESHOLD) as any[]
  phases.complexQueryMs = Date.now() - t
  phases.complexRows = complex.length

  t = Date.now()
  const paramRows = raw.prepare(
    "SELECT s.name, s.parameters, f.relative_path AS file, COALESCE(s.line_start, 0) AS line " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND s.parameters IS NOT NULL AND s.parameters != '[]' " +
      "ORDER BY s.id",
  ).all(pid) as Array<{ parameters: string }>
  phases.paramQueryMs = Date.now() - t
  phases.paramRows = paramRows.length
  t = Date.now()
  let overThreshold = 0
  for (const row of paramRows) {
    try {
      const p = JSON.parse(row.parameters)
      if (p.length > 7) overThreshold++
    } catch { /* match engine: skip */ }
  }
  phases.paramParseMs = Date.now() - t
  phases.paramOverThreshold = overThreshold

  t = Date.now()
  const god = raw.prepare(
    "SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start, 0) AS line, COUNT(m.id) AS members " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id AND m.project_id = s.project_id " +
      "WHERE s.project_id = ? AND s.symbol_type IN ('class','interface','struct','trait','enum') " +
      "GROUP BY s.id HAVING COUNT(m.id) > ? ORDER BY members DESC",
  ).all(pid, GOD_CLASS_MEMBER_THRESHOLD) as any[]
  phases.godClassQueryMs = Date.now() - t
  phases.godClassRows = god.length

  // ── sub-phases INSIDE detectOrphans (where its 623ms goes) ─────────────
  const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses"]
  t = Date.now()
  const usageRows = raw.prepare(
    "SELECT target_symbol_id AS id, target_external AS ext FROM brain_relationship " +
      "WHERE project_id = ? AND relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ")",
  ).all(pid, ...USAGE_TYPES) as Array<{ id: string | null; ext: string | null }>
  phases.orphanUsageRowsQueryMs = Date.now() - t
  phases.orphanUsageRows = usageRows.length
  t = Date.now()
  const usedIds = new Set<string>(); const usedNames = new Set<string>()
  for (const row of usageRows) {
    if (row.id) usedIds.add(row.id)
    if (row.ext) { const tail = row.ext.includes(":") ? row.ext.split(":").pop()! : row.ext; usedNames.add(tail) }
  }
  phases.orphanBuildUsedSetsMs = Date.now() - t
  t = Date.now()
  const dupNames = raw.prepare("SELECT name FROM brain_symbol WHERE project_id = ? GROUP BY name HAVING COUNT(*) > 1").all(pid) as any[]
  phases.orphanDuplicateNamesQueryMs = Date.now() - t
  phases.orphanDuplicateNames = dupNames.length
  t = Date.now()
  const orphanSymbols = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, s.visibility, COALESCE(s.line_start,0) AS line, COALESCE(s.line_end,0) AS lineEnd, f.relative_path AS file, f.id AS fileId " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.symbol_type IN ('function','method','class','interface','struct','enum')",
  ).all(pid) as Array<{ id: string; fileId: string; symbolType: string }>
  phases.orphanSymbolsQueryMs = Date.now() - t
  phases.orphanSymbols = orphanSymbols.length
  t = Date.now()
  const symbolFileById = new Map(orphanSymbols.map((s) => [s.id, s.fileId]))
  phases.orphanSymbolFileMapMs = Date.now() - t
  t = Date.now()
  const crossRows = raw.prepare(
    "SELECT r.source_symbol_id AS src, r.target_symbol_id AS tgt FROM brain_relationship r " +
      "WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL AND r.source_symbol_id IS NOT NULL " +
      "AND r.relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ")",
  ).all(pid, ...USAGE_TYPES) as Array<{ src: string; tgt: string }>
  phases.orphanCrossFileQueryMs = Date.now() - t
  phases.orphanCrossFileRows = crossRows.length
  t = Date.now()
  const referencedFiles = new Set<string>()
  for (const row of crossRows) {
    const s = symbolFileById.get(row.src); const g = symbolFileById.get(row.tgt)
    if (g && s && s !== g) referencedFiles.add(g)
  }
  phases.orphanCrossRefLoopMs = Date.now() - t
  t = Date.now()
  const importTargets = raw.prepare("SELECT target_external AS ext FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports'").all(pid) as Array<{ ext: string | null }>
  phases.orphanImportsQueryMs = Date.now() - t
  phases.orphanImportRows = importTargets.length

  // ── end-to-end ─────────────────────────────────────────────────────────
  t = Date.now()
  const all = await PatternBrainTools.detectPatterns(pid, {
    includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0.6, maxResults: 100,
  })
  phases.detectPatternsTotalMs = Date.now() - t
  const digest = all.patterns.map((p) => `${p.type}|${p.location.file}:${p.location.line}|${p.location.symbol ?? ""}|${p.confidence}`).sort().join("\n")

  const out = {
    probe: "M50.A2-pattern-phases",
    at: new Date().toISOString(),
    projectId: pid,
    phases,
    digest,
  }
  const fs = await import("node:fs")
  fs.mkdirSync("$HOME/mcp/backbencher-brain/validation/m50/results", { recursive: true })
  const file = "$HOME/mcp/backbencher-brain/validation/m50/results/A2-pattern-phases.json"
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null
  const digestMatch = prev?.digest ? prev.digest === out.digest : null
  fs.writeFileSync(file, JSON.stringify({ ...out, prevDigestMatch: digestMatch }, null, 2) + "\n")
  console.log(JSON.stringify({ phases, totalFindings: all.patterns.length, prevDigestMatch: digestMatch }, null, 2))
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
