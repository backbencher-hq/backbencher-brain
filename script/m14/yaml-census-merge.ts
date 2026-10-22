/**
 * script/m14/yaml-census-merge.ts — MERGE THE CHUNKED YAML CENSUSES INTO ONE POPULATION.
 *
 * WHY THE CHUNKS EXIST — TWO MEASURED REASONS, not one:
 *
 *  1. THE SMALL ARM SLOT refuses a declared population above 2,000 files, and refuses 0 (which
 *     means "the whole population" — a heavy arm in disguise). The yaml population is ~19,000
 *     files, so the whole population cannot be DECLARED to the small slot — but it can be WALKED
 *     in disjoint chunks of 2,000, each chunk taking the slot with its own declared population.
 *     The dart lane worked this out for itself: the chunked walk is both the memory-safe path and
 *     the QUEUE-FAIR path.
 *  2. A tree-sitter WASM module's MEMORY GROWS WITH EVERY PARSE and never shrinks: the dart lane
 *     measured that at roughly 7,600 parses the module runs out and every later `new Parser`
 *     ABORTS — and a single-process walk that LOOKS complete measures a fraction of the
 *     population while printing a whole-population header. One process per chunk cannot hit that
 *     wall, because the module is fresh in each one.
 *
 * THE ARITHMETIC IS EXACT, AND THE TWO KINDS OF COUNT ARE NOT THE SAME KIND:
 *
 *  - EDGES sum. Every edge is counted once, in the chunk that walked the file that carries it.
 *  - FILES sum, and the sum is exact, because the chunks are DISJOINT: every file is walked by
 *    exactly one chunk, so the set of files carrying a type is a union of DISJOINT sets and its
 *    size is the sum of the sizes. There is no set to intersect.
 *  - REPOS DO NOT SUM. A repository spans chunks, so the repo count is the size of the UNION of
 *    the chunks' repo SETS. The chunks carry those sets (`repoSets`), and this script unions them.
 *    Summing them would OVERCOUNT — the same repository counted once per chunk it appears in —
 *    and an overcount is how a lane publishes a number that is too large.
 *
 * THE POPULATION BLOCK is taken from the chunks, and the chunks are CHECKED against each other:
 * `paths`, `distinctFiles` and `admittedTotal` are the ENUMERATION, which every chunk computes
 * identically, so a disagreement means the chunks were taken over different populations and the
 * merge is refused. The parse counts (`parsed`, `failed`, `degradedToFallback`) are the only
 * population members that SUM.
 *
 * USAGE
 *   node script/m14/yaml-census-merge.ts --out <file.json> <chunk.json>...
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1]
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const OUT = argOf("--out")
const CHUNKS = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1] === "--out"))
if (!OUT || CHUNKS.length === 0) {
  console.error("usage: node script/m14/yaml-census-merge.ts --out <file.json> <chunk.json>...")
  process.exit(2)
}
for (const c of CHUNKS) if (!existsSync(c)) { console.error(`FAIL — no chunk file: ${c}`); process.exit(2) }

const chunks = CHUNKS.map((c) => JSON.parse(readFileSync(c, "utf8")))
console.log(`MERGING ${chunks.length} CHUNK(S)`)
for (const c of CHUNKS) console.log(`  ${path.basename(c)} — ${c.chunk?.files ?? "?"} files of ${c.chunk?.of ?? "?"}`)

// ── THE CHUNKS MUST COVER ONE POPULATION. The enumeration is identical in every chunk, so a
// disagreement means the chunks were taken over different populations and the merge is refused.
const first = chunks[0]
for (const c of chunks.slice(1)) {
  for (const k of ["paths", "distinctFiles", "admittedTotal", "reposOnDisk", "symlinkedRepoDirsFollowed", "symlinkedDirsFollowedOnDiskWalk"]) {
    if (c.population?.[k] !== first.population?.[k]) {
      console.error(`FAIL — the chunks disagree on population.${k}: ${first.population?.[k]} vs ${c.population?.[k]} — the merge would describe a population that does not exist`)
      process.exit(1)
    }
  }
}
// ── THE CHUNKS MUST BE DISJOINT AND COMPLETE: their index ranges must tile [0, admittedTotal).
const idxs = chunks.map((c) => c.chunk?.idx).filter((x: any) => typeof x === "number").sort((a: any, b: any) => a - b)
if (idxs.length === chunks.length) {
  let cursor = 0
  for (const i of idxs) {
    if (i !== cursor) { console.error(`FAIL — the chunk indices do not tile the population: expected ${cursor}, got ${i}`); process.exit(1) }
    cursor = i + 1
  }
  const declared = chunks.reduce((n, c) => n + (c.chunk?.files ?? 0), 0)
  if (declared !== first.population?.admittedTotal) {
    console.error(`FAIL — the chunks cover ${declared} files but the population admits ${first.population?.admittedTotal} — the walk is INCOMPLETE`)
    process.exit(1)
  }
} else {
  console.error("FAIL — a chunk carries no index; the chunks cannot be proven disjoint")
  process.exit(1)
}

/** Merge one tally family: edges sum, files sum (disjoint chunks), repos union. */
function mergeFamily(name: string): Record<string, any> {
  const out: Record<string, any> = {}
  const repoSets: Record<string, string[]> = ((first.repoSets ?? {}) as any)[name] ?? {}
  const union: Record<string, Set<string>> = {}
  for (const c of chunks) {
    const fam = (c[name] ?? {}) as Record<string, { edges: number; files: number; repos: number }>
    for (const [k, v] of Object.entries(fam)) {
      const row = out[k] ?? (out[k] = { edges: 0, files: 0, repos: 0 })
      row.edges += Number(v.edges ?? 0)
      row.files += Number(v.files ?? 0)
    }
    const rs = ((c.repoSets ?? {}) as any)[name] ?? {}
    for (const [k, list] of Object.entries(rs as Record<string, string[]>)) {
      const set = union[k] ?? (union[k] = new Set<string>())
      for (const r of list) set.add(r)
    }
  }
  for (const [k, set] of Object.entries(union)) if (out[k]) out[k].repos = set.size
  for (const k of Object.keys(out)) if (!union[k]) out[k].repos = out[k].repos ?? 0
  const outSets: Record<string, string[]> = {}
  for (const [k, set] of Object.entries(union)) outSets[k] = [...set].sort()
  return out
}

const merged: any = { ...first }
// The merged population: the enumeration from the chunks, the parse counts SUMMED.
merged.at = new Date().toISOString()
merged.chunk = { mode: "merged", chunks: chunks.length, files: chunks.reduce((n, c) => n + (c.chunk?.files ?? 0), 0), of: first.population?.admittedTotal }
merged.population = { ...first.population }
merged.population.parsed = chunks.reduce((n, c) => n + (c.population?.parsed ?? 0), 0)
merged.population.failed = chunks.reduce((n, c) => n + (c.population?.failed ?? 0), 0)
merged.population.degradedToFallback = chunks.reduce((n, c) => n + (c.population?.degradedToFallback ?? 0), 0)
merged.population.constructWalked = chunks.reduce((n, c) => n + (c.population?.constructWalked ?? 0), 0)
merged.population.note =
  `${first.population?.note ?? ""} MEASURED IN ${chunks.length} DISJOINT CHUNKS (one process per chunk, ` +
  "each under the small arm slot), MERGED BY script/m14/yaml-census-merge.ts: the edges and the file " +
  "counts are exact sums (the chunks are disjoint — every file is walked by exactly one chunk), and " +
  "the REPOSITORY counts are the size of the UNION of the chunks' repository sets (a repository spans " +
  "chunks, so a sum would overcount it)."

for (const fam of ["perType", "perMarker", "perMarkerType", "constructs", "includeTagSpellings", "includeKeySpellings", "supertypeKeySpellings"]) {
  merged[fam] = mergeFamily(fam)
}
// The repo sets ride with the merged artifact too, so the merge itself is checkable.
const mergedRepoSets: Record<string, any> = {}
for (const fam of ["perType", "perMarker", "perMarkerType", "constructs", "includeTagSpellings", "includeKeySpellings", "supertypeKeySpellings"]) {
  const union: Record<string, Set<string>> = {}
  for (const c of chunks) {
    const rs = ((c.repoSets ?? {}) as any)[fam] ?? {}
    for (const [k, list] of Object.entries(rs as Record<string, string[]>)) {
      const set = union[k] ?? (union[k] = new Set<string>())
      for (const r of list) set.add(r)
    }
  }
  const out: Record<string, string[]> = {}
  for (const [k, set] of Object.entries(union)) out[k] = [...set].sort()
  mergedRepoSets[fam] = out
}
merged.repoSets = mergedRepoSets
// The samples and the parse errors are the union of the chunks' (each capped), and the chunk
// files are not part of the merged artifact — they are the evidence the merge consumed.
merged.samples = Object.fromEntries(
  Object.entries((first.samples ?? {}) as Record<string, any[]>).map(([k, v]) => [k, v]),
)
merged.parseErrors = chunks.flatMap((c) => (c.parseErrors ?? []) as string[]).slice(0, 25)

writeFileSync(OUT, JSON.stringify(merged, null, 2) + "\n")
console.log(`MERGED → ${OUT}`)
console.log(`  parsed ${merged.population.parsed} · failed ${merged.population.failed} · degraded ${merged.population.degradedToFallback}`)
for (const [t, row] of Object.entries(merged.perType as Record<string, any>)) {
  console.log(`  ${t.padEnd(12)} edges=${row.edges} files=${row.files} repos=${row.repos}`)
}
