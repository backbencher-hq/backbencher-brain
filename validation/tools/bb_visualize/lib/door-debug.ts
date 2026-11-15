import { execFileSync } from "node:child_process"
import path from "node:path"
const HERE = path.resolve(import.meta.dirname!, "..")
const DATA_DIR = path.join(HERE, "bbdata")
const ROOT = path.resolve(HERE, "..", "..", "..")
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"
const repo = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories/graphql-js"
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
const transport = new StdioClientTransport({
  command: "node",
  args: ["--import", "tsx", path.join(ROOT, "src/cli/index.ts"), "mcp", "--dir", repo],
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" } as Record<string,string>,
  stderr: "pipe",
})
let stderr = ""
transport.stderr?.on("data", (c: Buffer) => { stderr += String(c) })
const client = new Client({ name: "debug", version: "1.0.0" })
try {
  await client.connect(transport)
  console.log("connected")
  const tools: any = await client.listTools()
  console.log("tools", tools.tools.length)
  const res: any = await client.callTool({ name: "bb_visualize", arguments: Object.assign({ format: "json" }, process.argv[3] ? JSON.parse(process.argv[3]) : {}) })
  console.log("call isError", res.isError, String(res.content?.[0]?.text ?? "").slice(0, 120))
  await client.close()
} catch (e: any) {
  console.log("CAUGHT", e?.message ?? String(e))
}
console.log("stderr:", stderr.split("\n").filter(Boolean).slice(-10).join("\n"))
