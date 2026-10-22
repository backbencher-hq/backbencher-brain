// script/m14/dart-census-merge.ts — MERGE THE CHUNKED CENSUSES INTO ONE POPULATION.
//
// WHY THE CHUNKS EXIST. A tree-sitter WASM module's MEMORY GROWS WITH EVERY PARSE and never
// shrinks: at roughly 7,600 parses of the dart corpus the module runs out, every later
// `new Parser` ABORTS, and a single-process walk that LOOKS complete measures a fraction of the
// population while printing a whole-population header. That is the failure this merger exists to
// make impossible: the population is walked in DISJOINT CHUNKS, one PROCESS per chunk, and the
// chunk JSONs are summed here.
//
// THE ARITHMETIC IS EXACT, NOT AN ESTIMATE, because the chunks are DISJOINT: every file is walked
// by exactly one chunk, so a row count is the SUM of the chunks' row counts and a file count is
// the SUM of the chunks' file counts (a file cannot be counted twice — there is no set to
// intersect). The one thing a sum cannot do is count a DISTINCT name, so the name maps are merged
// as maps (a name's count is the sum of its counts; the number of DISTINCT names is the size of
// the merged map).
//
// USAGE
//   bun run script/m14/dart-census-merge.ts --kind constructs --out validation/m14/measurements/<name>.json <chunk.json>...
//   bun run script/m14/dart-census-merge.ts --kind edges     --out validation/m14/measurements/<name>.json <chunk.json>...
//
// The merged JSON is written to --out, and the SAME report the chunk runs print is printed here, so
// the merged artifact and the printed numbers cannot drift.

import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const argv = process.argv.slice(2)
function argOf(flag: string): string {
  const eq = argv.find((a) => a.startsWith(`${flag}=`))
  if (eq) return eq.slice(eq.indexOf("=") + 1)
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : ""
}
const KIND = argOf("--kind")
const OUT = argOf("--out")
const CHUNKS = argv.filter((a) => !a.startsWith("--") && a !== KIND && a !== OUT && !argv[argv.indexOf(a) - 1]?.startsWith("--"))
if (!KIND || !OUT || CHUNKS.length === 0) {
  console.error("usage: bun run script/m14/dart-census-merge.ts --kind <constructs|edges> --out <file.json> <chunk.json>...")
  process.exit(2)
}

interface Bucket { rows: number; files: number }
const files = CHUNKS.map((c) => JSON.parse(readFileSync(c, "utf8")))
console.log(`MERGING ${files.length} CHUNK(S) — ${KIND}`)
console.log(`  chunks: ${CHUNKS.join(", ")}`)

// ── the per-chunk population claims are SUMMED, and the claim is checked: a chunk that reports a
// failure count is reported here, because a chunk that lost files is a chunk that under-counts.
let totalFiles = 0
let totalParsed = 0
let totalFailed = 0
const repos: Record<string, number> = {}
for (const f of files) {
  const p = f.population ?? {}
  totalFiles += p.files ?? 0
  totalParsed += p.parsed ?? 0
  totalFailed += p.failed ?? 0
  // THE PER-REPO FILE COUNTS come from the chunks' `perRepo` LISTS (the chunk's own `population.repos`
  // is a COUNT, not a map) — and the chunk files are DISJOINT, so the sum is exact.
  for (const r of (f.perRepo ?? []) as any[]) {
    const key = String(r.repo ?? "?")
    repos[key] = (repos[key] ?? 0) + Number(r.files ?? 0)
  }
}

function mergeBuckets(get: (f: any) => Record<string, Bucket> | undefined): Record<string, Bucket> {
  const out: Record<string, Bucket> = {}
  for (const f of files) {
    const b = get(f)
    if (!b) continue
    for (const [k, v] of Object.entries(b)) {
      const cur = out[k] ?? { rows: 0, files: 0 }
      cur.rows += v.rows ?? 0
      cur.files += v.files ?? 0
      out[k] = cur
    }
  }
  return out
}
/** MERGE A NAME -> COUNT MAP, in EITHER SHAPE the census writes it (an object, or pairs). */
function mergeMap(get: (f: any) => any): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of files) {
    const m = get(f)
    if (!m) continue
    if (Array.isArray(m)) {
      for (const pair of m) {
        if (Array.isArray(pair)) out[String(pair[0])] = (out[String(pair[0])] ?? 0) + Number(pair[1])
      }
      continue
    }
    for (const [k, v] of Object.entries(m)) out[k] = (out[k] ?? 0) + (v as number)
  }
  return out
}
function sum(get: (f: any) => number | undefined): number {
  let t = 0
  for (const f of files) t += get(f) ?? 0
  return t
}

const merged: any = {
  kind: KIND,
  mergedFrom: CHUNKS,
  population: { files: totalFiles, parsed: totalParsed, failed: totalFailed, repos },
}

if (KIND === "constructs") {
  const renders = mergeBuckets((f) => f.renders)
  const decorates = mergeBuckets((f) => {
    const out: Record<string, Bucket> = {}
    for (const [k, v] of Object.entries(f.decorates ?? {})) {
      if (v && typeof v === "object" && typeof (v as any).rows === "number") out[k] = v as Bucket
    }
    return out
  })
  merged.renders = {
    buckets: renders,
    buildReturnTypes: mergeMap((f) => f.renders?.buildReturnTypes),
    renderedNames: mergeMap((f) => f.renders?.renderedNames),
  }
  merged.decorates = {
    buckets: decorates,
    annotationNames: mergeMap((f) => f.decorates?.annotationNames),
    appliedCallableTest: { rows: sum((f) => f.decorates?.appliedCallableTest?.rows), files: sum((f) => f.decorates?.appliedCallableTest?.files) },
    appliedCallableTrueSites: { rows: sum((f) => f.decorates?.appliedCallableTrueSites?.rows), files: sum((f) => f.decorates?.appliedCallableTrueSites?.files) },
    appliedCallableSites: files.flatMap((f) => f.decorates?.appliedCallableSites ?? []),
    appliedCallableTrueSiteList: files.flatMap((f) => f.decorates?.appliedCallableTrueSiteList ?? []),
    byCarrier: mergeBuckets((f) => f.decorates?.byCarrier),
  }
  console.log("== THE `renders` CANDIDATES ==")
  for (const [k, v] of Object.entries(renders)) console.log(`  ${k.padEnd(38)} ${String(v.rows).padStart(9)} rows  ${String(v.files).padStart(6)} files`)
  console.log("  THE DECLARED RETURN TYPES OF THE BUILD METHODS (top 12):")
  for (const [k, v] of Object.entries(merged.renders.buildReturnTypes as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(v).padStart(8)}  ${k}`)
  console.log("  THE MOST-RENDERED NAMES (top 20):")
  for (const [k, v] of Object.entries(merged.renders.renderedNames as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    ${String(v).padStart(8)}  ${k}`)
  console.log("== THE `decorates` CANDIDATES ==")
  for (const [k, v] of Object.entries(decorates)) console.log(`  ${k.padEnd(38)} ${String(v.rows).padStart(9)} rows  ${String(v.files).padStart(6)} files`)
  console.log(`  THE APPLIED-CALLABLE TEST (the arguments mention the marked declaration): ${merged.decorates.appliedCallableTest.rows} sites`)
  console.log(`  … of those, the mention is OUTSIDE A STRING LITERAL: ${merged.decorates.appliedCallableTrueSites.rows} sites  <-- THE APPLIED-CALLABLE COUNT`)
} else {
  merged.edgesByType = mergeBuckets((f) => (f.edgesByType ?? {}) as Record<string, Bucket>)
  merged.perRepo = files.flatMap((f) => f.perRepo ?? [])
  merged.partOf = mergeBuckets((f) => f.partOf)
  merged.mixesIn = mergeBuckets((f) => f.mixesIn)
  merged.annotationRefsByKind = mergeBuckets((f) => f.annotationRefsByKind)
  merged.annotationNames = mergeMap((f) => f.annotationNames)
  console.log("== THE PER-TYPE EDGE COUNTS (the analyzer's own emissions) ==")
  for (const [k, v] of Object.entries(merged.edgesByType as Record<string, Bucket>).sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`  ${k.padEnd(14)} ${String(v.rows).padStart(9)} rows  ${String(v.files).padStart(6)} files`)
  }
}

console.log(`  POPULATION: ${totalFiles} files · parsed ${totalParsed} · failed ${totalFailed} · ${Object.keys(repos).length} repos`)
writeFileSync(path.join(ROOT, OUT), JSON.stringify(merged, null, 2))
console.log(`  WROTE ${OUT}`)
