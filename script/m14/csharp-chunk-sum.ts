/**
 * THE CHUNK SUM - THE C# LANE'S WHOLE-POPULATION CLOSURE, ASSEMBLED FROM THE CHUNKS.
 *
 * WHY IT EXISTS. `script/m14/completion-gate.ts` reads the lane's own declaration and asks whether
 * the lane is DONE. Its condition (B) is MEASURED ON THE WHOLE ADMITTED POPULATION, and its
 * condition (C) is the declaration's own per-type closure, and its condition (D) is every wall
 * dispositioned with a count and a falsifier. The C# declaration's `meta` block says
 * `parsed 200 / corpusTotal 33184` - a 200-file sample - so the lane reads AT n/n and NOT DONE, and
 * that is the correct reading: a 200-file sample is not the population.
 *
 * THE MEASUREMENT IS ALREADY BEING TAKEN, IN CHUNKS. The admitted set is 14,424 files; the gate
 * takes 2,000-file slices of it under the small slot, and the slices are DISJOINT BY CONSTRUCTION
 * because every chunk is the interval [offset, offset+n) over the SAME SORTED admitted list. This
 * script reads the chunk logs, sums their tables, and refuses to print a population unless the
 * chunks TILE.
 *
 * THE TILING RULE IS THE DART LANE'S, IN THE LOOSER FORM, AND THE FORM IS STATED IN THE OUTPUT:
 * THE CHUNKS TILE THE GLOBAL ADMITTED LIST - the offsets must be 0, N, 2N, ... CONTIGUOUS with no
 * gap and no overlap, and the summed measured files must equal the admitted total. A per-repository
 * contiguity check is a STRICTER form (the dart lane's); this one is the global form, and the output
 * says so rather than letting the number be read as a per-repository population.
 *
 * THE BOUND IS CARRIED BY THE NUMBER. The EDGE buckets are the POPULATION'S - every admitted file is
 * measured exactly once across the chunks, so the edge counts are unbiased. The RESOLUTION buckets
 * are the CHUNKED MEASUREMENT'S - a collision in the half that is not in the slice is invisible, so
 * the name reads unique and the edge resolves. So the chunk sum's `resolved` is BIASED UP and its
 * `unresolved` and `amb(decl)` are BIASED DOWN. A number without that bound is a claim, so the
 * bound is printed with the number, every time.
 *
 * THE STRADDLE CONTROL PUTS A NUMBER ON THAT BIAS. One repository whose files are CONTIGUOUS in
 * the global order can be measured THREE ways over THE SAME FILES - whole (one project scope),
 * half-a and half-b (two scopes) - and the difference between the whole-scope resolved count and
 * the sum of the two halves' resolved counts IS the bias, as a count rather than as a sentence.
 * `--straddle <repo>` does that; it needs the chunk logs to have measured the repository whole.
 *
 * IT WRITES NOTHING BY DEFAULT. `--write` updates the lane's declaration, and it REFUSES to write
 * unless the chunks tile the admitted set exactly and the closure adds up exactly. A declaration
 * that says `parsed 14424 / corpusTotal 14424` while carrying a 200-file sample's numbers is
 * precisely the duplicated-fact defect the completion gate reports, and this script will not
 * manufacture one.
 *
 * USAGE
 *   bun script/m14/csharp-chunk-sum.ts                 # read the chunks, report, write nothing
 *   bun script/m14/csharp-chunk-sum.ts --straddle <re> # the three-way bias control
 *   bun script/m14/csharp-chunk-sum.ts --write         # update the declaration (refuses if not tiled)
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const REPO = resolve(import.meta.dir, "../..")
const CHUNK_DIR = resolve(REPO, ".tmp-csharp/chunks")
const DECL_PATH = resolve(REPO, "validation/m14/instruments/csharp/incoming-declaration.json")
const OUT_PATH = resolve(REPO, "validation/m14/measurements/csharp-gate-chunk-sum.json")

// ── THE TABLE'S COLUMNS, IN THE ORDER THE GATE PRINTS THEM ────────────────────
// TABLE 1 - PER PROJECT, the scope production resolves in (this is the verdict's):
// type edges resolved collRes amb(decl) amb(kind) unresolved extOK ext? extFAIL bindOK bind?
// bindFAIL causeOK causeFAIL
const COLS = [
  "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL",
] as const
type Col = (typeof COLS)[number]

const TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
  "decorates", "renders", "mixes_in", "part_of",
]

interface Chunk {
  offset: number
  limit: number
  admitted: number
  measured: number
  /** per type -> per column */
  rows: Map<string, Record<Col, number>>
  total: Record<Col, number>
}

// ── THE POPULATION LINE THE GATE PRINTS FOR A CHUNK ───────────────────────────
// population: ★ THIS RUN IS A CHUNK, NOT A POPULATION - admitted files [0, 2000) of 14424, and
// 2000 of them were measured.
const POP_RE = /admitted files \[(\d+),\s*(\d+)\) of (\d+).*?(\d+) of them were measured/

const num = (s: string | undefined): number => {
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}

const parseChunk = (path: string): Chunk | null => {
  const text = readFileSync(path, "utf8")
  const m = text.match(POP_RE)
  if (!m) return null
  const offset = Number(m[1])
  const limit = Number(m[2])
  const admitted = Number(m[3])
  const measured = Number(m[4])

  const rows = new Map<string, Record<Col, number>>()
  const total: Record<Col, number> = Object.fromEntries(COLS.map(c => [c, 0])) as Record<Col, number>

  // TABLE 1 lives between its header and the TOTAL row. The header line begins with "type" and the
  // TOTAL row begins with "TOTAL". Everything between is "<type> <14 numbers>".
  const lines = text.split("\n")
  const start = lines.findIndex(l => /^type\s+edges\s+resolved\s+collRes/.test(l))
  if (start < 0) return null
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.trimEnd()
    if (/^-+/.test(line.trim())) continue
    if (line.startsWith("TOTAL")) {
      const parts = line.trim().split(/\s+/)
      for (let c = 0; c < COLS.length; c++) total[COLS[c]!] = num(parts[c + 1])
      break
    }
    const parts = line.trim().split(/\s+/)
    if (parts.length < COLS.length + 1) break
    const type = parts[0]!
    if (!TYPES.includes(type)) break
    const row = {} as Record<Col, number>
    for (let c = 0; c < COLS.length; c++) row[COLS[c]!] = num(parts[c + 1])
    rows.set(type, row)
  }

  return { offset, limit, admitted, measured, rows, total }
}

// ── THE CHUNKS, IN ORDER ──────────────────────────────────────────────────────
const chunkFiles = existsSync(CHUNK_DIR)
  ? readdirSync(CHUNK_DIR).filter(f => /^gate-\d+\.log$/.test(f)).sort((a, b) => {
      const na = Number(a.replace(/\D+/g, ""))
      const nb = Number(b.replace(/\D+/g, ""))
      return na - nb
    })
  : []

const chunks: Chunk[] = []
for (const f of chunkFiles) {
  const c = parseChunk(resolve(CHUNK_DIR, f))
  if (c) chunks.push(c)
}

// ── THE TILING, CHECKED ───────────────────────────────────────────────────────
// THE OFFSETS MUST BE 0, N, 2N, ... CONTIGUOUS - A GAP OR AN OVERLAP IS REPORTED - AND THE
// SUMMED MEASURED FILES MUST EQUAL THE ADMITTED TOTAL.
const tiling = (() => {
  const problems: string[] = []
  const sorted = [...chunks].sort((a, b) => a.offset - b.offset)
  let cursor = 0
  for (const c of sorted) {
    if (c.offset !== cursor) problems.push(`gap or overlap at offset ${c.offset} (expected ${cursor})`)
    cursor = c.offset + c.limit
  }
  const admitted = sorted.length ? sorted[sorted.length - 1]!.admitted : 0
  const measured = sorted.reduce((a, c) => a + c.measured, 0)
  if (measured !== admitted) problems.push(`summed measured ${measured} != admitted ${admitted}`)
  return { tiled: problems.length === 0, problems, admitted, measured, count: sorted.length }
})()

// ── THE SUM ───────────────────────────────────────────────────────────────────
const sum: Record<string, Record<Col, number>> = {}
for (const t of TYPES) {
  const row = {} as Record<Col, number>
  for (const c of COLS) row[c] = 0
  sum[t] = row
}
for (const ch of chunks) {
  for (const [t, row] of ch.rows) {
    for (const c of COLS) sum[t]![c]! += row[c]!
  }
}

const totals = Object.fromEntries(COLS.map(c => [c, 0])) as Record<Col, number>
for (const t of TYPES) for (const c of COLS) totals[c]! += sum[t]![c]!

// ── THE CLOSURE, EXACTLY ──────────────────────────────────────────────────────
// resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK
// + causeFAIL = edges. `amb(kind)` and `collRes` are REPORTED BESIDE and NEVER ADDED.
const closureSum =
  totals.resolved! + totals.ambDecl! + totals.unresolved! + totals.bindOK! + totals.bindQ! +
  totals.bindFAIL! + totals.extOK! + totals.extQ! + totals.extFAIL! + totals.causeOK! + totals.causeFAIL!

// ── THE DECLARATION'S FIVE BUCKETS, FROM THE GATE'S ELEVEN ───────────────────
// resolved   = resolved
// external   = extOK + ext?        (the external CLAIMS: one the project confirms, one no check can reach)
// ambiguous  = amb(decl)
// otherUnresolved = unresolved + bindOK + bind? + bindFAIL + extFAIL + causeOK + causeFAIL
// unclassed  = 0, always
const declTypes: Record<string, Record<string, number>> = {}
for (const t of TYPES) {
  const r = sum[t]!
  declTypes[t] = {
    resolved: r.resolved!,
    external: r.extOK! + r.extQ!,
    ambiguous: r.ambDecl!,
    otherUnresolved:
      r.unresolved! + r.bindOK! + r.bindQ! + r.bindFAIL! + r.extFAIL! + r.causeOK! + r.causeFAIL!,
    unclassed: 0,
  }
}

const unclassedTotal = Object.values(declTypes).reduce((a, r) => a + r.unclassed!, 0)

// ── THE REPORT ────────────────────────────────────────────────────────────────
const B = (s: string) => `\n${s}\n${"=".repeat(s.length)}`
console.log(B("THE C# CHUNK SUM - whole-population closure, assembled from the chunks"))
console.log(`chunks read: ${chunks.length}  (${chunkFiles.join(", ") || "none"})`)
console.log(`admitted total: ${tiling.admitted}   measured across the chunks: ${tiling.measured}`)
console.log(
  tiling.tiled
    ? "TILING: the chunks TILE THE GLOBAL ADMITTED LIST - offsets contiguous from 0, no gap, no overlap, and the summed measured files equal the admitted total."
    : `TILING: *** NOT A POPULATION *** - ${tiling.problems.join("; ")}`,
)
console.log(
  "THE TILING IS THE GLOBAL FORM, NOT THE PER-REPOSITORY FORM - the dart lane's per-repository contiguity check is STRICTER than this one, and this number must not be read as a per-repository population.",
)
console.log("")
console.log("THE BOUND, WITH THE NUMBER:")
console.log("  the EDGE buckets are the POPULATION'S - every admitted file is measured exactly once across the chunks, so the edge counts are unbiased.")
console.log("  the RESOLUTION buckets are the CHUNKED MEASUREMENT'S - a collision in the half that is not in the slice is invisible, so the name reads unique and the edge resolves.")
console.log("  SO THE CHUNK SUM'S `resolved` IS BIASED UP AND ITS `unresolved` AND `amb(decl)` ARE BIASED DOWN. THE EDGE COUNTS ARE UNAFFECTED.")
console.log("")
console.log("THE CLOSURE:")
console.log(`  edges ${totals.edges} = resolved ${totals.resolved} + amb(decl) ${totals.ambDecl} + unresolved ${totals.unresolved} + bindOK ${totals.bindOK} + bind? ${totals.bindQ} + bindFAIL ${totals.bindFAIL} + extOK ${totals.extOK} + ext? ${totals.extQ} + extFAIL ${totals.extFAIL} + causeOK ${totals.causeOK} + causeFAIL ${totals.causeFAIL}`)
console.log(`  closure sum ${closureSum}  ${closureSum === totals.edges ? "= edges EXACTLY" : `*** != edges ${totals.edges} ***`}`)
console.log(`  REPORTED BESIDE, NEVER ADDED: amb(kind) ${totals.ambKind} (a subset of amb(decl)), collRes ${totals.collRes} (of resolved)`)
console.log(`  residual (amb(decl) + unresolved) = ${totals.ambDecl + totals.unresolved}`)
console.log("")
console.log("PER TYPE (the gate's eleven columns; amb(kind) and collRes beside, never added):")
console.log("  type          edges    resolved  collRes  amb(decl)  amb(kind)  unresolved  extOK   ext?    extFAIL  bindOK  bind?   bindFAIL causeOK  causeFAIL")
for (const t of TYPES) {
  const r = sum[t]!
  const pad = (v: number, w: number) => String(v).padStart(w)
  console.log(
    `  ${t.padEnd(13)} ${pad(r.edges!, 7)} ${pad(r.resolved!, 10)} ${pad(r.collRes!, 8)} ${pad(r.ambDecl!, 10)} ${pad(r.ambKind!, 10)} ${pad(r.unresolved!, 11)} ${pad(r.extOK!, 7)} ${pad(r.extQ!, 7)} ${pad(r.extFAIL!, 9)} ${pad(r.bindOK!, 8)} ${pad(r.bindQ!, 8)} ${pad(r.bindFAIL!, 10)} ${pad(r.causeOK!, 9)} ${pad(r.causeFAIL!, 11)}`,
  )
}
console.log("")
console.log("THE DECLARATION'S FIVE BUCKETS (edges = resolved + external + ambiguous + otherUnresolved + unclassed):")
for (const t of TYPES) {
  const d = declTypes[t]!
  const e = d.resolved! + d.external! + d.ambiguous! + d.otherUnresolved! + d.unclassed!
  console.log(`  ${t.padEnd(13)} edges ${String(sum[t]!.edges!).padStart(8)} = resolved ${d.resolved} + external ${d.external} + ambiguous ${d.ambiguous} + otherUnresolved ${d.otherUnresolved} + unclassed ${d.unclassed}  ${e === sum[t]!.edges! ? "EXACT" : "*** MISMATCH ***"}`)
}
console.log(`  unclassed total: ${unclassedTotal}  ${unclassedTotal === 0 ? "(the ceiling is 0, always)" : "*** THE CEILING IS 0, ALWAYS ***"}`)

// ── THE STRADDLE CONTROL ─────────────────────────────────────────────────────
const straddleArg = process.argv.indexOf("--straddle")
if (straddleArg > 0) {
  const repo = process.argv[straddleArg + 1]!
  console.log(B(`THE STRADDLE CONTROL - ${repo} measured THREE ways over THE SAME FILES`))
  console.log("THE CONTROL IS THREE GATE RUNS OVER THE SAME FILE LIST, NOT A LINE IN A LOG: WHOLE (the repository's own files in one project scope), half-a and half-b (the same files in two scopes).")
  console.log("THE CHUNKS BELOW ARE THE ADMITTED RANGES, so the lane can see WHICH chunk cut this repository in half - the repository's files must be CONTIGUOUS in the sorted absolute-path order for a chunk boundary to have cut it.")
  for (const c of [...chunks].sort((a, b) => a.offset - b.offset)) {
    console.log(`  chunk [${c.offset}, ${c.offset + c.limit}) of ${c.admitted} - measured ${c.measured}`)
  }
  console.log(`THE BIAS AS A NUMBER IS (whole-scope resolved) - (sum of the two half-scope resolved counts). A BIAS STATED WITH A NUMBER IS A MEASUREMENT; A BIAS STATED AS A SENTENCE IS A CLAIM.`)
  console.log("THIS SCRIPT DOES NOT RUN THOSE THREE GATE RUNS - it reports the ranges they are cut from, and the three runs are the lane's own measurement, taken under the small slot.")
}

// ── THE ARTIFACT ──────────────────────────────────────────────────────────────
const artifact = {
  lane: "csharp",
  kind: "whole-population closure assembled from the gate's chunks",
  tiling: {
    form: "GLOBAL ADMITTED LIST (offsets 0, N, 2N, ... contiguous) - the per-repository contiguity form is STRICTER and is NOT what this is",
    tiled: tiling.tiled,
    problems: tiling.problems,
    admitted: tiling.admitted,
    measured: tiling.measured,
    chunkCount: tiling.count,
  },
  bound: {
    edgeBuckets: "the POPULATION's - every admitted file is measured exactly once across the chunks, so the edge counts are unbiased",
    resolutionBuckets: "the CHUNKED MEASUREMENT's - project-scoped; a collision in the half that is not in the slice is invisible, so the name reads unique and the edge resolves",
    direction: "the chunk sum's resolved is BIASED UP; its unresolved and amb(decl) are BIASED DOWN; the edge counts are UNAFFECTED",
  },
  closure: {
    form: "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges",
    edges: totals.edges,
    sum: closureSum,
    exact: closureSum === totals.edges,
    reportedBesideNeverAdded: { ambKind: totals.ambKind, collRes: totals.collRes },
    residual: totals.ambDecl + totals.unresolved,
  },
  perType: sum,
  declarationTypes: declTypes,
  unclassedTotal,
}
if (tiling.tiled && closureSum === totals.edges) {
  writeFileSync(OUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`)
  console.log("")
  console.log(`artifact: ${OUT_PATH.replace(REPO + "/", "")}`)
} else {
  // ⇒⇒⇒ A TRACKED ARTIFACT THAT SAYS "NOT A POPULATION" IS A TRACKED CLAIM ABOUT A MEASUREMENT
  // THAT WAS NOT TAKEN - AND A COUNT IN A TRACKED ARTIFACT IS A MEASUREMENT ONLY WHEN THE ARTIFACT
  // IS THE MEASUREMENT. So the artifact is NOT written while the chunks do not tile.
  console.log("")
  console.log("*** NO TRACKED ARTIFACT WRITTEN: the chunks do not tile the admitted set, so this is not a population. ***")
}

// ── THE WRITE, REFUSED UNLESS THE CHUNKS TILE AND THE CLOSURE IS EXACT ────────
if (process.argv.includes("--write")) {
  if (!tiling.tiled) {
    console.log("\n*** REFUSING TO WRITE: the chunks do not tile the admitted set, so the sum is not a population. ***")
    process.exit(1)
  }
  if (closureSum !== totals.edges) {
    console.log("\n*** REFUSING TO WRITE: the closure does not add up exactly. ***")
    process.exit(1)
  }
  if (unclassedTotal !== 0) {
    console.log("\n*** REFUSING TO WRITE: unclassed is not 0, and the ceiling is 0, always. ***")
    process.exit(1)
  }
  const decl = JSON.parse(readFileSync(DECL_PATH, "utf8"))
  decl.meta.parsed = tiling.admitted
  decl.meta.sample = tiling.admitted
  decl.meta.corpusTotal = tiling.admitted
  decl.types = declTypes
  writeFileSync(DECL_PATH, `${JSON.stringify(decl, null, 2)}\n`)
  console.log(`declaration updated: ${DECL_PATH.replace(REPO + "/", "")}`)
  console.log("NOTE: the cause rulings and their populations are the lane's own ruling and are written by the lane, not by this script.")
}
