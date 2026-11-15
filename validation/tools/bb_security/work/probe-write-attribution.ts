// Attribute the write observed on the read path to a specific code path.
//
// Method: build one fixture index, keep byte-copies of brain.db before/after
// each door, and diff them — the SQLite file-change counter (header bytes
// 24..27), page-level hashes, and row counts per table. A pure read bumps none
// of them; a committed write transaction bumps the change counter even when it
// changes no rows.
//
// Doors compared:
//   R  read-only open (getRawInstance readonly) + SELECT   — the control
//   W  read-write open (getRawInstance default) + SELECT   — the open path
//   M  1 MCP bb_security default call                       — the tool door
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import Database from "better-sqlite3"
import { DATA, ROOT, TSX, dataDirFor, ensureDirs, makeFixture, writeEvidence, gitHead } from "./lib"
import { getProjectId } from "../../../../src/util/project-id"

process.env.BB_DATA_DIR = DATA
ensureDirs()

const PAGE = 4096
const FIXTURE = {
  "src/api.ts": [
    "import { Client } from 'pg'",
    "const client = new Client()",
    "export function search(userInput: string): unknown {",
    "  const sql = 'SELECT * FROM items WHERE name = ' + userInput",
    "  return client.query(sql)",
    "}",
    "export function safe(userInput: string): unknown {",
    "  return client.query('SELECT * FROM items WHERE name = $1', [userInput])",
    "}",
  ].join("\n"),
}

function indexFresh(name: string, dataDir: string) {
  const fixture = makeFixture(name, FIXTURE)
  rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  const r = spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work/probe-index-one.ts"), fixture.dir, dataDir], {
    cwd: ROOT, encoding: "utf8", timeout: 300_000,
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
  })
  if (r.status !== 0) throw new Error(`index failed: ${r.stderr}`)
  process.env.BB_DATA_DIR = dataDir
  const projectId = getProjectId(fixture.dir)
  const dbPath = path.join(dataDir, "projects", projectId, "brain.db")
  const checkpoint = spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work/child-checkpoint.ts"), dbPath], { cwd: ROOT, encoding: "utf8", timeout: 120_000 })
  if (checkpoint.status !== 0) throw new Error(`checkpoint failed: ${checkpoint.stderr}`)
  return { fixture, projectId, dbPath }
}

function header(file: string) {
  const buf = readFileSync(file)
  const u32 = (o: number) => buf.readUInt32BE(o)
  return {
    changeCounter: u32(24),
    pageCount: u32(28),
    freelistTrunk: u32(32),
    freelistCount: u32(36),
    schemaCookie: u32(40),
    userVersion: u32(60),
    applicationId: u32(68),
    versionValidFor: u32(92),
    sqliteVersion: u32(96),
    bytes: buf.length,
  }
}

function pageHashes(file: string) {
  const buf = readFileSync(file)
  const out: string[] = []
  for (let i = 0; i * PAGE < buf.length; i++) {
    const page = buf.subarray(i * PAGE, (i + 1) * PAGE)
    out.push(createHash("sha1").update(page).digest("hex"))
  }
  return out
}

function tableInventory(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const master = db.prepare("SELECT name, type, sql FROM sqlite_master ORDER BY name").all() as Array<{ name: string; type: string; sql: string | null }>
    const tables: Record<string, number> = {}
    for (const row of master.filter((m) => m.type === "table" && !m.name.startsWith("sqlite_"))) {
      try {
        tables[row.name] = (db.prepare(`SELECT COUNT(*) c FROM "${row.name}"`).get() as any).c
      } catch {
        tables[row.name] = -1
      }
    }
    let stat1: unknown = null
    try { stat1 = db.prepare("SELECT * FROM sqlite_stat1 ORDER BY tbl, idx").all() } catch { stat1 = "absent" }
    const journal = (db.prepare("PRAGMA journal_mode").get() as any)?.journal_mode
    const schemaVersion = (() => { try { return (db.prepare("PRAGMA schema_version").get() as any)?.schema_version } catch { return null } })()
    const userVersion = (() => { try { return (db.prepare("PRAGMA user_version").get() as any)?.user_version } catch { return null } })()
    return { masterHash: createHash("sha1").update(JSON.stringify(master)).digest("hex"), masterNames: master.map((m) => `${m.type}:${m.name}`), tables, stat1, journal, schemaVersion, userVersion }
  } finally {
    db.close()
  }
}

function diff(beforePath: string, afterPath: string) {
  const hb = header(beforePath), ha = header(afterPath)
  const pb = pageHashes(beforePath), pa = pageHashes(afterPath)
  const changedPages: number[] = []
  for (let i = 0; i < Math.max(pb.length, pa.length); i++) if (pb[i] !== pa[i]) changedPages.push(i + 1)
  const ib = tableInventory(beforePath), ia = tableInventory(afterPath)
  const rowCountDiffs = Object.keys({ ...ib.tables, ...ia.tables }).filter((t) => (ib.tables[t] ?? -2) !== (ia.tables[t] ?? -2)).map((t) => ({ table: t, before: ib.tables[t] ?? null, after: ia.tables[t] ?? null }))
  return {
    headerBefore: hb, headerAfter: ha,
    headerChanged: Object.keys(hb).filter((k) => (hb as any)[k] !== (ha as any)[k]),
    pagesBefore: pb.length, pagesAfter: pa.length, changedPages,
    masterChanged: ib.masterHash !== ia.masterHash,
    stat1Changed: JSON.stringify(ib.stat1) !== JSON.stringify(ia.stat1),
    journal: { before: ib.journal, after: ia.journal },
    schemaVersion: { before: ib.schemaVersion, after: ia.schemaVersion },
    rowCountDiffs,
    wroteDb: ib.masterHash !== ia.masterHash || JSON.stringify(ib.stat1) !== JSON.stringify(ia.stat1) || rowCountDiffs.length > 0 || changedPages.length > 0 || hb.changeCounter !== ha.changeCounter,
  }
}

function dbDirFiles(dbPath: string) {
  const dir = path.dirname(dbPath)
  if (!existsSync(dir)) return []
  return readdirSync(dir).sort().map((f) => {
    const p = path.join(dir, f)
    const st = statSync(p)
    return { name: f, size: st.size, mtime: new Date(st.mtimeMs).toISOString() }
  })
}

function runChild(script: string, args: string[], dataDir: string) {
  return spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work", script), ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 180_000,
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
  })
}

async function main() {
  const out: any = { schemaVersion: 1, tool: "bb_security", generatedAt: new Date().toISOString(), currentCommit: gitHead(), command: "BB_DATA_DIR=… BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_security/work/probe-write-attribution.ts", observations: [] }

  // ── W: read-write open (the default open path the tool uses) ─────────────
  {
    const dataDir = dataDirFor("wattrib-rw")
    const { fixture, projectId, dbPath } = indexFresh("wattrib-rw", dataDir)
    const before = path.join(dataDir, "before.db")
    copyFileSync(dbPath, before)
    const beforeDir = dbDirFiles(dbPath)
    const child = runChild("child-rw-open.ts", [fixture.dir, dataDir], dataDir)
    const after = path.join(dataDir, "after.db")
    copyFileSync(dbPath, after)
    out.observations.push({ id: "W-readwrite-open", projectId, dataDir, door: "fresh process: getRawInstance(projectId) [rw default] + 2 SELECTs", childExit: child.status, childStdout: (child.stdout ?? "").slice(0, 300), dbDirBefore: beforeDir, dbDirAfter: dbDirFiles(dbPath), diff: diff(before, after) })
  }

  // ── R: read-only open (the control) ─────────────────────────────────────
  {
    const dataDir = dataDirFor("wattrib-ro")
    const { fixture, projectId, dbPath } = indexFresh("wattrib-ro", dataDir)
    const before = path.join(dataDir, "before.db")
    copyFileSync(dbPath, before)
    const beforeDir = dbDirFiles(dbPath)
    const child = runChild("child-readonly.ts", [fixture.dir, dataDir], dataDir)
    const after = path.join(dataDir, "after.db")
    copyFileSync(dbPath, after)
    out.observations.push({ id: "R-readonly-open", projectId, dataDir, door: "fresh process: getRawInstance(projectId, {readonly:true}) + SELECTs", childExit: child.status, childStdout: (child.stdout ?? "").slice(0, 300), dbDirBefore: beforeDir, dbDirAfter: dbDirFiles(dbPath), diff: diff(before, after) })
  }

  // ── M: the MCP tool door itself ─────────────────────────────────────────
  {
    const dataDir = dataDirFor("wattrib-mcp")
    const { fixture, projectId, dbPath } = indexFresh("wattrib-mcp", dataDir)
    const before = path.join(dataDir, "before.db")
    copyFileSync(dbPath, before)
    const beforeDir = dbDirFiles(dbPath)
    const { mcpCall } = await import("./lib")
    const call = await mcpCall(fixture.dir, {}, { dataDir })
    const after = path.join(dataDir, "after.db")
    copyFileSync(dbPath, after)
    out.observations.push({ id: "M-mcp-default-call", projectId, dataDir, door: "MCP stdio: bb_security {}", call: { ok: call.ok, isError: call.isError, durationMs: call.durationMs, textBytes: Buffer.byteLength(call.text), textHead: call.text.slice(0, 300) }, dbDirBefore: beforeDir, dbDirAfter: dbDirFiles(dbPath), diff: diff(before, after) })
  }

  // ── M2: history door ────────────────────────────────────────────────────
  {
    const dataDir = dataDirFor("wattrib-hist")
    const { fixture, projectId, dbPath } = indexFresh("wattrib-hist", dataDir)
    const before = path.join(dataDir, "before.db")
    copyFileSync(dbPath, before)
    const beforeDir = dbDirFiles(dbPath)
    const { mcpCall } = await import("./lib")
    const call = await mcpCall(fixture.dir, { history: true }, { dataDir })
    const after = path.join(dataDir, "after.db")
    copyFileSync(dbPath, after)
    out.observations.push({ id: "M2-mcp-history-call", projectId, dataDir, door: "MCP stdio: bb_security {history:true}", call: { ok: call.ok, isError: call.isError, durationMs: call.durationMs, textBytes: Buffer.byteLength(call.text) }, dbDirBefore: beforeDir, dbDirAfter: dbDirFiles(dbPath), diff: diff(before, after) })
  }

  const file = writeEvidence("write-attribution.json", out)
  console.log(file)
  for (const o of out.observations) {
    console.log(`\n${o.id}: wroteDb=${o.diff.wroteDb} headerChanged=${JSON.stringify(o.diff.headerChanged)} changedPages=${o.diff.changedPages.length}/${o.diff.pagesBefore} masterChanged=${o.diff.masterChanged} stat1Changed=${o.diff.stat1Changed}`)
    if (o.diff.rowCountDiffs.length) console.log("  rowCountDiffs:", JSON.stringify(o.diff.rowCountDiffs))
    console.log("  header:", JSON.stringify({ before: o.diff.headerBefore, after: o.diff.headerAfter }))
  }
}
await main()
