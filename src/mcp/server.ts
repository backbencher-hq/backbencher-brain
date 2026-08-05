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
import { BrainTools, AdvancedBrainTools } from "../ast/tools"
import { ASTEngine } from "../ast/engine"
import { checkResultsFreshness } from "../brain/freshness"
import { getProjectId } from "../cli/index"
import { existsSync, readFileSync } from "fs"

interface ToolContext {
  projectPath: string
  projectId: string
}

const TOOLS = [
  {
    name: "bb_search",
    description:
      "Search the AST index for symbols (functions, classes, variables). Returns file, line, type, language. Attaches a stale flag when the file changed since indexing.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "symbol name or fragment" },
        limit: { type: "number", description: "max results (default 15)" },
        language: { type: "string", description: "filter by language" },
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
      "Find who calls a symbol (callers) or what it calls (callees). Returns names, files, and lines. Cross-language aware.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "symbol name" },
        direction: { type: "string", enum: ["callers", "callees"], description: "direction (default callers)" },
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
    description: "Index health: file/symbol/relationship counts and file freshness.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
]

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
        })
        const lines = results.map((r: any) => {
          const stale = r.stale ? " [STALE]" : ""
          return `${r.symbolName} [${r.symbolType}] ${r.file}:${r.line} (${r.language})${stale}`
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
        const results =
          direction === "callers"
            ? await BrainTools.getFunctionCallers(projectId, target)
            : await BrainTools.getFunctionCallees(projectId, target)
        const lines = (results.slice(0, limit) as any[]).map(
          (r: any) => `${r.name} — ${r.relativePath ?? r.filePath ?? "?"}:${r.range?.startLine ?? "?"}`,
        )
        return {
          content: [
            {
              type: "text",
              text: lines.length ? `${direction} of ${target} (${results.length} total):\n` + lines.join("\n") : `no ${direction} found for ${target}`,
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
        return {
          content: [
            {
              type: "text",
              text: `files=${files} symbols=${symbols} relationships=${rels} embeddings=${emb}\nfreshness: ${fresh} fresh / ${stale} stale (sampled ${fileRows.length})`,
            },
          ],
        }
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

// Self-execution entry: `bun src/mcp/server.ts --dir <path>` starts the server.
if (import.meta.main) {
  const dirArg = process.argv.findIndex((a) => a === "--dir")
  const dir = dirArg !== -1 ? process.argv[dirArg + 1] : process.cwd()
  startMcpServer(dir).catch((e) => {
    console.error("MCP server failed:", e?.message ?? String(e))
    process.exit(1)
  })
}
