import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { storeResults } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const root = mkdtempSync("/tmp/bb-swift-stored-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-swift-stored-data-")
const filePath = join(root, "overloads.swift")
const source = `func deliver() {}
func overloaded(_ value: Int) {
    deliver()
}
func overloaded(_ value: String) {
    deliver()
}
`
writeFileSync(filePath, source)
const result = await ASTEngine.parseFile(filePath, source)
assert.deepEqual(result.errors, [])
const stored = await storeResults("swift-stored-overloads", root, [
  { ...result, filePath, fileHash: "fixture", success: true },
], { skipResolution: true })
assert.equal(stored.rolledBackFiles, 0)
const database = await BrainDatabase.getRawInstance("swift-stored-overloads")
const calls = database.prepare(`
  SELECT r.source_symbol_id AS source, s.line_start AS declaration_line,
    r.line_number AS call_line
  FROM brain_relationship r
  LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
  WHERE r.project_id = ? AND r.relationship_type = 'calls' AND r.target_external = 'deliver'
  ORDER BY r.line_number
`).all("swift-stored-overloads") as Array<{ source: string; declaration_line: number; call_line: number }>
assert.deepEqual(calls.map(call => [call.declaration_line, call.call_line]), [[2, 3], [5, 6]])
assert.equal(new Set(calls.map(call => call.source)).size, 2)
assert.ok(calls.every(call => call.source))
console.log("Swift overload calls retain distinct stored source symbols")
process.exit(0)
