import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { BrainDatabase } from "../../src/brain/database"
import { storeResults } from "../../src/ast/parallel-indexer"
import { handler as graph } from "../../src/mcp/tools/bb_graph/handler"
import { handler as impact } from "../../src/mcp/tools/bb_impact/handler"

const projectPath = mkdtempSync("/tmp/bb-graph-root-file-")
process.env.BB_DATA_DIR = mkdtempSync("/tmp/bb-graph-root-data-")
const projectId = "graph-root-file-regression"
const range = (startLine: number, endLine: number) => ({ startLine, endLine, startColumn: 0, endColumn: 1 })
const results = ["a", "b"].map(name => {
  const filePath = join(projectPath, name + ".ts")
  const content = "function service() {}\nfunction " + name + "Caller() { service() }\n"
  writeFileSync(filePath, content)
  return {
    success: true, filePath, language: "typescript", fileHash: name,
    symbols: [{ name: "service", kind: "function", range: range(1, 1) }, { name: name + "Caller", kind: "function", range: range(2, 2) }],
    relationships: [{ source: name + "Caller", target: "service", type: "calls", confidence: 1, line_number: 2 }],
  }
})
const stored = await storeResults(projectId, projectPath, results, { skipResolution: true })
assert.equal(stored.rolledBackFiles ?? 0, 0)
const db = await BrainDatabase.getRawInstance(projectId)
db.prepare(`
  UPDATE brain_relationship SET target_symbol_id = (
    SELECT target.id FROM brain_symbol source
    JOIN brain_symbol target ON target.file_id = source.file_id AND target.name = 'service'
    WHERE source.id = brain_relationship.source_symbol_id
  )
  WHERE project_id = ? AND relationship_type = 'calls'
`).run(projectId)
const ctx = { projectId, projectPath } as Parameters<typeof graph>[1]
const args = { symbol: "service", file: "b.ts", direction: "callers", relationshipTypes: ["calls"], refresh: false }
const graphResult = await graph(args, ctx)
assert.ok(!graphResult.isError, JSON.stringify(graphResult.content))
const payload = JSON.parse((graphResult.content[0] as { text: string }).text)
assert.equal(payload.root.file, "b.ts")
assert.equal(payload.root.candidates, 1)
assert.deepEqual(payload.callers.map((edge: any) => edge.from.name), ["bCaller"])
const absoluteGraphResult = await graph({ ...args, file: join(projectPath, "b.ts") }, ctx)
assert.ok(!absoluteGraphResult.isError, JSON.stringify(absoluteGraphResult.content))
assert.equal(JSON.parse((absoluteGraphResult.content[0] as { text: string }).text).root.id, payload.root.id)
assert.ok((await graph({ ...args, file: "missing.ts" }, ctx)).isError)
assert.ok((await graph({ ...args, symbol: "serv" }, ctx)).isError)
const impactResult = await impact(args, ctx)
assert.ok(!impactResult.isError, JSON.stringify(impactResult.content))
const affected = JSON.parse((impactResult.content[0] as { text: string }).text)
assert.equal(affected.root.file, "b.ts")
assert.deepEqual(affected.impact.map((edge: any) => edge.name), ["bCaller"])
console.log("bb_graph and bb_impact selected the same exact file and dependent")
process.exit(0)
