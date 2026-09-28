// script/m21/verify-w1-worker-lifecycle.ts — M21.W1
// Worker lifecycle, retry, and poison-file accounting.
//
// Acceptance criteria (issue #451):
//   1. Worker startup failure is distinct from parser failure.
//   2. Every file has one final outcome and retry history.
//   3. Replacement workers cannot stall or duplicate work.
//   4. Poison files are bounded, visible, and do not terminate the parent
//      silently.
//
// Closure requirements: deterministic crash/timeout fixtures plus real-corpus
// samples, persisted evidence, and no hidden fallback.
//
// Fixtures run as CHILD processes (script/m21/w1-fixture-run.ts) because the
// fixture knobs are read from the environment at module load. Each child is
// bounded by spawnSync's hard timeout, so a stall FAILS the gate instead of
// hanging it.
//
// Honesty rules (milestone C1/C3): no `check(..., true)` tautologies, no
// `>= 0` claims that could never fail, no fabricated evidence.

import { mkdirSync, existsSync } from "node:fs"
import { writeFileSync as wfs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
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

const REAL_REPO = "$HOME/fixtures/repositories/rake"
const REAL_REPO_ELIGIBLE = existsSync(path.join(REAL_REPO, ".git"))
const FIXTURE_RUNNER = path.join(ROOT, "script/m21/w1-fixture-run.ts")

interface FixtureResult {
  ok: boolean
  data?: any
  error?: string
}

function runFixture(env: Record<string, string>, nFiles = 6): FixtureResult {
  const res = spawnSync("bun", ["run", FIXTURE_RUNNER], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000, // bounded execution: a stall fails, never hangs
    env: { ...process.env, W1_N_FILES: String(nFiles), ...env },
  })
  const stdout = res.stdout || ""
  const line = stdout.split("\n").find((l) => l.startsWith("W1_FIXTURE_RESULT "))
  const errLine = stdout.split("\n").find((l) => l.startsWith("W1_FIXTURE_ERROR "))
  if (line) {
    try {
      return { ok: true, data: JSON.parse(line.slice("W1_FIXTURE_RESULT ".length)) }
    } catch (e: any) {
      return { ok: false, error: `unparseable result line: ${e?.message}` }
    }
  }
  if (errLine) return { ok: false, error: errLine.slice("W1_FIXTURE_ERROR ".length) }
  return {
    ok: false,
    error: `no result line (exit=${res.status}, timedOut=${res.signal === "SIGTERM" || res.error?.message?.includes("timeout")}) stdout=${stdout.slice(0, 400)} stderr=${(res.stderr || "").slice(0, 300)}`,
  }
}

// The honest gate a consumer applies before trusting a run's worker
// accounting: structural validity, no counted-but-invisible failures, and one
// final outcome per file (retries must never double-count).
function evidenceAccepted(d: any): boolean {
  const p = d?.phases
  if (!p || typeof p !== "object") return false
  for (const k of ["workerStartupFailures", "poisonFiles", "retries", "workerCount"]) {
    if (typeof p[k] !== "number" || !Number.isFinite(p[k]) || p[k] < 0) return false
  }
  const errs: string[] = (d?.errors || []).map((e: any) => String(e?.error || ""))
  const poisonVisible = errs.some((e) => e.includes("Worker crashed before file_start") || e.includes("poison pill"))
  const startupVisible = errs.some((e) => e.includes("startup failure"))
  if (p.poisonFiles > 0 && !poisonVisible) return false
  if (p.workerStartupFailures > 0 && !startupVisible) return false
  const total =
    (d?.successFiles || 0) + (d?.errorFiles || 0) + (d?.timeoutFiles || 0) + (d?.skippedFiles || 0)
  if (total !== d?.totalFiles) return false
  return true
}

try {
  // ── A. Normal cold run: clean pool, no forced failures ───────────────────
  const normal = runFixture({}, 3)
  check("W1 normal fixture completes via the worker pool", normal.ok, normal.error ?? "")
  if (normal.ok) {
    const d = normal.data
    check("W1 normal run indexes every file", d.successFiles === 3 && d.errorFiles === 0 && d.timeoutFiles === 0, JSON.stringify({ success: d.successFiles, error: d.errorFiles, timeout: d.timeoutFiles }))
    check("W1 normal run uses the worker pool (no hidden fallback)", d.phases?.mode === "worker-pool", `mode=${d.phases?.mode}`)
    check("W1 normal run spawns at least one worker", (d.phases?.workerCount ?? 0) >= 1, `workers=${d.phases?.workerCount}`)
    check("W1 normal run has zero startup failures", d.phases?.workerStartupFailures === 0, `startupFailures=${d.phases?.workerStartupFailures}`)
    check("W1 normal run has zero poison pills", d.phases?.poisonFiles === 0, `poisonFiles=${d.phases?.poisonFiles}`)
    check("W1 normal run: one final outcome per file", (d.successFiles + d.errorFiles + d.timeoutFiles + d.skippedFiles) === d.totalFiles, `sum=${d.successFiles + d.errorFiles + d.timeoutFiles + d.skippedFiles} total=${d.totalFiles}`)
    check("W1 normal run evidence passes the honesty gate", evidenceAccepted(d), "gate rejected")
  }

  // ── B. Timeout fixture: per-file timeout → kill → requeue → bounded ──────
  // Every batch's first file exceeds the 800ms master timeout because the
  // worker sleeps 2.5s after file_start. currentFile is set, so this is the
  // timeout→kill→retry path (NOT the poison path). Files requeued past the
  // 3-attempt cap fail as "Max retries exceeded". Deterministic trace with 6
  // files / batchSize 10 / one worker: f1..f4 timeout, f5..f6 max-retries.
  const timeout = runFixture({ BB_FILE_TIMEOUT_MS: "800", BB_WORKER_DELAY_PARSE_MS: "2500", BB_TEST_HOOKS: "1" }, 6)
  check("W1 timeout fixture completes (no hang, bounded execution)", timeout.ok, timeout.error ?? "")
  if (timeout.ok) {
    const d = timeout.data
    check("W1 timeout fixture: all files fail bounded, none succeed", d.successFiles === 0 && d.errorFiles + d.timeoutFiles === 6, JSON.stringify({ success: d.successFiles, error: d.errorFiles, timeout: d.timeoutFiles }))
    check("W1 timeout fixture: timeouts actually occurred", d.timeoutFiles >= 1, `timeoutFiles=${d.timeoutFiles}`)
    check("W1 timeout fixture: retry history observed", (d.phases?.retries ?? 0) > 0, `retries=${d.phases?.retries}`)
    check("W1 timeout fixture: zero poison pills (distinct path)", d.phases?.poisonFiles === 0, `poisonFiles=${d.phases?.poisonFiles}`)
    check("W1 timeout fixture: one final outcome per file (no duplicates from retries)", (d.successFiles + d.errorFiles + d.timeoutFiles) === d.totalFiles, `sum=${d.successFiles + d.errorFiles + d.timeoutFiles} total=${d.totalFiles}`)
    check("W1 timeout fixture: Timeout errors are visible in outcomes", (d.errors || []).some((e: any) => e.error === "Timeout"), "no Timeout error entry")
    check("W1 timeout fixture evidence passes the honesty gate", evidenceAccepted(d), "gate rejected")
  }

  // ── C. Poison fixture: worker dies before file_start ─────────────────────
  // BB_WORKER_CRASH_ON_BATCH=1 makes every worker exit(1) on parse_batch
  // before reporting file_start → poison-pill path. The parent must survive
  // (not terminate silently), count the pills, bound the retries, and finish.
  const poison = runFixture({ BB_WORKER_CRASH_ON_BATCH: "1", BB_TEST_HOOKS: "1" }, 6)
  check("W1 poison fixture completes (parent survived, no silent termination)", poison.ok, poison.error ?? "")
  if (poison.ok) {
    const d = poison.data
    check("W1 poison fixture: all files fail (nothing parsed)", d.successFiles === 0 && d.errorFiles === 6, JSON.stringify({ success: d.successFiles, error: d.errorFiles }))
    check("W1 poison fixture: poison pills counted", (d.phases?.poisonFiles ?? 0) >= 1, `poisonFiles=${d.phases?.poisonFiles}`)
    check("W1 poison fixture: poison outcome is visible", (d.errors || []).some((e: any) => String(e.error).includes("Worker crashed before file_start")), "poison error not visible")
    check("W1 poison fixture: retries bounded by the cap", (d.errors || []).some((e: any) => String(e.error).includes("Max retries exceeded (poison pill)")), "no max-retries outcome")
    check("W1 poison fixture: one final outcome per file", (d.successFiles + d.errorFiles + d.timeoutFiles) === d.totalFiles, `sum=${d.successFiles + d.errorFiles + d.timeoutFiles} total=${d.totalFiles}`)
    check("W1 poison fixture evidence passes the honesty gate", evidenceAccepted(d), "gate rejected")
  }

  // ── D. Startup fixture: worker never becomes ready ───────────────────────
  // BB_WORKER_DELAY_READY_MS=5000 delays `ready` past the 700ms startup
  // watchdog → startup failure, distinct from parser failure. The restart cap
  // bounds replacement attempts, then the queue fails visibly instead of
  // hanging. (The fork probe itself also delays ~5s, then succeeds.)
  const startup = runFixture({ BB_WORKER_DELAY_READY_MS: "5000", BB_WORKER_STARTUP_TIMEOUT_MS: "700", BB_TEST_HOOKS: "1" }, 6)
  check("W1 startup fixture completes (no infinite restart loop)", startup.ok, startup.error ?? "")
  if (startup.ok) {
    const d = startup.data
    check("W1 startup fixture: startup failures counted (distinct from parser failures)", (d.phases?.workerStartupFailures ?? 0) >= 1, `startupFailures=${d.phases?.workerStartupFailures}`)
    check("W1 startup fixture: restart attempts bounded", (d.phases?.workerStartupFailures ?? 0) <= 8, `startupFailures=${d.phases?.workerStartupFailures}`)
    check("W1 startup fixture: all files fail visibly as startup failures", d.errorFiles === 6, `errorFiles=${d.errorFiles}`)
    check("W1 startup fixture: startup-failure outcome visible and distinct", (d.errors || []).every((e: any) => String(e.error).includes("startup failure")) && (d.errors || []).length === 6, "startup outcome not distinct/visible")
    check("W1 startup fixture evidence passes the honesty gate", evidenceAccepted(d), "gate rejected")
  }

  // ── E. Real corpus run (pinned repository, read-only checkout) ───────────
  const realOutcome: any = { eligible: REAL_REPO_ELIGIBLE }
  if (REAL_REPO_ELIGIBLE) {
    const realId = getProjectId(REAL_REPO)
    // Guarantee a COLD run: wipe the derived index DB (checkout untouched).
    BrainDatabase.close(realId as any)
    try { rmSync(path.dirname(BrainDatabase.getDbPath(realId)), { recursive: true, force: true }) } catch {}
    const realStats = await indexProjectParallel(realId, REAL_REPO, { skipPostProcessing: true })
    realOutcome.stats = realStats
    check("W1 real repo indexes successfully", realStats.endTime !== undefined && realStats.successFiles > 0, JSON.stringify({ success: realStats.successFiles, error: realStats.errorFiles, timeout: realStats.timeoutFiles }))
    check("W1 real repo uses the worker pool (no hidden fallback)", realStats.phases?.mode === "worker-pool", `mode=${realStats.phases?.mode}`)
    check("W1 real repo has zero startup failures", (realStats.phases?.workerStartupFailures ?? -1) === 0, `startupFailures=${realStats.phases?.workerStartupFailures}`)
    check("W1 real repo has zero poison pills", (realStats.phases?.poisonFiles ?? -1) === 0, `poisonFiles=${realStats.phases?.poisonFiles}`)
    check("W1 real repo: one final outcome per file", (realStats.successFiles + realStats.errorFiles + realStats.timeoutFiles + realStats.skippedFiles) === realStats.totalFiles, `sum=${realStats.successFiles + realStats.errorFiles + realStats.timeoutFiles + realStats.skippedFiles} total=${realStats.totalFiles}`)
    check("W1 real repo evidence passes the honesty gate", evidenceAccepted({ ...realStats, phases: realStats.phases, errors: realStats.errors }), "gate rejected")
  } else {
    check("W1 real repo is available for evidence", false, `${REAL_REPO} missing or not a git checkout`)
  }

  // ── F. Negative checks: the gate rejects dishonest accounting ────────────
  const base = { successFiles: 3, errorFiles: 0, timeoutFiles: 0, skippedFiles: 0, totalFiles: 3, errors: [], phases: { workerStartupFailures: 0, poisonFiles: 0, retries: 0, workerCount: 1, mode: "worker-pool" } }
  const withPatch = (patch: any) => ({ ...base, phases: { ...base.phases, ...patch } })
  negative("W1 negative startup-failure count rejected", !evidenceAccepted(withPatch({ workerStartupFailures: -1 })), "accepted negative startup failures")
  negative("W1 negative poison count rejected", !evidenceAccepted(withPatch({ poisonFiles: -1 })), "accepted negative poison count")
  negative("W1 non-finite retries rejected", !evidenceAccepted(withPatch({ retries: Infinity })), "accepted Infinity retries")
  negative("W1 counted poison without visible outcomes rejected", !evidenceAccepted({ ...base, phases: { ...base.phases, poisonFiles: 3 } }), "accepted invisible poison")
  negative("W1 counted startup failure without visible outcomes rejected", !evidenceAccepted({ ...base, phases: { ...base.phases, workerStartupFailures: 2 } }), "accepted invisible startup failure")
  negative("W1 double-counted outcomes rejected (retries must not duplicate)", !evidenceAccepted({ ...base, successFiles: 4, totalFiles: 3 }), "accepted over-counted outcomes")
  negative("W1 missing phases rejected", !evidenceAccepted({ ...base, phases: null }), "accepted missing phases")

  // ── Persist evidence ─────────────────────────────────────────────────────
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  result = {
    issue: "M21.W1", code: "W1", milestone: "M21",
    status: passed === checks && negatives >= 6 ? "verified" : "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m21/verify-w1-worker-lifecycle.ts",
    evidenceFile: "W1.json", generatedAt: new Date().toISOString(),
    corpus: {
      kind: REAL_REPO_ELIGIBLE ? "deterministic-fixtures-plus-real-repository" : "deterministic-fixtures",
      fixtureFiles: 6, realRepository: REAL_REPO_ELIGIBLE ? REAL_REPO : null,
    },
    fixtures: {
      normal: normal.ok ? { successFiles: normal.data.successFiles, workerCount: normal.data.phases?.workerCount, startupFailures: normal.data.phases?.workerStartupFailures, poisonFiles: normal.data.phases?.poisonFiles } : { error: normal.error },
      timeout: timeout.ok ? { timeoutFiles: timeout.data.timeoutFiles, errorFiles: timeout.data.errorFiles, retries: timeout.data.phases?.retries, poisonFiles: timeout.data.phases?.poisonFiles } : { error: timeout.error },
      poison: poison.ok ? { poisonFiles: poison.data.phases?.poisonFiles, errorFiles: poison.data.errorFiles } : { error: poison.error },
      startup: startup.ok ? { startupFailures: startup.data.phases?.workerStartupFailures, errorFiles: startup.data.errorFiles } : { error: startup.error },
    },
    realRepo: REAL_REPO_ELIGIBLE && realOutcome.stats ? {
      successFiles: realOutcome.stats.successFiles,
      errorFiles: realOutcome.stats.errorFiles,
      timeoutFiles: realOutcome.stats.timeoutFiles,
      totalFiles: realOutcome.stats.totalFiles,
      mode: realOutcome.stats.phases?.mode,
      workerCount: realOutcome.stats.phases?.workerCount,
      startupFailures: realOutcome.stats.phases?.workerStartupFailures,
      poisonFiles: realOutcome.stats.phases?.poisonFiles,
      retries: realOutcome.stats.phases?.retries,
    } : null,
    limitations: [
      "Fixture timings are wall-clock and depend on worker startup (WASM registry load) plus the fork probe; they prove lifecycle accounting and boundedness, not throughput.",
      "M40.A8: the fixture hooks (BB_WORKER_CRASH_ON_BATCH, BB_WORKER_DELAY_*) are quarantined behind BB_TEST_HOOKS=1; this gate sets the opt-in explicitly for each hook-using fixture so a stray env var cannot crash a production index.",
      "The timeout fixture relies on BB_FILE_TIMEOUT_MS + BB_WORKER_DELAY_PARSE_MS debug hooks (env-gated, zero default effect) to make the master-side timeout deterministic.",
      "The startup fixture relies on BB_WORKER_STARTUP_TIMEOUT_MS + BB_WORKER_DELAY_READY_MS debug hooks; the 700ms watchdog value is fixture-only, the production default is 30s.",
      "Poison accounting counts batches dropped when a worker dies before file_start; a worker that dies mid-file is accounted as a timeout, not a poison pill.",
      REAL_REPO_ELIGIBLE ? "" : `Real repository ${REAL_REPO} was not eligible for evidence; only the controlled fixtures were measured.`,
    ].filter(Boolean),
  }
} catch (error) {
  result = {
    issue: "M21.W1", code: "W1", milestone: "M21", status: "known-gap",
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
    workingTreeRelevantChanges: [], verifierCommand: "bun run script/m21/verify-w1-worker-lifecycle.ts",
    evidenceFile: "W1.json", generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    limitations: ["Verifier itself failed; no worker-lifecycle claim is made."],
  }
}

const resultsDir = path.join(ROOT, "validation/m21/results")
mkdirSync(resultsDir, { recursive: true })
wfs(path.join(resultsDir, "W1.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`W1: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
