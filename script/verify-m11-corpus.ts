import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const manifestPath = resolve(root, "validation/m11/corpus-manifest.json")
const planPath = resolve(root, "plans/M11-validation-plan.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as any
const plan = JSON.parse(readFileSync(planPath, "utf8")) as any
let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}

check("manifest schema is version 1", manifest.schemaVersion === 1)
check("manifest uses repository-only external root", manifest.externalCloneRoot === "$HOME/fixtures/repositories")
check("evidence is repository-owned", manifest.evidenceRoot === "validation/m11")
check("external policy allows cloned repositories only", manifest.externalDirectoryPolicy === "cloned_repositories_only")
check("evidence policy is repository-owned", manifest.evidencePolicy.includes("versioned_here"))
check("size classes are declared", Object.keys(manifest.sizeClasses).join(",") === "small,medium,large,very_large")
check("corpus has repositories", manifest.repositories.length >= 20)
check("repository ids are unique", new Set(manifest.repositories.map((r: any) => r.id)).size === manifest.repositories.length)

const coveredLanguages = new Set([
  ...manifest.repositories.flatMap((r: any) => r.languages),
  ...manifest.plannedAcquisitions.map((r: any) => r.language),
  ...manifest.ubiquitousFixtureTargets,
])
for (const [parent, aliases] of Object.entries(manifest.coverageAliases) as Array<[string, string[]]>) {
  if (coveredLanguages.has(parent) || aliases.some((alias) => coveredLanguages.has(alias))) {
    coveredLanguages.add(parent)
    aliases.forEach((alias) => coveredLanguages.add(alias))
  }
}
const targetLanguages = [...plan.tiers.tier1, ...plan.tiers.tier2]
check("all 42 planned language targets are covered or explicitly planned",
  targetLanguages.length === 42 && targetLanguages.every((language: string) => coveredLanguages.has(language)))
check("all corpus revisions are full commit hashes", manifest.repositories.every((r: any) => /^[0-9a-f]{40}$/.test(r.revision)))
check("all repository paths are absolute", manifest.repositories.every((r: any) => r.path.startsWith("/")))
check("all new acquisition destinations are external clone root", manifest.plannedAcquisitions.every((r: any) => r.destination === manifest.externalCloneRoot))
check("dirty exploratory repositories are not evidence eligible", manifest.repositories.filter((r: any) => !r.clean).every((r: any) => !r.evidenceEligible))
check("clean repositories are evidence eligible unless explicitly blocked", manifest.repositories.filter((r: any) => r.clean && !r.coverageNote?.includes("no substantial")).every((r: any) => r.evidenceEligible))

const evidenceRoot = resolve(root, manifest.evidenceRoot)
check("evidence root exists", existsSync(evidenceRoot))
check("coverage gaps are explicit", Array.isArray(manifest.coverageGaps) && manifest.coverageGaps.length > 0)
check("relationship contract remains open", plan.relationshipContract?.closedSet === false)
check("relationship contract requires per-language ontology", plan.relationshipContract?.requiresPerLanguageOntology === true)
check("relationship contract requires independent truth", plan.relationshipContract?.requiresIndependentGroundTruth === true)
check("core relationship families are declared", plan.coreRelationshipFamilies.length >= 15)
check("time and space metrics are declared", plan.metrics.includes("wall_time_ms") && plan.metrics.includes("peak_rss_bytes") && plan.metrics.includes("database_bytes"))

if (failures) {
  console.error(`\nM11 CORPUS: FAIL (${failures} failure${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log("\nM11 CORPUS: PASS")
