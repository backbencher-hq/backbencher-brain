// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — tests whether the embedding-coverage figure a bb_ask answer reports can
//   contradict the results in that same answer. semantic-search.ts measures coverage BEFORE it
//   awaits the query embedding, and the indexer's embedding drain runs in the background, so a
//   query issued into a draining index can report "0% embedded" and return vector matches.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/coverage-race.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/search/semantic-search.ts (measureCoverage
//   ordering), src/intelligence/search/quick-answer.ts (coverage note).
//
// Usage: BB_DATA_DIR=<scratch> BB_EMBEDDING_DISABLED=1 npx tsx coverage-race.mts <out.json>

import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { semanticVectorSearch } from "../../../../src/intelligence/search/semantic-search"

const outPath = process.argv[2]
if (!outPath) {
  console.error("usage: coverage-race.mts <out.json>")
  process.exit(2)
}

const attempts: any[] = []
for (let attempt = 0; attempt < 3; attempt++) {
  const fixture = mkdtempSync(path.join(tmpdir(), "bb-ask-cov-"))
  for (let f = 0; f < 120; f++) {
    let body = ""
    for (let i = 0; i < 12; i++) body += `export function requestHandler${f}_${i}(request: string): string { return request + "handler" }\n`
    writeFileSync(path.join(fixture, `mod${f}.ts`), body)
  }
  const projectId = getProjectId(fixture)
  // Deliberately NO flushBackgroundEmbeddings(): the query races the drain.
  await indexProjectParallel(projectId, fixture, {})
  const read = async () => {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    return (raw.prepare("SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id = ?").get(projectId) as any)?.c ?? 0
  }
  const embeddedAtQueryStart = await read()
  const result = await semanticVectorSearch(projectId, "where is the request handler", { maxResults: 5 })
  const embeddedAfter = await read()
  const reported = result.metadata.embeddedSymbolCount
  attempts.push({
    attempt,
    embeddedAtQueryStart,
    embeddedAfterQuery: embeddedAfter,
    reportedCoverageEmbedded: reported,
    reportedCoverageSymbols: result.metadata.indexSymbolCount,
    method: result.metadata.method,
    resultCount: result.results.length,
    /** The self-contradiction: the answer says N rows are comparable while it returns vector matches. */
    contradiction: result.metadata.method === "vector" && reported === 0 && result.results.length > 0,
  })
  try { await BrainDatabase.close(projectId) } catch {}
  rmSync(fixture, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
const report = { attempts, anyContradiction: attempts.some((a) => a.contradiction), generatedAt: new Date().toISOString() }
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
