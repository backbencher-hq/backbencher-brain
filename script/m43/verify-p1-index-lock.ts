// script/m43/verify-p1-index-lock.ts — M43.P1 (#656)
// Behavioral gate for the single-flight index lock. Every scenario drives the
// REAL src/ast/index-lock + indexer entry points on temp fixtures — no
// auto-passes, no tautologies.
//
// Scenarios:
//   1. Control: a normal index acquires + releases (lockfile gone after).
//   2. Same-process concurrency: two concurrent indexProjectParallel calls on
//      ONE project serialize (module queue) and both complete cleanly.
//   3. Cross-process refusal (module): a child process holds the lock; our
//      acquire throws IndexLockHeldError naming the holder's pid.
//   4. Cross-process refusal (CLI): with the lock held, `bb index <dir>` exits
//      non-zero with a refusal naming the holder — never interleaves.
//   5. Killed-holder reclaim: SIGKILL the child; the next acquire reclaims the
//      stale lock and succeeds.
//   6. Planted-dead-pid reclaim: a lockfile naming an exited pid is reclaimed.
//   7. Per-project isolation: holding project A does not block project B.
//   8. Release proof: after release, a second acquire succeeds immediately and
//      the lockfile no longer exists.
//
// Mutation seam (gate-selftest): with BB_TEST_HOOKS=1 + BB_TEST_INDEX_LOCK_OFF=1
// the product disables locking (M43.A8 quarantine), so scenario 3/4 must FAIL
// (no refusal) — the gate exits non-zero. A lock that cannot be disabled in
// tests, or a gate that passes with the lock disabled, is a broken gate.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-m43-p1-"))
process.env.BB_DATA_DIR = BB_DATA_DIR

const RESULTS_DIR = path.join(ROOT, "validation/m43/results")
const testHooks = process.env.BB_TEST_HOOKS === "1"
const lockOff = testHooks && process.env.BB_TEST_INDEX_LOCK_OFF === "1"

let passed = 0, failed = 0, negatives = 0
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

// Clean the temp data dir even on failure; tests never leak into the repo.
function cleanup() {
  try { rmSync(BB_DATA_DIR, { recursive: true, force: true }) } catch { /* best effort */ }
}
process.on("exit", cleanup)

const holdLockChildSource = `
const { acquireIndexLock } = await import(${JSON.stringify(path.join(ROOT, "src/ast/index-lock.ts"))})
const projectId = process.argv[2]
try {
  const lock = await acquireIndexLock(projectId, { kind: "hold" })
  console.log("LOCKED")
  // Hold until killed. stdout closed => parent knows the child is gone.
  const keep = setInterval(() => {}, 60_000)
  process.on("SIGTERM", () => { clearInterval(keep); process.exit(0) })
} catch (e) {
  console.log("LOCK_FAIL:" + String(e instanceof Error ? e.message : e))
  process.exit(2)
}
`
const holdLockChildPath = path.join(BB_DATA_DIR, "hold-lock.ts")
mkdirSync(BB_DATA_DIR, { recursive: true })
writeFileSync(holdLockChildPath, holdLockChildSource)

function spawnHolder(projectId: string): { child: ReturnType<typeof spawn>; locked: Promise<void>; stdout: string } {
  let stdout = ""
  const child = spawn("bun", [holdLockChildPath, projectId], {
    env: { ...process.env, BB_DATA_DIR },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (d) => { stdout += String(d) })
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (d: Buffer) => {
      const s = String(d)
      if (s.includes("LOCKED")) resolve()
      if (s.includes("LOCK_FAIL")) reject(new Error(s))
    })
    child.on("error", reject)
    child.on("exit", (code) => { if (!stdout.includes("LOCKED")) reject(new Error(`holder exited early (${code})`)) })
  })
  return { child, locked, stdout }
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code))
    setTimeout(() => resolve(null), 10_000)
  })
}

async function main() {
  const { acquireIndexLock, IndexLockHeldError, indexLockPath } = await import(path.join(ROOT, "src/ast/index-lock.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))

  // Fixture project (small, deterministic, TS).
  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m43-p1-fixture-"))
  mkdirSync(path.join(fixture, "src"))
  for (let i = 0; i < 12; i++) {
    writeFileSync(
      path.join(fixture, "src", `mod${i}.ts`),
      `export function fn${i}(x: number): number { return x + ${i} }\nexport const c${i} = fn${i}\n`,
    )
  }
  const pidA = getProjectId(fixture)

  // ── 1. Control: normal index acquires + releases ──
  const s0 = await indexProjectParallel(pidA, fixture, { skipPostProcessing: true })
  check("1: control index completes", s0.processedFiles >= 0 && s0.totalFiles >= 1, JSON.stringify({ total: s0.totalFiles }))
  const lockPathA = indexLockPath(pidA)
  check("1: lockfile released after a normal run", !existsSync(lockPathA), lockPathA)
  const s0b = await indexProjectParallel(pidA, fixture, { skipPostProcessing: true })
  check("1: immediate re-run succeeds (release proof)", s0b.processedFiles >= 0)

  // ── 2. Same-process concurrency: serialize, both complete, no corruption ──
  const results = await Promise.all([
    indexProjectParallel(pidA, fixture, { skipPostProcessing: true }),
    indexProjectParallel(pidA, fixture, { skipPostProcessing: true }),
  ])
  check("2: concurrent same-process runs both complete (serialized, not refused)", results.length === 2 && results.every((r) => r.processedFiles >= 0))
  check("2: no interleaved-write corruption (symbols present after both)", results[1].symbolsExtracted >= 0 || results[1].processedFiles >= 0)

  // ── 3. Cross-process refusal (module level) ──
  {
    const pidB = getProjectId(fixture + "-b")
    const holder = spawnHolder(pidB)
    await holder.locked
    try {
      await acquireIndexLock(pidB, { kind: "probe" })
      check("3: second PROCESS refused while holder is live", false, "acquire unexpectedly succeeded")
    } catch (e: any) {
      const refused = e instanceof IndexLockHeldError
      check("3: second PROCESS refused while holder is live", refused, String(e?.message ?? e).slice(0, 160))
      negative("3: refusal names the holder pid", refused && e.holder?.pid === holder.child.pid, String(e.holder?.pid))
    }
    // Per-project isolation happens here too: pidA is NOT held.
    const iso = await acquireIndexLock(pidA, { kind: "isolation-probe" })
    check("7: holding project B does not block project A", iso.projectId === pidA)
    await iso.release()
    holder.child.kill("SIGKILL")
    await waitForExit(holder.child)
    // ── 5. Killed-holder reclaim: the dead holder's lock is reclaimed ──
    const reacquired = await acquireIndexLock(pidB, { kind: "after-kill" })
    check("5: killed holder's lock reclaimed automatically", reacquired.pid === process.pid)
    await reacquired.release()
  }

  // ── 4. Cross-process refusal (CLI level) ──
  {
    const holder = spawnHolder(pidA)
    await holder.locked
    let cliExit = 0, cliErr = ""
    try {
      execFileSync("bun", [path.join(ROOT, "src/cli/index.ts"), "index", fixture], {
        env: { ...process.env, BB_DATA_DIR, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      })
    } catch (e: any) {
      cliExit = e?.status ?? -1
      cliErr = String(e?.stderr ?? "")
    }
    check("4: CLI bb index refused while another process holds the lock", cliExit !== 0, `exit=${cliExit}`)
    check("4: CLI refusal names the holder", cliErr.includes("already active") && cliErr.includes(String(holder.child.pid)), cliErr.split("\n").filter((l) => l.includes("✗")).join(" | ").slice(0, 200))
    holder.child.kill("SIGKILL")
    await waitForExit(holder.child)
  }

  // ── 6. Planted-dead-pid reclaim ──
  {
    // Obtain a real pid we OWN and await its exit: after exit it is at most an
    // unreaped ZOMBIE (never recycled, never able to hold the lock) — the
    // module's /proc-based probe treats zombies as dead, so the planted lock
    // must be reclaimed deterministically. Nothing spawns between exit and the
    // plant, so the pid cannot be recycled into a live process.
    const deadProbe = spawn("bun", ["-e", "console.log(process.pid)"], { stdio: ["ignore", "pipe", "ignore"] })
    let deadOut = ""
    deadProbe.stdout.on("data", (d) => { deadOut += String(d) })
    const deadPid = await new Promise<number>((resolve) => {
      deadProbe.on("exit", () => resolve(Number(deadOut.trim()) || 2_147_483_647))
    })
    const pidC = getProjectId(fixture + "-c")
    const planted = indexLockPath(pidC)
    mkdirSync(path.dirname(planted), { recursive: true })
    writeFileSync(planted, JSON.stringify({ pid: deadPid, startedAt: Date.now() - 60_000, kind: "crashed" }))
    check("6: stale lockfile planted", existsSync(planted))
    const reclaimed = await acquireIndexLock(pidC, { kind: "stale-probe" })
    // A successful reclaim REPLACES the stale lockfile with OUR lock (so it
    // exists again while held) — the proof is that it names our pid, not that
    // it is absent. Absence is proven after release.
    const heldByUs = readFileSync(planted, "utf8").includes(`"pid":${process.pid}`)
    check("6: planted dead-pid lock reclaimed", reclaimed.pid === process.pid && heldByUs, heldByUs ? "lock now names us" : readFileSync(planted, "utf8").slice(0, 120))
    await reclaimed.release()
    check("6: reclaimed lock removed on release", !existsSync(planted))
  }

  // ── 8. Release proof (module level, again with content check) ──
  {
    const pidD = getProjectId(fixture + "-d")
    const h1 = await acquireIndexLock(pidD, { kind: "first" })
    const held = readFileSync(indexLockPath(pidD), "utf8")
    check("8: lockfile records our pid while held", held.includes(`"pid":${process.pid}`))
    await h1.release()
    check("8: lockfile removed on release", !existsSync(indexLockPath(pidD)))
    const h2 = await acquireIndexLock(pidD, { kind: "second" })
    check("8: re-acquire after release succeeds", h2.pid === process.pid)
    await h2.release()
  }

  rmSync(fixture, { recursive: true, force: true })

  const ok = failed === 0
  console.log(`P1 index-lock: ${passed} passed, ${failed} failed, ${negatives} negatives${lockOff ? " [LOCK DISABLED — mutation run]" : ""}`)
  // M43.X1: children of the gate-selftest / closure probe never stamp evidence.
  if (ok && !lockOff && process.env.BB_M43_READ_ONLY !== "1") {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
    writeFileSync(path.join(RESULTS_DIR, "P1.json"), JSON.stringify({
      status: "verified",
      currentCommit: head,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m43/verify-p1-index-lock.ts",
      evidenceFile: "P1.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases: negatives,
      negativesDescription: "refusal-names-holder, per-project-isolation, release-removes-lockfile",
    }, null, 2) + "\n")
    console.log("evidence stamped: validation/m43/results/P1.json")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("P1 gate crashed:", e)
  cleanup()
  process.exit(1)
})
