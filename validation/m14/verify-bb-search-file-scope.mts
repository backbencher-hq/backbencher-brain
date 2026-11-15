import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseFile } from "../../src/ast/engine"
import { storeResults } from "../../src/ast/parallel-indexer"
import { handler } from "../../src/mcp/tools/bb_search/handler"

const projectPath = mkdtempSync("/tmp/bb-launch-search-")
const projectId = "launch-search-file-scope"
const results = []
for (const relative of ["src/analyzer.ts", "archive/src/analyzer.ts"]) {
  const filePath = join(projectPath, relative)
  const source = "export function analyze() {}\n"
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, source)
  const stat = statSync(filePath)
  results.push({
    ...(await parseFile(filePath, source)), filePath, success: true, language: "typescript",
    fileHash: createHash("sha256").update(source).digest("hex").slice(0, 16),
    sizeBytes: stat.size, lastModified: stat.mtimeMs,
  })
}
await storeResults(projectId, projectPath, results, { skipResolution: true })

async function search(symbolName: string) {
  const result = await handler({ mode: "symbol", symbolName, filePath: "src/analyzer.ts", refresh: false }, { projectId, projectPath } as any)
  assert.ok(!result.isError)
  return JSON.parse((result.content[0] as { text: string }).text)
}
const found = await search("analyze")
assert.equal(found.totalMatches, 1)
assert.equal(found.matches[0].fileId, join(projectPath, "src/analyzer.ts"))

writeFileSync(join(projectPath, "src/analyzer.ts"), "export function newlyAddedAnalyzer() { return true }\n")
const miss = await search("newlyAddedAnalyzer")
assert.equal(miss.found, false)
assert.equal(miss.freshness.stale, 1)
console.log("bb_search file scope and stale misses passed")
process.exit(0)
