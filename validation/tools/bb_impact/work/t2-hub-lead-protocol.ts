// EXACT Lead-baseline protocol for the hub case: in-process handler call,
// BB_DATA_DIR=.bb-data, BB_NO_AUTO_REFRESH=1, one warm-up + THREE measured runs,
// args {"symbol":"getRawInstance"}, budget 5000 ms. Byte-read-only index.
import { createHash } from "node:crypto"
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/latency-t2-hub-lead-protocol.json")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

const pid = getProjectId(ROOT)
const dbPath = path.join(ROOT, ".bb-data/projects", pid, "brain.db")
const hashFile = async (file: string) => existsSync(file) ? await new Promise<string>((res, rej) => { const h = createHash("sha256"); createReadStream(file).on("data", (c) => h.update(c)).on("error", rej).on("end", () => res(h.digest("hex"))) }) : null
const snap = async () => ({ bytes: statSync(dbPath).size, mtimeMs: statSync(dbPath).mtimeMs, sha256: await hashFile(dbPath) })
const before = await snap()
const load = (await import("node:os")).loadavg()

const handlers: any = createToolHandlers()
const ctx = { projectPath: ROOT, projectId: pid }
const runs: any[] = []
const call = async () => {
  const t0 = performance.now()
  const r = await handlers.bb_impact({ symbol: "getRawInstance" }, ctx)
  const ms = Number((performance.now() - t0).toFixed(1))
  const text = String(r.content[0].text)
  if (r.isError) throw new Error(text.slice(0, 300))
  const p = JSON.parse(text)
  return {
    ms,
    isError: false,
    outputBytes: Buffer.byteLength(text, "utf8"),
    truncated: p.truncated,
    truncationReason: p.truncationReason,
    reproducible: p.reproducible,
    shownCount: p.shownCount,
    totalCountIfKnown: p.totalCountIfKnown,
    countVerification: p.countVerification,
    walkTimeBudgetMs: p.traversal?.walkTimeBudgetMs,
    walkTimeExhausted: p.traversal?.walkTimeExhausted,
    callDeadlineMs: p.budget?.callDeadlineMs,
    walkTimeCeilingMs: p.budget?.walkTimeCeilingMs,
  }
}
const warm = await call()
const measured = [await call(), await call(), await call()]
for (const r of measured) runs.push(r)
const sorted = measured.map((r) => r.ms).sort((a, b) => a - b)
const p50 = sorted[Math.max(0, Math.ceil(0.5 * sorted.length) - 1)]!
const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)]!
const after = await snap()
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1, tool: "bb_impact", case: "Lead T2 baseline hub case",
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/t2-hub-lead-protocol.ts",
  protocol: { warmupRuns: 1, measuredRuns: 3, inProcess: true, args: { symbol: "getRawInstance" }, budgetMs: 5000 },
  generatedAt: new Date().toISOString(), loadAverage: load,
  warmup: { ms: warm.ms },
  runs: measured.map((r) => r.ms),
  details: runs,
  p50Ms: p50, p95Ms: p95, withinBudget: p95 <= 5000,
  dbBefore: before, dbAfter: after,
  dbUnchanged: before.sha256 === after.sha256 && before.bytes === after.bytes && before.mtimeMs === after.mtimeMs,
}, null, 2) + "\n")
console.log(`warm=${warm.ms} measured=${measured.map((r) => r.ms).join(",")} p50=${p50} p95=${p95} within=${p95 <= 5000}`)
console.log(`truncated=${measured[0].truncated} total=${measured[0].totalCountIfKnown} shown=${measured[0].shownCount} walkExhausted=${measured[0].walkTimeExhausted} outputBytes=${measured[0].outputBytes}`)
console.log(`DB_UNCHANGED:${before.sha256 === after.sha256}`)
