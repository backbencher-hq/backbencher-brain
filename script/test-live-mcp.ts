// test-live-mcp.ts — connect to `bb mcp` pointed at THIS repo and exercise the
// tools against the real index. Run: bun run script/test-live-mcp.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import path from "path"

const project = "$HOME/mcp/backbencher-brain"
const dataDir = path.join(project, ".bb-data")

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(project, "bin", "bb"), "mcp", "--dir", project],
  cwd: project,
  env: { ...process.env, BB_DATA_DIR: dataDir },
  stderr: "pipe",
})
const client = new Client({ name: "live-test", version: "1.0.0" })
let stderr = ""
;(transport as any).stderr?.on?.("data", (d: Buffer) => (stderr += d.toString()))

async function call(name: string, args: Record<string, unknown> = {}) {
  const res: any = await client.callTool({ name, arguments: args })
  const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return { text, isError: res?.isError ?? false }
}

await client.connect(transport)
console.log("connected to bb mcp (live)")

const tools = await client.listTools()
console.log(`tools listed: ${tools.tools.length}`)
console.log(tools.tools.map((t: any) => t.name).join(", "))

// real queries against this repo
let r = await call("bb_health")
console.log("\n--- bb_health ---\n" + r.text)

r = await call("bb_search", { query: "indexProjectParallel", limit: 3 })
console.log("\n--- bb_search 'indexProjectParallel' ---\n" + r.text)

r = await call("bb_search", { query: "startMcpServer", limit: 3 })
console.log("\n--- bb_search 'startMcpServer' ---\n" + r.text)

// M48.H1 (#703): the pre-0.3.0 aliases (bb_select/bb_relationships) were
// removed at 0.3.0 — this live probe now exercises the real surface
// (bb_search mode=symbol, bb_analyze mode=callers).
r = await call("bb_search", { mode: "symbol", symbolName: "startMcpServer" })
console.log("\n--- bb_search symbol 'startMcpServer' ---\n" + r.text.slice(0, 600))

r = await call("bb_analyze", { mode: "callers", target: "startMcpServer" })
console.log("\n--- bb_analyze callers of startMcpServer ---\n" + r.text)

r = await call("bb_ask", { query: "how does the mcp server start", limit: 3 })
console.log("\n--- bb_ask ---\n" + r.text.slice(0, 600))

await client.close()
console.log("\nLIVE MCP TEST: OK")
process.exit(0)
