// script/m21/x1-big-parse-runner.ts — M21.X1 parser-failure child runner.
//
// Spawned by verify-x1-cold-benchmark.ts with BB_FILE_TIMEOUT_MS=150 in the
// environment. ParallelIndexerConfig reads BB_FILE_TIMEOUT_MS at module load,
// so the short timeout must be set before this process imports the indexer —
// hence the child-process design. Creates a fixture with one 999KB TypeScript
// file (under the 1MB structural-extraction tier, so it is full-AST-parsed
// and a full parse takes far longer than 150ms), indexes it cold, and prints
// a single machine-readable line with the outcome.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const root = mkdtempSync(path.join(tmpdir(), "bb-m21-x1-big-"))
mkdirSync(path.join(root, "src"), { recursive: true })
// ~950KB total (just under the 1MB structural-extraction tier) so the file is
// full-AST-parsed — a full parse of a megabyte of code takes seconds, far
// longer than the 150ms worker self-timeout.
const lines: string[] = []
for (let i = 0; i < 8000; i++) {
  lines.push(`export function fn_${i}(x: number, y: number): number { const a = x * 2; const b = y + ${i}; return a + b + ${i}; }`)
}
const content = lines.join("\n")
if (content.length > 1024 * 1024) throw new Error("huge.ts exceeded the 1MB full-parse tier: " + content.length)
writeFileSync(path.join(root, "src", "huge.ts"), content)

try {
  const projectId = getProjectId(root)
  const stats = await indexProjectParallel(projectId, root, {
    skipPostProcessing: true,
    files: [path.join(root, "src", "huge.ts")],
  })
  console.log("X1_BIG_RESULT " + JSON.stringify({
    successFiles: stats.successFiles,
    errorFiles: stats.errorFiles,
    timeoutFiles: stats.timeoutFiles,
    errors: stats.errors,
    mode: stats.phases?.mode,
  }))
  BrainDatabase.close(projectId)
} catch (e: any) {
  console.log("X1_BIG_ERROR " + (e?.message || String(e)))
} finally {
  rmSync(root, { recursive: true, force: true })
}
