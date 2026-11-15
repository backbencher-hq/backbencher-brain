// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — proves whether the bb_ask READ path writes the index: it records the handle
//   mode quick-answer.ts receives, whether the legacy-blob promotion fires during a query, and the
//   db/wal bytes+mtimes before and after. Runs only against a scratch BB_DATA_DIR and a temp
//   fixture, never the shared index.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/read-path-writes.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/intelligence/search/quick-answer.ts,
//   src/intelligence/search/semantic-search.ts (the read path it measures).
//
// Usage: BB_DATA_DIR=<scratch> BB_EMBEDDING_DISABLED=1 npx tsx read-path-writes.mts <out.json>

import { mkdtempSync, writeFileSync, statSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { quickAnswer } from "../../../../src/intelligence/search/quick-answer"
import { promoteMissingBlobsInBackground } from "../../../../src/brain/semantic/vector-promote"

const outPath = process.argv[2]
if (!outPath) {
  console.error("usage: read-path-writes.mts <out.json>")
  process.exit(2)
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const statOf = (p: string) => (existsSync(p) ? { size: statSync(p).size, mtimeMs: statSync(p).mtimeMs } : null)

// A temp project OUTSIDE the workspace; the DB lives in the scratch BB_DATA_DIR.
const fixture = mkdtempSync(path.join(tmpdir(), "bb-ask-rw-"))
for (let i = 0; i < 8; i++) {
  writeFileSync(
    path.join(fixture, `mod${i}.ts`),
    `export function requestHandler${i}(request: string): string { return request + "${i}" }\nexport class Service${i} { run(): number { return ${i} } }\n`,
  )
}
const projectId = getProjectId(fixture)
await indexProjectParallel(projectId, fixture, {})
await flushBackgroundEmbeddings()
const dbPath = BrainDatabase.getDbPath(projectId)

// ── What handle does the read path get? ─────────────────────────────────────
const readHandle = await BrainDatabase.getRawInstance(projectId)
const handleMode = { readonly: (readHandle as any).readonly === true, usedByReadPath: true }

// ── Simulate a legacy index: readable JSON, no float32 accelerator ─────────
const legacy = readHandle.prepare("UPDATE brain_semantic_embedding SET embedding_blob = NULL WHERE project_id = ?").run(projectId)
const nullBlobsBefore = ((readHandle.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ? AND embedding_blob IS NULL").get(projectId) as any)?.c ?? -1)
// Release the writer handle so the next measurement starts from files alone.
BrainDatabase.close(projectId)
await wait(300)

const before = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
const t0 = performance.now()
const answer = await quickAnswer(projectId, "how does request handling work in this codebase")
const answerMs = Math.round((performance.now() - t0) * 100) / 100
// Promotion is fire-and-forget on a timer; give it time to run, then re-read.
await wait(4000)
const afterHandle = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const nullBlobsAfter = ((afterHandle.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ? AND embedding_blob IS NULL").get(projectId) as any)?.c ?? -1)
BrainDatabase.close(projectId)
await wait(300)
const after = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }

// ── The read-only guard: a readonly handle must never promote ─────────────
const roHandle = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const roRow = roHandle.prepare("SELECT rowid AS rowid FROM brain_semantic_embedding WHERE project_id = ? LIMIT 1").get(projectId) as any
const roNullBefore = ((roHandle.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ? AND embedding_blob IS NULL").get(projectId) as any)?.c ?? -1)
promoteMissingBlobsInBackground(roHandle, projectId, String((roHandle.prepare("SELECT embedding_model m FROM brain_semantic_embedding WHERE project_id = ? LIMIT 1").get(projectId) as any)?.m), [roRow?.rowid ?? 1])
await wait(1500)
const roNullAfter = ((roHandle.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id = ? AND embedding_blob IS NULL").get(projectId) as any)?.c ?? -1)
BrainDatabase.close(projectId)

const report = {
  fixture: "(temp dir)",
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  readPathHandleReadonly: handleMode.readonly,
  legacyRowsNulledBySetup: legacy.changes,
  nullBlobsBefore,
  answerMs,
  answerFirstChars: answer.answer.slice(0, 200),
  retrievalMethod: answer.retrieval?.method ?? null,
  nullBlobsAfter,
  /** True when a pure semantic READ filled the accelerator column — a write on the read path. */
  readPathPromotedBlobs: nullBlobsAfter < nullBlobsBefore,
  files: {
    before,
    after,
    walMoved: JSON.stringify(before.wal) !== JSON.stringify(after.wal),
    dbMoved: JSON.stringify(before.db) !== JSON.stringify(after.db),
  },
  readonlyHandleGuard: { roNullBefore, roNullAfter, promoted: roNullAfter < roNullBefore },
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
rmSync(fixture, { recursive: true, force: true })
