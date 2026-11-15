/**
 * FSHARP LANE — the incoming ambiguity split and the unresolved partition, with counts.
 *
 * ## Why this file exists
 *
 * The fleet sweep `validation/m14/measurements/incoming-whole.tsv` puts this lane at
 * **40,791 ambiguous and 33,339 unresolved** over 600 files — the worst of 23 lanes.
 * Pass 3 of this lane measured ambiguity at **146 of 8,473 distinct `qualified_name`
 * values** and concluded the shape was the language's. Those two numbers are not in
 * conflict: they are measured on DIFFERENT KEYS, and this file prints both on the same
 * walk so the disagreement is visible rather than asserted.
 *
 *   - the pass-3 number keys on `qualifiedName`. F# publishes `Foo.Bar.baz` and it is
 *     nearly unique, so it reads ~1.7%.
 *   - the fleet number keys on `name`. Every `let f`, every `member f`, every module-level
 *     binding in 6,627 files publishes a simple name, so the same name recurs in hundreds
 *     of files and reads ~65% of edges.
 *
 * Which key is correct is a question about what `src/lsp/impact.ts`'s target-matching
 * actually looks up, and this file measures at BOTH rather than picking the flattering one.
 *
 * ## An ambiguous edge is ONE edge
 *
 * One edge the reverse walk attributes to one of N declarations — not N edges. So the
 * count cannot be lowered by emitting fewer edges, and a change that drops edges to move
 * it is not a fix. What moves it is the analyzer naming which declaration it meant.
 * Every number below is an EDGE count against a stated file population.
 *
 * ## The ambiguity classes, and which are the lane's to repair
 *
 *   A  SCOPE      several declarations of one name in ONE file, or under the same
 *                 enclosing module chain. A real scoping failure. The lane's to repair:
 *                 it owns the AST and can see the scopes.
 *   B  MODULE     one declaration per file, N files. The name is legal and distinct in
 *                 each; a bare target cannot say which. The lane can read the module
 *                 because it already emits `imports` naming the namespaces in scope.
 *   C  CONTRACT   one name, two or more KINDS, or a type and its companion module. F#'s
 *                 `type Foo` beside `module Foo` is an ordinary idiom producing two real
 *                 declarations under one spelling, and the language provides no third
 *                 token to separate them. NOT repairable inside one analyzer.
 *
 * ## The unresolved partition, because four different findings all read as 0
 *
 *   U1  target's LEAF is a published name           — emitter/publisher spelling disagreement
 *   U2  target's HEAD is a published name            — the edge carries a module path, and
 *                                                      the declaration sits under a prefix
 *   U3  target names a .NET/BCL namespace root       — external by construction (cause C)
 *   U4  target names nothing in the sample           — the sample window, or genuinely absent
 *
 * Only U1 and U2 are things this lane can repair by changing what it emits. U4 is
 * dominated by `FSharp.Core`, which no corpus checkout provides, and is counted separately
 * for that reason rather than folded into a repairable total.
 *
 * ## No regex
 *
 * The corpus walk is `git ls-files` + `statSync`; the language filter is
 * `detectLanguageFromPath` from the production detector. Every classification below is a
 * `Set`/`Map` lookup or `split(".")` / `lastIndexOf(".")`. No pattern literal appears in
 * this file and none is needed.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/fsharp/incoming-abc.mts
 *   BB_FSHARP_FILES=120 npx tsx validation/m14/fixtures/fsharp/incoming-abc.mts
 *   BB_FSHARP_OUT=/tmp/x.json npx tsx validation/m14/fixtures/fsharp/incoming-abc.mts --json
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, statSync, readdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"

import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WANT = Number(process.env.BB_FSHARP_FILES ?? 600)
/** No repo may take more than its share, so `fsharp` (6,627 files) cannot crowd out Grace (545). */
const PER_REPO = Number(process.env.BB_FSHARP_PER_REPO ?? 400)
const JSON_ONLY = process.argv.includes("--json")
const OUT = process.env.BB_FSHARP_OUT ?? "/tmp/opencode/fs/incoming-abc.json"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Store label -> ontology name. Both `imports` spellings accepted, for the reason `incoming-check.ts` gives. */
const LABEL_ALIASES: Record<string, Type> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}

// ───────────────────────────────────────────────────────── corpus discovery
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const byRepo = new Map<string, FileRow[]>()
{
  let entries: string[]
  try { entries = readdirSync(CR).sort() } catch { entries = [] }
  for (const e of entries) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    const rows: FileRow[] = []
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let size: number
      try { size = statSync(abs).size } catch { continue }
      if (size > 512 * 1024) continue
      let text: string
      try { text = readFileSync(abs, "utf8") } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "fsharp") continue
      rows.push({ repo: e, dir, rel, abs })
    }
    if (rows.length > 0) byRepo.set(e, rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
  }
}

/** Family-stratified round-robin — identical in method to the xml lane's draw. */
const sample: FileRow[] = []
{
  const queues = new Map([...byRepo].map(([k, v]) => [k, [...v]]))
  const taken = new Map<string, number>()
  let progress = true
  while (progress && sample.length < WANT) {
    progress = false
    for (const [repo, rows] of queues) {
      if (rows.length === 0 || sample.length >= WANT) continue
      if ((taken.get(repo) ?? 0) >= PER_REPO) continue
      sample.push(rows.shift()!)
      taken.set(repo, (taken.get(repo) ?? 0) + 1)
      progress = true
    }
  }
}
sample.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))

/** Fingerprint of the DRAW, so "the counts moved" is separable from "the draw moved". */
const DRAW = (() => {
  const h = createHash("sha256")
  for (const f of sample) {
    let size = -1
    try { size = statSync(f.abs).size } catch {}
    h.update(`${f.repo}/${f.rel} ${size}\n`)
  }
  return h.digest("hex").slice(0, 16)
})()

// ───────────────────────────────────────────────────────── parse and index
type Decl = { file: string; kind: string; name: string; qname: string; line: number }

type Pub = {
  kinds: Set<string>
  /** `file:line`, so two declarations in one file stay distinct. */
  decls: Set<string>
  files: Set<string>
}
/** name -> declarations published under it. This is the `incoming-check.ts` key. */
const byName = new Map<string, Pub>()
/** qualifiedName -> declarations. The pass-3 key. */
const byQname = new Map<string, Pub>()

function pub(map: Map<string, Pub>, key: string): Pub {
  let p = map.get(key)
  if (!p) {
    p = { kinds: new Set(), decls: new Set(), files: new Set() }
    map.set(key, p)
  }
  return p
}

type Rel = { type: Type; src: string; tgt: string; file: string }
const rels: Rel[] = []

/**
 * The RAW store, dumped so every classification downstream of this walk is REPLAYABLE.
 *
 * The walk above is the expensive part — 600 production `parseFile` calls over the draw.
 * Every question this lane asks of the result (ambiguity buckets, U1..U4, cause B leaf
 * tests, cause C witness partitioning) is a pure function of the symbol table and the edge
 * list, and all of them were previously answered by re-walking. This array is that table,
 * written once as a sidecar beside the report.
 *
 * Without it, a claim like "the U4 `neither` bucket is X% FSharp.Compiler names" can only be
 * checked by re-running the walk, and a re-run with a different `WANT` is a DIFFERENT
 * population, so the check silently answers a different question. Replaying one dump against
 * many witnesses keeps the population pinned to one draw id.
 */
const storeDecls: Decl[] = []
const kindCounts = new Map<string, number>()
let symbols = 0
let degraded = 0
const parseFailures: string[] = []
const emptyNames: string[] = []
let unknownEndpoints = 0

for (const f of sample) {
  const fileKey = `${f.repo}/${f.rel}`
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch (e) {
    parseFailures.push(`${fileKey}: ${(e as Error)?.message ?? e}`)
    continue
  }
  if (!r) {
    parseFailures.push(`${fileKey}: no result`)
    continue
  }
  if (r.fallback === true) degraded++

  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) {
      emptyNames.push(`${fileKey} ${String(s?.kind ?? "")}`)
      continue
    }
    symbols++
    const kind = String(s?.kind ?? "")
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1)
    const q = String(s?.qualifiedName ?? "")
    const line = typeof s?.line === "number" ? s.line : typeof s?.startLine === "number" ? s.startLine : -1
    storeDecls.push({ file: fileKey, kind, name, qname: q, line })
    for (const key of q.length > 0 ? [name, q] : [name]) {
      const p = pub(byName, key)
      p.kinds.add(kind)
      p.decls.add(`${fileKey}:${line}`)
      p.files.add(fileKey)
    }
    if (q.length > 0) {
      const p = pub(byQname, q)
      p.kinds.add(kind)
      p.decls.add(`${fileKey}:${line}`)
      p.files.add(fileKey)
    }
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (src === "unknown" || tgt === "unknown") unknownEndpoints++
    rels.push({ type: label, src, tgt, file: fileKey })
  }
}

// ───────────────────────────────────────────────────────── classification
/**
 * Bucket one ambiguous TARGET NAME. The buckets are nested, most specific first, so a
 * row lands in exactly one and the totals sum.
 *
 * `C_contract` is tested FIRST because it is the only one no analyzer can fix, and a
 * reader deciding where to spend effort needs it separated before the two repairable
 * ones. F#'s companion pair — `type Foo` beside `module Foo` — is the archetype.
 */
function ambBucket(p: Pub): "unique" | "A_scope" | "B_module" | "C_contract" {
  if (p.kinds.size > 1) return "C_contract"
  if (p.files.size <= 1) {
    // One file. Either exactly one declaration, or several declarations of one name in
    // one file — which is a scope the analyzer walked past.
    return p.decls.size > 1 ? "A_scope" : "unique"
  }
  return "B_module"
}

type UnresClass = "U1_leafIsPublished" | "U2_headIsPublished" | "U3_bclRoot" | "U4_namesNothing"

const leafOf = (t: string): string => {
  const i = t.lastIndexOf(".")
  return i <= 0 ? t : t.slice(i + 1)
}
const headOf = (t: string): string => {
  const i = t.indexOf(".")
  return i <= 0 ? t : t.slice(0, i)
}
/**
 * BCL / FSharp.Core roots. A NAMED LIST, not a pattern: the brief's cause C is "legitimately
 * outside the corpus", and deciding membership by pattern over a target string is exactly
 * the class of guess this lane's ruling table refuses to make. Every root is checked to
 * appear as a `Head.` prefix, so `Systemic` is not `System`.
 */
const BCL_ROOTS = [
  "System", "Microsoft", "FSharp", "Newtonsoft", "Npgsql", "Serilog", "Giraffe",
  "Microsoft.Extensions", "Xunit", "Swashbuckle", "Task", "Map", "List", "Array",
  "Seq", "Option", "Result", "String", "Char", "Guid", "DateTime", "IO", "Env",
  "Console", "Threading", "Collections", "Text", "Net", "Data", "IO", "Lang",
]
function isBclRoot(t: string): boolean {
  const h = headOf(t)
  for (const r of BCL_ROOTS) if (h === r) return true
  return false
}

function unresClass(t: string): UnresClass {
  if (byName.has(leafOf(t))) return "U1_leafIsPublished"
  if (byName.has(headOf(t))) return "U2_headIsPublished"
  if (isBclRoot(t)) return "U3_bclRoot"
  return "U4_namesNothing"
}

type TypeRow = {
  fired: boolean
  edges: number
  selfLoops: number
  distinctTargets: number
  /** resolves under `name` — the `incoming-check.ts` key */
  resolvedName: number
  bothEndsName: number
  /** resolves under `qualifiedName` — the pass-3 key */
  resolvedQname: number
  /** incoming-check's rule: >1 KIND under one name */
  ambCrossKind: number
  /** >1 DECLARATION under one name, any kind */
  ambMultiDecl: number
  ambBuckets: Record<"A_scope" | "B_module" | "C_contract", number>
  unres: Record<UnresClass, number>
}
const perType = {} as Record<Type, TypeRow>
for (const t of ALL_TYPES) {
  perType[t] = {
    fired: false, edges: 0, selfLoops: 0, distinctTargets: 0,
    resolvedName: 0, bothEndsName: 0, resolvedQname: 0,
    ambCrossKind: 0, ambMultiDecl: 0,
    ambBuckets: { A_scope: 0, B_module: 0, C_contract: 0 },
    unres: { U1_leafIsPublished: 0, U2_headIsPublished: 0, U3_bclRoot: 0, U4_namesNothing: 0 },
  }
}

/** target -> how many edges named it, so the report names the widest names with counts. */
const edgeCountByTarget = new Map<string, number>()
for (const r of rels) edgeCountByTarget.set(r.tgt, (edgeCountByTarget.get(r.tgt) ?? 0) + 1)

const unresDetail = new Map<string, { type: Type; cls: UnresClass; target: string; edges: number; files: Set<string> }>()

for (const r of rels) {
  const row = perType[r.type]
  row.edges++
  if (r.src === r.tgt) {
    row.selfLoops++
    continue
  }
  const p = byName.get(r.tgt)
  if (!p) {
    const cls = unresClass(r.tgt)
    row.unres[cls]++
    const key = `${r.type}\u0000${cls}\u0000${r.tgt}`
    const d = unresDetail.get(key)
    if (d) { d.edges++; d.files.add(r.file) }
    else unresDetail.set(key, { type: r.type, cls, target: r.tgt, edges: 1, files: new Set([r.file]) })
    continue
  }
  row.resolvedName++
  if (byName.has(r.src)) row.bothEndsName++
  if (byQname.has(r.tgt)) row.resolvedQname++
  if (p.kinds.size > 1) row.ambCrossKind++
  if (p.decls.size > 1) row.ambMultiDecl++
  const b = ambBucket(p)
  if (b !== "unique") row.ambBuckets[b]++
}
for (const t of ALL_TYPES) {
  perType[t].distinctTargets = new Set(rels.filter((r) => r.type === t).map((r) => r.tgt)).size
  perType[t].fired = perType[t].edges > 0
}

// ───────────────────────────────────────────────────────── the widest names
const widest = [...edgeCountByTarget.entries()]
  .map(([target, edges]) => {
    const p = byName.get(target)
    return {
      target, edges,
      kinds: p ? [...p.kinds].sort() : [],
      decls: p ? p.decls.size : 0,
      files: p ? p.files.size : 0,
      bucket: p ? ambBucket(p) : ("unresolved" as const),
    }
  })
  .sort((a, b) => b.edges - a.edges)

// ───────────────────────────────────────────────────────── counterfactual
/**
 * THE COUNTERFACTUAL, and it is the number that decides whether a fix is possible.
 *
 * Cause B in the brief is "emitter and publisher disagree on the spelling: the edge
 * target's FINAL SEGMENT is a published name, so the edge would resolve if both sides
 * used one canonical helper". For an fsharp `calls`/`uses`/`references` target that is
 * usually already bare, so cause B cannot be the whole story — and this measures it
 * instead of asserting it.
 *
 * What IS measurable is the U1 population: unresolved edges whose leaf IS a published
 * name. Retargeting those to the leaf would resolve them. `u1WouldResolve` is that count,
 * and it is reported as a CEILING, because the leaf may itself be ambiguous — which is
 * the A/B/C split doing its job. A retarget that moves 40,791 to 0 would have to be
 * wrong somewhere, and this file states the ceiling so the two can be compared.
 */
const u1WouldResolve = new Map<Type, number>()
const u1WouldBeUnique = new Map<Type, number>()
for (const d of unresDetail.values()) {
  if (d.cls !== "U1_leafIsPublished") continue
  const leaf = leafOf(d.target)
  const p = byName.get(leaf)
  if (!p) continue
  u1WouldResolve.set(d.type, (u1WouldResolve.get(d.type) ?? 0) + d.edges)
  if (p.decls.size === 1) u1WouldBeUnique.set(d.type, (u1WouldBeUnique.get(d.type) ?? 0) + d.edges)
}

const totals = {
  edges: rels.length,
  selfLoops: rels.reduce((a, r) => a + (r.src === r.tgt ? 1 : 0), 0),
  ambCrossKind: rels.filter((r) => byName.get(r.tgt) && byName.get(r.tgt)!.kinds.size > 1).length,
  ambMultiDecl: rels.filter((r) => byName.get(r.tgt) && byName.get(r.tgt)!.decls.size > 1).length,
  resolvedName: rels.filter((r) => byName.has(r.tgt)).length,
  resolvedQname: rels.filter((r) => byQname.has(r.tgt)).length,
  unresU1: [...unresDetail.values()].filter((d) => d.cls === "U1_leafIsPublished").reduce((a, d) => a + d.edges, 0),
  unresU2: [...unresDetail.values()].filter((d) => d.cls === "U2_headIsPublished").reduce((a, d) => a + d.edges, 0),
  unresU3: [...unresDetail.values()].filter((d) => d.cls === "U3_bclRoot").reduce((a, d) => a + d.edges, 0),
  unresU4: [...unresDetail.values()].filter((d) => d.cls === "U4_namesNothing").reduce((a, d) => a + d.edges, 0),
}

/** Distinct-name view, to restate the pass-3 146/8473 on THIS draw rather than assert it. */
const distinctNameBuckets: Record<string, number> = { unique: 0, A_scope: 0, B_module: 0, C_contract: 0 }
for (const [, p] of byName) distinctNameBuckets[ambBucket(p)]++
const distinctQnameBuckets: Record<string, number> = { unique: 0, A_scope: 0, B_module: 0, C_contract: 0 }
for (const [, p] of byQname) distinctQnameBuckets[ambBucket(p)]++

const report = {
  draw: DRAW,
  population: {
    reposOffered: byRepo.size,
    filesSampled: sample.length,
    perRepoCap: PER_REPO,
    filesParsed: sample.length - parseFailures.length,
    parseFailures: parseFailures.length,
    degradedParses: degraded,
    symbols,
    distinctNames: byName.size,
    distinctQnames: byQname.size,
    emptyNames: emptyNames.length,
    unknownEndpoints,
    relationships: rels.length,
    kindCounts: Object.fromEntries([...kindCounts.entries()].sort((a, b) => b[1] - a[1])),
  },
  totals,
  distinctNameBuckets,
  distinctQnameBuckets,
  perType,
  u1Counterfactual: { wouldResolve: Object.fromEntries(u1WouldResolve), wouldBeUnique: Object.fromEntries(u1WouldBeUnique) },
  widestTargets: widest.slice(0, 60),
  unresolvedDetail: [...unresDetail.values()]
    .map((d) => ({ type: d.type, class: d.cls, target: d.target, edges: d.edges, fileCount: d.files.size }))
    .sort((a, b) => (a.class === b.class ? b.edges - a.edges : a.class < b.class ? -1 : 1))
    .slice(0, 120),
  parseFailures: parseFailures.slice(0, 20),
}

writeFileSync(OUT, JSON.stringify(report, null, 2))

/**
 * The COMPLETE unresolved-target table, unsliced.
 *
 * `report.unresolvedDetail` above is truncated to 120 rows for the human-readable
 * page, which is fine for reading and wrong for measuring — a consumer that sums it
 * gets a page's worth of edges and reports it as the whole set. This sidecar exists
 * so cause-C classification measures the full population. `cause-c-fsharpcore.ts`
 * reads THIS file, not the truncated page.
 */
const UNRES_SIDECAR = OUT.replace(/\.json$/, ".unresolved.ndjson")
writeFileSync(
  UNRES_SIDECAR,
  [...unresDetail.values()]
    .map((d) => ({
      type: d.type, class: d.cls, target: d.target,
      edges: d.edges, fileCount: d.files.size,
    }))
    .sort((a, b) => (a.class === b.class ? b.edges - a.edges : a.class < b.class ? -1 : 1))
    .map((d) => JSON.stringify(d))
    .join("\n") + "\n",
)
/**
 * The RAW store sidecar: every symbol declaration and every edge this walk saw.
 *
 * Two NDJSON files, not one, because they are two populations with two shapes and a consumer
 * that sums them together is reading a number that means nothing:
 *
 *   <OUT>.store.decls.ndjson  one row per published symbol  { file, kind, name, qname, line }
 *   <OUT>.store.rels.ndjson   one row per emitted edge       { type, src, tgt, file }
 *
 * The header row of each carries the draw id and the row count, so a consumer can refuse to
 * replay a store against a different draw instead of quietly answering about another sample.
 */
const DECLS_SIDECAR = OUT.replace(/\.json$/, ".store.decls.ndjson")
const RELS_SIDECAR = OUT.replace(/\.json$/, ".store.rels.ndjson")
writeFileSync(
  DECLS_SIDECAR,
  `{"kind":"store-header","draw":"${DRAW}","rows":${storeDecls.length},"population":"symbols published by production parseFile over ${sample.length} files"}\n` +
  storeDecls.map((d) => JSON.stringify(d)).join("\n") + "\n",
)
writeFileSync(
  RELS_SIDECAR,
  `{"kind":"store-header","draw":"${DRAW}","rows":${rels.length},"population":"relationships emitted by production parseFile over ${sample.length} files"}\n` +
  rels.map((r) => JSON.stringify(r)).join("\n") + "\n",
)

if (JSON_ONLY) { console.log(JSON.stringify(report, null, 2)); process.exit(0) }
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pct = (a: number, b: number) => (b === 0 ? "—" : `${((100 * a) / b).toFixed(2)}%`)

console.log(`fsharp incoming A/B/C — draw ${DRAW}, ${sample.length} files, ${byRepo.size} repos, cap ${PER_REPO}/repo`)
console.log(`parsed ${report.population.filesParsed}  failures ${parseFailures.length}  degraded ${degraded}  symbols ${symbols}  rels ${rels.length}`)
console.log(`distinct name keys ${byName.size}  distinct qualifiedName keys ${byQname.size}  emptyNames ${emptyNames.length}  unknownEndpoints ${unknownEndpoints}`)
console.log("")
console.log(`TOTALS over ${rels.length} edges`)
console.log(`  resolves on NAME            ${pad(totals.resolvedName, 8)} ${pct(totals.resolvedName, rels.length)}`)
console.log(`  resolves on QUALIFIEDNAME   ${pad(totals.resolvedQname, 8)} ${pct(totals.resolvedQname, rels.length)}`)
console.log(`  self loops                  ${pad(totals.selfLoops, 8)}`)
console.log(`  AMBIGUOUS >1 KIND           ${pad(totals.ambCrossKind, 8)} ${pct(totals.ambCrossKind, rels.length)}   (incoming-check's rule)`)
console.log(`  AMBIGUOUS >1 DECLARATION    ${pad(totals.ambMultiDecl, 8)} ${pct(totals.ambMultiDecl, rels.length)}   (this lane's rule)`)
console.log(`  unresolved U1 leaf published${pad(totals.unresU1, 8)}   U2 head published ${totals.unresU2}   U3 BCL root ${totals.unresU3}   U4 names nothing ${totals.unresU4}`)
console.log("")
console.log("DISTINCT KEYS, BUCKETED (the pass-3 view, restated on this draw)")
console.log(`  by NAME:           ${pad(JSON.stringify(distinctNameBuckets), 70)} of ${byName.size}`)
console.log(`  by QUALIFIEDNAME:  ${pad(JSON.stringify(distinctQnameBuckets), 70)} of ${byQname.size}`)
console.log("")
console.log("PER TYPE")
console.log(pad("type", 14) + pad("edges", 8) + pad("self", 6) + pad("resName", 9) + pad("resQname", 9) + pad("ambKind", 9) + pad("ambDecl", 9) + pad("A", 7) + pad("B", 7) + "C")
console.log("-".repeat(90))
for (const t of ALL_TYPES) {
  const r = perType[t]
  console.log(
    pad(t, 14) + pad(r.edges, 8) + pad(r.selfLoops, 6) + pad(pct(r.resolvedName, r.edges), 9) +
    pad(pct(r.resolvedQname, r.edges), 9) + pad(r.ambCrossKind, 9) + pad(r.ambMultiDecl, 9) +
    pad(r.ambBuckets.A_scope, 7) + pad(r.ambBuckets.B_module, 7) + String(r.ambBuckets.C_contract),
  )
}
console.log("-".repeat(90))
console.log("")
console.log("UNRESOLVED, PARTITIONED PER TYPE")
for (const t of ALL_TYPES) {
  const u = perType[t].unres
  const tot = u.U1_leafIsPublished + u.U2_headIsPublished + u.U3_bclRoot + u.U4_namesNothing
  if (tot === 0) continue
  console.log(`  ${pad(t, 14)} U1 ${pad(u.U1_leafIsPublished, 7)} U2 ${pad(u.U2_headIsPublished, 7)} U3 ${pad(u.U3_bclRoot, 7)} U4 ${pad(u.U4_namesNothing, 7)}   of ${tot}`)
}
console.log("")
console.log("U1 COUNTERFACTUAL — retarget to the leaf would resolve these; `unique` is the ceiling with no new ambiguity")
for (const t of ALL_TYPES) {
  const w = u1WouldResolve.get(t) ?? 0
  if (w === 0) continue
  console.log(`  ${pad(t, 14)} would resolve ${pad(w, 7)} of which unambiguous-leaf ${u1WouldBeUnique.get(t) ?? 0}`)
}
console.log("")
console.log("WIDEST TARGETS (edges -> declarations/files/kinds)")
for (const w of widest.slice(0, 30)) {
  console.log(`  ${pad(w.target, 44)} ${pad(w.edges, 6)} edges  decls ${pad(w.decls, 5)} files ${pad(w.files, 5)} [${w.kinds.join(",")}] ${w.bucket}`)
}
console.log("")
console.log(`wrote ${OUT}`)
console.log(`wrote ${UNRES_SIDECAR}  (${unresDetail.size} rows, UNSLICED)`)
