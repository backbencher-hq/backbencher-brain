// script/m54/probe-health-latency.ts — independent cold-start latency probe.
// NOT a reuse of m52's verifier: written fresh so the number cannot inherit
// m52's harness assumptions. Measures what users' clients measure: a FRESH
// `node bin/bb mcp` process, strict request→response round-trips, default
// bb_health (no flags), against the REAL index (BB_DATA_DIR=$HOME/.bb).
// 3 independent process launches, each with a warm-up call + measured call —
// separating one-time covering-index/open cost from steady-state per-call cost.

import { spawn } from "node:child_process"

const ROOT = "$HOME/mcp/backbencher-brain"
const BIN = `${ROOT}/bin/bb`

interface Result { ok: boolean; ms: number; detail: string }

function roundTrip(child: spawn.ChildProcess, id: number): Promise<Result> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let buf = ""
    const onData = (d: Buffer) => {
      buf += d.toString()
      for (const line of buf.split("\n")) {
        try {
          const msg = JSON.parse(line)
          if (msg.id === id) {
            child.stdout.off("data", onData)
            if (msg.error) return resolve({ ok: false, ms: Date.now() - t0, detail: `error: ${JSON.stringify(msg.error).slice(0, 120)}` })
            const files = msg.result?.content?.[0]?.text?.match(/"files":\s*(\d+)/)?.[1]
            return resolve({ ok: true, ms: Date.now() - t0, detail: `files=${files ?? "?"}` })
          }
        } catch { /* partial line */ }
      }
    }
    child.stdout.on("data", onData)
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "bb_health", arguments: {} } }) + "\n")
    setTimeout(() => { child.stdout.off("data", onData); resolve({ ok: false, ms: Date.now() - t0, detail: "TIMEOUT 180s" }) }, 180_000)
  })
}

const launches: { launch: number; initMs: number; warm: Result; measured: Result }[] = []
for (const i of [1, 2, 3]) {
  const child = spawn("node", [BIN, "mcp"], {
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: "$HOME/.bb" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let err = ""
  child.stderr.on("data", (d: Buffer) => { err += d.toString() })
  const t0 = Date.now()
  await new Promise<void>((resolve) => {
    child.stdout.once("data", () => resolve())
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m54-latency", version: "0" } } }) + "\n")
    setTimeout(() => resolve(), 60_000)
  })
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
  const initMs = Date.now() - t0
  const warm = await roundTrip(child, 2)
  const measured = await roundTrip(child, 3)
  console.log(`launch ${i}: init=${initMs}ms warm-up=${warm.ms}ms(${warm.detail}) measured=${measured.ms}ms(${measured.ok ? measured.detail : "FAILED: " + measured.detail}) stderr:${err ? err.slice(0, 100) : " clean"}`)
  launches.push({ launch: i, initMs, warm, measured })
  child.kill("SIGKILL")
}
// Evidence stamp (independent re-measurement of the M52 latency claim)
{
  const { execFileSync } = await import("node:child_process")
  const { mkdirSync: mk, writeFileSync: wr } = await import("node:fs")
  const path = await import("node:path")
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  mk(path.join(ROOT, "validation/m54/results"), { recursive: true })
  const measuredMs = launches.map(l => l.measured.ms)
  wr(path.join(ROOT, "validation/m54/results/LATENCY.json"), JSON.stringify({
    probe: "M54.latency-independent", milestone: "M54", at: new Date().toISOString(), commit,
    method: "3 fresh `node bin/bb mcp` launches, strict request→response round-trips, default bb_health, real index",
    launches: launches.map(l => ({ launch: l.launch, initMs: l.initMs, warmupMs: l.warm.ms, measuredMs: l.measured.ms, ok: l.measured.ok })),
    medianMeasuredMs: measuredMs.sort((a, b) => a - b)[Math.floor(measuredMs.length / 2)],
    baseline: "~37,000ms per-call (user report, pre-M52)",
    status: launches.every(l => l.measured.ok) ? "verified" : "known-gap",
  }, null, 2) + "\n")
}
