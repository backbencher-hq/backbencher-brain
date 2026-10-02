// test/indexing-lifecycle/index-lock.ts — P1: the single-flight index lock.
//
// The lock (src/ast/index-lock.ts) is what keeps two runs from interleaving
// writes to one project DB, and a lock that cannot be recovered is a hard
// support burden: the user cannot index their project at all and the message
// they get is the only thing telling them why.
//
// This file covers the three properties that matter, from the outside:
//
//   1. a second CONCURRENT index run is REFUSED, with a message that names the
//      holder and says what to do (library level AND through the shipped CLI),
//   2. a lock whose HOLDER DIED is recoverable — SIGKILLed holder, and a
//      lockfile naming an already-exited pid,
//   3. a lock the product cannot interpret is RECOVERABLE TOO, or at least
//      escapable. A half-written / corrupt lockfile is the one shape the
//      pid-liveness probe cannot judge, and a user who hits it needs a way out.
//      (Property 3 is the suspected launch blocker; see the report.)
//
// Plus two regressions worth pinning: same-process callers SERIALIZE instead of
// refusing, and a refusal does not strand the in-process queue.
//
// Run:  npx tsx test/indexing-lifecycle/index-lock.ts
// Env:   BB_TEST_INSERT_SYMBOL_REPAIR=1  diagnostic mode (see harness.ts)

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, utimesSync } from "node:fs"
import path from "node:path"
import {
  createSuite, isolateDataDir, installInsertSymbolRepair, printModeBanner,
  makeTsFixture, rmFixture, projectIdFor, spawnRaw, killTree, spawnCli, REPO_ROOT,
} from "./harness"

/**
 * Backdate a planted lockfile so it looks older than the product's
 * unreadable-lock grace window (BB_INDEX_LOCK_GRACE_MS, default 10s).
 *
 * Reclaim of an uninterpretable lock is deliberately delayed: a creator caught
 * between "file exists" and "payload written" must not be mistaken for a
 * crashed run. A brand-new corrupt lock therefore refuses CORRECTLY, and a test
 * that plants one and immediately probes for reclaim is measuring the grace
 * window, not whether the project stays wedged.
 */
function ageLockfilePastGrace(p: string): void {
  const graceMs = Number(process.env.BB_INDEX_LOCK_GRACE_MS) >= 0
    ? Number(process.env.BB_INDEX_LOCK_GRACE_MS)
    : 10_000
  const past = new Date(Date.now() - (graceMs + 5_000))
  try { utimesSync(p, past, past) } catch { /* best effort */ }
}

const suite = createSuite("index-lock")
isolateDataDir("lock")
await installInsertSymbolRepair()
printModeBanner(suite)

const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
const { acquireIndexLock, IndexLockHeldError, indexLockPath: lockPathOf, liveIndexLockHolder } =
  await import("../../src/ast/index-lock")

const N = 6

/** A child process that takes the project's index lock and holds it. */
function holderChild(pid: string): string {
  return `
const { acquireIndexLock } = await import(${JSON.stringify(path.join(REPO_ROOT, "src/ast/index-lock.ts"))})
const lock = await acquireIndexLock(process.argv[2] ?? ${JSON.stringify(pid)}, { kind: "hold" })
console.log("LOCKED " + lock.pid)
process.on("SIGTERM", () => process.exit(0))
setInterval(() => {}, 60000)
`
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("1. a concurrent run is refused, naming the holder")
// ─────────────────────────────────────────────────────────────────────────────
const fx = makeTsFixture("lock", N)
const pid = await projectIdFor(fx.root)
{
  // Control: a normal run takes the lock and gives it back.
  const control = await indexProjectParallel(pid, fx.root, { skipPostProcessing: true })
  suite.check("a control run completes", control.summary?.newlyParsed === N + 1, JSON.stringify(control.summary))
  suite.check("a control run leaves no lockfile behind", !existsSync(lockPathOf(pid)), lockPathOf(pid))

  const holder = await spawnRaw(holderChild(pid), { marker: "LOCKED" })
  const holderPid = Number(/LOCKED (\d+)/.exec(holder.output())?.[1] ?? -1)
  suite.check("a child process could take the lock", holderPid > 0, holder.output().slice(-200))

  // 1a. library level
  let refused: any = null
  try { await acquireIndexLock(pid, { kind: "probe" }) } catch (e) { refused = e }
  suite.check(
    "a second acquisition from another process is REFUSED",
    refused instanceof IndexLockHeldError,
    String(refused?.message ?? "acquire succeeded").slice(0, 200),
  )
  suite.check(
    "the refusal names the holder's pid",
    refused instanceof IndexLockHeldError && refused.holder?.pid === holderPid,
    `refusal pid=${refused?.holder?.pid} holder=${holderPid}`,
  )
  suite.check(
    "the refusal tells the user what to do",
    /wait for it to finish/.test(String(refused?.message ?? "")) && /reclaimed automatically/.test(String(refused?.message ?? "")),
    String(refused?.message ?? "").slice(0, 220),
  )

  // 1b. through the shipped CLI
  const cli = await spawnCli(["index", fx.root, "--no-setup"], { cwd: fx.root })
  suite.check("`bb index` refuses while another process holds the lock", cli.code !== 0, `exit=${cli.code}`)
  const cliMsg = `${cli.stdout}\n${cli.stderr}`
  suite.check(
    "the CLI refusal says a run is already active AND names the holder pid",
    /already active/.test(cliMsg) && cliMsg.includes(String(holderPid)),
    cliMsg.split("\n").filter((l) => l.includes("✗") || l.includes("active")).join(" | ").slice(0, 260),
  )

  // 1c. a refused run must not have touched the index.
  const { snapshotIndex } = await import("./harness")
  const snap = await snapshotIndex(pid, fx.root)
  suite.check("the refused run stored nothing (the index is untouched)", snap.files.length === N + 1 && snap.symbols.length > 0, `files=${snap.files.length} symbols=${snap.symbols.length}`)

  // ── 2. the holder dies → the lock is recoverable ──
  await killTree(holder.child, "SIGKILL", holderPid)

  const reclaimed = await acquireIndexLock(pid, { kind: "after-kill" })
  suite.check("after the holder is SIGKILLed the lock is reclaimed automatically", reclaimed.pid === process.pid, `pid=${reclaimed.pid}`)
  suite.check("the reclaimed lockfile names the new holder", readFileSync(lockPathOf(pid), "utf8").includes(`"pid":${process.pid}`))
  await reclaimed.release()
  suite.check("the reclaimed lock is released cleanly", !existsSync(lockPathOf(pid)))

  const afterKill = await indexProjectParallel(pid, fx.root, { isIncremental: true, skipPostProcessing: true })
  suite.check("indexing works again after the holder was killed", afterKill.summary?.newlyParsed === 0, JSON.stringify(afterKill.summary))
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("2. a lockfile naming an already-dead pid is reclaimed")
// ─────────────────────────────────────────────────────────────────────────────
{
  // Obtain a pid we own and then reap it, so it cannot be recycled into a live
  // process between the kill and the probe (same technique as the m43.P1 gate).
  const probe = await spawnRaw(`console.log("PID " + process.pid)\nsetInterval(() => {}, 60000)`, { marker: "PID " })
  const deadPid = Number(/PID (\d+)/.exec(probe.output())?.[1] ?? 2_147_483_647)
  await killTree(probe.child, "SIGKILL", deadPid)

  const planted = lockPathOf(pid)
  mkdirSync(path.dirname(planted), { recursive: true })
  writeFileSync(planted, JSON.stringify({ pid: deadPid, startedAt: Date.now() - 60_000, kind: "crashed" }))
  suite.check("a lockfile naming the dead pid is planted", existsSync(planted), planted)

  const took = await acquireIndexLock(pid, { kind: "stale-probe" })
  suite.check("a lockfile naming a dead pid is reclaimed", took.pid === process.pid, `pid=${took.pid}`)
  await took.release()
  suite.check("the reclaimed lockfile is removed on release", !existsSync(planted))
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("3. a lockfile the product cannot interpret")
// ─────────────────────────────────────────────────────────────────────────────
{
  const planted = lockPathOf(pid)
  const shapes: Array<{ label: string; body: string }> = [
    { label: "empty file (0 bytes)", body: "" },
    { label: "truncated JSON", body: '{"pid":123,"startedA' },
    { label: "valid JSON, no pid field", body: JSON.stringify({ startedAt: Date.now(), kind: "index" }) },
    { label: "valid JSON, pid is not a number", body: JSON.stringify({ pid: "abc", startedAt: Date.now(), kind: "index" }) },
    { label: "valid JSON, pid is 0", body: JSON.stringify({ pid: 0, startedAt: Date.now(), kind: "index" }) },
  ]
  const wedged: string[] = []

  for (const s of shapes) {
    mkdirSync(path.dirname(planted), { recursive: true })
    writeFileSync(planted, s.body)

    let err: any = null
    let took: any = null
    const t0 = Date.now()
    // Age the planted lockfile past the product's grace window BEFORE probing.
    //
    // This test originally waited only 500ms and concluded the lock "wedges the
    // project permanently". That was wrong, and the product was right. An
    // uninterpretable lockfile IS reclaimed — after
    // `unreadableGraceMs()` (default 10_000ms), which exists so a creator caught
    // between "file exists" and "payload written" is never mistaken for a
    // crashed run. Verified by measurement: an empty lock aged past the window
    // is reclaimed, and BB_INDEX_LOCK_GRACE_MS=0 reclaims it immediately.
    //
    // The original assertion therefore tested "is the grace window shorter than
    // 500ms" rather than "does the project stay wedged", and failed against a
    // correct implementation. Ageing the file keeps the real claim under test.
    ageLockfilePastGrace(planted)
    const graceMs = Number(process.env.BB_INDEX_LOCK_GRACE_MS) >= 0
      ? Number(process.env.BB_INDEX_LOCK_GRACE_MS)
      : 10_000
    const waitBudget = graceMs + 2_000
    try { took = await acquireIndexLock(pid, { kind: "probe", waitMs: waitBudget, pollIntervalMs: 100 }) } catch (e) { err = e }
    const waited = Date.now() - t0

    if (took) {
      suite.check(`lockfile shaped as ${s.label}: it is reclaimable`, took.pid === process.pid, `pid=${took.pid}`)
      await took.release()
      suite.check(`lockfile shaped as ${s.label}: a successful reclaim leaves no lockfile`, !existsSync(planted), planted)
    } else {
      // Only a genuine wedge reaches here: the lock survived well past its
      // grace window, so nothing will ever reclaim it without a human.
      wedged.push(s.label)
      suite.check(
        `lockfile shaped as ${s.label}: it is reclaimable or escapable`,
        false,
        `refused after ${waited}ms (grace ${graceMs}ms) with no escape: ${String(err?.message ?? err).slice(0, 150)}`,
      )
      suite.check(
        `lockfile shaped as ${s.label}: the refusal does NOT promise an automatic reclaim it cannot perform`,
        !/reclaimed automatically/.test(String(err?.message ?? "")),
        String(err?.message ?? "").slice(0, 200),
      )
      rmSync(planted, { force: true })
    }
  }

  suite.check(
    "NO lockfile shape wedges the project permanently",
    wedged.length === 0,
    `wedged shapes: ${wedged.join(" | ")}`,
  )

  // User-visible consequence: with an uninterpretable lockfile in place, can the
  // shipped CLI still index the project?
  //
  // Age the lock past the grace window first, exactly as above. A BRAND-NEW
  // truncated lockfile is refused correctly — the grace window exists so a
  // creator caught between "file exists" and "payload written" is not mistaken
  // for a crashed run — so probing one immediately tested the window's length
  // rather than whether the project stays wedged.
  writeFileSync(planted, "{truncated")
  ageLockfilePastGrace(planted)
  const blocked = await spawnCli(["index", fx.root, "--no-setup"], { cwd: fx.root })
  suite.check(
    "`bb index` is NOT permanently blocked by an uninterpretable lockfile",
    blocked.code === 0,
    `exit=${blocked.code}: ${`${blocked.stdout}\n${blocked.stderr}`.split("\n").filter((l) => l.includes("✗")).join(" | ").slice(0, 200)}`,
  )
  rmSync(planted, { force: true })

  // liveIndexLockHolder must not report a lock for a file it cannot read —
  // destructive callers (project removal) rely on that to be conservative.
  mkdirSync(path.dirname(planted), { recursive: true })
  writeFileSync(planted, "{not json")
  suite.check(
    "liveIndexLockHolder() returns null for an uninterpretable lockfile",
    liveIndexLockHolder(pid) === null,
    JSON.stringify(liveIndexLockHolder(pid)),
  )
  rmSync(planted, { force: true })
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("4. same-process callers SERIALIZE, and a refusal does not strand them")
// ─────────────────────────────────────────────────────────────────────────────
{
  const results = await Promise.all([
    indexProjectParallel(pid, fx.root, { skipPostProcessing: true }),
    indexProjectParallel(pid, fx.root, { skipPostProcessing: true }),
    indexProjectParallel(pid, fx.root, { skipPostProcessing: true }),
  ])
  suite.check(
    "three concurrent in-process runs all complete (serialized, never refused)",
    results.length === 3 && results.every((r) => typeof r.summary?.newlyParsed === "number"),
    JSON.stringify(results.map((r) => r.summary?.newlyParsed)),
  )
  suite.check(
    "no concurrent run reported a lock error",
    results.every((r) => r.errorFiles === 0),
    JSON.stringify(results.map((r) => r.errorFiles)),
  )
  suite.negative(
    "no lockfile survives the last of three concurrent runs",
    !existsSync(lockPathOf(pid)),
    lockPathOf(pid),
  )

  // A REFUSED acquisition (from a foreign live holder) must still drain the
  // in-process queue, or every later same-process caller would wait forever.
  const holder = await spawnRaw(holderChild(pid), { marker: "LOCKED" })
  let refusedTwice = 0
  let succeeded: any = null
  for (let i = 0; i < 2; i++) {
    try { const h = await acquireIndexLock(pid, { kind: "probe" }); refusedTwice++; await h.release() } catch { /* refused */ }
  }
  // The holder is killed; the next acquire must not hang behind a stranded queue.
  const holder2Pid = Number(/LOCKED (\d+)/.exec(holder.output())?.[1] ?? -1)
  await killTree(holder.child, "SIGKILL", holder2Pid > 0 ? holder2Pid : undefined)
  try { succeeded = await acquireIndexLock(pid, { kind: "after-refusal" }) } catch { /* refused */ }
  suite.check(
    "a refused acquire leaves the queue usable (the next acquire completes)",
    succeeded !== null,
    `refusedTwice=${refusedTwice} acquireAfterRefusal=${succeeded ? "ok" : "failed"}`,
  )
  if (succeeded) await succeeded.release()
}

rmFixture(fx.root)
suite.finish()