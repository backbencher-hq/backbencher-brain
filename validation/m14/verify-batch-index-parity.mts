import assert from "node:assert/strict"
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { indexProjectParallel, reindexFilesParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const root = mkdtempSync("/tmp/bb-batch-parity-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-batch-parity-data-")
const inputs = {
  "sample.rs": "fn rust_first() {} fn rust_entry() { rust_first(); }\n",
  "sample.cs": "class CsSample { void CsFirst() {} void CsEntry() { CsFirst(); } }\n",
  "sample.php": "<?php class PhpSample { function phpFirst() {} function phpEntry() { $this->phpFirst(); } }\n",
  "sample.rb": "class RbSample\n  def rb_first; end\n  def rb_entry; rb_first; end\nend\n",
  "sample.swift": "class SwiftSample { func swiftFirst() {} func swiftEntry() { swiftFirst() } }\n",
}
for (const [file, source] of Object.entries(inputs)) writeFileSync(join(root, file), source)
const logger = { log() {}, write() {} }
const initial = await indexProjectParallel("batch-incremental", root, { logger })
assert.equal(initial.successFiles, 5)
if (process.argv.includes("--require-worker")) assert.equal(initial.summary?.parseMode, "worker-pool")
const changes = Object.entries(inputs).map(([file, source]) => {
  writeFileSync(join(root, file), source.replaceAll("first", "second").replaceAll("First", "Second"))
  return { path: join(root, file), type: "modified" as const }
})
const updated = await reindexFilesParallel("batch-incremental", root, changes, { logger })
assert.equal(updated.errors, 0)
assert.equal(updated.indexed, 5)
const rebuilt = await indexProjectParallel("batch-full", root, { logger })
assert.equal(rebuilt.successFiles, 5)
if (process.argv.includes("--require-worker")) assert.equal(rebuilt.summary?.parseMode, "worker-pool")
async function snapshot(project: string) {
  const db = await BrainDatabase.getRawInstance(project)
  return db.prepare(`
    SELECT f.relative_path AS source_file, s.name AS source,
      r.relationship_type AS kind, r.target_external AS spelling,
      target.name AS target, target_file.relative_path AS target_file,
      r.line_number AS site, r.confidence
    FROM brain_relationship r
    LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
    LEFT JOIN brain_file f ON f.id = s.file_id
    LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
    LEFT JOIN brain_file target_file ON target_file.id = target.file_id
    WHERE r.project_id = ?
    ORDER BY source_file, source, kind, spelling, site
  `).all(project)
}
const expected = await snapshot("batch-full")
const database = await BrainDatabase.getRawInstance("batch-full")
assert.equal(database.prepare(
  "SELECT source_external FROM brain_relationship WHERE project_id = ? AND relationship_type = 'exports' AND target_external = 'RbSample'",
).get("batch-full")?.source_external, "sample.rb")
assert.ok(expected.length > 10)
assert.deepEqual(await snapshot("batch-incremental"), expected)
assert.equal(JSON.stringify(expected).includes("First"), false)
assert.equal(JSON.stringify(expected).includes("first"), false)

unlinkSync(join(root, "sample.swift"))
const deleted = await reindexFilesParallel("batch-incremental", root, [
  { path: join(root, "sample.swift"), type: "deleted" },
], { logger })
assert.equal(deleted.errors, 0)
const afterDeletion = await indexProjectParallel("batch-deletion-full", root, { logger })
assert.equal(afterDeletion.successFiles, 4)
assert.deepEqual(await snapshot("batch-incremental"), await snapshot("batch-deletion-full"))
console.log(JSON.stringify({ passed: true, parseMode: initial.summary?.parseMode, lanes: Object.keys(inputs), relationships: expected.length }))
process.exit(0)
