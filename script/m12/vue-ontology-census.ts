/**
 * VUE ONTOLOGY CENSUS — the instrument behind every "EMITTED … with a count and
 * the files it came from" verdict in docs/analyzers/real-vue-analyzer.md.
 *
 * It measures the TEN relationship types through the PRODUCTION entry point
 * (`parseFile` from src/ast/pool-worker, not `analyze()`), because the worker
 * boundary is where rows and symbols are filtered and where metadata is dropped;
 * an analyzer-level count is a different population from an indexed one.
 *
 * Per type it records: the row count, the file count, examples, the evidence-tier
 * and confidence distributions, WHICH producer wrote each row (this lane's own
 * template/Options/contract producers versus the JS/TS delegate's), endpoint
 * resolution (in-file, and against a repo-wide symbol index built in a first
 * pass), placeholder endpoints, and any `instantiates` target that is a builtin
 * tag. It also emits a FEATURE CENSUS — every marker this analyzer writes,
 * counted — because "does this branch fire?" cannot be answered by counting the
 * label: `mixins:` and `extends:` are the same label and only one of them fires.
 *
 * READ-ONLY. Writes one JSON report and nothing else.
 *
 * USAGE
 *   npx tsx script/m12/vue-ontology-census.ts [langFilter] [out.json]
 *   BB_VUE_WORKERS=1 …   serial; see the concurrency note below
 *   BB_VUE_LIMIT=400 …   cap the draw (the default 0 means every admitted file)
 *   BB_CORPUS_ROOT=… …   alternate corpus root
 *
 * CONCURRENCY IS PART OF THE MEASUREMENT, and that is measured, not assumed. At
 * 8 concurrent workers this script reported 25,249 relationships over 1,151
 * corpus files where the serial run reports 25,261 — 12 rows short, reproducibly,
 * on a run where nothing else differed. Serial runs are stable (two runs,
 * identical counts) and a single-file `parseFile` is stable (8 parses of each of
 * 5 files, identical every time), so the loss needs the full draw and 8 workers to
 * appear. Whether it lives in `parseFile` or in this harness's concurrency is not
 * settled; until it is, every count published by this lane is the SERIAL one, and
 * `workerCount` is recorded in the report so two runs can be compared at all.
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const only = process.argv[2] ? process.argv[2].split(",").filter(Boolean) : []
/** The report path. Deliberately NOT a path under validation/: the results
 *  directories are the milestone's evidence, they are written by verifier
 *  scripts, and this is a lane instrument. Pass the path you want. */
const OUT = process.argv[3] ?? "/tmp/vue-ontology-census.json"
const LIMIT = Number(process.env.BB_VUE_LIMIT ?? "0")
/**
 * Concurrency is an explicit, REPORTED knob, not a constant in the middle of the
 * file. It was 8, hardcoded, and the census is how every "EMITTED … with a
 * count" verdict in this lane's doc is measured — so a number that moved with the
 * worker count would move a verdict. `BB_VUE_WORKERS=1` measures the same
 * population serially; `workerCount` is recorded in the report so two runs can be
 * compared at all.
 */
const workerCount = Math.max(1, Number(process.env.BB_VUE_WORKERS ?? "8"))


const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked.sort()) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
const drawn = LIMIT > 0 ? files.slice(0, LIMIT) : files
const byRepo = new Map<string, number>()
for (const f of drawn) byRepo.set(f.repo, (byRepo.get(f.repo) ?? 0) + 1)

/** Repo-wide symbol names, so "does this endpoint resolve" is answered against the
 *  whole project draw rather than only the file that emitted the row. A per-file
 *  join cannot see a cross-file edge at all, and four of the ten labels here are
 *  cross-file by construction (imports, calls, instantiates, extends). */
const repoSymbols = new Map<string, Set<string>>()
const fileUnresolved = new Map<Type, string[]>()
const BUILTIN_TAGS = new Set(["a","abbr","address","area","article","aside","audio","b","base","bdi","bdo","blockquote","body","br","button","canvas","caption","cite","code","col","colgroup","data","datalist","dd","del","details","dfn","dialog","div","dl","dt","em","embed","fieldset","figcaption","figure","footer","form","h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","iframe","img","input","ins","kbd","label","legend","li","link","main","map","mark","menu","meta","meter","nav","noscript","object","ol","optgroup","option","output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","script","search","section","select","slot","small","source","span","strong","style","sub","summary","sup","table","tbody","td","template","textarea","tfoot","th","thead","time","title","tr","track","u","ul","var","video","wbr","svg","path","g","rect","circle","ellipse","line","polyline","polygon","text","tspan","use","defs","linearGradient","radialGradient","stop","mask","pattern","marker","view","symbol","clipPath","component","transition","transition-group","keep-alive","teleport","suspense","fragment"])

type Row = {
  type: Type
  count: number
  files: number
  fileExamples: string[]
  evidenceClass: Record<string, number>
  confidence: Record<string, number>
  /** producer breakdown by a metadata-derived label */
  producer: Record<string, number>
  /** both endpoints present and non-empty */
  endpointsBothNamed: number
  endpointMissing: number
  emptySource: number
  emptyTarget: number
  /** endpoints that resolve to a symbol published by the same file */
  sourceResolves: number
  targetResolves: number
  targetResolvesInFileOnly: number
  /** target resolves to a symbol name SOMEWHERE in the same repository draw */
  targetResolvesInRepo: number
  /** targets that are a builtin HTML/Vue tag (an `instantiates` target must never be) */
  builtinTargets: string[]
  /** R7 placeholders */
  placeholderEndpoints: string[]
  /** any source not equal to the component identity and not a member */
  sourceNotComponent: number
}
const rows = new Map<Type, Row>()
const mkRow = (t: Type): Row => ({
  type: t, count: 0, files: 0, fileExamples: [], evidenceClass: {}, confidence: {},
  producer: {}, endpointsBothNamed: 0, endpointMissing: 0, emptySource: 0, emptyTarget: 0,
  sourceResolves: 0, targetResolves: 0, targetResolvesInFileOnly: 0, targetResolvesInRepo: 0,
  builtinTargets: [], placeholderEndpoints: [], sourceNotComponent: 0,
})

const PLACEHOLDER = new Set(["module", "global", "unknown", "unknown_symbol", "?", "", "<unknown>", "anonymous", "default", "self", "this"])

// pass 1: the repo-wide symbol index. Two passes because resolution is a
// question about the PROJECT, and one pass cannot answer it for a file that has
// not been read yet.
{
  let i2 = 0
  const w = async () => {
    while (true) {
      const k = i2++
      if (k >= drawn.length) return
      const f = drawn[k]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { continue }
      const set = repoSymbols.get(f.repo) ?? new Set<string>()
      for (const s2 of r.symbols ?? []) set.add(String(s2.name))
      repoSymbols.set(f.repo, set)
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => w()))
}
console.log(`repo symbol index: ${[...repoSymbols.entries()].map(([k, v]) => `${k}=${v.size}`).join(" ")}`)

/**
 * FEATURE CENSUS — "does this branch fire?", counted from the analyzer's own
 * emitted metadata rather than by re-reading the source. A branch that never
 * fires is dead code and derivation cannot see it, so each producer this lane
 * has a marker for is counted here: the marker is written only on the rows the
 * branch produced.
 */
const features: Record<string, number> = {}
const featureFiles = new Map<string, Set<string>>()
const feat = (k: string, label: string) => {
  features[k] = (features[k] ?? 0) + 1
  if (!featureFiles.has(k)) featureFiles.set(k, new Set<string>())
  featureFiles.get(k)!.add(label)
}

let parseFail = 0
let fileErrors = 0
let totalSymbols = 0
let totalRels = 0
let perFile: Array<{ f: string; syms: number; rels: number; errs: number }> = []

let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= drawn.length) return
    const f = drawn[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
    const label = `${f.repo}/${f.rel}`
    const syms: any[] = r.symbols ?? []
    totalSymbols += syms.length
    totalRels += (r.relationships ?? []).length
    const errs = (r.errors ?? []).length
    if (errs) fileErrors++
    perFile.push({ f: label, syms: syms.length, rels: (r.relationships ?? []).length, errs })
    // per-SYMBOL feature markers (contract resolution path, dispatch, identity)
    for (const s of syms) {
      const md = s.metadata ?? {}
      if (md.contractSource) feat(`symbol:contractSource=${md.contractSource}`, label)
      if (md.isProp) feat("symbol:isProp(Options props key)", label)
      if (md.isEmit) feat("symbol:isEmit(Options emits key)", label)
      if (md.isDataKey) feat("symbol:isDataKey", label)
      if (md.isWatcher) feat("symbol:isWatcher(watch option)", label)
      if (md.isSetup) feat("symbol:isSetup(setup option)", label)
      if (md.isLifecycleHook) feat("symbol:isLifecycleHook", label)
      if (md.isProvided) feat("symbol:isProvided", label)
      if (md.synthesized) feat("symbol:synthesized", label)
      if (md.declaredNameUnreadable) feat("symbol:declaredNameUnreadable", label)
      if (md.identityFromFileStem) feat("symbol:identityFromFileStem", label)
      if (md.isScriptSetupComponent) feat("symbol:isScriptSetupComponent(defineOptions name)", label)
      if (md.inheritedFrom) feat(`symbol:inheritedFrom=${md.inheritedFrom}`, label)
      if ((r.metadata as any)?.hasTypeInference === true) feat("file:hasTypeInference(ts/tsx dispatch)", label)
    }
    const symNames = new Set(syms.map((s: any) => s.name))
    const componentSyms = new Set(syms.filter((s: any) => s.kind === "class").map((s: any) => s.name))
    const memberNames = new Set(syms.map((s: any) => s.name))
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = rows.get(t) ?? mkRow(t)
      row.count++
      const md = x.metadata ?? {}
      const ec = String(md.evidenceClass ?? "(none)")
      row.evidenceClass[ec] = (row.evidenceClass[ec] ?? 0) + 1
      const c = typeof x.confidence === "number" ? String(x.confidence) : "(none)"
      row.confidence[c] = (row.confidence[c] ?? 0) + 1
      // Which PRODUCER in this lane wrote the row. `sfcDelegated` is not a
      // discriminator on its own: the F12/F2 contract edges set it too, because
      // the store's relationship identity has no metadata component and an edge
      // pushed before the sub-analyzer merge loses at the insert. So the
      // contract markers are read FIRST, and the delegate's own
      // `relationshipType` metadata discriminates its rows.
      let producer = "(none)"
      if (md.isPropContract || md.isEmitContract || md.isProvideContract || md.isInjectContract) producer = "vue-contract"
      else if (md.isTemplateExpression) producer = "vue-template-uses"
      else if (md.isComponentUsage) producer = "vue-template-tag"
      else if (t === "contains") producer = md.sfcDelegated === true ? "delegate-contains" : "vue-owner-contains"
      else if (md.isOptionsApi) producer = "vue-options"
      else if (md.sfcDelegated === true) producer = md.relationshipType ? `delegate:${String(md.relationshipType)}` : "delegate"
      row.producer[producer] = (row.producer[producer] ?? 0) + 1
      const s = String(x.source ?? "")
      const g = String(x.target ?? "")
      if (!s || !g) { row.endpointMissing++; if (!s) row.emptySource++; if (!g) row.emptyTarget++ }
      else row.endpointsBothNamed++
      if (PLACEHOLDER.has(g) || PLACEHOLDER.has(s)) row.placeholderEndpoints.push(`${label}: ${s} -> ${g}`)
      if (symNames.has(s)) row.sourceResolves++
      if (symNames.has(g)) row.targetResolves++
      if (memberNames.has(g)) row.targetResolvesInFileOnly++
      const repoSyms = repoSymbols.get(f.repo)
      if (repoSyms?.has(g)) row.targetResolvesInRepo++
      if (t === "instantiates" && BUILTIN_TAGS.has(g)) row.builtinTargets.push(`${label}: ${g}`)
      if (md.member) feat(`instantiates:dottedTag(${md.member})`, label)
      if (md.componentPath) feat(`instantiates:dottedTag(componentPath=${md.componentPath})`, label)
      if (md.isMixin === true) feat("extends:mixin-option", label)
      if (md.isMixin === false) feat("extends:extends-option", label)
      if (md.isPropContract) feat("references:propContract", label)
      if (md.isEmitContract) feat("references:emitContract", label)
      if (md.isProvideContract) feat("references:provideContract", label)
      if (md.isInjectContract) feat("references:injectContract", label)
      if (md.unresolved === true) feat(`edge:unresolved(${t})`, label)
      if (md.isTemplateExpression) feat("uses:templateExpression", label)
      if (md.isTemplateExpression === true && typeof md.line === "number") feat("uses:templateExpression-with-line", label)
      if (md.decoratorLine != null) feat(`references:decoratorMirror(${md.decoratorLine})`, label)
      if (md.sfcDefaultExport === true) feat("exports:seamWritten(sfcDefaultExport)", label)
      if (md.evidenceClass) feat(`tier:${md.evidenceClass}`, label)
      if (!symNames.has(g)) {
        const arr = fileUnresolved.get(t) ?? []
        if (arr.length < 6) arr.push(`${label}: ${s} -> ${g}`)
        fileUnresolved.set(t, arr)
      }
      if (!componentSyms.has(s) && !componentSyms.size) row.sourceNotComponent++
      if (row.fileExamples.length < 4 && !row.fileExamples.includes(label)) row.fileExamples.push(label)
      // file counting
      const any = row as any
      any._files = (any._files ?? new Set<string>())
      ;(any._files as Set<string>).add(label)
      rows.set(t, row)
    }
  }
}
const t0 = Date.now()
await Promise.all(Array.from({ length: workerCount }, () => worker()))
const wall = Date.now() - t0

/** One summary entry per ALL_TYPES, INCLUDING a type the draw never fired: that
 *  entry carries zeros and none of the row's own counters, so the print loop below
 *  reads the counters as OPTIONAL. The array was left inferred as that union and
 *  the loop read four fields off the arm that does not declare them. */
type SummaryRow = { type: Type; count: number; files: number } & Partial<Row>
const out: SummaryRow[] = ALL_TYPES.map((t) => {
  const r = rows.get(t)
  if (!r) return { type: t, count: 0, files: 0 }
  const any = r as any
  return { ...r, files: (any._files as Set<string>).size }
})
writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(), corpusRoot: CR, filesDrawn: drawn.length, byRepo: Object.fromEntries(byRepo),
  parseFail, fileErrors, totalSymbols, totalRels, wallMs: wall, workerCount,
  repoSymbolCounts: Object.fromEntries([...repoSymbols.entries()].map(([k, v]) => [k, v.size])),
  features: Object.fromEntries(Object.entries(features).sort().map(([k, v]) => [k, { occurrences: v, files: featureFiles.get(k)?.size ?? 0 }])),
  targetsNotInFile: Object.fromEntries([...fileUnresolved.entries()].map(([k, v]) => [k, v])),
  rows: out,
}, null, 2))
console.log(`files drawn: ${drawn.length} (${JSON.stringify(Object.fromEntries(byRepo))})  workers=${workerCount}`)
console.log(`parse failures: ${parseFail}   files with errors: ${fileErrors}   symbols: ${totalSymbols}   relationships: ${totalRels}   wall: ${wall}ms`)
console.log("type            count     files  bothNamed  srcRes  tgtRes  prod")
for (const r of out) {
  console.log(
    `${r.type.padEnd(14)} ${String(r.count).padStart(6)} ${String(r.files).padStart(8)} ${String(r.endpointsBothNamed ?? 0).padStart(9)} ${String(r.sourceResolves ?? 0).padStart(7)} ${String(r.targetResolves ?? 0).padStart(7)}  ${JSON.stringify(r.producer ?? {})}`,
  )
}
console.log("\nfeature census (branch firing, from emitted metadata):")
for (const [k, v] of Object.entries(features).sort()) console.log(`  ${k.padEnd(46)} ${String(v).padStart(6)} rows/syms in ${String(featureFiles.get(k)?.size ?? 0).padStart(4)} files`)
console.log(`\nreport: ${OUT}`)