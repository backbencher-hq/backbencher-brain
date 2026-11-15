/**
 * PER-TYPE RESOLUTION — do both endpoints of an emitted edge bind to a real symbol?
 *
 * ## The question
 *
 * An edge whose endpoints name nothing is stored and compared against nothing. It counts
 * toward a payload, inflates a graph, and produces wrong refactoring advice in `bb_impact`
 * when a fake caller is invented. So the resolution rate of each relationship type is a
 * first-class measurement, not a footnote — and the CSS `references` figure (66.8% at both
 * ends) is the reference point this lane is read against.
 *
 * This resolves each endpoint against the symbol set of its OWN FILE, then, for the types
 * whose source is published by another file, reports the whole-corpus symbol name set as
 * well. The distinction matters: a cross-file edge fails to resolve under the first rule
 * and succeeds under the second, and reporting only one of the two makes a correct edge
 * look broken or a broken edge look fine.
 *
 * ## What counts as resolved
 *
 * An endpoint resolves when its name is in the symbol name set. A name is NOT a match
 * against the qualified name, and an endpoint equal to the literal `unknown` is counted as
 * unresolved regardless — an unresolved `unknown` that happens to collide with a declared
 * name would otherwise score as a success.
 *
 * ## Population
 *
 * The same deterministic 600-file production `parseFile` census every other dart number in
 * this lane comes from, named by its own list digest (dart-600-8237d3e31ac2), so a stale
 * sample cannot be read as this one.
 *
 * Run: npx tsx validation/m14/fixtures/dart/resolution-rate-600.ts
 */
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"

const RAW = "validation/m14/measurements/dart-600-8237d3e31ac2.raw.ndjson"
if (!existsSync(RAW)) throw new Error(`${RAW} absent — run validation/m14/fixtures/dart/collect-sample.ts first`)

interface Rel { t: string; s: string; g: string; line: number; c: number }
interface Sym { name: string; kind: string; q: string; line: number }
const rows: { f: string; symbols: Sym[]; rels: Rel[] }[] = []
for (const line of readFileSync(RAW, "utf8").split("\n")) {
  if (!line) continue
  try { rows.push(JSON.parse(line)) } catch { /* torn final line */ }
}

const corpusNames = new Set<string>()
for (const r of rows) for (const s of r.symbols) { corpusNames.add(s.name); if (s.q) corpusNames.add(s.q) }

interface Acc { n: number; sOk: number; gOk: number; bothOk: number; unkS: number; unkG: number; hiConf: number; loConf: number }
const acc = new Map<string, Acc>()
const bump = (t: string) => {
  let a = acc.get(t)
  if (!a) { a = { n: 0, sOk: 0, gOk: 0, bothOk: 0, unkS: 0, unkG: 0, hiConf: 0, loConf: 0 }; acc.set(t, a) }
  return a
}

for (const row of rows) {
  const names = new Set<string>()
  for (const s of row.symbols) { names.add(s.name); if (s.q) names.add(s.q) }
  for (const r of row.rels) {
    const a = bump(r.t)
    a.n++
    if (r.c < 0.7) a.loConf++; else a.hiConf++
    const sU = r.s === "unknown" || r.s === ""
    const gU = r.g === "unknown" || r.g === ""
    if (sU) a.unkS++
    if (gU) a.unkG++
    const sOk = !sU && names.has(r.s)
    const gOk = !gU && names.has(r.g)
    if (sOk) a.sOk++
    if (gOk) a.gOk++
    if (sOk && gOk) a.bothOk++
  }
}

/** Cross-file pass: the same endpoints against every symbol name in the census. */
const acc2 = new Map<string, Acc>()
for (const row of rows) {
  for (const r of row.rels) {
    let a = acc2.get(r.t)
    if (!a) { a = { n: 0, sOk: 0, gOk: 0, bothOk: 0, unkS: 0, unkG: 0, hiConf: 0, loConf: 0 }; acc2.set(r.t, a) }
    a.n++
    const sU = r.s === "unknown" || r.s === ""
    const gU = r.g === "unknown" || r.g === ""
    if (sU) a.unkS++
    if (gU) a.unkG++
    const sOk = !sU && corpusNames.has(r.s)
    const gOk = !gU && corpusNames.has(r.g)
    if (sOk) a.sOk++
    if (gOk) a.gOk++
    if (sOk && gOk) a.bothOk++
  }
}

const pct = (x: number, n: number) => (n ? (100 * x) / n : 0).toFixed(1).padStart(5)

console.log(`per-type resolution — population: ${rows.length} files, one production parseFile each`)
console.log(`raw: ${RAW}`)
console.log(`distinct symbol names in the census: ${corpusNames.size}\n`)

console.log(`WITHIN-FILE (an endpoint resolves against the symbols of ITS OWN file)`)
console.log(`  ${"type".padEnd(13)}${"edges".padStart(8)}${"src".padStart(8)}${"tgt".padStart(8)}${"both".padStart(8)}${"src%".padStart(7)}${"tgt%".padStart(7)}${"both%".padStart(7)}`)
for (const [t, a] of [...acc.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(`  ${t.padEnd(13)}${String(a.n).padStart(8)}${String(a.sOk).padStart(8)}${String(a.gOk).padStart(8)}${String(a.bothOk).padStart(8)}${pct(a.sOk, a.n)}${pct(a.gOk, a.n)}${pct(a.bothOk, a.n)}`)
}

console.log(`\nWITHIN-CENSUS (every symbol name in all ${rows.length} files — a cross-file edge's fair test)`)
console.log(`  ${"type".padEnd(13)}${"edges".padStart(8)}${"src".padStart(8)}${"tgt".padStart(8)}${"both".padStart(8)}${"src%".padStart(7)}${"tgt%".padStart(7)}${"both%".padStart(7)}`)
for (const [t, a] of [...acc2.entries()].sort((x, y) => y[1].n - x[1].n)) {
  console.log(`  ${t.padEnd(13)}${String(a.n).padStart(8)}${String(a.sOk).padStart(8)}${String(a.gOk).padStart(8)}${String(a.bothOk).padStart(8)}${pct(a.sOk, a.n)}${pct(a.gOk, a.n)}${pct(a.bothOk, a.n)}`)
}

let tn = 0, tb = 0, tl = 0
for (const a of acc.values()) { tn += a.n; tb += a.bothOk; tl += a.loConf }
console.log(`
TOTALS
  edges                                   ${tn}
  resolved at both ends (within-file)     ${tb}  (${((100 * tb) / tn).toFixed(1)}%)
  confidence < 0.7                        ${tl}  (${((100 * tl) / tn).toFixed(1)}%) — heuristics, not facts
  endpoints equal to literal 'unknown'    ${[...acc.values()].reduce((s, a) => s + a.unkS + a.unkG, 0)}

  The CSS reference point named in the workstream brief is \`references\` at 66.8% of its edges
  resolving at BOTH ends. This lane's \`references\` row is the number to compare it against,
  and it is reported at both grains because a cross-file type cannot be judged on the
  within-file figure alone.`)