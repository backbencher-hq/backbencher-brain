// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — isolates WHERE a bb_ask read call touches the database files: it stats the
//   db/wal after each step (cold on disk → read-write open → one SELECT → close), all on a scratch
//   BB_DATA_DIR, so the "read path writes the index" claim names a step instead of a guess.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/read-path-writes-steps.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/brain/database.ts (getRawInstance), work/read-path-writes.mts.
//
// Usage: BB_DATA_DIR=<scratch> BB_EMBEDDING_DISABLED=1 npx tsx read-path-steps.mts <out.json>

import { mkdtempSync, writeFileSync, statSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const outPath = process.argv[2]
if (!outPath) {
  console.error("usage: read-path-steps.mts <out.json>")
  process.exit(2)
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const statOf = (p: string) => (existsSync(p) ? { size: statSync(p).size, mtimeMs: Math.round(statSync(p).mtimeMs) } : null)

const fixture = mkdtempSync(path.join(tmpdir(), "bb-ask-steps-"))
for (let i = 0; i < 6; i++) writeFileSync(path.join(fixture, `m${i}.ts`), `export function handler${i}(): number { return ${i} }\n`)
const projectId = getProjectId(fixture)
await indexProjectParallel(projectId, fixture, {})
await flushBackgroundEmbeddings()
const dbPath = BrainDatabase.getDbPath(projectId)
BrainDatabase.close(projectId)
await wait(500)
const files = () => ({ db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) })
const steps: Array<{ step: string; files: ReturnType<typeof files>; extra?: unknown }> = []
steps.push({ step: "0. after indexer close (nothing open)", files: files() })

// Step 1: exactly what quick-answer.ts indexState() does.
const rw = await BrainDatabase.getRawInstance(projectId)
steps.push({ step: "1. getRawInstance(projectId) — rw open, no statement", files: files(), extra: { readonly: (rw as any).readonly === true } })

// Step 2: one COUNT, exactly the index-state query.
const count = (rw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(projectId) as any)?.c
steps.push({ step: "2. SELECT COUNT(*) FROM brain_file (indexState)", files: files(), extra: { files: count } })

// Step 3: the coverage aggregate semantic-search runs at the top of every call.
const cov = rw.prepare(
  "SELECT (SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?) AS symbols, (SELECT COUNT(DISTINCT entity_id) FROM brain_semantic_embedding WHERE project_id = ?) AS embedded",
).get(projectId, projectId)
steps.push({ step: "3. coverage aggregate (measureCoverage)", files: files(), extra: cov })

// Step 4: close, as the process would.
BrainDatabase.close(projectId)
await wait(500)
steps.push({ step: "4. close()", files: files() })

const report = {
  fixture: "(temp dir)",
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  steps,
  walCreatedByRwOpen: steps[1].files.wal !== null && steps[0].files.wal === null,
  walMovedByReadOpen: JSON.stringify(steps[0].files) !== JSON.stringify(steps[1].files),
  dbChangedByReadOpen: steps[0].files.db?.size !== steps[1].files.db?.size,
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
rmSync(fixture, { recursive: true, force: true })
