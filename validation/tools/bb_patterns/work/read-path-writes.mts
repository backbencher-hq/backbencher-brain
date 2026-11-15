// Phase A read-path probe for bb_patterns. Proves whether the tool's READ paths
// mutate the index: indexes a scratch fixture, closes every handle, then calls the
// real handler in a fresh handle generation and records db/wal/shm bytes+mtime
// before and after — for scope=all, scope=orphaned and the history path
// separately, because they take different doors into BrainDatabase.
//
// Usage: BB_DATA_DIR=<scratch> BB_NO_AUTO_REFRESH=1 npx tsx read-path-writes.mts <out.json>

import { mkdtempSync, mkdirSync, writeFileSync, statSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"

const outPath = process.argv[2]
if (!outPath) { console.error("usage: read-path-writes.mts <out.json>"); process.exit(2) }

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)

const root = mkdtempSync(path.join(tmpdir(), "bb-patterns-rw-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"),
  "export function usedA(): number { return 1 }\nexport function deadA(): number { return 2 }\nexport function caller(): number { return usedA() }\n")
for (let i = 0; i < 12; i++) writeFileSync(path.join(root, "src", `b${i}.ts`), `export function deadB${i}(): number { return ${i} }\n`)
const projectId = getProjectId(root)
const handler = createToolHandlers().bb_patterns

const dbPath = BrainDatabase.getDbPath(projectId)
const files = { db: dbPath, wal: `${dbPath}-wal`, shm: `${dbPath}-shm` }
function snapshot() { return { db: statOf(files.db), wal: statOf(files.wal), shm: statOf(files.shm) } }
async function call(label: string, args: Record<string, unknown>) {
  BrainDatabase.closeAll()
  await wait(250)
  const before = snapshot()
  const t0 = performance.now()
  const result: any = await handler(args as any, { projectId, projectPath: root } as any)
  const ms = Math.round((performance.now() - t0) * 100) / 100
  await wait(250)
  const after = snapshot()
  const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return {
    label,
    args,
    ms,
    chars: text.length,
    isError: result?.isError === true,
    before,
    after,
    walCreated: !before.wal && !!after.wal,
    walBytesDelta: (after.wal?.bytes ?? 0) - (before.wal?.bytes ?? 0),
    walMtimeMoved: before.wal?.mtime !== after.wal?.mtime,
    shmCreated: !before.shm && !!after.shm,
    dbMtimeMoved: before.db?.mtime !== after.db?.mtime,
    dbBytesDelta: (after.db?.bytes ?? 0) - (before.db?.bytes ?? 0),
  }
}

let report: Record<string, unknown>
try {
  await indexProjectParallel(projectId, root, {})
  BrainDatabase.closeAll()
  await wait(300)
  const baseline = snapshot()
  const observations = [] as unknown[]
  observations.push(await call("scope-orphaned", { scope: "orphaned", limit: 5 }))
  observations.push(await call("scope-all-default", {}))
  observations.push(await call("history-read", { history: true, limit: 5 }))
  observations.push(await call("recordRun-explicit-write", { scope: "all", limit: 5, recordRun: true }))
  BrainDatabase.closeAll()
  await wait(250)
  const final = snapshot()
  report = {
    tier: "read-path",
    projectId,
    projectDir: root,
    dbPath,
    dataDir: process.env.BB_DATA_DIR ?? "(default)",
    route: "createToolHandlers().bb_patterns; a fresh handle generation per call (closeAll + wait)",
    baseline,
    observations,
    final,
    conclusions: {
      readPathsOpenReadWrite: (observations as any[]).some((o) => o.walCreated || o.walMtimeMoved || o.shmCreated),
      // The history door recreates the analysis-history schema through ensureHistorySchema.
      historySurfaceWritesSchema: (observations as any[]).some((o) => o.label === "history-read" && (o.walCreated || o.walMtimeMoved)),
      recordRunIsAnExplicitWrite: true,
    },
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report, null, 1))
} catch (error) {
  console.error("FATAL", error)
  process.exitCode = 1
} finally {
  try { BrainDatabase.closeAll() } catch {}
}
