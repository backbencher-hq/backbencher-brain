// script/mA/probe-index-ux.ts — Milestone A ground-truth probe.
//
// Measures the REAL behavior of `indexProjectParallel` on representative
// repositories so Milestone A's issues have data-grounded acceptance criteria
// instead of assumptions:
//
//   - per-phase wall-clock timings (discovery, worker startup, parse, dbFlush,
//     finalAccounting, and each post-processing phase)
//   - worker-pool mode + actual worker count spawned
//   - progress events (files done/total, files/s) — are they emitted at all?
//   - parse/store errors + timeouts + retries + poison files
//   - WASM/grammar load failures observed during the run
//
// Repos: small (rake), mid (vue-core), larger (element-plus) from the pinned
// fixtures corpus. Output is a JSON evidence file the milestone can build on.

import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, type ParallelIndexingStats } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const ROOT = path.resolve(process.cwd())
const RESULTS = path.join(ROOT, "validation/mA/results")
const REPOS = ["rake", "vue-core", "element-plus"]
const REPO_ROOT = "$HOME/fixtures/repositories"

mkdirSync(RESULTS, { recursive: true })

interface ProgressSample {
  t: number
  filesProcessed: number
  totalFiles: number
  currentFile: string
  progress: number
  message: string
  fps: number
}

interface RepoResult {
  repo: string
  path: string
  ok: boolean
  error?: string
  stats?: ParallelIndexingStats & { phases?: any; postProcessingPhases?: any[] }
  progressSamples: number
  firstProgress?: ProgressSample
  lastProgress?: ProgressSample
  progressFrequencyMs?: number
  parseErrorsLog?: string[]
  wasmErrors: string[]
  totalFiles: number
  candidates: number
}

function collectParseErrorsLog(): string[] {
  try {
    const p = "/tmp/bb-parse-errors.log"
    if (!existsSync(p)) return []
    const text = readFileSync(p, "utf8")
    return text.split("\n").filter((l) => l.length > 0).slice(-20)
  } catch {
    return []
  }
}

function countTrackedFiles(dir: string): number {
  let n = 0
  try {
    const stack = [dir]
    while (stack.length) {
      const cur = stack.pop()!
      for (const ent of readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, ent.name)
        if (ent.isDirectory()) {
          if (ent.name === ".git" || ent.name === "node_modules") continue
          stack.push(full)
        } else if (ent.isFile()) n++
      }
    }
  } catch {}
  return n
}

async function probeOne(repo: string): Promise<RepoResult> {
  const repoPath = path.join(REPO_ROOT, repo)
  const r: RepoResult = {
    repo,
    path: repoPath,
    ok: false,
    progressSamples: 0,
    wasmErrors: [],
    totalFiles: countTrackedFiles(repoPath),
    candidates: 0,
  }
  try {
    // Snapshot the parse-error log BEFORE so we only capture this run's errors.
    const preLog = collectParseErrorsLog()
    const pid = getProjectId(repoPath)

    const samples: ProgressSample[] = []
    const wasmErrors: string[] = []
    const origErr = console.error
    console.error = (...a: any[]) => {
      const line = a.map((x) => (x instanceof Error ? x.message : String(x))).join(" ")
      if (/wasm|tree-sitter|grammar|language parser/i.test(line) && /error|fail/i.test(line)) {
        wasmErrors.push(line.slice(0, 300))
      }
      origErr(...a)
    }

    const t0 = Date.now()
    const stats = (await indexProjectParallel(pid, repoPath, {
      onProgress: (s: any) => {
        samples.push({
          t: Date.now(),
          filesProcessed: s.processedFiles ?? 0,
          totalFiles: s.totalFiles ?? 0,
          currentFile: s.currentFile ?? "",
          progress: s.progress ?? 0,
          message: s.message ?? "",
          fps: s.filesPerSecond ?? 0,
        })
      },
    })) as any

    console.error = origErr
    r.ok = true
    r.stats = stats
    r.progressSamples = samples.length
    r.firstProgress = samples[0]
    r.lastProgress = samples[samples.length - 1]
    r.progressFrequencyMs =
      samples.length > 2
        ? Math.round((samples[samples.length - 1].t - samples[0].t) / (samples.length - 1))
        : undefined
    r.wasmErrors = wasmErrors
    r.candidates = stats.totalFiles ?? 0

    const afterLog = collectParseErrorsLog()
    r.parseErrorsLog = afterLog.filter((l) => !preLog.includes(l)).slice(-10)

    return r
  } catch (e: any) {
    r.error = e?.message ?? String(e)
    return r
  }
}

async function main() {
  const results: RepoResult[] = []
  for (const repo of REPOS) {
    process.stdout.write(`[probe] ${repo} ... `)
    const r = await probeOne(repo)
    results.push(r)
    const p = r.stats?.phases
    process.stdout.write(
      r.ok
        ? `done: ${r.stats?.totalFiles} files, ${r.stats?.symbolsExtracted} symbols, mode=${p?.mode} workers=${p?.workerCount} wall=${p?.totalWallMs}ms pp=${p?.postProcessingMs}ms progressEvents=${r.progressSamples}\n`
        : `FAILED: ${r.error}\n`,
    )
  }

  const report = {
    milestone: "mA",
    purpose: "Milestone A ground-truth probe: real index behavior on 3 representative repos",
    generatedAt: new Date().toISOString(),
    machine: {
      cpus: require("node:os").cpus().length,
      model: require("node:os").cpus()[0]?.model ?? "unknown",
      totalMemGb: Math.round(require("node:os").totalmem() / 1024 ** 3),
    },
    results,
  }
  writeFileSync(path.join(RESULTS, "probe-index-ux.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(`\n[probe] written validation/mA/results/probe-index-ux.json`)
}

main().catch((e) => {
  console.error("probe failed:", e)
  process.exit(1)
})
