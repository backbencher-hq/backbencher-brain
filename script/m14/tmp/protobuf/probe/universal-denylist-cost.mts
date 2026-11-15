/**
 * UNIVERDENYLIST COST FOR PROTOBUF — how many declarations does the shared
 * `keepSymbol` filter delete, and which entries are counterexamples?
 *
 * ## Why this file exists
 *
 * `lost-file-discovery.mts` found one file short on every one of its production
 * passes. `partial-loss-detail.mts` named the symbol:
 *
 *   controller.custom_options.v1.MaskMapping.this     absent on 5 of 5 attempts
 *
 * The attribution is a shared filter, not this lane. `src/ast/pool-worker.ts`
 * `keepSymbol` carries a `UNIVERSAL` denylist and justifies two of its entries
 * like this:
 *
 *   // Reserved in essentially every language parsed here. Kept unconditionally
 *   // because no lane produced a legitimate declaration of any of them.
 *   "this",
 *   "super",
 *
 * **This lane has now produced one.** `boundary/internal/proto/controller/
 * custom_options/v1/options.proto` declares a protobuf field named `this`.
 * Protobuf has no `this` keyword and no `this` expression, so the name has no
 * construct to be noise in. The premise of that comment is false, with a file
 * and a count attached.
 *
 * This file prices the WHOLE denylist against this corpus rather than stopping at
 * the one counterexample, because the honest report is "these N entries cost
 * protobuf M declarations", not "one name is wrong". Every entry is tested, and
 * an entry with no counterexample here is reported as having none.
 *
 * ## The denylist is READ, never copied
 *
 * A hand-copied list is the defect the honesty contract's population rule names:
 * it rots the moment the shared set changes and nothing diffs it. So the names are
 * extracted from the production source file, and the extraction REFUSES to run if
 * it cannot delimit exactly one `const UNIVERSAL = new Set([` block or ends up
 * with zero names. A changed shared file therefore produces a loud failure here
 * instead of a confident zero. (Line scanning is not a regex, and no regex appears
 * in this file or in the analyzer.)
 *
 * ## What counts as a declaration the filter deleted
 *
 * The analyzer's reading of the bytes, minus what production published, matched
 * under BOTH spellings — the analyzer's `metadata.id` and the product's
 * re-derived `ownerName + "." + name` — because pool-worker's projection does not
 * carry per-symbol metadata. Same identity test as `partial-loss-detail.mts`, so
 * the two agree on what "dropped" means. The reference is computed through the
 * analyzer and never through `parseFile`, so a production-side loss cannot hide
 * inside the yardstick.
 *
 * Two populations are kept apart and never added: a file whose WHOLE parse was
 * lost contributes no rows here (both sides are empty for it, and an empty
 * difference is not evidence of a filter decision), and it is named instead.
 *
 * Every dropped row is attributed by asking `nameTheSymbolRule` — the production
 * function this repo already exports for exactly that question — rather than by a
 * second copy of its rules that could drift.
 *
 * ## What it cannot see
 *
 * A drop caused by something other than the name denylist (a `keepSymbol` prefix
 * rule, the 1 MB / 5 MB structural fallback, `filterNoiseRelationships`) lands in
 * the same difference and is reported in the `other` bucket rather than being
 * folded into the denylist's cost. That bucket being non-empty is itself a report
 * item, because a name denylist is then not the only thing between the analyzer
 * and the store.
 *
 * ## Usage
 *
 *   npx tsx script/m14/tmp/protobuf/probe/universal-denylist-cost.mts [--limit=N]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile, nameTheSymbolRule } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="))
const PER_REPO_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.slice("--limit=".length)) : 0
const OUT = "/tmp/opencode/pb/universal-denylist-cost.json"
const LANG = "protobuf"

// ------------------------------------------------- the denylist, read not copied
const POOL_WORKER = path.join(process.cwd(), "src", "ast", "pool-worker.ts")
const poolSrc = readFileSync(POOL_WORKER, "utf8")
const DECL = "const UNIVERSAL = new Set(["
const declAt = poolSrc.indexOf(DECL)
if (declAt < 0) {
  console.error(`FATAL: no "${DECL}" in ${POOL_WORKER}. The denylist moved; update this probe rather than report zero.`)
  process.exit(2)
}
if (poolSrc.indexOf(DECL, declAt + 1) >= 0) {
  console.error(`FATAL: "${DECL}" appears more than once in ${POOL_WORKER}; refusing to guess which.`)
  process.exit(2)
}
const blockStart = poolSrc.indexOf("[", declAt)
const blockEnd = poolSrc.indexOf("])", blockStart)
if (blockStart < 0 || blockEnd < 0) {
  console.error("FATAL: could not delimit the UNIVERSAL block.")
  process.exit(2)
}
const UNIVERSAL = new Set<string>()
for (const rawLine of poolSrc.slice(blockStart, blockEnd).split("\n")) {
  // strip a trailing comma, then a trailing comment, then whitespace — in that
  // order, because the comment may follow the comma and vice versa
  let line = rawLine.trim()
  if (line.endsWith(",")) line = line.slice(0, -1).trim()
  const commentAt = line.indexOf("//")
  if (commentAt >= 0) line = line.slice(0, commentAt).trim()
  if (line.length < 3) continue
  const q = line[0]
  if ((q === '"' || q === "'" || q === "`") && q === line[line.length - 1]) {
    UNIVERSAL.add(line.slice(1, -1))
  }
}
if (UNIVERSAL.size === 0) {
  console.error("FATAL: extracted 0 names; refusing to report zero deletions.")
  process.exit(2)
}

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

// ------------------------------------------------------------------ reference
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
const refParser = new ParserClass()
refParser.setLanguage(grammar)

type RefRow = { id: string; name: string; kind: string; owner: string; file: string }
const refByFile = new Map<string, RefRow[]>()
let refTotal = 0
for (const f of corpus) {
  const label = `${f.repo}/${f.rel}`
  const content = readFileSync(f.abs, "utf8")
  const tree = refParser.parse(content)
  const a: any = analyzer.analyze(tree.rootNode, content, f.abs)
  const rows: RefRow[] = []
  for (const s of a.symbols ?? []) {
    rows.push({
      id: String(s.metadata?.id ?? s.name),
      name: String(s.name ?? ""),
      kind: String(s.kind ?? ""),
      owner: String(s.ownerName ?? ""),
      file: label,
    })
    refTotal++
  }
  refByFile.set(label, rows)
  tree.delete?.()
}

// ------------------------------------------------------------------ production
const lostWholeParse = new Set<string>()
const prodIdsByFile = new Map<string, Set<string>>()
const prodRelByFile = new Map<string, { type: string; source: string; target: string }[]>()
let prodTotal = 0
let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= corpus.length) return
    const f = corpus[i]
    const label = `${f.repo}/${f.rel}`
    let prod: any
    try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch { continue }
    const ids = new Set<string>()
    let n = 0
    for (const s of prod.symbols ?? []) {
      n++
      ids.add(s.ownerName ? `${s.ownerName}.${s.name}` : s.name)
      ids.add(s.qualifiedName ?? s.name)
      ids.add(s.name)
    }
    prodTotal += n
    prodIdsByFile.set(label, ids)
    prodRelByFile.set(label, (prod.relationships ?? []).map((r: any) => ({
      type: String(r.type ?? r.relationshipType ?? ""),
      source: String(r.source ?? ""),
      target: String(r.target ?? ""),
    })))
    if (n === 0) lostWholeParse.add(label)
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ------------------------------------------------------------------ the diff
type Dropped = RefRow & { rule: string; onDenylist: boolean }
const dropped: Dropped[] = []
const droppedIdsByFile = new Map<string, Set<string>>()
for (const f of corpus) {
  const label = `${f.repo}/${f.rel}`
  if (lostWholeParse.has(label)) continue
  const prodIds = prodIdsByFile.get(label)
  if (!prodIds) continue
  for (const row of refByFile.get(label) ?? []) {
    if (prodIds.has(row.id)) continue
    // An id the analyzer published unqualified can still reappear under the
    // product's owner-qualified spelling, so try that before calling it dropped.
    if (row.owner && prodIds.has(`${row.owner}.${row.name}`)) continue
    if (prodIds.has(row.name)) continue
    dropped.push({ ...row, rule: nameTheSymbolRule(row, LANG), onDenylist: UNIVERSAL.has(row.name) })
    let s = droppedIdsByFile.get(label)
    if (!s) { s = new Set<string>(); droppedIdsByFile.set(label, s) }
    s.add(row.id)
    s.add(row.name)
  }
}

/**
 * The incoming-side cost: a STORED edge that names a declaration the store never
 * published. `src/lsp/impact.ts` obtains reverse edges by scanning outgoing edges
 * and matching targets, so such an edge is one the graph asserts and cannot walk —
 * the same class the pool-worker comment attributes to the sql lane ("1 of 11,786
 * `contains` edges left naming nothing"). Counted against production edges, not
 * analyzer edges, because production is what the graph is built from.
 */
const edgesNamingDropped: { file: string; type: string; source: string; target: string; named: string }[] = []
let prodEdgeTotal = 0
for (const f of corpus) {
  const label = `${f.repo}/${f.rel}`
  if (lostWholeParse.has(label)) continue
  const droppedHere = droppedIdsByFile.get(label)
  if (!droppedHere || droppedHere.size === 0) continue
  const prodIds = prodIdsByFile.get(label)
  if (!prodIds) continue
  for (const r of prodRelByFile.get(label) ?? []) {
    prodEdgeTotal++
    for (const [endpoint, which] of [[r.source, "source"], [r.target, "target"]] as const) {
      if (droppedHere.has(endpoint)) {
        if (edgesNamingDropped.length < 40) {
          edgesNamingDropped.push({ file: label, type: String(r.type), source: String(r.source), target: String(r.target), named: `${which}=${endpoint}` })
        }
      }
    }
  }
}
void prodEdgeTotal

/** distinct dropped names, with the files they were seen in */
const byName = new Map<string, { kind: string; onDenylist: boolean; rule: string; files: string[]; examples: string[] }>()
for (const d of dropped) {
  let e = byName.get(d.name)
  if (!e) {
    e = { kind: d.kind, onDenylist: d.onDenylist, rule: d.rule, files: [], examples: [] }
    byName.set(d.name, e)
  }
  e.files.push(d.file)
  if (e.examples.length < 3) e.examples.push(d.id)
}
const names = [...byName.entries()].sort((a, b) => b[1].files.length - a[1].files.length || a[0].localeCompare(b[0]))
const denylistNames = names.filter(([, v]) => v.onDenylist)
const otherNames = names.filter(([, v]) => !v.onDenylist)
const entriesWithCounterexample = new Set(denylistNames.map(([n]) => n))

const out = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  population: `working-tree walk of every *.proto under ${CR}${PER_REPO_LIMIT ? `, capped at ${PER_REPO_LIMIT}/repo` : ", uncapped"}`,
  filesInPopulation: corpus.length,
  repositories: Object.fromEntries(reposWithProto),
  denylistSource: path.relative(process.cwd(), POOL_WORKER),
  denylistExtracted: [...UNIVERSAL].sort(),
  denylistEntryCount: UNIVERSAL.size,
  filesWholeParseLost: [...lostWholeParse].sort(),
  analyzerSymbols: refTotal,
  productionSymbols: prodTotal,
  declarationsDropped: dropped.length,
  declarationsDroppedPct: +(100 * dropped.length / refTotal).toFixed(4),
  distinctDroppedNames: names.length,
  denylistEntriesWithACounterexample: [...entriesWithCounterexample].sort(),
  denylistEntriesWithNoCounterexampleHere: [...UNIVERSAL].filter((n) => !entriesWithCounterexample.has(n)).sort(),
  storedEdgesNamingADroppedDeclaration: edgesNamingDropped.length,
  storedEdgesNamingADroppedDeclarationExamples: edgesNamingDropped,
  perName: names.map(([name, v]) => ({ name, ...v })),
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

console.log(`population  ${corpus.length} files in ${reposWithProto.length} repositories`)
console.log(`denylist    ${UNIVERSAL.size} entries READ from ${out.denylistSource}: ${JSON.stringify(out.denylistExtracted)}`)
console.log(`published   analyzer ${refTotal} / production ${prodTotal}`)
console.log(`\nfiles whose WHOLE parse was lost — named, excluded from the diff, never added to it: ${lostWholeParse.size}`)
for (const f of out.filesWholeParseLost) console.log(`  LOST-WHOLE  ${f}`)
console.log(`\ndeclarations the analyzer published that production did NOT: ${dropped.length} of ${refTotal} (${out.declarationsDroppedPct}%)`)
console.log(`distinct dropped names: ${names.length}   on the denylist: ${denylistNames.length}   NOT on it: ${otherNames.length}`)
console.log(`\ndenylist entries WITH a protobuf counterexample: ${entriesWithCounterexample.size} of ${UNIVERSAL.size} — ${JSON.stringify(out.denylistEntriesWithACounterexample)}`)
console.log(`denylist entries with NO counterexample in this corpus: ${JSON.stringify(out.denylistEntriesWithNoCounterexampleHere)}`)
console.log(`\nSTORED edges naming a declaration the store never published: ${edgesNamingDropped.length}`)
for (const e of edgesNamingDropped) console.log(`  ${e.type.padEnd(10)} ${e.named.padEnd(60)} in ${e.file}`)
console.log(`\nper distinct dropped name:`)
for (const [name, v] of names) {
  console.log(`  ${v.onDenylist ? "DENYLIST" : "other   "}  ${name.padEnd(24)} kind=${v.kind.padEnd(10)} in ${String(v.files.length).padStart(3)} file(s)  ${v.files[0]}`)
  for (const ex of v.examples) console.log(`             id: ${ex}`)
}
console.log(`\nwrote ${OUT}`)