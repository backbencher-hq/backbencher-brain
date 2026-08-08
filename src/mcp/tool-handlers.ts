import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../brain/database"
import { BrainTools, PatternBrainTools } from "../ast/tools"
import { ASTEngine } from "../ast/engine"
import { checkResultsFreshness } from "../brain/freshness"
import { BrainSurgicalPatcher } from "../ast/brain-surgical-patcher"
import { ImportPruner } from "../ast/import-pruner"
import { CrossLanguageSecurityAnalysis } from "../security/cross-language-security"
import { DependencyGraphVisualizer } from "../ast/dependency-graph-visualizer"
import { CrossLanguageIntelligence } from "../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../ast/cross-language-migration-assistant"
import { indexProjectParallel, reindexFilesParallel, wipeProjectData } from "../ast/parallel-indexer"
import { TOOL_DESCRIPTORS } from "./tool-registry"
import { testQuality } from "../intelligence/testing/quality"
import { testSuggestions } from "../intelligence/testing/suggestions"
import { executeEdit, type EditRequest } from "../intelligence/edit/edit-engine"
import { getUnifiedHealth, formatUnifiedHealth } from "../intelligence/health/health-provider"
import { getAnalysisHistory, startAnalysisRun, completeAnalysisRun, failAnalysisRun } from "../intelligence/analysis/run-history"
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
    const lines = results.map((result: any) => {
      const stale = result.stale ? " [STALE]" : ""
      const snippet = result.snippet && result.snippet !== result.symbolName
        ? `\n    ${String(result.snippet).split("\n").slice(0, 8).join("\n    ")}`
        : ""
      return `${result.symbolName} [${result.symbolType}] ${result.file}:${result.line} (${result.language})${stale}${snippet}`
    })
    return textResult(lines.length ? lines.join("\n") : `no results for "${query}"`)
  },

  bb_select: async (args, { projectId }) => {
    const found = await ASTEngine.findSymbol(
      projectId,
      String(args.symbolName),
      args.filePath ? String(args.filePath) : undefined,
      args.lineStart ? Number(args.lineStart) : undefined,
    )
    const match = found?.matches?.[0]
    if (!match) return textResult(`symbol "${args.symbolName}" not found`)
    const snippet = await readSnippet(match.fileId, match.lineStart)
    const text = [
      `name: ${match.name}`,
      `type: ${match.symbolType ?? "unknown"}`,
      `file: ${match.fileId}`,
      `line: ${match.lineStart}`,
      match.byteStart != null ? `bytes: ${match.byteStart}-${match.byteEnd}` : null,
      snippet ? `\n${snippet}` : null,
    ].filter(Boolean).join("\n")
    return textResult(text)
  },

  bb_relationships: async (args, { projectId }) => {
    const target = String(args.target)
    const direction = args.direction === "callees" ? "callees" : "callers"
    const limit = Number(args.limit ?? 15)
    const includeIndirect = args.includeIndirect === true
    const maxDepth = Number(args.maxDepth ?? 3)
    const results = direction === "callers"
      ? await BrainTools.getFunctionCallers(projectId, target, { includeIndirect, maxDepth })
      : await BrainTools.getFunctionCallees(projectId, target, { includeIndirect, maxDepth })
    const lines = (results.slice(0, limit) as any[]).map(
      (result: any) => `${result.name} — ${result.relativePath ?? result.filePath ?? "?"}:${result.range?.startLine ?? "?"}`,
    )
    return textResult(lines.length
      ? `${direction} of ${target} (${results.length} total${includeIndirect ? ", indirect" : ""}):\n${lines.join("\n")}`
      : `no ${direction} found for ${target}`)
  },

  bb_ask: async (args, { projectId }) => {
    const result: any = await BrainTools.quickAnswer(projectId, String(args.query))
    const lines = ((result?.sources ?? []) as any[])
      .slice(0, Number(args.limit ?? 5))
      .map((source: any, index: number) => `${index + 1}. ${source.file}:${source.line}\n   ${source.context ?? ""}`)
    const head = result?.answer ? `answer: ${result.answer}\n\n` : ""
    return textResult(head + (lines.length ? lines.join("\n") : `no semantic matches for "${args.query}"`))
  },

  bb_health: async (args, { projectId, projectPath }) => {
    const report = await getUnifiedHealth(projectId, projectPath, { refresh: args.refresh === true, force: args.force === true, wait: args.wait !== false, freshness: args.freshness === "complete" ? "complete" : "sampled", sampleSize: args.sampleSize != null ? Number(args.sampleSize) : undefined, integrity: args.integrity === true, includeAnalysisRuns: args.includeAnalysisRuns === true })
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
      const result: any = await PatternBrainTools.findOrphanedCode(projectId, {})
      const items = (result?.orphaned ?? []).slice(0, limit)
      const lines = items.map((item: any) => `  ${item.type} ${item.name} — ${item.location} (${Math.round(item.confidence * 100)}%)`)
      return textResult(`orphaned code (${result?.statistics?.totalOrphaned ?? items.length}):\n${lines.join("\n") || "  none"}`)
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
      const run = await startAnalysisRun({ projectId, kind: "patterns", input: { options: args } })
      try {
        const persisted = await completeAnalysisRun(projectId, run.id, items.map((item: any): AnalysisFindingInput => ({
          fingerprint: item.fingerprint ?? `${item.type}:${item.location?.file ?? "?"}:${item.location?.line ?? "?"}`,
          rule: item.type ?? "pattern",
          title: item.description ?? item.type ?? "pattern finding",
          severity: item.severity ?? "info",
          confidence: item.confidence ?? null,
          evidence: item.evidence ?? [],
          location: item.location?.file ? `${item.location.file}:${item.location.line ?? "?"}` : null,
        })))
        return textResult(`patterns (${result?.statistics?.totalFound ?? items.length}) recorded run ${persisted.run.id}: new=${persisted.newFindings} repeated=${persisted.repeatedFindings} resolved=${persisted.resolvedFindings}\n${lines.join("\n") || "  none"}`)
      } catch (error) {
        await failAnalysisRun(projectId, run.id, error)
        throw error
      }
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
      const run = await startAnalysisRun({ projectId, kind: "security", input: { options: args } })
      try {
        const persisted = await completeAnalysisRun(projectId, run.id, findings.map((finding: any): AnalysisFindingInput => ({
          fingerprint: finding.fingerprint ?? `${finding.file}:${finding.line ?? "?"}:${finding.label ?? finding.type}`,
          rule: finding.label ?? finding.type ?? "security",
          title: finding.label ?? finding.type ?? "security finding",
          severity: finding.severity ?? "medium",
          confidence: finding.confidence ?? null,
          evidence: finding.evidence ?? [],
          location: finding.file ? `${finding.file}:${finding.line ?? "?"}` : null,
          state: finding.mitigated ? "mitigated" : undefined,
        })))
        return textResult(head + `\nrecorded run: ${persisted.run.id}\nnew=${persisted.newFindings} repeated=${persisted.repeatedFindings} resolved=${persisted.resolvedFindings}` + "\n" + (lines.length ? lines.join("\n") : "  clean") + (sourceLines.length ? `\n\nunvalidated input sources:\n${sourceLines.join("\n")}` : ""))
      } catch (error) {
        await failAnalysisRun(projectId, run.id, error)
        throw error
      }
    }
    return textResult(head + "\n" + (lines.length ? lines.join("\n") : "  clean") + (sourceLines.length ? `\n\nunvalidated input sources:\n${sourceLines.join("\n")}` : ""))
  },

  bb_visualize: async (args, { projectId }) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const maxNodes = Number(args.maxNodes ?? 200)
    const format = String(args.format ?? "text")
    const symbols = raw.prepare("SELECT s.id, s.name, s.symbol_type, f.language, f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON s.file_id = f.id WHERE s.project_id = ? AND COALESCE(s.line_start,0) > 0 LIMIT ?").all(projectId, maxNodes) as any[]
    const relationships = raw.prepare("SELECT source_symbol_id AS source_id, target_symbol_id AS target_id, relationship_type AS type FROM brain_relationship WHERE project_id = ? AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL LIMIT 5000").all(projectId) as any[]
    const graph = DependencyGraphVisualizer.generateGraphData(symbols, relationships)
    if (format === "json") return textResult(JSON.stringify(graph, null, 2).slice(0, 40000))
    if (format === "html") return textResult(DependencyGraphVisualizer.generateHTML(graph))
    const degree = new Map<string, number>()
    for (const link of graph.links) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1)
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1)
    }
    const lines = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, count]) => {
      const node = graph.nodes.find((candidate: any) => candidate.id === id)
      return `  ${node?.name ?? id} (${count} edges)`
    })
    return textResult(`graph: ${graph.nodes.length} nodes, ${graph.links.length} links\nmost connected:\n${lines.join("\n") || "  none"}`)
  },

  bb_migrate: async (args, { projectId }) => {
    const analysis = await CrossLanguageIntelligence.analyzePolyglotProjectFromDB(projectId)
    const plan: any = await CrossLanguageMigrationAssistant.generateMigrationPlan(String(args.symbolName), String(args.targetLanguage), analysis)
    if (!plan) return textResult(`no migration plan for ${args.symbolName} -> ${args.targetLanguage}`)
    const dependencies = (plan.dependencies ?? []).map((dependency: any) => `  ${dependency.source} -> ${dependency.target} (${Math.round((dependency.confidence ?? 0) * 100)}%)`).join("\n")
    return textResult(`migrate ${plan.componentName}: ${plan.sourceLanguage} -> ${plan.targetLanguage}\neffort: ${plan.effortEstimateHours}h | complexity: ${plan.complexityScore}/10 | risk: ${plan.riskAssessment?.level}\n${dependencies ? `dependencies:\n${dependencies}` : ""}`)
  },

  bb_refresh: async (args, { projectId, projectPath }) => {
    const report = await getUnifiedHealth(projectId, projectPath, { refresh: true, force: args.force === true, wait: args.wait !== false, freshness: args.freshness === "complete" ? "complete" : "sampled" })
    return textResult(formatUnifiedHealth(report))
  },

  bb_edit: async (args, { projectId, projectPath }) => {
    const request = args as EditRequest
    if (!(["write", "update", "insert", "delete", "refactor"] as const).includes(request.mode as any)) return textResult("bb_edit requires mode: write|update|insert|delete|refactor", true)
    const result = await executeEdit(projectPath, projectId, request)
    return textResult(JSON.stringify(result, null, 2))
  },

  bb_write: async (args, context) => {
    const result = await executeEdit(context.projectPath, context.projectId, { mode: "write", filePath: String(args.filePath), content: String(args.content ?? ""), dryRun: args.dryRun === true, format: args.format !== false })
    return textResult(result.dryRun ? JSON.stringify(result, null, 2) : `written ${args.filePath} (validated, indexed)`)
  },

  bb_update: async (args, context) => {
    const result = await executeEdit(context.projectPath, context.projectId, { mode: "update", symbolName: String(args.symbolName), newContent: String(args.newContent ?? ""), filePath: args.filePath ? String(args.filePath) : undefined, lineStart: args.lineStart ? Number(args.lineStart) : undefined, dryRun: args.dryRun === true, allowStaleIndex: true })
    return textResult(result.dryRun ? JSON.stringify(result, null, 2) : `updated ${args.symbolName} (validated, reindexed)`)
  },

  bb_insert: async (args, context) => {
    const result = await executeEdit(context.projectPath, context.projectId, { mode: "insert", targetSymbolName: String(args.targetSymbolName), newContent: String(args.newContent ?? ""), filePath: args.filePath ? String(args.filePath) : undefined, lineStart: args.lineStart ? Number(args.lineStart) : undefined, position: args.position, dryRun: args.dryRun === true, allowStaleIndex: true })
    return textResult(result.dryRun ? JSON.stringify(result, null, 2) : `inserted ${args.position ?? "after"} ${args.targetSymbolName} (validated, reindexed)`)
  },

  bb_delete: async (args, context) => {
    const result = await executeEdit(context.projectPath, context.projectId, { mode: "delete", symbolName: String(args.symbolName), filePath: args.filePath ? String(args.filePath) : undefined, lineStart: args.lineStart ? Number(args.lineStart) : undefined, force: args.force === true, dryRun: args.dryRun === true, allowStaleIndex: true })
    return textResult(result.dryRun ? JSON.stringify(result, null, 2) : `deleted ${args.symbolName} (validated, reindexed)`)
  },

  bb_refactor: async (args, context) => {
    const result = await executeEdit(context.projectPath, context.projectId, { mode: "refactor", symbolName: String(args.symbolName), newName: String(args.newName), filePath: args.filePath ? String(args.filePath) : undefined, lineStart: args.lineStart ? Number(args.lineStart) : undefined, dryRun: args.dryRun === true, allowStaleIndex: true })
    return textResult(result.dryRun ? JSON.stringify(result, null, 2) : `renamed ${args.symbolName} -> ${args.newName} (identifier tokens only, validated, reindexed)`)
  },
  bb_test_quality: async (args, { projectId }) => {
    const report = await testQuality(projectId, { maxFiles: args.maxFiles != null ? Number(args.maxFiles) : undefined })
    return textResult(JSON.stringify(report, null, 2))
  },
  bb_test_suggestions: async (args, { projectId }) => {
    const raw = args.changed
    if (!Array.isArray(raw) || raw.length === 0) return textResult("error: 'changed' must be a non-empty array of {name,file,kind}", true)
    const changed = raw.map((c: any) => ({ name: String(c.name), file: String(c.file), kind: (c.kind === "added" || c.kind === "deleted" ? c.kind : "modified") as "added" | "modified" | "deleted" }))
    const report = await testSuggestions(projectId, changed)
    return textResult(JSON.stringify(report, null, 2))
  },
}

export function createToolHandlers(): Readonly<Record<string, ToolHandler>> {
  const registeredNames = new Set(TOOL_DESCRIPTORS.map((descriptor) => descriptor.name))
  for (const name of registeredNames) if (!handlers[name]) throw new Error(`missing handler for registered tool: ${name}`)
  for (const name of Object.keys(handlers)) if (!registeredNames.has(name)) throw new Error(`handler has no registered tool: ${name}`)
  return handlers
}
