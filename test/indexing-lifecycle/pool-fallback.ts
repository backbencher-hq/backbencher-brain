// test/indexing-lifecycle/pool-fallback.ts — P1: worker-pool loss must degrade loudly.
//
// When the worker pool cannot be forked the indexer is supposed to fall back to
// in-process parsing (parallel-indexer.ts:4534-4579). That fallback is a
// correctness-preserving degradation, but it is also a big performance
// regression (~7x on the repo's own measurements) and it happens SILENTLY on the
// surface that matters: the run still exits 0 and every count still reads
// healthy. So the contract this file pins is:
//
//   1. indexing still SUCCEEDS in-process (correctness is not lost), and
//   2. the degradation is REPORTED — with a cause, and with a remediation the
//      user can act on. Never silently.
//
// HOW "tsx IS UNAVAILABLE" IS SIMULATED. `resolvePoolWorkerFork`
// (parallel-indexer.ts:1208-1231) decides this from three facts about the module
// it is called from: it is not under dist/, process.execPath is node, and
// neither <repoRoot>/node_modules/.bin/tsx nor `tsx` on PATH exists. None of
// those can be changed for an in-repo test without mutating state shared by
// every worktree, so the fallback is exercised from a SHADOW copy of src/ that
// has a node_modules containing every package except .bin, and a PATH with no
// tsx on it (see buildShadowRepoWithoutTsx / TSX_FREE_PATH in harness.ts).
//
// Run:  npx tsx test/indexing-lifecycle/pool-fallback.ts
// Env:   BB_TEST_INSERT_SYMBOL_REPAIR=1  diagnostic mode (see harness.ts)

import path from "node:path"
import {
  createSuite, isolateDataDir, installInsertSymbolRepair, printModeBanner,
  makeTsFixture, rmFixture, projectIdFor, snapshotIndex, diffSnapshots, spawnRaw,
  buildShadowRepoWithoutTsx, TSX_FREE_PATH, rawDb, REPO_ROOT,
} from "./harness"

const suite = createSuite("pool-fallback")
isolateDataDir("pool")
await installInsertSymbolRepair()
printModeBanner(suite)

const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")

const N = 6

/** The script the shadow repo runs: prove the fallback, then index. */
function shadowRunner(fixtureRoot: string): string {
  return `
import { writeFileSync } from "node:fs"
const shadow = process.env.BB_SHADOW_ROOT
if (!shadow) { console.log("POOL_FALLBACK_NO_SHADOW"); process.exit(2) }
// The diagnostic shim (see harness.ts) has to be installed HERE too: this run
// imports the shadow copy of the indexer, so the parent's shim is not in scope.
const { installInsertSymbolRepair } = await import(${JSON.stringify(path.join(REPO_ROOT, "test/indexing-lifecycle/harness.ts"))})
await installInsertSymbolRepair()
const { indexProjectParallel } = await import(shadow + "/src/ast/parallel-indexer.ts")
const { getProjectId } = await import(shadow + "/src/cli/index.ts")
const { BrainDatabase } = await import(shadow + "/src/brain/database.ts")

const pid = getProjectId(${JSON.stringify(fixtureRoot)})
const stats = await indexProjectParallel(pid, ${JSON.stringify(fixtureRoot)}, { skipPostProcessing: true })

// Machine-readable verdict on ONE line, so the parent never has to parse prose.
const db = await BrainDatabase.getRawInstance(pid)
const one = (sql, ...params) => (db.prepare(sql).get(...params) ?? {}).c ?? 0
writeFileSync(${JSON.stringify(path.join(process.env.BB_DATA_DIR!, "pool-fallback-result.json"))}, JSON.stringify({
  projectId: pid,
  parseMode: stats.summary?.parseMode ?? null,
  phasesMode: stats.phases?.mode ?? null,
  totalCandidates: stats.summary?.totalCandidates ?? null,
  newlyParsed: stats.summary?.newlyParsed ?? null,
  unchanged: stats.summary?.unchanged ?? null,
  symbolLoss: stats.summary?.symbolLoss ?? null,
  errors: stats.summary?.errors ?? null,
  timeouts: stats.summary?.timeouts ?? null,
  symbolsExtracted: stats.symbolsExtracted,
  workerCount: stats.phases?.workerCount ?? null,
  files: one("SELECT COUNT(*) c FROM brain_file WHERE project_id = ?", pid),
  symbols: one("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?", pid),
  relationships: one("SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?", pid),
  stdout: "",
}))
console.log("POOL_FALLBACK_DONE")
`
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("0. control: with tsx available the pool IS used")
// ─────────────────────────────────────────────────────────────────────────────
{
  const fx = makeTsFixture("pool-control", N)
  const pid = await projectIdFor(fx.root)
  const stats = await indexProjectParallel(pid, fx.root, { skipPostProcessing: true })
  suite.check(
    "a normal run uses the worker pool",
    stats.summary?.parseMode === "worker-pool",
    `parseMode=${stats.summary?.parseMode}`,
  )
  suite.check("a normal run reports the workers it used", (stats.phases?.workerCount ?? 0) > 0, `workerCount=${stats.phases?.workerCount}`)
  suite.negative(
    "a normal run does not claim an in-process parse",
    stats.summary?.parseMode !== "in-process",
    `parseMode=${stats.summary?.parseMode}`,
  )
  rmFixture(fx.root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("1. with tsx unavailable: indexing still succeeds in-process")
// ─────────────────────────────────────────────────────────────────────────────
let fallbackResult: any = null
{
  const fx = makeTsFixture("pool-fallback", N)
  const shadow = buildShadowRepoWithoutTsx()

  const child = await spawnRaw(shadowRunner(fx.root), {
    marker: "POOL_FALLBACK_DONE",
    markerTimeoutMs: 180_000,
    env: {
      // No tsx anywhere on PATH: `npx tsx` normally puts node_modules/.bin here,
      // and findOnPath("tsx") would otherwise still find it
      PATH: TSX_FREE_PATH,
      BB_TEST_INSERT_SYMBOL_REPAIR: process.env.BB_TEST_INSERT_SYMBOL_REPAIR ?? "",
      BB_SHADOW_ROOT: shadow,
    },
  })

  const { readFileSync, existsSync } = await import("node:fs")
  const resultPath = path.join(process.env.BB_DATA_DIR!, "pool-fallback-result.json")
  if (existsSync(resultPath)) fallbackResult = JSON.parse(readFileSync(resultPath, "utf8"))
  else child.child.kill("SIGKILL")

  suite.check("the shadow-repo run completed", fallbackResult !== null, child.output().slice(-600))
  if (fallbackResult) {
    const r = fallbackResult
    suite.check("the run fell back to in-process parsing", r.parseMode === "in-process", JSON.stringify({ parseMode: r.parseMode, phasesMode: r.phasesMode }))
    suite.check(
      "every fixture file was still indexed",
      r.newlyParsed === N + 1 && r.files === N + 1,
      JSON.stringify({ newlyParsed: r.newlyParsed, files: r.files }),
    )
    suite.check("symbols were still stored", r.symbols > 0, `symbols=${r.symbols}`)
    suite.check("relationships were still stored", r.relationships > 0, `relationships=${r.relationships}`)
    suite.check("the fallback reported no parse errors", r.errors === 0 && r.timeouts === 0, JSON.stringify({ errors: r.errors, timeouts: r.timeouts }))
    suite.check("the fallback lost no symbols (symbolLoss 0)", r.symbolLoss === 0, `symbolLoss=${r.symbolLoss}`)
    suite.negative(
      "the fallback does not claim the worker pool ran",
      r.phasesMode !== "worker-pool",
      `phasesMode=${r.phasesMode}`,
    )

    // END STATE: the in-process result must equal the pool result. This is the
    // property that makes the fallback safe at all.
    const shadowPid = r.projectId
    const shadowSnap = await snapshotIndex(shadowPid, fx.root)
    const poolFx = makeTsFixture("pool-reference", N)
    const poolPid = await projectIdFor(poolFx.root)
    await indexProjectParallel(poolPid, poolFx.root, { skipPostProcessing: true })
    const poolSnap = await snapshotIndex(poolPid, poolFx.root)
    const diff = diffSnapshots(poolSnap, shadowSnap, "worker-pool", "in-process-fallback")
    suite.check(
      "END STATE: the in-process fallback's index equals the worker pool's index",
      diff.length === 0,
      diff.slice(0, 3).join(" || "),
    )
    suite.check(
      "both paths wrote to the SAME project db (the shim, not a second store, produced this)",
      ((await rawDb(shadowPid)).prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c === N + 1,
      "",
    )
    rmFixture(poolFx.root)
  }
  rmFixture(fx.root)
}

// ─────────────────────────────────────────────────────────────────────────────
suite.section("2. the degradation is REPORTED — cause and remediation, never silent")
// ─────────────────────────────────────────────────────────────────────────────
if (fallbackResult) {
  const fx = makeTsFixture("pool-report", N)
  const shadow = buildShadowRepoWithoutTsx()
  const resultPath = path.join(process.env.BB_DATA_DIR!, "pool-report-result.json")

  // Same shadow run, but this time capture everything the user would SEE: the
  // indexer's own progress output plus the persisted performance_stats row that
  // `bb status` and health read.
  const child = await spawnRaw(
    shadowRunner(fx.root).replace(
      path.join(process.env.BB_DATA_DIR!, "pool-fallback-result.json"),
      resultPath,
    ),
    {
      marker: "POOL_FALLBACK_DONE",
      markerTimeoutMs: 180_000,
      env: { PATH: TSX_FREE_PATH, BB_TEST_INSERT_SYMBOL_REPAIR: process.env.BB_TEST_INSERT_SYMBOL_REPAIR ?? "", BB_SHADOW_ROOT: shadow },
    },
  )
  const out = child.output()
  const { readFileSync, existsSync } = await import("node:fs")
  const r = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null

  suite.check("the reporting run completed", r !== null, out.slice(-400))

  // CAUSE. Something must say the worker pool was unavailable and why.
  const saidUnavailable = /worker pool unavailable/i.test(out)
  suite.check("the run SAYS the worker pool was unavailable (never silent)", saidUnavailable, out.split("\n").filter((l) => /pool/i.test(l)).join(" | ").slice(0, 300))
  suite.check(
    "the report gives a CAUSE, not just a fact",
    /worker pool unavailable \([^)]+\)/.test(out) || /no tsx binary found/i.test(out),
    out.split("\n").filter((l) => /pool unavailable|tsx/i.test(l)).join(" | ").slice(0, 300),
  )
  suite.negative(
    "the run never claims the worker pool was used",
    !/using parallel indexing/.test(out),
    out.split("\n").filter((l) => /parallel indexing/.test(l)).join(" | ").slice(0, 200),
  )

  // REMEDIATION. This is the half the product does not do today: the message
  // explains that the run was slower but never says what to do about it. The
  // repo does this elsewhere — `derived: deferred — run: bb index --post`
  // (src/cli/index.ts:351) — so the standard exists; the pool line does not
  // meet it.
  const remediation =
    /(npm|pnpm|yarn|bun)\s+(i|install|add)[^\n]*(tsx|devDependencies)/i.test(out) ||
    /(re-)?install[^\n]*tsx/i.test(out) ||
    /use the (compiled|published|installed) (build|binary|bb)/i.test(out) ||
    /bb index --[a-z]+/i.test(out)
  suite.check(
    "the report gives a REMEDIATION the user can act on",
    remediation,
    `no actionable step in the output; pool lines were: ${out.split("\n").filter((l) => /pool|parse/i.test(l)).join(" | ").slice(0, 300)}`,
  )

  // PERSISTED, not just printed: the degradation must survive the run so
  // `bb status` / health can see a project that keeps falling back.
  suite.check(
    "the degradation is persisted in the run's performance_stats (visible to `bb status`)",
    r?.phasesMode === "in-process",
    JSON.stringify({ phasesMode: r?.phasesMode }),
  )
  rmFixture(fx.root)
} else {
  suite.check("the degradation report could be evaluated", false, "the shadow-repo fallback run produced no result")
}

suite.finish()