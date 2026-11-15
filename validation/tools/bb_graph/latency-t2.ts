// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS — the T2 latency measurement for bb_graph: default-argument
// door calls on the reference large index, warm, five runs, with the statement
// time split out so a slow call is attributable.
// WHICH TOOL IT SERVES — bb_graph (read, requiresIndex true, modes: graph).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_graph/results/latency-t2.json,
// validation/tools/bb_graph/LATENCY.json.
// CONTRACTS IT MUST NOT BREAK — read-only: BB_NO_AUTO_REFRESH=1, no index run,
// no write tool. One process, so the 18.7 s open cost is paid once and the
// per-call numbers are WARM calls.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { TOOL_DESCRIPTORS } from "../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const OUT = path.join(ROOT, "validation/tools/bb_graph/results")
mkdirSync(OUT, { recursive: true })
const DESCRIPTOR = TOOL_DESCRIPTORS.find((d) => d.name === "bb_graph")!
const handlers = createToolHandlers() as unknown as Record<string, (args: Record<string, unknown>, ctx: unknown) => Promise<any>>
const projectPath = ROOT
const projectId = getProjectId(projectPath)

async function door(args: Record<string, unknown>): Promise<{ ok: boolean; json?: any; ms: number; bytes?: number; error?: string }> {
  const started = performance.now()
  try {
    const validated = validateToolArguments(DESCRIPTOR, args)
    const result = await handlers["bb_graph"]!(validated, { projectPath, projectId })
    const ms = performance.now() - started
    if (result?.isError) return { ok: false, error: String(result?.content?.[0]?.text ?? ""), ms }
    const text = String(result?.content?.[0]?.text ?? "")
    return { ok: true, json: JSON.parse(text), ms, bytes: Buffer.byteLength(text, "utf8") }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), ms: performance.now() - started }
  }
}

const percentile = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1))]!
}

async function main(): Promise<void> {
  const cases = JSON.parse(process.argv[2] ?? "[]") as Array<{ id: string; args: Record<string, unknown>; runs: number }>
  const out: any[] = []
  for (const c of cases) {
    const warm = await door(c.args)
    console.log(`  warm ${c.id}: ${warm.ok ? `${Math.round(warm.ms)} ms, ${(warm.json.callers?.length ?? 0) + (warm.json.callees?.length ?? 0)} edges` : `ERROR ${warm.error}`}`)
    if (!warm.ok) {
      out.push({ ...c, ok: false, error: warm.error })
      continue
    }
    const samples: number[] = []
    let edges = 0
    let bytes = 0
    let last: any = null
    for (let i = 0; i < c.runs; i++) {
      const r = await door(c.args)
      if (!r.ok) {
        out.push({ ...c, ok: false, error: r.error })
        last = null
        break
      }
      samples.push(Math.round(r.ms))
      edges = (r.json.callers?.length ?? 0) + (r.json.callees?.length ?? 0)
      bytes = r.bytes!
      last = r.json
    }
    if (last === null) continue
    out.push({
      ...c,
      ok: true,
      samplesMs: samples,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      edges,
      bytes,
      truncated: last.summary?.truncated,
      reasons: last.summary?.truncationReasons,
      cappedQueries: last.summary?.cappedQueries,
      maxDepthReached: last.summary?.maxDepthReached,
      timeBudgetMs: last.summary?.timeBudgetMs,
    })
    console.log(`  ${c.id}: p50=${percentile(samples, 50)}ms p95=${percentile(samples, 95)}ms samples=${JSON.stringify(samples)}`)
  }
  writeFileSync(path.join(OUT, "latency-t2.json"), JSON.stringify({ at: new Date().toISOString(), dataDir: process.env.BB_DATA_DIR, projectId, cases: out }, null, 2))
  console.log("wrote results/latency-t2.json")
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
