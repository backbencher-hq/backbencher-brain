// Equivalence fingerprint for the pattern engines: captures the FULL report
// (findings + summary + provenance) so an engine rewrite can be proven to return
// the same answer, not merely a plausible one. Timings are excluded on purpose.
//
// Usage: BB_DATA_DIR=<tier data dir> npx tsx engine-fingerprint.mts <projectDir> <out.json>

import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { detectOrphans } from "../../../../src/intelligence/patterns/orphans"
import { detectIndexRules } from "../../../../src/intelligence/patterns/rules"
import { PatternBrainTools } from "../../../../src/ast/tools"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) { console.error("usage: engine-fingerprint.mts <projectDir> <out.json>"); process.exit(2) }
const projectId = getProjectId(projectDir)
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")

const orphans = await detectOrphans(projectId as any, { minConfidence: 0, maxResults: 100 })
const rules = await detectIndexRules(projectId as any, { confidenceThreshold: 0, maxResults: 1000, includeFramework: true, includeAntiPatterns: true })
const all = await PatternBrainTools.detectPatterns(projectId as any, { includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0, maxResults: 100 })
BrainDatabase.closeAll()

const payload = {
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? null,
  orphans: {
    findings: orphans.findings,
    summary: orphans.summary,
    provenance: {
      evidenceClass: orphans.provenance.evidenceClass,
      engine: orphans.provenance.engine,
      engineVersion: orphans.provenance.engineVersion,
      source: orphans.provenance.source,
      limitations: orphans.provenance.limitations,
    },
    counts: {
      findings: orphans.findings.length,
      candidatesTotal: orphans.summary.candidatesTotal,
      candidatesByRule: orphans.summary.candidatesByRule,
      suppressed: orphans.summary.suppressedByReason,
      unverifiedUsageEdges: (orphans.summary as any).unverifiedUsageEdges,
      importResolution: (orphans.summary as any).importResolution,
    },
  },
  rules: { findings: rules, count: rules.length },
  scopeAll: { patterns: all.patterns, statistics: all.statistics, scan: all.scan },
}
const fingerprints = {
  orphans: hash(payload.orphans.findings),
  orphansSummary: hash(payload.orphans.summary),
  rules: hash(payload.rules.findings),
  scopeAllPatterns: hash(payload.scopeAll.patterns),
  whole: hash(payload),
}
writeFileSync(outPath, JSON.stringify({ projectId, dataDir: payload.dataDir, fingerprints, counts: payload.orphans.counts, ruleCount: payload.rules.count, generatedAt: new Date().toISOString() }, null, 2) + "\n")
console.log(JSON.stringify({ projectId, fingerprints, counts: payload.orphans.counts, ruleCount: payload.rules.count }, null, 1))
