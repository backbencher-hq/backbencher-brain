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

  bb_health: async (args, { projectId }) => {
    const raw = await BrainDatabase.getRawInstance(projectId)
    const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c
    const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
    const relationships = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c
    const embeddings = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any).c
    const fileRows = raw.prepare("SELECT id FROM brain_file LIMIT 200").all() as any[]
    const freshness = checkResultsFreshness(raw, fileRows.map((row: any) => ({ fileId: row.id })))
    let fresh = 0
    let stale = 0
    for (const status of freshness.values()) status === "fresh" ? fresh++ : stale++
    let text = `files=${files} symbols=${symbols} relationships=${relationships} embeddings=${embeddings}\nfreshness: ${fresh} fresh / ${stale} stale (sampled ${fileRows.length})`
    if (args.verbose === true) {
      try {
        const languages = raw.prepare("SELECT language, COUNT(*) c FROM brain_file WHERE project_id = ? GROUP BY language ORDER BY c DESC LIMIT 10").all(projectId) as any[]
        text += "\n\nlanguages:\n" + languages.map((language: any) => `  ${language.language ?? "unknown"}: ${language.c}`).join("\n")
        const models = raw.prepare("SELECT embedding_model, COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ? GROUP BY embedding_model").all(projectId) as any[]
        text += "\n\nembedding models:\n" + (models.length ? models.map((model: any) => `  ${model.embedding_model}: ${model.c}`).join("\n") : "  none")
        const staleFiles: string[] = []
        for (const row of fileRows) {
          if (freshness.get(row.id) !== "fresh") {
            const file = raw.prepare("SELECT relative_path FROM brain_file WHERE id = ?").get(row.id) as any
            if (file?.relative_path) staleFiles.push(file.relative_path)
          }
        }
        text += `\n\nstale files (${staleFiles.length}):\n` + (staleFiles.slice(0, 20).map((file) => `  ${file}`).join("\n") || "  none")
      } catch {}
    }
    return textResult(text)
  },

  bb_patterns: async (args, { projectId }) => {
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
    return textResult(`patterns (${result?.statistics?.totalFound ?? items.length}):\n${lines.join("\n") || "  none"}`)
  },

  bb_security: async (_args, { projectId }) => {
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
    if (args.force === true) wipeProjectData(await BrainDatabase.getRawInstance(projectId))
    const stats: any = await indexProjectParallel(projectId, projectPath, {})
    const raw = await BrainDatabase.getRawInstance(projectId)
    const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
    return textResult(`reindexed: ${stats.totalFiles} files processed, ${symbols} symbols total${args.force === true ? " (forced, in-place)" : ""}`)
  },

  bb_write: async (args, { projectId, projectPath }) => {
    const absolutePath = resolveProjectPath(projectPath, String(args.filePath))
    ensureWithinProject(projectPath, absolutePath)
    writeFileSync(absolutePath, String(args.content ?? ""), "utf8")
    await BrainSurgicalPatcher.tryAutoFormat(absolutePath).catch(() => {})
    await autoRefreshFile(projectId, projectPath, absolutePath, "added")
    return textResult(`written ${args.filePath} (indexed)`)
  },

  bb_update: async (args, { projectId, projectPath }) => {
    const found = await ASTEngine.findSymbol(projectId, String(args.symbolName), args.filePath ? String(args.filePath) : undefined)
    const match = found?.matches?.[0]
    if (!match || match.byteStart == null || match.byteEnd == null) return textResult(`symbol ${args.symbolName} not found or has no byte bounds`, true)
    await BrainSurgicalPatcher.patch(match.fileId, match.byteStart, match.byteEnd, String(args.newContent), false, true)
    await autoRefreshFile(projectId, projectPath, match.fileId)
    return textResult(`updated ${args.symbolName} in ${match.fileId} (bytes ${match.byteStart}-${match.byteEnd}, reindexed)`)
  },

  bb_insert: async (args, { projectId, projectPath }) => {
    const found = await ASTEngine.findSymbol(projectId, String(args.targetSymbolName), args.filePath ? String(args.filePath) : undefined)
    const match = found?.matches?.[0]
    if (!match || match.byteStart == null || match.byteEnd == null) return textResult(`anchor ${args.targetSymbolName} not found`, true)
    const text = readFileSync(match.fileId, "utf8")
    const content = String(args.newContent)
    const position = String(args.position ?? "after")
    let offset = -1
    if (position === "before") offset = match.byteStart
    else if (position === "after") offset = match.byteEnd
    else if (position === "inside-top" || position === "inside-bottom") {
      const open = text.indexOf("{", match.byteStart)
      const close = text.lastIndexOf("}", Math.min(match.byteEnd, text.length))
      if (open === -1 || close === -1 || close < open) return textResult(`cannot find braces for inside insertion in ${args.targetSymbolName}`, true)
      offset = position === "inside-top" ? open + 1 : close
    }
    await BrainSurgicalPatcher.patch(match.fileId, offset, offset, `\n${content}\n`, false, true)
    await autoRefreshFile(projectId, projectPath, match.fileId)
    return textResult(`inserted ${position} ${args.targetSymbolName} in ${match.fileId} (reindexed)`)
  },

  bb_delete: async (args, { projectId, projectPath }) => {
    const found = await ASTEngine.findSymbol(projectId, String(args.symbolName), args.filePath ? String(args.filePath) : undefined)
    const match = found?.matches?.[0]
    if (!match || match.byteStart == null || match.byteEnd == null) return textResult(`symbol ${args.symbolName} not found`, true)
    await BrainSurgicalPatcher.patch(match.fileId, match.byteStart, match.byteEnd, "", true, false)
    const after = readFileSync(match.fileId, "utf8")
    const pruned = await ImportPruner.prune(after, match.fileId)
    if (pruned !== after) writeFileSync(match.fileId, pruned, "utf8")
    await BrainSurgicalPatcher.tryAutoFormat(match.fileId).catch(() => {})
    await autoRefreshFile(projectId, projectPath, match.fileId)
    return textResult(`deleted ${args.symbolName} from ${match.fileId} (reindexed)`)
  },

  bb_refactor: async (args, { projectId, projectPath }) => {
    const found = await ASTEngine.findSymbol(projectId, String(args.symbolName), args.filePath ? String(args.filePath) : undefined)
    const match = found?.matches?.[0]
    const newName = String(args.newName)
    if (!match || match.byteStart == null || match.byteEnd == null) return textResult(`symbol ${args.symbolName} not found`, true)
    const text = readFileSync(match.fileId, "utf8")
    const nameOffset = text.indexOf(String(args.symbolName), match.byteStart)
    if (nameOffset === -1 || nameOffset >= match.byteEnd) return textResult(`could not locate the ${args.symbolName} identifier token`, true)
    await BrainSurgicalPatcher.patch(match.fileId, nameOffset, nameOffset + String(args.symbolName).length, newName, false, true)
    const raw = await BrainDatabase.getRawInstance(projectId)
    const callers = raw.prepare(`SELECT s.file_id, s.byte_start, s.byte_end FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id WHERE r.target_symbol_id = ? AND r.relationship_type = 'calls'`).all(match.id) as any[]
    const seen = new Set<string>()
    for (const caller of callers) {
      const key = `${caller.file_id}:${caller.byte_start}`
      if (seen.has(key)) continue
      seen.add(key)
      if (caller.byte_start == null) continue
      const callerText = readFileSync(caller.file_id, "utf8")
      const body = callerText.slice(caller.byte_start, caller.byte_end ?? callerText.length)
      const expression = new RegExp(`\\b${String(args.symbolName)}\\b`, "g")
      let occurrence: RegExpExecArray | null
      let delta = 0
      while ((occurrence = expression.exec(body)) !== null) {
        const start = caller.byte_start + occurrence.index + delta
        await BrainSurgicalPatcher.patch(caller.file_id, start, start + String(args.symbolName).length, newName, false, false)
        delta += newName.length - String(args.symbolName).length
      }
    }
    const changedFiles = new Set<string>([match.fileId])
    for (const caller of callers) if (caller.file_id) changedFiles.add(caller.file_id)
    for (const file of changedFiles) await autoRefreshFile(projectId, projectPath, file)
    return textResult(`renamed ${args.symbolName} -> ${newName} (declaration + ${seen.size} caller files, reindexed)`)
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
