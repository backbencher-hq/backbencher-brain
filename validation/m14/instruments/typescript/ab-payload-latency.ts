/**
 * PAYLOAD / LATENCY A-B — two analyzer versions, ONE process, interleaved.
 *
 * ## Why one process and why interleaved
 *
 * `docs/analyzers/real-typescript-analyzer.md` records that wall-clock numbers
 * on this box are unstable: "the M12 harness header records the same analyzer
 * measuring 25.8 ms/file and 172.6 ms/file minutes apart". The F# lane withdrew
 * a +16% latency claim for exactly this reason (ONTOLOGY-WORKSTREAM-STATE
 * §"a latency claim withdrawn" — the ranges overlapped almost completely once
 * the runs were interleaved).
 *
 * So this instrument loads BOTH analyzer versions into the same process, parses
 * each file ONCE, and runs the two analyzers over the same tree alternately,
 * `ROUNDS` times each, reporting the MINIMUM per version. A difference that
 * survives min-of-N inside one process is a difference in the code; a difference
 * that only appears across processes is machine load, and this instrument is
 * built so it cannot report one.
 *
 * ## What "payload" means here
 *
 * The budget in ONTOLOGY-WORKSTREAM §"Adding edges is not free downstream" is
 * about graph QUERY payload — `bb_graph`'s un-narrowed `relationshipTypes`
 * default returning 2.5-4.8x a kind-filtered answer (lodash 487 KiB vs 101 KiB).
 * That surface is driven by EDGE COUNT and by the bytes an edge serialises to.
 * So this instrument reports both, per version, over the same population:
 *
 *   edges            the count that drives the un-narrowed default
 *   payloadBytes     sum of JSON.stringify(edge).length over every edge — the
 *                    bytes a consumer actually receives
 *
 * An additive metadata key moves payloadBytes without moving edges. Reporting
 * only one of the two would hide exactly the kind of change this lane made.
 *
 * ## The "before" module
 *
 * Supplied as a path argument. It must sit in `src/ast/` so its relative imports
 * (`./engine`, `./framework-detectors`, `./node-walk`) resolve, and it is NOT
 * committed. `git show <rev>:src/ast/real-typescript-analyzer.ts` into
 * `src/ast/real-typescript-analyzer.before-ab.ts` is the intended way to produce
 * one; the caller deletes it afterwards.
 *
 * ## Population
 *
 * Derived by `readdirSync` over the corpus directory with the same code-bearing
 * signal set and size cap `ambiguity-census.ts` uses, so the number here and the
 * number there describe the same kind of population. Admitted and examined counts
 * are both printed.
 *
 * ## Usage
 *
 *   bun validation/m14/instruments/typescript/ab-payload-latency.ts <beforeModulePath> [nfiles] [rounds]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealTypeScriptAnalyzer as After } from "../../../../src/ast/real-typescript-analyzer"

const BEFORE_PATH = process.argv[2]
if (!BEFORE_PATH) {
  console.error("usage: ab-payload-latency.ts <beforeModulePath> [nfiles] [rounds]")
  process.exit(2)
}
const CORPUS_ROOT = process.env.BB_TS_CORPUS ?? "$HOME/fixtures/repositories"
const CORPUS_DIR = process.env.BB_TS_REPO ?? "element-plus"
const NFILES = Number(process.argv[3] ?? 200)
const ROUNDS = Number(process.argv[4] ?? 5)
const DIR = join(CORPUS_ROOT, CORPUS_DIR)
const EXTS = [".ts", ".tsx", ".mts", ".cts"]
const SIGNALS = ["function ", "export ", "class ", "const "]
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".pnpm-store", "coverage"])
const MAX_BYTES = 400_000

const beforeMod: any = await import(BEFORE_PATH)
// String identity, not `/Analyzer$/`. The first version of this line used a
// regular expression, and this lane's own `regex-free-check.ts` caught it on the
// next run: 1 regex node across 8 instrument files. Rule 1 of this programme
// names census scripts and oracles as subjects, and a check that exempts the
// person who wrote it is not a check. `endsWith` is the same predicate here --
// the grammar of the question is "does the export name end with Analyzer", and
// there is no reason to reach for a pattern to answer it.
const Before: any = Object.values(beforeMod).find(
  (v: any) => typeof v === "function" && String(v.name).endsWith("Analyzer"),
)
if (!Before) {
  console.error(`no *Analyzer class exported from ${BEFORE_PATH}`)
  process.exit(2)
}

// ── population, derived ─────────────────────────────────────────────────────
const files: string[] = []
let examined = 0
let noSignal = 0
let tooBig = 0
let wrongExt = 0
;(function walk(d: string) {
  let ents
  try {
    ents = readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (files.length >= NFILES) return
    const p = join(d, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p)
      continue
    }
    if (!EXTS.some((x) => e.name.endsWith(x))) {
      wrongExt++
      continue
    }
    examined++
    try {
      if (statSync(p).size > MAX_BYTES) {
        tooBig++
        continue
      }
      const s = readFileSync(p, "utf8")
      let has = false
      for (const sig of SIGNALS) {
        if (s.includes(sig)) {
          has = true
          break
        }
      }
      if (!has) {
        noSignal++
        continue
      }
      files.push(p)
    } catch {
      /* unreadable */
    }
  }
})(DIR)

const parser = await getParser("typescript")

interface Acc {
  edges: number
  symbols: number
  payloadBytes: number
  bestMs: number
  worstMs: number
  samples: number[]
}
const acc: Record<"before" | "after", Acc> = {
  before: { edges: 0, symbols: 0, payloadBytes: 0, bestMs: Number.POSITIVE_INFINITY, worstMs: 0, samples: [] },
  after: { edges: 0, symbols: 0, payloadBytes: 0, bestMs: Number.POSITIVE_INFINITY, worstMs: 0, samples: [] },
}

const beforeAnalyzer = new Before()
const afterAnalyzer = new After()

let parsed = 0
let failed = 0
for (const f of files) {
  let src: string
  try {
    src = readFileSync(f, "utf8")
  } catch {
    failed++
    continue
  }
  let tree: any
  try {
    tree = await parser.parse(src, f)
    parsed++
  } catch {
    failed++
    continue
  }
  // Interleaved, one parse shared by both versions: the parse cost is common and
  // is not what this instrument is measuring.
  for (let r = 0; r < ROUNDS; r++) {
    for (const which of ["before", "after"] as const) {
      const a = which === "before" ? beforeAnalyzer : afterAnalyzer
      const t0 = performance.now()
      const res = a.analyze(tree.rootNode, src, f)
      const ms = performance.now() - t0
      const s = acc[which]
      s.samples.push(ms)
      if (ms < s.bestMs) s.bestMs = ms
      if (ms > s.worstMs) s.worstMs = ms
      if (r === 0) {
        const rels = res.relationships || []
        s.edges += rels.length
        s.symbols += (res.symbols || []).length
        let bytes = 0
        for (const e of rels) bytes += JSON.stringify(e).length
        s.payloadBytes += bytes
      }
    }
  }
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${(((a - b) / b) * 100).toFixed(2)}%`)
const total = (k: "before" | "after") => acc[k].samples.reduce((x, y) => x + y, 0)

console.log(`PAYLOAD / LATENCY A-B — one process, interleaved, min-of-${ROUNDS}`)
console.log(`  after  module  src/ast/real-typescript-analyzer.ts`)
console.log(`  before module  ${BEFORE_PATH}`)
console.log(`corpus            ${DIR}`)
console.log(`POPULATION        ${files.length} files admitted of ${examined} candidates examined`)
console.log(`                    rejected: ${noSignal} no code signal, ${tooBig} over ${MAX_BYTES} bytes, ${wrongExt} other extensions`)
console.log(`parsed            ${parsed}/${files.length} (${failed} failed)`)
console.log("")
console.log("                        before          after        delta")
console.log("-".repeat(72))
console.log(
  `  edges              ${String(acc.before.edges).padStart(12)}   ${String(acc.after.edges).padStart(12)}   ${pct(acc.after.edges, acc.before.edges)}`,
)
console.log(
  `  symbols            ${String(acc.before.symbols).padStart(12)}   ${String(acc.after.symbols).padStart(12)}   ${pct(acc.after.symbols, acc.before.symbols)}`,
)
console.log(
  `  payloadBytes       ${String(acc.before.payloadBytes).padStart(12)}   ${String(acc.after.payloadBytes).padStart(12)}   ${pct(acc.after.payloadBytes, acc.before.payloadBytes)}`,
)
console.log(
  `  best round (ms)    ${acc.before.bestMs.toFixed(1).padStart(12)}   ${acc.after.bestMs.toFixed(1).padStart(12)}   ${pct(acc.after.bestMs, acc.before.bestMs)}`,
)
console.log(
  `  worst round (ms)   ${acc.before.worstMs.toFixed(1).padStart(12)}   ${acc.after.worstMs.toFixed(1).padStart(12)}   ${pct(acc.after.worstMs, acc.before.worstMs)}`,
)
console.log(
  `  all rounds (ms)    ${total("before").toFixed(1).padStart(12)}   ${total("after").toFixed(1).padStart(12)}   ${pct(total("after"), total("before"))}`,
)
console.log("")
console.log(`  bytes per edge     ${(acc.before.payloadBytes / Math.max(1, acc.before.edges)).toFixed(1).padStart(12)}   ${(acc.after.payloadBytes / Math.max(1, acc.after.edges)).toFixed(1).padStart(12)}`)
console.log("")
console.log("A non-zero EDGES delta is what regresses bb_graph's un-narrowed default.")
console.log("A payloadBytes delta with a zero EDGES delta is metadata weight, not graph size.")
