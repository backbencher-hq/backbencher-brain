// M20.P2 — orphan and dynamic-use semantic boundaries.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { detectOrphans } from "../../src/intelligence/patterns/orphans"
import { patternRelevantWorkingTreeChanges, patternSourceFingerprint } from "../../src/intelligence/patterns/evidence"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) passed++
  if (value) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-p2-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "one.ts"), "export function shared() { return 1 }\nexport function onlyOne() { return shared() }\n")
writeFileSync(path.join(root, "src", "two.ts"), "export function shared() { return 2 }\nexport function onlyTwo() { return shared() }\n")
writeFileSync(path.join(root, "src", "dynamic.ts"), "export function dynamicTarget() { return 3 }\nexport function loader(name: string) { return registry[name]() }\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const report = await detectOrphans(projectId, { minConfidence: 0, maxResults: 100 })
  const findings = report.findings
  const sharedFindings = findings.filter((f) => f.location.symbol === "shared")
  check("same-named symbols are not globally suppressed", sharedFindings.length >= 1, `shared findings=${sharedFindings.length}`)
  check("duplicate-name ambiguity is recorded", report.provenance.limitations.some((x) => /duplicate symbol name/i.test(x)), JSON.stringify(report.provenance.limitations))
  check("dynamic target remains visible as an uncertain orphan candidate", findings.some((f) => f.location.symbol === "dynamicTarget"), findings.map((f) => f.location.symbol ?? "").join(","))
  check("dynamic limitation is explicitly documented", findings.filter((f) => f.location.symbol === "dynamicTarget").every((f) => f.limitations.some((x) => /dynamic|reflection|string/i.test(x))))
  check("all findings carry evidence", findings.every((f) => f.evidence.length > 0))

  const raw = await BrainDatabase.getRawInstance(projectId)
  const relationships = raw.prepare("SELECT relationship_type, target_external, target_symbol_id FROM brain_relationship WHERE project_id = ? ORDER BY relationship_type, target_external").all(projectId) as Array<{ relationship_type: string; target_external: string | null; target_symbol_id: string | null }>
  check("fixture has a dynamic string access without fabricated static target", relationships.some((r) => r.target_external === "registry[name]" && !r.target_symbol_id), JSON.stringify(relationships))
} catch (error) {
  check("P2 verifier session", false, error instanceof Error ? error.message : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
const result = {
  issue: "M20.P2", code: "P2", milestone: "M20",
  status: failures === 0 && patternRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks, passed, failed: failures, negativeCases: 1,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: patternSourceFingerprint(path.resolve(".")),
  verifierCommand: "bun run script/m20/verify-patterns-orphan-semantics.ts",
  evidenceFile: "P2.json", generatedAt: new Date().toISOString(),
  workingTreeRelevantChanges: patternRelevantWorkingTreeChanges(path.resolve(".")),
  limitations: ["Fixture-level orphan and dynamic-use coverage; dynamic/reflection wiring remains uncertain by design.", "Real-repository corpus coverage is owned by M20.X2."]
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/P2.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failures === 0 ? "\nPATTERNS P2: PASS" : `\nPATTERNS P2: ${failures} FAILURES`)
process.exit(failures ? 1 : 0)
