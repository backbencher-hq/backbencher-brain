import assert from "node:assert/strict"
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { indexProjectParallel, reindexFilesParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const root = mkdtempSync("/tmp/bb-incremental-import-")
const caller = join(root, "caller.ts")
const service = join(root, "service.ts")
writeFileSync(caller, "import { execute } from './service'\nexport function run() { return execute() }\n")
const logger = { log() {}, write() {} }
const incremental = "incremental-import-parity"
const clean = "clean-import-parity"
const requireWorker = process.argv.includes("--require-worker")

async function calls(projectId: string) {
  const db = await BrainDatabase.getRawInstance(projectId)
  return db.prepare(`
    SELECT source.name AS source, target.name AS target, file.relative_path AS target_file,
           r.target_external AS spelling, r.is_cross_file AS cross_file
    FROM brain_relationship r
    JOIN brain_symbol source ON source.id = r.source_symbol_id
    LEFT JOIN brain_symbol target ON target.id = r.target_symbol_id
    LEFT JOIN brain_file file ON file.id = target.file_id
    WHERE r.project_id = ? AND r.relationship_type = 'calls' AND source.name = 'run'
    ORDER BY r.line_number, r.target_external
  `).all(projectId)
}

async function ownedImports(projectId: string) {
  const db = await BrainDatabase.getRawInstance(projectId)
  return db.prepare(`
    SELECT source_external, target_external, line_number
    FROM brain_relationship
    WHERE project_id = ? AND relationship_type = 'imports'
    ORDER BY source_external, target_external, line_number
  `).all(projectId)
}

const first = await indexProjectParallel(incremental, root, { logger })
assert.equal(first.successFiles, 1)
if (requireWorker) assert.equal(first.summary?.parseMode, "worker-pool")
assert.ok((await calls(incremental)).some((row: any) => row.target_file === null))
writeFileSync(service, "export function execute() { return 42 }\n")
const edit = await reindexFilesParallel(incremental, root, [{ path: service, type: "added" }], { logger })
assert.equal(edit.errors, 0)
assert.equal(edit.indexed, 1)
if (requireWorker) assert.equal(edit.derived?.pass, "bounded")
const rebuild = await indexProjectParallel(clean, root, { logger })
assert.equal(rebuild.successFiles, 2)
if (requireWorker) assert.equal(rebuild.summary?.parseMode, "worker-pool")
const expected = await calls(clean)
assert.ok(expected.some((row: any) => row.target_file === "service.ts"))
assert.deepEqual(await calls(incremental), expected)
assert.ok((await ownedImports(incremental)).length > 0)
writeFileSync(caller, "export function run() { return 0 }\n")
const removal = await reindexFilesParallel(incremental, root, [{ path: caller, type: "modified" }], { logger })
assert.equal(removal.errors, 0)
assert.equal(removal.indexed, 1)
const withoutImport = "clean-without-import"
assert.equal((await indexProjectParallel(withoutImport, root, { logger })).successFiles, 2)
assert.deepEqual(await ownedImports(incremental), await ownedImports(withoutImport))

writeFileSync(caller, "import { execute } from './service'\nexport function run() { return execute() }\n")
assert.equal((await reindexFilesParallel(incremental, root, [{ path: caller, type: "modified" }], { logger })).errors, 0)
assert.ok((await ownedImports(incremental)).length > 0)
unlinkSync(caller)
assert.equal((await reindexFilesParallel(incremental, root, [{ path: caller, type: "deleted" }], { logger })).errors, 0)
assert.deepEqual(await ownedImports(incremental), [])
console.log("Incremental import addition, removal, and file deletion agree with a clean index")
process.exit(0)
