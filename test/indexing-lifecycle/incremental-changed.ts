// test/indexing-lifecycle/incremental-changed.ts — P1: incremental correctness.
//
// `bb index --changed` promises: only the files that changed are re-parsed, and
// the index afterwards reflects the CURRENT on-disk content with no trace of the
// content it replaced. Nothing on this branch asserts the second half — the
// existing incremental gate (script/m22/verify-d1-d2-incremental.ts) proves the
// COUNT (one edit → one file) and that a new symbol is queryable, but not that
// the old file's symbols and relationships were actually removed, and not that
// the incremental result equals a full rebuild.
//
// What is asserted here:
//
//   1. exactly the edited files are re-parsed (per file, via the sentinel — not
//      just via a count),
//   2. the new content is in the index and the old content is GONE (symbols and
//      relationships),
//   3. END STATE: after `--changed`, the index equals a clean full index of the
//      current on-disk tree,
//   4. a deletion is purged on `--changed` (no ghost rows),
//   5. an unchanged `--changed` run parses nothing,
//   6. the real `bb index --changed` CLI reports the same breakdown.
//
// Run:  npx tsx test/indexing-lifecycle/incremental-changed.ts
// Env:   BB_TEST_INSERT_SYMBOL_REPAIR=1  diagnostic mode (see harness.ts)

import { writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import {
  createSuite, isolateDataDir, installInsertSymbolRepair, printModeBanner,
  makeTsFixture, moduleSource, setMtime, CHANGED_MTIME, rmFixture, projectIdFor,
  snapshotIndex, diffSnapshots, markFiles, reparsedFiles, spawnCli, rawDb,
} from "./harness"

const suite = createSuite("incremental-changed")
isolateDataDir("incremental")
await installInsertSymbolRepair()
printModeBanner(suite)

const { indexProjectParallel, wipeProjectData } = await import("../../src/ast/parallel-indexer")

const N = 12
const TOTAL = N + 1 // modules + package.json
/** Generation marker each edit introduces, so "old content" is nameable. */
const gen = (i: number, v: string) => `modGen${i}_${v}`

/** Reference: a clean full index of whatever is on disk right now. */
async function cleanRebuild(fxRoot: string, pid: string) {
  const raw = await rawDb(pid)
  wipeProjectData(raw)
  await indexProjectParallel(pid, fxRoot, { skipPostProcessing: true })
  return snapshotIndex(pid, fxRoot)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("1. an unchanged `--changed` run is a no-op")
// ─────────────────────────────────────────────────────────────────────────────
const fx = makeTsFixture("incremental", N)
const pid = await projectIdFor(fx.root)
await indexProjectParallel(pid, fx.root, { skipPostProcessing: true })
{
  const { marked } = await markFiles(pid, fx.files.concat([fx.manifest]))
  suite.check(`every indexed file could be sentinel-marked (${marked}/${TOTAL})`, marked === TOTAL)
  const noop = await indexProjectParallel(pid, fx.root, { isIncremental: true, skipPostProcessing: true })
  const s = noop.summary!
  suite.check("an unchanged `--changed` run parses 0 files", s.newlyParsed === 0, JSON.stringify(s))
  suite.check("an unchanged `--changed` run reports every file unchanged", s.unchanged === TOTAL, JSON.stringify(s))
  suite.negative(
    "an unchanged `--changed` run re-parses nothing (sentinel rows untouched)",
    (await reparsedFiles(pid, fx.files.concat([fx.manifest]))).length === 0,
    `re-parsed: ${(await reparsedFiles(pid, fx.files)).map((p) => path.basename(p)).join(",")}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("2. change exactly 2 files, run `--changed`")
// ─────────────────────────────────────────────────────────────────────────────
const edited = [fx.files[3], fx.files[9]]
const allPaths = fx.files.concat([fx.manifest])
await markFiles(pid, allPaths)

writeFileSync(edited[0], moduleSource(3, "v2")); setMtime(edited[0], CHANGED_MTIME)
writeFileSync(edited[1], moduleSource(9, "v2")); setMtime(edited[1], CHANGED_MTIME)

const inc = await indexProjectParallel(pid, fx.root, { isIncremental: true, skipPostProcessing: true })
const is = inc.summary!
suite.check("`--changed` parses exactly the 2 edited files", is.newlyParsed === 2, JSON.stringify(is))
suite.check("`--changed` reports the other files unchanged", is.unchanged === TOTAL - 2, JSON.stringify(is))

const reparsed = await reparsedFiles(pid, allPaths)
suite.check(
  "per file: `--changed` re-parsed the 2 edited files and nothing else",
  reparsed.length === 2 && edited.every((e) => reparsed.includes(e)),
  `re-parsed=${reparsed.map((p) => path.basename(p)).join(",")}`,
)

const afterEdit = await snapshotIndex(pid, fx.root)
suite.check(
  "the new symbols are in the index",
  afterEdit.symbols.some((x) => x.includes(gen(3, "v2"))) && afterEdit.symbols.some((x) => x.includes(gen(9, "v2"))),
  `v2 present=${afterEdit.symbols.filter((x) => x.includes("_v2")).length}`,
)
suite.check(
  "NO stale symbols from the replaced content remain",
  !afterEdit.symbols.some((x) => x.includes(gen(3, "v1"))) && !afterEdit.symbols.some((x) => x.includes(gen(9, "v1"))),
  `v1 leftovers=${afterEdit.symbols.filter((x) => x.includes(gen(3, "v1")) || x.includes(gen(9, "v1"))).join(" | ")}`,
)
suite.check(
  "NO stale relationships from the replaced content remain",
  !afterEdit.relationships.some((r) => r.includes(gen(3, "v1"))) && !afterEdit.relationships.some((r) => r.includes(gen(9, "v1"))),
  `v1 rel leftovers=${afterEdit.relationships.filter((r) => r.includes(gen(3, "v1")) || r.includes(gen(9, "v1"))).join(" | ")}`,
)
suite.check(
  "the edited files' symbol sets are complete after `--changed` (>= 4 declared symbols each)",
  [3, 9].every((i) => afterEdit.symbols.filter((x) => x.startsWith(`src/mod${i}.ts:`)).length >= 4),
  `mod3=${afterEdit.symbols.filter((x) => x.startsWith("src/mod3.ts:")).length} mod9=${afterEdit.symbols.filter((x) => x.startsWith("src/mod9.ts:")).length}`,
)

const refAfterEdit = await cleanRebuild(fx.root, pid)
const incDiff = diffSnapshots(refAfterEdit, afterEdit, "clean-full", "incremental")
suite.check(
  "END STATE: after `--changed` the index equals a clean full index of the current tree",
  incDiff.length === 0,
  incDiff.slice(0, 3).join(" || "),
)

// ─────────────────────────────────────────────────────────────────────────────
suite.section("3. a file deleted from disk is purged by `--changed`")
// ─────────────────────────────────────────────────────────────────────────────
{
  const victim = fx.files[7]
  rmSync(victim, { force: true })
  await markFiles(pid, allPaths)
  const del = await indexProjectParallel(pid, fx.root, { isIncremental: true })
  suite.check("`--changed` after a deletion still parses nothing (nothing changed on disk)", del.summary?.newlyParsed === 0, JSON.stringify(del.summary))
  const db = await rawDb(pid)
  const ghost = db.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id = ? AND path = ?").get(pid, victim) as any
  suite.check("the deleted file's brain_file row is purged (no ghost file row)", ghost.c === 0, `rows=${ghost.c}`)
  const ghostSyms = db.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND id LIKE ?").get(pid, `${pid}:src/mod7.ts:%`) as any
  suite.check("the deleted file's symbols are purged too", ghostSyms.c === 0, `rows=${ghostSyms.c}`)
  const refAfterDelete = await cleanRebuild(fx.root, pid)
  const snapAfterDelete = await snapshotIndex(pid, fx.root)
  const delDiff = diffSnapshots(refAfterDelete, snapAfterDelete, "clean-full", "incremental-after-delete")
  suite.check("END STATE: the index equals a clean full index after a deletion", delDiff.length === 0, delDiff.slice(0, 3).join(" || "))
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("4. an edit that only ADDS a file is picked up")
// ─────────────────────────────────────────────────────────────────────────────
{
  const { writeFileSync: wf } = await import("node:fs")
  const added = path.join(fx.root, "src", "mod99.ts")
  wf(added, moduleSource(99, "v1")); setMtime(added, CHANGED_MTIME)
  const inc = await indexProjectParallel(pid, fx.root, { isIncremental: true, skipPostProcessing: true })
  suite.check("`--changed` parses exactly the 1 new file", inc.summary?.newlyParsed === 1, JSON.stringify(inc.summary))
  const snap = await snapshotIndex(pid, fx.root)
  suite.check("the new file's symbols are in the index", snap.symbols.some((x) => x.includes("modFns99")), "")
  const ref = await cleanRebuild(fx.root, pid)
  const diff = diffSnapshots(ref, snap, "clean-full", "incremental-after-add")
  suite.check("END STATE: the index equals a clean full index after an addition", diff.length === 0, diff.slice(0, 3).join(" || "))
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("5. the shipped `bb index --changed` CLI agrees")
// ─────────────────────────────────────────────────────────────────────────────
{
  // Start from a clean state in a FRESH fixture so the CLI run is the only
  // writer of its DB.
  const cliFx = makeTsFixture("incremental-cli", N)
  const first = await spawnCli(["index", cliFx.root, "--no-setup"], { cwd: cliFx.root })
  suite.check("a clean `bb index` of the CLI fixture exits 0", first.code === 0, first.stderr.slice(-400))

  writeFileSync(cliFx.files[2], moduleSource(2, "v2")); setMtime(cliFx.files[2], CHANGED_MTIME)
  writeFileSync(cliFx.files[6], moduleSource(6, "v2")); setMtime(cliFx.files[6], CHANGED_MTIME)

  const changed = await spawnCli(["index", cliFx.root, "--changed", "--no-setup"], { cwd: cliFx.root })
  suite.check("`bb index --changed` exits 0", changed.code === 0, changed.stderr.slice(-400))
  suite.check(
    "`bb index --changed` reports 2 newly parsed and the rest unchanged",
    /breakdown: 2 newly parsed \| \d+ unchanged \| 0 skipped \| 0 symbol-loss/.test(changed.stdout),
    changed.stdout.split("\n").filter((l) => l.includes("breakdown")).join(" | ").slice(0, 220),
  )
  suite.check(
    "`bb index --changed` says which derived pass ran",
    /derived: bounded \(/.test(changed.stdout),
    changed.stdout.split("\n").filter((l) => l.includes("derived")).join(" | ").slice(0, 220),
  )

  const cliPid = await projectIdFor(cliFx.root)
  const cliSnap = await snapshotIndex(cliPid, cliFx.root)
  suite.check(
    "`bb index --changed` stored the new content",
    cliSnap.symbols.some((x) => x.includes(gen(2, "v2"))) && cliSnap.symbols.some((x) => x.includes(gen(6, "v2"))),
    "",
  )
  suite.check(
    "`bb index --changed` left no stale content behind",
    !cliSnap.symbols.some((x) => x.includes(gen(2, "v1"))) && !cliSnap.symbols.some((x) => x.includes(gen(6, "v1"))),
    cliSnap.symbols.filter((x) => x.includes(gen(2, "v1")) || x.includes(gen(6, "v1"))).join(" | "),
  )

  // Negative: `--changed` twice in a row must not keep re-parsing.
  const again = await spawnCli(["index", cliFx.root, "--changed", "--no-setup"], { cwd: cliFx.root })
  suite.negative(
    "a second `--changed` with no further edits parses 0 files",
    /breakdown: 0 newly parsed \| \d+ unchanged/.test(again.stdout),
    again.stdout.split("\n").filter((l) => l.includes("breakdown")).join(" | ").slice(0, 220),
  )
  rmFixture(cliFx.root)
}

rmFixture(fx.root)
suite.finish()