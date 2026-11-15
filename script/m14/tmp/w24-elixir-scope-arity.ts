/**
 * W24 #17 (review E7): rewrite elixir fixture expectation edge SOURCES from
 * the bare collision identity (`Mod.fn`) to the arity-qualified scope
 * identity (`Mod.fn/N`) now emitted by the analyzer.
 *
 * Every rewrite is verified against ACTUAL analyzer output for that fixture:
 * an entry changes only when actual edges exist for the corresponding
 * arity-qualified source (same type/target, same line when the entry pins
 * one; forbidden entries fall back to the base's unique arity form to keep
 * the negative pin meaningful). Module-scoped sources never match the `/N`
 * probe and are left untouched.
 *
 * Run: bun script/m14/tmp/w24-elixir-scope-arity.ts [--dry]
 */
import * as fs from "fs"
import * as path from "path"
import { getParser } from "../run-fixtures"

const ROOT = process.env.BB_M14_ROOT
  ? path.resolve(process.env.BB_M14_ROOT)
  : path.resolve(import.meta.dir, "..", "..", "..")
const DIR = path.join(ROOT, "validation", "m14", "fixtures", "elixir")
const DRY = process.argv.includes("--dry")

const parser = await getParser("elixir")
const mod: any = await import(path.join(ROOT, "src", "ast", "real-elixir-analyzer"))
const analyzer = new mod.RealElixirAnalyzer()

let filesChanged = 0
let entriesChanged = 0
const report: string[] = []

for (const src of fs.readdirSync(DIR).filter(f => f.endsWith(".ex")).sort()) {
  const base = src.slice(0, -3)
  const expPath = path.join(DIR, `${base}.expectation.json`)
  if (!fs.existsSync(expPath)) continue
  const content = fs.readFileSync(path.join(DIR, src), "utf8")
  const tree = parser.parse(content)
  const result = analyzer.analyze(tree.rootNode, content, `fixtures/elixir/${src}`)
  const actual: any[] = (result.relationships ?? []).map((r: any) => ({ ...r, from: r.source }))

  // bare-scope -> arity-qualified forms actually present in this fixture's output
  const arityFroms = new Map<string, Set<string>>()
  for (const r of actual) {
    if (typeof r.from !== "string") continue
    const m = r.from.match(/^(.*)\/(\d+)$/)
    if (!m) continue
    let s = arityFroms.get(m[1]!)
    if (!s) { s = new Set(); arityFroms.set(m[1]!, s) }
    s.add(r.from)
  }

  const raw = fs.readFileSync(expPath, "utf8")
  const exp = JSON.parse(raw)
  const expects: any[] = exp.expectRelationships ?? []
  const decisions: Record<string, (string | null)[]> = { expectRelationships: [], forbidRelationships: [] }
  for (const section of ["expectRelationships", "forbidRelationships"] as const) {
    for (const entry of (exp[section] ?? []) as any[]) {
      const from = entry.from
      if (typeof from !== "string") continue
      const type = entry.type
      const target = entry.target
      const line = entry.line_number
      // Exact-match against actual for the CURRENT source spelling: keep.
      const exact = actual.some(r =>
        r.type === type && r.from === from && r.target === target &&
        (line === undefined || r.line_number === line))
      if (exact) { decisions[section]!.push(null); continue }
      const cands = arityFroms.get(from)
      if (!cands) { decisions[section]!.push(null); continue }
      const list = [...cands]
      let pick = list.find(c => actual.some(r =>
        r.type === type && r.from === c && r.target === target &&
        (line === undefined || r.line_number === line)))
      if (!pick && line !== undefined) {
        pick = list.find(c => actual.some(r => r.type === type && r.from === c && r.target === target))
      }
      if (!pick && section === "expectRelationships") {
        // Expected edge not found at any arity form — leave for the runner to report.
        decisions[section]!.push(null); continue
      }
      if (!pick) pick = list[0] // forbid entry: keep the negative pin on the base's arity form
      // A forbid must never contradict an expect: when the arity form of this
      // exact (type, from, target) is what the fixture REQUIRES, the bare form
      // is the defect spelling — keep it as the revert-detector (mutants that
      // re-introduce the collision identity emit the bare source and are
      // caught by it).
      if (section === "forbidRelationships" &&
          expects.some(e => e.type === type && e.from === pick && e.target === target)) {
        decisions[section]!.push(null); continue
      }
      decisions[section]!.push(pick)
    }
  }
  // TEXT-PRESERVING application: rewrite only the `"from": "…"` VALUE tokens,
  // in section order (occurrences of `from` inside a relationship section map
  // 1:1, in order, to entries that carry a from). Original formatting — not
  // merely the JSON value — is preserved byte-for-byte everywhere else.
  let out = raw
  let changed = 0
  for (const [section, list] of Object.entries(decisions)) {
    if (list.every(d => d === null)) continue
    const secIdx = out.indexOf(`"${section}"`)
    if (secIdx < 0) continue
    const others = ["expectRelationships", "forbidRelationships"]
      .filter(s => s !== section)
      .map(s => out.indexOf(`"${s}"`))
      .filter(i => i > secIdx)
    const end = others.length ? Math.min(...others) : out.length
    const span = out.slice(secIdx, end)
    let k = -1
    const newSpan = span.replace(/"from":\s*"([^"]*)"/g, (m) => {
      k++
      const d = list[k]
      if (!d) return m
      changed++
      return `"from": "${d}"`
    })
    out = out.slice(0, secIdx) + newSpan + out.slice(end)
  }
  if (changed > 0) {
    filesChanged++
    entriesChanged += changed
    report.push(`${base}: ${changed} entr${changed === 1 ? "y" : "ies"}`)
    if (!DRY) fs.writeFileSync(expPath, out)
  }
}

console.log(report.join("\n"))
console.log(`\n${DRY ? "[dry] " : ""}${filesChanged} file(s), ${entriesChanged} entr${entriesChanged === 1 ? "y" : "ies"} rewritten`)
