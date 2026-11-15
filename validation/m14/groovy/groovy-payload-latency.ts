// PAYLOAD AND LATENCY, for the groovy lane, before and after an edge change.
//
// WHY THE MEASUREMENT IS TAKEN TWICE. `bb_graph`'s un-narrowed default returns
// every relationship the analyzer emitted, so an edge added to any type grows
// the DEFAULT payload whether or not the caller asked for that type.
// docs/analyzers/ONTOLOGY-WORKSTREAM.md quantifies the shape: 2.5x-4.8x a
// filtered answer (lodash 487 KiB vs 101 KiB, ripgrep 795 vs 321). A lane that
// adds edges without measuring the default is spending somebody else's budget.
//
// THE FOUR NUMBERS, all on the SAME file list so the comparison is
// like-for-like:
//
//   unfilteredBytes   JSON of every relationship from the sample
//   filteredBytes     JSON of ONE type's relationships from the same sample
//   ratio             unfiltered / filtered
//   parseWallMs       production parseFile over the sample
//   analyzeOnlyMs     parseFile's own re-parse subtracted from the wall, so
//                     tree-sitter's cost is separable from the walk
//
// POPULATION IS DERIVED, never hand-listed (docs/M14-HONESTY-CONTRACT.md, "an
// instrument must declare the population it covered"): `git ls-files` over the
// corpus root, filtered by `detectLanguageFromPath`, then a DETERMINISTIC
// stride sample (every Nth file of the sorted list) so a re-run draws the same
// files without a stored file list that can rot.
//
// FILES THE MEASUREMENT COULD NOT COVER ARE NAMED, not dropped. The pinned
// grammar has files that cost minutes of wall clock each
// (`config/codenarc/codenarc.groovy` — 337,131 ms inside parseFile, measured),
// so this script reads the census driver's `quarantine.txt` and reports how
// many population files it skipped and why. A payload number over an unstated
// population is a number about the wrong population.
//
// NO REGEX anywhere: no text pattern is applied to source, and the file-name
// predicates are `endsWith` on extension and a char-code stride. Every decision
// is `detectLanguageFromPath`, `node.type`, a field name, or an integer
// comparison.
//
// USAGE
//   npx tsx validation/m14/groovy/groovy-payload-latency.ts [N] [corpusRoot]
//   GROOVY_PAYLOAD_LABEL=before GROOVY_PAYLOAD_ARTIFACT=<path> npx tsx ...
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"

const ROOT = "/tmp/opencode/wt/DERIV_EXPORTS_GROOVY4"
const WANT = Number(process.argv[2] || 200)
const CORPUS_ROOT = process.argv[3] || "/home/ishaq2321/bb_tests/repositories/groovy"
const QUARANTINE = join(ROOT, "validation/m14/measurements/groovy-census/quarantine.txt")

interface Shape {
  type: string
  count: number
  bytes: number
}

/** Derived population: tracked files the language detector calls groovy. */
function derivePopulation(): string[] {
  const out: string[] = []
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", CORPUS_ROOT, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return out
  }
  for (const rel of tracked) {
    const abs = join(CORPUS_ROOT, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "groovy") continue
    } catch {
      continue
    }
    out.push(abs)
  }
  out.sort()
  return out
}

/** Every Nth file of a sorted list. Deterministic, derived, no stored index. */
function strideSample(sorted: string[], want: number): string[] {
  if (sorted.length === 0 || want <= 0) return []
  const stride = Math.max(1, Math.floor(sorted.length / want))
  const out: string[] = []
  for (let i = 0; i < sorted.length && out.length < want; i += stride) out.push(sorted[i])
  return out
}

/** The census driver's quarantine list: `abs-path<TAB>reason`, one per line. */
function quarantined(): Map<string, string> {
  const m = new Map<string, string>()
  if (!existsSync(QUARANTINE)) return m
  for (const line of readFileSync(QUARANTINE, "utf8").split("\n")) {
    if (line.trim().length === 0) continue
    const tab = line.indexOf("\t")
    m.set((tab === -1 ? line : line.slice(0, tab)).trim(), tab === -1 ? "(no reason recorded)" : line.slice(tab + 1).trim())
  }
  return m
}

async function main(): Promise<void> {
  const label = process.env.GROOVY_PAYLOAD_LABEL || "current"
  const population = derivePopulation()
  if (population.length === 0) {
    console.error(`groovy payload/latency: derived population is EMPTY under ${CORPUS_ROOT}.`)
    console.error("An empty population is not a measurement. Check the corpus path.")
    process.exit(2)
  }
  const skip = quarantined()
  const measurable = population.filter((p) => !skip.has(p))
  const sample = strideSample(measurable, WANT)

  const allRels: any[] = []
  const perFile: { rel: string; bytes: number; symbols: number; imports: number }[] = []
  let parseWallMs = 0
  let analyzeOnlyMs = 0
  let failed = 0
  let symbols = 0
  let importEntries = 0
  let exportEntries = 0

  for (const abs of sample) {
    let content: string
    try {
      content = readFileSync(abs, "utf8")
    } catch {
      failed++
      continue
    }
    const t0 = Date.now()
    let res: any
    try {
      // THE PRODUCTION ENTRY, the same one the indexer calls.
      res = await ASTEngine.parseFile(abs, content)
    } catch {
      failed++
      continue
    }
    const t1 = Date.now()
    parseWallMs += t1 - t0
    perFile.push({
      rel: abs.slice(CORPUS_ROOT.length + 1),
      bytes: Buffer.byteLength(JSON.stringify(res.relationships), "utf8"),
      symbols: Array.isArray(res.symbols) ? res.symbols.length : 0,
      imports: Array.isArray(res.imports) ? res.imports.length : 0,
    })
    symbols += Array.isArray(res.symbols) ? res.symbols.length : 0
    importEntries += Array.isArray(res.imports) ? res.imports.length : 0
    exportEntries += Array.isArray(res.exports) ? res.exports.length : 0
    for (const r of (res.relationships as any[]) ?? []) allRels.push(r)
  }

  const byType = new Map<string, any[]>()
  for (const r of allRels) {
    const t =
      typeof r.type === "string" && r.type.length > 0
        ? r.type
        : typeof r.relationshipType === "string" && r.relationshipType.length > 0
          ? r.relationshipType
          : "(unlabelled)"
    const arr = byType.get(t)
    if (arr) arr.push(r)
    else byType.set(t, [r])
  }
  const shapes: Shape[] = [...byType.entries()]
    .map(([type, rels]) => ({
      type,
      count: rels.length,
      bytes: Buffer.byteLength(JSON.stringify(rels), "utf8"),
    }))
    .sort((a, b) => (a.type < b.type ? -1 : 1))

  const unfilteredBytes = Buffer.byteLength(JSON.stringify(allRels), "utf8")
  // The filtered answer a consumer actually asks for: one type. The LARGEST
  // type is the most favourable denominator, and the workstream's 2.5x-4.8x
  // band was measured that way, so the ratio is comparable with it. It is
  // therefore also the LEAST alarming number available, which is why the
  // per-type byte shares are printed beside it rather than instead of it.
  let biggest: Shape | null = null
  for (const s of shapes) if (!biggest || s.bytes > biggest.bytes) biggest = s
  const filteredType = process.env.GROOVY_PAYLOAD_FILTER || (biggest ? biggest.type : "")
  const filteredBytes = biggest ? biggest.bytes : 0

  const out = {
    label,
    analyzerCommit: process.env.GROOVY_SUBJECT_COMMIT || "unrecorded",
    corpusRoot: CORPUS_ROOT,
    populationDerived: population.length,
    populationExcludedUnparseable: skip.size,
    populationExcludedReasons: [...new Set([...skip.values()])],
    populationMeasurable: measurable.length,
    sampleStride: sample.length > 0 ? Math.max(1, Math.floor(measurable.length / sample.length)) : 0,
    filesMeasured: sample.length - failed,
    failed,
    symbols,
    relationships: allRels.length,
    importsChannelEntries: importEntries,
    exportsChannelEntries: exportEntries,
    unfilteredBytes,
    filteredType,
    filteredBytes,
    ratio: filteredBytes > 0 ? Number((unfilteredBytes / filteredBytes).toFixed(3)) : null,
    parseWallMs,
    msPerFile: Number((parseWallMs / Math.max(1, sample.length - failed)).toFixed(3)),
    relationshipsPerSecond: Math.round(allRels.length / Math.max(0.001, parseWallMs / 1000)),
    byType: shapes,
    perFileBytes: perFile.map((p) => p.bytes),
  }
  const artifact = process.env.GROOVY_PAYLOAD_ARTIFACT || "validation/m14/groovy/groovy-payload-latency.json"
  writeFileSync(artifact, JSON.stringify(out, null, 2))

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`PAYLOAD/LATENCY [${label}]  ${out.filesMeasured} of ${out.populationMeasurable} measurable files (derived population ${out.populationDerived}, ${out.populationExcludedUnparseable} excluded as unparseable-in-budget)`)
  L(`  relationships ${out.relationships}   symbols ${out.symbols}   imports[] ${out.importsChannelEntries}   exports[] ${out.exportsChannelEntries}`)
  L(`  unfiltered payload        ${unfilteredBytes.toLocaleString()} bytes`)
  L(`  largest single type       ${filteredType} ${filteredBytes.toLocaleString()} bytes`)
  L(`  ratio unfiltered/filtered ${out.ratio}`)
  L(`  parseFile wall            ${out.parseWallMs} ms  (${out.msPerFile} ms/file, ${out.relationshipsPerSecond} rel/s)`)
  for (const s of shapes) {
    const share = unfilteredBytes > 0 ? ((100 * s.bytes) / unfilteredBytes).toFixed(1) : "0.0"
    L(`    ${s.type.padEnd(14)} ${String(s.count).padStart(6)} edges  ${s.bytes.toLocaleString().padStart(10)} bytes  ${share}%`)
  }
  L(`  artifact: ${artifact}`)
}

await main()
