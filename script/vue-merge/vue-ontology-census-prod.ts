// VUE_MERGE — per-type ontology census, through the PRODUCTION entry.
//
// WHY THIS EXISTS. `script/m14/firing-check-v2.mjs` scores 1/10 on this lane
// because it calls `new Cls().analyze(rootNode, content, path)` with NO analyze
// context, and the SFC seam lives entirely on that context
// (engine.ts:1592-1623 builds context.sfcScriptTrees; real-vue-analyzer.ts:331
// reads it and nothing else). The workstream contract names `parseFile` — from
// pool-worker.ts — as the only admissible EMITTED instrument. So this census
// calls `ASTEngine.parseFile`, exactly as pool-worker.ts:833 does.
//
// WHAT IT MEASURES, per relationship type:
//   count, the FILES it came from, the distinct (source,target) endpoint pairs,
//   how often BOTH endpoints resolve to a symbol the SAME ParseResult published
//   (the "Resolved" question — an edge can exist and still be unresolvable),
//   the confidence and evidenceClass histogram (the "Confident" question; a
//   number under 0.7 is a heuristic by the honesty contract §4), and the
//   placeholder-literal / empty-name / unknown-kind counts (standing rules R7).
//
// Also: the `imports[]` channel and `exports[]` channel, tallied SEPARATELY,
// because ParseResult (src/ast/types.ts:206-216) carries them apart from
// `relationships` and conflating the two is the defect REVIEW-2026-10-04 §1
// records.
//
// NO REGEX ANYWHERE. readdirSync + endsWith + Set/Map only.
// POPULATION IS DERIVED, never a hand-written file list (honesty contract
// "an instrument must declare the population it covered").
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = process.env.BB_REPO || join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const OUT = process.env.OUT || "script/vue-merge/evidence"
const { ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
const TYPES = [...new Set(Object.values(ASTEngine.RelationshipType))].sort()

const PLACEHOLDER = new Set(["unknown", "Unknown", "<unknown>"])

function walkVue(dir: string, out: string[], depth = 0): string[] {
  if (depth > 14) return out
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      walkVue(p, out, depth + 1)
    } else if (e.name.endsWith(".vue")) out.push(p)
  }
  return out
}

interface TypeAcc {
  count: number
  files: Map<string, number>
  pairs: Map<string, number>
  bothResolve: number
  sourceResolves: number
  targetResolves: number
  neitherResolves: number
  confidences: Map<string, number>
  evidenceClasses: Map<string, number>
  placeholderEndpoint: number
  emptyEndpoint: number
  byProducer: Map<string, number>
  examples: Array<{ file: string; source: string; target: string; line?: number; confidence?: number; evidenceClass?: string; meta?: unknown }>
}
function newAcc(): TypeAcc {
  return {
    count: 0, files: new Map(), pairs: new Map(), bothResolve: 0, sourceResolves: 0,
    targetResolves: 0, neitherResolves: 0, confidences: new Map(), evidenceClasses: new Map(),
    placeholderEndpoint: 0, emptyEndpoint: 0, byProducer: new Map(), examples: [],
  }
}

/** Which producer emitted this row, read from the row's own metadata rather than
 *  guessed: `sfcDelegated` is stamped by the seam on every delegated row
 *  (real-vue-analyzer.ts:571), and the template pass stamps `isComponentUsage`
 *  or `isTemplateExpression`. Anything else is an analyzer-owned edge. This is
 *  what makes "the delegated half" a DERIVED population and not a claim. */
function producerOf(md: any, type: string): string {
  if (md?.sfcDelegated === true) return "delegated-js-ts"
  if (md?.isTemplateExpression === true) return "template-expression"
  if (md?.isComponentUsage === true) return "template-usage"
  if (md?.isMixin === true || md?.isOptionsApi === true) return "options-api"
  if (md?.isPropContract === true || md?.isEmitContract === true) return "contract"
  if (md?.isProvideContract === true || md?.isInjectContract === true) return "provide-inject"
  if (type === "contains") return "contains-pass"
  return "analyzer-other"
}

const acc: Record<string, TypeAcc> = {}
for (const t of TYPES) acc[t] = newAcc()

let importsChannel = 0, importsFiles = 0, exportsChannel = 0, exportsFiles = 0
let symbolsTotal = 0, symbolsUnknownKind = 0, symbolsEmptyName = 0, symbolsPlaceholder = 0
let filesOk = 0, filesFailed = 0, parseErrors = 0, hasErrorFiles = 0
const failures: Array<{ file: string; err: string }> = []
const fileRows: Array<Record<string, unknown>> = []
const dirArg = process.argv[2] || "vuejs"

const root = join(CORPUS, dirArg)
const all = walkVue(root, []).sort()
console.log(`population: ${all.length} .vue files = every .vue under ${root} (readdir walk, node_modules and .git excluded, sorted). No signal filter, no NFILES knob.`)

const t0 = Date.now()
for (const f of all) {
  let content: string
  try {
    if (statSync(f).size > 2_000_000) { failures.push({ file: f, err: "over 2 MB, skipped" }); filesFailed++; continue }
    content = readFileSync(f, "utf8")
  } catch (e) { failures.push({ file: f, err: String(e).slice(0, 80) }); filesFailed++; continue }
  let res
  try { res = await ASTEngine.parseFile(f, content) }
  catch (e) { failures.push({ file: f, err: String(e).slice(0, 120) }); filesFailed++; continue }
  filesOk++
  const rel = f.slice(root.length + 1)
  const perType: Record<string, number> = {}
  const symNames = new Set<string>()
  const classKinds = new Set<string>()
  for (const s of res.symbols ?? []) {
    symbolsTotal++
    symNames.add(s.name)
    if (s.kind === undefined || s.kind === null || s.kind === "" || String(s.kind).toLowerCase() === "unknown") symbolsUnknownKind++
    if (!s.name) symbolsEmptyName++
    if (PLACEHOLDER.has(s.name)) symbolsPlaceholder++
    classKinds.add(String(s.kind))
  }
  // component identities: a Class-kind symbol is what a component edge resolves to
  const componentNames = new Set<string>()
  for (const s of res.symbols ?? []) if (s.kind === ASTEngine.SymbolKind.Class) componentNames.add(s.name)
  for (const r of res.relationships ?? []) {
    const t = (r.relationshipType ?? r.type) as string
    const a = acc[t] ?? (acc[t] = newAcc())
    a.count++
    perType[t] = (perType[t] ?? 0) + 1
    a.files.set(rel, (a.files.get(rel) ?? 0) + 1)
    const pair = `${r.source} -> ${r.target}`
    a.pairs.set(pair, (a.pairs.get(pair) ?? 0) + 1)
    const conf = r.confidence === undefined ? "absent" : String(r.confidence)
    a.confidences.set(conf, (a.confidences.get(conf) ?? 0) + 1)
    const ec = (r.metadata?.evidenceClass as string) ?? "absent"
    a.evidenceClasses.set(ec, (a.evidenceClasses.get(ec) ?? 0) + 1)
    const p = producerOf(r.metadata, t)
    a.byProducer.set(p, (a.byProducer.get(p) ?? 0) + 1)
    const s = String(r.source ?? ""), tg = String(r.target ?? "")
    if (!s || !tg) a.emptyEndpoint++
    if (PLACEHOLDER.has(s) || PLACEHOLDER.has(tg)) a.placeholderEndpoint++
    // BOTH-ENDPOINT RESOLUTION, measured against the symbols THIS ParseResult
    // published. A cross-file target cannot resolve in a single-file view, so
    // this is a LOWER BOUND on resolvability and is labelled as such.
    const sOk = componentNames.has(s) || symNames.has(s)
    const tOk = componentNames.has(tg) || symNames.has(tg)
    if (sOk && tOk) a.bothResolve++
    else if (sOk) a.sourceResolves++
    else if (tOk) a.targetResolves++
    else a.neitherResolves++
    if (a.examples.length < 6) a.examples.push({ file: rel, source: s, target: tg, line: r.line_number, confidence: r.confidence, evidenceClass: r.metadata?.evidenceClass, meta: r.metadata })
  }
  const imps = res.imports ?? []
  if (imps.length) { importsChannel += imps.length; importsFiles++ }
  const exps = res.exports ?? []
  if (exps.length) { exportsChannel += exps.length; exportsFiles++ }
  parseErrors += (res.errors ?? []).length
  if (res.errors && res.errors.length) hasErrorFiles++
  fileRows.push({ file: rel, symbols: (res.symbols ?? []).length, relationships: (res.relationships ?? []).length, imports: imps.length, exports: exps.length, errors: (res.errors ?? []).length, byType: perType, componentClass: [...componentNames].join(","), kinds: [...classKinds].sort().join(",") })
  if (filesOk % 100 === 0) console.log(`  ...${filesOk}/${all.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
}

const ms = Date.now() - t0
console.log(`\n${dirArg}: ${filesOk}/${all.length} parsed ok, ${filesFailed} failed, ${parseErrors} parse errors over ${hasErrorFiles} files, ${ms} ms`)
console.log(`symbols ${symbolsTotal} (unknown kind ${symbolsUnknownKind}, empty name ${symbolsEmptyName}, placeholder ${symbolsPlaceholder})`)
console.log(`imports[] channel: ${importsChannel} over ${importsFiles} files   exports[] channel: ${exportsChannel} over ${exportsFiles} files`)

const table: Array<Record<string, unknown>> = []
for (const t of TYPES) {
  const a = acc[t]
  table.push({
    type: t,
    count: a.count,
    files: a.files.size,
    fileList: [...a.files.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} (${v})`),
    distinctPairs: a.pairs.size,
    bothEndpointsResolve: a.bothResolve,
    sourceOnly: a.sourceResolves,
    targetOnly: a.targetResolves,
    neitherResolves: a.neitherResolves,
    resolvePct: a.count ? Number(((a.bothResolve / a.count) * 100).toFixed(1)) : 0,
    confidences: Object.fromEntries([...a.confidences.entries()].sort((x, y) => y[1] - x[1])),
    evidenceClasses: Object.fromEntries([...a.evidenceClasses.entries()].sort((x, y) => y[1] - x[1])),
    placeholderEndpoints: a.placeholderEndpoint,
    emptyEndpoints: a.emptyEndpoint,
    byProducer: Object.fromEntries([...a.byProducer.entries()].sort((x, y) => y[1] - x[1])),
    examples: a.examples,
  })
}

console.log(`\ntype          count  files  bothRes  conf-histogram`)
for (const row of table) {
  const t = row as any
  console.log(`${String(t.type).padEnd(12)} ${String(t.count).padStart(6)} ${String(t.files).padStart(6)} ${String(t.resolvePct).padStart(7)}%  ${JSON.stringify(t.confidences)}  ${JSON.stringify(t.evidenceClasses)}`)
  if (t.count) console.log(`${"".padEnd(12)} byProducer ${JSON.stringify(t.byProducer)}`)
}

const ev = {
  instrument: "script/vue-merge/vue-ontology-census-prod.ts",
  entry: "ASTEngine.parseFile (the call pool-worker.ts:833 makes)",
  at: new Date().toISOString(),
  corpus: dirArg,
  population: { filesFound: all.length, filesParsed: filesOk, filesFailed, definition: `every .vue under ${root}, readdir walk, node_modules/.git excluded, sorted` },
  types: TYPES,
  counts: Object.fromEntries(TYPES.map((t) => [t, acc[t].count])),
  filesPerType: Object.fromEntries(TYPES.map((t) => [t, acc[t].files.size])),
  importsChannel: { rows: importsChannel, files: importsFiles },
  exportsChannel: { rows: exportsChannel, files: exportsFiles },
  symbols: { total: symbolsTotal, unknownKind: symbolsUnknownKind, emptyName: symbolsEmptyName, placeholder: symbolsPlaceholder },
  parseErrors, hasErrorFiles, failures, wallMs: ms,
  table,
  perFile: fileRows,
}
if (!existsSync(OUT)) writeFileSync(OUT + "/.keep", "")
writeFileSync(join(OUT, `prod-census-${dirArg}.json`), JSON.stringify(ev, null, 1))
console.log(`\nevidence: ${join(OUT, `prod-census-${dirArg}.json`)}`)
if (failures.length) console.log(`failures: ${failures.length} ${JSON.stringify(failures.slice(0, 5))}`)