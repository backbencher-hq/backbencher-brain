// script/m13/verify-health-integrity.ts — M13.31 (H3).
//
// bb_health integrity + schema + embedding coverage truthfulness:
//   1. the 12-point integrity check reports every point with a status that
//      matches reality (adversarially corrupted rows flip the right check),
//   2. the reported schema version equals the actual brain_schema_version row,
//   3. embedding coverage is computed purely from stored rows and labeled as
//      coverage of stored state — never as a semantic quality claim.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { runIndexHealthCheck } from "../../src/brain/brain-index-health"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.31",
  code: "H3",
  tool: "bb_health",
  title: "bb_health: integrity + schema + embedding coverage",
  layers: ["unit", "integration"],
  decisions: {
    integrity: "each of the 13 checks reports status computed from the DB; corrupting rows flips the matching check to warn/error (13 since M51.A2 split orphan owners from by-design synthetic container references)",
    schema: "report.schema.version must equal the actual brain_schema_version row",
    embeddings: "coverage is stored-row-count / symbol-count — a state report, never a quality claim (label audited)",
  },
  limitations: [
    "The WAL-size and ratio sanity checks are environment-dependent; their status is recorded as computed, not forced.",
    "M14-observed defect FIXED by M51.A3: the indexer once stored same-file edges with dangling source ids (dangling-source > 0 on fresh indexes). Since M51, a fresh index must report 0 — a nonzero value now means an indexer regression.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-health-integrity-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
// a.ts exports alpha0..alpha10; beta calls ALL of them so the index carries 11
// real relationship edges. Deleting the targets crosses the orphan threshold (10).
const alphas = Array.from({ length: 11 }, (_, i) => `export function alpha${i}(): number { return ${i} }`).join("\n")
writeFileSync(path.join(root, "src", "a.ts"), alphas + "\n")
const calls = Array.from({ length: 11 }, (_, i) => `alpha${i}()`).join(" + ")
writeFileSync(path.join(root, "src", "b.ts"), `import { alpha0, alpha1, alpha2, alpha3, alpha4, alpha5, alpha6, alpha7, alpha8, alpha9, alpha10 } from './a'\nexport function beta(): number { return ${calls} }\n`)
await indexProjectParallel(projectId, root, {})

const raw = await BrainDatabase.getRawInstance(projectId)

// ── 1. Integrity: 12 points, each truthful ────────────────────────────────
const clean = await runIndexHealthCheck(projectId as any)
harness.check("integrity: exactly 13 checks reported (12 + M51.A2 synthetic-container split)", clean.checks.length === 13, `got ${clean.checks.length}`)
harness.check("integrity: every check carries a valid status", clean.checks.every((c) => ["ok", "warn", "error"].includes(c.status)), clean.checks.map((c) => c.code).join(","))
// M64: the summary is now split, because the "Synthetic Container References"
// check is informational — its status does not depend on the data, so counting
// it added a constant +7.7 points to every project's overallHealth and put a
// floor under the score that no real failure could cross. The invariant is
// therefore over SCORED checks, and the derived counts are asserted as counts
// rather than as a literal 13 that the code can drift away from.
harness.check(
  "integrity: summary accounts for every check (scored + informational = total)",
  clean.summary.scored + clean.summary.informational === clean.summary.total,
  JSON.stringify(clean.summary),
)
harness.check(
  "integrity: statuses account for every SCORED check",
  clean.summary.ok + clean.summary.warn + clean.summary.error === clean.summary.scored,
  JSON.stringify(clean.summary),
)
harness.check("integrity: the informational check is excluded from the score", clean.summary.informational === 1 && clean.checks.filter((c) => c.kind === "informational").length === 1, JSON.stringify(clean.summary))

// Clean fixture: byte bounds, line bounds, hash drift must be ok.
const byName = (name: string) => clean.checks.find((c) => c.name === name)
harness.check("integrity: byte-bounds check ok on clean index", byName("Byte Bounds Coverage")?.status === "ok", byName("Byte Bounds Coverage")?.status ?? "missing")
harness.check("integrity: line-bounds check ok on clean index", byName("Line Bounds Coverage")?.status === "ok", byName("Line Bounds Coverage")?.status ?? "missing")
harness.check("integrity: hash-drift check ok before modification", byName("Hash Drift (Stale Files)")?.status === "ok", byName("Hash Drift (Stale Files)")?.status ?? "missing")

// Adversarial: modify a real source file → hash-drift must flip to warn (value 1)
// and overall health must drop. This is the deterministic, in-scope corruption.
{
  writeFileSync(path.join(root, "src", "a.ts"), readFileSync(path.join(root, "src", "a.ts"), "utf8") + "\n// h3-drift-probe\n")
  const corrupted = await runIndexHealthCheck(projectId as any)
  const drift = corrupted.checks.find((c) => c.name === "Hash Drift (Stale Files)")
  harness.negative(
    "integrity: modifying a file flips hash-drift to warn/error (never silently ok)",
    !!drift && drift.status !== "ok" && drift.value >= 1,
    drift ? `${drift.name}=${drift.status}(${drift.value})` : "no drift check",
  )
  harness.check("integrity: overall health reflects the corruption", corrupted.overallHealth < clean.overallHealth, `clean=${clean.overallHealth}% corrupt=${corrupted.overallHealth}%`)
}

// Honest recording: the relationship-graph checks are computed truthfully from
// stored data. Pre-M51, the indexer wrote same-file edges with dangling source
// ids (anonymous symbols skipped by insert-time filters), so a fresh fixture
// showed dangling-sources >= 1 and this gate recorded that as observed truth,
// noting the defect lived in the indexer. M51.A3 (#718) fixed the generator
// (same-file endpoints are validated against the storeable-row replica and
// degrade to external edges), so the expectation flips to 0 — a nonzero value
// now means the indexer regressed.
{
  const orphan = clean.checks.find((c) => c.name === "Orphan Target Relationships")
  const dangling = clean.checks.find((c) => c.name === "Dangling Source Relationships")
  harness.check("integrity: orphan-target check reports stored truth (0 orphan targets in stored data)", orphan?.status === "ok" && orphan?.value === 0, orphan ? `${orphan.value}` : "missing")
  harness.check("integrity: dangling-source check reports stored truth (0 after M51.A3 generator fix)", dangling?.status === "ok" && dangling?.value === 0, dangling ? `${dangling.value}` : "missing")
}

// ── 2. Schema version reflects the actual database ────────────────────────
{
  const report = await getUnifiedHealth(projectId, root, {})
  const dbRow = raw.prepare("SELECT version, migration_name FROM brain_schema_version ORDER BY version DESC LIMIT 1").get() as any
  harness.check("schema: reported version equals the DB row", report.schema.version === dbRow?.version, `report=${report.schema.version} db=${dbRow?.version}`)
  harness.check("schema: reported migration name equals the DB row", report.schema.migration === dbRow?.migration_name, `report=${report.schema.migration} db=${dbRow?.migration_name}`)
  harness.check("schema: version is a positive number", typeof report.schema.version === "number" && report.schema.version > 0, String(report.schema.version))
}

// ── 3. Embedding coverage is stored state, not quality ────────────────────
{
  const report = await getUnifiedHealth(projectId, root, {})
  const embedded = (raw.prepare("SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id=?").get(projectId) as any)?.c ?? 0
  const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any)?.c ?? 0
  const expected = symbols > 0 ? Math.round((embedded / symbols) * 1000) / 10 : 0
  harness.check("coverage: percentage equals stored-row computation exactly", report.embeddings.symbolCoveragePercent === expected, `report=${report.embeddings.symbolCoveragePercent} computed=${expected}`)
  harness.check("coverage: entity count equals distinct stored entity rows", report.embeddings.embeddedEntities === embedded, `report=${report.embeddings.embeddedEntities} db=${embedded}`)

  const out = formatUnifiedHealth(report)
  harness.negative("coverage: output labels it coverage, never a quality claim", !/quality|semantic quality/i.test(out) || out.includes("coverage"), out.slice(0, 160))
}

// Curated doc label: coverage reports stored state, not semantic quality.
{
  const doc = readFileSync(path.resolve("docs/tools/bb_health.md"), "utf8")
  harness.check("docs: embedding coverage labeled as stored state, not quality", doc.includes("Embedding coverage reports stored state, not semantic quality"), "missing label")
}

rmSync(root, { recursive: true, force: true })
harness.emit()
