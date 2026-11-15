/**
 * Pin the SCSS lane's regression floor in `differential-baseline.json`, from a real
 * sweep log and a real measurement.
 *
 *   bun script/m14/tmp/scss-baseline-pin.ts --log <sweep.log>
 *
 * WHY A SEPARATE INSTRUMENT RATHER THAN A FLAG ON THE CSS ONE
 *
 * The CSS pin refuses to write a `perf` number measured on a busy host, and records
 * `null` with the reason. That refusal was correct at the time and the reason has since
 * been DISPROVED: a 20 ms pure-CPU burn measured 20.0 ms at loadAvg1 30, i.e. a
 * scheduler-inflation factor of 1.00, so this process gets a full core when it runs and
 * a per-file cost measured here IS comparable with one measured at load 5.
 *
 * So this pin MEASURES perf, per corpus, the way the CSS one now does — the analyzer
 * call alone, min of 5 runs — rather than inheriting either the old refusal or a number
 * pasted from a different instrument.
 *
 * IT PARSES THE LOG, IT DOES NOT TRANSCRIBE IT. A pattern that stops matching must
 * FAIL here rather than quietly write a wrong number, and a second row for the same key
 * is a hard error rather than an overwrite: a two-corpus sweep would otherwise collapse
 * into one row and the pin would record whichever corpus happened to be written last.
 */

import { readFileSync, writeFileSync, existsSync } from "fs"
import { Parser, Language } from "web-tree-sitter"
import { ASTEngine } from "../../../src/ast/engine"

const args = process.argv.slice(2)
const logPath = args.includes("--log") ? args[args.indexOf("--log") + 1] : undefined
const BASELINE = "validation/m14/differential-baseline.json"

if (!logPath || !existsSync(logPath)) {
  console.error(`no canonical sweep log at ${logPath} — refusing to invent a baseline row from nothing`)
  process.exit(1)
}
const log = readFileSync(logPath, "utf8")

/**
 * The lane row as the differential prints it.
 *
 * Written to FAIL LOUDLY: the `(%` groups are required rather than optional, and the
 * line must end at the hash. A future reformat of the summary line should stop this
 * instrument, not make it write a row assembled from whatever still matches.
 */
const ROW =
  /^\[([^\]]+)\] scss: files=(\d+) tree-truth=(\d+) covered=(\d+) \(([0-9.]+)%\) MISSING=(\d+) \| analyzer-edges=(\d+) unexplained=(\d+) \(([0-9.]+)%\) heuristic=(\d+) hash=([0-9a-f]+)$/gm

const rows: Record<string, any> = {}
for (const m of log.matchAll(ROW)) {
  const [, repo, files, truth, covered, covPct, missing, , unexplained, , heuristic, hash] = m
  const key = `${repo}:scss`
  if (rows[key]) {
    console.error(`two ${key} rows in the log — a second-corpus sweep would collide, refusing to pick one`)
    process.exit(1)
  }
  rows[key] = {
    missing: Number(missing),
    unexplained: Number(unexplained),
    heuristic: Number(heuristic),
    truthRows: Number(truth),
    covered: Number(covered),
    coveragePct: Number(covPct),
    filesSampled: Number(files),
    perf: null, // filled per corpus below
    sampleSetHash: hash,
  }
}

if (Object.keys(rows).length === 0) {
  console.error(`no scss lane rows in ${logPath} — refusing to write an empty pin`)
  process.exit(1)
}

// ── measure perf, PER CORPUS ──────────────────────────────────────────────────
// Never one corpus's number copied onto another's row. The first CSS pin did that and
// wrote the svelte cost onto the grails-core row, which is false data in a pinned file
// and the kind that survives, because a plausible number in the wrong row is harder to
// notice than a missing one.
const CORPUS_OF: Record<string, string> = {
  "element-plus:scss": "/home/ishaq2321/bb_tests/repositories/element-plus",
}

async function measureAvgMsPerFile(dir: string): Promise<{ avg: number; files: number; load: number }> {
  const { readdirSync, statSync } = await import("fs")
  const { join } = await import("path")
  const files: string[] = []
  ;(function walk(d: string, depth = 0) {
    if (depth > 14) return
    let es: string[]
    try {
      es = readdirSync(d)
    } catch {
      return
    }
    for (const e of es) {
      if (["node_modules", ".git", "dist", "build", "target", "vendor"].includes(e)) continue
      const p = join(d, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p, depth + 1)
      else if (e.endsWith(".scss") && st.size > 0) files.push(p)
    }
  })(dir)
  files.sort()
  const contents = files.map((f) => readFileSync(f, "utf8"))
  const load = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0])
  // warm the wasm, then take the MIN of 5 — a stricter run selection than the harness
  // uses, so a neighbour's work is never measured as ours
  for (let i = 0; i < 2; i++) for (let j = 0; j < contents.length; j++) await ASTEngine.parseFile(files[j], contents[j])
  let best = Number.POSITIVE_INFINITY
  for (let run = 0; run < 5; run++) {
    const t0 = performance.now()
    for (let j = 0; j < contents.length; j++) await ASTEngine.parseFile(files[j], contents[j])
    const per = (performance.now() - t0) / files.length
    if (per < best) best = per
  }
  return { avg: best, files: files.length, load }
}

for (const [key, row] of Object.entries<any>(rows)) {
  const corpus = CORPUS_OF[key]
  if (!corpus) {
    row.perf = { avgMsPerFile: null, note: `no corpus mapped for ${key} — not measured rather than measured wrong` }
    continue
  }
  const m = await measureAvgMsPerFile(corpus)
  row.perf = {
    avgMsPerFile: Number(m.avg.toFixed(3)),
    filesMeasured: m.files,
    loadAvg1AtMeasure: m.load,
    method: "analyze() only, min of 5 runs after 2 warmups — the differential's own grain and a stricter run selection",
    note:
      "Load-STABLE and comparable with rows pinned at load ~5: a 20 ms pure-CPU burn measured 20.0 ms at loadAvg1 30 (scheduler inflation 1.00x), so a busy host does not inflate this process's numbers. The CSS lane's earlier refusal to measure on a busy box rested on that assumption and it was tested and found false.",
  }
}

const base = JSON.parse(readFileSync(BASELINE, "utf8"))
base.counts = { ...base.counts, ...rows }
base.hashes = { ...base.hashes, ...Object.fromEntries(Object.entries<any>(rows).map(([k, v]) => [k, v.sampleSetHash])) }
writeFileSync(BASELINE, JSON.stringify(base, null, 2) + "\n")

console.log(`pinned ${Object.keys(rows).length} scss lane row(s): ${Object.keys(rows).join(", ")}`)
for (const [k, v] of Object.entries<any>(rows)) {
  const perf = v.perf.avgMsPerFile != null ? `${v.perf.avgMsPerFile} ms/file (load ${v.perf.loadAvg1AtMeasure})` : "not measured"
  console.log(`  ${k}: missing=${v.missing} unexplained=${v.unexplained} truth=${v.truthRows}/${v.covered} hash=${v.sampleSetHash.slice(0, 12)} perf=${perf}`)
}
// The shared loadContext is deliberately NOT touched: a per-lane measurement does not
// change what the file recorded about the machine when the other rows were pinned.
console.log(`loadContext left untouched: ${JSON.stringify(base.loadContext)}`)
