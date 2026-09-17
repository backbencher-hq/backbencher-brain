// script/m59/merge-matrix-halves.ts — merge matrix half-runs into the canonical
// evidence file. The sweep is too slow for one command budget, so it runs in
// halves with --out=; this merges them WITHOUT hiding that fact: the merged
// payload records every contributing run (file, time, commit, languages) and the
// aggregate is recomputed from the merged cells, never copied from a half.
//
// Usage: npx tsx script/m59/merge-matrix-halves.ts <half.json> [more.json ...]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m59/results/matrix-tool-language.json")

const inputs = process.argv.slice(2).filter((a) => a.endsWith(".json"))
if (inputs.length === 0) {
  console.error("usage: merge-matrix-halves.ts <half.json> [more.json ...]")
  process.exit(1)
}

type Cell = Record<string, any>
const cells: Cell[] = []
const languages: any[] = []
const runs: any[] = []
const seen = new Set<string>()

for (const rel of inputs) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel)
  const d = JSON.parse(readFileSync(abs, "utf8"))
  runs.push({
    file: path.relative(ROOT, abs),
    at: d.at,
    commit: d.commit,
    languages: (d.languages ?? []).map((l: any) => l.lang),
    cells: (d.cells ?? []).length,
  })
  for (const l of d.languages ?? []) languages.push(l)
  for (const c of d.cells ?? []) {
    const key = `${c.lang}|${c.repo}|${c.callee}`
    if (seen.has(key)) continue
    seen.add(key)
    cells.push(c)
  }
}

const sum = (f: (c: Cell) => number) => cells.reduce((a, c) => a + f(c), 0)
const agg = {
  cells: cells.length,
  wrongLine: sum((c) => c.wrongLine ?? 0),
  missed: sum((c) => c.missed ?? 0),
  missedUpperBound: sum((c) => c.missedUpperBound ?? 0),
  ambiguousCells: cells.filter((c) => (c.nameMultiplicity ?? 0) > 1).length,
  consistent: sum((c) => c.consistent ?? 0),
  unknownLine: sum((c) => c.unknownLine ?? 0),
  notCheckable: sum((c) => c.notCheckable ?? 0),
  grepMentions: sum((c) => c.grepMentions ?? 0),
  grepRealCalls: sum((c) => c.grepRealCalls ?? 0),
  grepOnlyNoise: sum((c) => c.grepOnlyNoise ?? 0),
  mutationsCaught: languages.filter((l) => l.mutation?.caught).length,
  languagesMeasured: languages.length,
}

const payload = {
  probe: "M59.MTX",
  at: new Date().toISOString(),
  mergedFrom: runs,
  scope:
    "MERGED from separate half-runs (the sweep exceeds one command budget). " +
    "bb_graph driven through the REAL MCP handler on file slices of real corpus repos; " +
    "predicate is a NECESSARY condition (lower bound), so \"consistent\" is never proof of correctness; " +
    "\"missed\" is only reported when the callee name maps to exactly one symbol (ambiguous names print AMBIG(k)); " +
    "every language reports whether its in-run mutation actually turned the audit red",
  languages,
  cells,
  aggregate: agg,
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(payload, null, 2))

console.log(`merged ${runs.length} run(s) → ${path.relative(ROOT, OUT)}`)
for (const r of runs) console.log(`  ${r.file}: ${r.languages.join(",")} cells=${r.cells} at=${r.at}`)
console.log(
  `languages=${agg.languagesMeasured} cells=${agg.cells} consistent=${agg.consistent} WRONG=${agg.wrongLine} unknown=${agg.unknownLine} notCheckable=${agg.notCheckable} mutationsCaught=${agg.mutationsCaught}/${agg.languagesMeasured}`,
)
if (agg.wrongLine > 0) process.exitCode = 1
