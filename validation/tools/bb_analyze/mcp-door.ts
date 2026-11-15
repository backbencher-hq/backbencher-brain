// Real MCP stdio door for bb_analyze, against the SOURCE tree (not dist).
// Spawns `bun src/mcp/server.ts --dir <fixture>` and calls the tool through the
// protocol: one success case, one refusal case, plus a bounds case.
// BB_DATA_DIR=$PWD/validation/tools/bb_analyze/bbdata BB_NO_AUTO_REFRESH=1 \
//   npx tsx validation/tools/bb_analyze/mcp-door.ts
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const fixture = path.join(ROOT, "validation/tools/bb_analyze/work/behaviour")
const env = { ...(process.env as Record<string, string>) }

const transport = new StdioClientTransport({
  command: "bun",
  args: [path.join(ROOT, "src/mcp/server.ts"), "--dir", fixture],
  cwd: ROOT,
  stderr: "pipe",
  env,
})
const client = new Client({ name: "phase-a-door", version: "1.0.0" })
const results: any[] = []
async function call(id: string, args: Record<string, unknown>) {
  const r: any = await client.callTool({ name: "bb_analyze", arguments: args })
  const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  let parsed: any
  try { parsed = JSON.parse(text) } catch {}
  results.push({ id, args, isError: r?.isError === true, bytes: Buffer.byteLength(text), found: parsed?.found, summary: parsed?.summary ?? null, text: r?.isError ? text.slice(0, 200) : undefined })
}

await client.connect(transport)
const tools: any = await client.listTools()
const analyze = tools.tools.find((t: any) => t.name === "bb_analyze")
results.push({ id: "listTools", present: !!analyze, modes: analyze?.inputSchema?.properties?.mode?.enum, required: analyze?.inputSchema?.required })

await call("success:stats", { mode: "stats" })
await call("success:callers", { mode: "callers", target: "hub" })
await call("success:complexity-dir", { mode: "complexity", target: "src/util" })
await call("refusal:limit0", { mode: "dependencies", limit: 0 })
await call("refusal:unknown-option", { mode: "stats", verbose: true })
await call("refusal:limit-on-stats", { mode: "stats", limit: 5 })
await call("refusal:missing-mode", {})
await call("refusal:unknown-mode", { mode: "coupling" })
await call("bounds:test_quality-limit1", { mode: "test_quality", limit: 1 })
await call("alias:symbol", { mode: "callers", symbol: "hub" })

await client.close()
console.log(JSON.stringify({ door: "mcp-stdio-source", fixture, results }, null, 2))
