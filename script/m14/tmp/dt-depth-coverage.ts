// script/m14/tmp/dt-depth-coverage.ts — how much of the corpus has the lane
// actually DRAWN?
//
// The depth cell's honest question on a corpus too big for one process is not
// "what was the largest single draw" but "has every file been measured". The
// cold pool (script/m14/differential.ts, #760) records every path a lane ever
// drew, so the union is measurable instead of asserted. This probe replays the
// harness's own walker over the pinned corpus, normalises BOTH sides by real
// path, and prints:
//   drawn      — corpus files present in the pool's seen set
//   undrawn    — corpus files never drawn (the honest gap)
//   stale      — seen paths that are no longer in the corpus walk
// Reads /tmp/m14-f5-cold-pool.json and the corpora. Writes nothing.
import * as fs from "node:fs"
import * as path from "node:path"

const REPOS = [
  { repo: "proxicall", dir: "/home/ishaq2321/bb_tests/repositories/proxicall", lane: "proxicall:dart" },
  { repo: "dart-http", dir: "/home/ishaq2321/bb_tests/repositories/dart-http", lane: "dart-http:dart" },
]

// The differential's own walker (ext=dart), so "the corpus" means what the gate
// means by it: dot/node_modules/build/target directories pruned, 4000-file cap.
function scan(dir: string, out: string[] = []): string[] {
  if (out.length > 4000) return out
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|node_modules|build|target)/.test(e.name)) scan(p, out) }
    else if (e.name.endsWith(".dart")) out.push(p)
  }
  return out
}

function real(p: string): string {
  try { return fs.realpathSync(p) } catch { return p }
}

// --logs mode: the union of the files a set of chunked runs actually drew,
// read from the `[file]` lines the harness prints under BB_F5_SHOW_FILES, and
// compared against the corpus walk. This is the measurement that makes a
// CHUNKED full extent a claim instead of a hope: a run that died mid-sweep (the
// proxicall/wasm heap mode) contributes no row and therefore no files here.
function logsMode(logs: string[]) {
  const drawn = new Set<string>()
  let chunkRows = 0
  for (const log of logs) {
    const text = fs.readFileSync(log, "utf8")
    if (/^\[proxicall\] dart: files=\d+ .*MISSING=0 \| .*unexplained=0/m.test(text)) chunkRows++
    for (const m of text.matchAll(/^\s+\[file\] (.+)$/gm)) drawn.add(m[1].trim())
  }
  const r = REPOS[0]
  const corpus = scan(r.dir).map((p) => path.relative(r.dir, p))
  const corpusSet = new Set(corpus)
  const undrawn = corpus.filter((f) => !drawn.has(f))
  const foreign = [...drawn].filter((f) => !corpusSet.has(f))
  console.log(`logs=${logs.length} cleanRows=${chunkRows}`)
  console.log(`corpus=${corpus.length} distinctDrawn=${drawn.size} undrawn=${undrawn.length} pathsNotInCorpus=${foreign.length}`)
  for (const f of undrawn.slice(0, 5)) console.log(`   UNDRAWN ${f}`)
  console.log(undrawn.length === 0
    ? `union of the chunked draws covers the WHOLE corpus (${corpus.length}/${corpus.length} distinct files)`
    : `union covers ${corpus.length - undrawn.length}/${corpus.length}`)
}

function main() {
  if (process.argv.includes("--logs")) {
    return logsMode(["/tmp/dt-proxicall-chunk1.log", "/tmp/dt-proxicall-chunk2.log", "/tmp/dt-proxicall-chunk3.log", "/tmp/dt-proxicall-chunk4.log", "/tmp/dt-proxicall-chunk5.log"])
  }
  const state = JSON.parse(fs.readFileSync("/tmp/m14-f5-cold-pool.json", "utf8"))
  let bad = 0
  for (const r of REPOS) {
    const corpus = scan(r.dir).map(real)
    const seen: string[] = (state.seen?.[r.lane] ?? []).map(real)
    const seenSet = new Set(seen)
    const corpusSet = new Set(corpus)
    const drawn = corpus.filter((f) => seenSet.has(f))
    const undrawn = corpus.filter((f) => !seenSet.has(f))
    const stale = [...seenSet].filter((f) => !corpusSet.has(f))
    const pct = corpus.length ? +(100 * drawn.length / corpus.length).toFixed(1) : null
    console.log(`${r.repo}: corpus=${corpus.length} drawn=${drawn.length} (${pct}%) undrawn=${undrawn.length} stalePoolPaths=${stale.length} rotation=${state.rotations?.[r.lane] ?? 0}`)
    for (const f of undrawn.slice(0, 5)) console.log(`   UNDRAWN ${f}`)
    if (undrawn.length > 0) bad++
  }
  console.log(bad === 0 ? "cumulative coverage: COMPLETE on both pinned corpora" : `cumulative coverage: INCOMPLETE in ${bad} corpus(es)`)
}
main()
