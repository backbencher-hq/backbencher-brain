// VERIFY_KOTLIN — DOES THE TYPE FIRE?
//
// Runs the lane's analyzer through the PRODUCTION path (getParser -> parse ->
// analyze) over a stratified sample of the pinned kotlin corpus and answers,
// with numbers, the six questions of docs/analyzers/ONTOLOGY-WORKSTREAM.md §1
// for every relationship type the analyzer can construct.
//
// NO REGEX (hard rule 1). NO assertion that is not a count (rule: absence
// without a measurement is a defect).
//
// Usage: tsx validation/m14/kotlin/kotlin-firing.ts [fileCount]
import { readFileSync, writeFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"
import { ASTEngine } from "../../../src/ast/engine"
import { RelationshipType as TypesRelationshipType } from "../../../src/ast/types"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"
import { walkKotlin, stratify, moduleSpread, KOTLIN_CORPUS, KOTLIN_CORPUS_PIN, CorpusFile } from "./kotlin-corpus"

/**
 * THE TYPE UNIVERSE IS THE UNION OF BOTH ENUMS, and the reason is a defect.
 *
 * script/m14/firing-check.mjs:52 builds its "did it fire" universe from
 * `src/ast/types.ts`, where `Imports = "brain_import"`. Every analyzer builds
 * its edges from `ASTEngine.RelationshipType` in `src/ast/engine.ts`, where
 * `Imports = "imports"`. 23 analyzers use that symbol. So the value
 * `brain_import` is one NO analyzer can produce, and the harness will report it
 * as SILENT — "constructible but produced nothing" — for a lane that is emitting
 * the edge correctly under the other name.
 *
 * Both enums are enumerated here so the census reports the value that actually
 * came out, and reports the divergence rather than silently picking a side.
 */
const TYPES_ENUM_VALUES: string[] = []
for (const v of Object.values(TypesRelationshipType)) if (TYPES_ENUM_VALUES.indexOf(v) === -1) TYPES_ENUM_VALUES.push(v)
const ENGINE_ENUM_VALUES: string[] = []
for (const v of Object.values(ASTEngine.RelationshipType)) if (ENGINE_ENUM_VALUES.indexOf(v) === -1) ENGINE_ENUM_VALUES.push(v)
const ALL: string[] = TYPES_ENUM_VALUES.slice()
for (const v of ENGINE_ENUM_VALUES) if (ALL.indexOf(v) === -1) ALL.push(v)
ALL.sort()
const ENUM_DIVERGENCE: Array<{ member: string; typesTs: string; engineTs: string }> = []
for (const k of Object.keys(TypesRelationshipType)) {
  const a = String((TypesRelationshipType as any)[k])
  const b = String((ASTEngine.RelationshipType as any)[k])
  if (a !== b) ENUM_DIVERGENCE.push({ member: k, typesTs: a, engineTs: b })
}
console.log("RelationshipType enum divergence between src/ast/types.ts and src/ast/engine.ts:")
for (const d of ENUM_DIVERGENCE) console.log(`  ${d.member.padEnd(12)} types.ts="${d.typesTs}"  engine.ts="${d.engineTs}"`)
if (ENUM_DIVERGENCE.length === 0) console.log("  (none)")
console.log(`universe for this census: ${ALL.length} values (union)\n`)

interface TypeAudit {
  count: number
  files: string[]
  confidence: Record<string, number>
  evidenceClass: Record<string, number>
  metadataRelationshipType: Record<string, number>
  reasonCodes: Record<string, number>
  emptySource: number
  emptyTarget: number
  placeholderSource: number
  placeholderTarget: number
  sourceResolves: number
  targetResolves: number
  sampleEdges: Array<{ file: string; line?: number; source: string; target: string }>
}

function blank(): TypeAudit {
  return {
    count: 0, files: [], confidence: {}, evidenceClass: {}, metadataRelationshipType: {},
    reasonCodes: {}, emptySource: 0, emptyTarget: 0, placeholderSource: 0, placeholderTarget: 0,
    sourceResolves: 0, targetResolves: 0, sampleEdges: [],
  }
}

function bump(d: Record<string, number>, k: string | undefined): void {
  const key = k === undefined || k === "" ? "<absent>" : k
  d[key] = (d[key] || 0) + 1
}

// Placeholder endpoints the analyzer itself invents. Standing rule R7: an edge
// endpoint that is a literal the analyzer made up is not a symbol.
const SOURCE_PLACEHOLDERS = ["Global", "global", "root", "<global>", "unknown", "constructor", ""]
const TARGET_PLACEHOLDERS = ["Global", "global", "root", "<global>", "unknown", "this", "super", ""]

function isPlaceholder(v: string, list: string[]): boolean {
  return list.indexOf(v) !== -1
}

async function main() {
  const want = Number(process.argv[2] || 150)
  const pool = walkKotlin(KOTLIN_CORPUS, { minBytes: 400 })
  const files = stratify(pool, want)
  const spread = moduleSpread(files)
  console.log(`corpus ${KOTLIN_CORPUS} @ ${KOTLIN_CORPUS_PIN}`)
  console.log(`pool ${pool.length} .kt/.kts files; sample ${files.length}; modules touched ${spread.modules}`)

  const parser = await getParser("kotlin")
  const audits: Record<string, TypeAudit> = {}
  for (const t of ALL) audits[t] = blank()

  let parsed = 0, threw = 0, withErrors = 0, totalSymbols = 0
  let errorFiles: string[] = []
  const perFile: Array<{ file: string; symbols: number; rels: number; errors: number }> = []
  const t0 = Date.now()

  for (const f of files) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { threw++; continue }
    try {
      const pr = await parser.parse(content, f.path)
      const res = new RealKotlinAnalyzer().analyze(pr.rootNode, content, f.path)
      parsed++
      const syms = res.symbols || []
      totalSymbols += syms.length
      const errCount = (res.errors || []).length
      if (errCount > 0) { withErrors++; errorFiles.push(f.rel) }
      // the set of names this file's symbols can bind to
      const names = new Set<string>()
      for (const s of syms) {
        if (s.name) names.add(s.name)
        if (s.qualifiedName) names.add(s.qualifiedName)
      }
      const rels = res.relationships || []
      perFile.push({ file: f.rel, symbols: syms.length, rels: rels.length, errors: errCount })
      for (const r of rels) {
        const t = String((r as any).type ?? (r as any).relationshipType ?? "")
        if (!t) continue
        const a = audits[t] || (audits[t] = blank())
        a.count++
        if (a.files.indexOf(f.rel) === -1) a.files.push(f.rel)
        bump(a.confidence, String(r.confidence))
        const md: any = r.metadata || {}
        bump(a.evidenceClass, md.evidenceClass)
        bump(a.metadataRelationshipType, md.relationshipType)
        if (md.reasonCode) bump(a.reasonCodes, String(md.reasonCode))
        const src = String(r.source ?? "")
        const tgt = String(r.target ?? "")
        if (!src) a.emptySource++
        if (!tgt) a.emptyTarget++
        if (isPlaceholder(src, SOURCE_PLACEHOLDERS)) a.placeholderSource++
        if (isPlaceholder(tgt, TARGET_PLACEHOLDERS)) a.placeholderTarget++
        const srcLeaf = src.indexOf(".") !== -1 ? src.slice(src.lastIndexOf(".") + 1) : src
        const tgtLeaf = tgt.indexOf(".") !== -1 ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
        if (names.has(src) || names.has(srcLeaf)) a.sourceResolves++
        if (names.has(tgt) || names.has(tgtLeaf)) a.targetResolves++
        if (a.sampleEdges.length < 6) {
          a.sampleEdges.push({ file: f.rel, line: (r as any).line_number, source: src, target: tgt })
        }
      }
    } catch (e) {
      threw++
    }
  }
  const wall = Date.now() - t0

  console.log(`\nparsed ${parsed}/${files.length}  threw ${threw}  files with ERROR/MISSING nodes ${withErrors}  symbols ${totalSymbols}  wall ${wall}ms\n`)

  console.log("TYPE          COUNT   RESOLVED-src tgt   PLACEHOLDER-s/t   CONFIDENCE")
  const rows: any[] = []
  for (const t of ALL) {
    const a = audits[t]
    if (!a || a.count === 0) { console.log(`${t.padEnd(12)}      0   —  SILENT`); continue }
    const cs = a.sourceResolves / a.count, ct = a.targetResolves / a.count
    console.log(
      `${t.padEnd(12)} ${String(a.count).padStart(7)}   ${(cs * 100).toFixed(1).padStart(5)}% ${(ct * 100).toFixed(1).padStart(5)}%   ${String(a.placeholderSource).padStart(6)}/${String(a.placeholderTarget).padEnd(5)}   ${JSON.stringify(a.confidence)}`,
    )
    rows.push({ type: t, ...a, sourceResolvesPct: cs, targetResolvesPct: ct })
  }

  console.log(`\nSILENT (constructible, produced nothing): ${ALL.filter((t) => !audits[t] || audits[t].count === 0).join(" ") || "none"}`)

  const out = {
    enumDivergence: ENUM_DIVERGENCE, universeUnion: ALL, typesTsOnly: TYPES_ENUM_VALUES.filter((t) => ENGINE_ENUM_VALUES.indexOf(t) === -1),
    corpus: KOTLIN_CORPUS, pin: KOTLIN_CORPUS_PIN, sampleFiles: files.length, poolFiles: pool.length,
    modulesTouched: spread.modules, moduleSpread: spread.perModule,
    parsed, threw, withErrors, totalSymbols, wallMs: wall,
    perFile, errorFiles,
    perType: rows,
    silent: ALL.filter((t) => !audits[t] || audits[t].count === 0),
  }
  const dest = "/tmp/opencode/kotlin-firing.json"
  writeFileSync(dest, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${dest}`)
}

main().catch((e) => { console.error(String(e)); process.exit(1) })