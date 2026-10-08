/**
 * KOTLIN EXPORTS DIFFERENTIAL — analyzer output against the independent
 * `deriveKotlinExportsTruth` oracle, on real corpus files, per file.
 *
 * WHAT IT SETTLES. `exports` was measured at 0 relationships across 8,664
 * Kotlin edges (firing-check-v2 NFILES=200). The `exports[]` ARRAY was carrying
 * 690 entries in 185 of 200 files. So the lane had an export SET and no export
 * EDGE, and the only question was whether the set the array carries is the set
 * the language actually exposes. This script answers that both directions:
 *
 *   oracle -> analyzer   a declaration the language exposes that the analyzer
 *                        never publishes as an edge (a silent drop: the exact
 *                        failure the ontology gate exists for)
 *   analyzer -> oracle   an edge the analyzer publishes that is not exported in
 *                        the language (a fabrication: counted as unexplained by
 *                        every consumer and it poisons bb_graph / bb_impact /
 *                        bb_migrate)
 *   array vs oracle      the SAME set read off `res.exports[]`, so the array and
 *                        the edges cannot quietly disagree with each other —
 *                        measured separately because a drift between them is a
 *                        different defect from a wrong rule.
 *
 * MATCHING is on `target` NAME within a file. Names are exact after backtick
 * stripping on both sides. A line number is compared but NOT required to match:
 * the oracle reads `startPosition.row` on the declaration node and the analyzer
 * reads `symbolRange`, which by the lane's M11 convention starts at the
 * ANNOTATION line for an annotated declaration. That is a deliberate difference
 * and it is counted and reported (`lineMismatch`), not hidden.
 *
 * NO REGEX anywhere: file sampling is string `includes` against the grammar-
 * derived signal set, and every comparison is a Map lookup.
 *
 * USAGE
 *   bun script/m14/kotlin-exports-diff.ts [repoDir ...]
 *   NFILES=200 BB_CORPUS=$HOME/fixtures/repositories bun …
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { deriveKotlinExportsTruth } from "./oracles/kotlin-exports"

const ROOT = process.env.BB_ROOT || join(import.meta.dir, "..", "..")
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES || 200)
const REPOS = process.argv.slice(2).length ? process.argv.slice(2) : ["kotlin"]
const VERBOSE = process.env.VERBOSE === "1"

const SIGNAL = ["fun ", "class ", "val ", "object "]

function pickFiles(dir: string, want: number): string[] {
  const all: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of [...ents].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "build") continue
        walk(p, depth + 1)
      } else if (e.name.endsWith(".kt") || e.name.endsWith(".kts")) {
        try {
          const st = statSync(p)
          if (st.size > 400_000 || st.size < 40) continue
          const src = readFileSync(p, "utf8")
          let hit = false
          for (const s of SIGNAL) if (src.includes(s)) { hit = true; break }
          if (hit) all.push(p)
        } catch {}
      }
    }
  }
  walk(dir, 0)
  if (all.length <= want) return all
  const stride = all.length / want
  const out: string[] = []
  for (let i = 0; i < want; i++) out.push(all[Math.floor(i * stride)])
  return out
}

const { getParser, ASTEngine } = await import(`${ROOT}/src/ast/engine.ts`)
const { RealKotlinAnalyzer } = await import(`${ROOT}/src/ast/real-kotlin-analyzer.ts`)
const parser = await getParser("kotlin")

let files = 0
let parsed = 0
let threw = 0
let errorFiles = 0
let oracleRows = 0
let edgeRows = 0
let arrayRows = 0

const droppedByFile: Array<{ file: string; target: string; line: number; vis: string; kind: string }> = []
const fabricatedByFile: Array<{ file: string; source: string; target: string; conf: number }> = []
const arrayMissing: Array<{ file: string; target: string }> = []
const arrayExtra: Array<{ file: string; target: string }> = []
let matched = 0
let lineMismatch = 0
let arrayMatched = 0
let confNotOne = 0
let badSource = 0

for (const repo of REPOS) {
  const dir = join(CORPUS, repo)
  for (const f of pickFiles(dir, NFILES)) {
    files++
    const content = readFileSync(f, "utf8")
    let root: any
    let res: any
    try {
      root = (await parser.parse(content, f)).rootNode
      res = new RealKotlinAnalyzer().analyze(root, content, f)
      parsed++
    } catch {
      threw++
      continue
    }
    if (root.hasError) errorFiles++

    const truth = deriveKotlinExportsTruth(root)
    const truthKeys = new Set(truth.map((t) => `${t.target}|${t.line}`))
    const truthByTarget = new Map(truth.map((t) => [t.target, t]))
    oracleRows += truth.length

    const edges = (res.relationships || []).filter(
      (r: any) => (r.type ?? r.relationshipType) === ASTEngine.RelationshipType.Exports,
    )
    edgeRows += edges.length
    const edgeKeys = new Set<string>()
    for (const e of edges) {
      const key = `${e.target}|${e.line_number ?? 0}`
      edgeKeys.add(key)
      const t = truthByTarget.get(String(e.target))
      if (t && (e.line_number ?? 0) === t.line) matched++
      else if (t) { matched++; lineMismatch++ }
      if (e.source !== "(file)") badSource++
      if ((e.confidence ?? 1) !== 1) confNotOne++
      if (!truthByTarget.has(String(e.target))) {
        fabricatedByFile.push({ file: f.replace(dir + "/", ""), source: String(e.source), target: String(e.target), conf: e.confidence })
      }
    }
    for (const t of truth) {
      if (!edgeKeys.has(`${t.target}|${t.line}`)) {
        droppedByFile.push({ file: f.replace(dir + "/", ""), target: t.target, line: t.line, vis: t.visibility, kind: t.declarationKind })
      }
    }

    // the ARRAY, compared against the same oracle
    const arr = res.exports || []
    arrayRows += arr.length
    const arrTargets = new Set<string>()
    for (const a of arr) {
      const n = String(a?.name ?? "")
      if (!n) continue
      arrTargets.add(n)
      if (truthByTarget.has(n)) arrayMatched++
    }
    for (const n of arrTargets) if (!truthByTarget.has(n)) arrayExtra.push({ file: f.replace(dir + "/", ""), target: n })
    for (const t of truth) if (!arrTargets.has(t.target)) arrayMissing.push({ file: f.replace(dir + "/", ""), target: t.target })
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : ((n / d) * 100).toFixed(2) + "%")
const L: string[] = []
const show = (arr: any[], n = 15) => {
  if (arr.length === 0) { L.push("   (none)"); return }
  for (const x of arr.slice(0, n)) L.push(`   ${JSON.stringify(x)}`)
  if (arr.length > n) L.push(`   ... and ${arr.length - n} more`)
}

L.push("KOTLIN EXPORTS DIFFERENTIAL (analyzer vs deriveKotlinExportsTruth)")
L.push(`corpus=${CORPUS} repos=${REPOS.join(",")} NFILES=${NFILES}`)
L.push(`files=${files} parsed=${parsed} threw=${threw} errorFiles=${errorFiles}`)
L.push("")
L.push(`oracle truth rows      ${oracleRows}`)
L.push(`analyzer exports EDGES ${edgeRows}`)
L.push(`analyzer exports ARRAY ${arrayRows}`)
L.push("")
L.push(`tree -> analyzer  (silent drops)  ${droppedByFile.length}  ${pct(droppedByFile.length, oracleRows)}`)
L.push(`analyzer -> tree  (fabrications)  ${fabricatedByFile.length}  ${pct(fabricatedByFile.length, edgeRows)}`)
L.push(`matched by target+line            ${matched - lineMismatch} exact, ${lineMismatch} target-only (annotation-line offset), ${lineMismatch} counted as matched above`)
L.push(`edge source !== \"(file)\"            ${badSource}`)
L.push(`edge confidence !== 1             ${confNotOne}`)
L.push("")
L.push(`ARRAY vs ORACLE  present in oracle, missing from array  ${arrayMissing.length}  ${pct(arrayMissing.length, oracleRows)}`)
L.push(`ARRAY vs ORACLE  in array, not exported in the language ${arrayExtra.length}  ${pct(arrayExtra.length, arrayRows)}`)
L.push(`array entries matching an oracle row by name           ${arrayMatched} of ${arrayRows}`)
L.push("")
L.push("drops (oracle says exported, no edge published):")
show(droppedByFile)
L.push("fabrications (edge published, language does not export it):")
show(fabricatedByFile)
L.push("array missing (in oracle, absent from res.exports[]):")
show(arrayMissing)
L.push("array extra (in res.exports[], not exported in the language):")
show(arrayExtra)

const bad = droppedByFile.length + fabricatedByFile.length
L.push("")
L.push(bad === 0
  ? "RESULT: analyzer and oracle agree on every row in this sample."
  : `RESULT: ${bad} disagreement(s) — see above.`)
if (VERBOSE) console.log(L.join("\n"))
else console.log(L.join("\n"))
process.exitCode = bad === 0 ? 0 : 1