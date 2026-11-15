// bb_security read-path probe: does a read-only declared tool mutate the
// index it reads? Three controlled observations:
//
//   A. T0 fixture (own index, no other process): MCP door default call.
//   B. T0 fixture control: the same files after a fresh-process READ-ONLY open.
//   C. T2 shared index: default call, with the fleet's concurrent writes named
//      as a confounder (the fixture is the controlled proof).
//   D. Unindexed project: MCP door (server gate), CLI door, and library door —
//      does a read create an index or answer a false "clean"?
//
// Every observation is a file fingerprint (size + mtime + sha256 where small).
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  AUDIT, DATA, ROOT, TSX, changed, dataDirFor, ensureDirs, fingerprint, makeFixture, mcpCall,
  projectDbFiles, snapshotProjectDb, writeEvidence, gitHead,
} from "./lib"
import { BrainDatabase } from "../../../../src/brain/database"
import { getProjectId } from "../../../../src/util/project-id"

process.env.BB_DATA_DIR = DATA
ensureDirs()

const T2_DIR = ROOT
const T2_DATA = path.join(ROOT, ".bb-data")

/** The data files of an index. `-shm` is shared-memory bookkeeping, not data:
 *  ANY connection open (read-only included) may touch its bytes and mtime. */
function dataOnly(snapshot: Array<{ path: string }>): Array<{ path: string }> {
  return snapshot.filter((entry) => !entry.path.endsWith("-shm"))
}

function runChild(script: string, args: string[], dataDir: string) {
  return spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work", script), ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 180_000,
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
  })
}

function listTree(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(path.relative(dir, p))
    }
  }
  walk(dir)
  return out.sort()
}

async function main() {
  const probes: any[] = []

  // ── The fixture the matrix and read-path probes share ────────────────────
  const fixture = makeFixture("readpath", {
    "src/api.ts": [
      "import { Client } from 'pg'",
      "const client = new Client()",
      "export function search(userInput: string): unknown {",
      "  const sql = 'SELECT * FROM items WHERE name = ' + userInput",
      "  return client.query(sql)",
      "}",
    ].join("\n"),
    "src/pattern.py": "from flask import request\ndef isolated():\n    q = request.args.get('q')\n    return q\n",
  })
  const secData = dataDirFor("readpath")
  rmSync(path.join(secData, "projects"), { recursive: true, force: true })
  mkdirSync(secData, { recursive: true })
  const index = runChild("probe-index-one.ts", [fixture.dir, secData], secData)
  if (index.status !== 0) throw new Error(`fixture index failed: ${index.stderr}`)

  // ── A. MCP default call on a fresh index ────────────────────────────────
  {
    const before = snapshotProjectDb(secData, fixture.projectId)
    const call = await mcpCall(fixture.dir, {}, { dataDir: secData })
    const after = snapshotProjectDb(secData, fixture.projectId)
    probes.push({
      id: "A-t0-default-mcp",
      door: "MCP stdio (source)",
      project: { path: fixture.dir, projectId: fixture.projectId, dataDir: secData, tier: "T0-fixture" },
      args: {},
      call: { ok: call.ok, isError: call.isError, durationMs: call.durationMs, textBytes: Buffer.byteLength(call.text), textHead: call.text.slice(0, 300) },
      before, after,
      changes: changed(before, after),
      dbUnchanged: changed(dataOnly(before), dataOnly(after), { ignoreMtime: true }).length === 0,
    })
  }

  // ── B. control: read-only open in a fresh process ───────────────────────
  {
    const before = snapshotProjectDb(secData, fixture.projectId)
    const control = runChild("child-readonly.ts", [fixture.dir, secData], secData)
    const after = snapshotProjectDb(secData, fixture.projectId)
    probes.push({
      id: "B-t0-readonly-control",
      door: "fresh process, getRawInstance(readonly:true)",
      project: { path: fixture.dir, projectId: fixture.projectId, dataDir: secData, tier: "T0-fixture" },
      call: { exit: control.status, stdout: (control.stdout ?? "").slice(0, 300), stderr: (control.stderr ?? "").slice(0, 300) },
      before, after,
      changes: changed(before, after),
      dbUnchanged: changed(dataOnly(before), dataOnly(after), { ignoreMtime: true }).length === 0,
    })
  }

  // ── A2. history read: a different shape, same read-only declaration ─────
  {
    const before = snapshotProjectDb(secData, fixture.projectId)
    const call = await mcpCall(fixture.dir, { history: true }, { dataDir: secData })
    const after = snapshotProjectDb(secData, fixture.projectId)
    probes.push({
      id: "A2-t0-history-mcp",
      door: "MCP stdio (source)",
      args: { history: true },
      call: { ok: call.ok, isError: call.isError, durationMs: call.durationMs, textBytes: Buffer.byteLength(call.text), textHead: call.text.slice(0, 300) },
      before, after,
      changes: changed(before, after),
      dbUnchanged: changed(dataOnly(before), dataOnly(after), { ignoreMtime: true }).length === 0,
    })
  }

  // ── C. T2 shared index ──────────────────────────────────────────────────
  {
    const projectId = getProjectId(T2_DIR)
    const readCounts = runChild("child-readonly.ts", [T2_DIR, T2_DATA], T2_DATA)
    const before = snapshotProjectDb(T2_DATA, projectId)
    const call = await mcpCall(T2_DIR, {}, { dataDir: T2_DATA, timeoutMs: 120_000 })
    const after = snapshotProjectDb(T2_DATA, projectId)
    const secondBefore = after
    const call2 = await mcpCall(T2_DIR, {}, { dataDir: T2_DATA, timeoutMs: 120_000 })
    const secondAfter = snapshotProjectDb(T2_DATA, projectId)
    const { statSync } = await import("node:fs")
    // `BrainDatabase.getDbPath` resolves through the ambient BB_DATA_DIR, which is
    // the fixture dir; the T2 index lives under `.bb-data`, so resolve it directly.
    const dbPath = path.join(T2_DATA, "projects", projectId, "brain.db")
    // The taint census the engine reports for T2 comes from the call text; the
    // index population is recorded from a read-only count so the two are
    // distinguishable.
    probes.push({
      id: "C-t2-shared-default-mcp",
      door: "MCP stdio (source)",
      project: { path: T2_DIR, projectId, dataDir: T2_DATA, tier: "T2-reference", dbPath, dbBytes: existsSync(dbPath) ? statSync(dbPath).size : 0, dbMtime: existsSync(dbPath) ? new Date(statSync(dbPath).mtimeMs).toISOString() : null },
      call: { ok: call.ok, isError: call.isError, durationMs: call.durationMs, textBytes: Buffer.byteLength(call.text), textHead: call.text.slice(0, 500) },
      before, after, changes: changed(before, after), dbUnchanged: changed(dataOnly(before), dataOnly(after), { ignoreMtime: true }).length === 0,
      secondCall: { ok: call2.ok, isError: call2.isError, durationMs: call2.durationMs, textBytes: Buffer.byteLength(call2.text) },
      secondChanges: changed(secondBefore, secondAfter),
      concurrentWriterNote: "the fleet shares .bb-data and writes this index; fixture A is the controlled measurement",
      countsFromReadOnlyOpen: (() => { try { return JSON.parse((readCounts.stdout ?? "").trim() || "{}").counts ?? null } catch { return null } })(),
    })
  }

  // ── D. unindexed project ────────────────────────────────────────────────
  {
    const unindexed = makeFixture("unindexed", { "src/only.ts": "export const x = 1\n" })
    const dataDir = dataDirFor("unindexed")
    rmSync(dataDir, { recursive: true, force: true })
    mkdirSync(dataDir, { recursive: true })
    const beforeTree = listTree(dataDir)

    const mcp = await mcpCall(unindexed.dir, {}, { dataDir })
    const afterMcpTree = listTree(dataDir)

    const cliTreeBefore = listTree(dataDir)
    const cli = runChild("child-cli.ts", [unindexed.dir, JSON.stringify({}), dataDir], dataDir)
    const cliTreeAfter = listTree(dataDir)

    const libTreeBefore = listTree(dataDir)
    const lib = runChild("child-handler.ts", [unindexed.dir, dataDir, JSON.stringify({})], dataDir)
    const libTreeAfter = listTree(dataDir)

    probes.push({
      id: "D-unindexed-project",
      project: { path: unindexed.dir, projectId: getProjectId(unindexed.dir), dataDir },
      mcpDoor: { ok: mcp.ok, isError: mcp.isError, text: mcp.text.slice(0, 400), createdFiles: afterMcpTree.filter((f) => !beforeTree.includes(f)) },
      cliDoor: { exit: cli.status, stdout: (cli.stdout ?? "").slice(0, 400), stderr: (cli.stderr ?? "").slice(0, 400), createdFiles: cliTreeAfter.filter((f) => !cliTreeBefore.includes(f)) },
      libraryDoor: { exit: lib.status, stdout: (lib.stdout ?? "").slice(0, 600), stderr: (lib.stderr ?? "").slice(0, 400), createdFiles: libTreeAfter.filter((f) => !libTreeBefore.includes(f)) },
    })
  }

  // ── E. declared write path: recordRun on the fixture (expected to write) ─
  {
    const before = snapshotProjectDb(secData, fixture.projectId)
    const call = await mcpCall(fixture.dir, { recordRun: true }, { dataDir: secData })
    const after = snapshotProjectDb(secData, fixture.projectId)
    probes.push({
      id: "E-t0-recordrun-mcp",
      door: "MCP stdio (source)",
      args: { recordRun: true },
      call: { ok: call.ok, isError: call.isError, durationMs: call.durationMs, textHead: call.text.slice(0, 400) },
      before, after, changes: changed(before, after), dbUnchanged: changed(dataOnly(before), dataOnly(after), { ignoreMtime: true }).length === 0,
      note: "recordRun is the one documented write; a change here is correct behaviour, not a defect",
    })
  }

  const payload = {
    schemaVersion: 1,
    tool: "bb_security",
    generatedAt: new Date().toISOString(),
    currentCommit: gitHead(),
    command: "BB_DATA_DIR=… BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_security/work/probe-readpath.ts",
    probes,
  }
  const file = writeEvidence("readpath.json", payload)
  console.log(JSON.stringify(payload, null, 2))
  console.log(file)
}
await main()
