// script/m52/tmp/probe-dist-session.ts — one-off probe (M52 follow-up).
// Measures PER-CALL bb_health latency inside ONE long-lived MCP session served
// by the INSTALLED binary (dist compiled output under node) against the real
// index — the exact scenario the user's 37s report described and the co-agent's
// timing tests will exercise. Strictly sequential request→response round-trips.
// Not a gate; a measurement instrument.

import { spawn } from "node:child_process"

const ROOT = "$HOME/mcp/backbencher-brain"
const HEALTH_CALLS = 5

const frame = (id: number, method: string, params?: any) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n"
const notif = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"

const child = spawn("node", ["bin/bb", "mcp"], {
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: "$HOME/.bb" },
  stdio: ["pipe", "pipe", "pipe"],
})
child.stderr.on("data", (d) => process.stderr.write(`[child] ${d}`))

const t0 = performance.now()
let sentAt = 0
let pending = 1 // id of the single outstanding request
const healthRtts: number[] = []
let buf = ""

child.stdout.on("data", (d) => {
  buf += d.toString()
  let idx
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    let msg: any
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id !== pending || (!msg.result && !msg.error)) continue
    if (pending === 1) {
      console.log(`initialize: ${Math.round(performance.now() - t0)}ms since spawn${msg.error ? " ERROR" : ""}`)
      sentAt = performance.now()
      child.stdin.write(notif)
      child.stdin.write(frame(pending + 1, "tools/call", { name: "bb_health", arguments: {} }))
      pending = 2
    } else {
      const rtt = Math.round(performance.now() - sentAt)
      const text = msg.result?.content?.[0]?.text ?? ""
      const first = text.split("\n").find((l: string) => l.startsWith("files=")) ?? ""
      const err = msg.error ? ` ERROR=${JSON.stringify(msg.error).slice(0, 160)}` : ""
      healthRtts.push(rtt)
      console.log(`bb_health call ${pending - 1}/${HEALTH_CALLS}: ${rtt}ms${err} ${first}`)
      if (healthRtts.length >= HEALTH_CALLS) {
        const sorted = [...healthRtts].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        console.log(`SUMMARY: [${healthRtts.join(", ")}] ms — median ${median}ms, min ${sorted[0]}ms, max ${sorted[sorted.length - 1]}ms (sequential, single session, dist under node, real index)`)
        child.kill()
        process.exit(0)
      }
      sentAt = performance.now()
      child.stdin.write(frame(pending + 1, "tools/call", { name: "bb_health", arguments: {} }))
      pending += 1
    }
  }
})

sentAt = performance.now()
child.stdin.write(frame(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "0.0.1" } }))
setTimeout(() => { console.error(`TIMEOUT after 120s (got ${healthRtts.length}/${HEALTH_CALLS} calls) — pending id ${pending} never answered`); child.kill(); process.exit(2) }, 120_000)
