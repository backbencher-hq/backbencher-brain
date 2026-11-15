/**
 * error-invented-names — the ISOLATED CHILD of `script/m14/clean-error-impact.mts`.
 *
 * Parses EXACTLY ONE path through production `parseFile` and reports, for each invented
 * name the caller names, whether that name became a published symbol and whether any
 * relationship points at it.
 *
 * `parseFile` from `src/ast/pool-worker.ts` is the production entry. `analyze()` is
 * deliberately NOT used: it is a per-file unit that skips the pipeline stages (pool,
 * timeouts, truncation, enhancements), so a count from it is not a count from the
 * pipeline. This is also the child of `clean-excluded-probe.mts`, for the same reason —
 * one process per path, so a 120 s wall-clock timeout on the parent cannot contaminate a
 * file that would walk with the machine to itself.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/clean/error-invented-names.mts <abs path> '<json [{name,line,family}]>'
 *
 * Output is ONE JSON object on stdout. Exit 0 whether the file walked or not — an
 * outcome of HUNG/ERRORED is a measurement, and this script reports it rather than
 * exiting non-zero and leaving the caller to guess which of the two it was.
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const target = process.argv[2]
const want: { name: string; line: number; family: string }[] = (() => {
  try { return JSON.parse(process.argv[3] ?? "[]") } catch { return [] }
})()

if (!target) {
  console.error(`usage: error-invented-names.mts <abs path> '<json [{name,line,family}]>'`)
  process.exit(2)
}

const t0 = Date.now()
let result: Awaited<ReturnType<typeof parseFile>>
try {
  result = await parseFile(target)
} catch (e) {
  process.stdout.write(JSON.stringify({
    path: target, outcome: "ERRORED", ms: Date.now() - t0,
    error: (e as Error).message.slice(0, 500), symbols: 0, edges: 0, findings: [],
  }) + "\n")
  process.exit(0)
}

const symbols = (result?.symbols ?? []) as any[]
const relationships = (result?.relationships ?? []) as any[]

/** The two endpoint spellings that actually occur in `UniversalRelationship`. */
const ends = (r: any): [string, string] => [
  String(r.source ?? r.from ?? r.fromSymbol ?? ""),
  String(r.target ?? r.to ?? r.toSymbol ?? ""),
]

/**
 * `parseFile` RETURNS FLAT SYMBOLS — `startLine`/`endLine` sit at the TOP level, not under
 * `range` — while `UniversalSymbol` in `src/ast/types.ts:104` declares them under `range`.
 * Both spellings occur across the pipeline, so read either. The first version read only
 * `range.startLine`, every line came back `undefined -> 0`, and `symLines` was `[0,0,0,0]`
 * for a symbol with four copies at lines 86, 106, 110 and 113. A column that is always
 * zero cannot distinguish one symbol from four, which is the whole question here.
 */
const lineOf = (s: any): number =>
  Number(s.range?.startLine ?? s.startLine ?? s.line ?? s.lineNumber ?? -1)

type Finding = {
  name: string; family: string
  censusLines: number[]
  copies: number
  symbols: { kind: string; visibility: string; start: number; end: number; qualifiedName: string }[]
  atCensusLine: boolean
  asSource: number; asTarget: number; asSourceTypes: Record<string, number>; asTargetTypes: Record<string, number>
}

/**
 * EDGES ARE COUNTED ONCE PER (file, name), NOT ONCE PER CENSUS ROW. An edge carries a
 * NAME at each end, never a line, so every row that names the same symbol in the same
 * file matches the same edge. The first version reported 22 edges for each of three
 * census rows of `WID` in windowaccess.icl — 66 — where the file contains 16 distinct
 * edges touching `WID`. The inflated figure was this defect, not a property of the
 * analyzer, and it would have overstated the damage by 4x on exactly the family that
 * turns out to matter most. `censusLines` keeps every line the census reported so the
 * per-row attribution stays re-derivable.
 */
const byName = new Map<string, { rows: typeof want; edges: { s: string; t: string; ty: string }[] }>()
for (const w of want) {
  const k = String(w.name ?? "")
  const e = byName.get(k) ?? { rows: [], edges: [] }
  e.rows.push(w)
  byName.set(k, e)
}
for (const [key, e] of byName) {
  const seen = new Set<string>()
  for (const r of relationships) {
    const [s, t] = ends(r)
    const ty = String(r.type ?? r.relationshipType ?? "")
    if (s !== key && t !== key) continue
    const k2 = `${s}|${t}|${ty}`
    if (seen.has(k2)) continue
    seen.add(k2)
    e.edges.push({ s, t, ty })
  }
}

function collect(key: string): Finding {
  const grp = byName.get(key)!
  const mine = symbols.filter((s) => String(s.name ?? "") === key)
  const censusLines = grp.rows.map((r) => Number(r.line ?? 0)).sort((a, b) => a - b)
  let asSource = 0, asTarget = 0
  const asSourceTypes: Record<string, number> = {}
  const asTargetTypes: Record<string, number> = {}
  for (const e of grp.edges) {
    if (e.s === key) { asSource++; asSourceTypes[e.ty] = (asSourceTypes[e.ty] ?? 0) + 1 }
    if (e.t === key) { asTarget++; asTargetTypes[e.ty] = (asTargetTypes[e.ty] ?? 0) + 1 }
  }
  const syms = mine.map((s) => ({
    kind: String(s.kind ?? ""), visibility: String(s.visibility ?? ""),
    start: lineOf(s), end: Number(s.range?.endLine ?? s.endLine ?? -1),
    qualifiedName: String(s.qualifiedName ?? ""),
  }))
  return {
    name: key, family: grp.rows[0]?.family ?? "", censusLines, copies: mine.length,
    symbols: syms,
    atCensusLine: censusLines.some((l) => syms.some((s) => s.start === l)),
    asSource, asTarget, asSourceTypes, asTargetTypes,
  }
}
/**
 * ONE FINDING PER DISTINCT NAME, NOT ONE PER CENSUS ROW. `censusRows` is the census's
 * population (one row per grammar node) and `names` is the symbol-table population (one
 * row per name the analyzer published a symbol for); the second version of this file
 * emitted `want.map(...)` and therefore wrote the same finding N times whenever the census
 * saw a name in three signatures, which made the NDJSON a count of mentions while its own
 * field names claimed a count of names. The parent sums `censusRows` and `names`
 * separately for exactly this reason; this end has to emit the deduplicated half.
 */
const findings: Finding[] = [...byName.keys()].map((k) => collect(k))

process.stdout.write(JSON.stringify({
  path: target, outcome: "PARSED", ms: Date.now() - t0,
  symbols: symbols.length, edges: relationships.length,
  parseErrors: (result?.errors ?? []).length,
  findings,
}) + "\n")