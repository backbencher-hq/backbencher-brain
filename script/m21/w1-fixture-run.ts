// script/m21/w1-fixture-run.ts — M21.W1 fixture runner.
//
// Spawned as a CHILD process by verify-w1-worker-lifecycle.ts with fixture env
// vars. It must run in its own process because ParallelIndexerConfig reads
// environment at module load — the fixture knobs (BB_FILE_TIMEOUT_MS,
// BB_WORKER_DELAY_PARSE_MS, BB_WORKER_CRASH_ON_BATCH,
// BB_WORKER_DELAY_READY_MS, BB_WORKER_STARTUP_TIMEOUT_MS) only take effect
// when set before the indexer module is evaluated.
//
// Creates a temp project with W1_N_FILES small TS files, indexes it with
// skipPostProcessing (isolating the worker-pool lifecycle), and prints a
// single machine-readable line with the resulting stats. Always terminates:
// the index itself is bounded by the worker pool's own timeouts/retry caps.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const root = mkdtempSync(path.join(tmpdir(), "bb-m21-w1-fixture-"))
const n = Number(process.env.W1_N_FILES || 3)
mkdirSync(path.join(root, "src"), { recursive: true })
for (let i = 0; i < n; i++) {
  writeFileSync(
    path.join(root, "src", `file_${i}.ts`),
    `\nexport function fn_${i}(x: number): number { return x + ${i} }\nexport function caller_${i}(): number { return fn_${i}(1) }\n`,
  )
}

try {
  const projectId = getProjectId(root)
  const stats = await indexProjectParallel(projectId, root, { skipPostProcessing: true })
  const out = {
    projectId,
    root,
    successFiles: stats.successFiles,
    errorFiles: stats.errorFiles,
    timeoutFiles: stats.timeoutFiles,
    skippedFiles: stats.skippedFiles,
    totalFiles: stats.totalFiles,
    phases: stats.phases ?? null,
    errors: stats.errors,
  }
  console.log("W1_FIXTURE_RESULT " + JSON.stringify(out))
  BrainDatabase.close(projectId)
} catch (e: any) {
  console.log("W1_FIXTURE_ERROR " + (e?.message || String(e)))
} finally {
  rmSync(root, { recursive: true, force: true })
}
