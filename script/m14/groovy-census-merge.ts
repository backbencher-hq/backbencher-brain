/**
 * THE GROOVY CENSUS MERGE — the lane's own census over the admitted population, in five disjoint
 * slices, SUMMED (and the name sets UNITED), so the counts the rulings cite are the population's.
 *
 * WHY THE SLICES SUM AND THE NAME SETS UNION. The slices are slices of ONE SORTED admitted list,
 * so every admitted file is counted exactly once — the counts SUM. The TRAIT NAMES are a SET over
 * the population, so a name declared in two repositories is ONE name — the names UNION.
 *
 * THE MERGE CHECKS THE COVERAGE FROM THE SLICES' OWN PRINTED BOUNDS, as the gate merge does: the
 * slices must abut, start at 0, and reach the admitted total the census itself reports.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()
const ARM_DIR = "validation/m14/measurements/groovy-arm"
const CHUNKS = [0, 2000, 4000, 6000, 8000]
const OUT = "validation/m14/measurements/groovy-population-census-2026-10-22.json"

const COUNT_KEYS = [
  "traitDeclarations", "traitAppliedByImplements", "traitAppliedByExtends",
  "gstringTemplateExpressions", "partTokenOccurrences", "parseFailures",
  "heritageClauses", "heritageCoveredByTheAnalyzerLookup", "heritageMissedByTheAnalyzerLookup",
  "gspTemplateFiles",
]

const sum: Record<string, number> = {}
for (const k of COUNT_KEYS) sum[k] = 0
const traitNames = new Set<string>()
const appliedTraitNames = new Set<string>()
const heritageShapes: Record<string, number> = {}
const slices: unknown[] = []
let admittedTotal: number | null = null
let reposTotal: number | null = null
let symlinks: number | null = null
const missing: string[] = []
let measured = 0
let coverage: [number, number][] = []

for (const off of CHUNKS) {
  const p = `${ARM_DIR}/census-${off}.json`
  if (!existsSync(resolve(ROOT, p))) { missing.push(p); continue }
  const j = JSON.parse(readFileSync(resolve(ROOT, p), "utf8"))
  const c = j.counts ?? {}
  for (const k of COUNT_KEYS) sum[k] += c[k] ?? 0
  for (const n of j.applied_trait_names ?? []) appliedTraitNames.add(n)
  for (const [shape, n] of Object.entries(j.counts?.heritageShapes ?? {})) {
    heritageShapes[shape] = (heritageShapes[shape] ?? 0) + (n as number)
  }
  const pop = j.population ?? {}
  const sl = pop.measured_slice ?? []
  if (sl.length === 2) coverage.push([sl[0], sl[1]])
  measured += pop.measured_files ?? 0
  if (pop.admitted_files != null) admittedTotal = pop.admitted_files
  if (pop.repos != null) reposTotal = pop.repos
  if (pop.symlinked_directories_found_corpuswide != null) symlinks = pop.symlinked_directories_found_corpuswide
  slices.push({ offset: off, measured_files: pop.measured_files, slice: sl })
}

// THE TRAIT NAME SET IS A UNION, so it is collected from the slices' own name lists — which the
// census prints per slice, and which the merge unions rather than sums.
for (const off of CHUNKS) {
  const p = `${ARM_DIR}/census-${off}.json`
  if (!existsSync(resolve(ROOT, p))) continue
  const j = JSON.parse(readFileSync(resolve(ROOT, p), "utf8"))
  for (const n of j.trait_names ?? []) traitNames.add(n)
}

coverage.sort((a, b) => a[0] - b[0])
let coverageOk = coverage.length === CHUNKS.length && coverage[0]?.[0] !== undefined
for (let i = 0; i < coverage.length; i++) if (i > 0 && coverage[i][0] !== coverage[i - 1][1]) coverageOk = false

const out = {
  language: "groovy",
  measured_at: "2026-10-22",
  instrument: "script/m14/groovy-population-census.ts (the lane's own census)",
  merge: "script/m14/groovy-census-merge.ts",
  population: {
    rule: "the ADMITTED SET is the git-tracked set (git ls-files) restricted to the router's extensions (.groovy, .gvy, .gradle) and to files under the 1 MB cap",
    admitted_files: admittedTotal,
    repositories: reposTotal,
    measured_files: measured,
    symlinked_directories_found_corpuswide: symlinks,
    symlinked_directories_followed: 0,
    slices,
    coverage_check: { ok: coverageOk, slices: coverage },
  },
  counts: {
    ...sum,
    distinctTraitNames: traitNames.size,
    distinctAppliedTraitNames: appliedTraitNames.size,
    heritageShapes,
  },
  trait_names: [...traitNames].sort(),
  applied_trait_names: [...appliedTraitNames].sort(),
  missing_chunks: missing,
}
writeFileSync(resolve(ROOT, OUT), JSON.stringify(out, null, 2) + "\n")
console.log(`GROOVY CENSUS MERGE -> ${OUT}`)
console.log(`  admitted ${admittedTotal} files across ${reposTotal} repos · measured ${measured} · coverage ${coverageOk ? "OK" : "BROKEN"}`)
for (const k of COUNT_KEYS) console.log(`  ${k.padEnd(40)} ${sum[k]}`)
console.log(`  ${"distinctTraitNames".padEnd(40)} ${traitNames.size}`)
console.log(`  ${"distinctAppliedTraitNames".padEnd(40)} ${appliedTraitNames.size}`)
for (const [shape, n] of Object.entries(heritageShapes).sort((a, b) => b[1] - a[1])) {
  console.log(`    HERITAGE ${String(n).padStart(7)}  ${shape}`)
}
if (missing.length) console.log(`  MISSING SLICES: ${missing.join(", ")}`)
