// validation/tools/bb_cross_language/work/mcp-door.mjs
//
// Phase A: bb_cross_language through the REAL MCP stdio door, from SOURCE (the
// dist/ build in this checkout predates the module split, so a dist run would
// measure a different tree). Spawns a child that calls startMcpServer(), speaks
// JSON-RPC over stdin/stdout, and records every frame.
import { spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const manifest = JSON.parse(readFileSync(join(HERE, "..", "results", "index-manifest.json"), "utf8"))
const workspace = manifest.tiers.T0.workspace
const dataDir = join(HERE, "..", "bbdata")

const child = spawn("npx", ["tsx", join(HERE, "mcp-server-child.mts"), workspace], {
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
  stdio: ["pipe", "pipe", "pipe"],
})
let buffer = ""
const frames = []
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    try { frames.push(JSON.parse(line)) } catch { frames.push({ nonJson: line.slice(0, 200) }) }
  }
})
let stderr = ""
child.stderr.on("data", (chunk) => { stderr += chunk.toString() })

const send = (message) => child.stdin.write(JSON.stringify(message) + "\n")
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await wait(100)
  }
  return predicate()
}

async function main() {
  // Wait for the child to attach before the handshake: npx+tsx start-up is
  // seconds, and a frame written before attach is not a measurement of the door.
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bb-audit", version: "1" } } })
  const ready = await waitFor(() => frames.some((f) => f.id === 1), 45000)
  if (!ready) {
    console.error("no initialize response", JSON.stringify({ frames, stderr }))
    process.exitCode = 1
    child.kill()
    return
  }
  send({ jsonrpc: "2.0", method: "notifications/initialized" })
  await wait(200)
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  await wait(500)
  const calls = [
    { id: "success", args: { symbol: "Inventory" } },
    { id: "alias-target", args: { target: "Inventory" } },
    { id: "alias-symbolName", args: { symbolName: "restock" } },
    { id: "alias-query", args: { query: "restock" } },
    { id: "bounded", args: { symbol: "Inventory", limit: 1 } },
    { id: "blank", args: { symbol: "   " } },
    { id: "empty-string", args: { symbol: "" } },
    { id: "missing", args: {} },
    { id: "unknown", args: { symbol: "no-such-name-xyz" } },
    { id: "limit-zero", args: { symbol: "Inventory", limit: 0 } },
    { id: "limit-too-big", args: { symbol: "Inventory", limit: 1001 } },
    { id: "limit-fractional", args: { symbol: "Inventory", limit: 2.5 } },
    { id: "limit-string", args: { symbol: "Inventory", limit: "5" } },
    { id: "unknown-option", args: { symbol: "Inventory", bogus: 1 } },
    { id: "aliases-conflict", args: { symbol: "Inventory", target: "restock" } },
  ]
  for (const [i, call] of calls.entries()) {
    send({ jsonrpc: "2.0", id: 100 + i, method: "tools/call", params: { name: "bb_cross_language", arguments: call.args } })
    await wait(120)
  }
  await wait(800)
  child.stdin.end()
  await wait(500)
  try { child.kill() } catch {}

  await waitFor(() => frames.some((f) => f.id === 119), 30000)
  const toolsList = frames.find((f) => f.id === 2)
  const descriptor = toolsList?.result?.tools?.find((t) => t.name === "bb_cross_language")
  const results = {}
  for (const [i, call] of calls.entries()) {
    const frame = frames.find((f) => f.id === 100 + i)
    const result = frame?.result
    const text = result?.content?.[0]?.text ?? ""
    let parsed = null
    try { parsed = JSON.parse(text) } catch {}
    results[call.id] = {
      isError: result?.isError === true,
      textHead: text.slice(0, 200),
      ...(parsed ? { symbol: parsed.symbol, ownFactCount: parsed.ownFactCount, memberFactCount: parsed.memberFactCount, declaredAbsent: parsed.declaredAbsent, limit: parsed.limit, truncated: parsed.truncated } : {}),
    }
  }
  const output = {
    schemaVersion: 1,
    tool: "bb_cross_language",
    door: "MCP stdio from SOURCE (npx tsx startMcpServer) — dist/ predates the module split in this checkout",
    workspace,
    serverInfo: frames.find((f) => f.id === 1)?.result?.serverInfo ?? null,
    descriptor: descriptor ? { name: descriptor.name, required: descriptor.inputSchema?.required, properties: Object.keys(descriptor.inputSchema?.properties ?? {}) } : null,
    toolCount: toolsList?.result?.tools?.length ?? null,
    results,
    stderrTail: stderr.trim().split("\n").slice(-5),
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(join(HERE, "..", "results", "AUDIT-mcp-door.json"), JSON.stringify(output, null, 2) + "\n")
  console.log(JSON.stringify({ serverInfo: output.serverInfo, toolCount: output.toolCount, results }, null, 2))
}
main().catch((error) => { console.error(error); process.exit(1) })
