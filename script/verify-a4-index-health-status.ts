// script/verify-a4-index-health-status.ts
// Behavioral gate for the index-health / status / checkpoint / lock layer.
// Runs under `npx tsx` (this repo's milestone gates are written for `bun`,
// which is not installed in every environment — see the note at the end).
//
// Everything here drives the REAL src/ast/index-status.ts, src/ast/index-lock.ts
// and src/brain/brain-index-health.ts against temp fixtures. No auto-passes.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync, writeSync } from "node:fs"
import { tmpdir, hostname } from "node:os"
import { spawn } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-a4-gate-"))
process.env.BB_DATA_DIR = BB_DATA_DIR

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; writeSync(1, `FAIL: ${label}${detail ? ` — ${detail}` : ""}\n`) }
}
function say(line: string) { writeSync(1, `${line}\n`) }

function cleanup() {
  try { rmSync(BB_DATA_DIR, { recursive: true, force: true }) } catch { /* best effort */ }
}
process.on("exit", cleanup)

/** Age a file so a time-window branch is exercised without sleeping. */
function backdate(file: string, ms: number) {
  const t = (Date.now() - ms) / 1000
  utimesSync(file, t, t)
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => {
    child.on("exit", (c) => resolve(c))
    setTimeout(() => resolve(null), 10_000)
  })
}

/**
 * A REAL cross-process holder: a child that writes exactly the payload the
 * module writes (shape asserted in G1-G4) via the same atomic temp+link create,
 * then holds until killed.
 *
 * A child is required rather than a second in-process acquire because the
 * in-process queue SERIALIZES same-process callers instead of refusing them —
 * that is the documented contract the m11 lifecycle depends on, so a
 * same-process "refusal" test would simply block on the holder's release.
 */
function spawnHolder(lockPath: string): { child: ReturnType<typeof spawn>; locked: Promise<void> } {
  const src = `
    const fs = require("node:fs"), os = require("node:os"), p = require("node:path"), c = require("node:crypto");
    const lp = process.argv[1];
    fs.mkdirSync(p.dirname(lp), { recursive: true });
    const payload = JSON.stringify({ schemaVersion: 1, pid: process.pid, host: os.hostname(),
      token: c.randomUUID(), startedAt: Date.now(), kind: "hold" });
    const tmp = lp + "." + process.pid + ".child.tmp";
    fs.writeFileSync(tmp, payload); fs.linkSync(tmp, lp); fs.unlinkSync(tmp);
    process.stdout.write("LOCKED\\n");
    setInterval(() => {}, 60000);
  `
  const child = spawn(process.execPath, ["-e", src, lockPath], { stdio: ["ignore", "pipe", "inherit"] })
  let out = ""
  const locked = new Promise<void>((res, rej) => {
    child.stdout.on("data", (d) => { out += String(d); if (out.includes("LOCKED")) res() })
    child.on("error", rej)
    setTimeout(() => rej(new Error(`holder never reported LOCKED: ${out}`)), 15_000)
  })
  return { child, locked }
}

async function main() {
  const status = await import(path.join(ROOT, "src/ast/index-status.ts"))
  const lock = await import(path.join(ROOT, "src/ast/index-lock.ts"))
  const health = await import(path.join(ROOT, "src/brain/brain-index-health.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const P = "a4gate"
  const sPath = (id: string) => status.statusPath(id)

  // ── A. Checkpoint round-trip ──────────────────────────────────────────────
  {
    const pid = `${P}-roundtrip`
    status.writeLiveStatus(pid, {
      projectId: pid, phase: "indexing", processedFiles: 12, totalFiles: 40,
      startedAt: Date.now() - 1000, updatedAt: Date.now(),
    })
    const raw = JSON.parse(readFileSync(sPath(pid), "utf8"))
    check("A1: write stamps schemaVersion", raw.schemaVersion === 2, String(raw.schemaVersion))
    const back = status.readLiveStatus(pid)
    check("A2: round-trip preserves phase/counts", back?.phase === "indexing" && back?.processedFiles === 12 && back?.totalFiles === 40,
      JSON.stringify({ p: back?.phase, d: back?.processedFiles, t: back?.totalFiles }))
    check("A3: no temp file left behind after a clean write", !existsSync(`${sPath(pid)}.tmp`))
  }

  // ── B. Atomicity: a half-written TEMP file must not become the checkpoint ─
  // The hazard this replaces: writeFileSync on the target truncates first, so a
  // kill mid-write published a partial document that no parser accepts.
  {
    const pid = `${P}-atomic`
    status.writeLiveStatus(pid, {
      projectId: pid, phase: "indexing", processedFiles: 7, totalFiles: 9,
      startedAt: Date.now() - 1000, updatedAt: Date.now(),
    })
    writeFileSync(`${sPath(pid)}.tmp`, '{"projectId":"' + pid + '","phase":"inde')
    const cp = status.readIndexCheckpoint(pid)
    check("B1: a torn TEMP file is invisible to the reader", cp.integrity === "ok" && cp.status?.processedFiles === 7,
      `${cp.integrity} ${JSON.stringify(cp.status?.processedFiles)}`)
    check("B2: a torn TEMP file does not become the next checkpoint", readFileSync(sPath(pid), "utf8").includes('"phase":"indexing"'))
  }

  // ── C. Corruption is DECLARED, not hidden ─────────────────────────────────
  // Before: every unreadable file returned undefined, i.e. "no checkpoint" —
  // so a half-written file was indistinguishable from a project that had
  // never been interrupted, and --resume said so.
  {
    const pid = `${P}-corrupt`
    mkdirSync(path.dirname(sPath(pid)), { recursive: true })
    writeFileSync(sPath(pid), '{"projectId":"' + pid + '","phase":"inde') // truncated JSON
    const cp = status.readIndexCheckpoint(pid)
    check("C1: truncated JSON reports 'corrupt'", cp.integrity === "corrupt", cp.integrity)
    check("C2: the corruption is explained", (cp.problem ?? "").length > 0, cp.problem)
    check("C3: readLiveStatus still returns undefined (back-compat)", status.readLiveStatus(pid) === undefined)

    const dec = status.decideResume(pid)
    check("C4: --resume is told the file is damaged, not absent", !dec.resumable && /unreadable/.test(dec.reason), dec.reason)
    check("C5: --resume still falls back to incremental (work is unaffected)", /running incremental/.test(dec.reason), dec.reason)

    const pidE = `${P}-empty`
    mkdirSync(path.dirname(sPath(pidE)), { recursive: true })
    writeFileSync(sPath(pidE), "")
    check("C6: a 0-byte status file reports 'corrupt'", status.readIndexCheckpoint(pidE).integrity === "corrupt")
  }

  // ── D. Schema versioning ──────────────────────────────────────────────────
  {
    // v1 = written before versioning: no schemaVersion field. Must still read —
    // this is the migration path, and its fields mean the same thing.
    const pidV1 = `${P}-v1`
    mkdirSync(path.dirname(sPath(pidV1)), { recursive: true })
    writeFileSync(sPath(pidV1), JSON.stringify({
      projectId: pidV1, phase: "cancelled", processedFiles: 3, totalFiles: 10,
      startedAt: Date.now() - 5_000, updatedAt: Date.now(),
    }))
    const v1 = status.readIndexCheckpoint(pidV1)
    check("D1: a pre-versioned (v1) file still reads as ok", v1.integrity === "ok" && v1.status?.schemaVersion === 1, v1.integrity)

    // v99 = a future writer. Refused, not interpreted.
    const pidV9 = `${P}-v99`
    mkdirSync(path.dirname(sPath(pidV9)), { recursive: true })
    writeFileSync(sPath(pidV9), JSON.stringify({
      schemaVersion: 99, projectId: pidV9, phase: "indexing", processedFiles: 1, totalFiles: 2,
      startedAt: Date.now(), updatedAt: Date.now(), somethingNew: "unknown here",
    }))
    const v9 = status.readIndexCheckpoint(pidV9)
    check("D2: a future schema is refused, not parsed", v9.integrity === "future-schema" && v9.status === undefined, v9.integrity)
    check("D3: a refused future schema is not resumable", status.decideResume(pidV9).resumable === false)
  }

  // ── E. The resume contract ────────────────────────────────────────────────
  {
    // The contract cli/index.ts:260 asserts: a cancel writes phase "cancelled"
    // SPECIFICALLY so that --resume recognises the checkpoint. Verified here at
    // the data layer, which is where it can actually be enforced.
    const pidC = `${P}-cancel`
    status.writeLiveStatus(pidC, {
      projectId: pidC, phase: "cancelled", processedFiles: 41, totalFiles: 90,
      startedAt: Date.now() - 60_000, updatedAt: Date.now(),
    })
    const d = status.decideResume(pidC)
    check("E1: a 'cancelled' checkpoint IS resumable", d.resumable, d.reason)
    check("E2: the reason reports the checkpoint's own counts", /41\/90/.test(d.reason), d.reason)

    const pidI = `${P}-indexing`
    status.writeLiveStatus(pidI, {
      projectId: pidI, phase: "indexing", processedFiles: 5, totalFiles: 90,
      startedAt: Date.now() - 60_000, updatedAt: Date.now(),
    })
    check("E3: an 'indexing' checkpoint (process died) is resumable", status.decideResume(pidI).resumable)

    for (const phase of ["complete", "failed"]) {
      const t = `${P}-term-${phase}`
      status.writeLiveStatus(t, {
        projectId: t, phase, processedFiles: 9, totalFiles: 9,
        startedAt: Date.now() - 60_000, updatedAt: Date.now(),
      })
      const dd = status.decideResume(t)
      check(`E4: '${phase}' is terminal and not resumable`, !dd.resumable && new RegExp(phase).test(dd.reason), dd.reason)
    }

    // An hour-old checkpoint: the tree has moved, so its counts no longer
    // describe anything. Must be declined, with the age named. Written to disk
    // directly because writeLiveStatus deliberately re-stamps updatedAt.
    const pidOld = `${P}-old`
    mkdirSync(path.dirname(sPath(pidOld)), { recursive: true })
    writeFileSync(sPath(pidOld), JSON.stringify({
      schemaVersion: 2, projectId: pidOld, phase: "cancelled", processedFiles: 1, totalFiles: 2,
      startedAt: Date.now() - 7_200_000, updatedAt: Date.now() - 7_200_000,
    }))
    const dOld = status.decideResume(pidOld)
    check("E5: a >1h-old checkpoint is declined", !dOld.resumable, dOld.reason)
    check("E6: the decline names the age rather than claiming none exists", /min old/.test(dOld.reason), dOld.reason)

    check("E7: a project with no status file is 'missing', not 'corrupt'",
      status.readIndexCheckpoint(`${P}-never-ran`).integrity === "missing")
  }

  // ── F. composeStatus honesty ──────────────────────────────────────────────
  {
    // A cancelled run is OVER. The old isRunning test excluded only
    // "complete"/"failed", so `bb status` reported isRunning=true for 30s
    // after a Ctrl-C — the one phase a user is most likely to be watching.
    const pidX = `${P}-isrunning`
    status.writeLiveStatus(pidX, {
      projectId: pidX, phase: "cancelled", processedFiles: 5, totalFiles: 10,
      startedAt: Date.now(), updatedAt: Date.now(),
    })
    check("F1: a cancelled run is NOT reported as running", (await status.composeStatus(pidX)).isRunning === false)

    const pidY = `${P}-isrunning2`
    status.writeLiveStatus(pidY, {
      projectId: pidY, phase: "indexing", processedFiles: 5, totalFiles: 10,
      startedAt: Date.now(), updatedAt: Date.now(),
    })
    check("F2: a live 'indexing' phase IS reported as running", (await status.composeStatus(pidY)).isRunning === true)

    // dbStats used to be hardcoded to zeros unless a live sample or a last run
    // existed, which made hasIndex false for a fully-indexed project whose
    // status file had been cleared.
    const pidZ = `${P}-dbstats`
    const raw = await BrainDatabase.getRawInstance(pidZ as any)
    raw.prepare(`INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, file_hash, language)
                 VALUES ('f1', ?, '/tmp/a4.ts', 'a4.ts', 'deadbeef', 'typescript')`).run(pidZ)
    const stZ = await status.composeStatus(pidZ)
    check("F3: dbStats are measured with no status file present", stZ.dbStats.files === 1, JSON.stringify(stZ.dbStats))
    check("F4: hasIndex is true for a populated DB with no status file", stZ.hasIndex === true, String(stZ.hasIndex))

    status.clearStatus(pidZ)
    check("F5: clearStatus also removes the temp file", !existsSync(`${sPath(pidZ)}.tmp`))
  }

  // ── G. Lock: shape, refusal, release, per-project isolation ───────────────
  {
    const pid = `${P}-lock-a`
    const h = await lock.acquireIndexLock(pid, { kind: "index" })
    const payload = JSON.parse(readFileSync(lock.indexLockPath(pid), "utf8"))
    check("G1: the payload is versioned", payload.schemaVersion === 1, String(payload.schemaVersion))
    check("G2: the payload records the host", payload.host === hostname(), String(payload.host))
    check("G3: the payload records a per-acquire token", typeof payload.token === "string" && payload.token.length > 0)
    check("G4: the payload records the pid", payload.pid === process.pid)

    // G5: a REAL second process is refused.
    const { child: holder, locked } = spawnHolder(lock.indexLockPath(`${P}-lock-b`))
    await locked
    let refusal = ""
    try {
      await lock.acquireIndexLock(`${P}-lock-b`, { kind: "probe" })
      check("G6: a second PROCESS is refused", false, "acquire unexpectedly succeeded")
    } catch (e: any) {
      refusal = String(e.message)
      check("G6: a second PROCESS is refused", e instanceof lock.IndexLockHeldError, refusal.slice(0, 120))
      check("G7: the refusal names the holder pid", refusal.includes(String(holder.pid)), refusal.slice(0, 160))
      check("G8: the refusal tells the user what to do", /wait for it to finish/.test(refusal), refusal.slice(0, 200))
    }
    // G9: waiting works when the holder goes away.
    holder.kill("SIGKILL")
    await waitForExit(holder)
    const afterWait = await lock.acquireIndexLock(`${P}-lock-b`, { kind: "after-kill", waitMs: 5_000 })
    check("G9: the reclaimed project is indexable again", afterWait.pid === process.pid)
    await afterWait.release()

    // G10: per-project isolation — while WE hold lock-a, a DIFFERENT project
    // must still be acquirable.
    const iso = await lock.acquireIndexLock(`${P}-lock-c`, { kind: "iso-probe" })
    check("G10: holding one project does not block another", iso.pid === process.pid)
    await iso.release()

    await h.release()
    check("G11: release removes the lockfile", !existsSync(lock.indexLockPath(pid)))

    // G12: a same-process second acquire QUEUES (does not refuse) — the
    // documented contract the m11 lifecycle depends on — so a waitMs bounds it.
    const q1 = await lock.acquireIndexLock(`${P}-lock-q`, { kind: "first" })
    let queued = false
    void lock.acquireIndexLock(`${P}-lock-q`, { kind: "second" }).then(() => { queued = true })
    await new Promise((r) => setTimeout(r, 200))
    check("G12: a same-process acquire waits rather than refusing", queued === false)
    let boundedRefusal = ""
    try {
      await lock.acquireIndexLock(`${P}-lock-q`, { kind: "bounded", waitMs: 300 })
      check("G13: waitMs bounds the in-process wait", false, "no error after waiting")
    } catch (e: any) {
      boundedRefusal = String(e.message)
      check("G13: waitMs bounds the in-process wait", e instanceof lock.IndexLockHeldError, boundedRefusal.slice(0, 120))
    }
    await q1.release()
    await new Promise((r) => setTimeout(r, 300))
  }

  // ── H. THE WEDGE: a lockfile that names no process ────────────────────────
  // The bug: the reclaim branch required `pid !== null`, so a lockfile whose
  // payload could not be parsed (0 bytes from a kill between create and write,
  // or a full disk) was skipped by reclaim AND by liveness, and every later
  // `bb index` refused that project FOREVER — while the refusal text promised
  // the stale lock "is reclaimed automatically on the next run".
  {
    process.env.BB_INDEX_LOCK_GRACE_MS = "0"
    const pid = `${P}-wedge`
    const lp = lock.indexLockPath(pid)
    mkdirSync(path.dirname(lp), { recursive: true })
    writeFileSync(lp, "")
    check("H1: a 0-byte lockfile is planted", existsSync(lp))
    // Wrapped: a regression here THROWS (the project refuses to be indexed), and
    // an uncaught throw would abort the rest of the gate instead of reporting.
    let reclaimed: { pid: number } | null = null
    try { reclaimed = await lock.acquireIndexLock(pid, { kind: "after-crash" }) }
    catch (e: any) { check("H2: the wedged project can be indexed again", false, String(e.message).slice(0, 160)) }
    check("H2: the wedged project can be indexed again", reclaimed?.pid === process.pid, "acquire threw instead of reclaiming")
    if (reclaimed) {
      await reclaimed.release()
      check("H3: and released cleanly", !existsSync(lp))
    }

    process.env.BB_INDEX_LOCK_GRACE_MS = "60000"
    const pid2 = `${P}-wedge2`
    const lp2 = lock.indexLockPath(pid2)
    mkdirSync(path.dirname(lp2), { recursive: true })
    writeFileSync(lp2, "{not json")
    let refusedMidWrite = false
    try { await lock.acquireIndexLock(pid2, { kind: "probe" }) } catch { refusedMidWrite = true }
    check("H4: a FRESH unreadable lock is NOT stolen from a possible creator", refusedMidWrite)
    backdate(lp2, 120_000)
    const late = await lock.acquireIndexLock(pid2, { kind: "late" })
    check("H5: the same lock IS reclaimed after the grace window", late.pid === process.pid)
    await late.release()
    delete process.env.BB_INDEX_LOCK_GRACE_MS
  }

  // ── I. A killed holder leaves no permanent lock ───────────────────────────
  {
    const pid = `${P}-kill`
    const { child, locked } = spawnHolder(lock.indexLockPath(pid))
    await locked
    const held = JSON.parse(readFileSync(lock.indexLockPath(pid), "utf8"))
    check("I1: the child holds the lock", existsSync(lock.indexLockPath(pid)) && held.pid === child.pid)
    let liveRefusal = ""
    try { await lock.acquireIndexLock(pid, { kind: "probe" }) } catch (e: any) { liveRefusal = String(e.message) }
    check("I2: a LIVE holder is refused, by pid", /already active/.test(liveRefusal) && liveRefusal.includes(String(child.pid)), liveRefusal.slice(0, 160))

    child.kill("SIGKILL")
    await waitForExit(child)
    const afterKill = await lock.acquireIndexLock(pid, { kind: "after-kill" })
    check("I3: a SIGKILLed holder's lock is reclaimed (no permanent lock)", afterKill.pid === process.pid)
    await afterKill.release()
  }

  // ── J. A planted v0 lockfile (no host/token) is still reclaimed ───────────
  // Compatibility with every lockfile written before this change, and the
  // shape the m43.P1 gate plants.
  {
    const pid = `${P}-v0lock`
    const lp = lock.indexLockPath(pid)
    mkdirSync(path.dirname(lp), { recursive: true })
    // A pid that has DEMONSTRABLY exited: spawn a throwaway child, await its
    // exit, then plant its pid. `process.pid + 1` is NOT safe here — it is a
    // perfectly ordinary live pid on a busy machine, and this gate failed that
    // way once. Nothing spawns between the exit and the plant, so the pid
    // cannot be recycled into a live process.
    const probe = spawn(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { stdio: ["ignore", "pipe", "ignore"] })
    let deadOut = ""
    probe.stdout.on("data", (d) => { deadOut += String(d) })
    const deadPid = await new Promise<number>((resolve) => {
      probe.on("exit", () => resolve(Number(deadOut.trim()) || 2_147_483_647))
    })
    writeFileSync(lp, JSON.stringify({ pid: deadPid, startedAt: Date.now() - 60_000, kind: "crashed" }))
    const reclaimed = await lock.acquireIndexLock(pid, { kind: "stale" })
    check("J1: a planted dead-pid lock is reclaimed", reclaimed.pid === process.pid)
    check("J2: reclaiming REPLACES the file with ours (it names our pid)",
      JSON.parse(readFileSync(lp, "utf8")).pid === process.pid)
    await reclaimed.release()
    check("J3: and removes it on release", !existsSync(lp))
  }

  // ── K. release() must not delete a LATER holder's lock ────────────────────
  // The old release matched on pid alone. After a stale reclaim replaced the
  // file, the old handle's release() saw its own pid in the new file and
  // deleted the NEW holder's lock — silently dropping mutual exclusion.
  {
    const pid = `${P}-token`
    const lp = lock.indexLockPath(pid)
    mkdirSync(path.dirname(lp), { recursive: true })
    const holder = await lock.acquireIndexLock(pid, { kind: "holder" })
    // Holder B (same pid, different token) takes the file, as a reclaim+reacquire
    // would; then holder A releases late.
    writeFileSync(lp, JSON.stringify({
      schemaVersion: 1, pid: process.pid, host: hostname(), token: "b-token",
      startedAt: Date.now(), kind: "b",
    }))
    await holder.release()
    check("K1: a mismatched release leaves the current holder's lock alone", existsSync(lp) &&
      JSON.parse(readFileSync(lp, "utf8")).token === "b-token",
      existsSync(lp) ? readFileSync(lp, "utf8").slice(0, 120) : "lockfile was deleted by a foreign release")
    rmSync(lp, { force: true })
  }

  // ── L. A lock from another HOST is not judged by our pid table ─────────────
  {
    const pid = `${P}-foreign`
    const lp = lock.indexLockPath(pid)
    mkdirSync(path.dirname(lp), { recursive: true })
    // host = another machine, pid = OURS. Judging it against our process table
    // would call it held (pid exists here) and block the project; treating it as
    // dead would stomp a live remote run. Either way the pid is meaningless.
    writeFileSync(lp, JSON.stringify({
      schemaVersion: 1, pid: process.pid, host: `${hostname()}-elsewhere`,
      token: "remote", startedAt: Date.now(), kind: "index",
    }))
    let refusedForeign = false
    let msg = ""
    try { await lock.acquireIndexLock(pid, { kind: "probe" }) } catch (e: any) { refusedForeign = true; msg = String(e.message) }
    check("L1: a fresh foreign-host lock is honoured", refusedForeign, "acquired anyway")
    check("L2: the refusal explains the cross-host case", /host/.test(msg) && /rm /.test(msg), msg.slice(0, 220))
    backdate(lp, 25 * 3_600_000)
    const aged = await lock.acquireIndexLock(pid, { kind: "aged" })
    check("L3: an expired foreign-host lock is reclaimed (not wedged forever)", aged.pid === process.pid)
    await aged.release()
  }

  // ── M. liveIndexLockHolder: the destructive-path probe ────────────────────
  {
    const pid = `${P}-probe`
    const lp = lock.indexLockPath(pid)
    mkdirSync(path.dirname(lp), { recursive: true })
    writeFileSync(lp, "")
    check("M1: an unreadable lock names no live holder", lock.liveIndexLockHolder(pid) === null)
    rmSync(lp, { force: true })
    const h = await lock.acquireIndexLock(pid, { kind: "probe" })
    check("M2: a lock WE hold is reported as a live holder", lock.liveIndexLockHolder(pid)?.pid === process.pid)
    await h.release()
    check("M3: after release there is no holder", lock.liveIndexLockHolder(pid) === null)
  }

  // ── N. Health honesty ─────────────────────────────────────────────────────
  {
    const pid = `${P}-health`
    const raw = await BrainDatabase.getRawInstance(pid as any)

    // N1: an EMPTY index must not read as a healthy one. Measured before this
    // change: 92%, 11 of 12 scored checks "ok" — every "is this data malformed?"
    // question passed vacuously because there was no data.
    const empty = await health.runIndexHealthCheck(pid as any)
    check("N1: an empty index is reported as EMPTY, not as a score", empty.verdict === "empty", empty.verdict)
    check("N2: the empty report says the score is vacuous",
      /NO DATA to be malformed/.test(health.formatHealthReport(empty)))
    check("N3: the report carries a staleness classification",
      typeof empty.staleness?.fresh === "number" && empty.staleness.total === 0, JSON.stringify(empty.staleness))

    // N4: the indexer's own "partial" marker must make health report a fault.
    raw.prepare(`INSERT OR REPLACE INTO brain_index_status (project_id, indexing_version, status, total_files, indexed_files, time_created, time_updated)
                 VALUES (?, 'test', 'partial', 5000, 3, 0, 0)`).run(pid)
    const partial = await health.runIndexHealthCheck(pid as any)
    const cc = partial.checks.find((c) => c.name === "Index Completeness")
    check("N4: a 'partial' index is an ERROR, not a pass", cc?.status === "error", cc?.status)
    check("N5: the shortfall is named with numbers", /4997 of 5000/.test(cc?.description ?? ""), (cc?.description ?? "").slice(0, 160))
    check("N6: the report-level indexStatus carries it",
      partial.indexStatus.shortfall === 4997 && partial.indexStatus.status === "partial", JSON.stringify(partial.indexStatus))

    // N4b: 'partial' with NO shortfall. The case above sets both conditions, so
    // it cannot tell the partial-status branch from the shortfall branch — and a
    // mutation of the partial branch ALONE passed this gate, because the
    // shortfall branch still graded it an error. Two independent triggers, two
    // independent assertions, or the branch under test is never exercised.
    const pidP2 = P + "-health-partial-only"
    const rawP2 = await BrainDatabase.getRawInstance(pidP2 as any)
    rawP2.prepare("INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, file_hash, language) VALUES ('pf', ?, '/tmp/p.ts', 'p.ts', 'x', 'typescript')").run(pidP2)
    rawP2.prepare("INSERT OR REPLACE INTO brain_index_status (project_id, indexing_version, status, total_files, indexed_files, time_created, time_updated) VALUES (?, 'test', 'partial', 1, 1, 0, 0)").run(pidP2)
    const partialOnly = await health.runIndexHealthCheck(pidP2 as any)
    const ccP2 = partialOnly.checks.find((c) => c.name === "Index Completeness")
    check("N4b: 'partial' alone (no shortfall) is still an ERROR", ccP2?.status === "error",
      String(ccP2?.status) + " — " + (ccP2?.description ?? "").slice(0, 120))
    check("N4c: and says the status is partial", /recorded this run's status as "partial"/.test(ccP2?.description ?? ""), "")

    // N7: counts and status can disagree; the reader must be told which to
    // believe rather than being handed one of them.
    raw.prepare(`UPDATE brain_index_status SET status='complete' WHERE project_id=?`).run(pid)
    const contradicted = await health.runIndexHealthCheck(pid as any)
    const cc2 = contradicted.checks.find((c) => c.name === "Index Completeness")
    check("N7: status='complete' + a 4997-file shortfall is still an error", cc2?.status === "error", cc2?.status)
    check("N8: the contradiction is stated", /status field says "complete"/.test(cc2?.description ?? ""), (cc2?.description ?? "").slice(0, 200))

    // N9: UNRECORDED is not COMPLETE.
    raw.prepare(`DELETE FROM brain_index_status WHERE project_id=?`).run(pid)
    const unrecorded = await health.runIndexHealthCheck(pid as any)
    const cc3 = unrecorded.checks.find((c) => c.name === "Index Completeness")
    check("N9: no brain_index_status row is a warn, not a pass", cc3?.status === "warn", cc3?.status)
    check("N10: the warn says UNRECORDED is not complete", /UNRECORDED is not the same as complete/.test(cc3?.description ?? ""))

    // N11: the remediation must be a command the user can type. It used to name
    // the projectId — a sha, not a directory.
    const remed = cc3?.remediation ?? ""
    check("N11: the remediation is typeable (no sha-as-path)",
      /bb index --force/.test(remed) && !/bb index "[0-9a-f]{8,}"/.test(remed), remed.slice(0, 120))

    // N12: a healthy, complete, populated index is reported healthy.
    const pidH = `${P}-health-ok`
    const rawH = await BrainDatabase.getRawInstance(pidH as any)
    rawH.prepare(`INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, file_hash, language)
                  VALUES ('hf', ?, '/tmp/h.ts', 'h.ts', 'x', 'typescript')`).run(pidH)
    rawH.prepare(`INSERT OR REPLACE INTO brain_index_status (project_id, indexing_version, status, total_files, indexed_files, time_created, time_updated)
                  VALUES (?, 'test', 'complete', 1, 1, 0, 0)`).run(pidH)
    const okReport = await health.runIndexHealthCheck(pidH as any)
    const cc4 = okReport.checks.find((c) => c.name === "Index Completeness")
    check("N12: a complete 1/1 index passes the completeness check", cc4?.status === "ok", cc4?.status)
    check("N13: and the verdict is not 'empty'", okReport.verdict !== "empty", okReport.verdict)

    // N14: the pre-resolved path must agree exactly with the reasons it is given.
    const pre = await health.runIndexHealthCheck(pidH as any, {
      diskScan: "complete",
      preResolved: { total: 1, reasons: { "metadata-fast-path": 7, "hash-match": 3, "hash-differs": 2, "file-gone": 1, "unreadable": 1, "no-row": 1 } },
    })
    check("N14: preResolved staleness is exact and additive",
      pre.staleness.basis === "exact" && pre.staleness.fresh === 10 && pre.staleness.stale === 2 &&
      pre.staleness.missing === 2 && pre.staleness.unclassified === 1, JSON.stringify(pre.staleness))
    check("N15: exact mode declares complete coverage", pre.staleness.complete === true)

    // N16: no check may report `ok` while its own text says it did not run.
    // This is the WAL check's shape, and it is a general invariant of an
    // integrity battery: a check that could not be measured once reported
    // status "ok" with the description "check skipped", which both displayed a
    // ✅ and added a PASSING point to the score. Asserting the invariant over
    // the whole report catches that class wherever it reappears, not only in
    // the one check that had it.
    const liar = [empty, partial, contradicted, unrecorded, okReport]
      .flatMap((r) => r.checks)
      .filter((c) => c.status === "ok" && /\b(not measured|skipped|unable to|could not)\b/i.test(c.description))
    check("N16: no check reports 'ok' while saying it did not run", liar.length === 0,
      liar.map((c) => `${c.name}: ${c.description.slice(0, 60)}`).join(" | "))

    // N17: every scored check must be graded, and the summary must add up.
    for (const pair of [["empty", empty], ["partial", partial], ["ok", okReport]] as const) {
      const rep = pair[1]
      const graded = rep.checks.every((c) => c.status === "ok" || c.status === "warn" || c.status === "error")
      const sums = rep.summary.ok + rep.summary.warn + rep.summary.error === rep.summary.scored
      check(`N17: '${pair[0]}' grades every check and its summary adds up`, graded && sums,
        JSON.stringify(rep.summary))
    }
  }

  // ── O. One corpus pass, and the two disk checks cannot disagree ────────────
  // A64.V1 regression: the first draft of the staleness block added its own
  // walk of brain_file that re-read every sampled file, so one bb_health call
  // hashed the sample twice — the exact defect M64.A4 records a screen above
  // ("two full passes to produce one number"). Asserted here by counting the
  // reads: it must be the number of files, not twice the number of files.
  {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-a4-corp-"))
    const N = 12
    const cryptoMod = await import("node:crypto")
    const fsMod = await import("node:fs")
    for (let i = 0; i < N; i++) {
      writeFileSync(path.join(dir, "f" + i + ".ts"), "export const v" + i + " = " + i + "\n")
    }
    // Stale exactly 3 of them on disk, and delete 1, so every class is non-zero.
    for (let i = 0; i < 3; i++) writeFileSync(path.join(dir, "f" + i + ".ts"), "export const v" + i + " = 999\n")
    rmSync(path.join(dir, "f11.ts"))

    const pidO = P + "-corpus"
    const rawO = await BrainDatabase.getRawInstance(pidO as any)
    const hashOfContent = (content: string) =>
      cryptoMod.createHash("sha256").update(content).digest("hex").slice(0, 16)
    for (let i = 0; i < N; i++) {
      const abs = path.join(dir, "f" + i + ".ts")
      // The stored hash is of the ORIGINAL content, so files 0-2 read as edited
      // on disk and the rest read as matching.
      const original = "export const v" + i + " = " + i + "\n"
      rawO.prepare("INSERT OR REPLACE INTO brain_file (id, project_id, path, relative_path, file_hash, language) VALUES (?, ?, ?, ?, ?, 'typescript')")
        .run("cf" + i, pidO, abs, "f" + i + ".ts", hashOfContent(original))
    }
    rawO.prepare("INSERT OR REPLACE INTO brain_index_status (project_id, indexing_version, status, total_files, indexed_files, time_created, time_updated) VALUES (?, 'test', 'complete', ?, ?, 0, 0)").run(pidO, N, N)

    // Count how many times the battery runs its CONTENT-READING scan (the only
    // path that selects file_hash in order to read bytes off disk). An ESM
    // namespace cannot be monkey-patched, so fs.readFileSync is not available
    // as a counter; the DB handle is reached through BrainDatabase's own static,
    // which is a plain writable property, and the same module instance the
    // health module imports.
    const dbMod = await import(path.join(ROOT, "src/brain/database.ts"))
    const realGetRaw = dbMod.BrainDatabase.getRawInstance
    let contentScans = 0
    dbMod.BrainDatabase.getRawInstance = async (pid: any) => {
      const db: any = await realGetRaw.call(dbMod.BrainDatabase, pid)
      return new Proxy(db, {
        get(t, prop) {
          if (prop === "prepare") {
            return (sql: string) => {
              if (typeof sql === "string" && sql.includes("file_hash")) contentScans++
              return (t as any).prepare(sql)
            }
          }
          const v = (t as any)[prop]
          return typeof v === "function" ? v.bind(t) : v
        },
      })
    }
    let repO
    try {
      repO = await health.runIndexHealthCheck(pidO as any, { diskScan: "complete" })
    } finally {
      dbMod.BrainDatabase.getRawInstance = realGetRaw
    }

    const driftCheck = repO.checks.find((c) => c.name === "Hash Drift (Stale Files)")!
    check("O1: the corpus is read EXACTLY ONCE per battery run", contentScans === 1,
      "ran " + contentScans + " content-reading scans (a second pass would be 2)")
    check("O2: the staleness breakdown agrees with the drift check it shares a pass with",
      repO.staleness.stale === driftCheck.value, "staleness.stale=" + repO.staleness.stale + " drift.value=" + driftCheck.value)
    check("O3: fresh + stale + missing accounts for every file examined",
      repO.staleness.fresh + repO.staleness.stale + repO.staleness.missing === repO.staleness.sampleSize,
      JSON.stringify(repO.staleness))
    check("O4: the 3 edited files are stale and the deleted one is missing",
      repO.staleness.stale === 3 && repO.staleness.missing === 1, JSON.stringify(repO.staleness))
    check("O5: a complete scan declares itself exact", repO.staleness.basis === "exact" && repO.staleness.complete === true)
    rmSync(dir, { recursive: true, force: true })
  }

  // The verdict is written synchronously: `process.exit()` discards buffered
  // stdout when it is a pipe or a file, so a piped run of a gate that ends in
  // process.exit can print NOTHING and exit 0. For a gate, that is the whole
  // output, so it cannot be left to the buffer.
  writeSync(1,
    `A4 index health/status/lock: ${passed} passed, ${failed} failed\n` +
    `NOTE: the milestone gates (script/m43/verify-p1-index-lock.ts, script/m40/verify-a1-post-entry.ts, script/m35/verify-freshness-core.ts) spawn \`bun\`, which is not installed in this environment. This gate is bun-free by construction.\n`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((e) => {
  writeSync(2, `A4 gate crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
  cleanup()
  process.exitCode = 1
})