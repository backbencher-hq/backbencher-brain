// Client-observed latency of a warm default bb_health call, through a real MCP
// stdio session on the SOURCE server (the same door an agent uses).
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
const REPO = path.resolve(import.meta.dirname ?? ".", "../../../..")
const dataDir = process.env.BB_DATA_DIR
if (!dataDir) throw new Error("BB_DATA_DIR required")
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", path.join(REPO, "validation/tools/bb_health/work/source-server-entry.mts"), "--dir", REPO],
  cwd: REPO,
  stderr: "pipe",
  env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
})
const client = new Client({ name: "bb-health-wire-latency", version: "1.0.0" })
await client.connect(transport)
const call = async () => {
  const t0 = process.hrtime.bigint()
  const res: any = await client.callTool({ name: "bb_health", arguments: {} })
  return { ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6), healthy: res?.healthy, text: (res?.content ?? []).map((c: any) => c.text).join("\n") }
}
const first = await call()
const warm: number[] = []
let text = first.text
for (let i = 0; i < Number(process.env.BB_WIRE_RUNS ?? 5); i++) { const r = await call(); warm.push(r.ms); text = r.text }
const sorted = [...warm].sort((a, b) => a - b)
await client.close()
console.log(JSON.stringify({ firstCallMs: first.ms, warmMs: warm, warmMinMs: Math.min(...warm), warmMaxMs: Math.max(...warm), p50Ms: sorted[Math.floor((sorted.length - 1) / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)], thisCallLine: text.split("\n").find((l: string) => l.startsWith("this call:")) }, null, 2))
