// Node runtime entry for the real MCP server (better-sqlite3), used by mcp-probe.ts
// when BB_PROBE_RUNTIME=node. src/mcp/server.ts self-starts only under Bun because
// install.meta.main is undefined under node --import tsx, so the entry is explicit.
import { startMcpServer } from "../../../../src/mcp/server"
const dirIndex = process.argv.indexOf("--dir")
const directory = dirIndex !== -1 ? process.argv[dirIndex + 1]! : process.cwd()
await startMcpServer(directory)
