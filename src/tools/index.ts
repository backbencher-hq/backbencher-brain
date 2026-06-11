// Tool registry — all 15 MCP brain tools
// Will be populated in M6

import type { MCPToolDefinition } from "../ast/types.js"

// Placeholder — actual tools added in M6.2
export const TOOLS: MCPToolDefinition[] = []

export function getTool(name: string): MCPToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name)
}
