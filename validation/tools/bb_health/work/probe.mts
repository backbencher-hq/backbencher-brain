// Read-only latency probe for bb_health (Phase A audit).
// Usage: node --import tsx validation/tools/bb_health/work/probe.mts '<json options>' [projectPath]
// Measures wall-clock around getUnifiedHealth and prints the report's own timing.
import { getProjectId } from "../../../../src/util/project-id"
import { getUnifiedHealth, formatUnifiedHealth } from "../../../../src/intelligence/health/health-provider"

const rawArgs = process.argv[2] ?? "{}"
const projectPath = process.argv[3] ?? process.cwd()
const options = JSON.parse(rawArgs) as Record<string, unknown>
if (process.env.BB_NO_AUTO_REFRESH !== "1") {
  console.error("refusing to measure with BB_NO_AUTO_REFRESH unset")
  process.exit(2)
}
const projectId = getProjectId(projectPath)
const t0 = process.hrtime.bigint()
let report: any = null
let error: string | null = null
try {
  report = await getUnifiedHealth(projectId, projectPath, options as any)
} catch (e: any) {
  error = e?.message ?? String(e)
}
const wallMs = Number(process.hrtime.bigint() - t0) / 1e6
if (error) {
  console.log(JSON.stringify({ projectPath, projectId, options, wallMs: Math.round(wallMs), error }, null, 2))
  process.exit(1)
}
const text = formatUnifiedHealth(report)
console.log(JSON.stringify({
  projectPath,
  projectId,
  options,
  wallMs: Math.round(wallMs),
  reportTiming: report.timing,
  counts: report.counts,
  freshness: {
    mode: report.freshness.mode,
    checked: report.freshness.checked,
    total: report.freshness.total,
    fresh: report.freshness.fresh,
    stale: report.freshness.stale,
    missing: report.freshness.missing,
    reasons: report.freshness.reasons.byKind,
  },
  warnings: report.warnings.map((w: any) => `${w.severity}:${w.code}`),
  languages: report.languages.length,
  models: report.embeddings.models,
  embeddedEntities: report.embeddings.embeddedEntities,
  unembeddedKinds: report.embeddings.unembeddedKinds.length,
  byLanguage: report.embeddings.byLanguage.length,
  textBytes: Buffer.byteLength(text, "utf8"),
  textLines: text.split("\n").length,
  firstLines: text.split("\n").slice(0, 6),
}, null, 2))
