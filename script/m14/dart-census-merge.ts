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

// A SLICE ARTIFACT CARRIES ITS OWN PROVENANCE PREAMBLE, SO THE READER MUST NOT DEMAND A PURE JSON
// FILE. The arm runs the gate with `--json` and captures its stderr into the SAME file, because the
// engine's INFO lines are part of what the slice measured (which grammar was bound, which engine
// ran) and a slice that dropped them would be a number without its instrument. So the file is
// "INFO lines, then one JSON object", and the JSON object starts at the first line beginning with
// `{`. Refusing the preamble would make every real slice unreadable — the exact opposite of what a
// provenance-carrying artifact is for — so the preamble is SKIPPED and the object is parsed, and a
// file with NO object is refused by name rather than read as an empty chunk.
function readChunkTolerant(file: string): any {
  const raw = readFileSync(file, "utf8")
  try {
    return JSON.parse(raw)
  } catch {
    const lines = raw.split("\n")
    const start = lines.findIndex((l) => l.startsWith("{"))
    if (start < 0) {
      throw new Error(
        `${file}: no JSON object found — ${raw.length} bytes and not one line starts with "{". ` +
          `A slice truncated before its object is a killed run, not a result; it must be re-run, not merged.`,
      )
    }
    try {
      return JSON.parse(lines.slice(start).join("\n"))
    } catch (e) {
      throw new Error(`${file}: the JSON object at line ${start + 1} does not parse (${String(e)}) — the slice is truncated; it must be re-run, not merged.`)
    }
  }
}

const files = CHUNKS.map((c) => readChunkTolerant(c))
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
} else if (KIND === "gate") {
  // ══ THE POPULATION ARM'S CHUNKS ══ the shared gate's own JSON, one file per SLICE. The slices
  // are DISJOINT and walked from 0, so the SUM of the chunks' buckets IS the population's buckets —
  // and `amb(kind)` is summed BESIDE it and NEVER added to the closure.
  const NUMERIC: string[] = [
    "resolved", "resolvedAmongCollision", "ambiguousByDecl", "ambiguousByKind", "unresolved",
    "markedExternal", "externalVerified", "externalVerifiedByOwner", "externalVerifiedByProjectFacts",
    "externalUnverified", "externalRefuted", "bindingVerified", "bindingRefuted", "bindingUnverified",
    "causeDeclared", "causeRefuted",
  ]
  function sumBlock(block: any): Record<string, number> {
    const out: Record<string, number> = {}
    for (const k of NUMERIC) out[k] = Number(block?.[k] ?? 0)
    return out
  }
  // ══ THE TOTALS ARE SUMS OVER THE DISJOINT SLICES, like everything else in this file. Reading them
  // off `files[0]` prints ONE slice's totals beside the POPULATION's edge count — which is how this
  // merger first reported `SUM 15371` against `edges 3977705` and a closure that looked broken when
  // only one side of it was. A closure is a statement about the population or it is not a closure.
  const totals = sumBlock({})
  const totalsPooled = sumBlock({})
  for (const f of files) {
    const t = sumBlock((f as any).totals)
    for (const k of NUMERIC) totals[k] = (totals[k] ?? 0) + (t[k] ?? 0)
    const tp = sumBlock((f as any).totalsPooled)
    for (const k of NUMERIC) totalsPooled[k] = (totalsPooled[k] ?? 0) + (tp[k] ?? 0)
  }
  const perType: Record<string, any> = {}
  for (const f of files) {
    for (const [type, v] of Object.entries((f.perType ?? {}) as Record<string, any>)) {
      const cur = (perType[type] ??= { edges: 0, project: sumBlock({}), pooled: sumBlock({}) })
      cur.edges += Number((v as any)?.edges ?? 0)
      for (const k of NUMERIC) cur.project[k] = (cur.project[k] ?? 0) + Number((v as any)?.project?.[k] ?? 0)
      for (const k of NUMERIC) cur.pooled[k] = (cur.pooled[k] ?? 0) + Number((v as any)?.pooled?.[k] ?? 0)
    }
  }
  // THE NAMED CAUSES — the arm prints each one with its edge count in its reason line, and the
  // slices are disjoint, so the counts SUM. The names themselves are the union.
  // ══ THE TILING REFUSAL — A MERGE OVER NON-TILING CHUNKS PRODUCES A NUMBER THAT LOOKS LIKE A
  // POPULATION. The slices are named `<repo>-<offset>.json`, and the run prints the slice's own
  // bounds ("admitted files [0, 2000) of 25,727") and says it is a slice. So the merge can CHECK
  // the tiling instead of trusting it: within every repository the offsets must be 0, 2000, 4000,
  // … CONTIGUOUS, the last slice must END at that repository's admitted total, and the summed
  // slices must equal the sum of the admitted totals. A gap, an overlap or a shortfall is REFUSED
  // HERE, because a merge that cannot cover the population must not print a population's number.
  const byRepo = new Map<string, { offsets: number[]; parsed: number; total: number; parsedByOffset: Map<number, number> }>()
  for (const [i, f] of files.entries()) {
    const name = CHUNKS[i].split("/").pop() ?? ""
    const m = name.match(/^(.*)-(\d+)\.json$/)
    if (!m) continue
    const repo = m[1]!
    const off = Number(m[2])
    const pop = (f as any).population ?? {}
    const cur = byRepo.get(repo) ?? { offsets: [], parsed: 0, total: Number(pop.corpusTotal ?? 0), parsedByOffset: new Map<number, number>() }
    cur.offsets.push(off)
    cur.parsedByOffset.set(off, Number(pop.parsed ?? 0))
    cur.parsed += Number(pop.parsed ?? 0)
    cur.total = Math.max(cur.total, Number(pop.corpusTotal ?? 0))
    byRepo.set(repo, cur)
  }
  const tilingProblems: string[] = []
  let admittedTotal = 0
  for (const [repo, r] of byRepo) {
    admittedTotal += r.total
    const sorted = [...r.offsets].sort((a, b) => a - b)
    // ══ THE WIDTH OF A SLICE IS MEASURED, NOT ASSUMED. A slice's own `parsed` IS the number of files
    // it walked from its offset, so the tiling rule is exact and width-agnostic: the first slice
    // starts at 0, EVERY slice ends exactly where the next one begins, and the last slice ends at the
    // repository's admitted total. A slice's WIDTH is a cost decision — a 2,000-file slice is much
    // slower than four 500-file slices because the WASM module's memory grows inside one process —
    // and it is never a rule about what a tiling IS. Assuming a fixed 2,000 would REFUSE a tiling
    // that covers the population perfectly, which is the very failure this check exists to prevent.
    if (sorted[0] !== 0) tilingProblems.push(`${repo}: the first slice starts at ${sorted[0]}, not 0 — the slices do NOT tile`)
    for (let k = 0; k + 1 < sorted.length; k++) {
      const width = r.parsedByOffset.get(sorted[k]!) ?? 0
      if (sorted[k]! + width !== sorted[k + 1]) {
        tilingProblems.push(`${repo}: the slice at ${sorted[k]} parsed ${width} file(s), so it ends at ${sorted[k]! + width}, but the next slice starts at ${sorted[k + 1]} — the slices do NOT tile`)
      }
    }
    const lastOff = sorted[sorted.length - 1]!
    const lastWidth = r.parsedByOffset.get(lastOff) ?? 0
    if (lastOff + lastWidth !== r.total) {
      tilingProblems.push(`${repo}: the last slice starts at ${lastOff} and parsed ${lastWidth} file(s), so it ends at ${lastOff + lastWidth}, but the repository admits ${r.total} — the slices do NOT cover the repository`)
    }
    if (r.parsed !== r.total) tilingProblems.push(`${repo}: the slices parse ${r.parsed} files, the repository admits ${r.total} — the slices do NOT cover the repository`)
  }
  const summedParsed = files.reduce((a, f) => a + Number((f as any).population?.parsed ?? 0), 0)
  if (summedParsed !== admittedTotal) tilingProblems.push(`the slices parse ${summedParsed} files, the admitted total is ${admittedTotal} — the slices do NOT cover the population`)
  merged.tiling = {
    byRepo: Object.fromEntries([...byRepo].map(([k, v]) => [k, { slices: v.offsets.length, parsed: v.parsed, admitted: v.total }])),
    admittedTotal, summedParsed, problems: tilingProblems, tiles: tilingProblems.length === 0,
  }
  console.log("== THE TILING CHECK (a merge over non-tiling chunks refuses to print a population) ==")
  for (const [repo, v] of Object.entries(merged.tiling.byRepo as Record<string, any>)) console.log(`  ${repo.padEnd(18)} ${String(v.slices).padStart(3)} slice(s)  parsed ${String(v.parsed).padStart(7)}  admitted ${String(v.admitted).padStart(7)}`)
  console.log(`  admitted total ${admittedTotal} · summed parsed ${summedParsed}`)
  for (const p of tilingProblems) console.log(`  *** ${p}`)
  if (tilingProblems.length > 0) {
    // ⇒⇒ A REFUSAL THAT STILL WRITES THE FILE IS NOT A REFUSAL. The artifact is what a downstream
    // tool reads and what a reader cites, so the merge withholds it: nothing is written, the exit
    // code is non-zero, and the next reader sees an error instead of a population-shaped file whose
    // own text says it is not a population. (The numbers are still printed above, so the refusal is
    // diagnosable without the artifact.)
    console.log("  *** THE TILING REFUSES THIS MERGE — the numbers above are NOT a population ***")
    console.log("  *** NO ARTIFACT WAS WRITTEN: a merge that cannot cover the population must not leave a file behind ***")
    process.exit(3)
  }
  const causes: Record<string, number> = {}
  for (const f of files) {
    const reason = String((f as any).reason ?? "")
    for (const m of reason.matchAll(/cause "([^"]+)" \((\d+) edge\(s\)\)/g)) {
      causes[m[1]] = (causes[m[1]] ?? 0) + Number(m[2])
    }
  }
  merged.totals = totals
  merged.totalsPooled = totalsPooled
  merged.perType = perType
  merged.causeNames = causes
  merged.causeCount = Object.keys(causes).length
  // THE CLOSURE, CHECKED EXACTLY — `resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL
  // + extOK + ext? + extFAIL + causeOK + causeFAIL = edges`, with `amb(kind)` REPORTED BESIDE.
  const edges = Object.values(perType).reduce((a, v: any) => a + v.edges, 0)
  const parts = ["resolved", "ambiguousByDecl", "unresolved", "bindingVerified", "bindingUnverified",
    "bindingRefuted", "externalVerified", "externalUnverified", "externalRefuted", "causeDeclared", "causeRefuted"]
  const sum = parts.reduce((a, k) => a + (totals[k] ?? 0), 0)
  merged.closure = {
    edges, sum, exact: edges === sum,
    ambiguousByKind_REPORTED_BESIDE: totals.ambiguousByKind,
    residual: (totals.ambiguousByDecl ?? 0) + (totals.unresolved ?? 0),
    formula: parts.join(" + ") + " = edges",
  }
  console.log("== THE POPULATION CLOSURE (the disjoint slices, summed) ==")
  for (const k of parts) console.log(`  ${k.padEnd(20)} ${String(totals[k] ?? 0).padStart(12)}`)
  console.log(`  ${"SUM".padEnd(20)} ${String(sum).padStart(12)}`)
  console.log(`  ${"edges".padEnd(20)} ${String(edges).padStart(12)}   ${edges === sum ? "EXACT ✓" : "*** NOT EXACT ***"}`)
  console.log(`  amb(kind) REPORTED BESIDE (never added): ${totals.ambiguousByKind}`)
  console.log(`  residual = amb(decl) + unresolved = ${(totals.ambiguousByDecl ?? 0) + (totals.unresolved ?? 0)}`)
  console.log(`  THE NAMED CAUSES: ${Object.keys(causes).length}`)
  for (const [k, v] of Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`    ${String(v).padStart(7)}  ${k}`)
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
