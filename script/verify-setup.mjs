// verify-setup.mjs — spawn the PRODUCTION MCP path exactly as .vscode/mcp.json
// does (node bin/bb mcp --dir <ws>), against the freshly rebuilt index.
// Run with NODE so process.execPath resolves to node (compiled dist = Node-only).
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import path from "node:path"
import { fileURLToPath } from "node:url"

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(workspace, "bin/bb"), "mcp", "--dir", workspace],
  cwd: workspace,
  env: {
    ...process.env,
    BB_DATA_DIR: path.join(workspace, ".bb-data"),
    BB_CONFIG_FILE: path.join(workspace, "bb.json"),
  },
})
const client = new Client({ name: "bb-setup-verify", version: "1.0.0" })

function truncate(text, n = 900) {
  return text.length > n ? text.slice(0, n) + `\n… [${text.length - n} more chars]` : text
}

async function call(name, args = {}) {
  try {
    const res = await client.callTool({ name, arguments: args })
    const text = (res?.content ?? []).map((c) => c.text ?? "").join("\n")
    console.log(`\n━━━ ${name} ${res?.isError ? "[ERROR]" : ""} ━━━`)
    console.log(truncate(text))
  } catch (e) {
    console.log(`\n━━━ ${name} [THREW] ━━━ ${String(e?.message ?? e).slice(0, 400)}`)
  }
}

await client.connect(transport)
const tools = await client.listTools()
console.log(`✅ MCP handshake OK via node bin/bb — ${tools.tools.length} tools:`)
console.log(tools.tools.map((t) => t.name).join(", "))

await call("bb_health", {})
await call("bb_search", { query: "indexProjectParallel", limit: 3 })
await call("bb_security", {})
await call("bb_analyze", { mode: "stats" })

await client.close()
console.log("\nSETUP VERIFY COMPLETE")
process.exit(0)
