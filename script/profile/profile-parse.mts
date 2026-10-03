// script/profile/profile-parse.mts — the indexer's OWN phase timings: discovery,
// worker startup, parse, store flush, final accounting.
//
//   npx tsx script/profile/profile-parse.mts [--mode incremental|full] [--post]
//
// WHY THIS EXISTS SEPARATELY. The 1h 4m question has two halves. This script
// measures the parse half, which `indexProjectParallel` already reports in
// `stats.phases`; profile-post.mts measures the derived half, which is where the
// time actually is. Separating them is the point: the run being investigated
// parsed 352 files out of 7,220 and still took an hour, so the parse numbers
// here are the ones that must be shown to be small.
//
// It runs INCREMENTAL by default and with `--skip-post-processing` unless
// `--post` is passed, so it measures the parse half without re-running the
// derived pass (which is ~an hour and is profile-post.mts's job).
//
// SAFETY: it runs against an ISOLATED data dir seeded with a copy of the real
// index, so nothing in the user's ~/.bb is written.

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ROOT, stageCorpus, freeMiB } from "./lib.ts"

const argv = process.argv.slice(2)
const has = (k: string) => argv.includes(k)
const argOf = (k: string, d: string) => {
  const i = argv.indexOf(k)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const SRC_PID = "818db37d8f54173ad1357ab24627373da2e9418c"
const REPO = "$HOME/Documents/Default Project/ishaq/backbencher-brain"

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "bb-profile-parse-"))
  process.env.BB_DATA_DIR = dataDir
  const free = freeMiB(tmpdir())
  if (Number.isFinite(free) && free < 12_000) {
    console.log(`ABORT: need ~12 GiB free, found ${free} MiB`)
    process.exitCode = 1
    return
  }
  if (has("--fresh")) {
    console.log("--fresh: starting from an EMPTY index (a full parse of the whole repo)")
  } else {
    console.log(`staging corpus ${SRC_PID} -> ${dataDir}`)
    stageCorpus(SRC_PID, dataDir)
  }

  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))

  const t0 = Date.now()
  const stats: any = await indexProjectParallel(SRC_PID as any, REPO, {
    isIncremental: !has("--fresh"),
    skipPostProcessing: !has("--post"),
    onProgress: () => {},
  })
  const wall = Date.now() - t0

  const out = {
    mode: has("--fresh") ? "full" : "incremental",
    withPost: has("--post"),
    wallMs: wall,
    totalFiles: stats.totalFiles,
    processedFiles: stats.processedFiles,
    successFiles: stats.successFiles,
    skippedFiles: stats.skippedFiles,
    errorFiles: stats.errorFiles,
    symbolsExtracted: stats.symbolsExtracted,
    phases: stats.phases ?? null,
    summary: stats.summary ?? null,
    cancelled: stats.cancelled ?? false,
  }
  writeFileSync(path.join(ROOT, "script/profile/results/parse.json"), JSON.stringify(out, null, 2))

  console.log(`\nPARSE-SIDE PHASE BREAKDOWN (${(wall / 1000).toFixed(1)}s wall, mode=${out.mode}, post=${out.withPost})`)
  console.log(`  totalFiles=${out.totalFiles} processed=${out.processedFiles} success=${out.successFiles} skipped=${out.skippedFiles} errors=${out.errorFiles}`)
  if (stats.phases) {
    const entries = Object.entries(stats.phases as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number")
      .sort((a, b) => (b[1] as number) - (a[1] as number))
    console.log(`  ${"phase".padEnd(24)}${"ms".padStart(9)}${"%".padStart(8)}`)
    for (const [k, v] of entries) {
      console.log(`  ${k.padEnd(24)}${String(v).padStart(9)}${(((v as number) / wall) * 100).toFixed(1).padStart(7)}%`)
    }
    console.log(`  ${"UNATTRIBUTED".padEnd(24)}${String(wall - entries.reduce((a, [, v]) => a + (v as number), 0)).padStart(9)}`)
  }
  if (stats.summary) console.log(`  summary: ${JSON.stringify(stats.summary)}`)
  console.log(`\nwrote ${path.join(ROOT, "script/profile/results/parse.json")}`)
}

main().catch((e) => {
  console.error("profile-parse failed:", e)
  process.exitCode = 1
})