/**
 * READ-ONLY PROBE — does brain_file.metadata actually persist, and does the
 * migration work on a database that was created BEFORE the column existed?
 *
 * Two paths have to be proven separately, because CREATE TABLE IF NOT EXISTS
 * only ever helps a fresh database: a new DB gets the column from the DDL, and an
 * EXISTING DB — which is every real user's, and the one this repo's own index
 * lives in — needs the ALTER to fire. Passing the first and failing the second
 * would ship a change that looks correct in CI and does nothing in production.
 *
 * Also asserts the migration is idempotent, since it runs on every open.
 *
 * Uses a throwaway database. Writes nothing to the project's own index.
 */
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { ensureSchema, ensureFileMetadataColumn } from "../../../src/brain/schema-ddl"

const COLS = `(id, project_id, path, relative_path, file_hash, size_bytes, line_count, last_modified, language, framework_type, has_syntax_errors, error_report, is_test_file, layer, time_created, time_updated, metadata)`

// Exactly what an analyzer returns for a bash script, as the worker now forwards it.
const META = {
  complexity: 137,
  linesOfCode: 44,
  cyclomaticComplexity: 12,
  framework: "Bash Script",
  patterns: ["Strict Error Handling", "Container/Orchestration Script", "Insecure Pipe Execution", "Privilege Escalation"],
  detectedFrameworks: ["Bash"],
  codeQuality: "Good",
}
const ROW = {
  id: "f1", projectId: "p1", path: "/x/Deploy.sh", relativePath: "Deploy.sh",
  fileHash: "abc", sizeBytes: 812, lineCount: 44, lastModified: 1, language: "bash",
  framework: "Bash Script", err: 0, report: null, isTest: 0, layer: null,
}

const dir = mkdtempSync(path.join(tmpdir(), "bb-filemeta-"))
let failures = 0
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`)
  if (!cond) failures++
}

const insert = (db: any) =>
  db.prepare(`INSERT OR REPLACE INTO brain_file ${COLS} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(ROW.id, ROW.projectId, ROW.path, ROW.relativePath, ROW.fileHash, ROW.sizeBytes, ROW.lineCount, ROW.lastModified, ROW.language, ROW.framework, ROW.err, ROW.report, ROW.isTest, ROW.layer, 1, 1, JSON.stringify(META))

// --- PATH A: a fresh database, where the DDL alone must be enough --------------
console.log("\nPATH A — fresh database (DDL path)")
{
  const db = new Database(path.join(dir, "fresh.db"))
  ensureSchema(db as any)
  const cols = (db.prepare("PRAGMA table_info(brain_file)").all() as any[]).map((c) => c.name)
  ok(cols.includes("metadata"), "fresh DB has brain_file.metadata from the DDL")
  insert(db)
  const got = (db.prepare("SELECT metadata FROM brain_file WHERE id = ?").get("f1") as any)?.metadata
  const parsed = got ? JSON.parse(got) : null
  ok(parsed?.patterns?.length === 4, "patterns round-trip", `(${parsed?.patterns?.length} patterns)`)
  ok(parsed?.codeQuality === "Good", "codeQuality round-trips")
  ok(parsed?.cyclomaticComplexity === 12, "cyclomaticComplexity round-trips")
  db.close()
}

// --- PATH B: a database created BEFORE the column existed ---------------------
console.log("\nPATH B — pre-existing database (the migration path)")
{
  const db = new Database(path.join(dir, "old.db"))
  // The brain_file DDL exactly as it stood BEFORE this change.
  db.exec(`CREATE TABLE brain_file (
    id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, path TEXT NOT NULL,
    relative_path TEXT NOT NULL, file_hash TEXT NOT NULL, size_bytes INTEGER,
    line_count INTEGER, language TEXT, last_modified REAL, indexed_at TEXT, layer TEXT,
    is_test_file INTEGER, is_config_file INTEGER, is_documentation INTEGER,
    has_syntax_errors INTEGER NOT NULL DEFAULT 0, error_report TEXT, framework_type TEXT,
    time_created INTEGER, time_updated INTEGER)`)
  const before = (db.prepare("PRAGMA table_info(brain_file)").all() as any[]).map((c) => c.name)
  ok(!before.includes("metadata"), "pre-existing table genuinely lacks the column")

  let threw = ""
  try { insert(db) } catch (e: any) { threw = String(e.message ?? e) }
  ok(threw !== "", "the insert genuinely FAILS before the migration", threw ? `(${threw.slice(0, 46)}...)` : "")

  ensureFileMetadataColumn(db as any)
  const after = (db.prepare("PRAGMA table_info(brain_file)").all() as any[]).map((c) => c.name)
  ok(after.includes("metadata"), "the migration adds it")

  threw = ""
  try { insert(db) } catch (e: any) { threw = String(e.message ?? e) }
  ok(threw === "", "the insert succeeds after the migration", threw ? `(${threw.slice(0, 46)})` : "")
  const got = (db.prepare("SELECT metadata FROM brain_file WHERE id = ?").get("f1") as any)?.metadata
  ok(got && JSON.parse(got).patterns.length === 4, "patterns round-trip on a migrated DB")

  let idemThrew = ""
  try { ensureFileMetadataColumn(db as any); ensureFileMetadataColumn(db as any) } catch (e: any) { idemThrew = String(e.message ?? e) }
  ok(idemThrew === "", "the migration is idempotent (it runs on every open)", idemThrew)
  db.close()
}

rmSync(dir, { recursive: true, force: true })
console.log(`\n${failures === 0 ? "both paths verified" : `${failures} FAILURE(S)`}`)
process.exitCode = failures === 0 ? 0 : 1
