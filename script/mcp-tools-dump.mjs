// mcp-tools-dump.mjs — print the authoritative MCP tool list + schemas as JSON.
// Usage: node script/mcp-tools-dump.mjs [--dir <project>]
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dirIdx = process.argv.indexOf("--dir")
const projectDir = dirIdx !== -1 ? process.argv[dirIdx + 1] : root

const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(root, "bin/bb"), "mcp", "--dir", projectDir],
  cwd: projectDir,
  env: { ...process.env, BB_DATA_DIR: path.join(root, ".bb-data"), BB_CONFIG_FILE: path.join(root, "bb.json") },
})
const client = new Client({ name: "tools-dump", version: "1.0.0" })
await client.connect(transport)
const tools = await client.listTools()
console.log(JSON.stringify(tools.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })), null, 2))
await client.close()
process.exit(0)
