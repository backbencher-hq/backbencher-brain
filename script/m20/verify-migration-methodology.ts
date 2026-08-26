// script/m20/verify-migration-methodology.ts — M20.M2.
//
// Proves that migration effort totals are derived from typed relationship
// evidence and dependency evidence, not from human-readable strategy prose.
// Every positive and negative case exercises production functions directly.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { CrossLanguageMigrationAssistant } from "../../src/ast/cross-language-migration-assistant"
import { calculateMigrationMethodology } from "../../src/intelligence/migration/migration-engine"
import { migrationSourceFingerprint } from "../../src/intelligence/migration/migration-evidence"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m20/results")
let checks = 0
let passed = 0
let negativeCases = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

function negative(label: string, condition: boolean, detail = ""): void {
  negativeCases++
  check(`${label} [negative]`, condition, detail)
}

const analysis = {
  crossLanguageSymbols: [
    {
      id: "svc-1",
      name: "OrderService",
      type: "service",
      languages: ["typescript"],
      definitions: [{ filePath: "src/app.ts", symbolId: "svc-1" }],
      usages: [],
      contracts: [],
      metadata: { imports: ["express", "mystery-lib"] },
    },
    {
      id: "other-1",
      name: "OtherService",
      type: "service",
      languages: ["typescript"],
      definitions: [{ filePath: "src/app.ts", symbolId: "other-1" }],
      usages: [],
      contracts: [],
      metadata: {},
    },
  ],
  crossLanguageRelationships: [
    {
      id: "r-1",
      type: "api_call",
      source: { symbolId: "svc-1", filePath: "src/app.ts" },
      target: { symbolId: "dep-1", filePath: "src/client.ts" },
      strength: 0.8,
    },
    {
      id: "r-1",
      type: "api_call",
      source: { symbolId: "svc-1", filePath: "src/app.ts" },
      target: { symbolId: "dep-1", filePath: "src/client.ts" },
      strength: 0.8,
    },
    {
      id: "r-2",
      type: "database_access",
      source: { symbolId: "other-1", filePath: "src/app.ts" },
      target: { symbolId: "svc-1", filePath: "src/app.ts" },
      strength: 0.6,
    },
    // Same file, but neither endpoint is OrderService: must not be charged.
    {
      id: "unrelated-file-edge",
      type: "message_queue",
      source: { symbolId: "other-1", filePath: "src/app.ts" },
      target: { symbolId: "dep-2", filePath: "src/worker.ts" },
      strength: 0.5,
    },
  ],
} as any

const plan = await CrossLanguageMigrationAssistant.generateMigrationPlan("OrderService", "python", analysis)
check("M2: production plan is generated from the fixture", plan !== null)
check("M2: relationship evidence is present and symbol-scoped", plan?.relationshipEvidence?.length === 2 && plan.relationshipEvidence.every((edge: any) => ["r-1", "r-2"].includes(edge.id)), JSON.stringify(plan?.relationshipEvidence))
check("M2: duplicate relationship identity is removed", plan?.relationshipEvidence?.filter((edge: any) => edge.id === "r-1").length === 1, JSON.stringify(plan?.relationshipEvidence))
check("M2: unrelated same-file relationship is excluded", !plan?.relationshipEvidence?.some((edge: any) => edge.id === "unrelated-file-edge"), JSON.stringify(plan?.relationshipEvidence))
check("M2: one unknown mapping is explicit", plan?.dependencies?.filter((dependency: any) => dependency.confidence < 0.5).length === 1, JSON.stringify(plan?.dependencies))
check("M2: per-plan effort uses structured evidence", plan?.effortEstimateHours === 14, `effort=${plan?.effortEstimateHours}`)

if (!plan) throw new Error("M2 fixture did not produce a migration plan")
const methodology = calculateMigrationMethodology([plan])
check("M2: methodology counts unique typed relationships", methodology.relationshipCount === 2 && methodology.relationshipHours === 4, JSON.stringify(methodology))
check("M2: methodology counts missing mappings structurally", methodology.missingMappingCount === 1 && methodology.missingMappingHours === 6, JSON.stringify(methodology))
check("M2: methodology base is component-count based", methodology.baseHours === 4, JSON.stringify(methodology))
check("M2: methodology declares its deduplication identity", methodology.deduplication === "relationship-id-or-structural-identity", methodology.deduplication)

const proseMutation = {
  ...plan,
  strategySteps: plan.strategySteps.map((step: string) => step.replace(/\d+/g, "9999")),
}
const proseMutatedMethodology = calculateMigrationMethodology([proseMutation])
negative("M2: changing strategy prose digits does not change totals", JSON.stringify(proseMutatedMethodology) === JSON.stringify(methodology), JSON.stringify({ before: methodology, after: proseMutatedMethodology }))

const graphMutation = {
  ...plan,
  relationshipEvidence: [...plan.relationshipEvidence, {
    id: "r-3",
    relationshipType: "configuration_share",
    sourceSymbolId: "svc-1",
    targetSymbolId: "dep-3",
    sourceFile: "src/app.ts",
    targetFile: "config/app.json",
    strength: 0.4,
  }],
}
const graphMutatedMethodology = calculateMigrationMethodology([graphMutation])
negative("M2: changing structured relationship evidence changes totals", graphMutatedMethodology.relationshipCount === methodology.relationshipCount + 1 && graphMutatedMethodology.relationshipHours === methodology.relationshipHours + 2, JSON.stringify({ before: methodology, after: graphMutatedMethodology }))

const duplicatePlanMethodology = calculateMigrationMethodology([plan, { ...plan }])
check("M2: the same relationship shared by plans is globally deduplicated", duplicatePlanMethodology.relationshipCount === 2 && duplicatePlanMethodology.relationshipHours === 4, JSON.stringify(duplicatePlanMethodology))

const removedEvidenceMethodology = calculateMigrationMethodology([{ ...plan, relationshipEvidence: [] }])
negative("M2: removing relationship evidence removes relationship hours", removedEvidenceMethodology.relationshipCount === 0 && removedEvidenceMethodology.relationshipHours === 0, JSON.stringify(removedEvidenceMethodology))

const engineSource = readFileSync(path.join(ROOT, "src/intelligence/migration/migration-engine.ts"), "utf8")
check("M2: aggregate engine no longer parses strategy-step digits", !engineSource.includes("cross-boundary relationships"), "strategy-text parser still present")
check("M2: aggregate engine calls structured methodology", engineSource.includes("calculateMigrationMethodology(plans)"), "structured helper call missing")
check("M2: production plan exposes structured relationship evidence", readFileSync(path.join(ROOT, "src/ast/cross-language-migration-assistant.ts"), "utf8").includes("relationshipEvidence"), "relationshipEvidence field missing")

let currentCommit = "unknown"
try { currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
const relevantPaths = new Set([
  "src/ast/cross-language-migration-assistant.ts",
  "src/intelligence/migration/migration-engine.ts",
  "docs/BB_MIGRATE.md",
  "docs/tools/bb_migrate.md",
  "package.json",
  "script/verify-quality-gate.ts",
  "script/m20/verify-migration-methodology.ts",
])
const workingTreeRelevantChanges = (() => {
  try {
    return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").map((line) => line.slice(3).trim()).filter((file) => relevantPaths.has(file))
  } catch {
    return ["git-status-unavailable"]
  }
})()
const failed = checks - passed
const evidence = {
  issue: "M20.M2",
  code: "M2",
  milestone: "M20",
  status: failed === 0 && workingTreeRelevantChanges.length === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  negativeCases,
  currentCommit,
  sourceFingerprint: migrationSourceFingerprint(ROOT),
  workingTreeRelevantChanges,
  verifierCommand: "bun run script/m20/verify-migration-methodology.ts",
  evidenceFile: "M2.json",
  generatedAt: new Date().toISOString(),
  measured: {
    relationshipEvidence: plan.relationshipEvidence.length,
    relationshipHours: methodology.relationshipHours,
    missingMappingCount: methodology.missingMappingCount,
    missingMappingHours: methodology.missingMappingHours,
    planEffortHours: plan.effortEstimateHours,
  },
  limitations: [
    "This gate proves methodology arithmetic and relationship evidence boundaries; it does not prove that the analyzer resolved every real-world relationship.",
    "Library equivalence remains advisory and is audited separately in M20.M3.",
    "A clean source revision is required before this result is closure evidence.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(path.join(RESULTS, "M2.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log(`M2: ${evidence.status.toUpperCase()} (${passed}/${checks} passed, ${negativeCases} negative)`)
process.exit(failed === 0 ? 0 : 1)
