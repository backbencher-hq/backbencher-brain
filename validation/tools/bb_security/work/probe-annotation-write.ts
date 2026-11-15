// Name the exact statement inside ensureAnnotationTable that writes on a
// read-write open. The fixture is this lane's own data dir.
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import Database from "better-sqlite3"
import { DATA, ROOT, TSX, dataDirFor, ensureDirs, makeFixture, writeEvidence, gitHead } from "./lib"
import { getProjectId } from "../../../../src/util/project-id"
import { openDatabase } from "#db"
import { ANNOTATION_DDL, ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL, ensureAnnotationTable } from "../../../../src/brain/schema-ddl"

process.env.BB_DATA_DIR = DATA
ensureDirs()
function schemaVersion(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true })
  try { return (db.prepare("PRAGMA schema_version").get() as any).schema_version } finally { db.close() }
}
async function main() {
  const fixture = makeFixture("annotation-write", { "src/a.ts": "export const a = 1\n" })
  const dataDir = dataDirFor("annotation-write")
  rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  const indexed = spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work/probe-index-one.ts"), fixture.dir, dataDir], { cwd: ROOT, encoding: "utf8", env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" } })
  if (indexed.status !== 0) throw new Error(String(indexed.stderr))
  const dbPath = path.join(dataDir, "projects", getProjectId(fixture.dir), "brain.db")
  spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work/child-checkpoint.ts"), dbPath], { cwd: ROOT, encoding: "utf8" })
  const raw = openDatabase(dbPath)
  const steps: any[] = []
  let v = schemaVersion(dbPath)
  const rec = (step: string) => { const after = schemaVersion(dbPath); steps.push({ step, delta: after - v, schemaVersion: after }); v = after }
  steps.push({ step: "baseline", delta: 0, schemaVersion: v })
  // Inspect the installed trigger and the comparison ensureAnnotationTable makes.
  const installed = raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='brain_annotation_author_class_guard'").get() as any
  const wantsGuard = ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL
  const guardBody = wantsGuard.slice(wantsGuard.indexOf("BEFORE")).replace(/\s+/g, " ").trim()
  const installedBody = String(installed?.sql ?? "").slice(String(installed?.sql ?? "").indexOf("BEFORE")).replace(/\s+/g, " ").trim()
  steps.push({ step: "trigger comparison", installedPresent: !!installed, guardIsStale: installedBody !== guardBody, installedBodyHead: installedBody.slice(0, 120), wantsBodyHead: guardBody.slice(0, 120) })
  raw.exec(ANNOTATION_DDL); rec("exec(ANNOTATION_DDL) alone")
  raw.exec(ANNOTATION_AUTHOR_CLASS_TRIGGER_DDL); rec("exec(TRIGGER_DDL) alone")
  ensureAnnotationTable(raw); rec("ensureAnnotationTable")
  ensureAnnotationTable(raw); rec("ensureAnnotationTable again")
  raw.close()
  const payload = { schemaVersionDb: 1, tool: "bb_security", generatedAt: new Date().toISOString(), currentCommit: gitHead(), dbPath, steps }
  const file = writeEvidence("annotation-write.json", payload)
  console.log(file)
  console.log(JSON.stringify(steps, null, 1))
}
await main()
