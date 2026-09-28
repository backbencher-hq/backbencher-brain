// script/m50/probe-a1-latency.ts — M50.A1 latency census.
// Measures what a real agent client measures: FRESH `node bin/bb mcp` process
// (production shape), strict request→response round-trips, against the REAL
// index. Every registered read tool, one representative call each.
//
// Usage: bun run script/m50/probe-a1-latency.ts <caseIndex>
//   One CASE per invocation (a hanging tool cannot starve the rest): fresh
//   process, 1 warm-up + 3 measured calls, per-call timeout 45s. Writes
//   validation/m50/results/A1-case-<idx>.json. A combiner merges all cases.
// No simulation; timeouts are recorded as verdicts, not skipped.

import { spawn } from "node:child_process"

const ROOT = "$HOME/mcp/backbencher-brain"
const BIN = `${ROOT}/bin/bb`
const REPO = "$HOME/mcp/backbencher-brain"

type Case = { name: string; args: Record<string, unknown> }
const CASES: Case[] = [
  { name: "bb_search", args: { mode: "symbols", query: "storeResults" } },
  { name: "bb_ask", args: { query: "where are foreign keys enforced?" } },
  // NOTE: bb_graph takes `symbol` (not target/direction) — parameter-shape
  // divergence from bb_analyze callers recorded as an A1 usability finding.
  { name: "bb_graph", args: { symbol: "storeResults", maxDepth: 2 } },
  { name: "bb_analyze", args: { mode: "callers", target: "storeResults" } },
  { name: "bb_analyze", args: { mode: "stats" } },
  { name: "bb_analyze", args: { mode: "test_gaps" } },
  { name: "bb_analyze", args: { mode: "test_mapping" } },
  { name: "bb_analyze", args: { mode: "test_quality" } },
  { name: "bb_analyze", args: { mode: "complexity" } },
  { name: "bb_analyze", args: { mode: "dependencies", filePath: "src/ast/parallel-indexer.ts" } },
  { name: "bb_analyze", args: { mode: "impact", target: "storeResults" } },
  { name: "bb_health", args: {} },
  { name: "bb_doc", args: { mode: "symbol", target: "storeResults" } },
  { name: "bb_patterns", args: {} },
  { name: "bb_security", args: {} },
  { name: "bb_visualize", args: { format: "json" } },
  // NOTE: bb_impact also takes `symbol` (like bb_graph) while bb_analyze
  // impact takes `target` — divergence recorded as an A1 usability finding.
  { name: "bb_impact", args: { symbol: "storeResults" } },
  // NOTE: third graph-family tool taking `symbol` — divergence from
  // bb_analyze/bb_search's `target`/`query` naming recorded as A1 finding.
  { name: "bb_cross_language", args: { symbol: "getProjectId" } },
  { name: "bb_annotate", args: {} },
  { name: "bb_annotations", args: {} },
]

interface Sample { ok: boolean; ms: number; detail: string }

function call(child: spawn.ChildProcess, nextId: () => number, c: Case, timeoutMs: number): Promise<Sample> {
  return new Promise((resolve) => {
    const id = nextId()
    const t0 = Date.now()
    let buf = ""
    const onData = (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.id === id) {
            child.stdout.off("data", onData)
            if (msg.error) return resolve({ ok: false, ms: Date.now() - t0, detail: `rpc-error: ${JSON.stringify(msg.error).slice(0, 140)}` })
            const text = msg.result?.content?.[0]?.text ?? ""
            const isErr = msg.result?.isError === true
            const head = text.replace(/\s+/g, " ").slice(0, 100)
            return resolve({ ok: !isErr && text.length > 0, ms: Date.now() - t0, detail: `${isErr ? "TOOL-ERROR" : "ok"} bytes=${text.length} :: ${head}` })
          }
        } catch { /* partial line */ }
      }
    }
    child.stdout.on("data", onData)
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: c.name, arguments: c.args } }) + "\n")
    setTimeout(() => { child.stdout.off("data", onData); resolve({ ok: false, ms: Date.now() - t0, detail: "TIMEOUT" }) }, timeoutMs)
  })
}

function pctl(xs: number[], p: number): number {
  if (!xs.length) return -1
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

async function main() {
  const perCase: Record<string, { samples: Sample[] }> = {}
  for (const c of CASES) perCase[`${c.name} ${JSON.stringify(c.args).slice(0, 40)}`] = { samples: [] }

  const argIdx = Number(process.argv[2])
  const selected = Number.isInteger(argIdx) && argIdx >= 0 && argIdx < CASES.length ? [CASES[argIdx]] : CASES
  // Env-tunable so a known-hanging tool still yields a PERSISTED receipt:
  // BB_M50_CALL_TIMEOUT_MS (per-call), BB_M50_LAUNCHES, BB_M50_REPS.
  const callTimeoutMs = Number(process.env.BB_M50_CALL_TIMEOUT_MS || 45_000)
  const launchesN = Number(process.env.BB_M50_LAUNCHES || 3)
  const reps = Number(process.env.BB_M50_REPS || 3)

  for (let launch = 1; launch <= launchesN; launch++) {
    const child = spawn("node", [BIN, "mcp"], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } })
    let buf = ""
    let idc = 0
    const nextId = () => ++idc
    // init handshake
    await new Promise<void>((res) => {
      const on = (d: Buffer) => {
        buf += d.toString()
        if (buf.includes('"result"')) { child.stdout.off("data", on); res() }
      }
      child.stdout.on("data", on)
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m50-probe", version: "0" } } }) + "\n")
      setTimeout(res, 30_000)
    })
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")

    // warm-up pass (results discarded)
    for (const c of selected) await call(child, nextId, c, callTimeoutMs)
    // measured pass xN
    for (let rep = 0; rep < reps; rep++) {
      for (const c of selected) {
        const key = `${c.name} ${JSON.stringify(c.args).slice(0, 40)}`
        const s = await call(child, nextId, c, callTimeoutMs)
        perCase[key].samples.push(s)
        console.error(`[${c.name}] ${s.ok ? "ok" : "FAIL"} ${s.ms}ms`) 
      }
    }
    child.kill()
    console.error(`launch ${launch}/3 done`)
  }

  const report: Record<string, { p50: number; p95: number; max: number; okRatio: number; n: number; sampleDetail: string }> = {}
  for (const [k, v] of Object.entries(perCase)) {
    const ms = v.samples.map((s) => s.ms)
    const oks = v.samples.filter((s) => s.ok).length
    report[k] = {
      p50: pctl(ms, 50), p95: pctl(ms, 95), max: Math.max(...ms),
      okRatio: oks / v.samples.length, n: v.samples.length,
      sampleDetail: v.samples.find((s) => !s.ok)?.detail ?? v.samples[0]?.detail ?? "",
    }
  }
  const fs = await import("node:fs")
  fs.mkdirSync("$HOME/mcp/backbencher-brain/validation/m50/results", { recursive: true })
  // A2 re-runs the SAME harness against the fixed build; the prefix keeps A1
  // receipts immutable (BB_M50_OUT_PREFIX=A2 -> A2-case-<idx>.json).
  const prefix = process.env.BB_M50_OUT_PREFIX || "A1"
  const outFile = Number.isInteger(argIdx)
    ? `$HOME/mcp/backbencher-brain/validation/m50/results/${prefix}-case-${argIdx}.json`
    : `$HOME/mcp/backbencher-brain/validation/m50/results/${prefix}-latency.json`
  fs.writeFileSync(outFile,
    JSON.stringify({ probe: `M50.${prefix}-latency`, at: new Date().toISOString(), repo: REPO, runtime: "node bin/bb mcp (production shape)", launches: launchesN, measuredPerLaunch: reps, callTimeoutMs, report }, null, 2) + "\n")
  console.log(JSON.stringify(report, null, 2))
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
