// script/m21/verify-index-resume.ts — M21.R3, rewritten 2026-11-01 as a POSITIVE contract test
//
// WHAT THIS GATE USED TO BE. A source-audit that asserted the ABSENCE of the features it was meant to
// demand: "cancellation is not falsely claimed when no cancellation input exists", "checkpoint is not
// falsely claimed when no checkpoint state exists". That was honest when the indexer had neither — it
// recorded status "known-gap"/"blocked" in validation/m21/results/R3.json. Since then the indexer grew
// a cooperative AbortSignal (cancelled runs drain and write phase "cancelled") and a durable live
// status/checkpoint that `bb index --resume` reads, so the audit's premises became false and the gate
// failed every run while still describing the old world.
//
// WHAT IT PROVES NOW (end to end, real indexer, no mocks):
//   1. INTERRUPT: a run aborted mid-parse reports `cancelled`, leaves a readable checkpoint whose phase
//      is "cancelled", and has stored SOME files but NOT all of them.
//   2. RESUME: an incremental run (what `bb index --resume` runs) finishes the corpus — every expected
//      file is stored exactly once, none lost, and it skipped the files the interrupted run had stored
//      (proof it CONTINUED rather than restarted from zero).
//   3. HONESTY: the cancelled run is not recorded as complete, and the resumed run is.
//
// Run: npx tsx script/m21/verify-index-resume.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
let checks = 0
let failed = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) console.log(`  ok: ${label}`)
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-m21-r3-"))
const project = path.join(tmp, "proj")
const dataDir = path.join(tmp, "data")
mkdirSync(path.join(project, "src"), { recursive: true })
mkdirSync(dataDir, { recursive: true })

// 81 indexable files (80 sources + package.json). Bodies are long enough that an interrupt at the first
// progress tick lands mid-parse rather than after completion.
const EXPECTED = 81
for (let i = 0; i < 80; i++) {
  const lines = [`export class Widget${i} {`]
  for (let m = 0; m < 60; m++) lines.push(`  method${m}(n: number): number { return n + ${m + i} }`)
  lines.push("}")
  lines.push(`export function helper${i}(n: number): number { return n * ${i + 1} }`)
  writeFileSync(path.join(project, `src/w${String(i).padStart(3, "0")}.ts`), lines.join("\n") + "\n")
}
writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "resume-fixture", version: "1.0.0" }))

// Offline + deterministic: no embedding provider from the checkout's bb.json; the local fallback runs.
for (const k of Object.keys(process.env)) if (k.startsWith("BB_EMBEDDING") || k === "BB_CONFIG_FILE") delete process.env[k]
process.env.BB_DATA_DIR = dataDir

const originalCwd = process.cwd()
process.chdir(project)
const { indexProjectParallel, flushBackgroundEmbeddings } = await import("../../src/ast/parallel-indexer")
const { getProjectId } = await import("../../src/util/project-id")
const { readIndexCheckpoint } = await import("../../src/ast/index-status")
const pid = getProjectId(project)
const dbPath = path.join(dataDir, "projects", pid, "brain.db")

function dbRows(): string[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return (db.prepare("SELECT relative_path AS p FROM brain_file ORDER BY 1").all() as Array<{ p: string }>).map((r) => r.p)
  } finally {
    db.close()
  }
}
function statusRow(): { status: string; indexed_files: number; total_files: number } | null {
  const db = new Database(dbPath, { readonly: true })
  try {
    return (db.prepare("SELECT status, indexed_files, total_files FROM brain_index_status WHERE project_id = ?").get(pid) as any) ?? null
  } finally {
    db.close()
  }
}

try {
  // ── 1. INTERRUPT a real run ───────────────────────────────────────────────────────────────────────
  const controller = new AbortController()
  let abortedAt = -1
  const run1 = await indexProjectParallel(pid as any, project, {
    signal: controller.signal,
    skipPostProcessing: true,
    onProgress: (s: any) => {
      if (abortedAt < 0 && Number(s?.processedFiles ?? 0) >= 8) {
        abortedAt = Number(s.processedFiles)
        controller.abort()
      }
    },
  })
  const checkpoint = readIndexCheckpoint(pid)
  const storedAfterInterrupt = dbRows()
  check("interrupted run reports cancelled", run1.cancelled === true, JSON.stringify({ cancelled: run1.cancelled, processed: run1.processedFiles, total: run1.totalFiles }))
  check("interrupt actually happened mid-run (not after completion)", abortedAt >= 0 && Number(run1.processedFiles) < EXPECTED, `abortedAt=${abortedAt} processed=${run1.processedFiles}/${run1.totalFiles}`)
  check(
    "a readable checkpoint remains after the interrupt",
    checkpoint.integrity === "ok" && !!checkpoint.status,
    JSON.stringify({ integrity: checkpoint.integrity, problem: checkpoint.problem }),
  )
  check("the checkpoint phase is 'cancelled'", checkpoint.status?.phase === "cancelled", String(checkpoint.status?.phase))
  check("the checkpoint counts the partial progress", Number(checkpoint.status?.processedFiles ?? 0) > 0, JSON.stringify(checkpoint.status ?? null))
  check(
    "some files were stored before the interrupt, but not all",
    storedAfterInterrupt.length > 0 && storedAfterInterrupt.length < EXPECTED,
    `stored=${storedAfterInterrupt.length}/${EXPECTED}`,
  )
  check(
    "an interrupted run is NOT recorded as a complete index",
    (statusRow()?.status ?? "") !== "complete" || Number(statusRow()?.indexed_files ?? 0) < EXPECTED,
    JSON.stringify(statusRow()),
  )

  // ── 2. RESUME with the same semantics `bb index --resume` uses (incremental run) ────────────────
  const t0 = Date.now()
  const run2 = await indexProjectParallel(pid as any, project, { isIncremental: true })
  await flushBackgroundEmbeddings({ timeoutMs: 120_000 })
  const wallMs = Date.now() - t0
  const storedAfterResume = dbRows()
  const expectedPaths = Array.from({ length: 80 }, (_, i) => `src/w${String(i).padStart(3, "0")}.ts`).concat(["package.json"])
  const missing = expectedPaths.filter((p) => !storedAfterResume.includes(p))
  const duplicates = storedAfterResume.length - new Set(storedAfterResume).size
  check("resumed run is not cancelled", run2.cancelled !== true, String(run2.cancelled))
  check("resumed run discovers the whole corpus", Number(run2.totalFiles) === EXPECTED, `${run2.totalFiles}/${EXPECTED}`)
  check("no file is lost across interrupt + resume", missing.length === 0, JSON.stringify(missing.slice(0, 8)))
  check("no duplicate brain_file rows", duplicates === 0 && storedAfterResume.length === EXPECTED, `stored=${storedAfterResume.length} dupes=${duplicates}`)
  check(
    "resume CONTINUED: it skipped the files the interrupted run had stored",
    Number(run2.skippedFiles) >= storedAfterInterrupt.length,
    `skipped=${run2.skippedFiles} storedBefore=${storedAfterInterrupt.length}`,
  )
  check(
    "resume accounts for every discovered file",
    Number(run2.successFiles) + Number(run2.skippedFiles) + Number(run2.errorFiles) === EXPECTED,
    JSON.stringify({ success: run2.successFiles, skipped: run2.skippedFiles, errors: run2.errorFiles, total: run2.totalFiles }),
  )
  check("the resumed index is recorded as complete with full coverage", statusRow()?.status === "complete" && Number(statusRow()?.indexed_files) === EXPECTED, JSON.stringify(statusRow()))

  // ── 3. evidence ──────────────────────────────────────────────────────────────────────────────────
  const result = {
    issue: "M21.R3",
    code: "R3",
    milestone: "M21",
    title: "index interruption, checkpoint honesty, and resume completeness",
    status: failed === 0 ? "verified" : "failed",
    contract: {
      cancellationInput: true, // indexProjectParallel accepts an AbortSignal; a cancelled run drains, then writes phase "cancelled"
      checkpoint: true, // readIndexCheckpoint returns the live status document atomically written by the interrupted run
      resumeState: true, // `bb index --resume` = an incremental run; it skips files already stored
      interruptedRunVerified: true,
    },
    checks,
    passed: checks - failed,
    failed,
    measured: {
      fixtureIndexableFiles: EXPECTED,
      interrupt: { abortedAt, processedFiles: run1.processedFiles, totalFiles: run1.totalFiles, storedFiles: storedAfterInterrupt.length, cancelled: run1.cancelled === true },
      resume: { successFiles: run2.successFiles, skippedFiles: run2.skippedFiles, errorFiles: run2.errorFiles, totalFiles: run2.totalFiles, wallMs, failed: run2.errorFiles },
      final: { dbFiles: storedAfterResume.length, missingFiles: missing.length, duplicateRows: duplicates, status: statusRow()?.status ?? null, indexedFiles: statusRow()?.indexed_files ?? null },
    },
    limitations: [
      "The interrupt is COOPERATIVE (AbortSignal — exactly the path Ctrl+C drives: the CLI aborts this signal on SIGINT), not SIGKILL. Atomic status-file durability across a hard kill is the separate contract of index-status.ts (temp file + rename), not re-proven here.",
      "The resume used the same incremental semantics the CLI's --resume sets (isIncremental). It does not replay a checkpoint cursor; stored files are skipped by the mtime/size check, which is what --resume documents.",
    ],
    negatives: [
      "An interrupted run is not reported as a completed index.",
      "A resume that loses a file or duplicates a row fails this gate.",
      "A resume that parses every file again (skippedFiles < storedBeforeInterrupt) fails the 'continued' check.",
    ],
    verifierCommand: "npx tsx script/m21/verify-index-resume.ts",
    generatedAt: new Date().toISOString(),
  }
  const dir = path.join(ROOT, "validation/m21/results")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "R3.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(`\n  measured: interrupted after ${run1.processedFiles}/${EXPECTED} processed (${storedAfterInterrupt.length} stored); resumed ${run2.successFiles} parsed + ${run2.skippedFiles} skipped → ${storedAfterResume.length}/${EXPECTED} stored, ${missing.length} missing, ${duplicates} dupes in ${wallMs}ms`)
} finally {
  process.chdir(originalCwd)
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
}

console.log(`\nR3: ${failed === 0 ? "VERIFIED" : "FAILED"} (${checks - failed}/${checks})`)
process.exit(failed === 0 ? 0 : 1)
