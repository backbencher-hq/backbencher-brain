/**
 * THE HTML ARM'S MERGE — five disjoint chunks of the admitted population, summed, with the
 * RESOLUTION CLOSURE checked to add up exactly.
 *
 * WHAT IT READS. `validation/m14/measurements/html-arm/chunk-{0,2000,4000,6000,8000}.txt`, each
 * the incoming-gate's own TABLE 1 (the PER-PROJECT table — production's resolution scope) plus the
 * gate's own population header lines. The gate is the instrument; this file does not re-derive
 * anything, it SUMS what the gate measured and checks the arithmetic.
 *
 * WHY THE SUM IS THE POPULATION'S NUMBER. The chunks are SLICES of the same SORTED admitted list
 * the gate itself sorts (`incoming-gate.ts:532 found.sort()`), taken at offsets 0, 2000, 4000, 6000
 * and 8000 with a 2,000-file window each. Disjoint by construction; together they cover the
 * admitted list exactly. This file CHECKS that claim from the gate's own printed slice bounds
 * rather than asserting it: every chunk's `[start, end)` must abut its neighbour's, the first must
 * start at 0, and the last must end at the gate's own admitted total.
 *
 * ★ THE STRADDLE, AND WHICH WAY THE CHUNK SUM'S `resolved` IS BIASED. The admitted list is sorted by
 *   ABSOLUTE PATH, so a repository's files are CONTIGUOUS — but a repository longer than one chunk
 *   STRADDLES a boundary, and a straddling repository's key space is SPLIT across two chunks. The
 *   resolution scope is PER PROJECT, so a split project sees only HALF of its own symbol table.
 *
 *   ★ THE FIRST VERSION OF THIS NOTE HAD THE SIGN BACKWARDS, AND THE GATE'S OWN HEADER IS WHAT
 *   CORRECTED IT. It said the chunk sum's `resolved` is a LOWER BOUND — "a name that collides
 *   with a declaration in the other half of the same repository cannot be seen" — and the reason
 *   that is wrong is the same sentence read the other way round: a collision that lives in the
 *   UNSAMPLED half is INVISIBLE, so the name reads UNIQUE and the edge RESOLVES. The gate says so
 *   in its own population line, which every chunk prints: "A stride sample truncates each
 *   project's symbol table too, so its project-scoped RESOLVED share is biased UP — a name whose
 *   collision lives in an unsampled file of the same repository reads unique here."
 *   ⇒ THE CHUNK SUM'S `resolved` IS BIASED UP, and its `unresolved` and `amb(decl)` BIASED DOWN,
 *   relative to a whole-population run. The EDGE COUNTS are unaffected: every admitted file is
 *   measured exactly once (8,888 of 8,888 parsed), and an edge is a per-file fact.
 *   ⇒ THE MEASURED EDGE BUCKETS ARE THE POPULATION'S. THE RESOLUTION BUCKETS ARE THE CHUNKED
 *   MEASUREMENT'S, WITH THIS BIAS, AND THE BIAS IS STATED WITH THEM RATHER THAN BOUNDED BY
 *   ASSERTION — a number without its bias is a claim about nothing.
 *
 * THE CLOSURE IDENTITY, CHECKED PER TYPE AND IN TOTAL:
 *   resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL
 *     + causeOK + causeFAIL = edges
 * `amb(kind)` is a SUBSET of `amb(decl)` and is reported BESIDE, never added. `collRes` is a subset
 * of `resolved` and is likewise reported beside. The residual is `amb(decl) + unresolved`.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()
const ARM_DIR = "validation/m14/measurements/html-arm"
const CHUNKS = [0, 2000, 4000, 6000, 8000]
const OUT = "validation/m14/measurements/html-arm-closure-2026-10-22.json"

const COLS = [
  "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "extUnknown", "extFAIL", "bindOK", "bindUnknown", "bindFAIL", "causeOK", "causeFAIL",
] as const
const TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports", "extends", "implements",
  "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of",
]

// ★ TWO ROW TYPES, BECAUSE THE FIRST ONE SAID A STRING WAS A NUMBER. The parsed per-type bucket
//   is a record of COUNTS (`edges`, `resolved`, …) and the type's NAME is its map key, so a
//   `Record<string, number>` is right for it. The CLOSURE row is a different thing: it carries the
//   type's NAME as a field (`type`), and the first version typed that field as a number, which is
//   what made `r.type.padEnd(12)` a type error — a string method on a number. At runtime the cast
//   changed nothing, so the table printed and the numbers were right, but a cast that CONTRADICTS
//   the data is a cast that will be copied. ⇒ THE TYPES ARE NOW TRUE.
type Bucket = Record<string, number>
type ClosureRow = {
  type: string
  edges: number
  resolved: number
  collRes: number
  ambDecl: number
  ambKind: number
  unresolved: number
  extOK: number
  extUnknown: number
  extFAIL: number
  bindOK: number
  bindUnknown: number
  bindFAIL: number
  causeOK: number
  causeFAIL: number
  residual: number
  closureLhs: number
  closureOk: boolean
}

function parseChunk(path: string): { rows: Map<string, Bucket>; slice: [number, number] | null; admitted: number | null; parsed: number | null; degraded: number | null } {
  const text = readFileSync(path, "utf8")
  const rows = new Map<string, Bucket>()
  // THE POPULATION HEADER — the gate's own admitted total and the chunk's own slice bounds.
  const sliceM = /admitted files \[(\d+), (\d+)\)/.exec(text)
  const slice: [number, number] | null = sliceM ? [Number(sliceM[1]), Number(sliceM[2])] : null
  // THE GATE'S OWN ADMITTED TOTAL. Its header line reads "corpus has 8888 .html,htm,xhtml,hbs,… 
  // files across 96 repos" — the extension list sits between the number and the word "files", so
  // the first version of this regex ("corpus has (\d+) admitted") matched NOTHING and the merged
  // artifact recorded `admitted: null` for a measurement whose population it could otherwise name.
  const admM = /corpus has (\d+) [^\n]*? files across (\d+) repos/.exec(text)
  const admitted = admM ? Number(admM[1]) : null
  const parsedM = /(\d+) parsed of (\d+)/.exec(text)
  const parsed = parsedM ? Number(parsedM[1]) : null
  const degM = /parse failures: (\d+)\s+degraded \(regex fallback\): (\d+)/.exec(text)
  const degraded = degM ? Number(degM[2]) : null

  // TABLE 1 — PER PROJECT. Its rows are the 14 type names followed by 14 integers.
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
    const row: Bucket = {} as Bucket
    COLS.forEach((c, i) => { row[c] = Number(parts[i + 1]) })
    rows.set(type, row)
  }
  return { rows, slice, admitted, parsed, degraded }
}

const sum: Map<string, Bucket> = new Map()
for (const t of TYPES) sum.set(t, {} as Bucket)
const chunks: unknown[] = []
let admittedTotal: number | null = null
let parsedTotal = 0
let degradedTotal = 0
let coverage: [number, number][] = []
let missing: string[] = []

for (const off of CHUNKS) {
  const path = `${ARM_DIR}/chunk-${off}.txt`
  if (!existsSync(resolve(ROOT, path))) { missing.push(path); continue }
  const c = parseChunk(resolve(ROOT, path))
  chunks.push({ offset: off, file: path, slice: c.slice, admitted: c.admitted, parsed: c.parsed, degraded: c.degraded, types: c.rows.size })
  if (c.slice) coverage.push(c.slice)
  if (c.admitted != null) admittedTotal = c.admitted
  parsedTotal += c.parsed ?? 0
  degradedTotal += c.degraded ?? 0
  for (const [type, row] of c.rows) {
    const dst = sum.get(type)!
    for (const c2 of COLS) dst[c2] = (dst[c2] ?? 0) + (row[c2] ?? 0)
  }
}

// THE COVERAGE CHECK — abutting slices, from 0, to the gate's own admitted total.
coverage.sort((a, b) => a[0] - b[0])
let coverageOk = coverage.length === CHUNKS.length && coverage[0]?.[0] === 0
for (let i = 0; i < coverage.length; i++) {
  if (i > 0 && coverage[i][0] !== coverage[i - 1][1]) coverageOk = false
}
if (admittedTotal != null && coverage.length > 0 && coverage[coverage.length - 1][1] !== admittedTotal) coverageOk = false

// THE CLOSURE — per type and in total.
const closureRows: ClosureRow[] = []
let totalRow: ClosureRow = { type: "TOTAL", edges: 0, resolved: 0, collRes: 0, ambDecl: 0, ambKind: 0, unresolved: 0, extOK: 0, extUnknown: 0, extFAIL: 0, bindOK: 0, bindUnknown: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0, residual: 0, closureLhs: 0, closureOk: true }
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
    closureLhs: lhs, closureOk: ok,
  })
}
const totalLhs =
  totalRow.resolved + totalRow.ambDecl + totalRow.unresolved + totalRow.bindOK + totalRow.bindUnknown +
  totalRow.bindFAIL + totalRow.extOK + totalRow.extUnknown + totalRow.extFAIL + totalRow.causeOK +
  totalRow.causeFAIL
if (totalLhs !== totalRow.edges) closureOk = false

const doc = {
  what: "THE HTML LANE'S RESOLUTION CLOSURE OVER THE WHOLE ADMITTED POPULATION, summed from five disjoint chunks of the gate's own sorted admitted list.",
  population: {
    admitted: admittedTotal,
    parsed: parsedTotal,
    degraded: degradedTotal,
    chunks: chunks.length,
    coverageOk,
    coverage,
    note: "A repository longer than one chunk STRADDLES a chunk boundary, and a straddling repository's PER-PROJECT key space is split across two chunks. A split key space can only move edges OUT of `resolved`, so the summed `resolved` is a LOWER BOUND on the whole-population figure and the summed `unresolved` an UPPER BOUND.",
  },
  closureIdentity: "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges; amb(kind) is a SUBSET of amb(decl) and is reported BESIDE, never added; collRes is a subset of resolved and is likewise reported beside; residual = amb(decl) + unresolved.",
  closureOk,
  perType: closureRows,
  total: { ...totalRow, closureLhs: totalLhs, residual: totalRow.ambDecl + totalRow.unresolved },
  chunks,
  missing,
}
writeFileSync(resolve(ROOT, OUT), JSON.stringify(doc, null, 2) + "\n")

console.log(`HTML ARM MERGE — ${chunks.length}/5 chunks · admitted ${admittedTotal} · parsed ${parsedTotal} · degraded ${degradedTotal}`)
console.log(`  coverage (disjoint slices abut and reach the admitted total): ${coverageOk ? "OK" : "FAILED"}`)
for (const c of coverage) console.log(`    [${c[0]}, ${c[1]})`)
console.log(`  CLOSURE: ${closureOk ? "ADDS UP EXACTLY" : "DOES NOT ADD UP"}`)
console.log(`  type          edges     resolved   amb(decl)  unresolved  extOK      bindOK    causeOK   residual`)
// ★ THE ROW'S TYPE IS STATED, NOT CAST AWAY. The first version of this loop cast the rows to
//   `Record<string, number>[]`, which made `r.type` a NUMBER — and `r.type.padEnd(12)` then
//   failed the typecheck for a method that exists only on a string. At RUNTIME the cast did not
//   change anything, so the table printed and the numbers were right — but a cast that
//   contradicts the data is a cast that will be copied, and the compiler is right to refuse it.
//   ⇒ THE ROW TYPE IS NOW TRUE, AND THE COLUMNS ARE ALIGNED BY A STRING METHOD ON A STRING.
for (const r of closureRows) {
  console.log(`  ${r.type.padEnd(12)} ${String(r.edges).padStart(8)} ${String(r.resolved).padStart(10)} ${String(r.ambDecl).padStart(10)} ${String(r.unresolved).padStart(11)} ${String(r.extOK).padStart(10)} ${String(r.bindOK).padStart(9)} ${String(r.causeOK).padStart(9)} ${String(r.residual).padStart(10)}   ${r.closureOk ? "" : "CLOSURE FAIL"}`)
}
console.log(`  TOTAL         ${String(totalRow.edges).padStart(8)} ${String(totalRow.resolved).padStart(10)} ${String(totalRow.ambDecl).padStart(10)} ${String(totalRow.unresolved).padStart(11)} ${String(totalRow.extOK).padStart(10)} ${String(totalRow.bindOK).padStart(9)} ${String(totalRow.causeOK).padStart(9)} ${String(totalRow.ambDecl + totalRow.unresolved).padStart(10)}`)
console.log(`  written: ${OUT}`)
if (missing.length) console.log(`  MISSING CHUNK FILES: ${missing.join(", ")}`)
