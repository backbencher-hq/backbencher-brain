// T2 latency, per-call capped: records the cost of a single default-argument
// bb_impact call on the workspace's reference large index, across the incoming-
// dependency rank spectrum. Read-only load (BB_DATA_DIR=.bb-data,
// BB_NO_AUTO_REFRESH=1). Writes JSON incrementally so a slow candidate cannot
// lose the faster rows.
import { writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const DEP_KINDS = ["calls", "instantiates", "extends", "implements"]
const pid = getProjectId(ROOT)
const h: any = createToolHandlers()
const raw: any = await (BrainDatabase as any).getRawInstance(pid)
const ctx = { projectPath: ROOT, projectId: pid }

const ranked = raw
  .prepare(
    "SELECT s.name AS name, COUNT(*) AS n FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id " +
      "WHERE r.project_id = ? AND r.relationship_type IN (" +
      DEP_KINDS.map(() => "?").join(",") +
      ") GROUP BY s.name ORDER BY n DESC LIMIT 5001",
  )
  .all(pid, ...DEP_KINDS) as Array<{ name: string; n: number }>
const picked: Array<{ name: string; n: number; rank: number }> = []
for (const rank of [0, 9, 99, 499, 1999, 4999]) {
  const row = ranked[rank]
  if (row) picked.push({ name: row.name, n: row.n, rank: rank + 1 })
}
// A symbol this repository's own documentation names as a normal target.
picked.push({ name: "computeImpact", n: -1, rank: -1 })

const CAP_MS = 120_000
const rows: any[] = []
function flush() {
  writeFileSync(path.join(OUT, "latency-t2.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    subject: "workspace reference large index (.bb-data, 11,440 files / ~3.4 GB)",
    command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2.ts",
    projectId: pid,
    note: "one timed default-argument call per candidate; call cap 120s. Full 5-run p50/p95 for candidates inside budget is in latency-t2-warm.json",
    perCallCapMs: CAP_MS,
    rows,
  }, null, 2) + "\n")
}

async function timed(symbol: string) {
  const t0 = performance.now()
  let timer: any
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), CAP_MS) })
  try {
    const r = await Promise.race([h.bb_impact({ symbol }, ctx), timeout])
    const ms = performance.now() - t0
    if (r === "timeout") return { ms: Number(ms.toFixed(1)), timedOut: true }
    const parsed = JSON.parse(String(r.content[0].text))
    if (r.isError) return { ms: Number(ms.toFixed(1)), isError: true, text: String(r.content[0].text).slice(0, 200) }
    return {
      ms: Number(ms.toFixed(1)),
      isError: false,
      shownCount: parsed.shownCount,
      totalCountIfKnown: parsed.totalCountIfKnown,
      directCount: parsed.directCount,
      truncated: parsed.truncated,
      truncationReason: parsed.truncationReason,
      depthReached: parsed.traversal?.depthReached,
      countVerification: parsed.countVerification,
      reproducible: parsed.reproducible,
      freshness: parsed.freshness && { fresh: parsed.freshness.fresh, stale: parsed.freshness.stale, missing: parsed.freshness.missing },
    }
  } finally {
    clearTimeout(timer)
  }
}

for (const candidate of picked) {
  console.log(`# T2 ${candidate.name} (rank ${candidate.rank}, incoming dep rows ${candidate.n})`)
  const result = await timed(candidate.name)
  rows.push({ ...candidate, ...result })
  flush()
  console.log(`#   ${JSON.stringify(result).slice(0, 400)}`)
}
console.log("T2_DONE")
