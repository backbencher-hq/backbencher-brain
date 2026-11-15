// validation/tools/bb_annotations/work/audit-store-more.mts
//
// Two store facts the small probe fixture cannot show:
//
//   L1  behaviour at the declared cap: with 205 stored notes, the default read
//       truncates at 50 and the cap read truncates at 200 — and the
//       truncationReason is checked for an action the caller can actually take
//   L2  the query plans behind the three filter shapes and their COUNT twins,
//       which is what the curated performance claim is about
//
// The fixture is this lane's own (validation/tools/bb_annotations/work/limit-fixture),
// indexed into the lane's isolated BB_DATA_DIR.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/audit-store-more.mts
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const require = createRequire(import.meta.url)
const DATA_DIR = join(HERE, "..", "bbdata")
const WORKSPACE = join(HERE, "limit-fixture")
mkdirSync(DATA_DIR, { recursive: true })
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

// A fixture with one file so the project is indexable.
if (!existsSync(join(WORKSPACE, "src"))) {
  mkdirSync(join(WORKSPACE, "src"), { recursive: true })
  writeFileSync(join(WORKSPACE, "src", "notes.ts"), "export function noteSubject(): string {\n  return \"subject\"\n}\n")
}

const { getProjectId } = await import(join(ROOT, "src", "util", "project-id.ts"))
const { indexProjectParallel } = await import(join(ROOT, "src", "ast", "parallel-indexer.ts"))
const { createToolHandlers } = await import(join(ROOT, "src", "mcp", "tool-handlers.ts"))
const Database = require("better-sqlite3")

const projectId = getProjectId(WORKSPACE)
const projectDir = join(DATA_DIR, "projects", projectId)
if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true })
await (indexProjectParallel as any)(projectId, WORKSPACE, {})

const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>
const ctx = { projectId, projectPath: WORKSPACE }
const call = async (tool: string, args: Record<string, unknown>) => {
  const started = Number(process.hrtime.bigint()) / 1e6
  const result = await handlers[tool](args, ctx)
  const elapsed = Number(process.hrtime.bigint()) / 1e6 - started
  const text = result?.content?.[0]?.text ?? ""
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {}
  return { elapsed: Math.round(elapsed * 1000) / 1000, isError: result?.isError === true, text, parsed }
}

// 205 name-level notes (unique names) + 30 file-scoped notes, so the cap, the
// default, the path filter and the COUNT twins all have real rows to count.
for (let i = 0; i < 205; i++) {
  await call("bb_annotate", { symbol: `note${String(i).padStart(3, "0")}`, body: `stored note number ${i}` })
}
for (let i = 0; i < 30; i++) {
  await call("bb_annotate", { symbol: "noteSubject", path: "src/notes.ts", body: `file-scoped note number ${i}` })
}

// Measured row count, not the number of write calls: one note is kept per
// location, so 30 file-scoped writes at the same (symbol, path) collapse to one
// row — that is the write door's declared upsert contract, not a read defect.
const measureDb = new Database(join(projectDir, "brain.db"), { readonly: true, fileMustExist: true })
const storedRows = {
  writeCalls: 235,
  rows: (measureDb.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ?").get(projectId) as any).n,
  nameLevelRows: (measureDb.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ? AND symbol_path IS NULL").get(projectId) as any).n,
  fileScopedRows: (measureDb.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ? AND symbol_path = 'src/notes.ts'").get(projectId) as any).n,
  note: "one note per (project, symbol, author, path) location — 30 file-scoped writes to one location are one row",
}
measureDb.close()

const L1 = {
  question: "does the declared cap/bound behave and does the truncation advice name an action the caller can take?",
  storedRows,
  defaultRead: await call("bb_annotations", {}),
  capRead: await call("bb_annotations", { limit: 200 }),
  capMinusOneRead: await call("bb_annotations", { limit: 199 }),
  pathRead: await call("bb_annotations", { path: "src/notes.ts" }),
  absentSymbol: await call("bb_annotations", { symbol: "note999" }),
}
for (const key of Object.keys(L1)) if (key.endsWith("Read") || key === "absentSymbol") {
  const res: any = (L1 as any)[key]
  ;(L1 as any)[key] = {
    isError: res.isError,
    count: res.parsed?.count,
    totalCountIfKnown: res.parsed?.totalCountIfKnown,
    truncated: res.parsed?.truncated,
    truncationReason: res.parsed?.truncationReason,
    declaredAbsent: res.parsed?.declaredAbsent,
    bytes: res.text.length,
    elapsedMs: res.elapsed,
  }
}

const dbFile = join(projectDir, "brain.db")
const ro = new Database(dbFile, { readonly: true, fileMustExist: true })
const plan = (sql: string, params: unknown[] = []) => (ro.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((row) => row.detail)
const L2 = {
  indexes: ro.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='brain_annotation'").all(),
  rowsStored: (ro.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ?").get(projectId) as any).n,
  plans: {
    projectWideRows: plan("SELECT id FROM brain_annotation WHERE project_id = ? ORDER BY time_updated DESC, id LIMIT ?", [projectId, 50]),
    projectWideCount: plan("SELECT COUNT(*) c FROM brain_annotation WHERE project_id = ?", [projectId]),
    symbolRows: plan("SELECT id FROM brain_annotation WHERE project_id = ? AND symbol_name IN (?) ORDER BY time_updated DESC, id LIMIT ?", [projectId, "note000", 50]),
    symbolCount: plan("SELECT COUNT(*) c FROM brain_annotation WHERE project_id = ? AND symbol_name IN (?)", [projectId, "note000"]),
    pathRows: plan("SELECT id FROM brain_annotation WHERE project_id = ? AND symbol_path = ? ORDER BY time_updated DESC, id LIMIT ?", [projectId, "src/notes.ts", 50]),
    pathCount: plan("SELECT COUNT(*) c FROM brain_annotation WHERE project_id = ? AND symbol_path = ?", [projectId, "src/notes.ts"]),
    pathWithNameLevelRows: plan("SELECT id FROM brain_annotation WHERE project_id = ? AND (symbol_path = ? OR symbol_path IS NULL) ORDER BY time_updated DESC, id LIMIT ?", [projectId, "src/notes.ts", 50]),
    projectWideWallMs: 0,
    pathWallMs: 0,
  },
}
const wall = (sql: string, params: unknown[], runs = 5) => {
  const started = Number(process.hrtime.bigint()) / 1e6
  for (let i = 0; i < runs; i++) ro.prepare(sql).all(...params)
  return (Number(process.hrtime.bigint()) / 1e6 - started) / runs
}
L2.plans.projectWideWallMs = Math.round(wall("SELECT id FROM brain_annotation WHERE project_id = ? ORDER BY time_updated DESC, id LIMIT ?", [projectId, 50]) * 1000) / 1000
L2.plans.pathWallMs = Math.round(wall("SELECT id FROM brain_annotation WHERE project_id = ? AND symbol_path = ? ORDER BY time_updated DESC, id LIMIT ?", [projectId, "src/notes.ts", 50]) * 1000) / 1000
ro.close()

const out = {
  schemaVersion: 1,
  tool: "bb_annotations",
  action: "cap/bound behaviour and query plans on a 235-note fixture",
  measuredAt: new Date().toISOString(),
  currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  fixture: { workspace: WORKSPACE, projectId, dbBytes: statSync(dbFile).size },
  L1_capAndBounds: L1,
  L2_queryPlans: L2,
}
const file = join(HERE, "..", "raw", "audit-store-more.json")
writeFileSync(file, JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ file, L1: L1, plans: L2.plans, indexes: L2.indexes }, null, 2))
