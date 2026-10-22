/**
 * THE GROOVY ARM'S MERGE — the disjoint slices of the admitted population, summed, with the
 * RESOLUTION CLOSURE checked to add up exactly.
 *
 * WHAT IT READS. `validation/m14/measurements/groovy-arm/chunk-{0,2000,4000,6000,8000}.txt`, each
 * the incoming-gate's own TABLE 1 (the PER-PROJECT table — production's resolution scope) plus
 * the gate's own population header lines. THE GATE IS THE INSTRUMENT; this file does not
 * re-derive anything, it SUMS what the gate measured and checks the arithmetic.
 *
 * WHY THE SUM IS THE POPULATION'S NUMBER. The chunks are SLICES of the same SORTED admitted list
 * the gate itself sorts, taken at offsets 0, 2000, 4000, 6000 and 8000 with a 2,000-file window
 * each. Disjoint by construction; together they cover the admitted list exactly. This file
 * CHECKS that claim from the gate's own printed slice bounds rather than asserting it: every
 * chunk's `[start, end)` must abut its neighbour's, the first must start at 0, and the last must
 * end at the gate's own admitted total.
 *
 * ★ THE STRADDLE, AND WHICH WAY THE CHUNK SUM'S `resolved` IS BIASED. The admitted list is sorted
 *   by ABSOLUTE PATH, so a repository's files are CONTIGUOUS — but a repository longer than one
 *   chunk STRADDLES a boundary, and a straddling repository's key space is SPLIT across two
 *   chunks. The resolution scope is PER PROJECT, so a split project sees only HALF of its own
 *   symbol table.
 *   ⇒ A COLLISION THAT LIVES IN THE UNSAMPLED HALF IS INVISIBLE, so the name reads UNIQUE and the
 *   edge RESOLVES. The gate says so in its own population line, which every chunk prints: "A
 *   stride sample truncates each project's symbol table too, so its project-scoped RESOLVED share
 *   is biased UP — a name whose collision lives in an unsampled file of the same repository reads
 *   unique here." ⇒ THE CHUNK SUM'S `resolved` IS BIASED UP, and its `unresolved` and `amb(decl)`
 *   BIASED DOWN, relative to a whole-population run.
 *   ⇒ THE MEASURED EDGE BUCKETS ARE THE POPULATION'S: every admitted file is measured exactly once,
 *     and an edge is a per-file fact. ⇒ THE RESOLUTION BUCKETS ARE THE CHUNKED MEASUREMENT'S, WITH
 *     THIS BIAS, AND THE BIAS IS STATED WITH THEM RATHER THAN BOUNDED BY ASSERTION — a number
 *     without its bias is a claim about nothing.
 *
 * THE CLOSURE IDENTITY, CHECKED PER TYPE AND IN TOTAL:
 *   resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL
 *     + causeOK + causeFAIL = edges
 * `amb(kind)` is a SUBSET of `amb(decl)` and is reported BESIDE, never added. `collRes` is a subset
 * of `resolved` and is likewise reported beside. The residual is `amb(decl) + unresolved`.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()
const ARM_DIR = "validation/m14/measurements/groovy-arm"
const CHUNKS = [0, 2000, 4000, 6000, 8000]
const OUT = "validation/m14/measurements/groovy-arm-closure-2026-10-22.json"

const COLS = [
  "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "extUnknown", "extFAIL", "bindOK", "bindUnknown", "bindFAIL", "causeOK", "causeFAIL",
] as const
const TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports", "extends", "implements",
  "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of",
]

type Row = Record<string, number>

function parseChunk(path: string): {
  rows: Map<string, Row>; slice: [number, number] | null; admitted: number | null
  parsed: number | null; degraded: number | null; parseFailures: number | null; repos: number | null
} {
  const text = readFileSync(path, "utf8")
  const rows = new Map<string, Row>()
  const sliceM = /admitted files \[(\d+), (\d+)\)/.exec(text)
  const slice: [number, number] | null = sliceM ? [Number(sliceM[1]), Number(sliceM[2])] : null
  const admM = /corpus has (\d+) [^\n]*? files across (\d+) repos/.exec(text)
  const admitted = admM ? Number(admM[1]) : null
  const repos = admM ? Number(admM[2]) : null
  const parsedM = /(\d+) parsed of (\d+)/.exec(text)
  const parsed = parsedM ? Number(parsedM[1]) : null
  const degM = /parse failures: (\d+)\s+degraded \(regex fallback\): (\d+)/.exec(text)
  const degraded = degM ? Number(degM[2]) : null
  const pfM = /parse failures: (\d+)/.exec(text)
  const parseFailures = pfM ? Number(pfM[1]) : null

  const lines = text.split("\n")
  let inTable = false
  for (const line of lines) {
    if (line.includes("TABLE 1 — PER PROJECT")) { inTable = true; continue }
    if (!inTable) continue
    if (line.includes("amb(kind) is a SUBSET")) break
    const t = line.trim()
    if (!t) continue
    const parts = t.split(/\s+/)
    if (parts.length !== 15) continue
    const type = parts[0]
    if (type === "TOTAL") continue
    if (!TYPES.includes(type)) continue
    const row: Row = { type: 0 } as unknown as Row
    COLS.forEach((c, i) => { row[c] = Number(parts[i + 1]) })
    rows.set(type, row)
  }
  return { rows, slice, admitted, parsed, degraded, parseFailures, repos }
}

const sum: Map<string, Row> = new Map()
for (const t of TYPES) sum.set(t, { type: 0 } as unknown as Row)
const chunks: unknown[] = []
let admittedTotal: number | null = null
let reposTotal: number | null = null
let parsedTotal = 0
let degradedTotal = 0
let parseFailuresTotal = 0
let coverage: [number, number][] = []
const missing: string[] = []

for (const off of CHUNKS) {
  const p = `${ARM_DIR}/chunk-${off}.txt`
  if (!existsSync(resolve(ROOT, p))) { missing.push(p); continue }
  const c = parseChunk(resolve(ROOT, p))
  chunks.push({
    offset: off, file: p, slice: c.slice, admitted: c.admitted, parsed: c.parsed,
    degraded: c.degraded, parse_failures: c.parseFailures, types: c.rows.size,
  })
  if (c.slice) coverage.push(c.slice)
  if (c.admitted != null) admittedTotal = c.admitted
  if (c.repos != null) reposTotal = c.repos
  parsedTotal += c.parsed ?? 0
  degradedTotal += c.degraded ?? 0
  parseFailuresTotal += c.parseFailures ?? 0
  for (const [type, row] of c.rows) {
    const dst = sum.get(type)!
    for (const c2 of COLS) dst[c2] = (dst[c2] ?? 0) + (row[c2] ?? 0)
  }
}

coverage.sort((a, b) => a[0] - b[0])
let coverageOk = coverage.length === CHUNKS.length && coverage[0]?.[0] === 0
for (let i = 0; i < coverage.length; i++) {
  if (i > 0 && coverage[i][0] !== coverage[i - 1][1]) coverageOk = false
}
if (admittedTotal != null && coverage.length > 0 && coverage[coverage.length - 1][1] !== admittedTotal) coverageOk = false

const closureRows: unknown[] = []
const totalRow: Row = { type: 0 } as unknown as Row
let closureOk = true
for (const t of TYPES) {
  const r = sum.get(t)!
  const lhs =
    r.resolved + r.ambDecl + r.unresolved + r.bindOK + r.bindUnknown + r.bindFAIL +
    r.extOK + r.extUnknown + r.extFAIL + r.causeOK + r.causeFAIL
  const ok = lhs === r.edges
  if (!ok) closureOk = false
  for (const c of COLS) totalRow[c] = (totalRow[c] ?? 0) + (r[c] ?? 0)
  closureRows.push({
    type: t, edges: r.edges, resolved: r.resolved, collRes: r.collRes,
    ambDecl: r.ambDecl, ambKind: r.ambKind, unresolved: r.unresolved,
    extOK: r.extOK, extUnknown: r.extUnknown, extFAIL: r.extFAIL,
    bindOK: r.bindOK, bindUnknown: r.bindUnknown, bindFAIL: r.bindFAIL,
    causeOK: r.causeOK, causeFAIL: r.causeFAIL,
    residual: r.ambDecl + r.unresolved,
    closure_ok: ok,
  })
}
const totalLhs =
  totalRow.resolved + totalRow.ambDecl + totalRow.unresolved + totalRow.bindOK + totalRow.bindUnknown +
  totalRow.bindFAIL + totalRow.extOK + totalRow.extUnknown + totalRow.extFAIL +
  totalRow.causeOK + totalRow.causeFAIL
const totalOk = totalLhs === totalRow.edges
if (!totalOk) closureOk = false

const out = {
  language: "groovy",
  measured_at: "2026-10-22",
  instrument: "script/m14/incoming-gate.ts groovy groovy,gvy,gradle 2000 --index --offset=N (the fleet's own gate)",
  merge: "script/m14/groovy-arm-merge.ts",
  population: {
    rule: "the ADMITTED SET is the git-tracked set (git ls-files) restricted to the router's extensions (.groovy, .gvy, .gradle) and to files under the 1 MB cap; the REPO COUNT is the repositories carrying an admitted file",
    admitted_files: admittedTotal,
    repositories: reposTotal,
    parsed: parsedTotal,
    degraded_regex_fallback: degradedTotal,
    parse_failures: parseFailuresTotal,
    slices: CHUNKS,
    coverage_check: {
      ok: coverageOk,
      slices: coverage,
      note: "CHECKED FROM THE GATE'S OWN PRINTED BOUNDS, NOT ASSERTED: the slices must abut, start at 0, and reach the gate's own admitted total.",
    },
  },
  closure: {
    ok: closureOk,
    identity: "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges",
    per_type: closureRows,
    total: {
      ...totalRow,
      residual: totalRow.ambDecl + totalRow.unresolved,
      closure_ok: totalOk,
    },
    reporting_rule: "amb(kind) is a SUBSET of amb(decl) and is reported BESIDE, never added. collRes is a subset of resolved and is likewise reported beside.",
  },
  bias: {
    statement:
      "THE EDGE BUCKETS ARE THE POPULATION'S: every admitted file is measured exactly once, and an edge is a per-file fact. THE RESOLUTION BUCKETS ARE THE CHUNKED MEASUREMENT'S, AND `resolved` IS BIASED UP: the resolution scope is PER PROJECT and a repository longer than one slice STRADDLES a slice boundary, so the split half of the repository cannot see the collisions in the other half — and a collision that is INVISIBLE makes the name read UNIQUE and the edge RESOLVE. The gate says so in its own population line, which every chunk prints.",
    direction: "resolved biased UP · amb(decl) and unresolved biased DOWN · edges unaffected",
  },
  missing_chunks: missing,
}

mkdirSync(resolve(ROOT, "validation/m14/measurements"), { recursive: true })
writeFileSync(resolve(ROOT, OUT), JSON.stringify(out, null, 2) + "\n")
console.log(`GROOVY ARM MERGE -> ${OUT}`)
console.log(`  admitted ${admittedTotal} files across ${reposTotal} repos · parsed ${parsedTotal} · coverage ${coverageOk ? "OK" : "BROKEN"}`)
console.log(`  closure   ${closureOk ? "ADDS UP EXACTLY" : "DOES NOT ADD UP"}`)
for (const r of closureRows as any[]) {
  if (!r.edges) continue
  console.log(
    `    ${r.type.padEnd(13)} edges ${String(r.edges).padStart(7)}  resolved ${String(r.resolved).padStart(7)}` +
    `  amb(decl) ${String(r.ambDecl).padStart(6)}  unresolved ${String(r.unresolved).padStart(6)}` +
    `  residual ${String(r.residual).padStart(6)}  ${r.closure_ok ? "ok" : "MISMATCH"}`,
  )
}
console.log(
  `    ${"TOTAL".padEnd(13)} edges ${String(totalRow.edges).padStart(7)}  resolved ${String(totalRow.resolved).padStart(7)}` +
  `  amb(decl) ${String(totalRow.ambDecl).padStart(6)}  unresolved ${String(totalRow.unresolved).padStart(6)}` +
  `  residual ${String(totalRow.ambDecl + totalRow.unresolved).padStart(6)}  ${totalOk ? "ok" : "MISMATCH"}`,
)
if (missing.length) console.log(`  MISSING CHUNKS: ${missing.join(", ")}`)
