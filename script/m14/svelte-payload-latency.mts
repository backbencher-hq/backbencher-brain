// SVELTE PAYLOAD / LATENCY CHECK — the lane's own edge-weight and cost measurement.
//
// WHY THIS FILE EXISTS. The workstream requires every lane to re-run its payload/latency
// check after adding edges, because "more edges means bigger graphs, and the graph surface
// is budgeted": bb_graph's un-narrowed relationshipTypes default is measured at 2.5-4.8x a
// kind-filtered one. This lane had NO such check — docs/analyzers/svelte.md records the
// cost row as gap X5, taken on the production path and 2.5x-4.7x above a pinned baseline
// whose own method was unrecorded.
//
// It measures three things production does not:
//
//   1. EDGE WEIGHT per type — the number that decides whether an added type regresses a
//      budgeted surface. bytes-per-edge, not a raw count, because what a graph query pays
//      is rows, and a row's cost is roughly its own length.
//
//   2. LATENCY on the PRODUCTION path (ASTEngine.parseFile, so the SFC seam and the JS/TS
//      sub-parse are both inside the number), per corpus, split by file size, with the
//      method recorded. docs/analyzers/svelte.md is right that a figure without a method
//      is unreadable: the html lane once published 1.4 ms/KiB measured by calling the
//      analyzer directly and omitting the seam, and the real figure was 4.7-5.3x that.
//
//   3. THE NARROWING RATIO this lane's types actually produce — what a caller who filters
//      to one type pays versus one who does not, measured over THIS lane's edges rather
//      than quoted from lodash/ripgrep.
//
// METHOD, recorded because the whole point of X5 was its absence:
//   production path          ASTEngine.parseFile(file, content)
//   grammars                 svelte + javascript + typescript, all warm before timing
//   warm-up                  the first WARMUP sampled files, parsed and DISCARDED, untimed
//   timed iterations         ITERS per file, MEDIAN reported
//   population               DERIVED by readdir, never hand-listed; every row prints it
//   clock                    performance.now(), wall
//
// NO REGEX (master rule 1). readdir, Set membership, string splitting on "\n", arithmetic.
// Nothing here matches source text.
//
//   bun script/m14/svelte-payload-latency.mts
//   ONLY=svelte bun script/m14/svelte-payload-latency.mts      # one corpus
//   MAXFILES=150 bun script/m14/svelte-payload-latency.mts      # narrower sweep

import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const REPO = process.env.BB_REPO || fileURLToPath(new URL("../..", import.meta.url))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const ONLY = process.env.ONLY || ""
const MAXFILES = Number(process.env.MAXFILES || 400)
const WARMUP = 20
const ITERS = 3

const eng: any = await import(`${REPO}/src/ast/engine.ts`)

function svelteFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 20) return
  let ents: any[]
  try {
    ents = readdirSync(dir, { withFileTypes: true }) as any[]
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      svelteFiles(p, out, depth + 1)
    } else if (e.name.endsWith(".svelte")) out.push(p)
  }
}

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

// ---- population, DERIVED (never a hand-written file list: it rots silently and the
// instrument keeps reporting a confident number about a subset)
const repos: Array<{ repo: string; files: string[] }> = []
for (const e of readdirSync(CORPUS).sort()) {
  if (ONLY && !e.includes(ONLY)) continue
  const dir = join(CORPUS, e)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  const files: string[] = []
  svelteFiles(dir, files)
  if (files.length === 0) continue
  files.sort()
  repos.push({ repo: e, files })
}
const totalCorpusFiles = repos.reduce((a, r) => a + r.files.length, 0)
console.log("svelte payload / latency")
console.log(`POPULATION (derived by readdir over ${CORPUS}, never hand-listed): ${totalCorpusFiles} .svelte files across ${repos.length} repos${ONLY ? `, filtered to "${ONLY}"` : ""}`)
console.log(`METHOD: production ASTEngine.parseFile · grammars warm before timing · first ${WARMUP} sampled files parsed and DISCARDED · ${ITERS} timed iterations per file, MEDIAN reported`)
console.log("")

type Bucket = { label: string; lo: number; hi: number; n: number; ms: number }
type Row = {
  repo: string
  sampled: number
  timed: number
  bytes: number
  symbols: number
  relationships: number
  importsRows: number
  msTotal: number
  msPerFile: number
  msPerKiB: number
  byType: Map<string, number>
  /** JSON length of one observed edge of this type — the per-row cost a query pays. */
  edgeBytes: Map<string, number>
  buckets: Bucket[]
}

const results: Row[] = []

for (const r of repos) {
  // A deterministic STRIDE, not the first N. docs/analyzers/svelte.md's own caution is
  // that one population's shape decides the figure; a stride samples the whole shape
  // instead of one corner of it.
  const stride = Math.max(1, Math.floor(r.files.length / MAXFILES))
  const sampledAbs = r.files.filter((_, i) => i % stride === 0).slice(0, MAXFILES)

  const loaded: Array<{ abs: string; content: string; size: number }> = []
  for (const abs of sampledAbs) {
    // `abs` is ALREADY absolute — `svelteFiles` joins as it recurses. Joining CORPUS
    // again here produced 400 unstattable paths per corpus, so every file silently
    // failed to load and the whole run reported 0.00 ms/file and every type SILENT with
    // total confidence. That is the honesty contract's "correct number about the wrong
    // population" in its purest form, in an instrument written to prevent exactly it.
    try {
      const content = readFileSync(abs, "utf8")
      if (content.length === 0) continue
      loaded.push({ abs, content, size: Buffer.byteLength(content) })
    } catch {
      continue
    }
  }
  // A corpus that loaded nothing is a BUG in this script, not a measurement. Say so.
  if (loaded.length === 0) {
    console.log(`  WARNING  ${r.repo}: 0 of ${sampledAbs.length} sampled files loaded — every latency and payload figure for this corpus would be 0.`)
    continue
  }

  // Warm-up: parse and DISCARD. Not timed, not counted in any figure below.
  for (const f of loaded.slice(0, WARMUP)) {
    try {
      await eng.parseFile(f.abs, f.content)
    } catch {
      /* warm-up only */
    }
  }

  const byType = new Map<string, number>()
  const edgeBytes = new Map<string, number>()
  const buckets: Bucket[] = [
    { label: "<0.5 KiB", lo: 0, hi: 512, n: 0, ms: 0 },
    { label: "0.5-1 KiB", lo: 512, hi: 1024, n: 0, ms: 0 },
    { label: "1-2 KiB", lo: 1024, hi: 2048, n: 0, ms: 0 },
    { label: "2-4 KiB", lo: 2048, hi: 4096, n: 0, ms: 0 },
    { label: "4-8 KiB", lo: 4096, hi: 8192, n: 0, ms: 0 },
    { label: ">8 KiB", lo: 8192, hi: Number.MAX_SAFE_INTEGER, n: 0, ms: 0 },
  ]

  let symbols = 0, relationships = 0, importsRows = 0, bytes = 0, msTotal = 0, timed = 0
  const warmSet = new Set(loaded.slice(0, WARMUP).map((f) => f.abs))

  for (const f of loaded) {
    if (warmSet.has(f.abs)) continue
    const samples: number[] = []
    let res: any = null
    let failed = false
    for (let it = 0; it < ITERS; it++) {
      const t0 = performance.now()
      try {
        res = await eng.parseFile(f.abs, f.content)
      } catch {
        failed = true
        break
      }
      samples.push(performance.now() - t0)
    }
    if (failed || samples.length === 0) continue
    samples.sort((a, b) => a - b)
    const med = samples[Math.floor(samples.length / 2)]
    msTotal += med
    timed++
    bytes += f.size
    symbols += res?.symbols?.length ?? 0
    const rels = res?.relationships ?? []
    relationships += rels.length
    importsRows += res?.imports?.length ?? 0
    for (const rel of rels) {
      const t = String(rel.relationshipType ?? rel.type ?? "")
      if (!t) continue
      byType.set(t, (byType.get(t) ?? 0) + 1)
      if (!edgeBytes.has(t)) {
        try {
          edgeBytes.set(t, JSON.stringify(rel).length)
        } catch {
          edgeBytes.set(t, 0)
        }
      }
    }
    const b = buckets.find((x) => f.size >= x.lo && f.size < x.hi)
    if (b) {
      b.n++
      b.ms += med
    }
  }

  results.push({
    repo: r.repo, sampled: sampledAbs.length, timed, bytes, symbols, relationships, importsRows,
    msTotal, msPerFile: timed ? msTotal / timed : 0,
    msPerKiB: bytes ? msTotal / (bytes / 1024) : 0,
    byType, edgeBytes,
    buckets: buckets.filter((b) => b.n > 0),
  })
}

const pad = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)

// SILENCE CHECK, before anything is printed as a measurement. An instrument that reports
// 0.00 ms/file and ten SILENT types is either a corpus with nothing in it or a broken
// script, and those two look identical on the page. This one WAS the second: it joined an
// already-absolute path onto CORPUS a second time, every readFileSync failed, every file
// was dropped by the `catch { continue }` above, and the run printed a clean table of
// zeros. Every non-zero assertion in this file depends on this check, so it is a hard
// exit rather than a warning.
{
  const timedAll = results.reduce((a, r) => a + r.timed, 0)
  const edgesAll = results.reduce((a, r) => a + r.relationships, 0)
  if (results.length === 0) {
    console.error(`NO CORPUS under ${CORPUS}${ONLY ? ` filtered to "${ONLY}"` : ""}. This is NOT a measurement.`)
    process.exit(2)
  }
  if (timedAll === 0) {
    console.error(`0 files were TIMED across ${results.length} corpora — every latency figure below would be 0.`)
    console.error(`This is a broken instrument, not a fast analyzer. Refusing to print the table.`)
    process.exit(2)
  }
  if (edgesAll === 0) {
    console.error(`0 edges over ${timedAll} timed files — every per-type row would be SILENT.`)
    console.error(`This is a broken instrument, not an analyzer that emits nothing. Refusing to print.`)
    process.exit(2)
  }
  console.log(`SANITY (a zero here means the script is broken, not that the analyzer is): ${timedAll} files timed, ${edgesAll} edges counted`)
  console.log("")
}

console.log("LATENCY (production path, median of 3 per file, warm-up discarded)")
console.log(pad("corpus", 20) + pad("sampled", 9) + pad("timed", 8) + pad("KiB", 10) + pad("ms/file", 11) + pad("ms/KiB", 10) + pad("symbols", 9) + pad("edges", 8) + "imports[]")
console.log("-".repeat(112))
for (const r of results.sort((a, b) => b.bytes - a.bytes)) {
  console.log(
    pad(r.repo, 20) + pad(String(r.sampled), 9) + pad(String(r.timed), 8) +
    pad((r.bytes / 1024).toFixed(1), 10) + pad(r.msPerFile.toFixed(2), 11) +
    pad(r.msPerKiB.toFixed(2), 10) + pad(String(r.symbols), 9) +
    pad(String(r.relationships), 8) + String(r.importsRows),
  )
}

console.log("")
console.log("WITHIN A POPULATION, BY FILE SIZE — constant overhead and marginal cost, told apart")
for (const r of results) {
  if (r.buckets.length < 2) continue
  console.log(`  ${r.repo}:`)
  for (const b of r.buckets) {
    console.log(`    ${pad(b.label, 12)} n=${pad(String(b.n), 5)} ${(b.ms / b.n).toFixed(3)} ms/file`)
  }
}

console.log("")
console.log("EDGE WEIGHT PER TYPE — the number that decides whether an added type regresses a budget")
console.log(pad("type", 14) + pad("edges", 9) + pad("corpora", 9) + pad("B/edge", 9) + pad("KiB total", 11) + "% of edges")
console.log("-".repeat(72))
const aggType = new Map<string, { edges: number; corpora: Set<string>; edgeBytes: number }>()
let allEdges = 0
for (const r of results) {
  for (const [t, n] of r.byType) {
    const a = aggType.get(t) ?? { edges: 0, corpora: new Set<string>(), edgeBytes: r.edgeBytes.get(t) ?? 0 }
    a.edges += n
    a.corpora.add(r.repo)
    aggType.set(t, a)
  }
  allEdges += r.relationships
}
let totalEdgeKiB = 0
for (const t of ALL_TYPES) {
  const a = aggType.get(t)
  if (!a || a.edges === 0) {
    console.log(`${pad(t, 14)}${pad("0", 9)}${pad("0", 9)}  — SILENT; contributes 0 bytes to any graph payload`)
    continue
  }
  const bpt = a.edgeBytes
  const kib = (bpt * a.edges) / 1024
  totalEdgeKiB += kib
  console.log(
    pad(t, 14) + pad(String(a.edges), 9) + pad(String(a.corpora.size), 9) +
    pad(String(bpt), 9) + pad(kib.toFixed(1), 11) +
    `${((a.edges / allEdges) * 100).toFixed(1)}%`,
  )
}

console.log("")
console.log("NARROWING RATIO — what a caller pays selecting ONE type vs. taking all of them")
console.log("  Measured on this lane's own edge bytes. The 2.5-4.8x in the workstream doc is")
console.log("  quoted from lodash and ripgrep; this row is this lane's number and is NOT")
console.log("  comparable to that one.")
console.log("")
console.log(pad("type selected", 16) + pad("KiB", 10) + "vs unfiltered")
for (const t of ALL_TYPES) {
  const a = aggType.get(t)
  if (!a || a.edges === 0) continue
  const kib = (a.edgeBytes * a.edges) / 1024
  console.log(pad(t, 16) + pad(kib.toFixed(1), 10) + `${(kib / totalEdgeKiB).toFixed(3)}x`)
}
console.log(`${pad("(unfiltered)", 16)}${pad(totalEdgeKiB.toFixed(1), 10)}1.000x`)
console.log("")
console.log("  CAVEAT, and it is not a small one: this counts EDGE BYTES over the sampled")
console.log("  population. It is not the serialized response a real bb_graph call returns,")
console.log("  which also carries target resolution, line context and the caller's own filter")
console.log("  work. It is a WITHIN-lane comparison — the ratio between two selections of the")
console.log("  SAME measurement — and not a claim about bb_graph's absolute payload.")