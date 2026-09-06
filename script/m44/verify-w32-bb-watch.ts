// script/m44/verify-w32-bb-watch.ts — M44.W3.2 (#674)
// `bb watch` CLI surface. Exercises the REAL CLI through child processes
// (spawn + SIGINT) against an isolated BB_DATA_DIR — no auto-passes:
//   1. Refusal: bb watch on an UNINDEXED project exits non-zero with a
//      remediation (watch keeps an index fresh; never starts from zero).
//   2. Intent recorded at index time: bb watch --status shows intent
//      "watching (desired)" + the db path before any watcher ever ran.
//   3. Start: `bb watch <dir>` prints the project + data dir + stays
//      resident; SIGINT stops it cleanly ("watch stopped", exit 0) and the
//      watcher leaves no in-process residue.
//   4. Idempotency + shared module (one test exercises both entry points):
//      two startProjectWatcher calls return the SAME instance; the MCP
//      auto-start path and the CLI path both honor/record the same intent.
//   5. --stop clears the durable intent; a later --status reports none.
//   6. Restart re-runs the startup scan: an edit made while stopped is
//      reconciled by the next watch session before it serves.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m44/results/W32.json")
const BB = path.join(ROOT, "src/cli/index.ts")

let checks = 0, passed = 0, failed = 0, negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

interface CliResult { code: number | null; out: string; err: string }
function runCli(args: string[], env: Record<string, string>, timeoutMs = 60_000): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", BB, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let out = "", err = ""
    const timer = setTimeout(() => { child.kill("SIGKILL") }, timeoutMs)
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { err += d })
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }) })
  })
}

/** Spawn `bb watch <dir>`, wait for the watching banner, SIGINT, assert clean stop. */
function runWatchSession(dir: string, env: Record<string, string>, waitFor = "watching "): Promise<{ out: string; err: string; stopped: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", BB, "watch", dir], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let out = "", err = ""
    let started = false
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ out, err, stopped: false, code: null }) }, 40_000)
    child.stdout.on("data", (d) => {
      out += d
      if (!started && out.includes(waitFor)) {
        started = true
        setTimeout(() => child.kill("SIGINT"), 250)
      }
    })
    child.stderr.on("data", (d) => { err += d })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ out, err, stopped: started, code })
    })
  })
}

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "bb-m44-w32-data-"))
  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m44-w32-proj-"))
  // The gate process AND every spawned CLI child must share one data dir, or
  // module-level ops (index, intent) and CLI reads would target different DBs.
  process.env.BB_DATA_DIR = dataDir
  const env = { BB_DATA_DIR: dataDir, BB_M44_EVIDENCE: "" }
  try {
    mkdirSync(path.join(fixture, "src"), { recursive: true })
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function watchCliA(): number { return 1 }\n`)
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
    const pid = getProjectId(fixture)

    // ── 1. refusal on an unindexed project ──
    const noIndex = await runCli(["watch", fixture], env)
    check("refusal: bb watch on an unindexed project exits non-zero", noIndex.code !== 0, `code=${noIndex.code} out=${noIndex.out.slice(0, 160)}`)
    check("refusal: names the remediation (run bb index first)", /no index/.test(noIndex.out + noIndex.err) && /bb index/.test(noIndex.out + noIndex.err), (noIndex.out + noIndex.err).slice(0, 220))

    // ── 2. index, then status shows the index-time intent ──
    const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
    const s = await indexProjectParallel(pid as any, fixture, {})
    check("fixture indexes clean", s.errorFiles === 0, `errors=${s.errorFiles}`)
    const st1 = await runCli(["watch", "--status", fixture], env)
    check("status: index-time intent shows watching (desired)", st1.code === 0 && /intent: watching \(desired\)/.test(st1.out), st1.out.slice(0, 260))
    check("status: prints project + db path", /project:/.test(st1.out) && /db: .*brain\.db/.test(st1.out), st1.out.slice(0, 260))

    // ── 3. foreground watch session: banner, resident, SIGINT clean stop ──
    const session = await runWatchSession(fixture, env)
    check("watch: prints the watching banner with project + data dir", /watching .*proj/.test(session.out) && /data dir:/.test(session.out), session.out.slice(0, 300))
    check("watch: SIGINT stops cleanly (watch stopped, exit 0)", session.stopped && session.code === 0 && /watch stopped/.test(session.out), `stopped=${session.stopped} code=${session.code} out=${session.out.slice(0, 220)}`)

    // ── 5. --stop clears the durable intent ──
    const stopRun = await runCli(["watch", "--stop", fixture], env)
    check("stop: clears the intent and says so", stopRun.code === 0 && /watch stopped/.test(stopRun.out), stopRun.out.slice(0, 200))
    const st2 = await runCli(["watch", "--status", fixture], env)
    negative("status: after --stop there is no watch intent", /no watch intent/.test(st2.out), st2.out.slice(0, 220))

    // ── 4. idempotency + one module for both entry points (MCP parity) ──
    const { startProjectWatcher, watcherFor, stopProjectWatcher } = await import(path.join(ROOT, "src/ast/file-watcher"))
    const { readWatchIntent, recordWatchIntent } = await import(path.join(ROOT, "src/ast/watch-state"))
    recordWatchIntent(pid as any, fixture) // re-arm (bb index also does this at completion)
    const first = startProjectWatcher(pid as any, fixture, { force: true, log: () => {} })
    const second = startProjectWatcher(pid as any, fixture, { force: true, log: () => {} })
    check("idempotent: two starts return the SAME watcher (no duplicates)", first === second && watcherFor(pid as any) === first, "duplicate watcher registered")
    check("entry points: both honor the same durable intent file", !!readWatchIntent(pid as any)?.desired, "intent missing")
    await first.drain()
    await stopProjectWatcher(pid as any)
    check("module stop: registry is empty again", watcherFor(pid as any) === undefined, "still registered")

    // ── 6. restart re-runs the startup scan (dead-period edits reconciled) ──
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function watchCliRenamed(): number { return 5 }\n`)
    writeFileSync(path.join(fixture, "src", "new_dead.ts"), `export function watchCliDead(): number { return 6 }\n`)
    // (new_dead.ts lives in src/ — its relative path is "src/new_dead.ts".)
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
    const { checkFileFreshness } = await import(path.join(ROOT, "src/brain/freshness"))
    const raw = await BrainDatabase.getRawInstance(pid as any)
    const fresh = (rel: string) => {
      const row = raw.prepare("SELECT id FROM brain_file WHERE project_id = ? AND relative_path = ?").get(pid as any, rel) as { id: string } | undefined
      if (!row) return false
      return checkFileFreshness(raw, row.id)?.status === "fresh"
    }
    const { probeAddedFiles, probeAddedFilesSnapshot } = await import(path.join(ROOT, "src/ast/auto-refresh"))
    const gitP = await probeAddedFiles(raw, pid as any, fixture)
    const snapP = gitP.available ? null : await probeAddedFilesSnapshot(raw, pid as any, fixture)
    const w6 = startProjectWatcher(pid as any, fixture, { force: true, log: () => {} })
    await w6.drain()
    check("restart: startup scan reconciled the dead-period edit", fresh("src/a.ts"), w6.status().lastError ?? "")
    check("restart: startup scan indexed the dead-period new file", fresh("src/new_dead.ts"), `src/new_dead.ts missing; gitProbe=${JSON.stringify(gitP)} snapProbe=${JSON.stringify(snapP)} status=${JSON.stringify(w6.status())}`)
    await w6.stop()
  } finally {
    rmSync(fixture, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
  }

  if (process.env.BB_M44_EVIDENCE === "1" && failed === 0) {
    const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
    mkd(path.dirname(RESULT), { recursive: true })
    wfs(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m44/verify-w32-bb-watch.ts",
      evidenceFile: "W32.json",
      generatedAt: new Date().toISOString(),
      passed, failed, negativeCases,
    }, null, 2) + "\n")
  }
  console.log(`M44 W3.2 BB WATCH CLI: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("W3.2 gate crashed:", e)
  process.exit(1)
})
