// Single-invocation runner for bb_analyze behaviour + latency measurements.
//   npx tsx validation/tools/bb_analyze/run-one.ts '<json args>' [projectDir]
// Env:
//   BB_REPEAT=n   -> one warm-up call, then n timed calls (in one process, so the
//                    data-dir handle is warm); prints { runs: [...], p50, p95, ... }
//   default       -> one timed call; prints { ms, ... }
// The handler is reached through the SAME validate -> handler path the MCP door uses.
import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../src/mcp/tool-handlers"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const rawArgs = process.argv[2] ?? "{}"
const dir = path.resolve(process.argv[3] ?? process.cwd())
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_analyze")!
const handler = createToolHandlers()["bb_analyze"]
const repeat = Number(process.env.BB_REPEAT ?? "0")

async function once() {
  const t0 = process.hrtime.bigint()
  const args = JSON.parse(rawArgs)
  const validated = validateToolArguments(descriptor, args)
  const res = await handler(validated, { projectPath: dir, projectId: getProjectId(dir) })
  const text = res.content.map((c: any) => c.text).join("\n")
  let parsed: any
  try { parsed = JSON.parse(text) } catch {}
  return {
    args,
    ok: res.isError !== true,
    isError: res.isError === true,
    bytes: Buffer.byteLength(text),
    summary: parsed?.summary ?? null,
    freshness: parsed?.freshness ?? null,
    ms: Number(process.hrtime.bigint() - t0) / 1e6,
  }
}

const base = { dir, projectId: getProjectId(dir) }
try {
  if (repeat > 0) {
    const warm = await once()
    const runs: number[] = []
    let last = warm
    for (let i = 0; i < repeat; i++) {
      last = await once()
      runs.push(Number(last.ms.toFixed(1)))
    }
    const sorted = [...runs].sort((a, b) => a - b)
    const rank = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
    console.log(JSON.stringify({ ...base, args: last.args, ok: last.ok, isError: last.isError, bytes: last.bytes, warmupMs: Number(warm.ms.toFixed(1)), runs, p50: rank(0.5), p95: rank(0.95), min: sorted[0], max: sorted[sorted.length - 1], freshness: last.freshness }))
  } else {
    const out = await once()
    console.log(JSON.stringify({ ...base, ...out }))
  }
} catch (e: any) {
  console.log(JSON.stringify({ ...base, args: rawArgs, ok: false, thrown: e?.message ?? String(e) }))
}
