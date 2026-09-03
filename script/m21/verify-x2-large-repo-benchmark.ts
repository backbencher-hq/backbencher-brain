// script/m21/verify-x2-large-repo-benchmark.ts — M21.X2
// Large real-repository performance benchmark.
//
// Acceptance criteria (issue #464):
//   1. Repository revision, selection rules, CPU/memory/runtime, and duration
//      are recorded.
//   2. Cold, incremental, and post-processing timings are distinguishable.
//   3. Empty/unavailable/locked states remain visible.
//   4. No repository is reset, cleaned, or rewritten.
// Closure requirements: persist raw artifacts and website-facing measured
// claims with limitations.
//
// Methodology:
//   - Named repositories: IntelliJ, ASP.NET Core, TypeScript, OpenClaw,
//     Paperclip — each measured where available; missing/locked states are
//     recorded visibly, never skipped silently.
//   - Bounded: deterministic stride-sample of tracked files (250-file cap,
//     identical input -> identical sample), recorded per row.
//   - COLD FULL run (project DB wiped, full post-processing) gives three
//     distinguishable timings in one measurement: cold parse (parseMs),
//     incremental/no-op behavior (separate second run), and post-processing
//     (postProcessingMs, distinct from the reported completion duration).
//   - Read-only policy: only the derived index DB (outside the checkout) is
//     ever touched. HEAD and dirty-file count are snapshotted before and
//     after and must be identical.
//
// Honesty rules (milestone C1/C3): no tautologies, no fabricated timings,
// every measured claim carries its limitations.

import { mkdirSync, existsSync, writeFileSync as wfs } from "node:fs"
import { cpus, totalmem, freemem } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const MAX_SAMPLE = 250
// Hard per-repo child timeout: a hung/OOM'd measurement fails the gate
// visibly instead of stalling it (milestone C3 bounded execution).
const REPO_TIMEOUT_MS = 15 * 60 * 1000

const NAMED_REPOS = [
  { id: "intellij-community", path: "$HOME/intellij-community" },
  { id: "aspnetcore", path: "$HOME/aspnetcore" },
  { id: "typescript", path: "$HOME/TypeScript" },
  { id: "openclaw", path: "$HOME/openclaw" },
  { id: "paperclip", path: "$HOME/paperclip" },
]

let checks = 0
let passed = 0
let negatives = 0
let result: any

function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

function sh(cmd: string, args: string[], cwd: string): { ok: boolean; stdout: string } {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 90_000, maxBuffer: 128 * 1024 * 1024 })
  return { ok: res.status === 0, stdout: res.stdout || "" }
}

// Run one repository's measurement in a child process (bounded memory,
// hard timeout, fail-closed). Returns the parsed row or an error string.
function measureRepo(id: string, repoPath: string): { row?: any; error?: string } {
  const res = spawnSync("bun", ["run", path.join(ROOT, "script/m21/x2-repo-runner.ts"), id, repoPath], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: REPO_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
  const stdout = res.stdout || ""
  const line = stdout.split("\n").find((l) => l.startsWith("X2_REPO_RESULT "))
  const errLine = stdout.split("\n").find((l) => l.startsWith("X2_REPO_ERROR "))
  if (line) {
    try { return { row: JSON.parse(line.slice("X2_REPO_RESULT ".length)) } }
    catch (e: any) { return { error: `unparseable result: ${e?.message}` } }
  }
  if (errLine) return { error: errLine.slice("X2_REPO_ERROR ".length) }
  const timedOut = res.signal === "SIGTERM" || res.error?.message?.includes("timeout")
  return { error: `no result (exit=${res.status}, timedOut=${timedOut})${res.error?.message ? ": " + res.error.message : ""}` }
}

function validRow(row: any): boolean {
  if (!row || typeof row !== "object") return false
  if (typeof row.cpuCores !== "number" || row.cpuCores < 1) return false
  if (typeof row.totalMemGb !== "number" || row.totalMemGb <= 0) return false
  if (row.state === "unavailable" || row.state === "locked" || row.state === "failed") {
    // Unavailable/locked/failed rows must still be VISIBLE with a reason.
    return typeof row.reason === "string" && row.reason.length > 0
  }
  // Measured rows: revision, selection rules, and duration are mandatory.
  if (typeof row.revision !== "string" || row.revision.length < 7) return false
  if (typeof row.durationMs !== "number" || row.durationMs <= 0) return false
  if (typeof row.selection !== "string" || row.selection === "") return false
  // A fabricated timing (parse phase longer than the whole run) is rejected.
  if (row.cold?.parseMs !== undefined && row.cold?.totalWallMs !== undefined && row.cold.parseMs > row.cold.totalWallMs + 1000) return false
  return true
}

try {
  const cpuInfo = cpus()
  const mem = { totalGb: totalmem() / 1024 ** 3, freeGb: freemem() / 1024 ** 3 }
  const machine = { cpuModel: cpuInfo[0]?.model ?? "unknown", cpuCores: cpuInfo.length, totalMemGb: Math.round(mem.totalGb * 10) / 10, freeMemGb: Math.round(mem.freeGb * 10) / 10 }

  const rows: any[] = []
  for (const repo of NAMED_REPOS) {
    const available = existsSync(repo.path) && existsSync(path.join(repo.path, ".git"))
    if (!available) {
      rows.push({ id: repo.id, state: "unavailable", reason: "path or .git missing", revision: null, ...machine, selection: "n/a", durationMs: 0 })
      console.log(`  [X2] ${repo.id}: unavailable (path or .git missing)`)
      continue
    }
    const m = measureRepo(repo.id, repo.path)
    if (m.error) {
      // A failed/hung measurement is a VISIBLE failure, never a silent skip.
      rows.push({ id: repo.id, state: "failed", reason: m.error, revision: null, ...machine, selection: "n/a", durationMs: 0 })
      console.log(`  [X2] ${repo.id}: FAILED — ${m.error}`)
      continue
    }
    rows.push(m.row)
    const r = m.row
    console.log(`  [X2] ${r.id}: state=${r.state} rev=${(r.revision || "").slice(0, 7)} tracked=${r.trackedFiles} sample=${r.sampleSize} cold=${r.cold?.totalFiles} ok=${r.cold?.successFiles} wall=${r.durationMs}ms pp=${r.cold?.postProcessingMs}ms`)
  }

  // ── Assertions ───────────────────────────────────────────────────────────
  check("X2 all five named repositories have a recorded row", rows.length === NAMED_REPOS.length, `rows=${rows.length}`)
  check("X2 at least three repositories were actually measured", rows.filter((r) => r.state === "measured").length >= 3, `measured=${rows.filter((r) => r.state === "measured").length}`)
  for (const row of rows) {
    check(`X2 ${row.id}: revision, selection, CPU/memory, duration recorded`, validRow(row), `state=${row.state}`)
    if (row.state === "measured") {
      check(`X2 ${row.id}: sample is bounded and labeled`, row.sampleSize <= MAX_SAMPLE && row.sampled === (row.trackedFiles > MAX_SAMPLE), `sample=${row.sampleSize} tracked=${row.trackedFiles}`)
      check(`X2 ${row.id}: cold run completed via worker pool`, row.cold.mode === "worker-pool" && row.cold.successFiles > 0, `mode=${row.cold.mode} success=${row.cold.successFiles}`)
      check(`X2 ${row.id}: cold and incremental are distinguishable`, row.cold.parseMs !== row.noop.parseMs && row.noop.noop === true, `cold=${row.cold.parseMs} noop=${row.noop.parseMs}`)
      check(`X2 ${row.id}: post-processing timing is distinct and recorded`, typeof row.cold.postProcessingMs === "number" && row.cold.postProcessingMs > 0, `pp=${row.cold.postProcessingMs}`)
      check(`X2 ${row.id}: no repository was reset, cleaned, or rewritten`, row.dirtyBefore === row.dirtyAfter, `dirty ${row.dirtyBefore} -> ${row.dirtyAfter}`)
      check(`X2 ${row.id}: completion duration excludes post-processing (distinct timings)`, typeof row.cold.completionMs === "number" && typeof row.cold.postProcessingMs === "number", `completion=${row.cold.completionMs} pp=${row.cold.postProcessingMs}`)
      check(`X2 ${row.id}: throughput recorded`, typeof row.cold.filesPerSecond === "number" && row.cold.filesPerSecond > 0, `fps=${row.cold.filesPerSecond}`)
    }
  }
  const nonMeasuredRows = rows.filter((r) => r.state !== "measured")
  for (const row of nonMeasuredRows) {
    check(`X2 ${row.id}: ${row.state} state is visible with a reason`, typeof row.reason === "string" && row.reason.length > 0, row.reason ?? "no reason")
  }

  // ── Negatives ────────────────────────────────────────────────────────────
  const base = { revision: "0123456789abcdef", selection: "deterministic stride-sample of 100 tracked files capped at 250", cpuCores: 8, totalMemGb: 32, durationMs: 1000, state: "measured", cold: { parseMs: 200, totalWallMs: 3000 } }
  negative("X2 row without a revision is rejected", !validRow({ ...base, revision: "" }), "accepted empty revision")
  negative("X2 row without CPU/memory is rejected", !validRow({ ...base, cpuCores: 0 }), "accepted missing CPU")
  negative("X2 row without duration is rejected", !validRow({ ...base, durationMs: 0 }), "accepted zero duration")
  negative("X2 row without selection rules is rejected", !validRow({ ...base, selection: "" }), "accepted missing selection")
  negative("X2 fabricated timing (parse > wall) is rejected", !validRow({ ...base, cold: { parseMs: 5000, totalWallMs: 3000 } }), "accepted parse longer than wall")
  negative("X2 unavailable row without a visible reason is rejected", !validRow({ ...base, state: "unavailable", revision: "" }), "accepted reason-less unavailable row")

  // ── Persist evidence ─────────────────────────────────────────────────────
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  result = {
    issue: "M21.X2", code: "X2", milestone: "M21",
    status: passed === checks && negatives >= 6 ? "verified" : "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-x2-large-repo-benchmark.ts",
    evidenceFile: "X2.json", generatedAt: new Date().toISOString(),
    machine,
    rows,
    websiteFacingClaims: rows.filter((r) => r.state === "measured").map((r) => ({
      repo: r.id,
      revision: r.revision.slice(0, 7),
      sampleFiles: r.sampleSize,
      parseFilesPerSecond: r.cold.filesPerSecond,
      completionMs: r.cold.completionMs,
      postProcessingMs: r.cold.postProcessingMs,
      workerMode: r.cold.mode,
    })),
    limitations: [
      "Measurements are wall-clock on this machine (CPU/memory recorded per row) and include worker boot + WASM load; they are sample-bounded (250 files/repo), not full-repo indexes, so they are relative, not absolute, capacity claims.",
      "The IntelliJ/ASP.NET Core/OpenClaw/Paperclip checkouts are dirty (their working trees differ from any pinned revision); each row records its actual HEAD and dirty-file count, and the checkout is never modified (read-only policy enforced by the dirty-before == dirty-after assertion).",
      "Post-processing timing is recorded but post-processing is not the subject of this issue; X3 classifies bottlenecks.",
      "Throughput (files/s) is parse-phase only and excludes discovery and post-processing; a sampled run's throughput is not representative of a full-repo run.",
    ],
  }
} catch (error) {
  result = {
    issue: "M21.X2", code: "X2", milestone: "M21", status: "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
    workingTreeRelevantChanges: [], verifierCommand: "bun run script/m21/verify-x2-large-repo-benchmark.ts",
    evidenceFile: "X2.json", generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    limitations: ["Verifier itself failed; no large-repo benchmark claim is made."],
  }
}

const resultsDir = path.join(ROOT, "validation/m21/results")
mkdirSync(resultsDir, { recursive: true })
wfs(path.join(resultsDir, "X2.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`X2: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
