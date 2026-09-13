// script/m57/probe-scope-all-warm.ts — M57.T3 (#791) warm-session probe.
//
// The cold probe (probe-scope-all.ts --dist) spawns a fresh `node bin/bb mcp`
// per round, so its number includes Node boot + MCP handshake (~2.6s of the
// ~3.5s). NO agent experiences that: MCP clients keep ONE long-lived server and
// issue many calls. The number agents live in is the WARM per-call time.
//
// Method: spawn ONE server, initialize once, then issue N sequential
// `bb_patterns scope=all` round-trips on the SAME connection and time each
// request→response. Reports min/p50/max. Also times a bb_health call in the
// same session, so the two headline tools are measured under identical
// conditions.
//
// Usage: BB_DATA_DIR=<dir> BB_M57_ROUNDS=5 bun run script/m57/probe-scope-all-warm.ts

const ROOT = "$HOME/mcp/backbencher-brain"
const ROUNDS = Number(process.env.BB_M57_ROUNDS ?? 5)

async function main() {
  const { spawn } = await import("node:child_process")
  const child = spawn("node", [`${ROOT}/bin/bb`, "mcp"], { stdio: ["pipe", "pipe", "pipe"] })
  let buf = ""
  child.stdout.on("data", (d) => { buf += d.toString() })
  let stderr = ""
  child.stderr.on("data", (d) => { stderr += d.toString() })

  const send = (obj: unknown) => child.stdin.write(JSON.stringify(obj) + "\n")
  const waitForId = async (id: number, timeoutMs: number) => {
    const t0 = performance.now()
    const iv = setInterval(() => {
      // responses are one JSON object per line
      const hit = buf.split("\n").some((l) => {
        try { return JSON.parse(l).id === id } catch { return false }
      })
      if (hit) { clearInterval(iv); (waitForId as any)._resolve?.() }
    }, 10)
    await new Promise<void>((res) => {
      (waitForId as any)._resolve = res
      setTimeout(() => { clearInterval(iv); res() }, timeoutMs)
    })
    return performance.now() - t0
  }

  send({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m57-warm", version: "0" } } })
  await waitForId(0, 20000)

  const call = async (id: number, name: string, args: Record<string, unknown>) => {
    const marker = `"id":${id}`
    const before = buf.length
    send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
    const t0 = performance.now()
    let ms = -1
    for (let waited = 0; waited < 120000; waited += 20) {
      const tail = buf.slice(before)
      if (tail.includes(marker)) {
        // confirm it is a complete JSON line
        const done = tail.split("\n").some((l) => { try { const o = JSON.parse(l); return o.id === id } catch { return false } })
        if (done) { ms = performance.now() - t0; break }
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    return ms
  }

  const patterns: number[] = []
  for (let i = 1; i <= ROUNDS; i++) {
    const ms = await call(i, "bb_patterns", { scope: "all", limit: 100, confidenceThreshold: 0.6 })
    if (ms >= 0) patterns.push(Math.round(ms))
  }
  const health: number[] = []
  for (let i = 0; i < ROUNDS; i++) {
    const ms = await call(100 + i, "bb_health", {})
    if (ms >= 0) health.push(Math.round(ms))
  }
  child.kill("SIGTERM")

  const stat = (a: number[]) => {
    if (!a.length) return null
    const s = [...a].sort((x, y) => x - y)
    return { min: s[0], p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] }
  }
  console.log(JSON.stringify({
    mode: "warm-single-session",
    rounds: ROUNDS,
    bb_patterns_scope_all: stat(patterns),
    bb_health: stat(health),
    raw: { patterns, health },
    stderrTail: stderr.slice(-300) || null,
  }))
  process.exit(0)
}

main().catch((e) => { console.error("PROBE FAIL", e?.stack || e?.message); process.exit(1) })
