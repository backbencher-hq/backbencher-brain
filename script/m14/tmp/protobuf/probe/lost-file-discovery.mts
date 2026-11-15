/**
 * LOST-FILE DISCOVERY — which files does the production parse actually lose, and
 * does the hand-picked victim from `parse-variance.mts` represent them?
 *
 * ## Why this file exists
 *
 * Passes 7, 10 and 11 established that a small fraction of production
 * `parseFile` calls return an EMPTY successful parse — `parseFile` catches its own
 * wasm fault internally and RETURNS, so `filesOk++` still runs and every
 * file-level ok/fail counter reads clean while a whole file's symbols and edges
 * are gone. The rate was bounded at 0.0365%–0.107% of file-parses and attributed
 * to shared runtime state rather than to any protobuf file, because the affected
 * files were arbitrary across five repositories.
 *
 * The instrument that measures it, `parse-variance.mts`, **hardcodes its target**:
 *
 *   const TARGET = ".../pb-googleapis/google/api/expr/v1beta1/source.proto"
 *
 * That path is the victim one run happened to print. The probe can therefore only
 * ever re-measure the file it was told about, and it will report `deterministic:
 * yes` for every other file in the language while the corpus loses one per run.
 * This is the defect the honesty contract's population rule names — "a correct
 * number about the wrong population" — and it is in this lane's own file, so it
 * is this lane's to fix.
 *
 * ## What this measures, and how the population is derived
 *
 * The population is DERIVED, never hand-written: the same working-tree walk of
 * every `*.proto` under the corpus root that `protobuf-census.ts` performs, so a
 * file added to the corpus is in the population automatically. Per the contract's
 * rule the walk is the working tree and not `git ls-files`, because three of these
 * corpora are `--filter=blob:none` sparse checkouts whose tracked paths are
 * mostly not on disk.
 *
 * Two phases, deliberately separated so the reference cannot be perturbed:
 *
 *   reference   ONE sequential pass through the ANALYZER, giving every file the
 *               symbol count and per-type edge count this lane's extractor reads
 *               from those bytes. Computed outside the concurrent phase, so it is
 *               a fixed yardstick.
 *   production  R passes over the whole corpus through `parseFile`, at the census's
 *               own width of 8, each pass recording per-type production edge counts
 *               and PER-FILE production symbol counts.
 *
 * A file is LOST on a pass when production published 0 symbols where the analyzer
 * read some, and PARTIAL when it published fewer than the analyzer read. Both are
 * named, because a total loss and a partial one are different failures and the
 * file-level ok/fail counter cannot tell them from each other or from success.
 *
 * There is no oracle and none is needed. The analyzer's own reading of the same
 * bytes is the fixed reference, and it is computed through the analyzer rather
 * than through `parseFile`, so a production-side loss cannot hide inside it. What
 * this CANNOT see is stated in the limitations of the pass that quotes it: a fault
 * that loses edges while leaving symbols intact is visible only in the per-type
 * totals, and a fault that is deterministic for a file this corpus happens not to
 * contain is invisible by construction.
 *
 * ## Usage
 *
 *   npx tsx script/m14/tmp/protobuf/probe/lost-file-discovery.mts [--runs 4] [--limit=N]
 *                                                       [--width 8] [--out /tmp/...json]
 *
 * Reads real corpus files. Writes only the JSON report. Exits 0 whatever it finds;
 * the numbers are the output, the exit code is not a verdict.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const flag = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const RUNS = Number(flag("runs", "4"))
const WIDTH = Number(flag("width", "8"))
const OUT = flag("out", "/tmp/opencode/pb/lost-file-discovery.json")
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="))
const PER_REPO_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.slice("--limit=".length)) : 0

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// The file `parse-variance.mts` hardcodes, named here so this probe can say
// whether that hand-picked target is representative of what it discovers rather
// than leaving the two instruments to disagree silently.
const HARDCODED_TARGET =
  "pb-googleapis/google/api/expr/v1beta1/source.proto"

// ------------------------------------------------------------------ population
type CorpusFile = { repo: string; rel: string; abs: string }
const corpus: CorpusFile[] = []
const perRepo: Record<string, number> = {}
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { continue }
  if (!isDir) continue
  let n = 0
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
      if (!k.endsWith(".proto")) continue
      if (PER_REPO_LIMIT && n >= PER_REPO_LIMIT) return
      corpus.push({ repo: entry, rel: r, abs })
      n++
    }
  }
  walk(dir, "")
  perRepo[entry] = n
}
const reposWithProto = Object.entries(perRepo).filter(([, n]) => n > 0)
console.error(
  `population: ${corpus.length} .proto files in ${reposWithProto.length} repositories ` +
    `(${reposWithProto.map(([r, n]) => `${r}=${n}`).join(" ")})`,
)

// ------------------------------------------------------------------ grammar
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const grammar = await LanguageClass.load(
  readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")),
)
const analyzer = new RealProtobufAnalyzer()

// ------------------------------------------------------- phase 1: reference
// Sequential and outside the concurrent phase. One analyzer instance; the census
// shares one too, because a tree-sitter Parser is not documented re-entrant.
const refParser = new ParserClass()
refParser.setLanguage(grammar)
const refSyms = new Map<string, number>()
const refEdges = new Map<string, number>()
const refPerType = new Map<string, Map<Type, number>>()
for (const f of corpus) {
  const label = `${f.repo}/${f.rel}`
  const content = readFileSync(f.abs, "utf8")
  const tree = refParser.parse(content)
  const a: any = analyzer.analyze(tree.rootNode, content, f.abs)
  const syms = (a.symbols ?? []).length
  refSyms.set(label, syms)
  refEdges.set(label, (a.relationships ?? []).length)
  const per = new Map<Type, number>()
  for (const r of a.relationships ?? []) {
    const t = String(r.type).toLowerCase() as Type
    if (ALL_TYPES.includes(t)) per.set(t, (per.get(t) ?? 0) + 1)
  }
  refPerType.set(label, per)
  tree.delete?.()
}
const refTotalSyms = [...refSyms.values()].reduce((a, b) => a + b, 0)
const refTotalEdges = [...refEdges.values()].reduce((a, b) => a + b, 0)
console.error(
  `reference (analyzer, sequential): ${refTotalSyms} symbols / ${refTotalEdges} edges over ${corpus.length} files`,
)

// ------------------------------------------------------- phase 2: production
type PassResult = {
  run: number
  syms: number
  edges: number
  perType: Record<string, number>
  lost: { label: string; repo: string; refSyms: number; refEdges: number }[]
  partial: { label: string; repo: string; prodSyms: number; refSyms: number; refEdges: number }[]
  fail: number
}
const passes: PassResult[] = []

for (let run = 0; run < RUNS; run++) {
  let idx = 0
  let syms = 0
  let edges = 0
  let fail = 0
  const perType: Record<string, number> = {}
  const lost: PassResult["lost"] = []
  const partial: PassResult["partial"] = []
  const totals = new Map<string, { syms: number; edges: number }>()

  async function worker(): Promise<void> {
    while (true) {
      const i = idx++
      if (i >= corpus.length) return
      const f = corpus[i]
      const label = `${f.repo}/${f.rel}`
      let prod: any
      try {
        prod = await parseFile(f.abs, path.dirname(f.abs))
      } catch {
        fail++
        continue
      }
      const ps = (prod.symbols ?? []).length
      const pe = (prod.relationships ?? []).length
      syms += ps
      edges += pe
      const acc = totals.get(label) ?? { syms: 0, edges: 0 }
      acc.syms += ps
      acc.edges += pe
      totals.set(label, acc)
      for (const r of prod.relationships ?? []) {
        const t = String(r.type ?? r.relationshipType ?? "").toLowerCase()
        if ((ALL_TYPES as readonly string[]).includes(t)) perType[t] = (perType[t] ?? 0) + 1
      }
    }
  }
  await Promise.all(Array.from({ length: WIDTH }, () => worker()))

  for (const f of corpus) {
    const label = `${f.repo}/${f.rel}`
    const got = totals.get(label)
    const ps = got ? got.syms : 0
    const rs = refSyms.get(label) ?? 0
    if (rs > 0 && ps === 0) {
      lost.push({ label, repo: f.repo, refSyms: rs, refEdges: refEdges.get(label) ?? 0 })
    } else if (rs > 0 && ps < rs) {
      partial.push({ label, repo: f.repo, prodSyms: ps, refSyms: rs, refEdges: refEdges.get(label) ?? 0 })
    }
  }

  passes.push({ run, syms, edges, perType, lost, partial, fail })
  console.error(
    `run ${run + 1}/${RUNS}: production ${syms} symbols / ${edges} edges, ` +
      `lost ${lost.length}, partial ${partial.length}, throws ${fail}` +
      (lost.length || partial.length ? `  -> ${[...lost, ...partial].map((x) => x.label).join("; ")}` : ""),
  )
}

// ------------------------------------------------------------------ report
const first = passes[0]
const variant = (pick: (p: PassResult) => number): { min: number; max: number; spread: number; spreadPctOfMax: number } => {
  const vals = passes.map(pick)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  return { min, max, spread: max - min, spreadPctOfMax: max ? +((100 * (max - min)) / max).toFixed(4) : 0 }
}

const fileParses = passes.length * corpus.length
const allLost = passes.flatMap((p) => p.lost.map((l) => `${l.label}@run${p.run + 1}`))
const allPartial = passes.flatMap((p) => p.partial.map((l) => `${l.label}@run${p.run + 1}`))
const lostRepos = new Map<string, number>()
for (const p of passes) for (const l of [...p.lost, ...p.partial]) {
  lostRepos.set(l.repo, (lostRepos.get(l.repo) ?? 0) + 1)
}

const out = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  population: `working-tree walk of every *.proto under ${CR}${PER_REPO_LIMIT ? `, capped at ${PER_REPO_LIMIT}/repo` : ", uncapped"}`,
  filesInPopulation: corpus.length,
  repositories: Object.fromEntries(reposWithProto),
  runs: passes.length,
  width: WIDTH,
  fileParses,
  reference: { symbols: refTotalSyms, edges: refTotalEdges, source: "RealProtobufAnalyzer.analyze, one sequential pass" },
  productionPerRun: passes.map((p) => ({ run: p.run + 1, symbols: p.syms, edges: p.edges, perType: p.perType, throws: p.fail })),
  spread: {
    symbols: variant((p) => p.syms),
    edges: variant((p) => p.edges),
    uses: variant((p) => p.perType.uses ?? 0),
    contains: variant((p) => p.perType.contains ?? 0),
    imports: variant((p) => p.perType.imports ?? 0),
  },
  lostFiles: allLost,
  partialFiles: allPartial,
  lostOrPartialByRepo: Object.fromEntries([...lostRepos.entries()].sort((a, b) => b[1] - a[1])),
  lostRate: {
    fileParses,
    lost: allLost.length,
    partial: allPartial.length,
    lostPct: +(100 * allLost.length / fileParses).toFixed(4),
    lostOrPartialPct: +(100 * (allLost.length + allPartial.length) / fileParses).toFixed(4),
  },
  hardcodedTargetInParseVariance: {
    label: HARDCODED_TARGET,
    inPopulation: corpus.some((f) => `${f.repo}/${f.rel}` === HARDCODED_TARGET),
    discoveredHere: allLost.concat(allPartial).some((s) => s.startsWith(`${HARDCODED_TARGET}@`)),
    referenceSyms: refSyms.get(HARDCODED_TARGET) ?? null,
  },
  majorityRun: (() => {
    const tally = new Map<number, number>()
    for (const p of passes) tally.set(p.syms, (tally.get(p.syms) ?? 0) + 1)
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    return { symbols: top[0], runsWithIt: top[1], ofRuns: passes.length }
  })(),
  firstRunPerType: first.perType,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\npopulation   ${corpus.length} files, ${RUNS} production passes at width ${WIDTH} = ${fileParses} file-parses`)
console.log(`reference    analyzer-direct ${refTotalSyms} symbols / ${refTotalEdges} edges`)
console.log(`production   symbols ${out.spread.symbols.min}–${out.spread.symbols.max}   edges ${out.spread.edges.min}–${out.spread.edges.max}`)
console.log(`             uses ${out.spread.uses.min}–${out.spread.uses.max}   contains ${out.spread.contains.min}–${out.spread.contains.max}   imports ${out.spread.imports.min}–${out.spread.imports.max}`)
console.log(`\nfiles the analyzer read and production published NOTHING for : ${allLost.length} of ${fileParses} file-parses (${out.lostRate.lostPct}%)`)
console.log(`files production published FEWER symbols than the analyzer read : ${allPartial.length} (${out.lostRate.lostOrPartialPct}% combined)`)
for (const s of allLost) console.log(`  LOST     ${s}`)
for (const s of allPartial) console.log(`  PARTIAL  ${s}`)
console.log(`\nby repository: ${JSON.stringify(out.lostOrPartialByRepo)}`)
console.log(`\nparse-variance.mts's hardcoded target ${HARDCODED_TARGET}`)
console.log(`  in the derived population : ${out.hardcodedTargetInParseVariance.inPopulation}`)
console.log(`  discovered by this probe  : ${out.hardcodedTargetInParseVariance.discoveredHere}`)
console.log(`\nwrote ${OUT}`)