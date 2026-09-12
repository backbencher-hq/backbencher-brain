// script/m57/probe-scope-all.ts — M57.T3 (#791) independent latency/parity probe.
//
// Measures `bb_patterns` scope=all through the PRODUCTION surface. Two modes:
//   --mode src   : run the engine directly (bun + src/) — engine-level digest
//   --mode dist  : run `node bin/bb mcp` round-trips — what clients measure
// The dist mode is how BEFORE (old dist) vs AFTER (rebuilt dist) are compared
// on the SAME corpus: identical invocation, only the compiled engine changes.
//
// Output: one JSON line with p50 latency and a SHA-256 digest of the findings
// payload (sorted fingerprint list) so parity is proven, not asserted.

const ROOT = "$HOME/mcp/backbencher-brain"
const mode = process.argv.includes("--dist") ? "dist" : "src"
const ROUNDS = Number(process.env.BB_M57_ROUNDS ?? 3)

function digest(payload: any): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto")
  const items = (payload.patterns ?? []).map((p: any) =>
    [p.type, p.confidence, p.location?.file, p.location?.line, p.location?.symbol, p.severity].join("|"),
  )
  items.sort()
  const stats = payload.statistics ?? {}
  return createHash("sha256")
    .update(JSON.stringify({ items, stats, scan: payload.scan ?? null }))
    .digest("hex")
    .slice(0, 16)
}

async function main() {
  if (mode === "src") {
    process.env.BB_DATA_DIR = process.env.BB_DATA_DIR || "$HOME/.bb"
    const { BrainDatabase } = await import(`${ROOT}/src/brain/database`)
    const { getProjectId } = await import(`${ROOT}/src/cli/index`)
    const { PatternBrainTools } = await import(`${ROOT}/src/ast/tools`)
    const pid = getProjectId(ROOT) as any
    await BrainDatabase.getRawInstance(pid)
    const times: number[] = []
    let dig: string | null = null
    for (let i = 0; i < ROUNDS; i++) {
      const t0 = performance.now()
      const r: any = await PatternBrainTools.detectPatterns(pid, {
        includeOrphaned: true, includeFramework: true, includeAntiPatterns: true,
        confidenceThreshold: 0.6, maxResults: 100,
      })
      times.push(performance.now() - t0)
      dig = digest(r)
    }
    times.sort((a, b) => a - b)
    console.log(JSON.stringify({ mode, p50: Math.round(times[Math.floor(times.length / 2)]), rounds: ROUNDS, digest: dig }))
    await BrainDatabase.closeAll()
    return
  }

  // dist mode: production stdio round-trips
  const { spawn } = await import("node:child_process")
  const init = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m57-probe", version: "0" } } })
  const call = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "bb_patterns", arguments: { scope: "all", limit: 100, confidenceThreshold: 0.6 } } })

  const times: number[] = []
  let dig: string | null = null
  for (let i = 0; i < ROUNDS + 1; i++) { // first round is warm-up
    const child = spawn("node", [`${ROOT}/bin/bb`, "mcp"], { stdio: ["pipe", "pipe", "pipe"] })
    let buf = ""
    const parsed: any[] = []
    child.stdout.on("data", (d) => { buf += d.toString() })
    const t0 = performance.now()
    child.stdin.write(init + "\n")
    // wait for init result, then send the call
    await new Promise<void>((res) => {
      const iv = setInterval(() => { if (buf.includes('"id":0')) { clearInterval(iv); res() } }, 20)
      setTimeout(() => { clearInterval(iv); res() }, 5000)
    })
    child.stdin.write(call + "\n")
    await new Promise<void>((res) => {
      const iv = setInterval(() => {
        if (buf.includes('"id":1')) {
          clearInterval(iv); res()
        }
      }, 20)
      setTimeout(() => { clearInterval(iv); res() }, 60000)
    })
    const ms = performance.now() - t0
    child.kill("SIGTERM")
    if (i === 0) continue // warm-up
    times.push(ms)
    const line = buf.split("\n").find((l) => l.includes('"id":1'))
    try { parsed.push(JSON.parse(line!)); dig = digest(parsed[0]?.result) } catch { /* keep null */ }
  }
  times.sort((a, b) => a - b)
  console.log(JSON.stringify({ mode, p50: Math.round(times[Math.floor(times.length / 2)]), rounds: ROUNDS, digest: dig, warmupExcluded: true }))
}

main().catch((e) => { console.error("PROBE FAIL", e?.stack || e?.message); process.exit(1) })
