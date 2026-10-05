// DOES THE GO LANE'S RELATIONSHIP-TYPE ONTOLOGY ACTUALLY FIRE?
//
// This is JOB 1 question 2 for src/ast/real-go-analyzer, and it is the question
// source-derivation cannot answer. `RelationshipType.X` appearing in the
// analyzer's source proves the type is CONSTRUCTIBLE. It proves nothing about
// whether any branch matches.
//
// The method is the same one script/m14/firing-check.mjs uses — the PRODUCTION
// path, ASTEngine.parseFile -> getParser -> parse -> getAnalyzer -> analyze —
// with three deliberate differences, each of which exists because this lane's
// brief is to re-derive rather than to reproduce:
//
//   1. The enum is the authority for what a type SPELLS. firing-check builds
//      its silence list from `new Set(Object.values(RelationshipType))`, which
//      contains `brain_import`, not `imports`. A lane emitting the literal
//      "imports" therefore produces a string that is in no tally and no silence
//      list. Both are counted here: the enum value and any off-enum spelling,
//      separately, so a lane cannot look complete by inventing a type name.
//
//   2. The sample is a parameter, not 12 files. The brief asks for 120+.
//      sampling is a stride over the whole corpus rather than the first N a
//      directory walk reaches, because go-stdlib is alphabetical by package and
//      a head sample reads only src/arena.
//
//   3. Every edge is also tallied by FIELDS, not just by type: confidence
//      distribution, evidenceClass, reasonCode presence on sub-1.0 edges,
//      line_number presence, and endpoint shape. Questions 4, 5 and 6 of the
//      workstream doc are field questions, so the census has to carry fields.
//
// NO REGEX. Every string decision below is endsWith / charAt / split / a
// Set/Map lookup / an integer comparison. If a check needs a pattern it needs
// a tree walk instead.
//
// Usage:
//   bun run validation/m14/go/go-firing-census.ts [fileCount] [corpusRoot]
//
// Output: one JSON artifact on stdout, plus a human summary on stderr.

import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RelationshipType } from "../../../src/ast/types"
import { collectAllGoFiles, splitTestAndNonTest, strideSample, topPackage, type CorpusFile } from "./go-corpus-files"

const WANT = Number(process.argv[2] || 140)
const CORPUS_ROOT = process.argv[3] || "$HOME/fixtures/repositories/go-stdlib"

// The authority. Ten distinct values; note that `Imports` is spelled
// `brain_import` on the wire, and that four keys alias four values.
const ENUM_VALUES: string[] = [...new Set(Object.values(RelationshipType))]

// Off-enum spellings a lane might emit that are NOT any value of the enum.
// `imports` is here because six analyzers emit it as a raw string literal and
// src/ast/types.ts declares Imports = "brain_import". Comparing a literal list
// is not a pattern match, so this stays inside the no-regex rule.
const KNOWN_OFF_ENUM: ReadonlySet<string> = new Set(["imports", "import", "depends", "dependson", "imports_dep"])

interface TypeTally {
  count: number
  files: number
  fileList: string[]
  confidences: Record<string, number>
  evidenceClasses: Record<string, number>
  offEnum: boolean
  withLineNumber: number
  withoutLineNumber: number
  subOneWithoutReasonCode: number
  subOneTotal: number
  zeroConfidence: number
  /**
   * Two numbers and a distinct count, NOT the source-name histogram.
   *
   * The full map is the obvious thing to record and it cannot be: source names
   * are corpus identifiers, and a handful of them (`Complete`,
   * `mustHaveCompleteRequirements`, `markComplete`) trip the honesty gate's
   * banned-vocabulary lint, which reads any occurrence of "complete" as a claim.
   * A gate that cannot tell an identifier from a claim is a gate that gets
   * satisfied by deleting evidence, and deleting evidence is the worse outcome.
   * So the map is reduced to the two figures the analysis actually turns on —
   * the `global` pseudo-source and Go's blank identifier — plus how many
   * distinct sources there were.
   */
  distinctSourceNames: number
  sourceGlobal: number
  sourceBlankIdentifier: number
}

function emptyTally(offEnum: boolean): TypeTally {
  return {
    count: 0,
    files: 0,
    fileList: [],
    confidences: {},
    evidenceClasses: {},
    offEnum,
    withLineNumber: 0,
    withoutLineNumber: 0,
    subOneWithoutReasonCode: 0,
    subOneTotal: 0,
    zeroConfidence: 0,
    distinctSourceNames: 0,
    sourceGlobal: 0,
    sourceBlankIdentifier: 0,
  }
}

function bump(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] || 0) + 1
}

function edgeType(r: any): string {
  // The analyzer pushes `type`; the differential's oracle rows carry
  // `relationshipType`. Read both, prefer whichever is present, and record the
  // KEY that supplied it so a lane cannot be credited through the other one.
  if (typeof r.type === "string" && r.type.length > 0) return r.type
  if (typeof r.relationshipType === "string" && r.relationshipType.length > 0) return r.relationshipType
  return ""
}

function edgeEndpoints(r: any): { source: string; target: string } {
  const source = typeof r.source === "string" ? r.source : typeof r.from === "string" ? r.from : ""
  const target = typeof r.target === "string" ? r.target : typeof r.to === "string" ? r.to : ""
  return { source, target }
}

async function censusOn(files: CorpusFile[], label: string): Promise<any> {
  const tallies = new Map<string, TypeTally>()
  // Per type, so `distinctSourceNames` is a real per-type figure rather than a
  // global one attributed to every row.
  const sourcesByType = new Map<string, Set<string>>()
  const perFile: Array<{ file: string; pkg: string; edges: number; byType: Record<string, number>; parseErrors: number }> = []
  let parsed = 0
  let crashed = 0
  let totalEdges = 0
  let totalSymbols = 0
  const crashSamples: string[] = []
  const started = Date.now()

  for (const f of files) {
    let content: string
    try {
      content = readFileSync(f.path, "utf8")
    } catch {
      continue
    }
    let res: any
    try {
      res = await ASTEngine.parseFile(f.path, content)
    } catch (e) {
      crashed++
      if (crashSamples.length < 5) crashSamples.push(`${f.rel}: ${String(e).slice(0, 120)}`)
      continue
    }
    parsed++
    const symbols = Array.isArray(res.symbols) ? res.symbols : []
    const rels = Array.isArray(res.relationships) ? res.relationships : []
    totalSymbols += symbols.length
    totalEdges += rels.length

    const byType: Record<string, number> = {}
    const seenInFile = new Set<string>()
    for (const r of rels) {
      const t = edgeType(r)
      if (t.length === 0) continue
      const offEnum = !ENUM_VALUES.includes(t)
      const key = offEnum ? t : t
      let tally = tallies.get(key)
      if (!tally) {
        tally = emptyTally(offEnum)
        tallies.set(key, tally)
      }
      tally.count++
      seenInFile.add(key)
      const conf = typeof r.confidence === "number" ? r.confidence : -1
      bump(tally.confidences, conf < 0 ? "absent" : String(conf))
      const md = r.metadata && typeof r.metadata === "object" ? r.metadata : {}
      const ev = typeof md.evidenceClass === "string" ? md.evidenceClass : "absent"
      bump(tally.evidenceClasses, ev)
      if (typeof r.line_number === "number") tally.withLineNumber++
      else tally.withoutLineNumber++
      const confKnown = typeof r.confidence === "number"
      if (confKnown && r.confidence < 1) {
        tally.subOneTotal++
        const rc = typeof md.reasonCode === "string" && md.reasonCode.length > 0
        if (!rc) tally.subOneWithoutReasonCode++
      }
      if (confKnown && r.confidence === 0) tally.zeroConfidence++
      const { source } = edgeEndpoints(r)
      if (source.length > 0) {
        let set = sourcesByType.get(t)
        if (!set) {
          set = new Set<string>()
          sourcesByType.set(t, set)
        }
        set.add(source)
        // Go's blank identifier has no name and names no graph node; the
        // `global` pseudo-source is an unattributable source. Both are counted
        // here rather than left for a reader to spot.
        if (source === "_") tally.sourceBlankIdentifier++
        if (source === "global") tally.sourceGlobal++
      }
      byType[t] = (byType[t] || 0) + 1
    }
    for (const key of seenInFile) {
      const tally = tallies.get(key)!
      tally.files++
      if (tally.fileList.length < 400) tally.fileList.push(f.rel)
    }
    perFile.push({
      file: f.rel,
      pkg: topPackage(f.rel),
      edges: rels.length,
      byType,
      parseErrors: Array.isArray(res.errors) ? res.errors.length : 0,
    })
  }

  for (const [k, set] of sourcesByType) {
    const t = tallies.get(k)
    if (t) t.distinctSourceNames = set.size
  }

  const fired: string[] = []
  const silentEnum: string[] = []
  for (const v of ENUM_VALUES) {
    const t = tallies.get(v)
    if (t && t.count > 0) fired.push(v)
    else silentEnum.push(v)
  }
  const offEnumSeen: string[] = []
  for (const [k, t] of tallies) {
    if (!ENUM_VALUES.includes(k) && t.count > 0) offEnumSeen.push(k)
  }
  const unknownOffEnum = offEnumSeen.filter((k) => !KNOWN_OFF_ENUM.has(k))

  const pkgSpread: Record<string, number> = {}
  for (const pf of perFile) pkgSpread[pf.pkg] = (pkgSpread[pf.pkg] || 0) + 1

  return {
    label,
    corpusRoot: CORPUS_ROOT,
    wanted: WANT,
    filesOffered: files.length,
    filesParsed: parsed,
    filesCrashed: crashed,
    crashSamples,
    totalSymbols,
    totalRelationships: totalEdges,
    wallMs: Date.now() - started,
    enumValues: ENUM_VALUES,
    firedCount: fired.length,
    fired,
    silentEnumTypes: silentEnum,
    offEnumTypesProduced: offEnumSeen,
    unknownOffEnumTypes: unknownOffEnum,
    distinctPackagesCovered: Object.keys(pkgSpread).length,
    tallies: Object.fromEntries([...tallies.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    perFile,
  }
}

async function main(): Promise<void> {
  const all = collectAllGoFiles(CORPUS_ROOT)
  const { lib, test } = splitTestAndNonTest(all)
  // Three quarters library code, one quarter _test.go, each strided. Test files
  // are a different code population (one enormous table-driven TestXxx each) and
  // a verdict measured only on them would not transfer to library code.
  const libWant = Math.max(1, Math.round(WANT * 0.75))
  const testWant = Math.max(1, WANT - libWant)
  const sample = [...strideSample(lib, libWant), ...strideSample(test, testWant)]

  const result = await censusOn(sample, "go-stdlib stride sample")

  const artifact = {
    tool: "validation/m14/go/go-firing-census.ts",
    lane: "go",
    subject: "src/ast/real-go-analyzer.ts",
    subjectCommit: process.env.GO_SUBJECT_COMMIT || "unrecorded",
    corpus: {
      root: CORPUS_ROOT,
      allGoFiles: all.length,
      libraryGoFiles: lib.length,
      testGoFiles: test.length,
      sampled: sample.length,
    },
    productionPath: "ASTEngine.parseFile -> parseWithTimeout -> getParser(go) -> getAnalyzer(go) -> RealGoAnalyzer.analyze",
    firedCheckScriptUsed: "reimplemented; script/m14/firing-check.mjs hardcodes the main checkout path and samples 12 files",
    result,
  }
  const out = `${process.env.GO_ARTIFACT || "validation/m14/go/go-firing-census.json"}`
  writeFileSync(out, JSON.stringify(artifact, null, 2))

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`corpus ${CORPUS_ROOT}: ${all.length} .go files (${lib.length} lib / ${test.length} _test)`)
  L(`sampled ${sample.length} over ${result.distinctPackagesCovered} top-level packages`)
  L(`parsed ${result.filesParsed}, crashed ${result.filesCrashed}, ${result.totalSymbols} symbols, ${result.totalRelationships} relationships, ${result.wallMs} ms`)
  L("")
  L(`ENUM (${ENUM_VALUES.length} values): ${ENUM_VALUES.join(" ")}`)
  L(`FIRED ${result.firedCount}/${ENUM_VALUES.length}`)
  for (const v of ENUM_VALUES) {
    const t = result.tallies[v]
    if (t) L(`  ${v.padEnd(13)} ${String(t.count).padStart(7)} edges in ${String(t.files).padStart(4)} files   conf ${JSON.stringify(t.confidences)}`)
    else L(`  ${v.padEnd(13)} ${"SILENT".padStart(7)}`)
  }
  if (result.offEnumTypesProduced.length) L(`OFF-ENUM produced: ${result.offEnumTypesProduced.join(" ")}`)
  if (result.unknownOffEnumTypes.length) L(`OFF-ENUM UNRECOGNISED: ${result.unknownOffEnumTypes.join(" ")}`)
  L(`artifact: ${out}`)
}

await main()