// Cold-open breakdown for bb_doc on the T2 reference index: read-only DB open,
// first default call, second (warm) call. Declared, not hidden.
import { statSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { BrainDatabase } from "../../../../src/brain/database"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const pid = getProjectId(REPO)
const dbPath = path.join(REPO, ".bb-data", "projects", pid, "brain.db")
const stat = statSync(dbPath)
const counts = (() => {
  const { Database } = require("bun:sqlite")
  const db = new Database(dbPath, { readonly: true })
  const c = (sql: string) => (db.prepare(sql).get(pid) as any)?.c
  const out = { files: c("SELECT count(*) c FROM brain_file WHERE project_id=?"), symbols: c("SELECT count(*) c FROM brain_symbol WHERE project_id=?"), relationships: c("SELECT count(*) c FROM brain_relationship WHERE project_id=?"), imports: c("SELECT count(*) c FROM brain_import WHERE project_id=?") }
  db.close()
  return out
})()
const load = execFileSync("uptime", { encoding: "utf8" }).trim()
const t0 = performance.now()
const raw: any = await BrainDatabase.getRawInstance(pid as any, { readonly: true })
const openMs = Math.round(performance.now() - t0)
// One cheap query to distinguish "open returned" from "storage read is warm".
const tq = performance.now()
raw.prepare("SELECT count(*) c FROM brain_file WHERE project_id=?").get(pid)
const firstQueryMs = Math.round(performance.now() - tq)
const h = createToolHandlers().bb_doc
const t1 = performance.now()
const r1: any = await h({ mode: "project", format: "json" }, { projectPath: REPO, projectId: pid } as any)
const firstCallMs = Math.round(performance.now() - t1)
const t2 = performance.now()
const r2: any = await h({ mode: "project", format: "json" }, { projectPath: REPO, projectId: pid } as any)
const secondCallMs = Math.round(performance.now() - t2)
console.log(JSON.stringify({
  index: { path: dbPath, bytes: stat.size, mtime: stat.mtime.toISOString(), ...counts },
  load, readonlyOpenMs: openMs, firstQueryMs, firstDefaultCallMs: firstCallMs, secondDefaultCallMs: secondCallMs,
  bytes: r1.content[0].text.length, budget: JSON.parse(r1.content[0].text).quality.budget, samePayload: r1.content[0].text.length === r2.content[0].text.length,
}, null, 2))
