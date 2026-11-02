// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — a portable stdio entry for the real MCP server: src/mcp/server.ts
//   self-starts only under Bun (import.meta.main is undefined under node --import tsx),
//   so the bb_ask gates spawn this file under Node instead of a compiled binary.
// WHICH TOOL IT SERVES — the bb_ask gates' real MCP stdio door (read tool, answer mode).
// WHY IT IS SHAPED THIS WAY — the gates must run under BOTH runtimes from source: `bun
//   src/mcp/server.ts --dir <dir>` needs no entry, but a Node run needs one explicit, and
//   the compiled bin/bb is a build artifact the campaign does not edit mid-flight.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/gates/**, validation/tools/bb_ask/mcp-door.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/server.ts, script/m13/verify-ask-contract.ts,
//   script/m13/verify-ask-e2e-corpus.ts.
// CONTRACTS IT MUST NOT BREAK — starts the same server the product ships, reads only the
//   directory argument, writes nothing itself.
// ─────────────────────────────────────────────────────────────────────────────

import { startMcpServer } from "../../src/mcp/server"

const dirIndex = process.argv.indexOf("--dir")
const directory = dirIndex !== -1 ? process.argv[dirIndex + 1]! : process.cwd()
await startMcpServer(directory)
