// script/m50/probe-test-gaps-phases.ts — M50.A2 residual (bb_analyze test_gaps ~1.2s)
//
// Attributes the ~1.2s on the REAL index (BB_DATA_DIR must point at the real
// brain DB) to individual phases, replicating testGaps' path exactly:
//   prodRows query -> testEdges query -> counts -> noise filter -> linksByTarget
//   -> entries map+sort -> gap loop+sort -> page slice
// and records the FULL testGaps() report digest so a fix can be proven
// byte-identical against this baseline (prevReportDigestMatch).
//
// Writes validation/m50/results/A2-test-gaps-phases.json.

import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { testGaps, testMapping } from "../../src/intelligence/testing/test-intel"
import { AnalysisExclusions } from "../../src/ast/analysis-exclusions"

const ROOT = process.env.BB_PROBE_ROOT || "$HOME/mcp/backbencher-brain"
const OUT = `${ROOT}/validation/m50/results/A2-test-gaps-phases.json`
const pid = getProjectId(ROOT) as any

const DIRECT_TYPES = ["calls", "instantiates"]
const ALL_CLASSIFIED = ["calls", "instantiates", "references", "uses", "extends", "implements", "imports"]
const PROD_SYMBOL_TYPES = "('function','method','class','interface','struct','enum')"

function classify(relType: string): string | null {
  if (DIRECT_TYPES.includes(relType)) return "direct_call"
  if (["references", "uses", "extends", "implements"].includes(relType)) return "reference"
  if (relType === "imports") return "import"
  return null
}

async function main() {
  const raw = await BrainDatabase.getRawInstance(pid)
  const phases: Record<string, number> = {}
  let t = Date.now()

  // ── phase 1: prod rows ─────────────────────────────────────────────────
  t = Date.now()
  const prodRows = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, f.relative_path AS file, " +
      "COALESCE(s.line_start,0) AS line, COALESCE(s.complexity,0) AS complexity, COALESCE(s.gravity_score,0) AS gravity " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(f.is_test_file,0) = 0 AND s.symbol_type IN " + PROD_SYMBOL_TYPES,
  ).all(pid) as any[]
  phases.prodRowsQueryMs = Date.now() - t
  phases.prodRows = prodRows.length

  // ── phase 2: ALL test-originated edges (what testMapping loads) ────────
  t = Date.now()
  const testEdges = raw.prepare(
    "SELECT r.target_symbol_id AS targetId, r.relationship_type AS relType, " +
      "ts.id AS testSymId, ts.name AS testSymName, tf.relative_path AS testFile " +
      "FROM brain_relationship r " +
      "JOIN brain_symbol ts ON ts.id = r.source_symbol_id " +
      "JOIN brain_file tf ON tf.id = ts.file_id AND COALESCE(tf.is_test_file,0) = 1 " +
      "WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL",
  ).all(pid) as any[]
  phases.testEdgesQueryMs = Date.now() - t
  phases.testEdgesRows = testEdges.length

  // ── phase 3: counts ────────────────────────────────────────────────────
  t = Date.now()
  const testFileCount = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").get(pid) as any).c
  const testSymCount = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND COALESCE(f.is_test_file,0)=1").get(pid) as any).c
  phases.countsMs = Date.now() - t
  phases.testFileCount = testFileCount
  phases.testSymCount = testSymCount

  // ── phase 4: noise filter ──────────────────────────────────────────────
  t = Date.now()
  const filtered = prodRows.filter(
    (r) => !AnalysisExclusions.isHardNoisePath(r.file) && !AnalysisExclusions.isNoiseSymbolName(r.name),
  )
  phases.noiseFilterMs = Date.now() - t
  phases.filteredRows = filtered.length

  // ── phase 5: linksByTarget (object allocation per edge) ────────────────
  t = Date.now()
  const linksByTarget = new Map<string, any[]>()
  for (const e of testEdges) {
    const kind = classify(e.relType)
    if (!kind) continue
    if (!linksByTarget.has(e.targetId)) linksByTarget.set(e.targetId, [])
    linksByTarget.get(e.targetId)!.push({ testSymbolId: e.testSymId, testSymbolName: e.testSymName, testFile: e.testFile, evidence: kind, relationshipType: e.relType, confidence: 0.5 })
  }
  phases.linksByTargetMs = Date.now() - t
  phases.linksByTargetKeys = linksByTarget.size

  // ── phase 6: entries map (all rows) + sort ─────────────────────────────
  t = Date.now()
  const entries = filtered.map((s) => {
    const links = linksByTarget.get(s.id) ?? []
    const strongest = links.some((l) => l.evidence === "direct_call") ? "direct_call" : links.some((l) => l.evidence === "reference") ? "reference" : links.some((l) => l.evidence === "import") ? "import" : "none"
    return { symbolId: s.id, name: s.name, symbolType: s.symbolType, file: s.file, line: s.line, complexity: s.complexity, gravity: s.gravity, links, strongestEvidence: strongest }
  })
  phases.entriesMapMs = Date.now() - t
  t = Date.now()
  entries.sort((a, b) => b.links.length - a.links.length || b.complexity - a.complexity)
  phases.entriesSortMs = Date.now() - t
  phases.entries = entries.length

  // ── phase 7: the gap loop (builds EVERY gap object) + sort ─────────────
  t = Date.now()
  const gaps: any[] = []
  for (const e of entries) {
    let category: string | null = null
    if (e.strongestEvidence === "none") category = "no_evidence"
    else if (e.strongestEvidence === "reference" || e.strongestEvidence === "import") category = "weak_evidence"
    if (!category) continue
    gaps.push({ riskScore: Math.round((e.complexity * 2 + e.gravity * 10) * 100) / 100, category, file: e.file })
  }
  phases.gapLoopMs = Date.now() - t
  t = Date.now()
  gaps.sort((a, b) => b.riskScore - a.riskScore || a.file.localeCompare(b.file))
  phases.gapSortMs = Date.now() - t
  phases.gapsBeforeSlice = gaps.length

  // ── candidate-only alternative (what the fix would do) ─────────────────
  t = Date.now()
  const anyClassified = new Set<string>()
  const hasDirect = new Set<string>()
  for (const e of testEdges) {
    const kind = classify(e.relType)
    if (!kind) continue
    anyClassified.add(e.targetId)
    if (kind === "direct_call") hasDirect.add(e.targetId)
  }
  const cands = filtered
    .filter((s) => !hasDirect.has(s.id))
    .map((s) => ({
      id: s.id,
      category: anyClassified.has(s.id) ? "weak_evidence" : "no_evidence",
      riskScore: Math.round((s.complexity * 2 + s.gravity * 10) * 100) / 100,
      file: s.file,
    }))
  cands.sort((a, b) => b.riskScore - a.riskScore || a.file.localeCompare(b.file))
  phases.candidatePathMs = Date.now() - t
  phases.candidateCount = cands.length

  // ── end-to-end (the tool's own path) ───────────────────────────────────
  t = Date.now()
  const mapping = await testMapping(pid, { maxResults: 100000 })
  phases.testMapping1e5Ms = Date.now() - t
  phases.mappingEntries = mapping.entries.length

  t = Date.now()
  const report = await testGaps(pid, {})
  phases.testGapsTotalMs = Date.now() - t

  const digest = JSON.stringify({ gaps: report.gaps, summary: report.summary, truncated: report.provenance.truncated })
  const nodeCrypto = await import("node:crypto")
  const reportDigest = nodeCrypto.createHash("sha256").update(digest).digest("hex")
  const phasesTotal = Object.entries(phases).filter(([k]) => k.endsWith("Ms")).reduce((a, [, v]) => a + (v as number), 0)

  const fs = await import("node:fs")
  fs.mkdirSync(`${ROOT}/validation/m50/results`, { recursive: true })
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null
  const prevReportDigestMatch = prev?.reportDigest ? prev.reportDigest === reportDigest : null

  const out = {
    probe: "M50.A2-test-gaps-phases",
    at: new Date().toISOString(),
    projectId: pid,
    phases,
    reportDigest,
    prevReportDigestMatch,
    note: "reportDigest covers the full testGaps() output (gaps + summary + truncated) so a bounded rewrite must reproduce it byte-for-byte.",
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(JSON.stringify({ phases, gapsReturned: report.gaps.length, summary: report.summary, reportDigest, prevReportDigestMatch, phasesTotalMs: phasesTotal }, null, 2))
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
