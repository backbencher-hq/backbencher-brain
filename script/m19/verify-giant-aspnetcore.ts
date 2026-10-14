// script/m19/verify-giant-aspnetcore.ts — M19.S2.
//
// Verifies both repositories named by the S2 issue. Counts and inventory are
// derived at verification time. The timing ledger must use the current
// giant-slice schema; positive legacy durations alone are not sufficient.
// CAN FAIL; no auto-pass.

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import path from "node:path"
import { cpus, totalmem } from "node:os"
import { execFileSync } from "node:child_process"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { hasValidExtension, shouldSkipCli } from "../../src/ast/parallel-indexer"

let checks = 0, passed = 0, failed = 0
function ck(label: string, cond: boolean, detail?: string) {
  checks++
  if (cond) passed++
  else { failed++; console.log("  FAIL: " + label + (detail ? " - " + detail : "")) }
}

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m19/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

const REPO = "$HOME/aspnetcore"
const PAPERCLIP = "$HOME/paperclip"
const S2_EXT = /\.(cs|fs|vb|cshtml|razor)$/
const PAPERCLIP_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const MACHINE = {
  platform: process.platform,
  arch: process.arch,
  cpu: (cpus() || []).slice(0, 2).map((c) => c.model.trim()).join(" | "),
  ramGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
}

function repoState(repo: string): { head: string | null; dirtyFiles: number | null } {
  try {
    const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    const status = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" })
    return { head, dirtyFiles: status.split("\\n").filter(Boolean).length }
  } catch {
    return { head: null, dirtyFiles: null }
  }
}

function walk(dir: string, extRe: RegExp, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if ([".git", "node_modules", "obj", "bin", "testData", ".idea"].includes(entry.name)) continue
    if (entry.isDirectory()) walk(p, extRe, acc)
    else if (entry.isFile() && extRe.test(entry.name)) acc.push(p)
  }
  return acc
}

async function main() {
  console.log("-- S2 giant aspnetcore + paperclip index verification --")
  ck("S2: aspnetcore repo exists", existsSync(REPO), REPO)
  ck("S2: paperclip repo exists", existsSync(PAPERCLIP), PAPERCLIP)

  const aspCandidates = walk(REPO, S2_EXT)
  const aspEligible = aspCandidates.filter((file) => !shouldSkipCli(file) && hasValidExtension(file))
  const aspState = repoState(REPO)
  const paperState = repoState(PAPERCLIP)
  ck("S2: aspnetcore Git state is recorded", !!aspState.head && aspState.dirtyFiles !== null, JSON.stringify(aspState))
  ck("S2: paperclip Git state is recorded", !!paperState.head && paperState.dirtyFiles !== null, JSON.stringify(paperState))
  const pid = getProjectId(REPO)
  const raw = await BrainDatabase.getRawInstance(pid)
  const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid) as any).c
  const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(pid) as any).c
  const rels = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(pid) as any).c
  const langs = raw.prepare("SELECT language l, COUNT(*) c FROM brain_file WHERE project_id=? GROUP BY language").all(pid) as Array<{ l: string; c: number }>

  ck("S2: index is giant-scale (symbols >= 100k)", symbols >= 100000, "symbols=" + symbols)
  ck("S2: index is giant-scale (files >= 5k)", files >= 5000, "files=" + files)
  ck("S2: relationships resolved (>= 100k)", rels >= 100000, "rels=" + rels)

  const knownSymbols: Array<{ name: string; file: string; kind: string }> = [
    { name: "WebApplicationBuilder", file: "src/DefaultBuilder/src/WebApplicationBuilder.cs", kind: "class" },
    { name: "IHostBuilder", file: "src/Shared/test/testassets/MockHostTypes/IHostBuilder.cs", kind: "interface" },
    { name: "Startup", file: "src/DefaultBuilder/samples/SampleApp/Startup.cs", kind: "class" },
    { name: "HttpContext", file: "src/Shared/Debugger/HttpContextDebugFormatter.cs", kind: "class" },
  ]
  for (const k of knownSymbols) {
    const hit = raw.prepare("SELECT s.name, s.symbol_type, f.relative_path FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id=? AND s.name=? LIMIT 1").get(pid, k.name) as any
    ck("S2: known symbol " + k.name + " resolves in the giant index", !!hit, hit ? hit.relative_path + " (" + hit.symbol_type + ")" : "missing")
  }

  const timingPath = path.join(RESULTS_DIR, "S2-timings.json")
  const timing = existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, "utf8")) : null
  const timingRows = Array.isArray(timing?.slices) ? timing.slices : []
  const rowIndexes = timingRows.map((r: any) => r.slice).sort((a: number, b: number) => a - b)
  const hasCurrentSchema = timingRows.length === 4 && timingRows.every((r: any) =>
    Number.isInteger(r.slice) && r.slice >= 0 && r.slice < 4 &&
    typeof r.candidateFiles === "number" && r.candidateFiles > 0 &&
    typeof r.eligibleFiles === "number" && r.eligibleFiles > 0 &&
    typeof r.wallMs === "number" && r.wallMs > 0 &&
    Array.isArray(r.batches) && r.batches.length > 0 &&
    r.batches.every((b: any) => Number.isInteger(b.files) && b.files > 0 &&
      b.successFiles + b.skippedFiles + b.timeoutFiles + b.errorFiles === b.files),
  )
  const timingOutcomesClean = hasCurrentSchema && timingRows.every((r: any) =>
    r.batches.every((b: any) => b.timeoutFiles === 0 && b.errorFiles === 0),
  )
  const peakRssMeasured = hasCurrentSchema && timingRows.every((r: any) => typeof r.peakRssKb === "number" && r.peakRssKb > 0)
  const timingInventoryMatches = hasCurrentSchema &&
    rowIndexes.join(",") === "0,1,2,3" &&
    timingRows.reduce((n: number, r: any) => n + r.candidateFiles, 0) === aspCandidates.length &&
    timingRows.reduce((n: number, r: any) => n + r.eligibleFiles, 0) === aspEligible.length &&
    timingRows.every((r: any) => r.batches.reduce((n: number, b: any) => n + b.files, 0) === r.eligibleFiles) &&
    timingRows.every((r: any) => r.deferredFinalization === true) &&
    timingOutcomesClean
  ck("S2: current four-slice timing ledger matches runtime inventory and clean outcomes", timingInventoryMatches,
    timing ? JSON.stringify({ hasCurrentSchema, candidateFiles: aspCandidates.length, eligibleFiles: aspEligible.length, recorded: timingRows.map((r: any) => ({ slice: r.slice, candidateFiles: r.candidateFiles, eligibleFiles: r.eligibleFiles })) }) : "missing " + timingPath)
  ck("S2: peak RSS is measured for every ASP.NET slice", peakRssMeasured, timing ? "peakRssKb is absent from one or more timing rows" : "missing timing")

  const paperCandidates = walk(PAPERCLIP, PAPERCLIP_EXT)
  const paperEligible = paperCandidates.filter((file) => !shouldSkipCli(file) && hasValidExtension(file))
  const paperclipPid = getProjectId(PAPERCLIP)
  const paperclipDb = await BrainDatabase.getRawInstance(paperclipPid)
  const paperclipFiles = (paperclipDb.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(paperclipPid) as any).c
  const paperclipSymbols = (paperclipDb.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(paperclipPid) as any).c
  const paperclipRels = (paperclipDb.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?").get(paperclipPid) as any).c
  const paperclipTimingPath = path.join(RESULTS_DIR, "S2-paperclip-timings.json")
  const paperclipTiming = existsSync(paperclipTimingPath) ? JSON.parse(readFileSync(paperclipTimingPath, "utf8")) : null
  const paperclipRow = Array.isArray(paperclipTiming?.slices) && paperclipTiming.slices.length === 1 ? paperclipTiming.slices[0] : null
  const paperclipComplete = !!paperclipRow && paperclipRow.candidateFiles === paperCandidates.length &&
    paperclipRow.eligibleFiles === paperEligible.length && paperclipRow.filesInSlice === paperclipFiles &&
    paperclipRow.batches?.length === 1 && paperclipRow.batches[0].files === paperEligible.length &&
    paperclipRow.batches[0].successFiles === paperclipFiles && paperclipRow.batches[0].skippedFiles === 0 &&
    paperclipRow.batches[0].timeoutFiles === 0 && paperclipRow.batches[0].errorFiles === 0 && paperclipRow.wallMs > 0
  const paperclipFull = paperclipComplete && paperclipRow.deferredFinalization === false &&
    typeof paperclipRow.peakRssKb === "number" && paperclipRow.peakRssKb > 0 &&
    typeof paperclipRow.externalPeakRssKb === "number" && paperclipRow.externalPeakRssKb > 0
  ck("S2: paperclip is indexed for the two-repository scope", paperclipFiles > 0, "indexedFiles=" + paperclipFiles)
  ck("S2: paperclip has a complete measured ingestion record", paperclipComplete, paperclipTiming ? JSON.stringify(paperclipRow) : "missing timing")
  ck("S2: full-finalization timing and external RSS are evidenced", paperclipFull, paperclipTiming ? JSON.stringify(paperclipRow) : "missing full-finalization timing")
  const fullFinalizationMeasured = paperclipFull || (hasCurrentSchema && timingRows.some((r: any) => r.deferredFinalization === false))
  ck("S2: at least one full-finalization timing run is evidenced", fullFinalizationMeasured, paperclipTiming ? "all timing rows used deferred finalization" : "missing timing")

  const measured = {
    repo: "aspnetcore",
    path: REPO,
    candidateFilesOnDisk: aspCandidates.length,
    eligibleFilesOnDisk: aspEligible.length,
    files,
    symbols,
    rels,
    timing: timingInventoryMatches ? timing : null,
    peakRssKb: peakRssMeasured ? timingRows.map((r: any) => r.peakRssKb) : null,
    fullFinalizationMeasured,
    timingErrors: timingRows.flatMap((r: any) => r.errors || r.batches.flatMap((b: any) => b.errors || [])),
    paperclip: {
      repo: "paperclip",
      path: PAPERCLIP,
      candidateFilesOnDisk: paperCandidates.length,
      eligibleFilesOnDisk: paperEligible.length,
      indexedFiles: paperclipFiles,
      symbols: paperclipSymbols,
      rels: paperclipRels,
      timing: paperclipComplete ? paperclipTiming : null,
    },
    languages: langs,
    machine: MACHINE,
    repositories: {
      aspnetcore: { head: aspState.head, dirtyFiles: aspState.dirtyFiles },
      paperclip: { head: paperState.head, dirtyFiles: paperState.dirtyFiles },
    },
    note: "aspnetcore and paperclip inventories are derived at verify time; deferred-finalization ingestion timings exclude heavy relationship enrichment, taint, gravity, and health",
  }

  const e = {
    issue: "M19.S2", code: "S2", tool: "indexing pipeline (giant corpus)",
    title: "index aspnetcore and paperclip source subsets - explicit finalization scope + time/memory",
    verified: failed === 0, checks, passed, failed,
    measured,
    negatives: [
      "A completed index does not prove analyzer AST correctness (M14 lane).",
      "The aspnetcore timing rows are rejected unless they include the current runtime inventory, per-batch outcomes, and zero timeout/error outcomes; legacy positive durations or partial failures are not promoted to proof.",
      "Deferred-finalization timing excludes heavy relationship enrichment, taint, gravity, and health; no full end-to-end wall-time claim is made from these rows.",
      "Peak RSS is required for ASP.NET slices; the separate Paperclip full-finalization control records both runner and /usr/bin/time RSS, but it does not substitute for missing ASP.NET slice RSS.",
      "The DB lives in the local brain store for each project; counts are read at verify time, not hardcoded.",
    ],
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(path.join(RESULTS_DIR, "S2.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("S2: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()
