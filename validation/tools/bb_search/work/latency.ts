// Warm latency measurement for bb_search through the real MCP stdio door.
//
// Usage (node product runtime, better-sqlite3):
//   BB_DATA_DIR=<dir> BB_NO_AUTO_REFRESH=1 node_modules/.bin/tsx latency.ts <label> <projectDir> <calls.json> <out.json>
//
// One server process per tier; every call is warmed once (discarded) and then run
// five times. p50/p95 use the nearest-rank method on the measured samples.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..", "..", "..", "..")
const [label, projectDir, callsPath, outPath] = process.argv.slice(2)
if (!label || !projectDir || !callsPath || !outPath) {
  console.error("usage: latency.ts <label> <projectDir> <calls.json> <out.json>")
  process.exit(2)
}
const calls = JSON.parse(readFileSync(callsPath, "utf8")) as Array<{ label: string; args: Record<string, unknown> }>
const RUNS = 5
// BB_LATENCY_RUNTIME=compiled measures the shipped artifact (`node bin/bb mcp --dir`),
// which is what an MCP host spawns; source runs through tsx so the shipped artifact is
// the honest product subject. `source` measures the working tree under tsx.
const compiled = process.env.BB_LATENCY_RUNTIME === "compiled"
const transport = new StdioClientTransport({
  command: process.execPath,
  args: compiled
    ? [path.join(repoRoot, "bin", "bb"), "mcp", "--dir", projectDir]
    : [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(here, "node-server-entry.ts"), "--dir", projectDir],
  cwd: repoRoot,
  stderr: "pipe",
  // The MCP SDK sanitizes the child environment; forward it so BB_DATA_DIR and
  // BB_NO_AUTO_REFRESH reach the server instead of the default ~/.bb.
  env: { ...process.env } as Record<string, string>,
})
const client = new Client({ name: "bb-search-latency", version: "1.0.0" })

const pct = (sorted: number[], p: number): number => {
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!
}
const round = (n: number): number => Math.round(n * 100) / 100

const results: any[] = []
try {
  await client.connect(transport)
  for (const call of calls) {
    // warm: prove the path works and pay any one-time cost
    const warm = await client.callTool({ name: "bb_search", arguments: call.args })
    const warmText = (warm?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    const samples: number[] = []
    let isError = warm?.isError === true
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now()
      const response = await client.callTool({ name: "bb_search", arguments: call.args })
      samples.push(performance.now() - t0)
      if (response?.isError === true) isError = true
    }
    const sorted = [...samples].sort((a, b) => a - b)
    results.push({
      label: call.label,
      args: call.args,
      isError,
      runs: samples.map(round),
      p50: round(pct(sorted, 50)),
      p95: round(pct(sorted, 95)),
      min: round(sorted[0]!),
      max: round(sorted[sorted.length - 1]!),
      warmTextHead: warmText.slice(0, 120),
    })
    console.error(`${label}/${call.label}: p50=${round(pct(sorted, 50))}ms p95=${round(pct(sorted, 95))}ms`)
  }
} finally {
  try { await client.close() } catch {}
}
writeFileSync(outPath, JSON.stringify({
  tier: label,
  runtime: `${compiled ? "compiled dist via node bin/bb mcp" : "working-tree source via tsx"} — node ${process.version} (better-sqlite3)`,
  projectDir,
  bbDataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  env: { BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? null },
  runsPerCall: RUNS,
  generatedAt: new Date().toISOString(),
  results,
}, null, 2) + "\n")
