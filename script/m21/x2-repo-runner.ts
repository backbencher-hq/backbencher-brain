// script/m21/x2-repo-runner.ts — M21.X2 per-repository benchmark runner.
//
// Spawned ONCE PER REPOSITORY by verify-x2-large-repo-benchmark.ts (argv:
// repo id + path) inside a hard spawnSync timeout. Running each measurement
// in its own process bounds memory (five large-repo indexes in one process
// were OOM-killed mid-run) and makes a hang/OOM fail the gate visibly
// instead of stalling it. The checkout is never modified — only the derived
// project DB is wiped (cold run) — and HEAD + dirty-file count are
// snapshotted before/after to prove the read-only policy.
//
// Prints one machine-readable line: X2_REPO_RESULT <json> or
// X2_REPO_ERROR <message>.

import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { cpus, totalmem } from "node:os"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, hasValidExtension, shouldSkipCli } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const MAX_SAMPLE = 250
const repoId = process.argv[2]
const repoPath = process.argv[3]

function sh(cmd: string, args: string[], cwd: string): { ok: boolean; stdout: string; status: number | null } {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 90_000, maxBuffer: 128 * 1024 * 1024 })
  return { ok: res.status === 0, stdout: res.stdout || "", status: res.status }
}

function trackedFiles(p: string): string[] {
  const res = sh("git", ["-C", p, "ls-files"], p)
  if (!res.ok) return []
  return res.stdout.split("\n").filter(Boolean)
}

function deterministicSample(paths: string[], cap: number): string[] {
  const sorted = [...paths].sort()
  if (sorted.length <= cap) return sorted
  const step = sorted.length / cap
  const out: string[] = []
  for (let i = 0; i < cap; i++) out.push(sorted[Math.floor(i * step)])
  return out
}

function wipe(projectId: any) {
  BrainDatabase.close(projectId)
  try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
}

try {
  if (!repoId || !repoPath || !existsSync(repoPath) || !existsSync(path.join(repoPath, ".git"))) {
    console.log("X2_REPO_ERROR " + `repo unavailable: ${repoId} @ ${repoPath}`)
    process.exit(0)
  }
  const locked = existsSync(path.join(repoPath, ".git", "index.lock"))
  const head = sh("git", ["-C", repoPath, "rev-parse", "HEAD"], repoPath)
  const revision = head.stdout.trim()
  const dirtyBefore = sh("git", ["-C", repoPath, "status", "--porcelain"], repoPath).stdout.split("\n").filter(Boolean).length
  if (locked) {
    console.log("X2_REPO_RESULT " + JSON.stringify({ id: repoId, state: "locked", reason: ".git/index.lock present", revision, dirtyBefore, dirtyAfter: dirtyBefore }))
    process.exit(0)
  }

  const cpuInfo = cpus()
  const machine = { cpuModel: cpuInfo[0]?.model ?? "unknown", cpuCores: cpuInfo.length, totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10 }

  const t0 = Date.now()
  const tracked = trackedFiles(repoPath)
  const candidates = tracked.map((f) => path.join(repoPath, f)).filter((f) => hasValidExtension(f) && !shouldSkipCli(f))
  const sample = deterministicSample(candidates, MAX_SAMPLE)
  const projectId = getProjectId(repoPath)
  wipe(projectId)
  const cold = await indexProjectParallel(projectId, repoPath, { files: sample })
  const durationMs = Date.now() - t0
  const noop = await indexProjectParallel(projectId, repoPath, { files: sample })
  const dirtyAfter = sh("git", ["-C", repoPath, "status", "--porcelain"], repoPath).stdout.split("\n").filter(Boolean).length

  const row: any = {
    id: repoId,
    state: "measured",
    revision,
    dirtyBefore,
    dirtyAfter,
    trackedFiles: tracked.length,
    candidates: candidates.length,
    sampleSize: sample.length,
    sampled: candidates.length > MAX_SAMPLE,
    selection: `deterministic stride-sample of ${candidates.length} indexable tracked files capped at ${MAX_SAMPLE} (sorted by path)`,
    ...machine,
    durationMs,
    cold: {
      totalFiles: cold.totalFiles,
      successFiles: cold.successFiles,
      errorFiles: cold.errorFiles,
      timeoutFiles: cold.timeoutFiles,
      symbols: cold.symbolsExtracted,
      relationships: cold.relationshipsFound,
      completionMs: cold.endTime ? cold.endTime - cold.startTime : null,
      totalWallMs: cold.phases?.totalWallMs,
      discoveryMs: cold.phases?.discoveryMs,
      workerStartupMs: cold.phases?.workerStartupMs,
      parseMs: cold.phases?.parseMs,
      dbFlushMs: cold.phases?.dbFlushMs,
      postProcessingMs: cold.phases?.postProcessingMs,
      filesPerSecond: cold.totalFiles > 0 && (cold.phases?.parseMs ?? 0) > 0 ? Math.round((cold.totalFiles / cold.phases!.parseMs!) * 1000 * 10) / 10 : null,
      mode: cold.phases?.mode,
    },
    noop: { noop: noop.phases?.noop, successFiles: noop.successFiles, parsedFiles: noop.phases?.parsedFiles, parseMs: noop.phases?.parseMs },
  }
  console.log("X2_REPO_RESULT " + JSON.stringify(row))
} catch (e: any) {
  console.log("X2_REPO_ERROR " + (e?.message || String(e)))
}
