import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { storeResults } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { classifyStoredRow } from "../../src/lsp/evidence_tier"
import { handler } from "../../src/mcp/tools/bb_graph/handler"

const root = mkdtempSync("/tmp/bb-fallback-project-")
const filePath = join(root, "sample.py")
const code = "class Worker:\n    def work(self):\n        return self.helper()\n    def helper(self):\n        return 1\n" + "# " + "a".repeat(1_050_000) + "\n"
writeFileSync(filePath, code)
const result = await parseFile(filePath, root)
assert.equal(result.fallback, true)
assert.equal(result.fileHash, createHash("sha256").update(code).digest("hex").slice(0, 16))
assert.ok(result.relationships.some(row => row.type === "calls"))
const projectId = "audit-fallback-test"
await storeResults(projectId, root, [{ filePath, ...result }], { skipResolution: true })
const db = await BrainDatabase.getRawInstance(projectId)
const rows = db.prepare("SELECT relationship_type, confidence, metadata FROM brain_relationship").all() as Parameters<typeof classifyStoredRow>[0][]
assert.ok(rows.some(row => row.relationship_type === "contains"), "synthetic containment must be exercised")
assert.ok(rows.some(row => row.relationship_type === "calls"), "regex call must reach storage")
for (const row of rows) {
  assert.equal(JSON.parse(row.metadata ?? "{}").method, "regex")
  assert.equal(classifyStoredRow(row), "inferred")
}
assert.equal(classifyStoredRow({ relationship_type: "contains", confidence: 1, metadata: '{"method":"regex"}' }), "inferred")
const graph = await handler({ symbol: "Worker", direction: "callees", relationshipTypes: ["contains"] }, { projectId } as any)
const payload = JSON.parse((graph.content[0] as { text: string }).text)
assert.ok(payload.callees.length > 0)
assert.ok(payload.callees.every(edge => edge.tier === "inferred" && edge.extractionMethod === "regex"))
console.log("Fallback provenance round-trip passed")
process.exit(0)
