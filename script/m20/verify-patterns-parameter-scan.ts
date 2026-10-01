// M20.P1 — complete parameter candidate scan and display-budget separation.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { PatternBrainTools } from "../../src/ast/tools"
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

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-p1-"))
mkdirSync(path.join(root, "src"), { recursive: true })
const params = Array.from({ length: 8 }, (_, i) => `p${i}: number`).join(", ")
writeFileSync(path.join(root, "src", "a.ts"), `export function early(${params}) { return p0 }\n`)
writeFileSync(path.join(root, "src", "b.ts"), "export function normal(a: number) { return a }\n")
writeFileSync(path.join(root, "src", "z.ts"), `export function late(${params}) { return p0 }\n`)
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})
  const result = await PatternBrainTools.detectPatterns(projectId, {
    includeOrphaned: false,
    includeFramework: false,
    includeAntiPatterns: true,
    confidenceThreshold: 0.5,
    maxResults: 1,
  })
  const long = result.patterns.filter((p) => p.type === "long-parameter-list")
  check("small display limit is honored", result.patterns.length === 1, `displayed=${result.patterns.length}`)
  check("late candidate was evaluated", result.scan.candidatesEvaluated >= 2, JSON.stringify(result.scan))
  check("scan reports truncation", result.scan.truncated === true, JSON.stringify(result.scan))
  check("statistics describe displayed results", result.statistics.totalFound === result.patterns.length, JSON.stringify(result.statistics))
  check("long-parameter finding carries indexed evidence", long.every((p) => p.evidence.some((e) => e.type === "indexed-parameters")))

  const raw = await BrainDatabase.getRawInstance(projectId)
  const rows = raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ? AND parameters IS NOT NULL AND parameters != '[]'").get(projectId) as { c: number }
  check("fixture has multiple parameter candidates", rows.c >= 3, `candidates=${rows.c}`)
} catch (error) {
  check("P1 verifier session", false, error instanceof Error ? error.message : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
const result = {
  issue: "M20.P1", code: "P1", milestone: "M20",
  status: failures === 0 && patternRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks, passed, failed: failures, negativeCases: 1,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: patternSourceFingerprint(path.resolve(".")),
  verifierCommand: "bun run script/m20/verify-patterns-parameter-scan.ts",
  evidenceFile: "P1.json", generatedAt: new Date().toISOString(),
  workingTreeRelevantChanges: patternRelevantWorkingTreeChanges(path.resolve(".")),
  limitations: ["Fixture-level parameter-scan coverage; real-repository corpus coverage is owned by M20.X2.", "Embedding coverage is not required for this structural pattern contract."]
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/P1.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failures === 0 ? "\nPATTERNS P1: PASS" : `\nPATTERNS P1: ${failures} FAILURES`)
process.exit(failures ? 1 : 0)
