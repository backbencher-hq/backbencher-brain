// Backbencher Brain — Main entry point
// CLI mode: parses commands, routes to handlers
// MCP mode: started by `bb start` which spawns the server over stdio

import { run } from "./cli/commands.js"

const args = process.argv.slice(2)

run(args).catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
