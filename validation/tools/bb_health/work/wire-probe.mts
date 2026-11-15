// Phase A wire probe: real MCP stdio request/response for bb_health through the
// SOURCE server, inspecting the raw JSON-RPC result object (does the advertised
// `healthy` channel survive the wire? are refusals isError?).
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const proj = path.join(REPO, "validation/tools/bb_health/work/proj-matrix")
const entry = path.join(REPO, "validation/tools/bb_health/work/source-server-entry.mts")
const dataDir = process.env.BB_DATA_DIR
if (!dataDir) throw new Error("BB_DATA_DIR required")

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", entry, "--dir", proj],
  cwd: REPO,
  stderr: "pipe",
  env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
})
const client = new Client({ name: "bb-health-phaseA-wire", version: "1.0.0" })
const call = async (name: string, args: Record<string, unknown>) => {
  const res: any = await client.callTool({ name, arguments: args })
  return { keys: Object.keys(res ?? {}), isError: res?.isError ?? false, healthy: res?.healthy, text: (res?.content ?? []).map((c: any) => c.text ?? "").join("\n") }
}
const out: any = { projectPath: proj, cases: {} }
try {
  await client.connect(transport)
  out.toolsCount = ((await client.listTools()) as any).tools.length
  out.toolsHasBbHealth = ((await client.listTools()) as any).tools.some((t: any) => t.name === "bb_health")
  const healthDescriptor = ((await client.listTools()) as any).tools.find((t: any) => t.name === "bb_health")
  out.advertisedSchemaKeys = Object.keys(healthDescriptor?.inputSchema?.properties ?? {})
  const d = await call("bb_health", {})
  out.cases.default = { keys: d.keys, isError: d.isError, healthy: d.healthy, head: d.text.split("\n").slice(0, 2).join(" | ") }
  const h = await call("bb_health", { history: true, limit: 2 })
  out.cases.history = { keys: h.keys, isError: h.isError, healthy: h.healthy, jsonKeys: (() => { try { return Object.keys(JSON.parse(h.text)) } catch { return null } })(), head: h.text.slice(0, 80).replace(/\n/g, " ") }
  const bad = await call("bb_health", { bogus: 1 })
  out.cases.unknownOption = { keys: bad.keys, isError: bad.isError, healthy: bad.healthy, head: bad.text.slice(0, 160) }
  const p = await call("bb_health", { paths: ["src/f2.ts"] })
  out.cases.paths = { keys: p.keys, isError: p.isError, healthy: p.healthy, head: p.text.split("\n").slice(0, 3).join(" | ") }
} finally {
  try { await client.close() } catch {}
}
console.log(JSON.stringify(out, null, 2))
