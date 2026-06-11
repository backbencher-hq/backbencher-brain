// Backbencher Brain — Main entry point
// Supports both CLI mode and MCP server mode

import { run } from "./cli/commands.js"

// When run directly: CLI mode
// When spawned by MCP host: environment signals MCP mode

const args = process.argv.slice(2)

run(args).catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
