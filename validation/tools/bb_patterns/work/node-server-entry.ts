// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the Node runtime entry for the real MCP server, used by the bb_patterns door
//   probe. src/mcp/server.ts self-starts only under Bun (import.meta.main is undefined under
//   node --import tsx), so the entry is explicit here.
// WHICH TOOL IT SERVES — bb_patterns (read), through the same stdio door every MCP host uses.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_patterns/raw/mcp-door.json.
// EDIT TOGETHER WHEN THIS CHANGES — work/mcp-door.mts, src/mcp/server.ts.
import { startMcpServer } from "../../../../src/mcp/server"

const dirIndex = process.argv.indexOf("--dir")
const directory = dirIndex !== -1 ? process.argv[dirIndex + 1]! : process.cwd()
await startMcpServer(directory)
