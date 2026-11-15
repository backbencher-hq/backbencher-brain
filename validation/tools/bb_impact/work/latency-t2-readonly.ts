// T2 latency measured through BYTE-READ-ONLY opens: the reference index's own
// files are hashed before and after, so the evidence can state dbUnchanged:true.
// The handler under test opens the index read-only itself; the component call
// uses the same read-only handle. BB_NO_AUTO_REFRESH=1 keeps the staleness path
// from repairing anything during the measurement.
import { createHash } from "node:crypto"
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const OUT = path.join(ROOT, "validation/tools/bb_impact/latency-t2-readonly.json")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
const { computeImpact } = await import(path.join(ROOT, "src/lsp/impact.ts"))

const pid = getProjectId(ROOT)
const dbDir = path.join(ROOT, ".bb-data/projects", pid)
const dbFiles = ["brain.db", "brain.db-wal", "brain.db-shm"].map((name) => path.join(dbDir, name))
async function hashOf(file: string): Promise<string | null> {
  if (!existsSync(file)) return null
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256")
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")))
  })
}
const before: Record<string, string | null> = {}
const sizesBefore: Record<string, number | null> = {}
for (const file of dbFiles) { before[path.basename(file)] = await hashOf(file); sizesBefore[path.basename(file)] = existsSync(file) ? statSync(file).size : null }

const raw: any = await (BrainDatabase as any).getRawInstance(pid, { readonly: true })
const handlers: any = createToolHandlers()
const ctx = { projectPath: ROOT, projectId: pid }
const rows: any[] = []

async function timeIt(label: string, fn: () => unknown | Promise<unknown>, capMs = 180_000) {
  const t0 = performance.now()
  let timer: any
  const cap = new Promise<"cap">((resolve) => { timer = setTimeout(() => resolve("cap"), capMs) })
  let value: any
  try {
    const raced = await Promise.race([Promise.resolve().then(fn), cap])
    value = raced === "cap" ? { capped: true } : raced
  } catch (e) {
    value = { error: String((e as Error).message).slice(0, 200) }
  } finally { clearTimeout(timer) }
  const ms = Number((performance.now() - t0).toFixed(1))
  rows.push({ label, ms, value })
  console.log(`${label}: ${ms} ms`)
}

const load = (await import("node:os")).loadavg()
console.log(`# load average: ${load.map((n) => n.toFixed(2)).join(", ")}`)
await timeIt("control-count-files", () => raw.prepare("SELECT COUNT(*) AS n FROM brain_file WHERE project_id = ?").get(pid))
await timeIt("control-name-equality", () => raw.prepare("SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ? AND name = ?").get(pid, "computeImpact"))
await timeIt("component-computeImpact-readonly", async () => {
  const r = await computeImpact(raw, pid, "computeImpact")
  return { shown: r.shownCount, total: r.totalCountIfKnown, truncated: r.truncated }
})
await timeIt("handler-full-call-readonly", async () => {
  const r = await handlers.bb_impact({ symbol: "computeImpact" }, ctx)
  const p = JSON.parse(String(r.content[0].text))
  return { shown: p.shownCount, total: p.totalCountIfKnown, truncated: p.truncated, countVerification: p.countVerification }
})

const after: Record<string, string | null> = {}
const sizesAfter: Record<string, number | null> = {}
for (const file of dbFiles) { after[path.basename(file)] = await hashOf(file); sizesAfter[path.basename(file)] = existsSync(file) ? statSync(file).size : null }
const changed = Object.keys(before).filter((name) => before[name] !== after[name])
const evidence = {
  schemaVersion: 1,
  tool: "bb_impact",
  tier: "T2",
  subject: "workspace reference large index (.bb-data, 11,440 files, ~3.4 GB)",
  command: "BB_DATA_DIR=.bb-data BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_impact/work/latency-t2-readonly.ts",
  openMode: "BrainDatabase.getRawInstance(projectId, { readonly: true }) — byte-read-only; the handler opens the same way",
  generatedAt: new Date().toISOString(),
  loadAverage: load,
  dbFiles,
  before,
  after,
  sizesBefore,
  sizesAfter,
  dbUnchanged: changed.length === 0,
  changedFiles: changed,
  rows,
}
writeFileSync(OUT, JSON.stringify(evidence, null, 2) + "\n")
console.log(`DB_UNCHANGED:${evidence.dbUnchanged} changed=${changed.join(",") || "none"}`)
