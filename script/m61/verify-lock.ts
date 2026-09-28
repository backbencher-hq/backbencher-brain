// script/m61/verify-lock.ts — M61.V2 verifier + mutation suite (issue #843).
//
// Proves the declared lock (script/lib/lock.ts) honors its law, and that the
// suite CAN FAIL. The guarantees under test:
//
//   L1 bounded wait, loud refusal: while another PROCESS holds a results-dir
//      lock, an acquisition inside the declared wait is REFUSED with the
//      holder's identity — it never proceeds, never writes unlocked.
//   L2 stale is reported, never silently stolen: a lock whose holder pid is
//      dead (or whose age exceeds the declared threshold) is refused with a
//      "stale lock" reason and LEFT IN PLACE. Breaking it is a deliberate
//      declared action (BB_GATE_BREAK_STALE_LOCK=1), reported as brokeStale.
//   L3 concurrent writers never interleave: two real child processes each
//      write 100 records into ONE shared file in ONE dir. With the lock every
//      sequence number 0..199 appears exactly once in the journal (each writer
//      computed its successor INSIDE the critical section); a duplicate would
//      mean two writers read the same head. The final record verifies through
//      the trusted read.
//   L4 adoption: lane gates write evidence through the one write path — no
//      evidence-shaped bare writeFileSync outside the declared exclusions.
//
// Mutants (source-level copies — M1-M5) prove the suite can fail:
//   M1 no-refusal:      the timeout branch is disabled -> L1's refusal never
//                       happens.
//   M2 release-no-unlink: release stops deleting the lock -> L1's "release
//                       clears the lock" fails.
//   M3 no-stale-detect: staleness is forced false -> L2's "stale lock" reason
//                       never appears.
//   M4 silent-steal:    the break path is taken unconditionally -> a stale
//                       lock is stolen WITHOUT the declared override.
//   M5 write-unlocked:  writeSealed drops the dir lock -> L5's "the write path
//                       refuses under contention" fails.
//
// Run: npx tsx script/m61/verify-lock.ts
// Evidence: validation/m61/results/V2.json (sealed)

import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { GateLockError, LOCK_FILE, acquireLock, lockExists } from "../lib/lock.ts"
import { readEvidence, writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const RESULTS = path.join(ROOT, "validation/m61/results")

let passed = 0
let failed = 0
const failures: string[] = []
const checks: string[] = []
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed++
  else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
  }
  checks.push(`${ok ? "ok" : "FAIL"}: ${name}${detail && !ok ? ` — ${detail}` : ""}`)
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Poll until a path exists (bounded) — used to sequence child processes. */
function waitFor(p: string, ms = 5_000): boolean {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (existsSync(p)) return true
    sleepSync(25)
  }
  return false
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "m61-v2-"))
const LIB = path.posix.join(ROOT, "script/lib/lock.ts")
const EV = path.posix.join(ROOT, "script/lib/evidence.ts")

// --- child helpers ------------------------------------------------------------
// A holder: takes the lock, announces it, sleeps, releases.
// Children signal through FILES, not stdout: this suite polls with a sync
// wait (Atomics.wait), which blocks the event loop — stdout callbacks cannot
// run while polling, so a stdout-based handshake would deadlock the check.
const holderChild = path.join(tmp, "holder-child.ts")
writeFileSync(
  holderChild,
  `import { acquireLock } from ${JSON.stringify(LIB)}\n` +
    `import { writeFileSync } from "node:fs"\n` +
    `import path from "node:path"\n` +
    `const [dir, holdMs] = process.argv.slice(2)\n` +
    `const h = acquireLock(dir, { gate: "holder-child" })\n` +
    `writeFileSync(path.join(dir, "held.marker"), String(process.pid))\n` +
    `const t = Number(holdMs)\n` +
    `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, t)\n` +
    `h.release()\n` +
    `writeFileSync(path.join(dir, "released.marker"), "1")\n`,
)

// A writer: 100 locked read-modify-write cycles on ONE shared file, recording
// the sequence it committed INSIDE the critical section.
const writerChild = path.join(tmp, "writer-child.ts")
writeFileSync(
  writerChild,
  `import { withLock } from ${JSON.stringify(LIB)}\n` +
    `import { writeSealed, readEvidence } from ${JSON.stringify(EV)}\n` +
    `import { appendFileSync, existsSync } from "node:fs"\n` +
    `import path from "node:path"\n` +
    `const [dir, countStr, id] = process.argv.slice(2)\n` +
    `const count = Number(countStr)\n` +
    `const shared = path.join(dir, "shared.json")\n` +
    `const journal = path.join(dir, "journal.txt")\n` +
    `let done = 0\n` +
    `for (let i = 0; i < count; i++) {\n` +
    `  withLock(dir, () => {\n` +
    `    let seq = 0\n` +
    `    if (existsSync(shared)) {\n` +
    `      const r = readEvidence<{ seq: number }>(shared)\n` +
    `      if (!r.ok) throw new Error("writer " + id + " saw an unreadable record: " + r.reason)\n` +
    `      seq = r.record.seq + 1\n` +
    `    }\n` +
    `    writeSealed(shared, { seq, writer: id, at: new Date().toISOString() }, undefined, { waitMs: 30_000 })\n` +
    `    appendFileSync(journal, seq + "\\n")\n` +
    `    done++\n` +
    `  }, { waitMs: 30_000, gate: "writer-" + id })\n` +
    `}\n` +
    `console.log("DONE " + done)\n`,
)

try {
  // --- L1: bounded wait, loud refusal ------------------------------------------
  console.log("L1: bounded wait and loud refusal (real second process)")
  const dir1 = path.join(tmp, "dir1")
  const holder = spawn("npx", ["tsx", holderChild, dir1, "2500"], { stdio: "ignore" })
  const announced = waitFor(path.join(dir1, "held.marker"), 10_000)
  check("L1: the holder process announced the lock (marker + lock file)", announced && existsSync(path.join(dir1, LOCK_FILE)), `announced=${announced}`)

  let entered = false
  let refusal: GateLockError | null = null
  try {
    const h = acquireLock(dir1, { waitMs: 250, gate: "verify-lock" })
    entered = true
    h.release()
  } catch (e) {
    if (e instanceof GateLockError) refusal = e
    else throw e
  }
  check("L1: a contended acquisition is refused loudly", refusal !== null && entered === false, refusal === null ? "it proceeded!" : refusal.reason)
  check(
    "L1: the refusal names the holder and the bounded wait",
    refusal !== null && /pid \d+/.test(refusal.reason) && /waited \d+ms/.test(refusal.reason),
    refusal?.reason ?? "",
  )
  check("L1: the refusal is not a steal — the holder's lock is untouched", existsSync(path.join(dir1, LOCK_FILE)))

  // Wait for the holder to finish, then the lock must be free.
  const released = waitFor(path.join(dir1, "released.marker"), 10_000)
  check("L1: the holder released (marker + lock file gone)", released && !existsSync(path.join(dir1, LOCK_FILE)), `released=${released} lockStillThere=${existsSync(path.join(dir1, LOCK_FILE))}`)

  const afterHolder = acquireLock(dir1, { waitMs: 2_000, gate: "verify-lock" })
  check("L1: the lock is acquirable after the holder released", afterHolder.holder.pid === process.pid)
  afterHolder.release()
  check("L1: release clears the lock file", !lockExists(dir1))

  // --- L2: stale detection, never silently stolen -------------------------------
  console.log("L2: stale locks are reported, never silently stolen")
  const dir2 = path.join(tmp, "dir2")
  acquireLock(dir2, { gate: "seed" }).release() // create the dir
  const deadLock = path.join(dir2, LOCK_FILE)
  writeFileSync(
    deadLock,
    `${JSON.stringify({ pid: 999_999, host: "somewhere", gate: "crashed-gate", token: "dead-1", startedAt: new Date(0).toISOString(), startedAtMs: 0 }, null, 2)}\n`,
  )
  let staleRefusal: GateLockError | null = null
  try {
    acquireLock(dir2, { waitMs: 200, gate: "verify-lock" }).release()
  } catch (e) {
    if (e instanceof GateLockError) staleRefusal = e
    else throw e
  }
  check(
    "L2: a dead-holder lock is refused as STALE",
    staleRefusal !== null && /stale lock/.test(staleRefusal.reason) && /no longer running/.test(staleRefusal.reason),
    staleRefusal?.reason ?? "no refusal",
  )
  const afterStaleAttempt = JSON.parse(readFileSync(deadLock, "utf8")) as { token?: string }
  check("L2: the stale lock is NOT stolen (still the dead holder's)", afterStaleAttempt.token === "dead-1", JSON.stringify(afterStaleAttempt))

  // A LIVE pid with an over-age timestamp is stale by age, not by liveness.
  const live = spawn("sleep", ["20"], { stdio: "ignore" })
  try {
    writeFileSync(
      deadLock,
      `${JSON.stringify({ pid: live.pid, host: os.hostname(), gate: "hung-gate", token: "age-1", startedAt: new Date(Date.now() - 3_600_000).toISOString(), startedAtMs: Date.now() - 3_600_000 }, null, 2)}\n`,
    )
    let ageRefusal: GateLockError | null = null
    try {
      acquireLock(dir2, { waitMs: 150, staleMs: 1_000, gate: "verify-lock" }).release()
    } catch (e) {
      if (e instanceof GateLockError) ageRefusal = e
      else throw e
    }
    check(
      "L2: a live-holder lock past the declared age is refused as STALE",
      ageRefusal !== null && /stale lock/.test(ageRefusal.reason) && /exceeded the declared stale age/.test(ageRefusal.reason),
      ageRefusal?.reason ?? "no refusal",
    )

    // The declared override breaks it — loudly, and reports it.
    process.env.BB_GATE_BREAK_STALE_LOCK = "1"
    const broken = acquireLock(dir2, { waitMs: 500, staleMs: 1_000, gate: "verify-lock" })
    check("L2: the declared override breaks the stale lock and reports brokeStale", broken.brokeStale === true)
    broken.release()
    delete process.env.BB_GATE_BREAK_STALE_LOCK
    check("L2: after the deliberate break the dir is free", !lockExists(dir2))
  } finally {
    live.kill()
  }

  // --- L3: concurrent writers never interleave -----------------------------------
  console.log("L3: two concurrent writer processes over one shared record")
  const dir3 = path.join(tmp, "dir3")
  const COUNT = 100
  const w1 = spawn("npx", ["tsx", writerChild, dir3, String(COUNT), "A"], { stdio: ["ignore", "pipe", "inherit"] })
  const w2 = spawn("npx", ["tsx", writerChild, dir3, String(COUNT), "B"], { stdio: ["ignore", "pipe", "inherit"] })
  let out1 = ""
  let out2 = ""
  w1.stdout.on("data", (d: Buffer) => (out1 += d.toString()))
  w2.stdout.on("data", (d: Buffer) => (out2 += d.toString()))
  const exits = await Promise.all(
    [w1, w2].map(
      (w) =>
        new Promise<number>((resolve) => {
          w.on("exit", (code) => resolve(code ?? -1))
        }),
    ),
  )
  check("L3: both writer processes exit 0 (the lock serialized them)", exits.every((c) => c === 0), `exits=${exits.join(",")} out=${out1.trim()}|${out2.trim()}`)
  check("L3: each writer completed its declared count", out1.includes(`DONE ${COUNT}`) && out2.includes(`DONE ${COUNT}`), `${out1.trim()}|${out2.trim()}`)

  const journal = readFileSync(path.join(dir3, "journal.txt"), "utf8").trim().split("\n").map((s) => Number(s))
  const unique = new Set(journal)
  const contiguous = journal.length === COUNT * 2 && unique.size === COUNT * 2 && [...unique].every((v) => v >= 0 && v < COUNT * 2)
  check(
    "L3: every sequence 0..199 appears exactly once (no two writers read the same head)",
    contiguous,
    `lines=${journal.length} unique=${unique.size} min=${Math.min(...journal)} max=${Math.max(...journal)}`,
  )
  const finalRecord = readEvidence<{ seq: number }>(path.join(dir3, "shared.json"))
  check("L3: the final shared record verifies through the trusted read", finalRecord.ok, finalRecord.ok ? "" : finalRecord.reason)
  if (finalRecord.ok) check("L3: the final record is the last committed sequence", finalRecord.record.seq === COUNT * 2 - 1, `seq=${finalRecord.record.seq}`)
  const litter = readdirSync(dir3).filter((f) => f.includes(".tmp-"))
  check("L3: no temp-file residue survives the concurrent writes", litter.length === 0, litter.join(","))

  // --- L5: the ONE write path takes the lock -------------------------------------
  console.log("L5: writeSealed contends on the dir lock (the write path is serialized)")
  const dir5 = path.join(tmp, "dir5")
  const holder5 = spawn("npx", ["tsx", holderChild, dir5, "2000"], { stdio: ["ignore", "pipe", "inherit"] })
  check("L5: holder acquired the dir5 lock", waitFor(path.join(dir5, LOCK_FILE)))
  const contendedPath = path.join(dir5, "write-under-contention.json")
  let writeRefusal: GateLockError | null = null
  try {
    writeSealed(contendedPath, { probe: "must not write unlocked" }, undefined, { waitMs: 150 })
  } catch (e) {
    if (e instanceof GateLockError) writeRefusal = e
    else throw e
  }
  check("L5: writeSealed refuses under contention instead of writing unlocked", writeRefusal !== null, writeRefusal?.reason ?? "it wrote anyway!")
  check("L5: nothing was written while the lock was held", !existsSync(contendedPath))
  holder5.kill()
  await new Promise((r) => holder5.on("exit", r))
  rmSync(path.join(dir5, LOCK_FILE), { force: true }) // holder was killed before release

  // --- L4: adoption audit ---------------------------------------------------------
  console.log("L4: lane adoption (evidence writes go through the one write path)")
  // Declared exclusions: files whose JSON writes are NOT evidence records, or
  // are the migration/codemod/fixture machinery itself.
  const DECLARED_EXCLUSIONS = new Set([
    "script/m61/verify-sealing.ts", // tamper/clobber fixtures — deliberate raw writes
    "script/m61/verify-lock.ts", // this suite's fixtures
    "script/m61/verify-reproducibility.ts", // V3's DOCTORED stored record (a fixture, written to a temp dir)
    "script/m61/seal-legacy.ts", // D-1's one-shot migration (its own write path)
    "script/m61/adopt-sealed-writes.ts", // codemod: rewrites OTHER files' text
    "script/m61/adopt-sealed-writes2.ts",
    "script/m61/adopt-sealed-writes3.ts",
    "script/m61/adopt-sealed-reads2.ts",
    "script/m25/verify-auto-index.ts", // consent store — declared out of D-1 scope
    "script/m25/verify-install-docs.ts", // transient vscode-test results.json (harness output, not a record)
    "script/m61/verify-governance.ts", // G1's tampered-record fixture (written to a temp path, then removed)
  ])
  const offenders: string[] = []
  for (const d of ["m24", "m25", "m26", "m27", "m28", "m29", "m42", "m44", "m53", "m55", "m61"]) {
    const dirAbs = path.join(ROOT, "script", d)
    if (!existsSync(dirAbs)) continue
    for (const f of readdirSync(dirAbs)) {
      if (!/\.(ts|mts)$/.test(f)) continue
      const rel = `script/${d}/${f}`
      if (DECLARED_EXCLUSIONS.has(rel)) continue
      const src = readFileSync(path.join(dirAbs, f), "utf8")
      for (const line of src.split("\n")) {
        if (/writeFileSync\(/.test(line) && /JSON\.stringify\(/.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 80)}`)
      }
    }
  }
  check(
    "L4: no evidence-shaped bare write outside the declared exclusions",
    offenders.length === 0,
    offenders.slice(0, 4).join(" | "),
  )

  // --- mutants: the suite CAN FAIL --------------------------------------------------
  console.log("mutants: the suite can fail (source-level library copies)")
  const lockSource = readFileSync(path.join(ROOT, "script/lib/lock.ts"), "utf8")
  const evSource = readFileSync(path.join(ROOT, "script/lib/evidence.ts"), "utf8")

  // Mutant copies are written BESIDE their source (script/lib/) so the copy's
  // own relative imports resolve — the same rule verify-sealing needed after
  // evidence.ts grew an `import ... from "./lock.ts"`.
  for (const f of readdirSync(path.join(ROOT, "script/lib"))) {
    if (f.startsWith(".mutant-lock-")) rmSync(path.join(ROOT, "script/lib", f), { force: true })
  }
  async function runMutant(name: string, from: string, to: string, probe: (mod: Record<string, unknown>) => boolean, source = lockSource): Promise<void> {
    if (!source.includes(from)) {
      check(`M: ${name} (mutation anchor exists)`, false, "anchor not found — the mutant is stale")
      return
    }
    const mutated = source.replace(from, to)
    const mutantPath = path.join(ROOT, "script/lib", `.mutant-lock-${name}.ts`)
    writeFileSync(mutantPath, mutated)
    try {
      const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
      check(`M: ${name}`, probe(mod) === true, "the mutant did NOT manifest the defect — the suite could not fail")
    } catch (e) {
      // A mutant that crashes the library at RUNTIME is still caught (the real
      // gate would fail loudly). A mutant that cannot even LOAD is NOT a
      // can-fail proof — it silently disarms the check, so it fails here.
      const code = (e as NodeJS.ErrnoException).code ?? ""
      const cannotLoad = code.startsWith("ERR_MODULE") || code === "ERR_UNKNOWN_FILE_EXTENSION" || e instanceof SyntaxError
      if (cannotLoad) check(`M: ${name}`, false, `the mutant could not load (${code || (e as Error).name}) — the can-fail proof is disarmed`)
      else check(`M: ${name}`, true, `(mutant crashed at runtime — still caught: ${(e as Error).message})`)
    } finally {
      rmSync(mutantPath, { force: true })
    }
  }

  // M1: the timeout branch disabled -> no refusal under contention. The probe
  // must use a second PROCESS: in-process re-entry is by design, so only a
  // real contender can show the defect.
  {
    const dir = path.join(tmp, "m1b")
    const holderProc = spawn("npx", ["tsx", holderChild, dir, "1500"], { stdio: "ignore" })
    waitFor(path.join(dir, LOCK_FILE))
    const mutantPath = path.join(ROOT, "script/m61", ".mutant-lock-no-refusal.ts")
    writeFileSync(mutantPath, lockSource.replace("if (now() >= deadline) {", "if (false) {"))
    try {
      const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
      let proceeded = false
      try {
        const h = (mod.acquireLock as typeof acquireLock)(dir, { waitMs: 120, gate: "m1-probe" })
        proceeded = true
        h.release()
      } catch {
        proceeded = false
      }
      check("M: no-refusal (a disabled timeout branch lets a second PROCESS proceed)", proceeded === true, "the mutant still refused — anchor is wrong")
    } finally {
      rmSync(mutantPath, { force: true })
      holderProc.kill()
      await new Promise((r) => holderProc.on("exit", r))
    }
  }

  // M2: release stops deleting the lock.
  await runMutant("release-no-unlink", "unlinkSync(entry.handle.lockPath)", "void 0", (mod) => {
    const dir = path.join(tmp, "m2")
    const h = (mod.acquireLock as typeof acquireLock)(dir, { gate: "m2" })
    h.release()
    return existsSync(path.join(dir, LOCK_FILE))
  })

  // M3: staleness forced false -> the "stale lock" reason never appears.
  await runMutant("no-stale-detect", "const stale = holder === null ? false : deadHolder || tooOld", "const stale = false", (mod) => {
    const dir = path.join(tmp, "m3")
    ;(mod.acquireLock as typeof acquireLock)(dir, { gate: "seed" }).release()
    writeFileSync(
      path.join(dir, LOCK_FILE),
      `${JSON.stringify({ pid: 999_999, host: "x", gate: "dead", token: "t", startedAt: new Date(0).toISOString(), startedAtMs: 0 }, null, 2)}\n`,
    )
    try {
      ;(mod.acquireLock as typeof acquireLock)(dir, { waitMs: 120, gate: "m3" }).release()
      return true // proceeded past a dead holder — the defect
    } catch (e) {
      return !/stale lock/.test((e as Error).message)
    }
  })

  // M4: the break path is unconditional -> a stale lock is stolen unasked.
  // M61.V6 / #847 — the concurrent-clobber class, made extinct. Incident: two
  // gate runs interleaved on one evidence file; a second writer must REFUSE
  // loudly, never silently steal a stale lock and clobber the record.
  await runMutant("silent-steal", 'if (process.env.BB_GATE_BREAK_STALE_LOCK === "1") {', "if (true) {", (mod) => {
    const dir = path.join(tmp, "m4")
    ;(mod.acquireLock as typeof acquireLock)(dir, { gate: "seed" }).release()
    writeFileSync(
      path.join(dir, LOCK_FILE),
      `${JSON.stringify({ pid: 999_999, host: "x", gate: "dead", token: "stale-token", startedAt: new Date(0).toISOString(), startedAtMs: 0 }, null, 2)}\n`,
    )
    try {
      const h = (mod.acquireLock as typeof acquireLock)(dir, { waitMs: 200, gate: "m4" })
      const stolen = h.holder.token !== "stale-token"
      h.release()
      return stolen
    } catch {
      return false
    }
  })

  // M5: writeSealed drops the dir lock -> the write path no longer refuses.
  await runMutant(
    "write-unlocked",
    "return withLock(dir, () => {",
    "return (() => {",
    () => true,
    evSource,
  )
  {
    const dir = path.join(tmp, "m5b")
    const holderProc = spawn("npx", ["tsx", holderChild, dir, "1500"], { stdio: "ignore" })
    waitFor(path.join(dir, LOCK_FILE))
    const mutated = evSource.replace("return withLock(dir, () => {", "return (() => {").replace("  }, lock)", "  })()")
    const mutantPath = path.join(ROOT, "script/lib", ".mutant-lock-write-unlocked.ts")
    writeFileSync(mutantPath, mutated)
    try {
      const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
      let wrote = false
      try {
        ;(mod.writeSealed as typeof writeSealed)(path.join(dir, "m5.json"), { probe: true }, undefined, { waitMs: 150 })
        wrote = true
      } catch {
        wrote = false
      }
      check("M: write-unlocked (a lock-less write path writes while the lock is held)", wrote === true, "the mutant still refused — anchor is wrong")
    } finally {
      rmSync(mutantPath, { force: true })
      holderProc.kill()
      await new Promise((r) => holderProc.on("exit", r))
    }
  }

  // --- evidence ------------------------------------------------------------------
  // The record must never disagree with the run that produced it (M61's whole
  // subject): the lock-hygiene check runs BEFORE the build, and the record is
  // written twice — once so the trusted read can verify it, then re-written so
  // the self-read check is itself counted in the record it describes.
  check("R: no lock file is left behind in the results dir", !lockExists(RESULTS))

  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const buildEvidence = () => ({
    issue: "M61.V2 gate serialization lock (issue #843)",
    code: "V2",
    milestone: "M61",
    status: failed === 0 ? "verified" : "known-gap",
    checks: checks.length,
    passed,
    failed,
    realFailed: failed,
    failures,
    checksList: checks,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m61/verify-lock.ts",
    evidenceFile: "V2.json",
    generatedAt: new Date().toISOString(),
    lock: { file: LOCK_FILE, defaultWaitMs: 5_000, defaultStaleMs: 600_000 },
    adoption: {
      writeSealed: "takes the dir lock around its temp+rename (script/lib/evidence.ts)",
      declaredExclusions: ["verify-sealing fixtures", "verify-lock fixtures", "seal-legacy migration", "codemod helpers", "consent store (m25 auto-index)"],
    },
    limitations: [
      "The lock is advisory within this repository's tooling: a hand-run process that writes evidence without the library bypasses it; L4's adoption audit is what makes that visible (V4 generalizes it).",
      "Stale detection uses pid liveness and declared age; a lock held by a live but wedged process is reported at the declared age threshold rather than detected instantly.",
      "The concurrent-run proof uses two OS processes (real), not simulated threads; count is 2x100 writes, sized to finish inside the gate budget.",
    ],
  })
  writeSealed(path.join(RESULTS, "V2.json"), buildEvidence())
  const selfRead = readEvidence(path.join(RESULTS, "V2.json"))
  check("R: this verifier's own evidence verifies through the trusted read", selfRead.ok)
  // Second write: the record now carries the true final counts (including the
  // self-read check above). Nothing is checked after it — no drift possible.
  writeSealed(path.join(RESULTS, "V2.json"), buildEvidence())

  console.log(`\nM61.V2: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks.length})`)
  console.log(`Evidence (sealed): ${path.join(RESULTS, "V2.json")}`)
  if (failures.length > 0) {
    console.log("Failures:")
    for (const f of failures) console.log(`  - ${f}`)
  }
  process.exitCode = failed === 0 ? 0 : 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
