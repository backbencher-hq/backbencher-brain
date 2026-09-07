// test-live-mcp2.ts — exercise the NEWLY EXPOSED engine params against the
// compiled CLI server (node bin/bb). Run: bun run script/test-live-mcp2.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import path from "path"

const project = "$HOME/mcp/backbencher-brain"
const dataDir = path.join(project, ".bb-data")

const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(project, "bin", "bb"), "mcp", "--dir", project],
  cwd: project,
  env: { ...process.env, BB_DATA_DIR: dataDir },
  stderr: "pipe",
})
const client = new Client({ name: "live-test2", version: "1.0.0" })
let stderr = ""
;(transport as any).stderr?.on?.("data", (d: Buffer) => (stderr += d.toString()))

async function call(name: string, args: Record<string, unknown> = {}) {
  const res: any = await client.callTool({ name, arguments: args })
  const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  console.log(`\n=== ${name}(${JSON.stringify(args)}) ===`)
  console.log(text.slice(0, 900))
  return { text, isError: res?.isError ?? false }
}

let failures = 0
const check = (label: string, cond: boolean) => {
  console.log(cond ? `  ✓ ${label}` : `  ✗ FAIL: ${label}`)
  if (!cond) failures++
}

await client.connect(transport)
const tools = await client.listTools()
const names = tools.tools.map((t: any) => t.name)
// M48.H1 (#703): the public surface is 16 tools since the M28/M29 graph
// doors; the old assertion (15) and the bb_relationships probe predate it.
check("16 tools", names.length === 16)
check("bb_search has new params", JSON.stringify(tools.tools.find((t: any) => t.name === "bb_search")?.inputSchema ?? {}).includes("symbolKind") && JSON.stringify(tools.tools.find((t: any) => t.name === "bb_search")?.inputSchema ?? {}).includes("regex"))
check("bb_graph has maxDepth", JSON.stringify(tools.tools.find((t: any) => t.name === "bb_graph")?.inputSchema ?? {}).includes("maxDepth"))
check("bb_patterns has confidenceThreshold", JSON.stringify(tools.tools.find((t: any) => t.name === "bb_patterns")?.inputSchema ?? {}).includes("confidenceThreshold"))
check("bb_visualize has format", JSON.stringify(tools.tools.find((t: any) => t.name === "bb_visualize")?.inputSchema ?? {}).includes("format"))
check("bb_health has verbose", JSON.stringify(tools.tools.find((t: any) => t.name === "bb_health")?.inputSchema ?? {}).includes("verbose"))

let r = await call("bb_search", { query: "indexProjectParallel", symbolKind: "function", includeContent: true, limit: 1 })
check("search symbolKind+includeContent", r.text.includes("indexProjectParallel") && r.text.includes("typescript"))

r = await call("bb_search", { query: "startMcpServer", regex: true, exact: true, limit: 2 })
check("search regex+exact", r.text.includes("startMcpServer"))

r = await call("bb_graph", { symbol: "startMcpServer", maxDepth: 2 })
check("graph traversal at depth 2", r.text.includes("startMcpServer"))

r = await call("bb_health", { verbose: true })
check("health verbose (languages)", r.text.includes("languages:"))

r = await call("bb_patterns", { scope: "all", includeAntiPatterns: true, confidenceThreshold: 0.7, limit: 3 })
check("patterns with filters", r.text.includes("patterns") || r.text.includes("none"))

r = await call("bb_visualize", { format: "json", maxNodes: 20 })
check("visualize json", r.text.includes('"nodes"') && r.text.includes('"links"'))

await client.close()
console.log(failures === 0 ? "\nLIVE MCP2: ALL PASS" : `\nLIVE MCP2: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
