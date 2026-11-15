// validation/tools/bb_annotations/work/mcp-server-child.mts
//
// Minimal stdio host for the audit door probe: starts the REAL MCP server on the
// workspace the parent passes. src/mcp/server.ts only self-starts through
// import.meta.main, which tsx does not set for an imported module, so the probe
// calls the exported startMcpServer the same way the server's own entry does.
import { startMcpServer } from "../../../../src/mcp/server.ts"

const directory = process.argv[2]
if (!directory) {
  console.error("mcp-server-child: missing workspace directory")
  process.exit(2)
}
await startMcpServer(directory)
