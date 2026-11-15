// Real MCP stdio probe for bb_search.
//
// Usage:
//   BB_DATA_DIR=... BB_NO_AUTO_REFRESH=1 bun mcp-probe.ts <projectDir> <calls.json> [out.json]
//
// <calls.json> is an array of { label, args } (or { label, args, expectError }).
// Each call is issued through a real MCP stdio session (same transport the MCP
// clients use), the raw text payload is parsed when it is JSON, and one JSON line
// per call is printed plus written to out.json.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getProjectId } from "../../../../src/cli/index"

const projectDir = process.argv[2]
const callsPath = process.argv[3]
const outPath = process.argv[4] ?? ""
if (!projectDir || !callsPath) {
  console.error("usage: mcp-probe.ts <projectDir> <calls.json> [out.json]")
  process.exit(2)
}
const rawCalls = readFileSync(callsPath, "utf8").split("__PROJECT__").join(projectDir)
const calls = JSON.parse(rawCalls) as Array<{ label: string; args: Record<string, unknown> }>
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")

const nodeRuntime = process.env.BB_PROBE_RUNTIME === "node"
const transport = new StdioClientTransport({
  command: process.execPath,
  args: nodeRuntime
    ? // node + tsx: the product's own driver (better-sqlite3), entry explicit because
      // `import.meta.main` is undefined under node --import tsx.
      [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(import.meta.dir ?? path.dirname(fileURLToPath(import.meta.url)), "node-server-entry.ts"), "--dir", projectDir]
    : [path.join(repoRoot, "src", "mcp", "server.ts"), "--dir", projectDir],
  cwd: repoRoot,
  stderr: "pipe",
  // The SDK sanitizes the child environment to HOME/PATH/... and would drop
  // BB_DATA_DIR, so the server would read the real ~/.bb instead of the fixture.
  env: { ...process.env } as Record<string, string>,
})
const client = new Client({ name: "bb-search-audit-probe", version: "1.0.0" })
const rows: any[] = []
let serverStderr = ""
transport.stderr?.on("data", (chunk: Buffer) => { serverStderr += chunk.toString() })
try {
  await client.connect(transport)
  rows.push({ label: "__init__", projectId: getProjectId(projectDir), projectDir })
  for (const call of calls) {
    const t0 = performance.now()
    let response: any
    try {
      response = await client.callTool({ name: "bb_search", arguments: call.args })
    } catch (error: any) {
      rows.push({ label: call.label, args: call.args, thrown: String(error?.message ?? error), ms: Math.round((performance.now() - t0) * 100) / 100 })
      continue
    }
    const ms = Math.round((performance.now() - t0) * 100) / 100
    const text = (response?.content ?? []).map((item: any) => item.text ?? "").join("\n")
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch {}
    rows.push({ label: call.label, args: call.args, isError: response?.isError === true, ms, text, parsed })
  }
} catch (error: any) {
  rows.push({ label: "__fatal__", error: String(error?.stack ?? error), serverStderr })
} finally {
  try { await client.close() } catch {}
}
if (outPath) writeFileSync(outPath, JSON.stringify({ calls: rows, serverStderr }, null, 2) + "\n")
for (const row of rows) console.log(JSON.stringify(row))
