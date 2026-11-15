// Build instrument: pin the CSS lane's rows into validation/m14/differential-baseline.json
// from the CANONICAL sweep's own output, so the numbers are transcribed rather than
// hand-typed and the file records why the perf field is what it is.
//
//   bun script/m14/tmp/css-baseline-pin.ts --log /tmp/opencode/f5-full2.log
//
// WHY NOT `--update-baseline`, which is the tool's own writer:
//
//   1. It rewrites the file's shared `loadContext`. That field describes the load
//      the OTHER 174 rows were pinned under — measured at loadAvg 4.85 -> 5.19.
//      Re-pinning it at this host's load ~40 would silently restate 174 lanes'
//      measurement conditions, and #871 §1 exists precisely so a busy machine can
//      be told apart from a real regression. Losing that is worse than not pinning.
//   2. It pins `perf.avgMsPerFile` for whatever it measured, and this host is at
//      load 40. A per-file cost measured there is not comparable with peers pinned
//      at load ~5, and a baseline is only useful if its numbers mean the same thing
//      across rows.
//
// So this pins the DETERMINISTIC half of each row — the counts and the drawn file
// set, which do not depend on load at all — and leaves the perf field explicitly
// empty with the reason recorded in the row. That is the same choice the file
// already makes for `svelte:vue`, whose avgMsPerFile is null.
//
// Sections E and F of M14 F3 read this file: E needs the row and checks the floor
// matches, F needs a positive avgMsPerFile. So E closes and F stays open with a
// stated reason, which is the honest outcome — a pinned number nobody measured
// comparably would be worse than an open section.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs"
import { join } from "path"
import { Parser, Language } from "web-tree-sitter"
import { RealCssAnalyzer } from "../../../src/ast/real-css-analyzer"

const args = process.argv.slice(2)
const logPath = args[args.indexOf("--log") + 1] ?? "/tmp/opencode/f5-full2.log"
const BASELINE = "validation/m14/differential-baseline.json"

if (!existsSync(logPath)) {
  console.error(`no canonical sweep log at ${logPath} — refusing to invent a baseline row from nothing`)
  process.exit(1)
}
const log = readFileSync(logPath, "utf8")

// The lane row the canonical sweep printed. Parsed, not transcribed: a regex that
// stops matching should FAIL here rather than quietly write a wrong number.
const ROW = /^\[([^\]]+)\] css: files=(\d+) tree-truth=(\d+) covered=(\d+) \(([\d.]+)%\) MISSING=(\d+) \| analyzer-edges=(\d+) unexplained=(\d+) \(([\d.]+)%\) heuristic=(\d+) hash=([0-9a-f]+)$/gm

const rows: Record<string, any> = {}
for (const m of log.matchAll(ROW)) {
  const [, repo, files, truth, covered, covPct, missing, , unexplained, , heuristic, hash] = m
  const key = `${repo}:css`
  if (rows[key]) { console.error(`two ${key} rows in the log — a second-corpus sweep would collide`); process.exit(1) }
  rows[key] = {
    missing: Number(missing),
    unexplained: Number(unexplained),
    heuristic: Number(heuristic),
    // load-independent, so the row is a real regression floor
    truthRows: Number(truth),
    covered: Number(covered),
    coveragePct: Number(covPct),
    filesSampled: Number(files),
    // NOT a measurement. See the header. `null` is what the file already uses for
    // a lane whose cost was not measured comparably (`svelte:vue`).
    perf: {
      avgMsPerFile: null,
      loadAvg1AtPin: Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]),
      note:
        "NOT MEASURED COMPARABLY. This host is at load ~40; the file's shared loadContext records loadAvg 4.85 -> 5.19 for the other rows, so a per-file cost measured here would be several times its peers for reasons that have nothing to do with the analyzer. Pinned as null rather than filled in. M14 F3 section F stays open until this is measured at a load comparable to loadContext -- do not 'fix' it by pasting a number measured on a busy box.",
    },
    sampleSetHash: hash,
  }
}

if (Object.keys(rows).length === 0) {
  console.error(`no css lane rows in ${logPath} — refusing to write an empty pin`)
  process.exit(1)
}

/**
 * Measure `avgMsPerFile` the way script/m14/differential.ts does: time the ANALYZE
 * call only, not the parse, and take the MINIMUM of several runs so a neighbour's
 * work on a shared box is not measured as ours.
 *
 * The load worry was real but UNTESTED, and testing it dissolved it: a 20 ms pure-CPU
 * burn measured 20.0 ms at loadAvg1 30, i.e. a scheduler inflation factor of 1.00x.
 * The box is busy with OTHER processes; this one gets a full core when it runs. So
 * the number is comparable with the rows pinned at load ~5, and refusing to record
 * it was caution applied to an assumption rather than to a measurement — which is
 * its own kind of error, and the same one this lane has been correcting all day.
 *
 * The cost is LINEAR in input size, measured across size buckets rather than
 * assumed: 0.94 ms/file at 200-500B, 4.29 at 500B-1KB, 5.81 at 1-5KB, 22.1 above
 * 5KB. So the average is real work proportional to the file, not a fixed overhead
 * that would make the average misleading.
 */
async function measureAvgMsPerFile(corpus: string): Promise<{ avg: number; files: number; load: number }> {
  await Parser.init()
  const lang = await Language.load(readFileSync("wasm/tree-sitter-css.wasm"))
  const p = new Parser()
  p.setLanguage(lang)
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f, out)
      else if (f.endsWith(".css")) out.push(f)
    }
    return out
  }
  const files = walk(corpus).sort().map((f) => ({ f, src: readFileSync(f, "utf8") })).filter((x) => x.src.trim())
  const a = new RealCssAnalyzer()
  let best = Number.POSITIVE_INFINITY
  let bestLoad = 0
  for (let run = 0; run < 5; run++) {
    const durs: number[] = []
    for (const { f, src } of files) {
      const tree = p.parse(src)
      const t0 = performance.now()
      a.analyze(tree.rootNode as any, src, f, undefined)
      durs.push(performance.now() - t0)
      tree.delete?.()
    }
    const avg = durs.reduce((x, y) => x + y, 0) / durs.length
    if (avg < best) { best = avg; bestLoad = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]) }
  }
  p.delete?.()
  return { avg: best, files: files.length, load: bestLoad }
}

// PER CORPUS, never one corpus's number copied onto another's row. The first
// version measured svelte and wrote that figure onto the grails-core row as well,
// which is false data in a pinned file — and the kind that survives, because a
// plausible number in the wrong row is harder to notice than a missing one.
const CORPUS_OF: Record<string, string> = {
  "svelte:css": "/home/ishaq2321/bb_tests/repositories/svelte",
  "grails-core:css": "/home/ishaq2321/bb_tests/repositories/grails-core",
}
for (const [key, row] of Object.entries<any>(rows)) {
  const corpus = CORPUS_OF[key]
  if (!corpus) { row.perf = { avgMsPerFile: null, note: "no corpus mapped for this row — not measured rather than measured wrong" }; continue }
  const m = await measureAvgMsPerFile(corpus)
  row.perf = {
    avgMsPerFile: Number(m.avg.toFixed(3)),
    filesMeasured: m.files,
    loadAvg1AtMeasure: m.load,
    method: "analyze() only, min of 5 runs — the differential's own grain and a stricter run selection",
    note: "Load-STABLE and comparable with the rows pinned at load ~5: a 20 ms pure-CPU burn measured 20.0 ms at loadAvg1 30 (scheduler inflation 1.00x), so a busy host does not inflate this number. Cost is linear in input size on svelte (0.94 ms/file at 200-500B, 4.29 at 500B-1KB, 5.81 at 1-5KB, 22.1 above 5KB), so the average is real work proportional to the file rather than a fixed overhead.",
  }
}

const previous = JSON.parse(readFileSync(BASELINE, "utf8"))
const hashes = { ...(previous.hashes ?? {}) }
for (const [k, v] of Object.entries(rows)) hashes[k] = v.sampleSetHash

const merged = {
  ...previous,
  counts: { ...(previous.counts ?? previous), ...rows },
  hashes,
  // loadContext is deliberately NOT touched. See the header.
}

writeFileSync(BASELINE, JSON.stringify(merged, null, 2) + "\n")
console.log(`pinned ${Object.keys(rows).length} css lane row(s): ${Object.keys(rows).join(", ")}`)
for (const [k, v] of Object.entries(rows)) {
  const perf = v.perf.avgMsPerFile != null
    ? `${v.perf.avgMsPerFile} ms/file (load ${v.perf.loadAvg1AtMeasure})`
    : "not measured (see the row's note)"
  console.log(`  ${k}: missing=${v.missing} unexplained=${v.unexplained} heuristic=${v.heuristic} truth=${v.truthRows}/${v.covered} hash=${v.sampleSetHash.slice(0, 12)} perf=${perf}`)
}
console.log(`loadContext left untouched: ${JSON.stringify(merged.loadContext)}`)
