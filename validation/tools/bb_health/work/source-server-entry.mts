// MCP-stdio entry that starts the SOURCE server (the compiled dist can lag the
// working tree). Used only by the Phase A wire probe.
import { startMcpServer } from "../../../../src/mcp/server"
const dirArg = process.argv.findIndex((a) => a === "--dir")
const directory = dirArg !== -1 ? process.argv[dirArg + 1] : process.cwd()
await startMcpServer(directory)
