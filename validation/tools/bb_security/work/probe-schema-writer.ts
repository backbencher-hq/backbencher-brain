// Which statement in a fresh read-write open writes the schema? Replicates
// BrainDatabase.getRawInstance's open sequence over the SAME ensure* functions,
// measuring `PRAGMA schema_version` after every step. Read-only investigation:
// nothing in src/ is modified, the fixture is this lane's own data dir.
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import Database from "better-sqlite3"
import { DATA, ROOT, TSX, dataDirFor, ensureDirs, makeFixture, writeEvidence, gitHead } from "./lib"
import { getProjectId } from "../../../../src/util/project-id"
import { openDatabase } from "#db"
import {
  migrateSchemaColumns, ensureHealthIndexes, ensurePlannerStats, cleanupOrphanedFkRows,
  ensureAnnotationTable, ensureEmbeddingBlobColumn, ensureSymbolDeclarationColumn,
  ensureSymbolSupertypesColumn, ensureFileMetadataColumn, ensureSymbolSourceTextColumn,
  ensureRelationshipTargetBasisColumn, ensureQueryShapeIndexes,
} from "../../../../src/brain/schema-ddl"

process.env.BB_DATA_DIR = DATA
ensureDirs()

function schemaVersion(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true })
  try { return (db.prepare("PRAGMA schema_version").get() as any).schema_version } finally { db.close() }
}

async function main() {
  const fixture = makeFixture("schema-writer", {
    "src/api.ts": [
      "import { Client } from 'pg'",
      "const client = new Client()",
      "export function search(req: any): unknown {",
      "  const q = req.query.q",
      "  return client.query('SELECT ' + q)",
      "}",
    ].join("\n"),
  })
  const dataDir = dataDirFor("schema-writer")
  rmSync(path.join(dataDir, "projects"), { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  const indexed = spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work/probe-index-one.ts"), fixture.dir, dataDir], {
    cwd: ROOT, encoding: "utf8", timeout: 300_000, env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1" },
  })
  if (indexed.status !== 0) throw new Error(`index failed: ${indexed.stderr}`)
  const projectId = getProjectId(fixture.dir)
  const dbPath = path.join(dataDir, "projects", projectId, "brain.db")
  const checkpoint = spawnSync(TSX, [path.join(ROOT, "validation/tools/bb_security/work/child-checkpoint.ts"), dbPath], { cwd: ROOT, encoding: "utf8" })
  if (checkpoint.status !== 0) throw new Error(`checkpoint failed: ${checkpoint.stderr}`)

  const steps: Array<{ step: string; schemaVersion: number; delta: number }> = []
  const record = (step: string, before: number) => { const after = schemaVersion(dbPath); steps.push({ step, schemaVersion: after, delta: after - before }); return after }

  let v = schemaVersion(dbPath)
  steps.push({ step: "baseline (after index + checkpoint)", schemaVersion: v, delta: 0 })

  const raw = openDatabase(dbPath) // the driver's rw open (journal_mode/busy_timeout/synchronous/FK pragmas)
  let after = record("openDatabase(dbPath) [rw driver pragmas]", v); v = after

  const ops: Array<[string, () => void]> = [
    ["migrateSchemaColumns", () => migrateSchemaColumns(raw)],
    ["ensureHealthIndexes", () => { ensureHealthIndexes(raw) }],
    ["ensurePlannerStats", () => { ensurePlannerStats(raw) }],
    ["cleanupOrphanedFkRows", () => { cleanupOrphanedFkRows(raw) }],
    ["ensureAnnotationTable", () => ensureAnnotationTable(raw)],
    ["ensureEmbeddingBlobColumn", () => ensureEmbeddingBlobColumn(raw)],
    ["ensureSymbolDeclarationColumn", () => ensureSymbolDeclarationColumn(raw)],
    ["ensureSymbolSupertypesColumn", () => ensureSymbolSupertypesColumn(raw)],
    ["ensureFileMetadataColumn", () => ensureFileMetadataColumn(raw)],
    ["ensureSymbolSourceTextColumn", () => ensureSymbolSourceTextColumn(raw)],
    ["ensureRelationshipTargetBasisColumn", () => ensureRelationshipTargetBasisColumn(raw)],
    ["ensureQueryShapeIndexes", () => ensureQueryShapeIndexes(raw)],
    ["close (checkpoint)", () => raw.close()],
  ]
  for (const [name, fn] of ops) { fn(); after = record(name, v); v = after }

  const payload = { schemaVersionDb: 1, tool: "bb_security", generatedAt: new Date().toISOString(), currentCommit: gitHead(), command: "BB_DATA_DIR=… npx tsx validation/tools/bb_security/work/probe-schema-writer.ts", fixture: fixture.dir, dataDir, dbPath, steps }
  const file = writeEvidence("schema-writer.json", payload)
  console.log(file)
  for (const s of steps) console.log(`${String(s.delta).padStart(3)} → schema_version=${s.schemaVersion}  ${s.step}`)
}
await main()
