// validation/tools/bb_cross_language/work/mcp-server-child.mts
//
// Minimal stdio MCP host for the audit door probe: starts the REAL server on the
// workspace the parent passes. Kept as a separate file because startMcpServer is
// an exported function and src/mcp/server.ts only self-starts through
// import.meta.main, which tsx does not set.
import { startMcpServer } from "../../../../src/mcp/server.ts"

const directory = process.argv[2]
if (!directory) {
  console.error("mcp-server-child: missing workspace directory")
  process.exit(2)
}
await startMcpServer(directory)
