// Source MCP server entry for the audit: starts the CURRENT working-tree server
// (src/mcp/server.ts) under tsx, so the wire legs test the code under audit rather
// than a possibly-stale dist/ build.
import { startMcpServer } from "../../../../src/mcp/server"

const dirIndex = process.argv.findIndex((arg) => arg === "--dir")
const directory = dirIndex !== -1 ? process.argv[dirIndex + 1] : process.cwd()
startMcpServer(directory).catch((error) => {
  console.error("MCP server failed:", error?.message ?? String(error))
  process.exit(1)
})
