/**
 * WHERE DOES THE SILENT PARSE LOSS HAPPEN, AND HOW BIG IS IT?
 *
 * ## Why this exists
 *
 * `script/m14/protobuf-census.ts` found that a file can lose its whole parse
 * without any counter moving: `parseFile` catches its own wasm fault and RETURNS,
 * so the file is still counted `ok` and the run still prints `821 ok / 0 fail`.
 * The loss is only visible as a delta between two runs' totals. Pass 7 measured
 * it as "2 of 7 runs, one 62-line file whole" and left a band of ±10 symbols /
 * ±9 edges on every production-side number in the lane's document.
 *
 * That band was wrong in both directions, and this probe is what corrected it.
 * Twelve further census runs put the loss at 5 of 12 rounds and up to 69 symbols
 * / 100 edges, and — the fact pass 7 had no instrument for — every loss observed
 * so far, in six separate runs across two sessions, landed in ONE DIRECTORY:
 * `pb-googleapis/google/api/expr/`. The files differ (v1alpha1/checked.proto,
 * v1alpha1/eval.proto, v1alpha1/value.proto, v1beta1/eval.proto,
 * v1beta1/expr.proto, v1beta1/source.proto), so this is not one bad file, and it
 * is not size: `v1alpha1/syntax.proto` is the largest file in the directory at
 * 436 lines and has never been lost, while `v1beta1/source.proto` is 62 lines
 * and has been lost twice.
 *
 * ## What this measures
 *
 * Census-scale rounds at the census's own width of 8, partitioned by scope, each
 * round replaying the census's own comparison: a file is a LOSS when the ANALYZER
 * (driven directly off its own parser) finds symbols in bytes that PRODUCTION
 * (`parseFile`) published nothing for. Both sides read the same file, so the
 * difference cannot be the extractor's reading.
 *
 * The probe exists to be FALSIFIED. Its claim is a locality claim, and locality
 * is only worth anything if the complement is measured too:
 *
 *   --scope=expr   the 11 files under pb-googleapis/google/api/expr/
 *   --scope=rest   the other 810 files, which is the control
 *   --scope=all    the whole corpus, which is what the census runs
 *
 * If the fault were distributed over the corpus rather than concentrated in one
 * directory, `--scope=rest` would lose files at a similar rate to `--scope=expr`.
 * A control that reads 0 losses over N rounds is what makes the expr/ rate mean
 * something; without it, "all losses are in expr/" is a coincidence of sample size
 * rather than a finding. `report` prints both arms and the ratio.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/lost-parse-locality.mts
 *      [--scope=expr|rest|all] [--rounds=6] [--width=8]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const arg = (name: string, dflt: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const SCOPE = arg("scope", "all")
const ROUNDS = Number(arg("rounds", "6"))
const WIDTH = Number(arg("width", "8"))
const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const OUT = arg("out", "/tmp/opencode/pb/lost-parse-locality.json")

/** The directory every observed loss has landed in. Stated as a constant, not
 *  derived, so that a loss anywhere else is a FALSIFICATION of this probe rather
 *  than a silent redefinition of the bucket it is being counted into. */
const SUSPECT = "pb-googleapis/google/api/expr/"

// ------------------------------------------------------------------ corpus walk
// The census's own walk, so the two instruments sample the same population.
type CorpusFile = { repo: string; rel: string; abs: string }
const all: CorpusFile[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { continue }
  if (!isDir) continue
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs, r); continue }
      if (k.endsWith(".proto")) all.push({ repo: entry, rel: r, abs })
    }
  }
  walk(dir, "")
}
const inExpr = (f: CorpusFile): boolean => `${f.repo}/${f.rel}`.includes(SUSPECT)
const corpus = SCOPE === "expr" ? all.filter(inExpr) : SCOPE === "rest" ? all.filter((f) => !inExpr(f)) : all

// ------------------------------------------------------------------ grammar
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

type Loss = { file: string; syms: number; edges: number }
type Round = { syms: number; edges: number; losses: Loss[] }

async function round(): Promise<Round> {
  let idx = 0
  let syms = 0
  let edges = 0
  const losses: Loss[] = []

  const worker = async (): Promise<void> => {
    const parser = new ParserClass()
    parser.setLanguage(grammar)
    for (;;) {
      const i = idx++
      if (i >= corpus.length) return
      const f = corpus[i]
      const label = `${f.repo}/${f.rel}`

      let prod: any
      try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch { continue }

      const content = readFileSync(f.abs, "utf8")
      const tree = parser.parse(content)
      const a: any = analyzer.analyze(tree.rootNode, content, f.abs)
      const as = (a.symbols ?? []).length
      const ae = (a.relationships ?? []).length

      syms += (prod.symbols ?? []).length
      edges += (prod.relationships ?? []).length
      if (as > 0 && (prod.symbols ?? []).length === 0) losses.push({ file: label, syms: as, edges: ae })
    }
  }
  await Promise.all(Array.from({ length: WIDTH }, worker))
  return { syms, edges, losses }
}

console.error(`scope ${SCOPE}: ${corpus.length} .proto files (of ${all.length}), ${ROUNDS} rounds at width ${WIDTH}`)

const rounds: Round[] = []
for (let i = 0; i < ROUNDS; i++) {
  const r = await round()
  rounds.push(r)
  const lostSyms = r.losses.reduce((a, l) => a + l.syms, 0)
  const lostEdges = r.losses.reduce((a, l) => a + l.edges, 0)
  console.error(
    `round ${i + 1}: ${r.syms} symbols / ${r.edges} edges` +
      (r.losses.length ? `   LOST ${r.losses.length} file(s): ${lostSyms} symbols / ${lostEdges} edges  ${r.losses.map((l) => l.file).join(", ")}` : "   clean"),
  )
}

// ------------------------------------------------------------------ verdict
const withLoss = rounds.filter((r) => r.losses.length > 0)
const symTotals = rounds.map((r) => r.syms)
const edgeTotals = rounds.map((r) => r.edges)
const perFile = new Map<string, { rounds: number; syms: number; edges: number }>()
for (const r of rounds) for (const l of r.losses) {
  const cur = perFile.get(l.file) ?? { rounds: 0, syms: l.syms, edges: l.edges }
  cur.rounds++
  perFile.set(l.file, cur)
}
const outside = [...perFile.keys()].filter((f) => !f.includes(SUSPECT))

console.log(`\nscope                ${SCOPE}`)
console.log(`files                ${corpus.length}`)
console.log(`rounds               ${ROUNDS} at width ${WIDTH}`)
console.log(`rounds with >=1 loss ${withLoss.length}  (${((withLoss.length / ROUNDS) * 100).toFixed(0)}%)`)
console.log(`symbols  min/max     ${Math.min(...symTotals)} / ${Math.max(...symTotals)}   spread ${Math.max(...symTotals) - Math.min(...symTotals)}`)
console.log(`edges    min/max     ${Math.min(...edgeTotals)} / ${Math.max(...edgeTotals)}   spread ${Math.max(...edgeTotals) - Math.min(...edgeTotals)}`)
console.log(`\ndistinct files ever lost: ${perFile.size}`)
for (const [f, v] of [...perFile].sort((a, b) => b[1].rounds - a[1].rounds)) {
  console.log(`  ${String(v.rounds).padStart(2)}/${ROUNDS} rounds  ${String(v.syms).padStart(3)} symbols / ${String(v.edges).padStart(3)} edges  ${f}`)
}
console.log(`\nlosses OUTSIDE ${SUSPECT}: ${outside.length}${outside.length ? "   <-- LOCALITY FALSIFIED" : ""}`)
for (const f of outside) console.log(`  ${f}`)

writeFileSync(OUT, JSON.stringify({
  scope: SCOPE, suspectDir: SUSPECT, files: corpus.length, rounds: ROUNDS, width: WIDTH,
  roundsWithLoss: withLoss.length,
  symbolsMin: Math.min(...symTotals), symbolsMax: Math.max(...symTotals),
  edgesMin: Math.min(...edgeTotals), edgesMax: Math.max(...edgeTotals),
  distinctFilesLost: perFile.size,
  perFile: Object.fromEntries(perFile),
  lossesOutsideSuspectDir: outside,
  localityFalsified: outside.length > 0,
}, null, 2))
console.log(`\nwrote ${OUT}`)
