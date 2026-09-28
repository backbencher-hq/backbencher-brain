// script/m19/giant-slice.ts - M19 S2/S3 bounded giant-repo slice runner.
// Indexes deterministic source slices into the real project database and
// persists machine-readable timing summaries. --batch-index makes a logical
// slice resumable when one process invocation would exceed the broker limit.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "path"
import { hasValidExtension, indexProjectParallel, ParallelIndexerConfig, shouldSkipCli } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"

function walk(dir: string, extRe: RegExp, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if ([".git", "node_modules", "obj", "bin", "testData", ".idea"].includes(entry.name)) continue
    if (entry.isDirectory()) walk(p, extRe, acc)
    else if (entry.isFile() && extRe.test(entry.name)) acc.push(p)
  }
  return acc
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf("--" + name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const repo = process.argv[2]
if (!repo || !existsSync(repo)) {
  console.error("repo missing")
  process.exit(2)
}

const dry = process.argv.includes("--dry")
const deferFinalization = process.argv.includes("--defer-finalization")
const ext = arg("ext") || "cs|fs|vb|cshtml|razor"
const sliceIdx = Number.parseInt(arg("slice") || "0", 10)
const total = positiveInt(arg("total"), 1)
const batchSize = positiveInt(arg("batch-size"), 1000)
const offset = positiveInt(arg("offset"), 0) - 1
const limitArg = arg("limit")
const limit = limitArg === undefined ? undefined : positiveInt(limitArg, 1)
const workersArg = arg("workers")
const workers = workersArg === undefined ? undefined : positiveInt(workersArg, 1)
if (workers !== undefined) ParallelIndexerConfig.concurrency = workers
const onlyBatchArg = arg("batch-index")
const onlyBatch = onlyBatchArg === undefined ? undefined : Number.parseInt(onlyBatchArg, 10)
const timingFile = arg("timing-file")
const candidates = walk(repo, new RegExp("\\.(" + ext + ")$"))
const chunk = Math.ceil(candidates.length / total)
const sliceCandidates = candidates.slice(sliceIdx * chunk, (sliceIdx + 1) * chunk)
const eligibleSliceFiles = sliceCandidates.filter((file) => !shouldSkipCli(file) && hasValidExtension(file))
const sliceFiles = eligibleSliceFiles.slice(offset < 0 ? 0 : offset, limit === undefined ? undefined : (offset < 0 ? 0 : offset) + limit)
const batchFiles = Array.from({ length: Math.ceil(sliceFiles.length / batchSize) }, (_, batch) =>
  sliceFiles.slice(batch * batchSize, (batch + 1) * batchSize),
)

if (onlyBatch !== undefined && (!Number.isInteger(onlyBatch) || onlyBatch < 0 || onlyBatch >= batchFiles.length)) {
  console.error("batch-index out of range", onlyBatch, "batchCount", batchFiles.length)
  process.exit(2)
}

console.log(
  "total candidates:", candidates.length,
  "| slice", sliceIdx, "of", total,
  "| candidatesInSlice:", sliceCandidates.length,
  "| eligibleFiles:", sliceFiles.length,
  "| offset:", offset < 0 ? 0 : offset,
  "| batches:", batchFiles.length,
  workers === undefined ? "" : "| workers:" + workers,
  onlyBatch === undefined ? "" : "| selectedBatch:" + onlyBatch,
)
if (dry) {
  console.log(JSON.stringify({
    ok: true,
    dry: true,
    totalCandidates: candidates.length,
    slice: sliceIdx,
    totalSlices: total,
    candidatesInSlice: sliceCandidates.length,
    filesInSlice: sliceFiles.length,
    eligibleFilesBeforeOffset: eligibleSliceFiles.length,
    offset: offset < 0 ? 0 : offset,
    batchSize,
    batches: batchFiles.length,
    workers,
    sample: sliceFiles.slice(0, 3),
  }))
  process.exit(0)
}

const selectedBatches = onlyBatch === undefined
  ? batchFiles.map((files, batch) => ({ files, batch }))
  : [{ files: batchFiles[onlyBatch], batch: onlyBatch }]
const pid = getProjectId(repo)
const t0 = Date.now()
const measuredBatches: Array<{
  batch: number
  files: number
  wallMs: number
  successFiles: number
  skippedFiles: number
  timeoutFiles: number
  errorFiles: number
  peakRssKb: number
  errors: Array<{ file: string; error: string }>
}> = []

process.env.BB_EMBEDDING_BATCH_LIMIT = "1"
try {
  for (const selected of selectedBatches) {
    const batchStart = Date.now()
    const stats = await indexProjectParallel(pid, repo, {
      files: selected.files,
      skipDiscovery: true,
      skipPostProcessing: deferFinalization,
    })
    const outcomeTotal = stats.successFiles + stats.skippedFiles + stats.timeoutFiles + stats.errorFiles
    if (outcomeTotal !== selected.files.length) {
      throw new Error(`batch ${selected.batch} outcome invariant failed: ${outcomeTotal} outcomes for ${selected.files.length} input files`)
    }
    measuredBatches.push({
      batch: selected.batch,
      files: selected.files.length,
      wallMs: Date.now() - batchStart,
      successFiles: stats.successFiles,
      skippedFiles: stats.skippedFiles,
      timeoutFiles: stats.timeoutFiles,
      errorFiles: stats.errorFiles,
      peakRssKb: Number((process as any).resourceUsage?.().maxRSS || 0),
      errors: stats.errors.slice(),
    })
  }
} finally {
  delete process.env.BB_EMBEDDING_BATCH_LIMIT
}

const wallMs = Date.now() - t0
const raw = await BrainDatabase.getRawInstance(pid)
const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid) as any).c
const rels = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(pid) as any).c
const summary = {
  ok: true,
  slice: sliceIdx,
  totalSlices: total,
  candidateFiles: sliceCandidates.length,
  eligibleFiles: sliceFiles.length,
  eligibleFilesBeforeOffset: eligibleSliceFiles.length,
  offset: offset < 0 ? 0 : offset,
  filesInSlice: sliceFiles.length,
  batchSize,
  batchCount: batchFiles.length,
  batchIndex: onlyBatch,
  workers,
  batches: measuredBatches,
  wallMs,
  wallSec: Math.round(wallMs / 1000),
  deferredFinalization: deferFinalization,
  totalSymbols: symbols,
  totalRels: rels,
  peakRssKb: Number((process as any).resourceUsage?.().maxRSS || 0),
  errors: measuredBatches.flatMap((batch) => batch.errors),
}

if (timingFile) {
  const prior = existsSync(timingFile)
    ? JSON.parse(readFileSync(timingFile, "utf8"))
    : { repo, totalSlices: total, machine: { platform: process.platform, arch: process.arch }, slices: [], partialBatches: [] }
  const partials = Array.isArray(prior.partialBatches) ? prior.partialBatches : []
  let slices = Array.isArray(prior.slices) ? prior.slices : []
  if (onlyBatch === undefined) {
    slices = slices.filter((row: any) => row.slice !== sliceIdx)
    slices.push(summary)
  } else {
    const retained = partials.filter((row: any) => !(row.slice === sliceIdx && row.batchIndex === onlyBatch))
    retained.push({ ...summary, batchIndex: onlyBatch })
    const complete = retained.filter((row: any) => row.slice === sliceIdx).length === batchFiles.length
    if (complete) {
      const rows = retained.filter((row: any) => row.slice === sliceIdx).sort((a: any, b: any) => a.batchIndex - b.batchIndex)
      const allBatches = rows.flatMap((row: any) => row.batches || [])
      const aggregate = {
        ...rows[0],
        batchIndex: undefined,
        batches: allBatches,
        wallMs: allBatches.reduce((n: number, row: any) => n + row.wallMs, 0),
        wallSec: Math.round(allBatches.reduce((n: number, row: any) => n + row.wallMs, 0) / 1000),
        batchCount: batchFiles.length,
      }
      slices = slices.filter((row: any) => row.slice !== sliceIdx)
      slices.push(aggregate)
      prior.partialBatches = retained.filter((row: any) => row.slice !== sliceIdx)
    } else {
      prior.partialBatches = retained
    }
  }
  slices.sort((a: any, b: any) => a.slice - b.slice)
  writeFileSync(timingFile, JSON.stringify({ ...prior, repo, totalSlices: total, slices }, null, 2) + "\n")
}

console.log(JSON.stringify(summary))
process.exit(0)
