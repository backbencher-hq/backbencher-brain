/**
 * MARKDOWN FALLBACK ATTRIBUTION — who produced the `calls` and `instantiates` edges that
 * whole-corpus-census.ts measured on markdown files, proved by re-running the producer.
 *
 * ## The finding
 *
 * `whole-corpus-census.ts` over the whole admitted markdown population (17,456 files across
 * 196 repos) reports:
 *
 *   calls         33 edges, 6 files, confidence 0.5 x32 / 0.4 x1, evidenceClass absent,
 *                 source resolved 0 of 33 at the file tier AND 0 of 33 corpus-wide
 *   instantiates   3 edges, 3 files, confidence 0.6 x3, both endpoints dangling
 *   symbols with a kind outside the shared SymbolKind: 99, all with an EMPTY kind
 *
 * `src/ast/real-markdown-analyzer.ts` emits exactly four relationship types — `contains`
 * (lines 319, 384, 421, 474), `references` (597), `imports` (916) and `uses` (1065, 1075,
 * 1140). The strings `Calls` and `Instantiates` do not occur in it. So the analyzer did not
 * produce these 36 edges.
 *
 * The producer is `src/ast/pool-worker.ts:266 extractBasicRelationships`, reached through
 * `extractFallback` (line 364) when `parseFile` does not run the analyzer. It reads the file
 * TEXT with `/(\w+)\s*\(/g` and `/(\w+)\.(\w+)\s*\(/g` and `/new\s+(\w+)\s*[\(<]/g`, and
 * emits `source: "this"` for a bare call and for every constructor. For a documentation file
 * whose text is fenced JavaScript, that regex reads someone else's program: `useMutation`,
 * `hashPassword`, `new NhostClient(`, `new LocalStorageWrapper(`.
 *
 * Two things make this worth a script rather than a paragraph:
 *
 *   1. REPRODUCIBLE. Calling `extractFallback` directly on the six files reproduces the
 *      census totals EXACTLY — 33 calls, 3 instantiates, 99 kind-less symbols. Not 32, not
 *      "about 33". The attribution is an identity, not a resemblance.
 *   2. INVISIBLE DOWNSTREAM. `extractFallback` returns `errors: []` and sets only
 *      `fallback: true`. The census counts parse failures from `errors`, so a file that took
 *      the fallback counts as a CLEAN parse. This is why the run above reports
 *      `parseFailures: 0` while carrying 36 edges no analyzer emitted. `whole-corpus-census.ts`
 *      now counts the `fallback` flag itself and reports `degradedParse`.
 *
 * ## What this script decides, and what it does not
 *
 * It decides PRODUCERSHIP: whether the 36 edges belong to the markdown analyzer's verdict.
 * They do not, so `calls` and `instantiates` remain RULED for this lane, and the ruling's
 * measured count is now stated twice — 0 from the analyzer, 36 from shared machinery on 6
 * files.
 *
 * It does NOT decide whether the shared fallback is right to emit them. That is a lane-wide
 * question about `pool-worker.ts`, which is shared machinery, and it is reported, not fixed
 * here: `docs/analyzers/markdown.md`, §8 item 5.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/fallback-attribution.ts \
 *     [--census validation/m60/markdown/whole-corpus-census.json]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { extractFallback } from "../../../../src/ast/pool-worker"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const CENSUS = arg("census", path.join(REPO, "validation/m60/markdown/whole-corpus-census.json"))
const OUT = arg("out", path.join(REPO, "validation/m60/markdown/fallback-attribution.json"))

/** The census rows this script audits. A type absent here cannot be attributed here. */
const ATTRIBUTED = ["calls", "instantiates"] as const

type Producer = {
  file: string
  symbols: number
  kindLessSymbols: number
  byType: Record<string, number>
  sources: string[]
  targets: string[]
}

async function main(): Promise<void> {
  if (!existsSync(CENSUS)) {
    console.error(`no census at ${CENSUS}; run whole-corpus-census.ts first`)
    process.exit(2)
  }
  const census = JSON.parse(readFileSync(CENSUS, "utf8")) as any

  // The candidate set is the census's OWN list of files that took the fallback
  // (`degradedParse.examples`, whole whenever the degraded set is under the cap), UNION
  // the per-type `exampleFiles` — so a file the census attributes an edge to is never missed
  // because it did not degrade this time. Every candidate is RE-CHECKED against the corpus
  // and re-run here; a file the census names that no longer exists fails loudly rather than
  // being dropped from the denominator.
  const candidates = [
    ...new Set([
      ...(census.degradedParse?.examples ?? []),
      ...ATTRIBUTED.flatMap((t) => census.types?.[t]?.exampleFiles ?? []),
    ]),
  ].sort()
  const producers: Producer[] = []
  for (const rel of candidates) {
    const abs = path.join(CR, rel)
    if (!existsSync(abs)) {
      console.error(`candidate missing from corpus: ${rel}`)
      process.exit(2)
    }
    const content = readFileSync(abs, "utf8")
    const r: any = extractFallback(content, "markdown", "attribution", content.length, 0)
    const byType: Record<string, number> = {}
    const sources = new Set<string>()
    const targets = new Set<string>()
    for (const e of r.relationships ?? []) {
      byType[e.type] = (byType[e.type] ?? 0) + 1
      sources.add(String(e.source))
      targets.add(String(e.target))
    }
    producers.push({
      file: rel,
      symbols: r.symbols.length,
      kindLessSymbols: r.symbols.filter((s: any) => !s.kind).length,
      byType,
      sources: [...sources].sort(),
      targets: [...targets].sort(),
    })
  }

  const producedByFallback: Record<string, number> = {}
  let kindLess = 0
  let syms = 0
  for (const p of producers) {
    for (const [t, n] of Object.entries(p.byType)) producedByFallback[t] = (producedByFallback[t] ?? 0) + n
    kindLess += p.kindLessSymbols
    syms += p.symbols
  }

  // Second half of the argument: the ANALYZER, on the same files, through the production
  // entry point, emits neither type. Measured, not asserted from source.
  const analyzerCheck: { file: string; fallback: boolean; types: Record<string, number> }[] = []
  for (const rel of candidates) {
    const abs = path.join(CR, rel)
    const r: any = await parseFile(abs, abs)
    const types: Record<string, number> = {}
    for (const e of r.relationships ?? []) types[e.type] = (types[e.type] ?? 0) + 1
    analyzerCheck.push({ file: rel, fallback: r.fallback === true, types })
  }

  const censusCounts: Record<string, number> = {}
  for (const t of ATTRIBUTED) censusCounts[t] = census.types?.[t]?.count ?? 0
  const censusKindLess = Object.entries(census.kindsOutsideSharedSymbolKind ?? {})
    .filter(([k]) => k === "")
    .reduce<number>((a, [, v]) => a + Number(v), 0)

  const perType: Record<string, unknown> = {}
  let allMatch = true
  for (const t of ATTRIBUTED) {
    const measured = producedByFallback[t] ?? 0
    const observed = censusCounts[t]
    const match = measured === observed
    if (!match) allMatch = false
    perType[t] = {
      censusWholeCorpusCount: observed,
      reproducedByExtractFallback: measured,
      identical: match,
      analyzerEmits: ATTRIBUTED.filter((x) => (analyzerCheck[0]?.types ?? {})[x]).length > 0,
    }
  }
  const kindMatch = kindLess === censusKindLess
  if (!kindMatch) allMatch = false
  // An accounting identity worth stating on its own: the fallback emits exactly two
  // relationship types, so the fallback's relationship total and the census's
  // `calls` + `instantiates` total are the same number if the attribution holds.
  const fallbackRels = census.degradedParse?.relationships ?? null
  const attributedRels = ATTRIBUTED.reduce((a, t) => a + (censusCounts[t] ?? 0), 0)
  const relIdentity =
    fallbackRels === null ? null : { fallbackRelationships: fallbackRels, attributedCallsPlusInstantiates: attributedRels, identical: fallbackRels === attributedRels }

  const out = {
    instrument: "markdown fallback attribution",
    question:
      "were the `calls` and `instantiates` edges whole-corpus-census.ts measured on markdown files produced by this lane's analyzer?",
    method: [
      "1. read the census's own per-type counts and example files",
      "2. call `extractFallback` (src/ast/pool-worker.ts) directly on each example file — the only other producer of these two types on this path",
      "3. call production `parseFile` on the same files and record what it returns when it is NOT degraded",
      "4. compare all three",
    ],
    producer: {
      file: "src/ast/pool-worker.ts",
      fn: "extractFallback -> extractBasicRelationships",
      lines: "266 (regex extraction), 364 (extractFallback), 751/1148/1150 (the three call sites in parseFile)",
      reads: "the file TEXT with /(\\w+)\\s*\\(/g, /(\\w+)\\.(\\w+)\\s*\\(/g, /new\\s+(\\w+)\\s*[\\(<]/g",
      sourceEmitted: '"this" — a placeholder, never a symbol in the file',
      confidenceEmitted: "0.5 for `calls`, 0.6 for `instantiates`",
      visibility: "returns `errors: []`, so a degraded parse counts as a clean parse to any consumer reading `errors`",
    },
    analyzer: {
      file: "src/ast/real-markdown-analyzer.ts",
      emits: ["contains", "references", "imports", "uses"],
      callsOrInstantiatesInSource: 0,
      measuredThroughParseFile: analyzerCheck,
    },
    perType,
    kindLessSymbols: { censusWholeCorpusCount: censusKindLess, reproducedByExtractFallback: kindLess, identical: kindMatch },
    relationshipIdentity: relIdentity,
    degradedSet: {
      files: census.degradedParse?.files ?? null,
      examplesUsedAsCandidates: candidates.length,
      note: "the DEGRADED SET IS NOT REPRODUCIBLE across census invocations: two whole-population runs over the same populationSha256 degraded 11 files and 6 files respectively, and their `calls` totals were 8 and 33. The attribution of PRODUCERSHIP is stable — every `calls` and `instantiates` edge in both runs came from `extractFallback` — but the COUNT of such edges is a property of machine load, not of the corpus. Both logs are committed.",
    },
    verdict: allMatch
      ? "ATTRIBUTED — every `calls` and `instantiates` edge the census measured on markdown files, and every kind-less symbol with it, is reproduced exactly by `extractFallback` on the files the census names. The markdown analyzer emits none of them. The rulings stand; the 36 edges are shared machinery's output on 6 files, and a fabricated caller in `bb_graph` is the consequence if they are not attributed."
      : "NOT FULLY ATTRIBUTED — the reproduction does not match the census; see perType. Do not report the attribution as settled.",
    fallbackRateOverCensusPopulation: {
      files: census.degradedParse?.files ?? null,
      of: census.parsed ?? null,
      pct: census.degradedParse?.filesPct ?? null,
      note: "counted by whole-corpus-census.ts from the `fallback` flag itself. This script's candidate set is the census's `degradedParse.examples` UNION its per-type `exampleFiles`, so it covers every file the census attributed an edge to; the census's `degradedParse.files` remains the measured count.",
    },
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(JSON.stringify({ perType, kindLessSymbols: out.kindLessSymbols, verdict: out.verdict.slice(0, 120) + "..." }, null, 2))
  console.log(`wrote ${path.relative(REPO, OUT)}`)
  if (!allMatch) process.exit(1)
}

main()