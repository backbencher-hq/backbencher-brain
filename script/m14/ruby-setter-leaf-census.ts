/**
 * THE SETTER-LEAF CENSUS — the shape test's `=` refusal, measured over the whole admitted population.
 *
 * ⇒ WHAT HAPPENED. The shared `filterNoiseRelationships` used to refuse a target whose leaf was
 * longer than 80 characters. THAT BUDGET WAS MEASURED AGAINST BY THIS LANE (the four
 * `ExecutionFinalizeTest.test_multiple_offenses_for_non_null_position_without_intersecting_…` rows,
 * leaf lengths 98/96/98/96, with a short-target control beside them) and the shared file REPLACED IT
 * with a shape test — which is right in its intent, a snippet is not an IDENTIFIER, it carries
 * characters an identifier cannot.
 *
 * ⇒ BUT THE REPLACEMENT'S CHARACTER SET INCLUDES `=`, AND IN RUBY `=` IS A LEGAL IDENTIFIER
 * CHARACTER: `attr_accessor :level` declares a writer named `level=`, and `def level=(v)` is an
 * ordinary setter definition. **⇒ EVERY RUBY SETTER NAME ENDS IN `=`, AND EVERY SETTER `contains`
 * EDGE IS THEREFORE SILENTLY EATEN BY THE NEW SHAPE TEST.** The loss is SILENT in the worst sense:
 * the edges are ABSENT from the graph rather than mis-bound, so no column and no count shows it.
 * The operator-name exemption (a leaf made SOLELY of operator characters) does not cover it —
 * `level=` mixes letters with the operator character.
 *
 * ⇒ THE MEASUREMENT. Over the whole admitted population: run the PRODUCTION path
 * (`pool-worker.parseFile`) and the DIRECT path (`analyze()`) on every file, diff the row sets by
 * key, and CLASSIFY every row the production path drops by the shape of its target leaf. Then hand
 * the dropped rows to `filterNoiseRelationships` directly, with a CONTROL beside them: the same row
 * with the `=` removed is KEPT, so the analyzer emitted it and the filter ate it — a measurement and
 * not a report.
 *
 * EXIT CODE: 0. The counts are the answer; a non-zero exit would be a claim, and this file makes
 * none.
 */
import { parseFile, filterNoiseRelationships } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"
import { RealRubyAnalyzer } from "../../src/ast/real-ruby-analyzer"
import { readFileSync, statSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const MAX_BYTES = 1024 * 1024

// ── THE POPULATION: the corpus is MANY git repos under `.corpus/`, not one repo ──────────────────
const files: string[] = []
{
  let entries: string[] = []
  try { entries = readdirSync(CR) } catch { entries = [] }
  const seen = new Set<string>()
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".rb")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
      if (seen.has(abs)) continue
      seen.add(abs)
      files.push(abs)
    }
  }
}

const key = (r: any) => `${r.type}|${r.source}|${r.target}|${JSON.stringify(r.metadata ?? {})}`
const leafOf = (t: string) => {
  const s = String(t ?? "")
  const i = Math.max(s.lastIndexOf("."), s.lastIndexOf(":"), s.lastIndexOf("#"))
  return (i >= 0 ? s.slice(i + 1) : s).trim()
}

// ⇒ THE TWO ARMS RUN IN SEPARATE PROCESSES, AND THAT IS NOT COSMETIC.
// The tree-sitter WASM parser is a CACHED SINGLETON (`getParser`), and the PRODUCTION path parses
// through it too. Interleaving `parser.parse()` with `parseFile()` on the same instance corrupts
// the WASM heap — the first run of this instrument died with "Out of bounds memory access
// (evaluating 'C._ts_parser_parse_wasm…')" on 20 files. ⇒ SO EACH ARM WRITES ITS OWN ROW SET TO
// ITS OWN FILE, AND A THIRD PASS DIFFS THE TWO FILES. NO PROCESS EVER PARSES WITH BOTH ARMS.
const ARM = (process.argv.find(a => a.startsWith("--arm=")) ?? "--arm=direct").split("=")[1]
const OUT_DIR = path.join(CR, "..", "validation", "m14", "measurements")

type Dropped = {
  file: string
  type: string
  source: string
  target: string
  leaf: string
  leafLength: number
  shape: "hasEquals" | "noEquals"
  eatenByFilterAlone: boolean
  controlKept: boolean
}

const dropped: Dropped[] = []
let productionRows = 0
let directRows = 0
let parseFailures = 0

mkdirSync(OUT_DIR, { recursive: true })
const armFile = path.join(OUT_DIR, `ruby-setter-leaf-census-${ARM}.json`)

if (ARM === "direct" || ARM === "production") {
  const out: Record<string, any[]> = {}
  for (const abs of files) {
    const rel = path.relative(CR, abs)
    let rows: any[] = []
    try {
      if (ARM === "production") {
        const prod = await parseFile(abs, "ruby" as any)
        rows = (prod.relationships ?? []) as any[]
      } else {
        const content = readFileSync(abs, "utf8")
        const parser = await getParser("ruby" as any)
        const analyzer = new RealRubyAnalyzer()
        const direct = await analyzer.analyze(parser.parse(content).rootNode, content, abs)
        rows = (direct.relationships ?? []) as any[]
      }
    } catch (e) { parseFailures++; continue }
    out[rel] = rows.map(r => ({ type: r.type, source: r.source, target: r.target, metadata: r.metadata ?? {} }))
  }
  writeFileSync(armFile, JSON.stringify(out))
  console.log(`RUBY — the ${ARM} arm wrote ${Object.keys(out).length} file(s) to ${armFile} · ${parseFailures} failure(s)`)
  process.exit(0)
}

// ⇒ THE DIFF PASS. Both arm files exist; nothing is parsed here, so no process touches the parser.
const directMap = JSON.parse(readFileSync(path.join(OUT_DIR, "ruby-setter-leaf-census-direct.json"), "utf8")) as Record<string, any[]>
const prodMap = JSON.parse(readFileSync(path.join(OUT_DIR, "ruby-setter-leaf-census-production.json"), "utf8")) as Record<string, any[]>
for (const rel of Object.keys(directMap)) {
  const dRows = directMap[rel] ?? []
  const pRows = prodMap[rel] ?? []
  productionRows += pRows.length
  directRows += dRows.length
  const pSet = new Set(pRows.map(key))
  for (const r of dRows) {
    if (pSet.has(key(r))) continue
    const leaf = leafOf(r.target)
    // ASK THE FILTER DIRECTLY, WITH A CONTROL BESIDE IT: the same row with the offending character
    // removed must be KEPT, or the "the filter ate it" claim has no control and is only a report.
    const alone = filterNoiseRelationships([{ ...r }] as any, "ruby" as any)
    const eaten = alone.length === 0
    const control = filterNoiseRelationships([{ ...r, target: leaf.replace(/=/g, "") }] as any, "ruby" as any)
    dropped.push({
      file: rel,
      type: r.type,
      source: String(r.source ?? ""),
      target: String(r.target ?? ""),
      leaf,
      leafLength: leaf.length,
      shape: leaf.includes("=") ? "hasEquals" : "noEquals",
      eatenByFilterAlone: eaten,
      controlKept: control.length > 0,
    })
  }
}

const withEquals = dropped.filter(d => d.shape === "hasEquals")
const withoutEquals = dropped.filter(d => d.shape === "noEquals")
const allEaten = dropped.length > 0 && dropped.every(d => d.eatenByFilterAlone)
const allControlled = dropped.length > 0 && dropped.every(d => d.controlKept)
const byType: Record<string, number> = {}
for (const d of dropped) byType[d.type] = (byType[d.type] ?? 0) + 1

const report = {
  population: { corpusRoot: CR, admitted: files.length, parseFailures },
  productionRows,
  directRows,
  productionMinusDirect: productionRows - directRows,
  droppedRows: dropped.length,
  droppedByType: byType,
  droppedWithEqualsInLeaf: withEquals.length,
  droppedWithoutEqualsInLeaf: withoutEquals.length,
  everyDroppedRowIsEatenByTheFilterAlone: allEaten,
  everyDroppedRowHasAControlThatIsKept: allControlled,
  theRoot:
    "The shared filter's replacement shape test refuses a leaf containing `=`. In ruby `=` is a LEGAL IDENTIFIER CHARACTER: `attr_accessor :level` declares a writer named `level=`, and `def level=(v)` is an ordinary setter. So every ruby setter's `contains` (and `overrides`) row is silently eaten.",
  theRemedy:
    "The shape test's character set must treat `=` as legal when it is a TRAILING setter marker — the same way the operator rule already exempts a leaf made SOLELY of operator characters. A leaf that ENDS in `=` and is otherwise an identifier is a setter name, not a snippet; a leaf that CONTAINS `=` in the middle is still a fragment and is still refused.",
  examples: dropped.slice(0, 14),
  instrument: "script/m14/ruby-setter-leaf-census.ts",
}
mkdirSync(path.join(CR, "..", "validation", "m14", "measurements"), { recursive: true })
writeFileSync(
  path.join(CR, "..", "validation", "m14", "measurements", "ruby-setter-leaf-census-2026-10-21.json"),
  JSON.stringify(report, null, 2) + "\n",
)

console.log("RUBY — THE SETTER-LEAF CENSUS (the `=` shape test)")
console.log(`  population ${files.length} admitted .rb · parse failures ${parseFailures}`)
console.log(`  production ${productionRows} rows · direct ${directRows} rows · Δ ${productionRows - directRows}`)
console.log(`  dropped by production: ${dropped.length}  (${JSON.stringify(byType)})`)
console.log("  => dropped WITH an '=' in the leaf: " + withEquals.length + " · WITHOUT: " + withoutEquals.length)
console.log(`  ⇒ every dropped row is eaten by the filter when handed to it ALONE: ${allEaten}`)
console.log("  => every dropped row has a CONTROL (the same row without '=') that is KEPT: " + allControlled)
for (const d of dropped.slice(0, 8)) {
  console.log(`      ${d.file}  ${d.type} ${d.source} -> ${d.target}  leaf="${d.leaf}" len=${d.leafLength} eaten=${d.eatenByFilterAlone} controlKept=${d.controlKept}`)
}
