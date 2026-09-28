// tmp-elixir-census.ts — dual-lens corpus census for the Elixir analyzer.
// Measures: relationship line coverage (M59), self-loop contains, call edges,
// dropped-unqualified impact, @derive form coverage — on the real corpus.
import { parseFile } from "../src/ast/pool-worker"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const CORPUS = "$HOME/fixtures/repositories/elixir/lib"
const files: string[] = []
function walk(d: string) {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (e.endsWith(".ex")) files.push(p)
    if (files.length >= 120) return
  }
}
walk(CORPUS)

const totals = { files: 0, symbols: 0, rels: 0, withLine: 0, noLine: 0, selfContains: 0, selfCalls: 0 }
const byType: Record<string, { n: number; withLine: number }> = {}
const symKinds: Record<string, number> = {}
const fw: Record<string, number> = {}
const derivList: string[] = []

for (const f of files) {
  const src = readFileSync(f, "utf8")
  const hasDeriveList = /@derive\s*\[/.test(src)
  const r: any = await parseFile(f).catch(() => null)
  if (!r || r.success === false) continue
  totals.files++
  for (const s of r.symbols) {
    totals.symbols++
    symKinds[s.kind] = (symKinds[s.kind] ?? 0) + 1
  }
  for (const rel of r.relationships) {
    totals.rels++
    const t = rel.type
    byType[t] = byType[t] ?? { n: 0, withLine: 0 }
    byType[t].n++
    const ln = rel.line_number ?? rel.lineNumber
    if (typeof ln === "number" && ln > 0) { totals.withLine++; byType[t].withLine++ } else totals.noLine++
    if (rel.source === rel.target && t === "contains") totals.selfContains++
    if (rel.source === rel.target && t === "calls") totals.selfCalls++
  }
  if (hasDeriveList) derivList.push(f.replace(CORPUS + "/", ""))
}

console.log("=== ELIXIR CORPUS CENSUS (elixir-lang repo) ===")
console.log("files parsed:", totals.files, "| symbols:", totals.symbols, "| relationships:", totals.rels)
console.log(`\nM59 LINE COVERAGE:`)
console.log(`  with line_number: ${totals.withLine}  (${(100 * totals.withLine / Math.max(1, totals.rels)).toFixed(2)}%)`)
console.log(`  without line:     ${totals.noLine}`)
console.log("\nby relationship type (n / withLine):")
for (const [t, v] of Object.entries(byType).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${t.padEnd(14)} ${String(v.n).padStart(6)} / ${v.withLine}`)
}
console.log("\nsymbol kinds:", JSON.stringify(symKinds))
console.log("self-loop contains edges:", totals.selfContains, "| self-loop calls (recursion):", totals.selfCalls)
console.log("\nfiles using LIST-form @derive:", derivList.length)
for (const d of derivList.slice(0, 8)) console.log("  ", d)
process.exit(0)
