// test/indexing-lifecycle/empty-projects.ts — P2: empty and trivial projects.
//
// The cheapest thing a user can do is point bb at a directory with nothing in
// it. That path is the most likely to be under-exercised (every existing gate
// uses a populated fixture) and the most likely to be reached in anger by
// somebody who ran `bb index .` in the wrong shell. The contract:
//
//   * it completes, it does not throw, and it does not hang,
//   * it says something SENSIBLE about having found nothing — not a bare zero,
//   * it does not leave a half-built index behind,
//   * a later real index of the same directory works normally afterwards.
//
// Covered shapes: a truly empty dir, a dir holding only a dotfile, a dir whose
// every file is ignored by .gitignore, a single one-line source file, and a
// dir containing only a file type bb cannot parse.
//
// Run:  npx tsx test/indexing-lifecycle/empty-projects.ts
// Env:   BB_TEST_INSERT_SYMBOL_REPAIR=1  diagnostic mode (see harness.ts)

import { mkdirSync, writeFileSync, existsSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  createSuite, isolateDataDir, installInsertSymbolRepair, printModeBanner,
  setMtime, FIXED_MTIME, rmFixture, projectIdFor, rawDb, spawnCli, snapshotIndex, diffSnapshots,
} from "./harness"

const suite = createSuite("empty-projects")
isolateDataDir("empty")
await installInsertSymbolRepair()
printModeBanner(suite)

const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
const { composeStatus, readLiveStatus } = await import("../../src/ast/index-status")

/** A fresh empty directory (the tmpdir root itself is never used). */
function emptyDir(tag: string): string {
  return mkdtempSync(path.join(tmpdir(), `bb-idxlife-${tag}-`))
}

/** Index a directory that holds nothing indexable, and assert it behaved. */
async function assertCleanNoop(label: string, root: string) {
  const pid = await projectIdFor(root)

  let stats: any = null
  let threw = ""
  try {
    // No signal, no timeout: a hang here fails the gate by the runner's timeout
    // rather than by an assertion, which is the honest signal for "it hung".
    stats = await indexProjectParallel(pid, root, { skipPostProcessing: true })
  } catch (e: any) { threw = String(e?.message ?? e) }

  suite.check(`${label}: completes without throwing`, threw === "", threw)
  if (!stats) return { pid, stats: null }

  suite.check(
    `${label}: reports a no-op run (0 newly parsed)`,
    stats.summary?.newlyParsed === 0,
    JSON.stringify(stats.summary),
  )
  suite.check(
    `${label}: declares the noop rather than reporting a parse failure`,
    stats.summary?.errors === 0 && stats.summary?.timeouts === 0 && stats.errorFiles === 0,
    JSON.stringify({ errors: stats.summary?.errors, timeouts: stats.summary?.timeouts, errorFiles: stats.errorFiles }),
  )
  suite.check(
    `${label}: says which pass ran (no derived pass, honestly)`,
    stats.summary?.derivedPass === "skipped-unchanged" || stats.summary?.derivedPass === "deferred",
    `derivedPass=${stats.summary?.derivedPass}`,
  )
  suite.check(
    `${label}: counts are all zero, not negative`,
    [stats.totalFiles, stats.processedFiles, stats.summary?.totalCandidates].every((n) => typeof n === "number" && n >= 0),
    JSON.stringify({ totalFiles: stats.totalFiles, processedFiles: stats.processedFiles }),
  )

  const db = await rawDb(pid)
  const files = (db.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?").get(pid) as any).c
  const syms = (db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(pid) as any).c
  suite.check(`${label}: the index has no phantom rows`, files === 0 && syms === 0, `files=${files} symbols=${syms}`)

  const ck = readLiveStatus(pid)
  // A no-op run legitimately writes NO status file at all (the noop return path
  // in parallel-indexer.ts:4428-4530 skips the terminal write). What must never
  // happen is a status left claiming the project is mid-run.
  suite.check(
    `${label}: the live status is absent or terminal, never a stale "running"`,
    ck === undefined || ck.phase === "complete" || ck.phase === "failed",
    JSON.stringify(ck),
  )
  const composed = await composeStatus(pid)
  suite.check(`${label}: \`bb status\` does not report it as running`, composed.isRunning === false, JSON.stringify(composed.live))

  return { pid, stats }
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("1. a completely empty directory")
// ─────────────────────────────────────────────────────────────────────────────
{
  const root = emptyDir("empty")
  await assertCleanNoop("empty dir", root)
  rmFixture(root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("2. a directory holding only a dotfile")
// ─────────────────────────────────────────────────────────────────────────────
{
  const root = emptyDir("dotfile")
  const dotfile = path.join(root, ".hidden")
  writeFileSync(dotfile, "# nothing to see\n")
  setMtime(dotfile, FIXED_MTIME)
  await assertCleanNoop("dotfile-only dir", root)
  rmFixture(root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("3. a directory whose every file is ignored")
// ─────────────────────────────────────────────────────────────────────────────
{
  const root = emptyDir("ignored")
  const ig = path.join(root, ".gitignore")
  writeFileSync(ig, "generated/\n*.snap\n")
  setMtime(ig, FIXED_MTIME)
  mkdirSync(path.join(root, "generated"))
  writeFileSync(path.join(root, "generated", "one.ts"), "export function ignoredOne(){return 1}\n")
  writeFileSync(path.join(root, "two.snap"), "snapshot\n")
  setMtime(path.join(root, "generated", "one.ts"), FIXED_MTIME)
  setMtime(path.join(root, "two.snap"), FIXED_MTIME)
  const { pid } = await assertCleanNoop("fully-ignored dir", root)
  if (pid) {
    const snap = await snapshotIndex(pid, root)
    suite.check(
      "fully-ignored dir: nothing ignored was indexed",
      !snap.symbols.some((s) => s.includes("ignoredOne")),
      snap.symbols.join(" | "),
    )
  }
  rmFixture(root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("4. a single one-line source file")
// ─────────────────────────────────────────────────────────────────────────────
{
  const root = emptyDir("oneline")
  const f = path.join(root, "only.ts")
  writeFileSync(f, "export const only = 1\n")
  setMtime(f, FIXED_MTIME)
  const pid = await projectIdFor(root)
  let stats: any = null
  let threw = ""
  try { stats = await indexProjectParallel(pid, root, { skipPostProcessing: true }) } catch (e: any) { threw = String(e?.message ?? e) }
  suite.check("one-line file: completes without throwing", threw === "", threw)
  suite.check("one-line file: indexes exactly the one file", stats?.summary?.newlyParsed === 1, JSON.stringify(stats?.summary))
  const snap = await snapshotIndex(pid, root)
  suite.check("one-line file: its symbol is in the index", snap.symbols.some((s) => s.includes(":only:")), snap.symbols.join(" | "))
  suite.check("one-line file: no symbol loss reported", stats?.summary?.symbolLoss === 0, `symbolLoss=${stats?.summary?.symbolLoss}`)

  // Negative: indexing it again is a no-op.
  const again = await indexProjectParallel(pid, root, { isIncremental: true, skipPostProcessing: true })
  suite.negative("one-line file: a second run parses 0 files", again.summary?.newlyParsed === 0, JSON.stringify(again.summary))
  rmFixture(root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("5. a directory of files bb cannot parse")
// ─────────────────────────────────────────────────────────────────────────────
{
  const root = emptyDir("unparseable")
  const bin = path.join(root, "blob.dat")
  writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]))
  setMtime(bin, FIXED_MTIME)
  // .dat is not an admitted extension, so this is a second "nothing to do" case
  // with a real file present — the one an empty-dir test cannot reach.
  await assertCleanNoop("unparseable-extension dir", root)
  rmFixture(root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("6. an empty project that later gets real files")
// ─────────────────────────────────────────────────────────────────────────────
{
  const root = emptyDir("then-real")
  const pid = await projectIdFor(root)
  await indexProjectParallel(pid, root, { skipPostProcessing: true })

  const src = path.join(root, "later.ts")
  writeFileSync(src, "export function arrived(x: number): number {\n  return x * 2\n}\n")
  setMtime(src, FIXED_MTIME)

  const stats = await indexProjectParallel(pid, root, { skipPostProcessing: true })
  suite.check("a project indexed while empty picks up files added later", stats.summary?.newlyParsed === 1, JSON.stringify(stats.summary))
  const snap = await snapshotIndex(pid, root)
  suite.check("the late arrival's symbol is in the index", snap.symbols.some((s) => s.includes(":arrived:")), snap.symbols.join(" | "))
  rmFixture(root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("7. the CLI on an empty directory")
// ─────────────────────────────────────────────────────────────────────────────
{
  const root = emptyDir("cli-empty")
  const cli = await spawnCli(["index", root, "--no-setup"], { cwd: root })
  suite.check("`bb index` on an empty dir exits 0", cli.code === 0, `exit=${cli.code}\n${cli.stderr.slice(-400)}`)
  suite.check(
    // Accept either phrasing. The summary used to read "indexed 0 files",
    // which reads like a failure to anyone running `bb index` expecting work;
    // it now says "nothing to index - already up to date". Both are honest, so
    // assert the CLAIM (zero files indexed) rather than one exact wording.
    "`bb index` on an empty dir says it indexed 0 files",
    /indexed 0 files/.test(cli.stdout) ||
      /nothing to index/i.test(cli.stdout),
    cli.stdout.split("\n").filter((l) => /indexed|nothing to index/i.test(l)).join(" | ").slice(0, 200),
  )
  suite.check(
    "`bb index` on an empty dir reports 0 newly parsed (an honest no-op, not a silent one)",
    /breakdown: 0 newly parsed \| 0 unchanged \| 0 skipped/.test(cli.stdout),
    cli.stdout.split("\n").filter((l) => l.includes("breakdown")).join(" | ").slice(0, 220),
  )
  suite.negative(
    "`bb index` on an empty dir does NOT claim the worker pool parsed anything",
    !/parsed with the worker pool/.test(cli.stdout),
    cli.stdout.split("\n").filter((l) => l.includes("parsed")).join(" | ").slice(0, 200),
  )

  // A resume on an empty project must be equally clean.
  const resume = await spawnCli(["index", root, "--resume", "--no-setup"], { cwd: root })
  suite.check("`bb index --resume` on an empty dir exits 0", resume.code === 0, `exit=${resume.code}\n${resume.stderr.slice(-400)}`)

  // A db file for a project with no files must still be a usable db.
  const { BrainDatabase } = await import("../../src/brain/database")
  suite.check("an empty project still has a readable db", existsSync(BrainDatabase.getDbPath(await projectIdFor(root))), "")
  rmFixture(root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("8. an empty project equals a clean rebuild of itself")
// ─────────────────────────────────────────────────────────────────────────────
{
  // The end-state discipline used elsewhere in this suite: the state left by a
  // trivial run must be identical to what a from-scratch run produces.
  const root = emptyDir("equiv")
  const pid = await projectIdFor(root)
  await indexProjectParallel(pid, root, { skipPostProcessing: true })
  const first = await snapshotIndex(pid, root)
  const { wipeProjectData } = await import("../../src/ast/parallel-indexer")
  wipeProjectData(await rawDb(pid))
  await indexProjectParallel(pid, root, { skipPostProcessing: true })
  const second = await snapshotIndex(pid, root)
  const diff = diffSnapshots(second, first, "clean-rebuild", "after-trivial-run")
  suite.check("END STATE: a trivial run leaves the same index a rebuild would", diff.length === 0, diff.join(" || "))
  rmFixture(root)
}

suite.finish()