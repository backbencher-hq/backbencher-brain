/**
 * PROTOBUF LANE CENSUS — counts off real code through the PRODUCTION entry point.
 *
 * ## Why this exists
 *
 * `ontology-coverage-gate.ts` is the arbiter, and it answers one question per
 * relationship type: EMITTED or RULED. To answer it for protobuf it needs a
 * ruling table, which it does not have (see the lane report). This census is the
 * part of the answer that does NOT depend on a ruling table: what production
 * `parseFile` actually produced, on real files, with counts.
 *
 * ## The instrument is `parseFile`, not `analyze()`
 *
 * `analyze()` is a per-file unit that skips the pipeline stages pool-worker owns:
 * the 5 MB structural fallback, the 1 MB structural fallback, encoding detection
 * by BOM, `keepSymbol`, `filterNoiseRelationships`, and the export forwarding
 * added by M60 LUA-14. A count taken from `analyze()` measures a code path the
 * product does not run. So every PRIMARY number here comes from `parseFile` in
 * `src/ast/pool-worker.ts`.
 *
 * The analyzer is run too, and separately labelled, because endpoint RESOLUTION
 * cannot be answered from `parseFile` alone: pool-worker's symbol projection
 * (pool-worker.ts:855-895) copies a fixed field list and does NOT carry
 * per-symbol `metadata`, so the analyzer's published `metadata.id` — the resolved
 * id every relationship endpoint uses — does not survive the boundary. Measuring
 * only the product would therefore have reported a resolution rate against a
 * symbol set the analyzer never had. Both sets are reported, and the difference
 * between them is itself a measurement.
 *
 * ## Sampling
 *
 * The whole corpus is walked, not sampled: `BB_CORPUS_LIMIT` caps the number of
 * files per repository, `0` (the default) means no cap. The walk is the working
 * tree, NOT `git ls-files`, because three of the corpora here are sparse
 * checkouts and `git ls-files` lists every tracked path whether or not it is on
 * disk — measured 2026-10-03, it offered 477 / 7,341 / 166 protos for the three
 * sparse corpora against 108 / 128 / 42 actually present, so 8,694 of the 9,564
 * it offered are not on disk. Reading those would have made the corpus size a
 * fiction.
 *
 * CLI: npx tsx script/m14/protobuf-census.ts [--out /tmp/pb-census.json] [--limit=N]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/opencode/pb/census.json"
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="))
const PER_REPO_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.slice("--limit=".length)) : 0
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ------------------------------------------------------------------ corpus walk
type CorpusFile = { repo: string; rel: string; abs: string; bytes: number }
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
      corpus.push({ repo: entry, rel: r, abs, bytes: st.size })
      n++
    }
  }
  walk(dir, "")
  perRepo[entry] = n
}
const reposWithProto = Object.entries(perRepo).filter(([, n]) => n > 0)
console.error(`corpus: ${corpus.length} .proto files in ${reposWithProto.length} repositories (${reposWithProto.map(([r, n]) => `${r}=${n}`).join(" ")})`)

// ------------------------------------------------------------------ grammar
// One parser instance shared by every worker: a tree-sitter Parser is not
// documented as re-entrant, and eight of them would each hold their own wasm.
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

// ------------------------------------------------------------------ tallies
type RelRow = {
  n: number
  files: Set<string>
  conf: Record<string, number>
  evidence: Record<string, number>
  /** both endpoints in the ANALYZER's published id set (metadata.id) */
  aBoth: number; aSrc: number; aTgt: number; aNeither: number
  /** both endpoints in the id a consumer RE-DERIVES from the stored symbol */
  rBoth: number; rSrc: number; rTgt: number; rNeither: number
  examples: string[]
}
const rel = new Map<Type, RelRow>()
const kinds = new Map<string, number>()
const badKinds = new Map<string, string>()
let symsAnalyzer = 0, symsProduct = 0
let emptyNames = 0, emptyNameFiles: string[] = []
let unknownEndpoints = 0, unknownEndpointExamples: string[] = []
let importsN = 0, filesWithImports = 0
let selfLoops = 0
let filesOk = 0, filesFail = 0, failExamples: string[] = []
let dupAnalyzerIds = 0, dupProductIds = 0
let relsAnalyzer = 0, relsProduct = 0
let analyzerOnlyRels = 0, productOnlyRels = 0
const perRepoRel = new Map<string, Map<Type, number>>()

const row = (t: Type): RelRow => {
  let r = rel.get(t)
  if (!r) { r = { n: 0, files: new Set(), conf: {}, evidence: {}, aBoth: 0, aSrc: 0, aTgt: 0, aNeither: 0, rBoth: 0, rSrc: 0, rTgt: 0, rNeither: 0, examples: [] }; rel.set(t, r) }
  return r
}

let idx = 0
async function worker(): Promise<void> {
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  while (true) {
    const i = idx++
    if (i >= corpus.length) return
    const f = corpus[i]
    const label = `${f.repo}/${f.rel}`

    // ---- production entry point
    let prod: any
    try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch (e: any) { filesFail++; if (failExamples.length < 10) failExamples.push(`${label}: ${e?.message}`); continue }
    filesOk++

    // ---- analyzer, for the published ids parseFile does not carry
    const content = readFileSync(f.abs, "utf8")
    const tree = parser.parse(content)
    const a: any = analyzer.analyze(tree.rootNode, content, f.abs)

    const analyzerIds = new Set<string>()
    for (const s of a.symbols ?? []) analyzerIds.add(String(s.metadata?.id ?? s.name))
    const redrawn = new Set<string>()
    for (const s of prod.symbols ?? []) {
      const id = s.ownerName ? `${s.ownerName}.${s.name}` : s.name
      redrawn.add(id)
      redrawn.add(s.qualifiedName ?? s.name)
      redrawn.add(s.name)
    }

    symsAnalyzer += (a.symbols ?? []).length
    symsProduct += (prod.symbols ?? []).length
    relsAnalyzer += (a.relationships ?? []).length
    relsProduct += (prod.relationships ?? []).length
    const imp = prod.imports ?? []
    if (imp.length) { filesWithImports++; importsN += imp.length }

    const aSeen = new Map<string, number>()
    for (const s of a.symbols ?? []) { const k = String(s.metadata?.id ?? s.name); aSeen.set(k, (aSeen.get(k) ?? 0) + 1) }
    for (const [, c] of aSeen) if (c > 1) dupAnalyzerIds += c - 1
    const pSeen = new Map<string, number>()
    for (const s of prod.symbols ?? []) { const k = s.ownerName ? `${s.ownerName}.${s.name}` : s.name; pSeen.set(k, (pSeen.get(k) ?? 0) + 1) }
    for (const [, c] of pSeen) if (c > 1) dupProductIds += c - 1

    for (const src of [a, prod]) for (const s of src.symbols ?? []) {
      const k = String(s.kind ?? "")
      kinds.set(k, (kinds.get(k) ?? 0) + 1)
      if (!k || k === "unknown" || k === "undefined" || k === "null") { if (!badKinds.has(k)) badKinds.set(k, label) }
      if (typeof s.name !== "string" || s.name.length === 0) { emptyNames++; if (emptyNameFiles.length < 10) emptyNameFiles.push(label) }
    }

    // Per-type edge accounting is taken from the PRODUCTION result; the analyzer
    // result is only compared for type COUNTS, so a pipeline-stage loss shows up
    // as analyzerOnlyRels rather than being hidden inside a resolution rate.
    const prodKeys = new Set<string>()
    for (const x of prod.relationships ?? []) prodKeys.add(`${x.source}\u0000${x.target}\u0000${x.type}`)
    for (const x of a.relationships ?? []) {
      if (!prodKeys.has(`${x.source}\u0000${x.target}\u0000${x.type}`)) analyzerOnlyRels++
    }
    for (const x of prod.relationships ?? []) {
      if (!((a.relationships ?? []).some((y: any) => y.source === x.source && y.target === x.target && y.type === x.type))) productOnlyRels++
    }

    let rr = perRepoRel.get(f.repo)
    if (!rr) { rr = new Map(); perRepoRel.set(f.repo, rr) }
    for (const x of prod.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const w = row(t)
      w.n++
      if (w.files.size < 6) w.files.add(label)
      if (w.examples.length < 6) w.examples.push(`${x.source} -> ${x.target}`)
      const c = String(x.confidence)
      w.conf[c] = (w.conf[c] ?? 0) + 1
      const ec = String((x.metadata as any)?.evidenceClass ?? "(absent)")
      w.evidence[ec] = (w.evidence[ec] ?? 0) + 1
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      if (src === "unknown" || tgt === "unknown") { unknownEndpoints++; if (unknownEndpointExamples.length < 10) unknownEndpointExamples.push(`${t}: ${src} -> ${tgt} (${label})`) }
      if (src === tgt) selfLoops++
      const sA = analyzerIds.has(src), tA = analyzerIds.has(tgt)
      if (sA && tA) w.aBoth++; else if (sA) w.aSrc++; else if (tA) w.aTgt++; else w.aNeither++
      const sR = redrawn.has(src), tR = redrawn.has(tgt)
      if (sR && tR) w.rBoth++; else if (sR) w.rSrc++; else if (tR) w.rTgt++; else w.rNeither++
      rr.set(t, (rr.get(t) ?? 0) + 1)
    }
    tree.delete?.()
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ------------------------------------------------------------------ report
const pct = (n: number, d: number) => (d ? +(100 * n / d).toFixed(2) : null)
const out: any = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  sampling: `working-tree walk of every *.proto under ${CR}${PER_REPO_LIMIT ? `, capped at ${PER_REPO_LIMIT}/repo` : ", uncapped"}`,
  filesAdmitted: corpus.length,
  repos: Object.fromEntries(reposWithProto),
  parseOk: filesOk,
  parseFail: filesFail,
  failExamples,
  symbolsAnalyzerDirect: symsAnalyzer,
  symbolsThroughParseFile: symsProduct,
  relationshipsAnalyzerDirect: relsAnalyzer,
  relationshipsThroughParseFile: relsProduct,
  edgesOnlyFromAnalyzer: analyzerOnlyRels,
  edgesOnlyFromParseFile: productOnlyRels,
  symbolsWithEmptyName: emptyNames,
  emptyNameFiles,
  symbolKinds: Object.fromEntries([...kinds.entries()].sort((a, b) => b[1] - a[1])),
  badSymbolKinds: Object.fromEntries(badKinds),
  importsRecordedInImportsArray: importsN,
  filesWithImports,
  duplicateAnalyzerIds: dupAnalyzerIds,
  duplicateRedrawnIds: dupProductIds,
  selfLoopingRelationships: selfLoops,
  relationshipEndpointsEqualUnknown: unknownEndpoints,
  unknownEndpointExamples,
  relationships: Object.fromEntries(ALL_TYPES.map((t) => {
    const w = rel.get(t)
    if (!w) return [t, { n: 0 }]
    return [t, {
      n: w.n,
      filesSample: [...w.files],
      confidence: w.conf,
      evidenceClass: w.evidence,
      analyzerIdSet: { bothEnds: w.aBoth, sourceOnly: w.aSrc, targetOnly: w.aTgt, neither: w.aNeither, bothEndsRatePct: pct(w.aBoth, w.n), sourceRatePct: pct(w.aBoth + w.aSrc, w.n) },
      redrawnIdSet: { bothEnds: w.rBoth, sourceOnly: w.rSrc, targetOnly: w.rTgt, neither: w.rNeither, bothEndsRatePct: pct(w.rBoth, w.n), sourceRatePct: pct(w.rBoth + w.rSrc, w.n) },
      heuristicUnder07: Object.entries(w.conf).filter(([k]) => Number(k) < 0.7).reduce((acc, [, v]) => acc + v, 0),
      examples: w.examples,
    }]
  })),
  perRepoRelationships: Object.fromEntries([...perRepoRel.entries()].map(([k, v]) => [k, Object.fromEntries(v)])),
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\nfiles ${filesOk} ok / ${filesFail} fail`)
console.log(`symbols   analyzer-direct ${symsAnalyzer}   through parseFile ${symsProduct}`)
console.log(`edges     analyzer-direct ${relsAnalyzer}   through parseFile ${relsProduct}   analyzer-only ${analyzerOnlyRels}   parseFile-only ${productOnlyRels}`)
console.log(`symbols with empty name ${emptyNames}   bad kinds ${badKinds.size}   endpoints=="unknown" ${unknownEndpoints}   self-loops ${selfLoops}`)
console.log(`imports[] recorded ${importsN} in ${filesWithImports} files   (relationships: see the table)`)
console.log(`\n${w("type", 13)}${w("edges", 8)}${w("aBoth", 8)}${w("aBoth%", 9)}${w("rBoth", 8)}${w("rBoth%", 9)}${w("c<0.7", 7)}evidenceClass`)
console.log("-".repeat(104))
for (const t of ALL_TYPES) {
  const e = (out.relationships as any)[t]
  if (!e.n) { console.log(`${w(t, 13)}${w("0", 8)}${w("-", 8)}${w("-", 9)}${w("-", 8)}${w("-", 9)}${w("-", 7)}NOT EMITTED`); continue }
  console.log(`${w(t, 13)}${w(String(e.n), 8)}${w(String(e.analyzerIdSet.bothEnds), 8)}${w(String(e.analyzerIdSet.bothEndsRatePct), 9)}${w(String(e.redrawnIdSet.bothEnds), 8)}${w(String(e.redrawnIdSet.bothEndsRatePct), 9)}${w(String(e.heuristicUnder07), 7)}${JSON.stringify(e.evidenceClass)}`)
}
console.log(`\nwrote ${OUT}`)