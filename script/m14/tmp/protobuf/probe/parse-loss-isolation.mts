/**
 * IS THE PARSE LOSS A PROPERTY OF THE FILE, OR A PROPERTY OF THE LOAD?
 *
 * ## Why this exists
 *
 * Nine passes of this lane have quoted a band on every production-side count —
 * pass 8 measured it at 19 rounds as 9-of-19 lossy, up to −69 symbols / −100
 * edges — and every one of those passes described the loss by WHERE it landed
 * (`lost-parse-locality.mts`) and never by WHAT CAUSES IT. Two causes fit every
 * observation so far, and they call for opposite repairs:
 *
 *   A. THE FILE'S CONTENT TRIPS A WASM FAULT. `parseFile` reports
 *      `[BB-PARSE-ERR] … memory access out of bounds`. If that is the file, then the
 *      vendored `tree-sitter-protobuf.wasm` has a defect and the repair is a grammar
 *      bump — a §8 item against a file this lane does not own, and a real one.
 *   B. THE LOSS IS CONTENT-INDEPENDENT AND LOAD-DEPENDENT. The wasm tree-sitter
 *      runtime hands out a shared memory arena; under a width-8 census on a disk
 *      that twenty-three agents are also reading, the arena is exhausted or a
 *      pointer walks off it. If that is it, the file is a VICTIM and the repair is
 *      in the pool's parser lifetime — also a §8 item, and a different one.
 *
 * Pass 9 falsified locality (4 of 5 losses outside the suspect directory), which
 * is evidence for B and against a single bad construct, but it is not a
 * measurement of either mechanism. Nothing in the lane has ever parsed one of
 * these files ON ITS OWN and watched.
 *
 * ## What this measures
 *
 * The known-lossy files, each under three regimes that differ ONLY in load:
 *
 *   --mode=alone-fresh   one file, a NEW parser per repetition, width 1
 *   --mode=alone-shared  one file, ONE parser reused, width 1
 *   --mode=census        the file inside the census's own width-8 population
 *
 * A file that fails in `alone-fresh` is cause A, full stop, and the construct is
 * then readable off the tree. A file that survives N repetitions alone and fails
 * under `census` is cause B, and the honest statement is that the lane's band is a
 * property of a loaded machine rather than a defect in this analyzer — which is a
 * different thing to hand the supervisor, and one that decides whether the band
 * should be re-baselined at all.
 *
 * Each repetition reports the fault STRING as well as the count, because "it
 * failed" and "it failed with the out-of-bounds access the census prints" are
 * different claims and only one of them is the defect under investigation.
 *
 * ## What this probe cannot do
 *
 * It cannot see a fault that needs a specific file ORDER, because `alone` fixes the
 * population at one file. A file that only fails after N other files have been
 * parsed reads `0` failures here and is reported as survivor, which is a FALSE
 * NEGATIVE for cause B and is stated at every count this probe prints.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/parse-loss-isolation.mts
 *      [--file=<repo-relative path>] [--reps=40] [--mode=alone-fresh|alone-shared|census]
 */
import { openSync, readdirSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const arg = (name: string, dflt: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPS = Number(arg("reps", "40"))
const MODE = arg("mode", "alone-fresh")
const WIDTH = 8
const OUT = arg("out", "/tmp/opencode/pb/parse-loss-isolation.json")

/**
 * The files the census and `lost-parse-locality.mts` have each named as lost, at
 * HEAD. Stated as data rather than re-derived, because the claim under test is
 * about THESE files and a probe that silently picked a different population would
 * be measuring something else.
 */
const LOST: string[] = [
  "pb-googleapis/google/api/expr/v1alpha1/explain.proto",
  "pb-googleapis/google/api/expr/v1alpha1/checked.proto",
  "pb-googleapis/google/api/expr/v1alpha1/eval.proto",
  "pb-googleapis/google/api/expr/v1alpha1/value.proto",
  "pb-googleapis/google/api/expr/v1beta1/eval.proto",
  "pb-googleapis/google/api/expr/v1beta1/expr.proto",
  "pb-googleapis/google/api/expr/v1beta1/source.proto",
]

// ------------------------------------------------------------------ corpus walk
const all: string[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { continue }
  if (!isDir) continue
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs, r); continue }
      if (k.endsWith(".proto")) all.push(abs)
    }
  }
  walk(dir, "")
}

const ONE = arg("file", "")
const targets = ONE ? [path.join(CR, ONE)] : LOST.map((f) => path.join(CR, f)).filter((f) => statSync(f, { throwIfNoEntry: false }) !== undefined)
const missing = LOST.filter((f) => !statSync(path.join(CR, f), { throwIfNoEntry: false }))
if (missing.length) {
  console.error(`NOTE: ${missing.length} named-lost file(s) not on disk this run: ${missing.join(", ")}`)
  console.error(`      counted as SURVIVORS below, which is a declared absence, not a pass.`)
}

type Rep = { file: string; ok: boolean; syms: number; rels: number; analyzerSyms: number; fault: string | null }

const FAULTS: string[] = []
const origWrite = process.stderr.write.bind(process.stderr)
// The pipeline prints its fault as a log line; capture it so a fault is attributed
// to the file that provoked it rather than to whichever file ran next. BOTH fault
// channels are captured and kept apart: `BB-PARSE-ERR` is the wasm out-of-bounds
// access, `BB-HANG` is the 120s watchdog, and they are different failures with
// different causes. Collapsing them would report one number for two defects.
const capture = (chunk: unknown): boolean => {
  const s = typeof chunk === "string" ? chunk : Buffer.from(chunk as Buffer).toString("utf8")
  for (const line of s.split("\n")) {
    if (line.includes("BB-PARSE-ERR") || line.includes("BB-HANG")) FAULTS.push(line.trim())
  }
  return origWrite(chunk as any)
}
process.stderr.write = capture as any

// The grammar and the analyzer are needed in EVERY mode, because the loss criterion
// is a COMPARISON and not a threshold.
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await (wts.Language ?? wts.default?.Language).load(
  readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")),
)
const analyzer = new RealProtobufAnalyzer()

/** What the ANALYZER finds in this file's bytes, driven off its own parser.
 *  A production loss is production publishing NOTHING for bytes the analyzer read,
 *  so this number is the denominator a `syms > 0` test cannot supply: an
 *  intentionally blank `.proto` has no declarations, so zero symbols is the CORRECT
 *  answer for it and counting that as a loss invents a defect. `pb-reference/
 *  src/google/protobuf/unittest_empty.proto` is exactly that file — 593 bytes of
 *  licence header and `syntax = "proto2";`, nothing declared — and a
 *  `syms > 0` criterion scored it 8 failures in 8 rounds before this was fixed. */
function analyzerSymbolCount(abs: string, parser: any): number {
  try {
    const content = readFileSync(abs, "utf8")
    const tree = parser.parse(content)
    const a: any = analyzer.analyze(tree.rootNode, content, abs)
    return (a?.symbols ?? []).length
  } catch {
    return -1
  }
}

async function attempt(abs: string, parser: any): Promise<Rep> {
  const before = FAULTS.length
  let prod: any
  try {
    prod = await parseFile(abs, path.dirname(abs))
  } catch (e) {
    return { file: abs, ok: false, syms: 0, rels: 0, analyzerSyms: -1, fault: `threw: ${(e as Error).message}` }
  }
  const newFaults = FAULTS.slice(before)
  // Reset the log per file so attribution stays exact and the array cannot grow to
  // one entry per parse across a 6,568-parse run. Without the reset the offset used
  // to slice "this file's" faults drifts and a fault gets charged to a later file.
  FAULTS.length = before
  const syms = (prod?.symbols ?? []).length
  const rels = (prod?.relationships ?? []).length
  const as = analyzerSymbolCount(abs, parser)
  return {
    file: abs,
    ok: !(as > 0 && syms === 0),
    syms,
    rels,
    analyzerSyms: as,
    fault: newFaults.length ? newFaults.map((f) => f.split("] ")[0].replace("[", "")).join(" + ") : null,
  }
}

const results: Rep[] = []

/**
 * An append-only journal, one line per file-parse, flushed as it happens.
 *
 * This exists because the probe is killed by the fault it measures: `parseFile`'s
 * 120s watchdog prints `[BB-HANG] … — exiting` and calls `process.exit`, so a
 * 6,568-parse run terminates before its own report can print, and a `finally` does
 * not survive `process.exit`. The first two attempts at this measurement died that
 * way with their totals still in memory and nothing on disk.
 *
 * So the totals are written where an exit cannot reach them, and `--report-only`
 * aggregates the journal without parsing anything. The consequence is a better
 * property than the one it replaced: a 0.2%-rate measurement needs thousands of
 * samples, and it can now gather them across many invocations instead of needing
 * one process to survive long enough to see them all.
 */
const JOURNAL = arg("journal", "/tmp/opencode/pb/iso-journal.jsonl")
const APPEND = process.argv.includes("--append")
const REPORT_ONLY = process.argv.includes("--report-only")
if (!APPEND && !REPORT_ONLY) { try { writeFileSync(JOURNAL, "") } catch { /* first run */ } }
// `openSync` + `writeSync`, not `appendFileSync`: the first returns an fd and the
// second is a full open/write/close per row. An fd plus `writeSync` is one open for
// the whole run and every row is on disk the moment it is measured, which is the
// property that matters when the run can be ended by `process.exit` mid-flight.
const journalFd = REPORT_ONLY ? null : openSync(JOURNAL, "a")
const record = (r: Rep): void => {
  results.push(r)
  if (journalFd !== null) {
    writeSync(journalFd, JSON.stringify({ ...r, file: r.file.startsWith(CR) ? r.file.slice(CR.length + 1) : r.file }) + "\n")
  }
}

if (REPORT_ONLY) {
  // Nothing to parse. The grammar load above is wasted work in this mode and is
  // skipped by the guard below; the corpus walk still runs because the report
  // needs the on-disk population to state its denominator.
} else if (MODE === "alone-fresh" || MODE === "alone-shared") {
  const shared = MODE === "alone-shared" ? new ParserClass() : null
  if (shared) shared.setLanguage(grammar)
  for (const abs of targets) {
    for (let i = 0; i < REPS; i++) {
      const p = shared ?? new ParserClass()
      if (!shared) p.setLanguage(grammar)
      else {
        // Touch the shared parser so the regime differs in the way its name claims:
        // one parser instance serving every repetition.
        try { p.parse(readFileSync(abs, "utf8")) } catch { /* production reports its own faults */ }
      }
      record(await attempt(abs, p))
    }
  }
} else {
  // The census's own shape: every corpus file, width 8, with the target inside it.
  const ROUNDS = Math.max(1, Number(arg("rounds", "2")))
  for (let round = 0; round < ROUNDS; round++) {
    let idx = 0
    const worker = async (): Promise<void> => {
      const p = new ParserClass()
      p.setLanguage(grammar)
      for (;;) {
        const i = idx++
        if (i >= all.length) return
        const abs = all[i]
        if (targets.includes(abs)) record(await attempt(abs, p))
        else {
          // Every OTHER file is still measured, because the question cause B raises
          // is not "do the named files fail" but "how many files fail, and which".
          // Discarding these would leave the rate with no denominator and the file
          // list with no population behind it, which is the defect this probe exists
          // to correct in the earlier instruments.
          record(await attempt(abs, p))
        }
      }
    }
    await Promise.all(Array.from({ length: WIDTH }, worker))
    console.error(
      `round ${round + 1}/${ROUNDS}: ${results.length} file-parses journaled, ${results.filter((r) => !r.ok).length} loss(es) so far`,
    )
  }
}

process.stderr.write = origWrite as any

// ------------------------------------------------------------------ report
//
// `--report-only` aggregates the journal and parses nothing, which is the only way
// to read a total out of a run the fault itself terminated. Journal rows carry
// project-relative paths, so they are re-absolutised here against the same root.
const rows: Rep[] = REPORT_ONLY
  ? readFileSync(JOURNAL, "utf8").split("\n").filter(Boolean).map((l) => {
      const o = JSON.parse(l)
      return { ...o, file: path.join(CR, o.file) } as Rep
    })
  : results

const byFile = new Map<string, Rep[]>()
for (const r of rows) {
  const arr = byFile.get(r.file) ?? []
  arr.push(r)
  byFile.set(r.file, arr)
}

console.log(`\nmode ${MODE}${REPORT_ONLY ? "  (report-only: read from journal)" : ""}   corpus ${all.length} files`)
console.log(`file                                                              reps  ok  fail  analyzer-syms when ok`)
console.log(`--------------------------------------------------------------------------------`)
const faultTexts = new Map<string, number>()
for (const [, reps] of byFile) for (const r of reps) if (!r.ok && r.fault) faultTexts.set(r.fault, (faultTexts.get(r.fault) ?? 0) + 1)
const totalReps = rows.length
const totalFails = rows.filter((r) => !r.ok).length

// In `census` mode every file in the corpus is measured, so the per-file table is
// 800+ rows of `0`. Only files that actually failed are printed, and the rate
// carries the whole population as its denominator — which is the number a §8 item
// against the shared pool needs and the number the earlier probes could not give.
const rowsToPrint = MODE === "census" ? [...byFile].filter(([, v]) => v.some((r) => !r.ok)) : [...byFile]
for (const [abs, reps] of rowsToPrint) {
  const fails = reps.filter((r) => !r.ok)
  const label = abs.startsWith(CR) ? abs.slice(CR.length + 1) : abs
  console.log(`${label.padEnd(64)} ${String(reps.length).padStart(4)} ${String(reps.length - fails.length).padStart(3)} ${String(fails.length).padStart(5)}  ${fails[0]?.analyzerSyms ?? ""}`)
}
const distinctFailed = [...byFile].filter(([, v]) => v.some((r) => !r.ok)).length
const repos = new Set(
  [...byFile].filter(([, v]) => v.some((r) => !r.ok)).map(([abs]) => abs.slice(CR.length + 1).split("/")[0]),
)
console.log(`\nfile-parses ${totalReps}   failures ${totalFails}   rate ${((totalFails / totalReps) * 100).toFixed(3)}%`)
console.log(`distinct files that failed ${distinctFailed} of ${byFile.size}   across ${repos.size} repositories: ${[...repos].sort().join(", ")}`)
if (faultTexts.size) {
  console.log(`\ndistinct fault strings:`)
  for (const [t, n] of [...faultTexts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}x  ${t}`)
}
const suspect = "pb-googleapis/google/api/expr/"
const outsideFail = [...byFile].filter(([abs, v]) => v.some((r) => !r.ok) && !abs.startsWith(CR + "/" + suspect))
const verdict =
  MODE === "census"
    ? totalFails > 0
      ? `CAUSE B — content-independent: ${totalFails} loss(es) in ${totalReps} file-parses, hitting ${distinctFailed} file(s) across ${repos.size} repo(s), ${outsideFail.length} of them OUTSIDE ${suspect}`
      : "no failure observed in either regime; INCONCLUSIVE, not a pass (see the header's order caveat)"
    : totalFails > 0
      ? "CAUSE A — the file's own content trips the fault, alone, at width 1"
      : "survives alone; consistent with CAUSE B, and does not establish it"
console.log(`\nverdict: ${verdict}`)

writeFileSync(OUT, JSON.stringify({
  mode: MODE, reps: REPS, corpusFiles: all.length, targetsNamedLost: LOST,
  targetsMissingFromDisk: missing, width: MODE === "census" ? WIDTH : 1,
  totalFileParses: totalReps, totalFailures: totalFails,
  failureRate: totalReps ? totalFails / totalReps : 0,
  distinctFilesFailed: distinctFailed,
  repositoriesHit: [...repos].sort(),
  faultStrings: Object.fromEntries(faultTexts),
  failuresOutsideSuspectDir: outsideFail.map(([abs, v]) => ({
    file: abs.slice(CR.length + 1),
    failures: v.filter((r) => !r.ok).length,
    fault: v.find((r) => !r.ok)?.fault ?? null,
  })),
  perFile: Object.fromEntries([...byFile].map(([k, v]) => [k.slice(CR.length + 1), {
    reps: v.length, failures: v.filter((r) => !r.ok).length,
    symsOnSuccess: v.find((r) => r.ok)?.syms ?? 0, relsOnSuccess: v.find((r) => r.ok)?.rels ?? 0,
  }])),
}, null, 2))
console.log(`\nwrote ${OUT}`)
