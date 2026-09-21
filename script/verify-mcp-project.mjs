// verify-mcp-project.mjs — spawn a bb MCP server for an arbitrary project
// exactly as opencode does, and prove it serves THAT project's index.
// Usage: node script/verify-mcp-project.mjs <projectDir> [dataDir]
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const projectDir = process.argv[2]
const dataDir = process.argv[3] || path.join(process.env.HOME ?? "", ".bb")
if (!projectDir) {
  console.error("usage: node script/verify-mcp-project.mjs <projectDir> [dataDir]")
  process.exit(1)
}

const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(root, "bin/bb"), "mcp", "--dir", projectDir],
  cwd: projectDir,
  env: { ...process.env, BB_DATA_DIR: dataDir },
})
const client = new Client({ name: "verify-project", version: "1.0.0" })

async function call(name, args = {}) {
  try {
    const res = await client.callTool({ name, arguments: args })
    const text = (res?.content ?? []).map((c) => c.text ?? "").join("\n")
    console.log(`\n━━━ ${name}${res?.isError ? " [ERROR]" : ""} ━━━`)
    console.log(text.length > 900 ? text.slice(0, 900) + `\n… [${text.length - 900} more]` : text)
  } catch (e) {
    console.log(`\n━━━ ${name} [THREW] ━━━ ${String(e?.message ?? e).slice(0, 300)}`)
  }
}

await client.connect(transport)
const tools = await client.listTools()
console.log(`✅ ${projectDir} — MCP handshake OK, ${tools.tools.length} tools`)
await call("bb_health", {})
await call("bb_search", { query: "main", limit: 3 })
await client.close()
console.log("\nVERIFY COMPLETE")
process.exit(0)
