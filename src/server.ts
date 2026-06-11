// MCP Server — Stdio-based Model Context Protocol server
// Registers 15 brain tools, dispatches calls to query layer
// Uses @modelcontextprotocol/sdk for protocol compliance

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type Database from "better-sqlite3"
import { createLogger, setVerbose } from "./util/log.js"
import { serializeError } from "./util/errors.js"
import type { MCPToolDefinition } from "./ast/types.js"

const log = createLogger("mcp-server")

// ============================================================================
// TOOL REGISTRY
// ============================================================================

const tools: MCPToolDefinition[] = []

export function registerTool(tool: MCPToolDefinition): void {
  tools.push(tool)
}

export function getTools(): MCPToolDefinition[] {
  return tools
}

// ============================================================================
// SERVER SETUP
// ============================================================================

export interface ServerContext {
  projectPath: string
  projectHash: string
  db: Database.Database
}

// Response cache for expensive queries
const responseCache = new Map<string, { data: any; timestamp: number }>()
const CACHE_TTL: Record<string, number> = {
  brain_relationships: 3 * 60 * 1000,
  brain_ask: 5 * 60 * 1000,
  brain_search: 30 * 1000,
}

// Rate limiting
const MAX_CONCURRENT = 10
let activeRequests = 0

export async function startServer(ctx: ServerContext): Promise<void> {
  const server = new Server(
    { name: "backbencher-brain", version: "0.1.0" },
    { capabilities: { tools: {} } },
  )

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }
  })

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const tool = tools.find((t) => t.name === name)

    if (!tool) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } }),
        }],
        isError: true,
      }
    }

    try {
      // Rate limiting
      activeRequests++
      if (activeRequests > MAX_CONCURRENT) {
        activeRequests--
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many concurrent requests" } }) }],
          isError: true,
        }
      }

      // Check cache
      const ttl = CACHE_TTL[name] || 0
      const cacheKey = `${name}:${JSON.stringify(args)}`
      if (ttl > 0) {
        const cached = responseCache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < ttl) {
          activeRequests--
          return { content: [{ type: "text" as const, text: JSON.stringify({ ...cached.data, _cached: true }) }] }
        }
      }

      log.debug("tool called", { tool: name, args: JSON.stringify(args).slice(0, 200) })
      const result = await tool.handler(args || {}, ctx)

      // Cache result
      if (ttl > 0) {
        responseCache.set(cacheKey, { data: result, timestamp: Date.now() })
        if (responseCache.size > 1000) {
          const oldest = [...responseCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)
          for (const [key] of oldest.slice(0, 100)) responseCache.delete(key)
        }
      }

      activeRequests--
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }
    } catch (err) {
      log.error("tool error", { tool: name, error: String(err) })
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: serializeError(err) }),
        }],
        isError: true,
      }
    }
  })

  // Connect transport and start listening
  const transport = new StdioServerTransport()
  await server.connect(transport)

  log.info("MCP server started", {
    project: ctx.projectPath,
    tools: tools.length,
    hash: ctx.projectHash,
  })
}
