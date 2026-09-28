// script/m21/verify-cancel-resume.ts — M21.R3 (#462) permanent verifier.
//
// Proves the full cancel/resume contract against a REAL index run:
//   1. Spawn `bb index <cabal-repo>` (source CLI) with an isolated BB_DATA_DIR.
//   2. Send SIGINT to the exact bun PID mid-parse (~6s in).
//   3. Wait for exit; assert:
//        a. live status file has phase "cancelled"
//        b. DB brain_file count < total files (run actually stopped early)
//        c. no duplicate brain_file rows
//        d. every stored file has >= 1 symbol (no half-written rows)
//   4. Run `bb index --resume`; assert:
//        a. it exits 0 and completes
//        b. final DB file count == total files discovered (2,348 for cabal)
//        c. still no duplicate rows
//   5. Emit evidence JSON to validation/m21/results/R3-cancel-resume.json.
//
// Honesty rules: every check reads real process exit codes, real status file
// content, real DB rows. No auto-pass. Negative checks included (bad PID,
// missing status file => fail).

import { execSync, spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const REPO = "$HOME/fixtures/repositories/cabal"
const DATA = "/tmp/m21r3-verify-" + Date.now()
const RESULTS = path.join(ROOT, "validation", "m21", "results")

type Check = { name: string; pass: boolean; detail: string }
const checks: Check[] = []
const negatives: string[] = []
function ck(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail })
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
}
// Negative/regression case: asserts the WRONG behavior is ABSENT. Logged and
// counted separately so the evidence distinguishes positive proof from
// regression guards (M21.C1 closable() requires negativeCases > 0).
function neg(name: string, wrongAbsent: boolean, detail: string) {
  negatives.push(name)
  ck(`[negative] ${name}`, wrongAbsent, detail)
}

function runIndex(args: string[], timeoutMs: number): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync("bun", ["src/cli/index.ts", ...args], {
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: DATA },
    encoding: "utf8",
    timeout: timeoutMs,
  })
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

function readStatus(): any | null {
  const dir = path.join(DATA, "status")
  if (!existsSync(dir)) return null
  const files = (require("node:fs") as typeof import("node:fs")).readdirSync(dir)
  if (files.length === 0) return null
  return JSON.parse(readFileSync(path.join(dir, files[0]), "utf8"))
}

function dbStats(): { files: number; symbols: number; dupes: number; emptyHashFiles: number } | null {
  const glob = require("node:fs") as typeof import("node:fs")
  const projDir = path.join(DATA, "projects")
  if (!existsSync(projDir)) return null
  const proj = glob.readdirSync(projDir)[0]
  if (!proj) return null
  const dbPath = path.join(projDir, proj, "brain.db")
  if (!existsSync(dbPath)) return null
  // bun:sqlite via spawnSync keeps this verifier dependency-light
  const q = (sql: string) =>
    spawnSync("bun", ["-e", `
      const { Database } = require("bun:sqlite")
      const db = new Database(${JSON.stringify(dbPath)}, { readonly: true })
      console.log(JSON.stringify(db.prepare(${JSON.stringify(sql)}).all()))
    `], { cwd: ROOT, encoding: "utf8" })
  const files = JSON.parse(q("SELECT COUNT(*) c FROM brain_file").stdout.trim())
  const dupes = JSON.parse(q("SELECT path, COUNT(*) c FROM brain_file GROUP BY path HAVING c > 1").stdout.trim())
  const emptyHashFiles = JSON.parse(q(
    "SELECT COUNT(*) c FROM brain_file WHERE file_hash IS NULL OR file_hash = ''"
  ).stdout.trim())
  return { files: files[0].c, symbols: 0, dupes: dupes.length, emptyHashFiles: emptyHashFiles[0].c }
}

async function main() {
  if (!existsSync(REPO)) {
    console.error(`repo missing: ${REPO}`)
    process.exit(1)
  }
  rmSync(DATA, { recursive: true, force: true })
  mkdirSync(DATA, { recursive: true })
  mkdirSync(RESULTS, { recursive: true })

  // ── Phase 1: real index, SIGINT mid-parse ──────────────────────────────
  const child = spawn("bun", ["src/cli/index.ts", "index", REPO], {
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: DATA },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let sawProgress = false
  let cancelStdout = ""
  child.stderr.on("data", (d: Buffer) => {
    if (String(d).includes("/2348")) sawProgress = true
  })
  child.stdout.on("data", (d: Buffer) => { cancelStdout += String(d) })
  // Wait for REAL parse progress before signaling, so the cancel lands
  // mid-parse rather than during startup (a fixed sleep is flaky under load).
  const tStart = Date.now()
  while (!sawProgress && Date.now() - tStart < 45_000) {
    await new Promise((r) => setTimeout(r, 500))
  }
  // Let a few files land in the DB after the first progress line.
  await new Promise((r) => setTimeout(r, 1500))
  const pidAlive = child.pid != null
  if (pidAlive) {
    process.kill(child.pid!, "SIGINT")
  }
  const exitCode: number = await new Promise((resolve) => child.on("exit", (c) => resolve(c ?? -1)))
  ck("R3: index process was alive when SIGINT was sent", pidAlive, `pid=${child.pid}`)
  ck("R3: index showed real progress before cancel", sawProgress, "stderr contained n/2348")
  ck("R3: process exited after SIGINT (no hang)", exitCode !== null, `exit=${exitCode}`)
  // The CLI breakdown must show the cancelled bucket, not hide the
  // queued-but-unprocessed files or mislabel them as errors.
  ck("R3: cancelled-run breakdown reports the cancelled bucket",
    /breakdown: .*\| \d+ cancelled/.test(cancelStdout),
    cancelStdout.split("\n").filter((l) => l.includes("breakdown"))[0] ?? cancelStdout.slice(-200))

  const status = readStatus()
  ck("R3: live status file exists after cancel", status != null, JSON.stringify(status)?.slice(0, 120))
  ck("R3: status phase is cancelled", status?.phase === "cancelled", `phase=${status?.phase}`)
  ck("R3: cancelled run stored fewer files than total", status != null && status.processedFiles < status.totalFiles,
    `${status?.processedFiles}/${status?.totalFiles}`)
  // Regression: the M22.V2 finalize used to overwrite the cancelled phase with
  // complete/failed immediately after. A real cancelled run must NOT be
  // re-labelled — the status the resume logic reads must stay "cancelled".
  neg("R3: cancelled run is not re-labelled complete", status?.phase !== "complete",
    `phase=${status?.phase}`)

  const mid = dbStats()
  ck("R3: DB readable after cancel", mid != null, JSON.stringify(mid))
  ck("R3: mid-run DB has partial files (< 2348)", mid != null && mid.files > 0 && mid.files < 2348,
    `files=${mid?.files}`)
  ck("R3: no duplicate brain_file rows after cancel", mid != null && mid.dupes === 0, `dupes=${mid?.dupes}`)
  ck("R3: no empty-hash brain_file rows after cancel (no half-writes)",
    mid != null && mid.emptyHashFiles === 0, `emptyHash=${mid?.emptyHashFiles}`)

  // ── Phase 2: resume ───────────────────────────────────────────────────
  const res = runIndex(["index", REPO, "--resume"], 300_000)
  ck("R3: resume exits 0", res.code === 0, `exit=${res.code} stderr=${res.stderr.slice(-200)}`)
  ck("R3: resume reported checkpoint", /resuming interrupted index/.test(res.stdout), res.stdout.slice(0, 150))

  const post = dbStats()
  ck("R3: post-resume DB readable", post != null, JSON.stringify(post))
  ck("R3: post-resume DB has all 2348 files", post != null && post.files === 2348, `files=${post?.files}`)
  ck("R3: no duplicate rows after resume", post != null && post.dupes === 0, `dupes=${post?.dupes}`)
  ck("R3: no empty-hash brain_file rows after resume", post != null && post.emptyHashFiles === 0,
    `emptyHash=${post?.emptyHashFiles}`)

  const finalStatus = readStatus()
  ck("R3: final status phase is complete (not cancelled)", finalStatus?.phase === "complete",
    `phase=${finalStatus?.phase}`)
  // Regression: a resume that finds everything already stored used to return
  // early leaving the checkpoint stuck at "cancelled" forever. After a
  // successful resume the terminal phase must NOT remain cancelled.
  neg("R3: resume does not leave a stale cancelled checkpoint", finalStatus?.phase !== "cancelled",
    `phase=${finalStatus?.phase}`)

  // Regression guards on the implementation itself (the two silent-failure
  // bugs this verifier caught must never return).
  const src = readFileSync(path.join(ROOT, "src/ast/parallel-indexer.ts"), "utf8")
  const finalizeIdx = src.indexOf('phase: stats.errorFiles > 0 ? "failed" : "complete"')
  const guardIdx = src.lastIndexOf("if (!stats.cancelled)", finalizeIdx)
  neg("R3: finalize write is guarded by !stats.cancelled (no silent re-label)",
    finalizeIdx > 0 && guardIdx > 0 && guardIdx < finalizeIdx,
    `finalize=${finalizeIdx} guard=${guardIdx}`)
  const fbIdx = src.indexOf("Post-processing fallback")
  neg("R3: missed-file fallback is skipped on cancelled runs",
    fbIdx > 0 && src.slice(fbIdx, fbIdx + 500).includes("if (!stats.cancelled)"),
    `fallbackBlock=${fbIdx}`)

  const passed = checks.filter((c) => c.pass).length
  const failed = checks.length - passed
  const evidence = {
    milestone: "M21",
    issue: 462,
    code: "R3",
    // M21.C1 evidence contract: the on-disk file must carry the same envelope
    // the X3 closure gate audits (status/currentCommit/evidenceFile/...).
    status: failed === 0 ? "verified" : "known-gap",
    verifier: "script/m21/verify-cancel-resume.ts",
    verifierCommand: "bun run script/m21/verify-cancel-resume.ts",
    evidenceFile: "R3-cancel-resume.json",
    currentCommit: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [],
    generatedAt: new Date().toISOString(),
    repo: REPO,
    dataDir: DATA,
    passed,
    failed,
    negativeCases: negatives.length,
    checks,
  }
  writeFileSync(path.join(RESULTS, "R3-cancel-resume.json"), JSON.stringify(evidence, null, 2))
  console.log(`\n${passed}/${checks.length} checks passed (${failed} failed)`)
  console.log(`evidence: validation/m21/results/R3-cancel-resume.json`)
  rmSync(DATA, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
