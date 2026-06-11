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
      log.debug("tool called", { tool: name, args: JSON.stringify(args).slice(0, 200) })
      const result = await tool.handler(args || {}, ctx)
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      }
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
