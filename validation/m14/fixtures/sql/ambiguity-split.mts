/**
 * AMBIGUITY SPLIT — why does an edge's target name resolve to more than one published symbol, and
 * which of the reasons is the analyzer's to repair?
 *
 * ## WHY THIS EXISTS
 *
 * `script/m14/incoming-check.ts` measures ambiguity and reports it as ONE number per type. That is
 * the right number to act on and the wrong thing to act ON, because an ambiguous target is not one
 * defect. It is at least four, they have different owners, and only some of them are this lane's:
 *
 *   B1_ownerScoped   the colliding declarations are in ONE file under DIFFERENT owners. A `contains`
 *                    edge's SOURCE is the owner, so the edge already carries the disambiguator and
 *                    a consumer that reads it resolves the edge. Repairable, and partly repaired.
 *   B2_crossFile     the colliding declarations are in DIFFERENT files. SQL files are loaded as
 *                    units and SQL's own name resolution is `search_path`-ordered, so no field on an
 *                    edge can name which file's declaration is meant without inventing one the
 *                    language has no answer for.
 *   B3_kindDiffers   ONE file, ONE owner, DIFFERENT kinds — an index named after a column, a type
 *                    and a column of the same name. `memberKind` on the edge separates them. This
 *                    lane already emits it and already measured the population it carries.
 *   B4_indistinct    the colliding declarations agree on file, owner AND kind. Every field an edge
 *                    could carry is exhausted; the published NAME is simply not an identifier.
 *
 * B2 and B4 are the language's and the published-name contract's, not the analyzer's. B1 and B3 are
 * this lane's. So this instrument reports the four buckets AND, separately, the resolution rate of
 * the whole edge population under each candidate key — because the bucket says why a collision
 * happens and only the key says whether anything can be done about it.
 *
 * ## A DEFINITION THIS LANE MEASURED AND THE SHARED INSTRUMENT DOES NOT USE
 *
 * `incoming-check.ts` builds `published: Map<name, kind[]>` — the value is a DEDUPED ARRAY OF KINDS
 * — and calls a target ambiguous when `hits.length > 1`. So it reports a name as ambiguous only when
 * that name was published under MORE THAN ONE `SymbolKind`. Two `property` symbols both named `id`,
 * in two different tables, produce a one-element array and read RESOLVED; one `class` and one
 * `property` sharing a name read AMBIGUOUS.
 *
 * SQL collides overwhelmingly WITHIN a kind — `id`, `name`, `created_at`, `status` are column names
 * in every table of every repository — so for this language the shared rule measures a different
 * population from the one a consumer of the graph experiences. Both are reported here, from the same
 * symbol set, so the delta is a number rather than an opinion:
 *
 *   multiSymbol   a name resolving to >1 published SYMBOL    (what a reverse walk collides on)
 *   multiKind     a name resolving to >1 distinct KIND      (`incoming-check`'s rule)
 *
 * `script/m14/incoming-check.ts` is shared machinery and is NOT edited here; the delta is a §8
 * report item.
 *
 * ## THE RESOLUTION KEYS
 *
 * Resolution is measured for EVERY edge under each key, so the numbers are rates over a stated
 * population rather than counts over the ambiguous subset alone:
 *
 *   K0_bare      target alone                                   — what a consumer does today
 *   K1_source    (target, edge SOURCE)                          — for `contains`, source IS the owner
 *   K2_memberKind(target, edge `memberKind`)                    — this lane's field, on `contains`
 *   K3_qualified target matched as a SYMBOL's `qualifiedName`    — the field the brief lists first
 *   K1orK2       either of the two above
 *
 * `qualifiedName` is the one that is currently inert, and the reason is a concrete gap rather than
 * a judgement: `src/ast/pool-worker.ts` computes
 * `s.qualifiedName || s.metadata?.fqn || (s.scope ? \`${s.scope}.${s.name}\` : s.name)`, and this
 * analyzer sets `ownerName` but never `scope`. So every member symbol's `qualifiedName` collapses to
 * its own name and `K3` can only ever repeat `K0`. Measured below, not assumed.
 *
 * ## UNRESOLVED is split by the ANALYZER'S OWN LABEL, not by a guess
 *
 * `addRelationship` classifies a target that is a PostgreSQL catalog read, an `information_schema`
 * name, the implicit `public` schema, or a platform object, and stamps `metadata.external` with which.
 * That label is the analyzer's answer, read through production `parseFile`, so this instrument cannot
 * disagree with it. The remainder — neither resolved nor labelled external — is the only part that
 * is a candidate defect, and `--files` set to the whole admitted population is how a reader tells
 * "the declaration is outside this window" (not a defect) from "no file in the corpus declares it".
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/sql/ambiguity-split.mts --files N [--out FILE] [--list N]
 *
 * `--files N` walks the whole admitted SQL corpus and takes a DETERMINISTIC STRIDED sample of N
 * files from it, sorted by `repo/relative/path`. The admission rule is byte-identical to
 * `ontology-census.mts` (git work tree, git-tracked, <=512 KiB, `detectLanguageFromPath === "sql"`)
 * and is re-stated here rather than imported so this instrument carries no dependency on that CLI.
 * Sample membership is a pure function of the corpus listing, so a before/after pair taken at the
 * same N is the same set of files even when the corpus has grown between the two runs.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { ASTEngine } from "../../../../src/ast/engine"

const argv = process.argv.slice(2)
const fail = (m: string): never => { console.error(`ambiguity-split: ${m}`); process.exit(2) }

// `i >= 1` was OFF BY ONE, and it silently ate the first argument.
//
// MEASURED, not reasoned: `--files 1962` on a 1,962-file admitted population printed
// `sample 600`, produced edge counts byte-identical to the 600-file run, and wrote
// `sampleFiles: 600` into the artifact saved under a name saying `-full`. The parse is
// `argv.indexOf(f)`, which is 0 when the flag comes first, and `i >= 1` turned that into
// `undefined` — so `Number(undefined ?? 600)` measured a DIFFERENT POPULATION that agreed
// with the default run on every count, which is the one outcome a reader cannot detect.
// Every consistency check over that artifact passed: it was internally coherent and simply
// about something other than what its name said.
//
// The fix is the `i < 0` test plus a hard exit on a valueless flag; the receipt is the
// resolved-argument echo in the header, so a substituted default is now visible in the log
// rather than only in the count.
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const OUT = argOf("--out")
const N = Number(argOf("--files") ?? 600)
const LIST = Number(argOf("--list") ?? 40)
if (!Number.isInteger(N) || N < 1) fail(`--files must be a positive integer, got \`${argOf("--files")}\``)
if (!Number.isInteger(LIST) || LIST < 1) fail(`--list must be a positive integer, got \`${argOf("--list")}\``)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "sql"
const SIZE_CAP = 512 * 1024

// MEASURED, not assumed: this array read `"brain_import"` for `RelationshipType.Imports`,
// which was `src/ast/types.ts`'s spelling before that file was corrected to the engine's.
// `parseFile` writes `"imports"`, so every `imports` edge fell through `perType[e.type]`
// and was counted in `edgeTypesOutsideTheTen` instead — 53 edges with NO ambiguity row,
// NO resolution row and NO bucket, on a run whose header printed the type as one of the
// ten. `incoming-check.ts` reads the enum; this read a literal, which is how the two
// drifted apart. It now reads the same enum object every analyzer reads.
const RelationshipType = ASTEngine.RelationshipType
const TYPES = [
  RelationshipType.Calls, RelationshipType.Uses, RelationshipType.Contains,
  RelationshipType.Imports, RelationshipType.References, RelationshipType.Exports,
  RelationshipType.Extends, RelationshipType.Implements, RelationshipType.Overrides,
  RelationshipType.Instantiates,
] as const

type Pub = {
  file: string
  id: string
  qualifiedName: string
  kind: string
  ownerName: string | null
  ownerKind: string | null
  line: number
}
type Edge = {
  type: string
  source: string
  target: string
  file: string
  memberKind: string | null
  external: string | null
  confidence: number | null
  evidenceClass: string | null
}

// ------------------------------------------------------------------ population

const admitted: { label: string; abs: string }[] = []
let reposScanned = 0
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const picked: typeof admitted = []
if (population <= N) picked.push(...admitted)
else for (let i = 0; i < N; i++) picked.push(admitted[Math.floor((i * population) / N)])

console.log(`ambiguity split — production parseFile`)
console.log(`corpus root        ${CORPUS}`)
console.log(`--files            ${N}${N === 600 ? "   (DEFAULT — not passed on the command line)" : ""}`)
console.log(`--list             ${LIST}`)
console.log(`repos scanned      ${reposScanned}`)
console.log(`admitted population${String(population).padStart(8)}`)
console.log(`sample             ${String(picked.length).padStart(8)}  (deterministic stride over the sorted population)`)

// ------------------------------------------------------------------ parse

const byName = new Map<string, Pub[]>()
const byQname = new Map<string, Pub[]>()
const edges: Edge[] = []
let symbols = 0
let emptyNames = 0
let withQualifiedName = 0
let degraded = 0
let parseFailures = 0
const symbolKinds = new Map<string, number>()
const unknownEndpoints = new Map<string, number>()

const add = (m: Map<string, Pub[]>, key: string, p: Pub) => {
  const arr = m.get(key)
  if (arr) arr.push(p)
  else m.set(key, [p])
}

for (const f of picked) {
  let r: any
  try { r = await parseFile(f.abs, LANG) } catch { parseFailures++; continue }
  if (!r) { parseFailures++; continue }
  if (r.fallback === true) degraded++
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    if (name.length === 0) { emptyNames++; continue }
    const kind = String(s?.kind ?? "")
    symbolKinds.set(kind, (symbolKinds.get(kind) ?? 0) + 1)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) withQualifiedName++
    const p: Pub = {
      file: f.label,
      id: String(s?.id ?? name),
      qualifiedName: q,
      kind,
      ownerName: s?.ownerName == null ? null : String(s.ownerName),
      ownerKind: s?.ownerKind == null ? null : String(s.ownerKind),
      line: Number(s?.startLine ?? s?.range?.startLine ?? 0),
    }
    add(byName, name, p)
    if (q.length > 0 && q !== name) add(byQname, q, p)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    const md = (rel?.metadata ?? {}) as Record<string, any>
    if (src === "unknown") unknownEndpoints.set(`${label}:source`, (unknownEndpoints.get(`${label}:source`) ?? 0) + 1)
    if (tgt === "unknown") unknownEndpoints.set(`${label}:target`, (unknownEndpoints.get(`${label}:target`) ?? 0) + 1)
    edges.push({
      type: label,
      source: src,
      target: tgt,
      file: f.label,
      memberKind: md.memberKind == null ? null : String(md.memberKind),
      external: md.external == null ? null : String(md.external),
      confidence: typeof rel?.confidence === "number" ? rel.confidence : null,
      evidenceClass: md.evidenceClass == null ? null : String(md.evidenceClass),
    })
  }
}

console.log(`symbols published  ${String(symbols).padStart(8)}`)
console.log(`  of which a qualifiedName != bare name: ${withQualifiedName}`)
console.log(`empty names        ${String(emptyNames).padStart(8)}`)
console.log(`degraded / failures${String(degraded).padStart(8)} / ${parseFailures}`)

// ------------------------------------------------------------------ resolve

type Row = {
  edges: number
  selfLoops: number
  emptyTarget: number
  k0: number            // resolved under bare name
  multiSymbol: number   // bare name resolves to >1 SYMBOL
  multiKind: number     // bare name resolves to >1 distinct KIND
  k1: number
  k2: number
  k1orK2: number
  k3: number
  B1_ownerScoped: number
  B2_crossFile: number
  B3_kindDiffers: number
  B4_indistinct: number
  // Per CAUSE BUCKET, how many of its edges a field ALREADY ON THE EDGE reduces to a single
  // symbol — `source` matching the owner (bySource) or `memberKind` matching the kind (byMk).
  // This is the difference between a bucket that is a to-do and a bucket that is a finding
  // about the published-name contract: the probe called B1 "repairable" on the argument that
  // a `contains` edge's SOURCE is the owner, which is a property of `contains` edges and not
  // of the others — a `uses` edge sourced to `hdb_table_info_agg` names a different symbol
  // from either colliding owner, so no field it carries can separate them. `bySource.length`
  // is that test, so it is counted per bucket rather than only per type.
  fieldResolvesIn: Map<string, number>
  sourceFieldResolvesIn: Map<string, number>
  unlabelledExternal: number
  labelledExternal: number
  labelledExternalKinds: Map<string, number>
  unlabelledUnresolved: number
  unlabelledTopTargets: Map<string, number>
  lowConfidence: number
  nonStructural: number
  distinctTargets: number
  examples: Map<string, Map<string, string[]>>
}
const blank = (): Row => ({
  edges: 0, selfLoops: 0, emptyTarget: 0, k0: 0, multiSymbol: 0, multiKind: 0, k1: 0, k2: 0, k1orK2: 0, k3: 0,
  B1_ownerScoped: 0, B2_crossFile: 0, B3_kindDiffers: 0, B4_indistinct: 0,
  fieldResolvesIn: new Map(), sourceFieldResolvesIn: new Map(),
  unlabelledExternal: 0, labelledExternal: 0, labelledExternalKinds: new Map(),
  unlabelledUnresolved: 0, unlabelledTopTargets: new Map(),
  lowConfidence: 0, nonStructural: 0, distinctTargets: 0, examples: new Map(),
})
const perType: Record<string, Row> = {}
for (const t of TYPES) perType[t] = blank()
const outsideTheTen: Record<string, number> = {}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
const ex = (r: Row, bucket: string, e: Edge, hits: Pub[]) => {
  let m = r.examples.get(bucket)
  if (!m) { m = new Map(); r.examples.set(bucket, m) }
  const key = `${e.file}|${e.target}`
  if (m.has(key) || m.size >= LIST) return
  m.set(key, [
    hits.slice(0, 5).map((h) => `${h.file}#${h.id}(${h.kind}${h.ownerName ? ` in ${h.ownerName}` : ""})`).join(" ; "),
    `edgeSource=${e.source}`,
    `memberKind=${e.memberKind ?? "-"}`,
  ])
}

for (const e of edges) {
  const row = perType[e.type]
  if (!row) { outsideTheTen[e.type] = (outsideTheTen[e.type] ?? 0) + 1; continue }
  row.edges++
  if (e.confidence != null && e.confidence < 0.7) row.lowConfidence++
  if (e.evidenceClass != null && e.evidenceClass !== "structural") row.nonStructural++
  if (e.target.length === 0) { row.emptyTarget++; continue }
  if (e.source === e.target) { row.selfLoops++; continue }

  // Same resolution order `incoming-check.ts` uses: bare name, else qualified name.
  let hits = byName.get(e.target)
  let viaQualified = false
  if (!hits || hits.length === 0) { hits = byQname.get(e.target); viaQualified = hits != null }

  if (!hits || hits.length === 0) {
    // The analyzer's OWN external label, read through production parseFile. Not a guess.
    if (e.external != null) {
      row.labelledExternal++
      bump(row.labelledExternalKinds, e.external)
    } else {
      row.unlabelledUnresolved++
      bump(row.unlabelledTopTargets, e.target)
    }
    continue
  }

  row.distinctTargets++
  const kinds = new Set(hits.map((h) => h.kind))
  if (kinds.size > 1) row.multiKind++

  // ---- resolution under each candidate key, over the WHOLE population
  //
  // EACH KEY COUNTS AN EDGE ONLY IF THAT KEY IS WHAT RESOLVED IT, and this needed saying out loud
  // because the instrument got it wrong until `contains` began targeting a qualified name.
  //
  // `k0` is "the target resolved as a published BARE NAME". The lookup above already falls back to
  // the qualified index, so an edge the bare lookup missed and the qualified one found was being
  // counted in `k0` anyway — which made `k0` mean "resolved somehow" and made the `k0`-vs-`k3`
  // contrast, the entire reason both columns exist, unreadable. `k3` had the mirror defect: it was
  // incremented once at the top of this block and again inside the single-hit branch, so it
  // reported 24,210 for 12,106 `contains` edges. Both were invisible while every target in the lane
  // was a bare name, because then `viaQualified` was false and neither arm could fire.
  //
  // `k1` and `k2` are keyed on the BARE target (with the edge's source, with `memberKind`), so a
  // qualified target has not been resolved by them either.
  if (hits.length === 1) {
    if (!viaQualified) { row.k0++; row.k1++; row.k2++; row.k1orK2++ }
    else row.k3++
    continue
  }
  row.multiSymbol++
  const bySource = hits.filter((h) => `${h.ownerName ?? ""}|${h.file}` === `${e.source}|${e.file}`)
  const byMk = e.memberKind == null ? [] : hits.filter((h) => h.kind === e.memberKind)
  if (viaQualified) row.k3++
  if (bySource.length === 1) row.k1++
  if (byMk.length === 1) row.k2++
  if (bySource.length === 1 || byMk.length === 1) row.k1orK2++

  // ---- cause bucket, independent of the key test above
  const files = new Set(hits.map((h) => h.file))
  const owners = new Set(hits.map((h) => `${h.ownerName ?? ""}|${h.file}`))
  let bucket: string
  if (files.size > 1) bucket = "B2_crossFile"
  else if (owners.size > 1) bucket = "B1_ownerScoped"
  else if (kinds.size > 1) bucket = "B3_kindDiffers"
  else bucket = "B4_indistinct"
  row[bucket as "B1_ownerScoped"]++
  if (bySource.length === 1 || byMk.length === 1) bump(row.fieldResolvesIn, bucket)
  if (bySource.length === 1) bump(row.sourceFieldResolvesIn, bucket)
  ex(row, bucket, e, hits)
}

// ------------------------------------------------------------------ report

const pad = (s: string | number, n: number) => String(s).padStart(n)
const live = TYPES.filter((t) => perType[t].edges > 0)

console.log("")
console.log("A. RESOLUTION under each candidate key — denominator is EVERY edge of the type")
console.log("   K0 bare target   K1 +edge SOURCE   K2 +memberKind   K1|K2   K3 qualified name")
console.log("")
console.log("type".padEnd(14) + pad("edges", 7) + pad("K0", 7) + pad("K1", 7) + pad("K2", 7) + pad("K1|K2", 7) + pad("K3", 7) + pad("selfLp", 7) + pad("<0.7", 6))
console.log("-".repeat(75))
for (const t of live) {
  const r = perType[t]
  console.log(
    t.padEnd(14) + pad(r.edges, 7) + pad(r.k0, 7) + pad(r.k1, 7) + pad(r.k2, 7) + pad(r.k1orK2, 7) + pad(r.k3, 7) +
    pad(r.selfLoops, 7) + pad(r.lowConfidence, 6),
  )
}

console.log("")
console.log("B. AMBIGUITY CAUSE BUCKETS — denominator is the multiSymbol edges of the type")
console.log("   multiSym = target resolves to >1 published SYMBOL; multiKind = >1 distinct KIND (incoming-check's rule)")
console.log("")
console.log("type".padEnd(14) + pad("multiSym", 10) + pad("multiKind", 10) + pad("B1owner", 9) + pad("B2xFile", 9) + pad("B3kind", 8) + pad("B4same", 8) + pad("B2share%", 10))
console.log("-".repeat(78))
for (const t of live) {
  const r = perType[t]
  if (r.multiSymbol === 0) continue
  const b2 = (100 * r.B2_crossFile) / r.multiSymbol
  console.log(
    t.padEnd(14) + pad(r.multiSymbol, 10) + pad(r.multiKind, 10) + pad(r.B1_ownerScoped, 9) + pad(r.B2_crossFile, 9) +
    pad(r.B3_kindDiffers, 8) + pad(r.B4_indistinct, 8) + pad(`${b2.toFixed(1)}%`, 10),
  )
}

console.log("")
console.log("B2. OF EACH BUCKET, THE PART A FIELD ALREADY ON THE EDGE RESOLVES (bySource, or byMk)")
console.log("   This is the actionable half of B: a bucket whose edges no carried field separates is a")
console.log("   finding about the published-name contract, and a bucket whose edges they do separate is a to-do.")
console.log("")
console.log("type".padEnd(14) + pad("bucket", 18) + pad("edges", 8) + pad("fieldResolves", 15) + pad("srcFieldOnly", 15))
console.log("-".repeat(70))
for (const t of live) {
  const r = perType[t]
  for (const b of ["B1_ownerScoped", "B2_crossFile", "B3_kindDiffers", "B4_indistinct"] as const) {
    const n = r[b]
    if (n === 0) continue
    console.log(t.padEnd(14) + pad(b, 18) + pad(n, 8) + pad(r.fieldResolvesIn.get(b) ?? 0, 15) + pad(r.sourceFieldResolvesIn.get(b) ?? 0, 15))
  }
}

console.log("")
console.log("C. RESOLUTION, by the ANALYZER'S OWN `metadata.external` LABEL (not a guess)")
for (const t of live) {
  const r = perType[t]
  const tot = r.labelledExternal + r.unlabelledUnresolved
  if (tot === 0) continue
  const kinds = JSON.stringify(Object.fromEntries([...r.labelledExternalKinds].sort((a, b) => b[1] - a[1])))
  console.log(`  ${t.padEnd(13)} unresolved ${pad(tot, 5)} = external ${pad(r.labelledExternal, 5)} ${kinds}  + UNLABELLED ${pad(r.unlabelledUnresolved, 5)}`)
}

console.log("")
console.log("UNKNOWN literal endpoints:", JSON.stringify(Object.fromEntries(unknownEndpoints)))
console.log("SYMBOL KINDS:", JSON.stringify(Object.fromEntries([...symbolKinds].sort((a, b) => b[1] - a[1]))))
console.log("edge types outside the 10:", JSON.stringify(outsideTheTen))

console.log("")
console.log("D. TOP UNLABELLED-UNRESOLVED TARGETS — the only unresolved population that is a candidate defect")
for (const t of live) {
  const r = perType[t]
  if (r.unlabelledUnresolved === 0) continue
  const top = [...r.unlabelledTopTargets].sort((a, b) => b[1] - a[1]).slice(0, 15)
  console.log(`  ${t} (${r.unlabelledUnresolved} edges, ${r.unlabelledTopTargets.size} distinct targets)`)
  for (const [name, c] of top) console.log(`    ${pad(c, 5)}  ${name}`)
}

for (const t of live) {
  const r = perType[t]
  if (r.multiSymbol === 0) continue
  console.log("")
  console.log(`E. EXAMPLES ${t} — ${r.multiSymbol} ambiguous`)
  for (const b of ["B1_ownerScoped", "B2_crossFile", "B3_kindDiffers", "B4_indistinct"]) {
    const m = r.examples.get(b)
    if (!m || m.size === 0) continue
    console.log(`  [${b}] ${r[b as "B1_ownerScoped"]}`)
    for (const v of [...m.values()].slice(0, 5)) console.log(`    ${v[0]}\n      ${v[1]}  ${v[2]}`)
  }
}

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/sql/ambiguity-split.mts",
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    corpusRoot: CORPUS,
    reposScanned,
    admittedPopulation: population,
    requestedFiles: N,
    filesArgumentPresent: argv.includes("--files"),
    sampleFiles: picked.length,
    sampling: `deterministic stride over the ${population} admitted files sorted by repo/relative/path`,
    symbolsPublished: symbols,
    symbolsWithQualifiedNameDistinctFromName: withQualifiedName,
    emptySymbolNames: emptyNames,
    degradedFiles: degraded,
    parseFailures,
    distinctPublishedNames: byName.size,
    symbolKinds: Object.fromEntries([...symbolKinds].sort((a, b) => b[1] - a[1])),
    unknownLiteralEndpoints: Object.fromEntries(unknownEndpoints),
    edgeTypesOutsideTheTen: outsideTheTen,
    perType: Object.fromEntries(live.map((t) => {
      const { examples, ...rest } = perType[t]
      return [t, {
        ...rest,
        labelledExternalKinds: Object.fromEntries(rest.labelledExternalKinds),
        fieldResolvesIn: Object.fromEntries(rest.fieldResolvesIn),
        sourceFieldResolvesIn: Object.fromEntries(rest.sourceFieldResolvesIn),
        unlabelledTopTargets: Object.fromEntries([...rest.unlabelledTopTargets].sort((a, b) => b[1] - a[1]).slice(0, 60)),
        examples: Object.fromEntries([...examples].map(([b, m]) => [b, [...m].slice(0, LIST).map(([k, v]) => ({ key: k, hits: v[0], edgeSource: v[1], memberKind: v[2] }))])),
      }]
    })),
  }, null, 2))
  console.log("")
  console.log(`wrote ${OUT}`)
}
