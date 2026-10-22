/**
 * ruby-perf — RUBY'S PERF, MEASURED (the D5 item this lane had declared unmeasured).
 *
 * WHY THIS EXISTS. The D1–D6 statement carried "perf NOT MEASURED (declared)" as an open item. A
 * declared-unmeasured item is an honest hole; this instrument is the measurement that closes it.
 *
 * WHAT IT MEASURES, AND WHAT IT DOES NOT. It measures the wall-clock cost of the Ruby analyzer over
 * the ADMITTED POPULATION, through the PRODUCTION entry (`src/ast/pool-worker.parseFile` — the same
 * call the ARM and the gate make), and it reports throughput, the per-file latency distribution, and
 * the SLOWEST FILES with their sizes. It does NOT claim anything about the analyzer's asymptotics
 * beyond the population it measured, and it does not compare against another language's analyzer —
 * a cross-language comparison is a different instrument and a different claim.
 *
 * THE NUMBER IS A MEASUREMENT, NOT A TARGET. There is no threshold here: a slow analyzer is not a
 * defect, and a fast one is not a pass. The value is that the number is now ON THE RECORD with the
 * population, the root, the command and the instrument that produced it, so a later reader can
 * compare a change against it rather than against an impression.
 *
 * THE WARM/COLD SPLIT IS REPORTED SEPARATELY, because a parser cache is part of the cost: the FIRST
 * pass includes the wasm load and the parser construction, and a measurement that hid that inside a
 * mean would understate the cold cost and overstate the steady-state one.
 *
 * USAGE
 *   export BB_CORPUS_ROOT=$PWD/.corpus
 *   bun run script/m14/ruby-perf.ts            # human-readable
 *   bun run script/m14/ruby-perf.ts --json     # machine-readable
 *
 * EXIT: 0 printed · 2 environment (no corpus / no files).
 */
import { readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const SIZE_CAP = 1024 * 1024
const EXTS = ["rb"]
const JSON_OUT = process.argv.includes("--json")

function admitByExtension(rel: string): boolean {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  return dot >= 0 && EXTS.includes(base.slice(dot + 1))
}

function discover(): { files: string[]; repos: number; absent: number; overCap: number; bytes: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let absent = 0
  let overCap = 0
  let bytes = 0
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], repos: 0, absent: 0, overCap: 0, bytes: 0 } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admitByExtension(rel)) continue
      const abs = path.join(dir, rel)
      try {
        const st = statSync(abs)
        if (st.size > SIZE_CAP) { overCap++; continue }
        bytes += st.size
      } catch { absent++; continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, repos: repos.size, absent, overCap, bytes }
}

const { files, repos, absent, overCap, bytes } = discover()
if (files.length === 0) {
  console.error(`ruby-perf: 0 admitted .rb files under ${CR}. Set BB_CORPUS_ROOT.`)
  process.exit(2)
}

const { parseFile } = await import("../../src/ast/pool-worker")

// ── THE COLD PASS: the first pass pays the wasm load and the parser construction ─────────────────
const coldStart = process.hrtime.bigint()
let coldEdges = 0
let coldFiles = 0
let coldFailed = 0
const coldLatencies: Array<{ file: string; ms: number; bytes: number }> = []
for (const abs of files) {
  const repoRoot = path.join(CR, abs.slice((CR + path.sep).length).split(path.sep)[0])
  const t0 = process.hrtime.bigint()
  let r: any
  try { r = await parseFile(abs, repoRoot) } catch { coldFailed++; continue }
  const t1 = process.hrtime.bigint()
  coldFiles++
  coldEdges += (r?.relationships ?? []).length
  coldLatencies.push({ file: path.relative(CR, abs), ms: Number(t1 - t0) / 1e6, bytes: statSync(abs).size })
}
const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6

// ── THE WARM PASS: the parser is cached, so this is the steady-state cost ────────────────────────
const warmStart = process.hrtime.bigint()
let warmEdges = 0
let warmFiles = 0
let warmFailed = 0
for (const abs of files) {
  const repoRoot = path.join(CR, abs.slice((CR + path.sep).length).split(path.sep)[0])
  try {
    const r: any = await parseFile(abs, repoRoot)
    warmFiles++
    warmEdges += (r?.relationships ?? []).length
  } catch { warmFailed++ }
}
const warmMs = Number(process.hrtime.bigint() - warmStart) / 1e6

// ── THE DISTRIBUTION ──────────────────────────────────────────────────────────────────────────────
const sorted = [...coldLatencies].sort((a, b) => a.ms - b.ms)
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]?.ms ?? 0
const p50 = pct(50), p90 = pct(90), p99 = pct(99)
const slowest = [...coldLatencies].sort((a, b) => b.ms - a.ms).slice(0, 10)

const report = {
  population: {
    corpusRoot: CR,
    admitted: files.length,
    repos,
    absent,
    overCap,
    exts: EXTS,
    sizeCapBytes: SIZE_CAP,
    totalBytes: bytes,
  },
  cold: {
    note: "the FIRST pass over the population — it pays the wasm load and the parser construction",
    files: coldFiles,
    failed: coldFailed,
    edges: coldEdges,
    totalMs: coldMs,
    msPerFile: coldFiles ? coldMs / coldFiles : 0,
    filesPerSecond: coldMs > 0 ? (coldFiles / coldMs) * 1000 : 0,
    megabytesPerSecond: coldMs > 0 ? bytes / 1e6 / (coldMs / 1000) : 0,
  },
  warm: {
    note: "the SECOND pass over the same population — the parser is cached, so this is the steady-state cost",
    files: warmFiles,
    failed: warmFailed,
    edges: warmEdges,
    totalMs: warmMs,
    msPerFile: warmFiles ? warmMs / warmFiles : 0,
    filesPerSecond: warmMs > 0 ? (warmFiles / warmMs) * 1000 : 0,
    megabytesPerSecond: warmMs > 0 ? bytes / 1e6 / (warmMs / 1000) : 0,
  },
  latencyDistribution: {
    note: "per-file wall clock, COLD pass, milliseconds",
    p50, p90, p99,
    min: sorted[0]?.ms ?? 0,
    max: sorted[sorted.length - 1]?.ms ?? 0,
  },
  slowestFiles: slowest,
  instrument:
    "script/m14/ruby-perf.ts — src/ast/pool-worker.parseFile over the admitted .rb population, cold pass then warm pass, hrtime.bigint per file",
  claim:
    "A MEASUREMENT, NOT A TARGET. There is no threshold: a slow analyzer is not a defect and a fast one is not a pass. The number is on the record with its population, root, command and instrument so a later change can be compared against it.",
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 1))
} else {
  console.log("ruby-perf — RUBY'S PERF, MEASURED over the ADMITTED population")
  console.log(`population: ${report.population.admitted} admitted .rb across ${repos} repos · ${(bytes / 1e6).toFixed(1)} MB · absent ${absent} · overCap ${overCap} · corpus ${CR}`)
  console.log("")
  console.log(`COLD  (wasm load + parser construction): ${coldFiles} files in ${coldMs.toFixed(0)} ms`)
  console.log(`      ${(coldMs / Math.max(1, coldFiles)).toFixed(2)} ms/file · ${((coldFiles / coldMs) * 1000).toFixed(1)} files/s · ${(bytes / 1e6 / (coldMs / 1000)).toFixed(2)} MB/s · ${coldEdges} edges · ${coldFailed} failed`)
  console.log(`WARM  (parser cached — steady state):     ${warmFiles} files in ${warmMs.toFixed(0)} ms`)
  console.log(`      ${(warmMs / Math.max(1, warmFiles)).toFixed(2)} ms/file · ${((warmFiles / warmMs) * 1000).toFixed(1)} files/s · ${(bytes / 1e6 / (warmMs / 1000)).toFixed(2)} MB/s · ${warmEdges} edges · ${warmFailed} failed`)
  console.log("")
  console.log(`PER-FILE LATENCY (cold): p50 ${p50.toFixed(1)} ms · p90 ${p90.toFixed(1)} ms · p99 ${p99.toFixed(1)} ms · max ${(sorted[sorted.length - 1]?.ms ?? 0).toFixed(1)} ms`)
  console.log("")
  console.log("SLOWEST FILES:")
  for (const s of slowest) console.log(`  ${s.ms.toFixed(1).padStart(8)} ms  ${String(s.bytes).padStart(8)} B  ${s.file}`)
  console.log("")
  console.log("CLAIM: a measurement, not a target — no threshold is asserted, and no cross-language comparison is claimed.")
}
