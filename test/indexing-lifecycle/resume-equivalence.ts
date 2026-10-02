// test/indexing-lifecycle/resume-equivalence.ts — P0: resume correctness.
//
// The headline assertion of the whole indexing-lifecycle suite:
//
//   an interrupted-then-resumed index must equal a clean full index of the same
//   fixture, byte for byte, over files / symbols / relationships / imports.
//
// That end-state equivalence is what a user actually experiences ("I pressed
// Ctrl+C and resumed, and now my index is wrong"), and nothing else in the repo
// asserts it: script/m22/verify-r1-resume.ts proves resume parses strictly
// fewer files, and script/m21/verify-cancel-resume.ts proves a real SIGINT
// round-trips — neither compares the two resulting indexes.
//
// Two independent paths are exercised, because they fail differently:
//
//   A. GENUINE ABORT. indexProjectParallel is given an AbortSignal and the
//      signal is raised from inside the progress callback, i.e. the run is
//      interrupted mid-flight exactly as Ctrl+C interrupts it. How many files
//      land in the store before the abort takes effect depends on how many
//      batches are in flight, so this path asserts invariants that hold for ANY
//      partial state (checkpoint coherent, resume converges, completed files not
//      re-parsed) rather than exact counts.
//
//   B. DETERMINISTIC PARTIAL STORE + REAL `bb index --resume`. The partial
//      state is produced by indexing a known subset, a real "cancelled"
//      checkpoint is written, and the RESUME IS THE SHIPPED CLI. This is the
//      launch-critical surface, and because the interrupted set is known here
//      the exact-count assertions (files not re-parsed, files parsed) can be
//      made without depending on scheduler timing.
//
// Run:  npx tsx test/indexing-lifecycle/resume-equivalence.ts
// Env:   BB_TEST_INSERT_SYMBOL_REPAIR=1  diagnostic mode (see harness.ts)

import { readFileSync } from "node:fs"
import path from "node:path"
import {
  createSuite, isolateDataDir, installInsertSymbolRepair, printModeBanner,
  makeTsFixture, moduleSource, setMtime, CHANGED_MTIME, rmFixture, projectIdFor,
  snapshotIndex, diffSnapshots, markFiles, reparsedFiles, spawnCli, rawDb, hasPath,
} from "./harness"

const suite = createSuite("resume-equivalence")
isolateDataDir("resume")
await installInsertSymbolRepair()
printModeBanner(suite)

const { indexProjectParallel, wipeProjectData } = await import("../../src/ast/parallel-indexer")
const { readLiveStatus, writeLiveStatus, statusPath } = await import("../../src/ast/index-status")

const N = 8

/**
 * Section A needs a fixture big enough that an abort can leave work genuinely
 * undone. The pool dispatches at most `concurrency` batches of 10 at a time
 * (parallel-indexer.ts:1243, config caps concurrency at 12), so a fixture with
 * more than 120 files always has at least one batch still QUEUED when the abort
 * is raised — and queued batches are exactly what a cancelled run drops
 * (parallel-indexer.ts:1718-1728). 150 guarantees that on any machine.
 */
const N_ABORT = 150

// ─────────────────────────────────────────────────────────────────────────────
suite.section("clean full index — the reference for the CLI comparison")
// ─────────────────────────────────────────────────────────────────────────────
const clean = makeTsFixture("resume-clean", N)
const cleanPid = await projectIdFor(clean.root)
const cleanStats = await indexProjectParallel(cleanPid, clean.root, { skipPostProcessing: true })

suite.check(
  `clean run indexed every fixture file (${N} modules + 1 manifest)`,
  cleanStats.summary?.totalCandidates === N + 1,
  `candidates=${cleanStats.summary?.totalCandidates}`,
)
suite.check("clean run stored symbols", cleanStats.symbolsExtracted > 0, `symbols=${cleanStats.symbolsExtracted}`)
suite.check(
  "clean run reported no parse errors",
  cleanStats.errorFiles === 0 && cleanStats.summary?.errors === 0,
  `errorFiles=${cleanStats.errorFiles}`,
)

// ─────────────────────────────────────────────────────────────────────────────
suite.section("A. genuine abort mid-run, then resume")
// ─────────────────────────────────────────────────────────────────────────────
{
  const fx = makeTsFixture("resume-abort", N_ABORT)
  const pid = await projectIdFor(fx.root)
  const controller = new AbortController()
  let progressTicks = 0
  const aborted = await indexProjectParallel(pid, fx.root, {
    skipPostProcessing: true,
    signal: controller.signal,
    onProgress: () => {
      progressTicks++
      // Raise the signal from a STATE TRANSITION (the first completed file),
      // not from a timer — nothing here depends on how fast the run is.
      controller.abort()
    },
  })

  suite.check("the run was actually interrupted (progress was observed)", progressTicks > 0, `ticks=${progressTicks}`)
  suite.check("the interrupted run reports itself cancelled", aborted.cancelled === true, `cancelled=${aborted.cancelled}`)

  // The checkpoint the resume path looks for.
  const ckPath = statusPath(pid)
  const ckRaw = hasPath(ckPath) ? readFileSync(ckPath, "utf8") : ""
  const ck = readLiveStatus(pid)
  suite.check("an interrupted run leaves a checkpoint file on disk", ckRaw.length > 0, ckPath)
  suite.check(
    "the checkpoint is parseable JSON with the 'cancelled' phase",
    !!ck && ck.phase === "cancelled",
    JSON.stringify(ck),
  )
  suite.check(
    "the checkpoint's counters are coherent (0 < processed <= total)",
    !!ck && ck.processedFiles > 0 && ck.processedFiles <= ck.totalFiles,
    JSON.stringify(ck && { processed: ck.processedFiles, total: ck.totalFiles }),
  )

  // Partial store: strictly between nothing and everything. `stored` counts
  // every indexed path (modules AND the manifest), which is exactly what the
  // indexer's `unchanged` counter means.
  const db = await rawDb(pid)
  const stored = (db.prepare("SELECT path FROM brain_file WHERE project_id = ?").all(pid) as any[]).map((r) => r.path)
  const total = N_ABORT + 1 // modules + package.json
  suite.check(
    `the interrupted run left a genuinely PARTIAL index (0 < ${stored.length} < ${total})`,
    stored.length > 0 && stored.length < total,
    `stored=${stored.length} of ${total}`,
  )

  // Mark what is already done so "was it re-parsed?" is answerable without
  // watching a clock.
  const { marked } = await markFiles(pid, stored)
  suite.check(`every already-indexed file could be sentinel-marked (${marked})`, marked === stored.length)

  // Resume: exactly what `bb index --resume` does at the library level.
  const resumed = await indexProjectParallel(pid, fx.root, { isIncremental: true, skipPostProcessing: true })
  const s = resumed.summary!
  suite.check(
    `resume parses exactly the ${total - stored.length} file(s) the interrupt left out`,
    s.newlyParsed === total - stored.length,
    JSON.stringify(s),
  )
  suite.check(
    `resume reports the ${stored.length} already-indexed file(s) unchanged`,
    s.unchanged === stored.length,
    JSON.stringify(s),
  )

  const reparsed = await reparsedFiles(pid, stored)
  suite.check(
    "resume did NOT re-parse any already-completed file",
    reparsed.length === 0,
    `re-parsed: ${reparsed.map((p) => path.basename(p)).slice(0, 8).join(",")}`,
  )

  const afterAbort = await snapshotIndex(pid, fx.root)

  // THE headline assertion: the reference is a clean full index of the SAME
  // fixture, produced by wiping the project in place (`bb index --force`'s own
  // primitive, parallel-indexer.ts:5121) and re-indexing from scratch. Nothing
  // about the resumed index is reused.
  const raw = await rawDb(pid)
  wipeProjectData(raw)
  await indexProjectParallel(pid, fx.root, { skipPostProcessing: true })
  const cleanSame = await snapshotIndex(pid, fx.root)

  const abortDiff = diffSnapshots(cleanSame, afterAbort, "clean-full", "aborted+resumed")
  suite.check(
    "END STATE: the aborted+resumed index equals a clean full index of the same fixture",
    abortDiff.length === 0,
    abortDiff.slice(0, 3).join(" || "),
  )

  // Negative: resuming an already-complete index must do nothing. (Runs against
  // the freshly-wiped clean index above, which is by construction complete.)
  const again = await indexProjectParallel(pid, fx.root, { isIncremental: true, skipPostProcessing: true })
  suite.negative(
    "resuming an already-complete run is a no-op (0 files parsed)",
    again.summary?.newlyParsed === 0,
    JSON.stringify(again.summary),
  )
  rmFixture(fx.root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("B. deterministic partial store, resumed by the real `bb index --resume`")
// ─────────────────────────────────────────────────────────────────────────────
{
  const fx = makeTsFixture("resume-cli", N)
  const pid = await projectIdFor(fx.root)
  const firstHalf = fx.files.slice(0, N / 2)
  const secondHalf = fx.files.slice(N / 2)

  await indexProjectParallel(pid, fx.root, { files: firstHalf, skipPostProcessing: true })

  // A real in-progress checkpoint, exactly what a cancelled run leaves behind.
  writeLiveStatus(pid, {
    projectId: pid,
    phase: "cancelled",
    processedFiles: firstHalf.length,
    totalFiles: fx.files.length + 1,
    startedAt: Date.now() - 30_000,
    updatedAt: Date.now(),
  })

  const { marked } = await markFiles(pid, firstHalf)
  suite.check(`the first half is indexed and sentinel-marked (${marked}/${firstHalf.length})`, marked === firstHalf.length)

  // ── the shipped CLI, in its own process ──
  const resume = await spawnCli(["index", fx.root, "--resume", "--no-setup"], { cwd: fx.root })
  suite.check("`bb index --resume` exits 0", resume.code === 0, `exit=${resume.code}\n${resume.stderr.slice(-600)}`)
  suite.check(
    "`bb index --resume` reports it found the checkpoint, with its counts",
    /resuming interrupted index \(checkpoint: \d+\/\d+ files done\)/.test(resume.stdout),
    resume.stdout.split("\n").filter((l) => l.includes("resume") || l.includes("checkpoint")).join(" | ").slice(0, 240),
  )

  const reparsed = await reparsedFiles(pid, firstHalf)
  suite.check(
    "`bb index --resume` did NOT re-parse the completed half",
    reparsed.length === 0,
    `re-parsed: ${reparsed.map((p) => path.basename(p)).join(",")}`,
  )

  const allStored = (await rawDb(pid)).prepare("SELECT path FROM brain_file WHERE project_id = ?").all(pid) as any[]
  suite.check(
    "after the resume every fixture file is in the index",
    allStored.length === N + 1,
    `stored=${allStored.length} of ${N + 1}`,
  )

  const ckAfter = readLiveStatus(pid)
  suite.check(
    "the checkpoint is finalized to 'complete' after a successful resume",
    !!ckAfter && ckAfter.phase === "complete",
    JSON.stringify(ckAfter),
  )

  // Compare against a CLEAN FULL CLI index of an identical fixture. Both sides
  // are brought to the same derived state first: the resume path runs the
  // BOUNDED incremental pass while a clean run runs the FULL pass, so the two
  // are only comparable after `bb index --post` on both. That post run is the
  // documented remediation for deferred derived data, so it is a product
  // surface, not a test-only trick.
  const postResumed = await spawnCli(["index", fx.root, "--post"], { cwd: fx.root })
  suite.check("`bb index --post` on the resumed project exits 0", postResumed.code === 0, `exit=${postResumed.code}\n${postResumed.stderr.slice(-400)}`)

  const reference = makeTsFixture("resume-cli-clean", N)
  const refPid = await projectIdFor(reference.root)
  const cleanCli = await spawnCli(["index", reference.root, "--no-setup"], { cwd: reference.root })
  suite.check("a clean `bb index` of an identical fixture exits 0", cleanCli.code === 0, `exit=${cleanCli.code}\n${cleanCli.stderr.slice(-600)}`)

  const resumedSnap = await snapshotIndex(pid, fx.root)
  const cleanSnap = await snapshotIndex(refPid, reference.root)
  const cliDiff = diffSnapshots(cleanSnap, resumedSnap, "clean-full-cli", "aborted+resumed-cli")
  suite.check(
    "END STATE (CLI): the interrupted+resumed index equals a clean full index",
    cliDiff.length === 0,
    cliDiff.join(" || "),
  )

  // Negative: with no in-progress checkpoint, `--resume` must say so rather
  // than silently pretending it resumed something.
  const noCk = await spawnCli(["index", reference.root, "--resume", "--no-setup"], { cwd: reference.root })
  suite.check(
    "`bb index --resume` with no in-progress checkpoint says so explicitly",
    noCk.stdout.includes("no in-progress checkpoint"),
    noCk.stdout.split("\n").filter((l) => l.includes("checkpoint")).join(" | ").slice(0, 200),
  )
  suite.negative(
    "`bb index --resume` with no in-progress checkpoint parses 0 files",
    /newly parsed \| (\d+) unchanged/.test(noCk.stdout) && noCk.stdout.includes("0 newly parsed"),
    noCk.stdout.split("\n").filter((l) => l.includes("breakdown")).join(" | ").slice(0, 200),
  )

  rmFixture(reference.root)
  rmFixture(fx.root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("resume after the source changed underneath it")
// ─────────────────────────────────────────────────────────────────────────────
{
  // A checkpoint is a resume *intent*, not a frozen file list: files edited
  // while the run was interrupted must be re-parsed, not skipped as "unchanged".
  const fx = makeTsFixture("resume-drift", N)
  const pid = await projectIdFor(fx.root)
  const firstHalf = fx.files.slice(0, N / 2)
  await indexProjectParallel(pid, fx.root, { files: firstHalf, skipPostProcessing: true })
  writeLiveStatus(pid, {
    projectId: pid, phase: "cancelled", processedFiles: firstHalf.length,
    totalFiles: fx.files.length, startedAt: Date.now() - 30_000, updatedAt: Date.now(),
  })
  // One file from the already-done half, and one from the not-yet-done half,
  // change on disk after the checkpoint was written.
  const editedDone = firstHalf[1]
  const editedTodo = fx.files[N - 1]
  const { writeFileSync } = await import("node:fs")
  writeFileSync(editedDone, moduleSource(1, "v2")); setMtime(editedDone, CHANGED_MTIME)
  writeFileSync(editedTodo, moduleSource(N - 1, "v3")); setMtime(editedTodo, CHANGED_MTIME)

  await markFiles(pid, [...firstHalf, ...fx.files.slice(N / 2, N - 1)])
  const resumed = await indexProjectParallel(pid, fx.root, { isIncremental: true, skipPostProcessing: true })

  const re = await reparsedFiles(pid, [editedDone, editedTodo])
  suite.check(
    "resume re-parses a file that changed after the checkpoint (already-done half)",
    re.includes(editedDone),
    `reparsed=${re.map((p) => path.basename(p)).join(",")}`,
  )
  suite.check(
    "resume re-parses a file that changed after the checkpoint (not-yet-done half)",
    re.includes(editedTodo),
    `reparsed=${re.map((p) => path.basename(p)).join(",")}`,
  )
  const driftSnap = await snapshotIndex(pid, fx.root)
  suite.check(
    "the drifted resume stored the NEW content, not the checkpoint's",
    driftSnap.symbols.some((x) => x.includes("modGen1_v2")) &&
      !driftSnap.symbols.some((x) => x.includes("modGen1_v1")) &&
      driftSnap.symbols.some((x) => x.includes(`modGen${N - 1}_v3`)),
    driftSnap.symbols.filter((x) => x.includes("modGen1_") || x.includes(`modGen${N - 1}_`)).join(" | "),
  )
  suite.check(
    "the drifted resume covers the whole fixture",
    ((await rawDb(pid)).prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c === N + 1,
    `stored=${((await rawDb(pid)).prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c}`,
  )
  rmFixture(fx.root)
}

rmFixture(clean.root)
suite.finish()