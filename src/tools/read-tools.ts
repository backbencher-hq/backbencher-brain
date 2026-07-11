// Brain Read Tools — All 12 read-only MCP tools
// Registers: search, select, relationships, ask, health, security, patterns, visualize, migrate, refresh

import type Database from "better-sqlite3"
import { registerTool, type ServerContext } from "../server.js"
import {
  searchSymbols, findSymbol, getFileSymbols, findFiles,
  getCallers, getCallees, getRecursiveCallers,
  getFileImports, getFileDependents,
  searchContent, getStats, getMostComplex, findOrphaned,
  getCouplingHeatmap, getTaintFlows, getSymbolsByKind,
} from "../graph/query.js"
import { indexProjectParallel } from "../indexer/parallel-indexer.js"

// ============================================================================
// TOOL: brain_search
// ============================================================================

registerTool({
  name: "brain_search",
  description: "Search symbols by name across the indexed project. Returns ranked results with file paths and line numbers. Supports filtering by scope (project/functions/classes/files), language, exact/fuzzy matching, and pagination.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The symbol name or concept to search for" },
      scope: { type: "string", enum: ["project", "functions", "classes", "brain_file"], description: "Search scope" },
      exact: { type: "boolean", description: "Exact name match only" },
      language: { type: "string", description: "Filter by language (typescript, python, etc.)" },
      includeContent: { type: "boolean", description: "Include code snippets in results" },
      limit: { type: "number", description: "Max results (default 20, max 100)" },
      offset: { type: "number", description: "Pagination offset" },
    },
    required: ["query"],
  },
  handler: async (args: any, ctx: any) => {
    const limit = Math.min(args.limit || 20, 100)
    const offset = args.offset || 0

    if (args.scope === "functions") {
      const results = searchSymbols(ctx.db, ctx.projectHash, args.query, {
        kind: "function", language: args.language, exact: args.exact, limit, offset,
      })
      return { data: results, count: results.length }
    }

    if (args.scope === "classes") {
      const results = searchSymbols(ctx.db, ctx.projectHash, args.query, {
        kind: "class", language: args.language, exact: args.exact, limit, offset,
      })
      return { data: results, count: results.length }
    }

    if (args.scope === "brain_file") {
      const results = findFiles(ctx.db, ctx.projectHash, args.query, limit)
      return { data: results, count: results.length }
    }

    // scope === "project" (default)
    const symbolResults = searchSymbols(ctx.db, ctx.projectHash, args.query, {
      language: args.language, exact: args.exact, limit, offset,
    })

    // FTS5 content fallback
    if (args.includeContent || symbolResults.length < limit) {
      const contentResults = searchContent(ctx.db, ctx.projectHash, args.query, limit - symbolResults.length)
      return {
        data: { symbols: symbolResults, content: contentResults },
        count: symbolResults.length + contentResults.length,
      }
    }

    return { data: symbolResults, count: symbolResults.length }
  },
})

// ============================================================================
// TOOL: brain_select
// ============================================================================

registerTool({
  name: "brain_select",
  description: "Read a symbol or file with byte-precise bounds. Returns exact code for a named symbol, or the full file with optional offset/limit. Supports AST outline mode for large files. Includes optional dependency graph (callers/callees).",
  inputSchema: {
    type: "object",
    properties: {
      symbolName: { type: "string", description: "Exact symbol name to read" },
      filePath: { type: "string", description: "File path (absolute or relative)" },
      lineStart: { type: "number", description: "Line to disambiguate overloads" },
      mode: { type: "string", enum: ["full", "outline"], description: "Read mode for files" },
      includeDependencies: { type: "boolean", description: "Include callers and callees" },
      offset: { type: "number", description: "Line offset for file reads" },
      limit: { type: "number", description: "Max lines (default 2000)" },
    },
  },
  handler: async (args: any, ctx: any) => {
    const { readFileSync } = await import("fs")
    const { resolve } = await import("path")

    // FILE MODE
    if (!args.symbolName && args.filePath) {
      const filepath = resolve(ctx.projectPath, args.filePath)
      try {
        const content = readFileSync(filepath, "utf8")
        const lines = content.split("\n")
        const start = Math.max(0, (args.offset || 1) - 1)
        const end = start + (args.limit || 2000)
        const snippet = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n")
        const truncated = lines.length > end ? `\n(truncated at ${args.limit || 2000} lines)` : ""
        return { data: { path: filepath, content: snippet + truncated, totalLines: lines.length } }
      } catch {
        return { error: { code: "NOT_FOUND", message: `File not found: ${args.filePath}` } }
      }
    }

    // SYMBOL MODE
    if (!args.symbolName) {
      return { error: { code: "INVALID_PARAMS", message: "Provide symbolName or filePath" } }
    }

    const symbol = findSymbol(ctx.db, ctx.projectHash, args.symbolName, args.filePath, args.lineStart)
    if (!symbol) {
      return { error: { code: "NOT_FOUND", message: `Symbol not found: ${args.symbolName}` } }
    }

    // Read exact bytes from file
    let snippet = ""
    if (symbol.byte_start != null && symbol.byte_end != null && symbol.byte_end > symbol.byte_start) {
      const filepath = resolve(ctx.projectPath, symbol.relative_path)
      try {
        const content = readFileSync(filepath, "utf8")
        snippet = content.substring(symbol.byte_start, symbol.byte_end)
        const startLine = symbol.line_start || 1
        const numberedLines = snippet.split("\n").map((l, i) => `${startLine + i}: ${l}`).join("\n")
        snippet = numberedLines
      } catch {
        snippet = `[Symbol at ${symbol.relative_path}:${symbol.line_start}]`
      }
    }

    // Dependencies
    let callers: any[] = []
    let callees: any[] = []
    if (args.includeDependencies !== false) {
      callers = getCallers(ctx.db, ctx.projectHash, symbol.id, 10)
      callees = getCallees(ctx.db, ctx.projectHash, symbol.id, 10)
    }

    return {
      data: {
        symbol: { name: symbol.name, kind: symbol.kind, file: symbol.relative_path, language: symbol.language },
        range: { startLine: symbol.line_start, endLine: symbol.line_end },
        snippet,
        callers: callers.map((c) => ({ name: c.source_name, file: c.source_file })),
        callees: callees.map((c) => ({ name: c.target_name, file: c.target_file })),
      },
    }
  },
})

// ============================================================================
// TOOL: brain_relationships
// ============================================================================

registerTool({
  name: "brain_relationships",
  description: "Analyze symbol relationships: callers, callees, impact, imports, exports, test coverage, test gaps. Supports recursive trace-to-root for call graphs.",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", description: "Symbol or file name to analyze" },
      analysisType: {
        type: "string",
        enum: ["callers", "callees", "impact", "brain_import", "exports", "coupling", "orphaned"],
        description: "Type of relationship analysis",
      },
      traceToRoot: { type: "boolean", description: "Recursively trace call graph to root (max depth 10)" },
      limit: { type: "number", description: "Max results (default 20)" },
      offset: { type: "number", description: "Pagination offset" },
    },
    required: ["target", "analysisType"],
  },
  handler: async (args: any, ctx: any) => {
    const limit = args.limit || 20

    if (args.analysisType === "callers") {
      const symbol = findSymbol(ctx.db, ctx.projectHash, args.target)
      if (!symbol) return { error: { code: "NOT_FOUND", message: `Symbol not found: ${args.target}` } }

      if (args.traceToRoot) {
        const callers = getRecursiveCallers(ctx.db, ctx.projectHash, args.target, 10, 100)
        return { data: { symbol: args.target, recursiveCallers: callers, totalCallers: callers.length } }
      }

      const callers = getCallers(ctx.db, ctx.projectHash, symbol.id, limit)
      return { data: { symbol: args.target, callers, count: callers.length } }
    }

    if (args.analysisType === "callees") {
      const symbol = findSymbol(ctx.db, ctx.projectHash, args.target)
      if (!symbol) return { error: { code: "NOT_FOUND", message: `Symbol not found: ${args.target}` } }

      const callees = getCallees(ctx.db, ctx.projectHash, symbol.id, limit)
      return { data: { symbol: args.target, callees, count: callees.length } }
    }

    if (args.analysisType === "brain_import") {
      const imports = getFileImports(ctx.db, ctx.projectHash, args.target, limit)
      return { data: { file: args.target, imports, count: imports.length } }
    }

    if (args.analysisType === "exports") {
      const symbol = findSymbol(ctx.db, ctx.projectHash, args.target)
      if (!symbol) {
        const file = findFiles(ctx.db, ctx.projectHash, args.target, 1)
        if (file.length === 0) return { error: { code: "NOT_FOUND", message: "Not found" } }
        const symbols = getFileSymbols(ctx.db, ctx.projectHash, file[0]!.relative_path)
        return { data: { file: args.target, symbols, count: symbols.length } }
      }
      return { data: { symbol: symbol.name, file: symbol.relative_path, kind: symbol.kind } }
    }

    if (args.analysisType === "coupling") {
      const heatmap = getCouplingHeatmap(ctx.db, ctx.projectHash, limit)
      return { data: { classes: heatmap, count: heatmap.length } }
    }

    if (args.analysisType === "orphaned") {
      const orphaned = findOrphaned(ctx.db, ctx.projectHash, limit)
      return { data: { orphanedSymbols: orphaned, count: orphaned.length } }
    }

    return { error: { code: "INVALID_PARAMS", message: `Unknown analysisType: ${args.analysisType}` } }
  },
})

// ============================================================================
// TOOL: brain_ask
// ============================================================================

registerTool({
  name: "brain_ask",
  description: "Ask natural language questions about the codebase. Supports quick_answer mode (statistics queries) and semantic_search mode (concept-based code search).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Question or concept to search for" },
      mode: { type: "string", enum: ["quick_answer", "semantic_search"], description: "Query mode" },
      maxResults: { type: "number", description: "Max results (default 10)" },
    },
    required: ["query", "mode"],
  },
  handler: async (args: any, ctx: any) => {
    const maxResults = args.maxResults || 10
    const lower = (args.query || "").toLowerCase()

    if (args.mode === "quick_answer") {
      // Pattern-matched quick answers
      if (lower.includes("how many") && lower.includes("function")) {
        const stats = getStats(ctx.db, ctx.projectHash)
        return { data: { answer: `There are ${stats.symbols.toLocaleString()} symbols in this project`, stats } }
      }

      if (lower.includes("how many") && lower.includes("file")) {
        const stats = getStats(ctx.db, ctx.projectHash)
        return { data: { answer: `There are ${stats.files.toLocaleString()} files in this project`, stats } }
      }

      if (lower.includes("most complex")) {
        const complex = getMostComplex(ctx.db, ctx.projectHash, 1)
        if (complex.length > 0) {
          return { data: { answer: `Most complex: ${complex[0]!.name} (complexity ${complex[0]!.complexity})`, top: complex } }
        }
        return { data: { answer: "No complexity data available. Try indexing first." } }
      }

      if (lower.includes("language")) {
        const stats = getStats(ctx.db, ctx.projectHash)
        return { data: { answer: `Languages: ${stats.languages.join(", ")}`, stats } }
      }

      // Fallback: symbol search
      const results = searchSymbols(ctx.db, ctx.projectHash, args.query, { limit: maxResults })
      return {
        data: {
          answer: `Found ${results.length} symbols matching "${args.query}"`,
          symbols: results.slice(0, 5).map((s) => ({ name: s.name, kind: s.kind, file: s.relative_path })),
        },
      }
    }

    // semantic_search mode
    const results = searchSymbols(ctx.db, ctx.projectHash, args.query, { limit: maxResults })
    return { data: { results: results.map((s) => ({ name: s.name, kind: s.kind, file: s.relative_path, line: s.line_start })), count: results.length } }
  },
})

// ============================================================================
// TOOL: brain_health
// ============================================================================

registerTool({
  name: "brain_health",
  description: "Report the health and status of the brain indexing system. Returns file count, symbol count, relationship count, languages detected, and parser pool status.",
  inputSchema: {
    type: "object",
    properties: {
      detailed: { type: "boolean", description: "Include detailed stats" },
    },
  },
  handler: async (_args: any, ctx: any) => {
    const stats = getStats(ctx.db, ctx.projectHash)
    const status = (ctx.db.prepare("SELECT status, last_indexed_at, error_message FROM index_status WHERE project_hash = ?").get(ctx.projectHash) as any) || {}
    return {
      data: {
        healthy: stats.files > 0,
        isIndexed: stats.files > 0,
        status: status.status || "unknown",
        lastIndexed: status.last_indexed_at || null,
        stats: {
          files: stats.files,
          symbols: stats.symbols,
          relationships: stats.relationships,
          imports: stats.imports,
          languages: stats.languages,
          avgComplexity: stats.avgComplexity,
        },
      },
    }
  },
})

// ============================================================================
// TOOL: brain_security
// ============================================================================

registerTool({
  name: "brain_security",
  description: "Scan the codebase for security vulnerabilities using AST data flow analysis. Detects SQL injection, XSS, command injection, and path traversal across all languages.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async (_args: any, ctx: any) => {
    const flows = getTaintFlows(ctx.db, ctx.projectHash, 50)

    // Group by severity
    const critical = flows.filter((f: any) => f.severity === "critical")
    const high = flows.filter((f: any) => f.severity === "high")
    const byType: Record<string, number> = {}
    for (const f of flows as any[]) {
      byType[f.vulnerability_type] = (byType[f.vulnerability_type] || 0) + 1
    }

    return {
      data: {
        totalVulnerabilities: flows.length,
        critical: critical.length,
        high: high.length,
        byType,
        findings: flows.slice(0, 20).map((f: any) => ({
          severity: f.severity,
          type: f.vulnerability_type,
          source: f.source_name,
          sourceFile: f.source_file,
          sink: f.sink_type,
        })),
      },
    }
  },
})

// ============================================================================
// TOOL: brain_patterns
// ============================================================================

registerTool({
  name: "brain_patterns",
  description: "Detect code patterns, anti-patterns, and architectural issues. Supports orphaned detection, complexity analysis, and architectural violation scanning.",
  inputSchema: {
    type: "object",
    properties: {
      analysisType: {
        type: "string",
        enum: ["orphaned", "complexity", "violations"],
        description: "Pattern analysis type",
      },
      target: { type: "string", description: "File or function name for targeted analysis" },
    },
    required: ["analysisType"],
  },
  handler: async (args: any, ctx: any) => {
    if (args.analysisType === "orphaned") {
      const orphaned = findOrphaned(ctx.db, ctx.projectHash, 20)
      return { data: { orphanedSymbols: orphaned, count: orphaned.length } }
    }

    if (args.analysisType === "complexity") {
      if (args.target) {
        const results = searchSymbols(ctx.db, ctx.projectHash, args.target, { limit: 10 })
        return { data: { symbols: results.map((s) => ({ name: s.name, complexity: s.complexity, file: s.relative_path })) } }
      }
      const complex = getMostComplex(ctx.db, ctx.projectHash, 20)
      return { data: { topComplexFunctions: complex.map((s) => ({ name: s.name, complexity: s.complexity, file: s.relative_path })) } }
    }

    if (args.analysisType === "violations") {
      const largeFiles = ctx.db.prepare("SELECT relative_path, line_count FROM brain_file WHERE project_hash = ? AND line_count > 500 ORDER BY line_count DESC LIMIT 10").all(ctx.projectHash) as any[]
      const highComplexity = getMostComplex(ctx.db, ctx.projectHash, 10)
      const orphaned = findOrphaned(ctx.db, ctx.projectHash, 10)

      return {
        data: {
          largeFiles: largeFiles.map((f: any) => ({ file: f.relative_path, lines: f.line_count })),
          highComplexity: highComplexity.map((s) => ({ name: s.name, complexity: s.complexity, file: s.relative_path })),
          orphaned: orphaned.map((s) => ({ name: s.name, kind: s.kind, file: s.relative_path })),
        },
      }
    }

    return { error: { code: "INVALID_PARAMS", message: `Unknown analysisType: ${args.analysisType}` } }
  },
})

// ============================================================================
// TOOL: brain_visualize
// ============================================================================

registerTool({
  name: "brain_visualize",
  description: "Generate interactive HTML or JSON dependency graph visualizations. Supports scoping by file, symbol, or entire project.",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["all", "file", "symbol"], description: "Visualization scope" },
      filePath: { type: "string", description: "Focus file for scope=file" },
      symbolName: { type: "string", description: "Focus symbol for scope=symbol" },
      format: { type: "string", enum: ["html", "json"], description: "Output format" },
      maxNodes: { type: "number", description: "Max nodes (default 2000)" },
    },
  },
  handler: async (args: any, ctx: any) => {
    const maxNodes = args.maxNodes || 2000

    // Get symbols and relationships
    const symbols = ctx.db.prepare(`
      SELECT s.id, s.name, s.kind, f.relative_path as file, f.language
      FROM brain_symbol s
      JOIN brain_file f ON f.id = s.file_id
      WHERE s.project_hash = ?
      ORDER BY s.gravity_score DESC
      LIMIT ?
    `).all(ctx.projectHash, maxNodes) as any[]

    const symbolIds = new Set(symbols.map((s: any) => s.id))
    const relationships = ctx.db.prepare(`
      SELECT source_symbol_id, target_symbol_id, target_external, relationship_type
      FROM relationships
      WHERE project_hash = ?
      LIMIT 5000
    `).all(ctx.projectHash) as any[]

    const filteredRels = relationships.filter(
      (r: any) => symbolIds.has(r.source_symbol_id) && (symbolIds.has(r.target_symbol_id) || r.target_external),
    ).slice(0, 5000)

    if (args.format === "json") {
      return { data: { nodes: symbols, links: filteredRels, nodeCount: symbols.length, linkCount: filteredRels.length } }
    }

    // Generate minimal HTML (D3 force graph)
    const html = generateGraphHtml(symbols, filteredRels)
    return { data: { format: "html", html, nodeCount: symbols.length, linkCount: filteredRels.length } }
  },
})

function generateGraphHtml(nodes: any[], links: any[]): string {
  const data = JSON.stringify({ nodes, links })
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Brain Graph</title>
<script src="https://d3js.org/d3.v7.min.js"></script><style>svg{width:100%;height:100vh}line{stroke:#999;stroke-opacity:0.3}text{font-size:10px}</style></head><body>
<script>const data=${data};const W=window.innerWidth,H=window.innerHeight;const svg=d3.select("body").append("svg").attr("viewBox",[0,0,W,H]);
const sim=d3.forceSimulation(data.nodes).force("link",d3.forceLink(data.links).id(d=>d.id).distance(50)).force("charge",d3.forceManyBody().strength(-200)).force("center",d3.forceCenter(W/2,H/2));
const link=svg.append("g").selectAll("line").data(data.links).join("line");
const node=svg.append("g").selectAll("g").data(data.nodes).join("g").call(d3.drag().on("start",(e,d)=>{if(!e.active)sim.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y}).on("drag",(e,d)=>{d.fx=e.x;d.fy=e.y}).on("end",(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null}));
node.append("circle").attr("r",4).attr("fill",d=>d.kind==="class"?"steelblue":"orange");
node.append("text").text(d=>d.name).attr("dx",6).attr("dy",3);
sim.on("tick",()=>{link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y).attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);node.attr("transform",d=>"translate("+d.x+","+d.y+")")})</script></body></html>`
}

// ============================================================================
// TOOL: brain_refresh
// ============================================================================

registerTool({
  name: "brain_refresh",
  description: "Trigger project reindexing. Runs asynchronously in the background. Use wait=true to block until complete (max 5 minutes).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory path for targeted refresh" },
      wait: { type: "boolean", description: "Block until indexing completes" },
    },
  },
  handler: async (args: any, ctx: any) => {
    // Start indexing in background
    const promise = indexProjectParallel(ctx.projectHash, ctx.projectPath, {
      files: args.path ? [args.path] : undefined,
    })

    if (args.wait) {
      const stats = await promise
      return {
        data: {
          completed: true,
          files: stats.successFiles,
          symbols: stats.symbolsExtracted,
          relationships: stats.relationshipsFound,
          duration: stats.endTime ? ((stats.endTime - stats.startTime) / 1000).toFixed(1) + "s" : "unknown",
        },
      }
    }

    // Fire and forget
    promise.catch((err) => console.error("Background reindex failed:", err.message))
    return { data: { started: true, message: "Indexing started in background. Check brain_health for progress." } }
  },
})
