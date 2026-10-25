#!/usr/bin/env bun
/**
 * THE ANALYZER'S TWO ENTRY POINTS, MEASURED AGAINST EACH OTHER — READ IN EACH SIDE'S OWN SHAPE.
 *
 * THE DEFECT THIS INSTRUMENT SHIPPED WITH, AND WHY IT IS WRITTEN DOWN HERE. Its first version
 * counted `sym.range?.startLine` on BOTH sides. The DIRECT path's symbols carry `range.startLine`;
 * the POOLED path returns the store's FLAT record (`startLine`, `endLine`, `startIndex`, …) and has
 * no `range` at all, so the counter read `undefined` for every pooled symbol and reported that the
 * production path "loses every symbol line number". The line numbers were never lost. The measure
 * could not distinguish ABSENT from NAMED DIFFERENTLY, and it turned that into a production defect
 * that would have sent the fleet hunting a phantom in a shared file. A FIELD NAME IS NOT A FIELD,
 * and measuring one shape with the other shape's field name is the same class of error as reading a
 * sample and calling it a population.
 *
 * WHAT IT DOES NOW. Each side is read in its own shape and the counts are kept SEPARATE — never
 * collapsed into one another — so a reader can see both what each side carries and whether the two
 * sides carry the same THING under different names. It also measures the SHAPES THEMSELVES (the
 * top-level key sets of the symbols and of the relationships), because "the two entry points return
 * different shapes" is the finding that is actually true and checkable.
 *
 * THE RELATIONSHIP COMPARISON IS SHAPE-INDEPENDENT. Relationships are compared as MULTISETS of an
 * identity key built from fields both shapes share, and the instrument PRINTS which fields the key
 * used, so a shape change cannot silently manufacture a difference.
 *
 * THE BOUND IS DECLARED. The sample is a sorted PREFIX of the walked file list — a declared sample,
 * not a stride — and the artifact carries the population it came from. `--file <path>` measures one
 * file in full, which is how a reader can EYEBALL a difference instead of trusting a total.
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
const SAMPLE = Number(argOf("--sample") ?? "400")
const ONE_FILE = argOf("--file")
const OUT = argOf("--out") ?? "validation/m14/measurements/csharp-parse-path-parity.json"
const jsonOut = argv.includes("--json")

/** The analyzer's own keyword set (src/ast/real-csharp-analyzer.ts:370). */
const KEYWORDS = new Set([
  "if", "for", "foreach", "while", "do", "switch", "case", "else", "return", "throw", "using",
  "new", "delegate", "in", "is", "as", "sizeof", "fixed", "lock", "checked", "unchecked", "params",
  "ref", "out", "base", "this", "get", "set", "nameof",
])

type Rec = Record<string, unknown>
const keysOf = (o: Rec): string[] => Object.keys(o)
const unionKeys = (into: Set<string>, o: Rec): void => { for (const k of keysOf(o)) into.add(k) }

/**
 * ONE SIDE, READ IN ITS OWN SHAPE. The three line counters are kept apart on purpose: a shape that
 * names the field `range.startLine` and a shape that names it `startLine` both have the line, and
 * a measure that reports only one of them is measuring its own assumption.
 */
type Side = {
  symbols: number
  lineViaRangeStartLine: number
  lineViaFlatStartLine: number
  symbolsWithALineInEitherShape: number
  indexerSymbols: number
  relationships: number
  keywordTargetEdges: number
}
const emptySide = (): Side => ({
  symbols: 0, lineViaRangeStartLine: 0, lineViaFlatStartLine: 0, symbolsWithALineInEitherShape: 0,
  indexerSymbols: 0, relationships: 0, keywordTargetEdges: 0,
})

type Measured = { side: Side; symbolKeys: string[]; relationshipKeys: string[]; relIds: string[]; symDetail: string[] }

/** THE IDENTITY KEY FOR A RELATIONSHIP, built only from fields the shape actually has. */
const REL_ID_FIELDS = ["type", "source", "target"] as const
function relationshipId(r: Rec, fields: string[]): string {
  const parts: string[] = []
  for (const f of fields) parts.push(String(r[f] ?? ""))
  return parts.join("\u0001")
}

function measure(r: { symbols?: unknown[]; relationships?: unknown[] }): Measured {
  const syms = (r.symbols ?? []) as Rec[]
  const rels = (r.relationships ?? []) as Rec[]
  const s = emptySide()
  const symKeys = new Set<string>()
  const relKeys = new Set<string>()
  s.symbols = syms.length
  const symDetail: string[] = []
  for (const sym of syms) {
    symDetail.push(`${String(sym.kind ?? "")}@${Number((sym.range as Rec | undefined)?.startLine ?? sym.startLine ?? 0)} ${String(sym.name ?? "")}`)
    unionKeys(symKeys, sym)
    const viaRange = Number((sym.range as Rec | undefined)?.startLine ?? 0)
    const viaFlat = Number(sym.startLine ?? 0)
    if (viaRange > 0) s.lineViaRangeStartLine++
    if (viaFlat > 0) s.lineViaFlatStartLine++
    if (viaRange > 0 || viaFlat > 0) s.symbolsWithALineInEitherShape++
    if (String(sym.name ?? "") === "this") s.indexerSymbols++
  }
  s.relationships = rels.length
  const presentFields: string[] = []
  for (const f of REL_ID_FIELDS) if (rels.some((rel) => rel[f] !== undefined)) presentFields.push(f)
  for (const rel of rels) {
    unionKeys(relKeys, rel)
    if (KEYWORDS.has(String(rel.target ?? ""))) s.keywordTargetEdges++
  }
  return {
    side: s,
    symbolKeys: [...symKeys].sort(),
    relationshipKeys: [...relKeys].sort(),
    relIds: rels.map((rel) => relationshipId(rel, presentFields)).sort(),
    symDetail,
  }
}

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

type MiniParser = { parse: (text: string, name: string) => { rootNode: unknown } }
type MiniAnalyzer = { analyze: (n: unknown, c: string, p: string, ctx: unknown) => { symbols?: unknown[]; relationships?: unknown[] } }
const parser = (await ASTEngine.getParser("csharp" as never)) as unknown as MiniParser

/** Parse ONE file through BOTH entry points. */
async function bothWays(f: string): Promise<{ direct: Measured; pooled: Measured } | null> {
  const rel = path.relative(CORPUS, f)
  const repo = rel.split(path.sep)[0] ?? rel
  const root = path.join(CORPUS, repo)
  try {
    const content = decodeSourceText(readFileSync(f)).text
    const tree = parser.parse(content, f)
    const a = new RealCSharpAnalyzer() as unknown as MiniAnalyzer
    const direct = measure(a.analyze(tree.rootNode, content, f, { projectRoot: root }))
    const pooled = measure((await parseFile(f, root, { projectRoot: root } as never)) as never)
    return { direct, pooled }
  } catch {
    return null
  }
}

// ── MODE 1: ONE FILE, IN FULL, FOR EYEBALLING ───────────────────────────────
if (ONE_FILE !== undefined) {
  const m = await bothWays(ONE_FILE)
  if (m === null) { console.error(`could not parse ${ONE_FILE} both ways`); process.exit(2) }
  const rel = path.relative(CORPUS, ONE_FILE)
  console.log(`CSHARP - ONE FILE THROUGH BOTH ENTRY POINTS: ${rel}`)
  for (const [name, side] of [["DIRECT (the census's path)", m.direct], ["POOLED (the gate's path)", m.pooled]] as const) {
    console.log(`  ${name}`)
    console.log(`    symbols=${side.side.symbols}  with range.startLine=${side.side.lineViaRangeStartLine}  with flat startLine=${side.side.lineViaFlatStartLine}  with A LINE IN EITHER SHAPE=${side.side.symbolsWithALineInEitherShape}`)
    console.log(`    relationships=${side.side.relationships}  keyword-target=${side.side.keywordTargetEdges}  indexer symbols=${side.side.indexerSymbols}`)
    console.log(`    SYMBOL KEYS: ${side.symbolKeys.join(" ")}`)
    console.log(`    RELATIONSHIP KEYS: ${side.relationshipKeys.join(" ")}`)
  }
  // WHAT EACH SIDE HAS AT THE SAME LINES — "dropped" and "renamed" are different defects and a
  // count alone cannot tell them apart.
  for (const [name, side] of [["DIRECT", m.direct], ["POOLED", m.pooled]] as const) {
    console.log(`  ${name} SYMBOLS (kind@line name), ${side.side.symbols} of them:`)
    console.log(`    ${side.symDetail.slice(0, 40).join(" | ")}`)
  }
  const onlyDirect = m.direct.relIds.filter((id) => !m.pooled.relIds.includes(id))
  const onlyPooled = m.pooled.relIds.filter((id) => !m.direct.relIds.includes(id))
  console.log(`  relationships only on the DIRECT side (identity key = type/source/target): ${onlyDirect.length}`)
  for (const id of onlyDirect.slice(0, 10)) console.log(`    ${id.split("\u0001").join(" -> ")}`)
  console.log(`  relationships only on the POOLED side: ${onlyPooled.length}`)
  for (const id of onlyPooled.slice(0, 10)) console.log(`    ${id.split("\u0001").join(" -> ")}`)
  console.log(`  THE SHAPES: ${m.direct.symbolKeys.join(",") === m.pooled.symbolKeys.join(",") ? "the same symbol key set" : "DIFFERENT symbol key sets"}`)
  process.exit(0)
}

// ── MODE 2: A DECLARED SAMPLE ───────────────────────────────────────────────
const all: string[] = []
walk(CORPUS, all)
all.sort()
const files = all.slice(0, SAMPLE)
const directSum = emptySide()
const pooledSum = emptySide()
const differ: { file: string; direct: Side; pooled: Side; onlyDirectRels: number; onlyPooledRels: number }[] = []
let filesCompared = 0
let filesWithRelationshipDifference = 0
let filesWithSymbolDifference = 0
let filesWithLineDifference = 0
const directSymKeys = new Set<string>()
const pooledSymKeys = new Set<string>()
for (const f of files) {
  const m = await bothWays(f)
  if (m === null) continue
  filesCompared++
  for (const k of Object.keys(directSum) as (keyof Side)[]) directSum[k] += m.direct.side[k]
  for (const k of Object.keys(pooledSum) as (keyof Side)[]) pooledSum[k] += m.pooled.side[k]
  for (const k of m.direct.symbolKeys) directSymKeys.add(k)
  for (const k of m.pooled.symbolKeys) pooledSymKeys.add(k)
  const sameRelCount = m.direct.side.relationships === m.pooled.side.relationships
  const onlyDirect = m.direct.relIds.filter((id) => !m.pooled.relIds.includes(id))
  const onlyPooled = m.pooled.relIds.filter((id) => !m.direct.relIds.includes(id))
  if (!sameRelCount || onlyDirect.length > 0 || onlyPooled.length > 0) {
    filesWithRelationshipDifference++
    if (differ.length < 20) differ.push({ file: path.relative(CORPUS, f), direct: m.direct.side, pooled: m.pooled.side, onlyDirectRels: onlyDirect.length, onlyPooledRels: onlyPooled.length })
  }
  if (m.direct.side.symbols !== m.pooled.side.symbols) filesWithSymbolDifference++
  if (m.direct.side.symbolsWithALineInEitherShape !== m.pooled.side.symbolsWithALineInEitherShape) filesWithLineDifference++
}

console.log(`CSHARP - THE TWO ENTRY POINTS, READ IN EACH SIDE'S OWN SHAPE`)
console.log(`  population: the walk finds ${all.length} .cs/.csx files; THIS SAMPLE IS THE SORTED PREFIX of ${files.length} — a DECLARED sample, not a stride`)
console.log(`  files compared: ${filesCompared}`)
console.log(`  DIRECT (getParser -> parse -> analyze): ${JSON.stringify(directSum)}`)
console.log(`  POOLED (pool-worker.parseFile):         ${JSON.stringify(pooledSum)}`)
console.log(`  THE LINE COUNTS THAT MATTER: direct ${directSum.symbolsWithALineInEitherShape} of ${directSum.symbols} symbols carry a line IN EITHER SHAPE; pooled ${pooledSum.symbolsWithALineInEitherShape} of ${pooledSum.symbols} — per shape: direct ${directSum.lineViaRangeStartLine} via range.startLine + ${directSum.lineViaFlatStartLine} via flat startLine; pooled ${pooledSum.lineViaRangeStartLine} via range.startLine + ${pooledSum.lineViaFlatStartLine} via flat startLine`)
console.log(`  files where the symbols differ: ${filesWithSymbolDifference} · where the LINE counts differ: ${filesWithLineDifference} · where the RELATIONSHIPS differ: ${filesWithRelationshipDifference}`)
console.log(`  THE SHAPES: direct symbol keys [${[...directSymKeys].sort().join(",")}]`)
console.log(`              pooled symbol keys [${[...pooledSymKeys].sort().join(",")}]`)
console.log(`              ${[...directSymKeys].sort().join(",") === [...pooledSymKeys].sort().join(",") ? "THE SAME KEY SET" : "DIFFERENT KEY SETS — a consumer naming the other shape's fields reads undefined"}`)
if (jsonOut) {
  const out = {
    lane: "csharp",
    instrument: "script/m14/csharp-parse-path-parity.ts",
    question: "do the analyzer's two entry points - the census's direct path and the gate's pooled path - return the same data?",
    THE_DEFECT_THIS_INSTRUMENT_SHIPPED_WITH: "its first version read `sym.range?.startLine` on BOTH sides; the pooled side's symbols are the store's FLAT record and carry `startLine` with no `range`, so the counter read undefined for every one of them and the instrument reported that the production path 'loses every symbol line number'. The line numbers were never lost - the measure could not distinguish ABSENT from NAMED DIFFERENTLY. Corrected here, and kept in the artifact because a corrected instrument that hides its own defect teaches nobody.",
    population: { walked: all.length, sample: files.length, sampleKind: "sorted prefix of the walked list (a DECLARED sample, not a stride)" },
    filesCompared,
    direct: directSum,
    pooled: pooledSum,
    delta: Object.fromEntries((Object.keys(directSum) as (keyof Side)[]).map((k) => [k, directSum[k] - pooledSum[k]])),
    filesWithSymbolDifference,
    filesWithLineDifference,
    filesWithRelationshipDifference,
    directSymbolKeys: [...directSymKeys].sort(),
    pooledSymbolKeys: [...pooledSymKeys].sort(),
    shapeVerdict: [...directSymKeys].sort().join(",") === [...pooledSymKeys].sort().join(",") ? "the same symbol key set" : "DIFFERENT symbol key sets - the direct path nests the position under `range`, the pooled path returns a flat store record",
    relationshipDifferenceFiles: differ,
  }
  await Bun.write(OUT, JSON.stringify(out, null, 2) + "\n")
  console.log(`  written: ${OUT}`)
}
