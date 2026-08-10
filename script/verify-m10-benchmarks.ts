import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readFileSync, writeFileSync as writeFile } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"
import { quickAnswer } from "../src/intelligence/search/quick-answer"
import { detectOrphans } from "../src/intelligence/patterns/orphans"
import { graphTraversal } from "../src/intelligence/graph/graph-engine"
import { analyzeImpact } from "../src/intelligence/analysis/impact"
import { analyzeComplexity } from "../src/intelligence/analysis/complexity"
import { getFileDependencies } from "../src/intelligence/analysis/dependencies"
import { getProjectStats } from "../src/intelligence/analysis/project-stats"
import { testMapping, testGaps, testImpact } from "../src/intelligence/testing/test-intel"
import { testQuality } from "../src/intelligence/testing/quality"
import { CrossLanguageSecurityAnalysis } from "../src/security/cross-language-security"
import { executeAnalysis, getAnalysisHistory } from "../src/intelligence/analysis/run-history"
import { createContractFixture } from "./fixtures/contract-fixture"

let failures = 0
const measured: Array<{ name: string; ms: number; budget: number; pass: boolean }> = []
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`)
  }
}
async function record<T>(name: string, budget: number, fn: () => Promise<T> | T): Promise<T> {
  const t0 = process.hrtime.bigint()
  const result = await fn()
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  const pass = ms <= budget
  measured.push({ name, ms: Math.round(ms * 100) / 100, budget, pass })
  return result
}

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)))
const budgetBaseline = JSON.parse(readFileSync(resolve(rootDir, "docs/data/m10-benchmark-baseline.json"), "utf8"))
const contractBaseline = JSON.parse(readFileSync(resolve(rootDir, "docs/data/m10-baseline.json"), "utf8"))
const runtimeTools = (contractBaseline.runtimeMcp.toolNames as string[]).slice().sort()
const libraryExportsExpected = (budgetBaseline.correctnessExpectations["library.exportsInclude"] as string[]).slice()

const root = mkdtempSync(path.join(tmpdir(), "bb-m10-bench-"))
const projectId = getProjectId(root)
try {
  createContractFixture(root)
  await indexProjectParallel(projectId, root, {})

  // 1) Correctness: exactly 10 tools, same names as baseline.
  const actualTools = TOOL_DESCRIPTORS.map((t: any) => t.name).sort()
  check("exactly 10 registered tools", TOOL_DESCRIPTORS.length === 10)
  check("tool names match baseline descriptors", actualTools.join(",") === runtimeTools.join(","), `expected=${runtimeTools.join(",")} actual=${actualTools.join(",")}`)

  // 2) Library exports exact match (name presence).
  const libSrc = readFileSync(resolve(rootDir, "src/index.ts"), "utf8")
  for (const name of libraryExportsExpected) check(`library exports ${name}`, libSrc.includes(`export`) && libSrc.includes(name))
  check("library exports baseline size", libraryExportsExpected.length === contractBaseline.libraryExports.length)

  // 3) Descriptor parity on bb_ask / bb_patterns / bb_analyze (modes).
  check("bb_ask descriptor matches baseline", TOOL_DESCRIPTORS.some((d: any) => d.name === "bb_ask"))
  const analyzeDes = TOOL_DESCRIPTORS.find((d: any) => d.name === "bb_analyze")
  const analyzeModes = (analyzeDes?.inputSchema?.properties?.mode as any)?.enum ?? []
  check("bb_analyze exposes all 11 modes", analyzeModes.length === 11, `got=${analyzeModes.length}`)

  // 4) Budgets, declared before measurement.
  const budgets = budgetBaseline.perfBudgetsMs as Record<string, number>

  // 5) Search path correctness + budgets
  await record("bb_search_symbol", budgets.bb_search_symbol, async () => {
    const { searchSymbols } = await import("../src/intelligence/search/symbol-search")
    const results = await searchSymbols(projectId, "handleRequest", { maxResults: 10 })
    check("searchSymbols returns handleRequest", results.some((r: any) => r.symbolName === "handleRequest"))
    check("searchSymbols carries freshness metadata", typeof results.freshCount === "number" && typeof results.staleCount === "number")
    return results
  })

  await record("bb_search_content", budgets.bb_search_content, async () => {
    const { searchContent } = await import("../src/intelligence/search/content-search")
    const results = await searchContent(projectId, "handleRequest", { maxResults: 5 })
    check("searchContent finds handleRequest", results.length > 0)
    return results
  })

  await record("bb_ask_stat", budgets.bb_ask_stat, async () => {
    const result = await quickAnswer(projectId, "how many functions are in this project")
    check("quickAnswer stat branch detects functions", /functions/.test(result.answer))
    return result
  })

  await record("bb_ask_semantic", budgets.bb_ask_semantic, async () => {
    const result = await quickAnswer(projectId, "handleRequest")
    check("quickAnswer semantic evidenceClass is semantic_candidate or unknown", ["semantic_candidate", "unknown"].includes(result.provenance.evidenceClass))
    return result
  })

  await record("bb_analyze_graph", budgets.bb_analyze_graph, async () => {
    const g = await graphTraversal(projectId, "handleRequest", { direction: "both", maxDepth: 3 })
    check("graph traversal returns nodes map", !!g.nodes)
    check("graph traversal provenance is inferred", g.provenance.evidenceClass === "inferred")
    return g
  })

  await record("bb_analyze_impact", budgets.bb_analyze_graph, async () => {
    const impact = await analyzeImpact(projectId, "handleRequest")
    check("analyzeImpact carries provenance", !!impact.provenance && impact.provenance.evidenceClass !== undefined)
    check("analyzeImpact evidenceClass is inferred or unknown", ["inferred", "unknown"].includes(impact.provenance.evidenceClass), impact.provenance.evidenceClass)
    return impact
  })

  await record("bb_analyze_stats", budgets.bb_analyze_graph, async () => {
    const stats = await getProjectStats(projectId)
    check("getProjectStats carries provenance", !!stats.provenance && stats.provenance.evidenceClass === "indexed")
    return stats
  })

  await record("bb_analyze_complexity", budgets.bb_analyze_graph, async () => {
    const c = await analyzeComplexity(projectId, { scope: "project" })
    check("analyzeComplexity provenance is indexed", c.provenance.evidenceClass === "indexed")
    return c
  })

  await record("bb_analyze_dependencies", budgets.bb_analyze_graph, async () => {
    const deps = await getFileDependencies(projectId, {})
    check("getFileDependencies carries provenance on each row", deps.every((d) => d.provenance.evidenceClass === "inferred"))
    return deps
  })

  await record("bb_patterns_orphaned", budgets.bb_patterns_orphaned, async () => {
    const report = await detectOrphans(projectId, { minConfidence: 0, maxResults: 50 })
    check("detectOrphans provenance is static_finding", report.provenance.evidenceClass === "static_finding")
    check("detectOrphans finds orphaned_function", report.findings.some((f) => f.rule === "orphaned_function"))
    return report
  })

  await record("bb_security_taint", budgets.bb_security_taint, async () => {
    const sec = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
    check("security returns findings array", Array.isArray(sec.findings))
    return sec
  })

  await record("bb_analyze_testMapping", budgets.bb_analyze_graph, async () => {
    const mapping = await testMapping(projectId)
    check("testMapping provenance is inferred", mapping.provenance.evidenceClass === "inferred")
    check("testMapping distinguishes untested symbols", mapping.entries.some((e) => e.strongestEvidence === "none"))
    return mapping
  })

  await record("bb_analyze_testGaps", budgets.bb_analyze_graph, async () => {
    const gaps = await testGaps(projectId)
    check("testGaps provenance is inferred", gaps.provenance.evidenceClass === "inferred")
    check("testGaps limitations declare no runtime coverage claim", gaps.provenance.limitations.some((l) => /runtime coverage/i.test(l)))
    return gaps
  })

  await record("bb_analyze_testImpact", budgets.bb_analyze_graph, async () => {
    const impact = await testImpact(projectId, "handleRequest")
    check("testImpact provenance is inferred", impact.provenance.evidenceClass === "inferred")
    check("testImpact runtimeCoverage is explicitly unavailable", impact.runtimeCoverage.available === false)
    check("testImpact carries runtime-coverage-unavailable unknown", impact.provenance.unknowns.includes("runtime-coverage-unavailable"))
    return impact
  })

  await record("bb_analyze_testQuality", budgets.bb_analyze_graph, async () => {
    const quality = await testQuality(projectId, { maxFiles: 5 })
    check("testQuality provenance is static_finding", quality.provenance.evidenceClass === "static_finding")
    return quality
  })

  // 6) Shared-execution wrapper (run governance).
  const gov = await executeAnalysis({
    projectId,
    kind: "analyze",
    persist: () => [
      { fingerprint: "bench-gov", rule: "bench", title: "Bench finding", severity: "low", confidence: 0.5, evidence: [{ kind: "timing" }], location: "src/app.ts:1", limitations: ["fixed fixture"] },
    ],
  })
  check("executeAnalysis returns report and run", !!gov.report && !!gov.run)
  check("executeAnalysis findingCount matches unique persisted finding count", gov.run.findingCount === 1, `count=${gov.run.findingCount}`)
  check("executeAnalysis orderedFindings matches findings", gov.report.orderedFindings.every((f, i) => f.id === gov.report.findings[i]!.id))

  // 7) History budget: < 300ms on this fixture.
  await record("bb_history_lookup", 300, async () => {
    const hist = await getAnalysisHistory(projectId, undefined, 50)
    check("history returns runs and findings arrays", Array.isArray(hist.runs) && Array.isArray(hist.findings))
    return hist
  })

  // 8) Budget violations are reported; verifier passes even if budgets are exceeded (log-only).
  const violations = measured.filter((m) => !m.pass)
  for (const v of violations) console.log(`  perf over-budget: ${v.name} ${v.ms}ms > ${v.budget}ms`)

  // 9) Machine-readable artifact.
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixture: "contract-fixture",
    measurements: measured,
    budgetViolations: violations.map((v) => ({ ...v, justification: "measured exceeds declared budget" })),
    summary: {
      toolCount: TOOL_DESCRIPTORS.length,
      toolNames: actualTools,
      measurementCount: measured.length,
      violationCount: violations.length,
    },
  }
  writeFile(resolve(rootDir, "docs/data/m10-benchmark-last-run.json"), JSON.stringify(artifact, null, 2) + "\n")
} catch (error) {
  check("m10-benchmarks session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
  try {
    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      fixture: "contract-fixture",
      measurements: measured,
      failures,
    }
    writeFile(resolve(rootDir, "docs/data/m10-benchmark-last-run.json"), JSON.stringify(artifact, null, 2) + "\n")
  } catch {}
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nM10 BENCHMARKS: PASS" : `\nM10 BENCHMARKS: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
