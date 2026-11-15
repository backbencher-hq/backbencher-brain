// A real MCP stdio client for bb_migrate evidence.
//
// Spawns the SOURCE server entry (`npx tsx src/mcp/server.ts --dir <project>`) and speaks
// JSON-RPC over the wire, so what is exercised is the public door — validation, refusals,
// payload — not a direct handler import. BB_DATA_DIR and BB_NO_AUTO_REFRESH are forwarded
// explicitly: the MCP SDK's default child environment is an allowlist that drops BB_DATA_DIR,
// and a door that quietly reads a different index is not evidence about this one.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import path from "node:path"

export interface DoorOptions { dir: string; dataDir: string; label: string }

export interface Door {
  request(method: string, params: unknown, timeoutMs?: number): Promise<any>
  notify(method: string, params: unknown): void
  callTool(args: Record<string, unknown>, timeoutMs?: number): Promise<{ ms: number; isError: boolean; text: string; rpcError: string | null; parsed: any }>
  stderr(): string
  nonJsonStdout(): string[]
  close(): Promise<void>
  serverInfo: any
  tools: any[]
}

export async function openDoor(options: DoorOptions): Promise<Door> {
  const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
  const child: ChildProcessWithoutNullStreams = spawn("npx", ["tsx", path.join(ROOT, "src/mcp/server.ts"), "--dir", options.dir], {
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: options.dataDir, BB_NO_AUTO_REFRESH: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const pending = new Map<number, (msg: any) => void>()
  const nonJson: string[] = []
  let stderrText = ""
  const rl = createInterface({ input: child.stdout })
  rl.on("line", (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (!trimmed.startsWith("{")) { nonJson.push(trimmed.slice(0, 300)); return }
    let msg: any
    try { msg = JSON.parse(trimmed) } catch { nonJson.push(trimmed.slice(0, 300)); return }
    if (typeof msg.id === "number" && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id) }
  })
  child.stderr.on("data", (d: Buffer) => { stderrText += d.toString() })
  let nextId = 1
  const request = (method: string, params: unknown, timeoutMs = 120_000): Promise<any> => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method} after ${timeoutMs}ms`)) }, timeoutMs)
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  }
  const notify = (method: string, params: unknown) => { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n") }
  const door: Door = {
    request, notify,
    async callTool(args, timeoutMs = 180_000) {
      const started = Date.now()
      const res = await request("tools/call", { name: "bb_migrate", arguments: args }, timeoutMs)
      const ms = Date.now() - started
      const text = res.result?.content?.[0]?.text ?? res.error?.message ?? ""
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch { parsed = null }
      return { ms, isError: res.result?.isError === true, text, rpcError: res.error?.message ?? null, parsed }
    },
    stderr: () => stderrText,
    nonJsonStdout: () => nonJson,
    close: async () => { try { rl.close() } catch {} try { child.kill("SIGTERM") } catch {} },
    serverInfo: null,
    tools: [],
  }
  const init = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: `bb-migrate-${options.label}`, version: "1" } })
  door.serverInfo = init.result?.serverInfo ?? null
  notify("notifications/initialized", {})
  const list = await request("tools/list", {})
  door.tools = list.result?.tools ?? []
  return door
}
