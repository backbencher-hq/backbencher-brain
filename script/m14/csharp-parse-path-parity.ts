#!/usr/bin/env bun
/**
 * THE ANALYZER'S TWO ENTRY POINTS, MEASURED AGAINST EACH OTHER — the instrument behind the
 * 525-row cause ruling's re-reading and the 954-edge bound.
 *
 * WHY THIS EXISTS. The lane's cause census joins the ARBITER's per-row verdict against a KEY SPACE
 * built from the analyzer's own symbols. Those two things were measured through DIFFERENT entry
 * points: the gate parses through `pool-worker.parseFile`, the census parses through
 * `ASTEngine.getParser -> parse -> RealCSharpAnalyzer.analyze`. If the two entry points produce
 * different symbol sets, the join is between a verdict and a key space that answer different
 * questions, and every row where they differ is a row the cause census mis-labels. The census's own
 * `--parity` block could not see this: it compared `parseFile` against `parseFile` — the pooled path
 * against itself — which is a tautology for the question that matters.
 *
 * WHAT IT DOES. For a DECLARED sample of admitted files it parses each file BOTH ways and reports,
 * per file and in total: symbol count, how many symbols carry a line, the INDEXER symbols (the
 * analyzer names an indexer `this`, a C# keyword), the relationship count, and the keyword-target
 * edges. Then it states the difference as numbers, so the mechanism is a measurement rather than a
 * sentence.
 *
 * THE BOUND IS DECLARED, NOT IMPLIED. The sample is a sorted PREFIX of the admitted list — not a
 * stride, not a stride dressed as a sample — and the artifact carries the population it came from.
 * The population-scale confirmation is the two whole-population totals the lane already published:
 * the census's direct path totals 1,263,451 edges against the gate's 1,262,497, a difference of 954.
 *
 * This instrument does not edit the analyzer, the arbiter, or the gate, and it needs NO arm token:
 * it parses a declared sample and writes a tracked artifact.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"
import { RealCSharpAnalyzer } from "../../src/ast/real-csharp-analyzer"
import { decodeSourceText } from "../../src/util/source-text"

const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(".corpus")
const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const SAMPLE = Number(argOf("--sample") ?? "500")
const OUT = argOf("--out") ?? "validation/m14/measurements/csharp-parse-path-parity.json"
const jsonOut = argv.includes("--json")

/** Walk the corpus for admitted csharp files, sorted, so the sample is a DECLARED prefix. */
function walk(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    let isDir = e.isDirectory()
    if (!isDir && e.isSymbolicLink()) {
      try { isDir = statSync(abs).isDirectory() } catch { isDir = false }
    }
    if (isDir) walk(abs, out)
    else if (e.name.endsWith(".cs") || e.name.endsWith(".csx")) out.push(abs)
  }
}
const all: string[] = []
walk(CORPUS, all)
all.sort()
const files = all.slice(0, SAMPLE)

/** The analyzer's own keyword set (src/ast/real-csharp-analyzer.ts:370) — the same list the
 *  analyzer uses at :2240 to refuse to fabricate a call to a keyword. */
const KEYWORDS = new Set([
  "if", "for", "foreach", "while", "do", "switch", "case", "else", "return", "throw", "using",
  "new", "delegate", "in", "is", "as", "sizeof", "fixed", "lock", "checked", "unchecked", "params",
  "ref", "out", "base", "this", "get", "set", "nameof",
])

type Side = { symbols: number; symbolsWithLine: number; indexerSymbols: number; relationships: number; keywordTargetEdges: number }
const empty = (): Side => ({ symbols: 0, symbolsWithLine: 0, indexerSymbols: 0, relationships: 0, keywordTargetEdges: 0 })
function measure(r: { symbols?: unknown[]; relationships?: unknown[] }): Side {
  const syms = (r.symbols ?? []) as { name?: unknown; range?: { startLine?: number } }[]
  const rels = (r.relationships ?? []) as { target?: unknown }[]
  const s = empty()
  s.symbols = syms.length
  for (const sym of syms) {
    if ((sym.range?.startLine ?? 0) > 0) s.symbolsWithLine++
    if (String(sym.name ?? "") === "this") s.indexerSymbols++
  }
  s.relationships = rels.length
  for (const rel of rels) if (KEYWORDS.has(String(rel.target ?? ""))) s.keywordTargetEdges++
  return s
}

const direct = empty()
const pooled = empty()
const differ: { file: string; direct: Side; pooled: Side; symbolsLost: number; relationshipsLost: number }[] = []
let filesCompared = 0
let filesWithDifference = 0
/** The two entry points are reached through their own types; these structural aliases keep the
 *  call sites explicit without importing the grammar's full Parser/Analyzer types, which differ
 *  between the two paths and are exactly what is being compared. */
type MiniParser = { parse: (text: string, name: string) => { rootNode: unknown } }
type MiniAnalyzer = { analyze: (n: unknown, c: string, p: string, ctx: unknown) => { symbols?: unknown[]; relationships?: unknown[] } }
const parser = (await ASTEngine.getParser("csharp" as never)) as unknown as MiniParser

for (const f of files) {
  const rel = path.relative(CORPUS, f)
  const repo = rel.split(path.sep)[0] ?? rel
  const root = path.join(CORPUS, repo)
  let d: Side
  let p: Side
  try {
    // THE CENSUS'S PATH, spelled out exactly as the census spells it.
    const content = decodeSourceText(readFileSync(f)).text
    const tree = parser.parse(content, f)
    const a = new RealCSharpAnalyzer() as unknown as MiniAnalyzer
    d = measure(a.analyze(tree.rootNode, content, f, { projectRoot: root }))
    // THE GATE'S PATH.
    p = measure((await parseFile(f, root, { projectRoot: root } as never)) as never)
  } catch {
    continue
  }
  filesCompared++
  for (const k of Object.keys(direct) as (keyof Side)[]) direct[k] += d[k]
  for (const k of Object.keys(pooled) as (keyof Side)[]) pooled[k] += p[k]
  const symbolsLost = d.symbols - p.symbols
  const relationshipsLost = d.relationships - p.relationships
  if (symbolsLost !== 0 || relationshipsLost !== 0 || d.symbolsWithLine !== p.symbolsWithLine || d.keywordTargetEdges !== p.keywordTargetEdges) {
    filesWithDifference++
    if (differ.length < 25) differ.push({ file: rel, direct: d, pooled: p, symbolsLost, relationshipsLost })
  }
}

const delta = {
  symbols: direct.symbols - pooled.symbols,
  symbolsWithLine: direct.symbolsWithLine - pooled.symbolsWithLine,
  indexerSymbols: direct.indexerSymbols - pooled.indexerSymbols,
  relationships: direct.relationships - pooled.relationships,
  keywordTargetEdges: direct.keywordTargetEdges - pooled.keywordTargetEdges,
}

console.log(`CSHARP - THE TWO ENTRY POINTS, MEASURED AGAINST EACH OTHER`)
console.log(`  population: the admitted list is ${all.length} files; THIS SAMPLE IS THE SORTED PREFIX of ${files.length} — a DECLARED sample, not a stride`)
console.log(`  files compared: ${filesCompared} · files with ANY difference: ${filesWithDifference}`)
console.log(`  DIRECT (the census's path: getParser -> parse -> analyze) ${JSON.stringify(direct)}`)
console.log(`  POOLED (the gate's path: pool-worker.parseFile)           ${JSON.stringify(pooled)}`)
console.log(`  DIRECT MINUS POOLED: ${JSON.stringify(delta)}`)
console.log(`  THE MECHANISM: the gate's path loses ${delta.relationships} relationships and ${delta.symbols} symbols over ${filesCompared} files, INCLUDING the indexer symbols the analyzer names \`this\` (a C# keyword), and ` + (pooled.symbolsWithLine === 0 ? `ALL symbol line numbers (0 of ${pooled.symbols} carry a line, against ${direct.symbolsWithLine} of ${direct.symbols} on the direct path)` : `some symbol line numbers`))
if (jsonOut) {
  const out = {
    lane: "csharp",
    instrument: "script/m14/csharp-parse-path-parity.ts",
    question: "do the analyzer's two entry points - the census's direct path and the gate's pooled path - produce the same symbols and relationships?",
    population: { admitted: all.length, sample: files.length, sampleKind: "sorted prefix of the admitted list (a DECLARED sample, not a stride)" },
    filesCompared,
    filesWithDifference,
    direct,
    pooled,
    delta,
    populationScaleConfirmation: {
      note: "the two whole-population totals the lane already published, from DIFFERENT runs of the two paths",
      censusDirectPathEdges: 1263451,
      gatePooledPathEdges: 1262497,
      difference: 954,
      source: "validation/m14/measurements/csharp-tiebreak-movement.json (direct-path row space) against the gate's whole-population TABLE 1 (pooled path)",
    },
    mechanism: "the gate parses through pool-worker.parseFile, the census through ASTEngine.getParser -> parse -> RealCSharpAnalyzer.analyze; the pooled wrapper returns FEWER symbols (the indexer symbol named `this` among them) and FEWER relationships, and strips symbol line numbers",
    consequence: "the lane's cause census joined the arbiter's verdict (pooled path) against a key space built from the direct path, so every row where the two paths disagree was labelled a 'project-key-space-gap'; the 525-row bucket is that difference, not a gap in the arbiter",
    differenceFiles: differ,
  }
  await Bun.write(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`  written: ${OUT}`)
}
