// Universal MCP server on brain-core. Stdio transport, read-only tools.
// Mutation tools are intentionally excluded — MCP has no permission system
// like opencode's ctx.ask.
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { BrainDatabase } from "../brain/database"
import { BrainTools, AdvancedBrainTools, PatternBrainTools } from "../ast/tools"
import { ASTEngine } from "../ast/engine"
import { checkResultsFreshness } from "../brain/freshness"
import { getProjectId } from "../cli/index"
import { BrainSurgicalPatcher } from "../ast/brain-surgical-patcher"
import { ImportPruner } from "../ast/import-pruner"
import { CrossLanguageSecurityAnalysis } from "../security/cross-language-security"
import { DependencyGraphVisualizer } from "../ast/dependency-graph-visualizer"
import { CrossLanguageIntelligence } from "../ast/cross-language-intelligence"
import { CrossLanguageMigrationAssistant } from "../ast/cross-language-migration-assistant"
import { indexProjectParallel, wipeProjectData, reindexFilesParallel } from "../ast/parallel-indexer"
import { existsSync, readFileSync, writeFileSync } from "fs"

interface ToolContext {
  projectPath: string
  projectId: string
}

const TOOLS = [
  {
    name: "bb_search",
    description:
      "Search the AST index for symbols (functions, classes, variables). Exact/prefix/substring ranked, with optional regex, symbol-kind and language filters, code snippets, pagination, and a stale flag when the file changed since indexing.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "symbol name or fragment (regex when regex=true)" },
        limit: { type: "number", description: "max results (default 15)" },
        language: { type: "string", description: "filter by language (e.g. typescript, python, go)" },
        symbolKind: { type: "string", description: "filter by symbol kind (function, class, variable, interface, enum, ...)" },
        includeContent: { type: "boolean", description: "include a code snippet per result (default false)" },
        exact: { type: "boolean", description: "only exact name matches (default false)" },
        caseSensitive: { type: "boolean", description: "case-sensitive matching (default false)" },
        regex: { type: "boolean", description: "treat query as a regex against symbol names (default false)" },
        offset: { type: "number", description: "pagination offset (default 0)" },
      },
      required: ["query"],
    },
  },
  {
    name: "bb_select",
    description:
      "Extract a symbol's exact source by name. Optional filePath / lineStart disambiguate when the name exists in multiple files. Returns the exact code with byte bounds.",
    inputSchema: {
      type: "object",
      properties: {
        symbolName: { type: "string", description: "exact symbol name" },
        filePath: { type: "string", description: "partial or exact file path to disambiguate" },
        lineStart: { type: "number", description: "line where the symbol starts (disambiguates overloads)" },
      },
      required: ["symbolName"],
    },
  },
  {
    name: "bb_relationships",
    description:
      "Find who calls a symbol (callers) or what it calls (callees). Direct by default; set includeIndirect for transitive traversal up to maxDepth. Cross-language aware.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "symbol name" },
        direction: { type: "string", enum: ["callers", "callees"], description: "direction (default callers)" },
        includeIndirect: { type: "boolean", description: "traverse transitively (default false)" },
        maxDepth: { type: "number", description: "max traversal depth when includeIndirect (default 3)" },
        limit: { type: "number", description: "max results (default 15)" },
      },
      required: ["target"],
    },
  },
  {
    name: "bb_ask",
    description:
      "Answer a question about the codebase using semantic search over the index. Returns matched symbols with similarity scores.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "natural-language question" },
        limit: { type: "number", description: "max results (default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "bb_health",
    description: "Index health: file/symbol/relationship counts, embedding model + coverage, and file freshness. Set verbose=true for per-language breakdown and stale-file names.",
    inputSchema: {
      type: "object",
      properties: {
        verbose: { type: "boolean", description: "include per-language counts and stale file names (default false)" },
      },
    },
  },
  {
    name: "bb_patterns",
    description:
      "Detect orphaned code, framework patterns, anti-patterns, and architecture issues. Use scope=orphaned for dead code; scope=all (default) for the full pattern scan with the optional pattern/confidence filters.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["orphaned", "all"], description: "orphaned only, or all pattern classes (default all)" },
        limit: { type: "number", description: "max results (default 20)" },
        includeOrphaned: { type: "boolean", description: "include orphaned-code patterns in an 'all' scan (default true)" },
        includeFramework: { type: "boolean", description: "include framework patterns (default true)" },
        includeAntiPatterns: { type: "boolean", description: "include anti-patterns (default true)" },
        confidenceThreshold: { type: "number", description: "minimum confidence 0..1 (default 0.6)" },
      },
    },
  },
  {
    name: "bb_security",
    description: "Cross-language security scan: SQL injection, XSS, command injection, hardcoded secrets, weak crypto.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "bb_visualize",
    description:
      "Dependency graph summary: node/link counts and the most-connected symbols, built with the real graph engine. Use format=json for machine-readable nodes+links, format=html for a self-contained 3D interactive map.",
    inputSchema: {
      type: "object",
      properties: {
        maxNodes: { type: "number", description: "max nodes (default 200)" },
        format: { type: "string", enum: ["text", "json", "html"], description: "output format (default text)" },
      },
    },
  },
  {
    name: "bb_migrate",
    description: "Migration plan for porting a symbol to another language (library equivalents, effort, risk). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        symbolName: { type: "string", description: "symbol to migrate" },
        targetLanguage: { type: "string", description: "e.g. rust, go, python" },
      },
      required: ["symbolName", "targetLanguage"],
    },
  },
  {
    name: "bb_refresh",
    description: "Re-index the project (incremental by default; use force to rebuild from scratch).",
    inputSchema: {
      type: "object",
      properties: {
        force: { type: "boolean", description: "wipe and rebuild (default false)" },
      },
    },
  },
  {
    name: "bb_write",
    description: "Create a new file with the given content (overwrites if it exists).",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "path relative to the project root" },
        content: { type: "string", description: "file content" },
      },
      required: ["filePath", "content"],
    },
  },
  {
    name: "bb_update",
    description: "Replace a symbol's exact source with new content (byte-precise).",
    inputSchema: {
      type: "object",
      properties: {
        symbolName: { type: "string", description: "symbol to replace" },
        newContent: { type: "string", description: "replacement source" },
        filePath: { type: "string", description: "disambiguate when the name exists in multiple files" },
      },
      required: ["symbolName", "newContent"],
    },
  },
  {
    name: "bb_insert",
    description: "Insert code relative to an anchor symbol (before, after, inside-top, inside-bottom).",
    inputSchema: {
      type: "object",
      properties: {
        targetSymbolName: { type: "string", description: "anchor symbol" },
        position: { type: "string", enum: ["before", "after", "inside-top", "inside-bottom"], description: "insertion position" },
        newContent: { type: "string", description: "code to insert" },
        filePath: { type: "string", description: "disambiguate the anchor" },
      },
      required: ["targetSymbolName", "position", "newContent"],
    },
  },
  {
    name: "bb_delete",
    description: "Delete a symbol's exact source and prune now-unused imports.",
    inputSchema: {
      type: "object",
      properties: {
        symbolName: { type: "string", description: "symbol to delete" },
        filePath: { type: "string", description: "disambiguate the symbol" },
      },
      required: ["symbolName"],
    },
  },
  {
    name: "bb_refactor",
    description: "Rename a symbol across the codebase: declaration plus all caller sites.",
    inputSchema: {
      type: "object",
      properties: {
        symbolName: { type: "string", description: "current name" },
        newName: { type: "string", description: "new name" },
        filePath: { type: "string", description: "disambiguate the declaration" },
      },
      required: ["symbolName", "newName"],
    },
  },
]

/**
 * Reindex a single file in place after a mutation so the index stays current
 * (no manual bb_refresh, no stale byte offsets, no server restart needed).
 */
async function autoRefreshFile(projectId: string, projectPath: string, absPath: string, type: "added" | "modified" = "modified"): Promise<void> {
  try {
    await reindexFilesParallel(projectId as any, projectPath, [{ path: absPath, type }])
  } catch {}
}

async function ensureIndexed(ctx: ToolContext): Promise<string | null> {
  try {
    const raw = await BrainDatabase.getRawInstance(ctx.projectId)
    const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c ?? 0
    if (files === 0) {
      return `No index found for ${ctx.projectPath}. Run: bb index "${ctx.projectPath}" (or restart bb mcp after indexing).`
    }
    return null
  } catch {
    return `No index found for ${ctx.projectPath}. Run: bb index "${ctx.projectPath}".`
  }
}

export async function startMcpServer(projectPath: string): Promise<void> {
  const projectId = getProjectId(projectPath)
  const ctx: ToolContext = { projectPath, projectId }

  const server = new Server(
    { name: "backbencher-brain", version: "0.3.0" },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    const args = (request.params.arguments ?? {}) as Record<string, any>
    try {
      if (name !== "bb_health") {
        const notIndexed = await ensureIndexed(ctx)
        if (notIndexed) {
          return { content: [{ type: "text", text: notIndexed }] }
        }
      }
      if (name === "bb_search") {
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
        const lines = results.map((r: any) => {
          const stale = r.stale ? " [STALE]" : ""
          const snippet = r.snippet && r.snippet !== r.symbolName ? `\n    ${String(r.snippet).split("\n").slice(0, 8).join("\n    ")}` : ""
          return `${r.symbolName} [${r.symbolType}] ${r.file}:${r.line} (${r.language})${stale}${snippet}`
        })
        return {
          content: [{ type: "text", text: lines.length ? lines.join("\n") : `no results for "${query}"` }],
        }
      }

      if (name === "bb_select") {
        const found = await ASTEngine.findSymbol(
          projectId,
          String(args.symbolName),
          args.filePath ? String(args.filePath) : undefined,
          args.lineStart ? Number(args.lineStart) : undefined,
        )
        const match = found?.matches?.[0]
        if (!match) {
          return { content: [{ type: "text", text: `symbol "${args.symbolName}" not found` }] }
        }
        const snippet = await readSnippet(match.fileId, match.lineStart, match.byteEnd)
        const text = [
          `name: ${match.name}`,
          `type: ${match.symbolType ?? "unknown"}`,
          `file: ${match.fileId}`,
          `line: ${match.lineStart}`,
          match.byteStart != null ? `bytes: ${match.byteStart}-${match.byteEnd}` : null,
          snippet ? `\n${snippet}` : null,
        ]
          .filter(Boolean)
          .join("\n")
        return { content: [{ type: "text", text }] }
      }

      if (name === "bb_relationships") {
        const target = String(args.target)
        const direction = args.direction === "callees" ? "callees" : "callers"
        const limit = Number(args.limit ?? 15)
        const includeIndirect = args.includeIndirect === true
        const maxDepth = Number(args.maxDepth ?? 3)
        const results =
          direction === "callers"
            ? await BrainTools.getFunctionCallers(projectId, target, { includeIndirect, maxDepth })
            : await BrainTools.getFunctionCallees(projectId, target, { includeIndirect, maxDepth })
        const lines = (results.slice(0, limit) as any[]).map(
          (r: any) => `${r.name} — ${r.relativePath ?? r.filePath ?? "?"}:${r.range?.startLine ?? "?"}`,
        )
        return {
          content: [
            {
              type: "text",
              text: lines.length ? `${direction} of ${target} (${results.length} total${includeIndirect ? ", indirect" : ""}):\n` + lines.join("\n") : `no ${direction} found for ${target}`,
            },
          ],
        }
      }

      if (name === "bb_ask") {
        const qa: any = await BrainTools.quickAnswer(projectId, String(args.query))
        const sources = (qa?.sources ?? []) as any[]
        const lines = sources
          .slice(0, Number(args.limit ?? 5))
          .map((s: any, i: number) => `${i + 1}. ${s.file}:${s.line}\n   ${s.context ?? ""}`)
        const head = qa?.answer ? `answer: ${qa.answer}\n\n` : ""
        return {
          content: [
            {
              type: "text",
              text: head + (lines.length ? lines.join("\n") : `no semantic matches for "${args.query}"`),
            },
          ],
        }
      }

      if (name === "bb_health") {
        const raw = await BrainDatabase.getRawInstance(projectId)
        const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c
        const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
        const rels = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c
        const emb = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any).c
        const fileRows = raw.prepare("SELECT id FROM brain_file LIMIT 200").all() as any[]
        const freshness = checkResultsFreshness(raw, fileRows.map((r: any) => ({ fileId: r.id })))
        let fresh = 0
        let stale = 0
        for (const s of freshness.values()) {
          if (s === "fresh") fresh++
          else stale++
        }
        let text = `files=${files} symbols=${symbols} relationships=${rels} embeddings=${emb}\nfreshness: ${fresh} fresh / ${stale} stale (sampled ${fileRows.length})`
        if (args.verbose === true) {
          try {
            const langs = raw.prepare("SELECT language, COUNT(*) c FROM brain_file WHERE project_id = ? GROUP BY language ORDER BY c DESC LIMIT 10").all(projectId) as any[]
            text += "\n\nlanguages:\n" + langs.map((l: any) => `  ${l.language ?? "unknown"}: ${l.c}`).join("\n")
            const embModels = raw.prepare("SELECT embedding_model, COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ? GROUP BY embedding_model").all(projectId) as any[]
            text += "\n\nembedding models:\n" + (embModels.length ? embModels.map((m: any) => `  ${m.embedding_model}: ${m.c}`).join("\n") : "  none")
            const staleFiles: string[] = []
            for (const r of fileRows) {
              if (freshness.get(r.id) !== "fresh") {
                const f = raw.prepare("SELECT relative_path FROM brain_file WHERE id = ?").get(r.id) as any
                if (f?.relative_path) staleFiles.push(f.relative_path)
              }
            }
            text += "\n\nstale files (" + staleFiles.length + "):\n" + (staleFiles.slice(0, 20).map((f) => `  ${f}`).join("\n") || "  none")
          } catch {}
        }
        return { content: [{ type: "text", text }] }
      }
      if (name === "bb_patterns") {
        const scope = args.scope === "orphaned" ? "orphaned" : "all"
        const limit = Number(args.limit ?? 20)
        if (scope === "orphaned") {
          const res: any = await PatternBrainTools.findOrphanedCode(projectId, {})
          const items = (res?.orphaned ?? []).slice(0, limit)
          const lines = items.map((o: any) => `  ${o.type} ${o.name} — ${o.location} (${Math.round(o.confidence * 100)}%)`)
          return { content: [{ type: "text", text: `orphaned code (${res?.statistics?.totalOrphaned ?? items.length}):\n` + (lines.join("\n") || "  none") }] }
        }
        const res: any = await PatternBrainTools.detectPatterns(projectId, {
          includeOrphaned: args.includeOrphaned !== false,
          includeFramework: args.includeFramework !== false,
          includeAntiPatterns: args.includeAntiPatterns !== false,
          confidenceThreshold: Number(args.confidenceThreshold ?? 0.6),
          maxResults: Math.max(limit, 100),
        })
        const items = (res?.patterns ?? []).slice(0, limit)
        const lines = items.map((p: any) => `  [${p.severity}] ${p.type} @ ${p.location?.file}:${p.location?.line} (${Math.round(p.confidence * 100)}%)`)
        return { content: [{ type: "text", text: `patterns (${res?.statistics?.totalFound ?? items.length}):\n` + (lines.join("\n") || "  none") }] }
      }

      if (name === "bb_security") {
        const res: any = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId)
        const vulns = res?.cross_language_vulnerabilities ?? res?.findings ?? []
        const lines = vulns.slice(0, 20).map((v: any) => `  [${v.severity ?? "?"}] ${v.type} @ ${v.file ?? v.attack_flow?.entry_point?.file ?? "?"}:${v.line ?? v.attack_flow?.entry_point?.line ?? "?"}`)
        return { content: [{ type: "text", text: `security findings (${vulns.length}):\n` + (lines.join("\n") || "  clean") }] }
      }

      if (name === "bb_visualize") {
        const raw = await BrainDatabase.getRawInstance(projectId)
        const maxNodes = Number(args.maxNodes ?? 200)
        const format = String(args.format ?? "text")
        const symbols = raw.prepare(
          "SELECT s.id, s.name, s.symbol_type, f.language, f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON s.file_id = f.id WHERE s.project_id = ? AND COALESCE(s.line_start,0) > 0 LIMIT ?",
        ).all(projectId, maxNodes) as any[]
        const rels = raw.prepare(
          "SELECT source_symbol_id AS source_id, target_symbol_id AS target_id, relationship_type AS type FROM brain_relationship WHERE project_id = ? AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL LIMIT 5000",
        ).all(projectId) as any[]
        const graph = DependencyGraphVisualizer.generateGraphData(symbols, rels)
        if (format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(graph, null, 2).slice(0, 40000) }] }
        }
        if (format === "html") {
          return { content: [{ type: "text", text: DependencyGraphVisualizer.generateHTML(graph) }] }
        }
        const degree = new Map<string, number>()
        for (const l of graph.links) {
          degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
          degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
        }
        const top = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
        const topLines = top.map(([id, d]) => {
          const n = graph.nodes.find((x: any) => x.id === id)
          return `  ${n?.name ?? id} (${d} edges)`
        })
        return { content: [{ type: "text", text: `graph: ${graph.nodes.length} nodes, ${graph.links.length} links\nmost connected:\n` + (topLines.join("\n") || "  none") }] }
      }

      if (name === "bb_migrate") {
        const analysis = await CrossLanguageIntelligence.analyzePolyglotProjectFromDB(projectId)
        const plan: any = await CrossLanguageMigrationAssistant.generateMigrationPlan(String(args.symbolName), String(args.targetLanguage), analysis)
        if (!plan) return { content: [{ type: "text", text: `no migration plan for ${args.symbolName} -> ${args.targetLanguage}` }] }
        const deps = (plan.dependencies ?? []).map((d: any) => `  ${d.source} -> ${d.target} (${Math.round((d.confidence ?? 0) * 100)}%)`).join("\n")
        return {
          content: [{
            type: "text",
            text: `migrate ${plan.componentName}: ${plan.sourceLanguage} -> ${plan.targetLanguage}\neffort: ${plan.effortEstimateHours}h | complexity: ${plan.complexityScore}/10 | risk: ${plan.riskAssessment?.level}\n${deps ? "dependencies:\n" + deps : ""}`,
          }],
        }
      }

      if (name === "bb_refresh") {
        if (args.force === true) {
          // in-place wipe — keeps the same DB file so all open handles stay live
          const raw = await BrainDatabase.getRawInstance(projectId)
          wipeProjectData(raw)
        }
        const stats: any = await indexProjectParallel(projectId, projectPath, {})
        const raw = await BrainDatabase.getRawInstance(projectId)
        const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
        return { content: [{ type: "text", text: `reindexed: ${stats.totalFiles} files processed, ${symbols} symbols total${args.force === true ? " (forced, in-place)" : ""}` }] }
      }

      if (name === "bb_write") {
        const abs = resolveProjectPath(projectPath, String(args.filePath))
        ensureWithinProject(projectPath, abs)
        writeFileSync(abs, String(args.content ?? ""), "utf8")
        await BrainSurgicalPatcher.tryAutoFormat(abs).catch(() => {})
        await autoRefreshFile(projectId, projectPath, abs, "added")
        return { content: [{ type: "text", text: `written ${args.filePath} (indexed)` }] }
      }

      if (name === "bb_update") {
        const found = await ASTEngine.findSymbol(projectId, String(args.symbolName), args.filePath ? String(args.filePath) : undefined)
        const m = found?.matches?.[0]
        if (!m || m.byteStart == null || m.byteEnd == null) {
          return { content: [{ type: "text", text: `symbol ${args.symbolName} not found or has no byte bounds` }], isError: true }
        }
        const abs = m.fileId
        await BrainSurgicalPatcher.patch(abs, m.byteStart, m.byteEnd, String(args.newContent), false, true)
        await autoRefreshFile(projectId, projectPath, abs)
        return { content: [{ type: "text", text: `updated ${args.symbolName} in ${abs} (bytes ${m.byteStart}-${m.byteEnd}, reindexed)` }] }
      }

      if (name === "bb_insert") {
        const found = await ASTEngine.findSymbol(projectId, String(args.targetSymbolName), args.filePath ? String(args.filePath) : undefined)
        const m = found?.matches?.[0]
        if (!m || m.byteStart == null || m.byteEnd == null) {
          return { content: [{ type: "text", text: `anchor ${args.targetSymbolName} not found` }], isError: true }
        }
        const abs = m.fileId
        const text = readFileSync(abs, "utf8")
        const content = String(args.newContent)
        const pos = String(args.position ?? "after")
        let at = -1
        if (pos === "before") at = m.byteStart
        else if (pos === "after") at = m.byteEnd
        else if (pos === "inside-top" || pos === "inside-bottom") {
          const open = text.indexOf("{", m.byteStart)
          const close = text.lastIndexOf("}", m.byteEnd != null ? Math.min(m.byteEnd, text.length) : text.length)
          if (open === -1 || close === -1 || close < open) {
            return { content: [{ type: "text", text: `cannot find braces for inside insertion in ${args.targetSymbolName}` }], isError: true }
          }
          at = pos === "inside-top" ? open + 1 : close
        }
        await BrainSurgicalPatcher.patch(abs, at, at, "\n" + content + "\n", false, true)
        await autoRefreshFile(projectId, projectPath, abs)
        return { content: [{ type: "text", text: `inserted ${pos} ${args.targetSymbolName} in ${abs} (reindexed)` }] }
      }

      if (name === "bb_delete") {
        const found = await ASTEngine.findSymbol(projectId, String(args.symbolName), args.filePath ? String(args.filePath) : undefined)
        const m = found?.matches?.[0]
        if (!m || m.byteStart == null || m.byteEnd == null) {
          return { content: [{ type: "text", text: `symbol ${args.symbolName} not found` }], isError: true }
        }
        const abs = m.fileId
        await BrainSurgicalPatcher.patch(abs, m.byteStart, m.byteEnd, "", true, false)
        const after = readFileSync(abs, "utf8")
        const pruned = await ImportPruner.prune(after, abs)
        if (pruned !== after) writeFileSync(abs, pruned, "utf8")
        await BrainSurgicalPatcher.tryAutoFormat(abs).catch(() => {})
        await autoRefreshFile(projectId, projectPath, abs)
        return { content: [{ type: "text", text: `deleted ${args.symbolName} from ${abs} (reindexed)` }] }
      }

      if (name === "bb_refactor") {
        const found = await ASTEngine.findSymbol(projectId, String(args.symbolName), args.filePath ? String(args.filePath) : undefined)
        const m = found?.matches?.[0]
        const newName = String(args.newName)
        if (!m || m.byteStart == null || m.byteEnd == null) {
          return { content: [{ type: "text", text: `symbol ${args.symbolName} not found` }], isError: true }
        }
        const abs = m.fileId
        const text = readFileSync(abs, "utf8")
        const nameAt = text.indexOf(String(args.symbolName), m.byteStart)
        if (nameAt === -1 || nameAt >= m.byteEnd) {
          return { content: [{ type: "text", text: `could not locate the ${args.symbolName} identifier token` }], isError: true }
        }
        await BrainSurgicalPatcher.patch(abs, nameAt, nameAt + String(args.symbolName).length, newName, false, true)
        // cascade: rename at caller sites
        const raw = await BrainDatabase.getRawInstance(projectId)
        const callers = raw.prepare(
          `SELECT s.file_id, s.byte_start, s.byte_end FROM brain_relationship r
           JOIN brain_symbol s ON s.id = r.source_symbol_id
           WHERE r.target_symbol_id = ? AND r.relationship_type = 'calls'`,
        ).all(m.id) as any[]
        const seen = new Set<string>()
        for (const c of callers) {
          const key = `${c.file_id}:${c.byte_start}` 
          if (seen.has(key)) continue
          seen.add(key)
          if (c.byte_start == null) continue
          const callerAbs = c.file_id
          const cText = readFileSync(callerAbs, "utf8")
          const body = cText.slice(c.byte_start, c.byte_end ?? cText.length)
          const re = new RegExp(`\\b${String(args.symbolName)}\\b`, "g")
          let mm: RegExpExecArray | null
          let delta = 0
          while ((mm = re.exec(body)) !== null) {
            const gStart = c.byte_start + mm.index + delta
            await BrainSurgicalPatcher.patch(callerAbs, gStart, gStart + String(args.symbolName).length, newName, false, false)
            delta += newName.length - String(args.symbolName).length
          }
        }
        // refresh the declaration file plus every caller file that was edited
        const changedFiles = new Set<string>([abs])
        for (const c of callers) if (c.file_id) changedFiles.add(c.file_id)
        for (const f of changedFiles) await autoRefreshFile(projectId, projectPath, f)
        return { content: [{ type: "text", text: `renamed ${args.symbolName} -> ${newName} (declaration + ${seen.size} caller files, reindexed)` }] }
      }

      return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true }
    } catch (e: any) {
      return { content: [{ type: "text", text: `error: ${e?.message ?? String(e)}` }], isError: true }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

async function readSnippet(filePath: string, lineStart: number, byteEnd?: number): Promise<string | null> {
  try {
    if (!existsSync(filePath)) return null
    const text = readFileSync(filePath, "utf8")
    const lines = text.split("\n")
    return lines.slice(lineStart - 1, lineStart + 12).join("\n")
  } catch {
    return null
  }
}

import * as path from "path"

function resolveProjectPath(projectPath: string, rel: string): string {
  return path.resolve(projectPath, rel)
}

function ensureWithinProject(projectPath: string, abs: string): void {
  if (!abs.startsWith(projectPath)) {
    throw new Error(`path escapes project root: ${abs}`)
  }
}

// Self-execution entry: `bun src/mcp/server.ts --dir <path>` starts the server.
if (import.meta.main) {
  const dirArg = process.argv.findIndex((a) => a === "--dir")
  const dir = dirArg !== -1 ? process.argv[dirArg + 1] : process.cwd()
  startMcpServer(dir).catch((e) => {
    console.error("MCP server failed:", e?.message ?? String(e))
    process.exit(1)
  })
}
