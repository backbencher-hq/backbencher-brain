import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { quickAnswer } from "../src/intelligence/search/quick-answer"
import { detectOrphans } from "../src/intelligence/patterns/orphans"
import { PatternBrainTools } from "../src/ast/tools"
import { CrossLanguageSecurityAnalysis } from "../src/security/cross-language-security"
import { createContractFixture } from "./fixtures/contract-fixture"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`)
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-intel-consol-"))
const projectId = getProjectId(root)
const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)))
try {
  createContractFixture(root)
  await indexProjectParallel(projectId, root, {})

  // --- bb_ask canonical routing ---
  const stat = await quickAnswer(projectId, "how many functions are in this project")
  check("bb_ask stat branch returns symbol count", /\d+ functions/.test(stat.answer), stat.answer)
  check("bb_ask stat result carries provenance", stat.provenance.engine === "quick-answer@intelligence" && stat.provenance.evidenceClass === "indexed")

  const statFiles = await quickAnswer(projectId, "how many files are in this project")
  check("bb_ask file count branch returns count", /\d+ files/.test(statFiles.answer))

  const fallback = await quickAnswer(projectId, "handleRequest")
  check("bb_ask semantic path returns answer", typeof fallback.answer === "string" && fallback.answer.length > 0)
  check("bb_ask semantic path carries provenance", !!fallback.provenance && fallback.provenance.evidenceClass !== undefined)
  check("bb_ask semantic path evidence class is semantic_candidate or unknown", ["semantic_candidate", "unknown"].includes(fallback.provenance.evidenceClass), fallback.provenance.evidenceClass)

  // --- bb_patterns orphaned canonical routing ---
  const orphanReport = await detectOrphans(projectId, { minConfidence: 0, maxResults: 50 })
  check("canonical orphan report has findings array", Array.isArray(orphanReport.findings))
  check("canonical orphan report has provenance", orphanReport.provenance.engine.startsWith("orphans"))
  check("orphanedFunction is detected as orphaned_function", orphanReport.findings.some((f) => f.rule === "orphaned_function"))
  const orphanFinding = orphanReport.findings.find((f) => f.rule === "orphaned_function")
  check("orphan finding carries evidence array", !!orphanFinding && Array.isArray(orphanFinding.evidence))
  check("orphan finding carries limitations array", !!orphanFinding && Array.isArray(orphanFinding.limitations))
  check("orphan finding carries remediation string", !!orphanFinding && typeof orphanFinding.remediation === "string")
  check("orphan finding carries numeric linesOfCode", !!orphanFinding && typeof orphanFinding.linesOfCode === "number")
  check("canonical orphan report summary total matches findings length", orphanReport.summary.total === orphanReport.findings.length)

  // --- bb_patterns scope=all orphan rule routes to canonical engine ---
  const allPatterns = await PatternBrainTools.detectPatterns(projectId, {
    includeOrphaned: true,
    includeFramework: false,
    includeAntiPatterns: false,
    confidenceThreshold: 0,
    maxResults: 100,
  })
  check("detectPatterns orphan rule yields same count as canonical detectOrphans", allPatterns.patterns.length === orphanReport.findings.length,
    `patterns=${allPatterns.patterns.length} orphans=${orphanReport.findings.length}`)
  const orphanFnPattern = allPatterns.patterns.find((p) => p.type === "orphaned_function")
  check("detectPatterns orphan rule maps description from canonical finding", !!orphanFnPattern && orphanFnPattern.description === orphanFinding?.description)
  check("detectPatterns orphan rule maps evidence from canonical finding", !!orphanFnPattern && Array.isArray(orphanFnPattern.evidence))

  // --- No active obsolete tables in bb_ask / bb_patterns / bb_security paths ---
  const joinGrep = (src: string): boolean => /sentinel_runs|sentinel_findings/.test(src)
  const quickAnswerSrc = readFileSync(resolve(rootDir, "src/intelligence/search/quick-answer.ts"), "utf8")
  const orphanSrc = readFileSync(resolve(rootDir, "src/intelligence/patterns/orphans.ts"), "utf8")
  const taintSrc = readFileSync(resolve(rootDir, "src/intelligence/security/taint.ts"), "utf8")
  const crossSecSrc = readFileSync(resolve(rootDir, "src/security/cross-language-security.ts"), "utf8")
  check("bb_ask canonical quick-answer source has no sentinel/obsoleted table refs", !joinGrep(quickAnswerSrc))
  check("bb_patterns canonical detectOrphans source has no sentinel/obsoleted table refs", !joinGrep(orphanSrc))
  check("bb_security canonical taint engine source has no sentinel/obsoleted table refs", !joinGrep(taintSrc))
  check("bb_security thin adapter source has no sentinel/obsoleted table refs", !joinGrep(crossSecSrc))

  // --- M10.06: legacy paths are REMOVED, not dead-but-reachable ---
  const { BrainTools: checkBt } = await import("../src/ast/tools")
  check("legacy BrainTools.quickAnswer is removed (M10.06)", typeof (checkBt as any).quickAnswer !== "function")
  check("legacy BrainTools.recallFunction is removed (M10.06)", typeof (checkBt as any).recallFunction !== "function")
  check("legacy PatternBrainTools.findOrphanedCode is removed (M10.06)", typeof (PatternBrainTools as any).findOrphanedCode !== "function")

  // --- bb_security still routes through thin adapter to canonical engine (no duplicate logic) ---
  const securityResult = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
  check("bb_security result has findings array", Array.isArray(securityResult.findings))
  check("bb_security result has summary object", typeof securityResult.summary === "object" && securityResult.summary !== null)
} catch (error) {
  check("intelligence consolidation session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nINTELLIGENCE CONSOLIDATION: PASS" : `\nINTELLIGENCE CONSOLIDATION: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
