// Does a READ of bb_migrate mutate the index it reads?
//
// Two probes, both against a caller-provided pristine data dir:
//   indexed   — one handler call against a copy of an indexed DB; the db/-wal/-shm
//               snapshots bracket the call and the db bytes are hashed before/after.
//   unindexed — one handler call against a project with no index at all; a read that
//               CREATES a database is a write by any definition.
// BB_NO_AUTO_REFRESH=1 is set by the caller; nothing here indexes.
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { handler } from "../../../src/mcp/tools/bb_migrate/handler"
import { BrainDatabase } from "../../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const WORK = path.join(ROOT, "validation/tools/bb_migrate/work")
const FIXTURE = path.join(ROOT, "test/fixtures/polyglot")

const sha = (file: string) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null)
const snap = (dbPath: string) => {
  const out: Record<string, { size: number; mtimeMs: number } | null> = {}
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix
    out[suffix || "db"] = existsSync(p) ? { size: statSync(p).size, mtimeMs: Math.round(statSync(p).mtimeMs) } : null
  }
  return out
}

async function main() {
  // ── indexed read ────────────────────────────────────────────────────────
  const projectId = getProjectId(FIXTURE)
  process.env.BB_DATA_DIR = path.join(WORK, "probe-indexed")
  const dbPath = BrainDatabase.getDbPath(projectId)
  const before = { files: snap(dbPath), sha256: sha(dbPath), stat: statSync(dbPath) }
  const t0 = Date.now()
  const first = await handler({ symbolNames: ["basePrice"], targetLanguage: "python" }, { projectId, projectPath: FIXTURE })
  const firstMs = Date.now() - t0
  const afterFirst = { files: snap(dbPath), sha256: sha(dbPath) }
  const t1 = Date.now()
  await handler({ symbolNames: ["basePrice"], targetLanguage: "python" }, { projectId, projectPath: FIXTURE })
  const secondMs = Date.now() - t1
  const afterSecond = { files: snap(dbPath), sha256: sha(dbPath) }
  console.log(JSON.stringify({
    probe: "indexed-read",
    projectId, dbPath,
    firstCall: { ms: firstMs, isError: first.isError === true, textHead: (first.content[0]?.text ?? "").split("\n").slice(0, 2) },
    before, afterFirst, afterSecond,
    walAppearedOnFirstRead: before.files["-wal"] === null && afterFirst.files["-wal"] !== null,
    dbBytesChangedInProcess: before.sha256 !== afterFirst.sha256,
    secondCallMs: secondMs,
  }, null, 1))

  // ── unindexed read ──────────────────────────────────────────────────────
  const unindexedDir = path.join(WORK, "unindexed-project")
  mkdirSync(path.join(unindexedDir, "src"), { recursive: true })
  writeFileSync(path.join(unindexedDir, "src", "only.ts"), "export function only(): number { return 1 }\n")
  const unindexedProjectId = getProjectId(unindexedDir)
  process.env.BB_DATA_DIR = path.join(WORK, "probe-unindexed")
  const unindexedDb = BrainDatabase.getDbPath(unindexedProjectId)
  const existedBefore = existsSync(unindexedDb)
  let outcome: any
  try {
    const r = await handler({ symbolNames: ["only"], targetLanguage: "python" }, { projectId: unindexedProjectId, projectPath: unindexedDir })
    outcome = { threw: false, isError: r.isError === true, textHead: (r.content[0]?.text ?? "").split("\n")[0] }
  } catch (e) {
    outcome = { threw: true, message: String(e).slice(0, 240) }
  }
  console.log(JSON.stringify({
    probe: "unindexed-read", unindexedDir, projectId: unindexedProjectId, dbPath: unindexedDb,
    existedBefore, existsAfter: existsSync(unindexedDb),
    sizeAfter: existsSync(unindexedDb) ? statSync(unindexedDb).size : 0,
    dbCreatedByRead: !existedBefore && existsSync(unindexedDb), outcome,
  }, null, 1))
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
