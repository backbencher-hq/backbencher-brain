// test/indexing-lifecycle/checkpoint-durability.ts — P0: checkpoint durability.
//
// WHAT "CHECKPOINT" IS HERE. There is no separate durable checkpoint file: the
// checkpoint a resume reads is the live status JSON written by
// `writeLiveStatus` (src/ast/index-status.ts:53-61). It is written with a plain
// `writeFileSync` straight to the FINAL path — no temp file, no rename — unlike
// the index lockfile (`wx`, atomic) and unlike the repo's own evidence writer
// (script/lib/evidence.ts:159-176, temp + rename).
//
// So the durability invariant that can honestly be asserted is NOT "the file is
// never torn". It is the one that matters to a user:
//
//     a checkpoint that was not fully written must be treated as ABSENT —
//     never as corrupt-and-trusted, and never as a crash.
//
// This test kills real child processes mid-write (the child announces that it
// has written the prefix, so nothing here depends on a timer) and proves:
//
//   1. a checkpoint killed after a COMPLETE write survives and is readable;
//   2. a checkpoint killed mid-write is safe: readLiveStatus() returns
//      undefined instead of a half-parsed object, and `bb index --resume`
//      says it found no checkpoint instead of crashing or misreporting;
//   3. an empty file, garbage bytes, and syntactically-valid-but-nonsense
//      payloads are all handled without a crash;
//   4. in EVERY degraded case the resume still converges on the same end state
//      as a clean full index — a lost checkpoint costs work, never correctness.
//
// Run:  npx tsx test/indexing-lifecycle/checkpoint-durability.ts
// Env:   BB_TEST_INSERT_SYMBOL_REPAIR=1  diagnostic mode (see harness.ts)

import { writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import path from "node:path"
import {
  createSuite, isolateDataDir, installInsertSymbolRepair, printModeBanner,
  makeTsFixture, rmFixture, projectIdFor, snapshotIndex, diffSnapshots, spawnRaw,
  waitForExit, spawnCli, rawDb,
} from "./harness"

const suite = createSuite("checkpoint-durability")
isolateDataDir("ckpt")
await installInsertSymbolRepair()
printModeBanner(suite)

const { indexProjectParallel, wipeProjectData } = await import("../../src/ast/parallel-indexer")
const { readLiveStatus, writeLiveStatus, statusPath } = await import("../../src/ast/index-status")

const N = 6
const TOTAL = N + 1 // modules + package.json

/**
 * A child that reproduces a crash DURING the checkpoint write: it opens the
 * final path for writing, writes only a PREFIX of the JSON, fsyncs so the bytes
 * are really on disk, announces that, and then spins until killed. No timers,
 * no sleeps — the parent kills it only after it has said the prefix is there.
 */
function prefixWriterChild(ckPath: string, full: string, prefixLen: number): string {
  return `
import { openSync, writeSync, fsyncSync } from "node:fs"
const [ckPath, full, prefixLen] = [${JSON.stringify(ckPath)}, ${JSON.stringify(full)}, ${prefixLen}]
const fd = openSync(ckPath, "w")
writeSync(fd, full.slice(0, prefixLen))
fsyncSync(fd)
console.log("PREFIX_ON_DISK")
setInterval(() => {}, 60000)
`
}

/** A child that completes the write, then spins until killed. */
function completeWriterChild(ckPath: string, full: string): string {
  return `
import { writeFileSync } from "node:fs"
writeFileSync(${JSON.stringify(ckPath)}, ${JSON.stringify(full)})
console.log("FULL_ON_DISK")
setInterval(() => {}, 60000)
`
}

function liveStatusPayload(pid: string, processed: number, total: number): string {
  return JSON.stringify({
    projectId: pid,
    phase: "cancelled",
    processedFiles: processed,
    totalFiles: total,
    startedAt: 1_600_000_000_000,
    updatedAt: Date.now(),
  })
}

/** Half of the fixture's files are indexed; the rest are still unparsed. */
async function makeInterruptedProject(tag: string) {
  const fx = makeTsFixture(tag, N)
  const pid = await projectIdFor(fx.root)
  const firstHalf = fx.files.slice(0, N / 2)
  await indexProjectParallel(pid, fx.root, { files: firstHalf, skipPostProcessing: true })
  writeLiveStatus(pid, {
    projectId: pid,
    phase: "cancelled",
    processedFiles: firstHalf.length,
    totalFiles: TOTAL,
    startedAt: 1_600_000_000_000,
    updatedAt: Date.now(),
  })
  return { fx, pid }
}

/** The end state a correct resume must always reach, whatever the checkpoint did. */
async function cleanReference(fxRoot: string, pid: string) {
  const raw = await rawDb(pid)
  wipeProjectData(raw)
  await indexProjectParallel(pid, fxRoot, { skipPostProcessing: true })
  return snapshotIndex(pid, fxRoot)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("1. a checkpoint killed AFTER a complete write survives")
// ─────────────────────────────────────────────────────────────────────────────
{
  const { fx, pid } = await makeInterruptedProject("ckpt-complete")
  const ckPath = statusPath(pid)
  const full = liveStatusPayload(pid, N / 2, TOTAL)

  const child = await spawnRaw(completeWriterChild(ckPath, full), { marker: "FULL_ON_DISK" })
  child.child.kill("SIGKILL")
  await waitForExit(child.child)

  const ck = readLiveStatus(pid)
  suite.check(
    "a fully-written checkpoint survives SIGKILL of its writer",
    !!ck && ck.phase === "cancelled" && ck.processedFiles === N / 2 && ck.totalFiles === TOTAL,
    JSON.stringify(ck),
  )

  const resume = await spawnCli(["index", fx.root, "--resume", "--no-setup"], { cwd: fx.root })
  suite.check("resume after a durable checkpoint exits 0", resume.code === 0, resume.stderr.slice(-400))
  suite.check(
    "resume after a durable checkpoint REPORTS the checkpoint it used",
    resume.stdout.includes("resuming interrupted index (checkpoint: 3/7 files done)"),
    resume.stdout.split("\n").filter((l) => l.includes("checkpoint")).join(" | ").slice(0, 200),
  )
  rmFixture(fx.root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("2. a checkpoint killed MID-WRITE is safe (torn file, never trusted)")
// ─────────────────────────────────────────────────────────────────────────────
{
  const { fx, pid } = await makeInterruptedProject("ckpt-torn")
  const ckPath = statusPath(pid)
  const full = liveStatusPayload(pid, N / 2, TOTAL)
  const cut = Math.floor(full.length / 2)

  const child = await spawnRaw(prefixWriterChild(ckPath, full, cut), { marker: "PREFIX_ON_DISK" })
  child.child.kill("SIGKILL")
  await waitForExit(child.child)

  // The precondition of the whole section: the file really is torn.
  const onDisk = readFileSync(ckPath, "utf8")
  suite.check(
    `the checkpoint on disk is genuinely torn (${onDisk.length} of ${full.length} bytes)`,
    onDisk.length === cut && onDisk.length < full.length,
    `onDisk=${onDisk.length} full=${full.length}`,
  )

  const ck = readLiveStatus(pid)
  suite.check("readLiveStatus() treats a torn checkpoint as ABSENT (undefined, never a partial object)", ck === undefined, JSON.stringify(ck))

  const resume = await spawnCli(["index", fx.root, "--resume", "--no-setup"], { cwd: fx.root })
  suite.check("`bb index --resume` with a torn checkpoint exits 0 (never a crash)", resume.code === 0, `exit=${resume.code}\n${resume.stderr.slice(-500)}`)
  suite.check(
    "`bb index --resume` with a torn checkpoint says no checkpoint was found",
    resume.stdout.includes("no in-progress checkpoint"),
    resume.stdout.split("\n").filter((l) => l.includes("checkpoint")).join(" | ").slice(0, 200),
  )

  const stored = (await rawDb(pid)).prepare("SELECT COUNT(*) c FROM brain_file").get() as any
  suite.check("the resume still indexed the whole fixture despite the torn checkpoint", stored.c === TOTAL, `stored=${stored.c}`)

  const afterTorn = await snapshotIndex(pid, fx.root)
  const ref = await cleanReference(fx.root, pid)
  const diff = diffSnapshots(ref, afterTorn, "clean-full", "torn-checkpoint-resume")
  suite.check("END STATE: a torn checkpoint costs work, never correctness", diff.length === 0, diff.slice(0, 3).join(" || "))
  rmFixture(fx.root)
}

/**
 * The decision `bb index --resume` makes about a checkpoint, restated here so
 * the test can check the CLI's VERDICT against the checkpoint it was handed
 * rather than against a hand-written expectation. Mirrors src/cli/index.ts:225-238.
 */
function expectedResumeVerdict(ck: unknown): "resume" | "none" {
  const c = ck as any
  const inProgress =
    !!c && (c.phase === "indexing" || c.phase === "cancelled") && Date.now() - c.updatedAt < 3_600_000
  return inProgress ? "resume" : "none"
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("3. other torn-write shapes a crash can leave behind")
// ─────────────────────────────────────────────────────────────────────────────
{
  const cases: Array<{ label: string; bytes: Buffer | string }> = [
    { label: "empty file (0 bytes)", bytes: "" },
    { label: "a single byte", bytes: "{" },
    { label: "half a string value", bytes: '{"projectId":"abc","phase":"canc' },
    { label: "trailing garbage after valid JSON", bytes: '{"phase":"cancelled","processedFiles":3,"totalFiles":7}{"junk"' },
    { label: "valid JSON, wrong type (null)", bytes: "null" },
    { label: "valid JSON, an array", bytes: "[]" },
    { label: "valid JSON object, nonsense counters", bytes: '{"phase":"indexing","processedFiles":"lots","totalFiles":null,"updatedAt":"soon"}' },
    { label: "binary junk", bytes: Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x80]) },
  ]

  const fx = makeTsFixture("ckpt-shapes", N)
  const pid = await projectIdFor(fx.root)
  await indexProjectParallel(pid, fx.root, { files: fx.files.slice(0, N / 2), skipPostProcessing: true })
  const ckPath = statusPath(pid)
  const ref = await cleanReference(fx.root, pid)

  for (const c of cases) {
    writeFileSync(ckPath, c.bytes)
    let threw = ""
    let ck: unknown
    try { ck = readLiveStatus(pid) } catch (e: any) { threw = String(e?.message) }
    suite.check(
      `checkpoint shaped as ${c.label}: readLiveStatus() does not throw`,
      threw === "",
      threw,
    )

    const want = expectedResumeVerdict(ck)
    const resume = await spawnCli(["index", fx.root, "--resume", "--no-setup"], { cwd: fx.root })
    suite.check(
      `checkpoint shaped as ${c.label}: \`bb index --resume\` still exits 0`,
      resume.code === 0,
      `exit=${resume.code}\n${resume.stderr.slice(-300)}`,
    )
    // The verdict must match the checkpoint the CLI actually read — a torn
    // checkpoint must never be reported as a resumable one, and a usable one
    // must never be silently ignored.
    const said = resume.stdout.includes("resuming interrupted index")
      ? "resume"
      : resume.stdout.includes("no in-progress checkpoint")
        ? "none"
        : "silent"
    suite.check(
      `checkpoint shaped as ${c.label}: the CLI's verdict matches the checkpoint (${want})`,
      said === want,
      `checkpoint=${JSON.stringify(ck)} cli="${said}"`,
    )

    const snap = await snapshotIndex(pid, fx.root)
    const diff = diffSnapshots(ref, snap, "clean-full", `resume-after-${c.label}`)
    suite.check(
      `checkpoint shaped as ${c.label}: the resumed index still equals a clean full index`,
      diff.length === 0,
      diff.slice(0, 2).join(" || "),
    )
  }
  rmFixture(fx.root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("4. the checkpoint path is created, and its directory is real")
// ─────────────────────────────────────────────────────────────────────────────
{
  const { fx, pid } = await makeInterruptedProject("ckpt-dir")
  const p = statusPath(pid)
  suite.check(
    "the checkpoint lives under <BB_DATA_DIR>/status/<projectId>.json",
    p === path.join(process.env.BB_DATA_DIR!, "status", `${pid}.json`),
    p,
  )
  suite.check("the checkpoint's directory exists on disk", existsSync(path.dirname(p)), path.dirname(p))

  // A checkpoint written for a project whose status dir was deleted must be
  // recreated, not silently dropped.
  rmSync(path.dirname(p), { recursive: true, force: true })
  writeLiveStatus(pid, {
    projectId: pid, phase: "indexing", processedFiles: 1, totalFiles: 7,
    startedAt: Date.now(), updatedAt: Date.now(),
  })
  suite.check("writeLiveStatus recreates a deleted status directory", readLiveStatus(pid)?.phase === "indexing", JSON.stringify(readLiveStatus(pid)))

  // writeLiveStatus must never throw, even when its path is unwritable — an
  // indexer crash because a status file could not be written would be the worst
  // possible trade. Make the parent "directory" a FILE so mkdir/write both fail.
  rmSync(path.dirname(p), { recursive: true, force: true })
  writeFileSync(path.dirname(p), "this is a file, not a directory")
  let threw = ""
  try {
    writeLiveStatus(pid, {
      projectId: pid, phase: "indexing", processedFiles: 1, totalFiles: 7,
      startedAt: Date.now(), updatedAt: Date.now(),
    })
  } catch (e: any) { threw = String(e?.message) }
  suite.negative("writeLiveStatus() swallows write failures (observability must never crash the indexer)", threw === "", threw)
  rmSync(path.dirname(p), { force: true })
  rmFixture(fx.root)
}

suite.finish()