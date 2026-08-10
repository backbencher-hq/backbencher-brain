import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../brain/database"
import { BrainTools, PatternBrainTools } from "../ast/tools"
import { quickAnswer } from "../intelligence/search/quick-answer"
import { detectOrphans } from "../intelligence/patterns/orphans"
import { ASTEngine } from "../ast/engine"
import { checkResultsFreshness } from "../brain/freshness"
import { CrossLanguageSecurityAnalysis } from "../security/cross-language-security"
import { DependencyGraphVisualizer } from "../ast/dependency-graph-visualizer"
import { CrossLanguageIntelligence } from "../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../ast/cross-language-migration-assistant"
import { indexProjectParallel, reindexFilesParallel, wipeProjectData } from "../ast/parallel-indexer"
import { TOOL_DESCRIPTORS } from "./tool-registry"
import { testQuality } from "../intelligence/testing/quality"
import { executeEdit, type EditRequest } from "../intelligence/edit/edit-engine"
import { getUnifiedHealth, formatUnifiedHealth } from "../intelligence/health/health-provider"
import { getAnalysisHistory, executeAnalysis } from "../intelligence/analysis/run-history"
import { generateDocumentation, formatDocumentation, type DocRequest } from "../intelligence/documentation/doc-engine"
import { visualizeProject, formatVisualization, type VisualizationRequest } from "../intelligence/visualization/visualization-engine"
import { generateMigrationPlans, formatMigrationPlans } from "../intelligence/migration/migration-engine"
import { graphTraversal } from "../intelligence/graph/graph-engine"
import { getProjectStats } from "../intelligence/analysis/project-stats"
import { getFileDependencies } from "../intelligence/analysis/dependencies"
import { analyzeComplexity } from "../intelligence/analysis/complexity"
import { analyzeImpact } from "../intelligence/analysis/impact"
import { testMapping, testGaps, testImpact } from "../intelligence/testing/test-intel"
import type { AnalysisFindingInput } from "../intelligence/contracts"

export interface ToolContext {
  projectPath: string
  projectId: string
}

export type ToolArguments = Record<string, any>
export type ToolResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}
export type ToolHandler = (args: ToolArguments, context: ToolContext) => Promise<ToolResult>

function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) }
}

async function autoRefreshFile(projectId: string, projectPath: string, absPath: string, type: "added" | "modified" = "modified"): Promise<void> {
  try {
    await reindexFilesParallel(projectId as any, projectPath, [{ path: absPath, type }])
  } catch {}
}

async function readSnippet(filePath: string, lineStart: number): Promise<string | null> {
  try {
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, "utf8").split("\n").slice(lineStart - 1, lineStart + 12).join("\n")
  } catch {
    return null
  }
}

function resolveProjectPath(projectPath: string, relativePath: string): string {
  return path.resolve(projectPath, relativePath)
}

function ensureWithinProject(projectPath: string, absolutePath: string): void {
  if (!absolutePath.startsWith(projectPath)) throw new Error(`path escapes project root: ${absolutePath}`)
}

const handlers: Record<string, ToolHandler> = {
  bb_search: async (args, { projectId }) => {
    const mode = args.mode === "content" ? "content" : args.mode === "symbol" || args.mode === "file" ? args.mode : "symbols"
    if (mode === "content") {
      const { searchContent } = await import("../intelligence/search/content-search")
      return textResult(JSON.stringify(await searchContent(projectId as any, String(args.query ?? ""), { maxResults: Number(args.limit ?? 15), languages: args.language ? [String(args.language)] : undefined, symbolKind: args.symbolKind ? String(args.symbolKind) : undefined }), null, 2))
    }
    if (mode === "symbol") {
      const found = await ASTEngine.findSymbol(projectId, String(args.symbolName ?? args.query ?? ""), args.filePath ? String(args.filePath) : undefined)
      return textResult(JSON.stringify(found, null, 2))
    }
    const query = String(args.query ?? "")
    const results: any = await BrainTools.searchCode(projectId, query, {
      maxResults: Number(args.limit ?? 15),
      languages: args.language ? [String(args.language)] : undefined,
      symbolKind: args.symbolKind ? String(args.symbolKind) : undefined,
      includeContent: args.includeContent === true,
      exact: args.exact === true,
      caseSensitive: args.caseSensitive === true,
      regex: args.regex === true,
      offset: Number(args.offset ?? 0),
    })
    if (mode === "file") {
      const filePath = String(args.filePath ?? query)
      return textResult(JSON.stringify(results.filter((result: any) => result.file === filePath || result.file.includes(filePath)), null, 2))
    }
    const lines = results.map((result: any) => {
      const stale = result.stale ? " [STALE]" : ""
      const snippet = result.snippet && result.snippet !== result.symbolName
        ? `\n    ${String(result.snippet).split("\n").slice(0, 8).join("\n    ")}`
        : ""
      return `${result.symbolName} [${result.symbolType}] ${result.file}:${result.line} (${result.language})${stale}${snippet}`
    })
    return textResult(lines.length ? lines.join("\n") : `no results for "${query}"`)
  },

  bb_ask: async (args, { projectId }) => {
    const result = await quickAnswer(projectId, String(args.query))
    const lines = result.sources
      .slice(0, Number(args.limit ?? 5))
      .map((source, index) => `${index + 1}. ${source.file}:${source.line}\n   ${source.context ?? ""}`)
    const head = result.answer ? `answer: ${result.answer}\n\n` : ""
    const prov = `[provenance: ${result.provenance.evidenceClass} via ${result.provenance.engine}${result.provenance.unknowns.length ? `; unknowns: ${result.provenance.unknowns.join("; ")}` : ""}]`
    return textResult(head + (lines.length ? lines.join("\n") : `no semantic matches for "${args.query}"`) + `\n${prov}`)
  },

  bb_analyze: async (args, { projectId }) => {
    const mode = String(args.mode ?? "")
    const allowed = new Set(["mode", "target", "filePath", "limit"])
    const unused = Object.keys(args).filter((key) => !allowed.has(key))
    if (unused.length) return textResult(`bb_analyze ${mode || "unknown"}: irrelevant options: ${unused.join(", ")}`, true)
    const target = args.target ? String(args.target) : ""
    const targetModes = new Set(["callers", "callees", "trace", "complexity", "impact", "test_impact"])
    const fileModes = new Set(["dependencies"])
    if (args.target && !targetModes.has(mode)) return textResult(`bb_analyze ${mode}: irrelevant options: target`, true)
    if (args.filePath && !fileModes.has(mode)) return textResult(`bb_analyze ${mode}: irrelevant options: filePath`, true)
    if (["callers", "callees", "trace", "impact", "test_impact"].includes(mode) && !target) return textResult(`bb_analyze ${mode} requires target`, true)
    if (mode === "callers" || mode === "callees" || mode === "trace") return textResult(JSON.stringify(await graphTraversal(projectId as any, target, { direction: mode === "trace" ? "both" : mode, maxDepth: 3 }), null, 2))
    if (mode === "dependencies") return textResult(JSON.stringify(await getFileDependencies(projectId as any, { filePath: args.filePath ? String(args.filePath) : target || undefined, limit: Number(args.limit ?? 20) }), null, 2))
    if (mode === "stats") return textResult(JSON.stringify(await getProjectStats(projectId as any), null, 2))
    if (mode === "complexity") return textResult(JSON.stringify(await analyzeComplexity(projectId as any, { scope: target ? "file" : "project", target: target || undefined }), null, 2))
    if (mode === "impact") return textResult(JSON.stringify(await analyzeImpact(projectId as any, target), null, 2))
    if (mode === "test_mapping") return textResult(JSON.stringify(await testMapping(projectId as any), null, 2))
    if (mode === "test_gaps") return textResult(JSON.stringify(await testGaps(projectId as any), null, 2))
    if (mode === "test_impact") return textResult(JSON.stringify(await testImpact(projectId as any, target), null, 2))
    if (mode === "test_quality") return textResult(JSON.stringify(await testQuality(projectId as any, { maxFiles: Number(args.limit ?? 50) }), null, 2))
    return textResult("bb_analyze requires mode: callers|callees|trace|dependencies|stats|complexity|impact|test_mapping|test_gaps|test_impact|test_quality", true)
  },

  bb_health: async (args, { projectId, projectPath }) => {
    const refreshRequested = args.refresh === true || args.force === true
    const report = await getUnifiedHealth(projectId, projectPath, { refresh: refreshRequested, force: args.force === true, wait: args.wait !== false, freshness: args.freshness === "complete" ? "complete" : "sampled", sampleSize: args.sampleSize != null ? Number(args.sampleSize) : undefined, integrity: args.integrity === true, includeAnalysisRuns: args.includeAnalysisRuns === true, logger: { log: (..._a: any[]) => {}, write: (_s: string) => {} } })
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, undefined, Number(args.limit ?? 20))
      return textResult(JSON.stringify({ health: report, history }, null, 2))
    }
    return textResult(formatUnifiedHealth(report))
  },

  bb_patterns: async (args, { projectId }) => {
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, "patterns", Number(args.limit ?? 20))
      return textResult(JSON.stringify(history, null, 2))
    }
    const scope = args.scope === "orphaned" ? "orphaned" : "all"
    const limit = Number(args.limit ?? 20)
    if (scope === "orphaned") {
      const report = await detectOrphans(projectId, { minConfidence: Number(args.confidenceThreshold ?? 0.6), maxResults: Math.max(limit, 100) })
      const items = report.findings.slice(0, limit)
      const lines = items.map((f) => `  ${f.rule} ${f.location.symbol || f.location.file} — ${f.location.file}:${f.location.line} (${Math.round(f.confidence * 100)}%)`)
      const prov = `\n[provenance: ${report.provenance.evidenceClass} via ${report.provenance.engine}; ${report.findings.length} findings${report.provenance.truncated ? "; truncated" : ""}; limitations: ${report.provenance.limitations.length}]`
      return textResult(`orphaned code (${report.summary?.total ?? items.length}):\n${lines.join("\n") || "  none"}${prov}`)
    }
    const result: any = await PatternBrainTools.detectPatterns(projectId, {
      includeOrphaned: args.includeOrphaned !== false,
      includeFramework: args.includeFramework !== false,
      includeAntiPatterns: args.includeAntiPatterns !== false,
      confidenceThreshold: Number(args.confidenceThreshold ?? 0.6),
      maxResults: Math.max(limit, 100),
    })
    const items = (result?.patterns ?? []).slice(0, limit)
    const lines = items.map((item: any) => `  [${item.severity}] ${item.type} @ ${item.location?.file}:${item.location?.line} (${Math.round(item.confidence * 100)}%)`)
    if (args.recordRun === true) {
      const recorded = await executeAnalysis({
        projectId,
        kind: "patterns",
        input: { options: args },
        persist: () => items.map((item: any): AnalysisFindingInput => ({
          fingerprint: item.fingerprint ?? `${item.type}:${item.location?.file ?? "?"}:${item.location?.line ?? "?"}`,
          rule: item.type ?? "pattern",
          title: item.description ?? item.type ?? "pattern finding",
          severity: item.severity ?? "info",
          confidence: item.confidence ?? null,
          evidence: item.evidence ?? [],
          location: item.location?.file ? `${item.location.file}:${item.location.line ?? "?"}` : null,
        })),
      })
      return textResult(`patterns (${result?.statistics?.totalFound ?? items.length}) recorded run ${recorded.report.run.id}: new=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}\n${lines.join("\n") || "  none"}`)
    }
    return textResult(`patterns (${result?.statistics?.totalFound ?? items.length}):\n${lines.join("\n") || "  none"}`)
  },

  bb_security: async (args, { projectId }) => {
    if (args.history === true) {
      const history = await getAnalysisHistory(projectId, "security", Number(args.limit ?? 20))
      return textResult(JSON.stringify(history, null, 2))
    }
    const result: any = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
    const findings = result?.findings ?? []
    const suspicious = result?.suspiciousSources ?? []
    const summary = result?.summary
    const head = summary
      ? `security: ${summary.critical} critical / ${summary.high} high / ${summary.medium} medium / ${summary.low} low (${summary.resolved} resolved flows, ${summary.unresolvedSources} unvalidated sources, ${summary.mitigated} mitigated)`
      : `security findings (${findings.length})`
    const lines = findings.slice(0, 20).map(
      (finding: any) => `  [${finding.severity}] ${finding.label ?? finding.type}${finding.symbol ? ` (${finding.symbol})` : ""} @ ${finding.file}:${finding.line ?? "?"}${finding.sinkType ? ` -> ${finding.sinkType}` : ""}${finding.mitigated ? " [mitigated]" : ""}`,
    )
    const sourceLines = suspicious.slice(0, 5).map(
      (source: any) => `  [info] unvalidated input${source.symbol ? ` ${source.symbol}` : ""} @ ${source.file}:${source.line ?? "?"} (no sink reached)`,
    )
    if (args.recordRun === true) {
      const findingCount = findings.length
      const recorded = await executeAnalysis({
        projectId,
        kind: "security",
        input: { options: args },
        persist: () => findings.map((finding: any): AnalysisFindingInput => ({
          fingerprint: finding.fingerprint ?? `${finding.file}:${finding.line ?? "?"}:${finding.label ?? finding.type}`,
          rule: finding.label ?? finding.type ?? "security",
          title: finding.label ?? finding.type ?? "security finding",
          severity: finding.severity ?? "medium",
          confidence: finding.confidence ?? null,
          evidence: finding.evidence ?? [],
          location: finding.file ? `${finding.file}:${finding.line ?? "?"}` : null,
          state: finding.mitigated ? "mitigated" : undefined,
        })),
      })
      return textResult(head + `\nrecorded run: ${recorded.report.run.id}\nnew=${recorded.report.newFindings} repeated=${recorded.report.repeatedFindings} resolved=${recorded.report.resolvedFindings}` + "\n" + `${findingCount} findings recorded` + (lines.length ? "\n" + lines.join("\n") : ""))
    }
    return textResult(head + "\n" + (lines.length ? lines.join("\n") : "  clean") + (sourceLines.length ? `\n\nunvalidated input sources:\n${sourceLines.join("\n")}` : ""))
  },

  bb_visualize: async (args, { projectId }) => {
    const request: VisualizationRequest = { scope: ["project", "file", "module", "symbol", "feature"].includes(String(args.scope)) ? args.scope : "project", target: args.target ? String(args.target) : undefined, format: ["text", "json", "html"].includes(String(args.format)) ? args.format : "text", maxNodes: args.maxNodes == null ? undefined : Number(args.maxNodes), maxLinks: args.maxLinks == null ? undefined : Number(args.maxLinks), relationshipTypes: Array.isArray(args.relationshipTypes) ? args.relationshipTypes.map(String) : undefined, languages: Array.isArray(args.languages) ? args.languages.map(String) : undefined }
    const result = await visualizeProject(projectId, request)
    return textResult(formatVisualization(result))
  },

  bb_migrate: async (args, { projectId }) => {
    const symbolNames = Array.isArray(args.symbolNames) ? args.symbolNames.map(String) : args.symbolName ? [String(args.symbolName)] : []
    if (!symbolNames.length || !args.targetLanguage) return textResult("bb_migrate requires symbolNames (or symbolName) and targetLanguage", true)
    const result = await generateMigrationPlans(projectId, { symbolNames, targetLanguage: String(args.targetLanguage) })
    return textResult(formatMigrationPlans(result, args.format === "json" ? "json" : "text"))
  },

  bb_doc: async (args, { projectId, projectPath }) => {
    const mode = String(args.mode ?? "") as DocRequest["mode"]
    if (!["symbol", "file", "module", "feature", "api", "project", "coverage"].includes(mode)) return textResult("bb_doc requires mode: symbol|file|module|feature|api|project|coverage", true)
    if (["symbol", "file", "module", "feature"].includes(mode) && !args.target) return textResult(`bb_doc ${mode} mode requires target`, true)
    const request: DocRequest = { mode, target: args.target ? String(args.target) : undefined, format: args.format === "json" ? "json" : "markdown", audience: args.audience, detail: args.detail, includeExamples: args.includeExamples === true, includeDiagrams: args.includeDiagrams === true, includeTests: args.includeTests === true, limit: args.limit == null ? undefined : Number(args.limit), maxTokens: args.maxTokens == null ? undefined : Number(args.maxTokens) }
    const result = await generateDocumentation(projectId, projectPath, request)
    return textResult(formatDocumentation(result, request.format))
  },

  bb_edit: async (args, { projectId, projectPath }) => {
    const request = args as EditRequest
    if (!(["write", "update", "insert", "delete", "refactor"] as const).includes(request.mode as any)) return textResult("bb_edit requires mode: write|update|insert|delete|refactor", true)
    const result = await executeEdit(projectPath, projectId, request)
    return textResult(JSON.stringify(result, null, 2))
  },

}

export function createToolHandlers(): Readonly<Record<string, ToolHandler>> {
  const registeredNames = new Set(TOOL_DESCRIPTORS.map((descriptor) => descriptor.name))
  for (const name of registeredNames) if (!handlers[name]) throw new Error(`missing handler for registered tool: ${name}`)
  for (const name of Object.keys(handlers)) if (!registeredNames.has(name)) throw new Error(`handler has no registered tool: ${name}`)
  return handlers
}
