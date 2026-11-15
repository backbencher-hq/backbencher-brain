import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const corpus = "/home/ishaq2321/bb_tests/repositories/rake"
const transport = new StdioClientTransport({ command: process.env.MCP_NODE ?? process.execPath, args: [path.join(REPO,"bin","bb"), "mcp", "--dir", corpus], cwd: REPO, env: process.env as Record<string,string>, stderr: "pipe" })
const client = new Client({ name: "probe", version: "1.0.0" })
await client.connect(transport)
const tools = await client.listTools()
console.log("tools:", tools.tools.map((t:any)=>t.name).join(","))
const r: any = await client.callTool({ name: "bb_doc", arguments: { mode: "project", format: "json" } })
console.log("isError:", r.isError, "text:", (r.content??[]).map((c:any)=>c.text).join("\n").slice(0, 400))
await client.close()
