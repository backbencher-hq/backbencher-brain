// Real MCP stdio session against the SOURCE server entry: proves what the public
// door does (validation, aliases, refusals, payload) rather than what a direct
// handler call does. Read-only: BB_DATA_DIR is the tool's own fixture index and
// BB_NO_AUTO_REFRESH=1 is set by the caller.
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const FIXTURE = path.join(ROOT, "validation/tools/bb_impact/work/fixtures/basic")

const child = spawn("npx", ["tsx", path.join(ROOT, "src/mcp/server.ts"), "--dir", FIXTURE], {
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: path.join(ROOT, "validation/tools/bb_impact/bbdata"), BB_NO_AUTO_REFRESH: "1" },
  stdio: ["pipe", "pipe", "pipe"],
})
const rl = createInterface({ input: child.stdout! })
const pending = new Map<number, (msg: any) => void>()
rl.on("line", (line) => {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return
  let msg: any
  try { msg = JSON.parse(trimmed) } catch { return }
  if (typeof msg.id === "number" && pending.has(msg.id)) {
    pending.get(msg.id)!(msg)
    pending.delete(msg.id)
  }
})
let stderr = ""
child.stderr!.on("data", (d: Buffer) => { stderr += d.toString() })
let nextId = 1
function request(method: string, params: unknown, timeoutMs = 60_000): Promise<any> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)) }, timeoutMs)
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
  })
}
function notify(method: string, params: unknown) {
  child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
}

const results: any[] = []
const record = (id: string, payload: any) => { results.push({ id, ...payload }); console.log(JSON.stringify({ id, ...payload })) }

try {
  const init = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bb-impact-audit", version: "1" } })
  record("initialize", { ok: !init.error, server: init.result?.serverInfo ?? null })
  notify("notifications/initialized", {})

  const list = await request("tools/list", {})
  const tools = list.result?.tools ?? []
  const impact = tools.find((t: any) => t.name === "bb_impact")
  record("tools-list", {
    count: tools.length,
    impactPresent: !!impact,
    impactParams: impact ? Object.keys(impact.inputSchema?.properties ?? {}) : null,
    impactRequired: impact?.inputSchema?.required ?? null,
  })

  const call = async (id: string, args: Record<string, unknown>) => {
    const res = await request("tools/call", { name: "bb_impact", arguments: args }, 120_000)
    const content = res.result?.content?.[0]?.text ?? res.error?.message ?? ""
    let parsed: any = null
    try { parsed = JSON.parse(content) } catch { /* error text */ }
    record(id, {
      isError: res.result?.isError === true,
      rpcError: res.error?.message ?? null,
      errorText: parsed === null ? String(content).slice(0, 260) : undefined,
      summary: parsed && {
        shownCount: parsed.shownCount,
        totalCountIfKnown: parsed.totalCountIfKnown,
        directCount: parsed.directCount,
        truncated: parsed.truncated,
        truncationReason: parsed.truncationReason,
        root: parsed.root?.name,
        rootMatch: parsed.rootMatch,
        ruleTypes: parsed.rule?.relationshipTypes,
        cascade: parsed.cascade,
        countVerification: parsed.countVerification,
        freshness: parsed.freshness && { fresh: parsed.freshness.fresh, stale: parsed.freshness.stale, missing: parsed.freshness.missing },
        autoRefresh: parsed.autoRefresh ?? null,
      },
    })
  }

  await call("door-success", { symbol: "leaf" })
  await call("door-alias-target", { target: "leaf" })
  await call("door-empty-reltypes", { symbol: "leaf", relationshipTypes: [] })
  await call("door-unknown-option", { symbol: "leaf", maxDepth: 9 })
  await call("door-unknown-symbol", { symbol: "no_such_symbol_audit" })
  await call("door-refresh-false", { symbol: "leaf", refresh: false })
  await call("door-bogus-kind", { symbol: "leaf", relationshipTypes: ["not_a_stored_kind"] })
  await call("door-file-hint-mismatch", { symbol: "leaf", file: "src/nope.ts" })
  await call("door-file-hint-alias", { target: "leaf", file: "src/a.ts" })
} catch (e) {
  record("fatal", { error: String((e as Error).message).slice(0, 400), stderrTail: stderr.trim().split("\n").slice(-3) })
} finally {
  child.kill()
}
console.log("MCP_DOOR_DONE")
