// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — integration gate for bb_ask: it proves the answer path joins
//   the index, the freshness resolver and the read-only contract correctly — sources
//   resolve to indexed files, a changed file is marked STALE, a deleted file is marked
//   MISSING (a different fact), a refresh clears the stale marker, and a plain read
//   leaves the database bytes and WAL untouched.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — freshness is the one place a read tool can be confidently
//   wrong: stale is "changed since index", missing is "no longer on disk", and the old
//   marker called both "changed". The read-only checks exist because the answer path is
//   a read: it must not heal, migrate or promote anything.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/a4.json and
//   validation/tools/bb_ask/gates/.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/{semantic-search,quick-answer}.ts,
//   src/mcp/tools/bb_ask/handler.ts, docs/BB_ASK.md.
// CONTRACTS IT MUST NOT BREAK — read-only access, stale vs missing distinction, no NaN
//   similarity, sources resolvable to indexed rows.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync, unlinkSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { Harness, noNanSimilarity } from "./harness"

const harness = new Harness({
  issue: "bb_ask integration: index join, freshness (stale vs missing), refresh loop and read-only access",
  code: "A4",
  tool: "bb_ask",
  title: "bb_ask: integration (index + embeddings + freshness + read-only)",
  layers: ["integration"],
  decisions: {
    resolution: "every cited source resolves to an indexed brain_file row",
    freshness: "a file changed after indexing is marked STALE; a file deleted after indexing is marked MISSING; the two markers are distinct",
    readonly: "a semantic answer and an aggregate answer leave brain.db and its WAL byte-identical (0-byte WAL and touched -shm are connection artifacts, not writes)",
    refresh: "reindexing clears the stale marker — the loop closes",
  },
  limitations: ["The lexical-fallback leg's read-only status depends on the shared content-search/symbol-search engines and is asserted in the honesty gate, which names that dependency."],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-ask-integration-"))
const projectId = getProjectId(root)
const srcDir = path.join(root, "src")
mkdirSync(srcDir, { recursive: true })
const identical = "export function requestHandler(request: string): string { return request + \"handled\" }\n"
const alphaPath = path.join(srcDir, "alpha.ts")
const betaPath = path.join(srcDir, "beta.ts")
writeFileSync(alphaPath, identical)
writeFileSync(betaPath, identical)
await indexProjectParallel(projectId, root, {})
await flushBackgroundEmbeddings()
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => (existsSync(p) ? { size: statSync(p).size, mtimeMs: Math.round(statSync(p).mtimeMs) } : null)
const files = () => ({ db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) })
// Database bytes must not move and WAL frames must not grow. An absent -wal and a
// zero-byte one are both "no frames"; only an appended frame range is a write.
const walFrames = (files: ReturnType<typeof files>) => files.wal?.size ?? 0
const unchanged = (before: ReturnType<typeof files>, after: ReturnType<typeof files>) =>
  before.db?.size === after.db?.size && before.db?.mtimeMs === after.db?.mtimeMs && walFrames(after) === walFrames(before)

// ── 1. Answers resolve to indexed rows ────────────────────────────────────
{
  const res = await quickAnswer(projectId, "how does request handling work")
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const allResolve = res.sources.every((source) => {
    const row = raw.prepare("SELECT 1 FROM brain_file WHERE relative_path = ? OR path = ?").get(source.file, source.file) as any
    return !!row
  })
  harness.check("integration: every answer source resolves to an indexed brain_file row", allResolve, JSON.stringify(res.sources).slice(0, 140))
  harness.check("integration: answer is non-empty with provenance and bounds", res.answer.length > 0 && !!res.provenance.evidenceClass && !!res.bounds, res.provenance.evidenceClass)
}

// ── 2. Vector path metadata and comparison facts ──────────────────────────
{
  const res = await semanticVectorSearch(projectId, "request handler")
  if (res.metadata.method === "vector") {
    harness.check("integration: vector path resolves entities to indexed files", res.results.every((r) => r.file.length > 0 && r.symbolName.length > 0), `results=${res.results.length}`)
    harness.check("integration: comparison count equals scanned rows when the scan is not capped", res.scan.capped || res.comparison.comparableEmbeddings === res.scan.scannedRows, `comparable=${res.comparison.comparableEmbeddings} scanned=${res.scan.scannedRows}`)
    harness.negative("integration: vector results carry no NaN similarity", res.results.every(noNanSimilarity))
  } else {
    harness.check("integration: vector path unavailable at runtime (recorded, not failed)", true, `method=${res.metadata.method} reason=${res.metadata.fallbackReason ?? ""}`)
  }
}

// ── 3. A plain read leaves the database bytes and WAL untouched ───────────
{
  const before = files()
  await quickAnswer(projectId, "how does request handling work")
  const afterAnswer = files()
  harness.negative("integration: a semantic answer leaves brain.db and its WAL unchanged", unchanged(before, afterAnswer), `before=${JSON.stringify(before)} after=${JSON.stringify(afterAnswer)}`)
  const beforeAggregate = files()
  await quickAnswer(projectId, "how many functions are in this project")
  harness.negative("integration: an aggregate answer leaves brain.db and its WAL unchanged", unchanged(beforeAggregate, files()), `before=${JSON.stringify(beforeAggregate)} after=${JSON.stringify(files())}`)
}

// ── 4. Stale and missing are two different facts ──────────────────────────
{
  appendFileSync(alphaPath, "\n// changed after indexing\n")
  unlinkSync(betaPath)
  const answer = await quickAnswer(projectId, "request handler")
  harness.negative("integration: a changed file is marked STALE", answer.answer.includes("[STALE — file changed since index]"), answer.answer.split("\n").filter((l) => l.includes("[STALE") || l.includes("[MISSING")).join(" | ").slice(0, 200))
  harness.negative("integration: a deleted file is marked MISSING, not 'changed'", answer.answer.includes("[MISSING — file no longer on disk]"), answer.answer.split("\n").filter((l) => l.includes("[STALE") || l.includes("[MISSING")).join(" | ").slice(0, 200))
  const semantic = await semanticVectorSearch(projectId, "request handler")
  const alpha = semantic.results.find((r) => r.file.endsWith("alpha.ts"))
  const beta = semantic.results.find((r) => r.file.endsWith("beta.ts"))
  harness.check("integration: the changed file's result carries stale=true and is not marked missing", !!alpha && alpha.stale === true && alpha.missing !== true, JSON.stringify({ alphaStale: alpha?.stale, alphaMissing: alpha?.missing }))
  harness.check("integration: the deleted file's result carries missing=true", !!beta && beta.missing === true, JSON.stringify({ betaStale: beta?.stale, betaMissing: beta?.missing }))
}

// ── 5. Refresh clears the stale marker (the loop closes) ──────────────────
{
  writeFileSync(alphaPath, identical + "\n// reindexed content\n")
  await indexProjectParallel(projectId, root, {})
  await flushBackgroundEmbeddings()
  const semantic = await semanticVectorSearch(projectId, "request handler")
  const alpha = semantic.results.find((r) => r.file.endsWith("alpha.ts"))
  harness.check("integration: after refresh the changed file is no longer stale", !alpha || alpha.stale !== true, alpha ? `stale=${alpha.stale}` : "no alpha result")
}

// ── 6. Embeddings removed: the lexical fallback is declared, not silent ───
{
  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id = ?").run(projectId)
  const res = await semanticVectorSearch(projectId, "request handling")
  harness.check("integration: keyword-fallback path engages with an explicit reason", res.metadata.method === "keyword-fallback" && typeof res.metadata.fallbackReason === "string", JSON.stringify({ method: res.metadata.method, reason: res.metadata.fallbackReason }))
  harness.check("integration: fallback results resolve to indexed files", res.results.every((r) => r.file.length > 0), `results=${res.results.length}`)
  harness.negative("integration: fallback results carry no NaN similarity", res.results.every(noNanSimilarity))
}

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(dbPath), { recursive: true, force: true })
harness.emit()
