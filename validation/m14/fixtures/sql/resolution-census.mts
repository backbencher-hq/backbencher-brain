/**
 * RESOLUTION CENSUS — the two causes `archive/docs-pre-consolidation/ROUND-BRIEF.md` separates, measured on the whole admitted SQL
 * population through production `parseFile`, in one artifact so the before/after pair cannot be
 * taken over different files.
 *
 * ## WHAT IT MEASURES, AND WHY IT IS NOT `ambiguity-split.mts`
 *
 * `ambiguity-split.mts` answers "why does this target name collide", and its buckets are about
 * AMBIGUITY. This answers a different question — "does this edge's target STRING bind to a symbol
 * this run published" — because the brief's B is a claim about strings and A is a claim about
 * names, and a run that conflated them could move one by fixing the other.
 *
 * ## CAUSE B — FORMAT MISMATCH, stated as a testable predicate
 *
 * The brief defines B as: the edge target and the published symbol name are built by different
 * code and spell the same symbol differently. That has an exact signature, and this census counts
 * it directly rather than by proxy:
 *
 *   B_hit(target)  ==  target contains '.'
 *                 && target itself is NOT a published name
 *                 && target's FINAL SEGMENT IS a published name
 *
 * All three conjuncts are required. A dotted target that resolves as written is not a mismatch. A
 * dotted target whose final segment is also unpublished is not recoverable — nothing is published
 * under either spelling, so no canonical-name function would have helped. Counting dotted targets
 * alone would have overstated B by counting every genuinely-absent `schema.table` as a bug.
 *
 * THE SQL-SPECIFIC REASON B IS EXPECTED TO BE ~0, and it is structural rather than lucky.
 * A `contains`/`references` target in this analyzer is a BARE table or column name: a schema
 * qualifier is carried on `metadata.qualified`, never in the target, precisely because
 * `classifyExternalTarget` needs the bare leaf to decide what the target is. So the published
 * surface has no dots to disagree with, and the only dotted names in it are quoted identifiers
 * whose dot is part of the name (`"vault.secret"`, `"start.1"`). Those are published and targeted
 * with the SAME string, which is B=0 by construction rather than by luck. The census measures it
 * instead of asserting it.
 *
 * ## CAUSE A — NAME IS NOT AN IDENTIFIER, with the ceiling measured not guessed
 *
 * A target resolving to >1 published symbol is ambiguous. The brief's measured symptom is that
 * nearly every such target has no distinct `qualifiedName`, which is a fact about the published
 * SURFACE, so this census counts it directly: `ambiguous` vs `ambiguousWithDistinctQname`.
 *
 * The fix's headroom is then reported as a rate under candidate keys, over the stated edge
 * population, because a bucket says why a collision happens and only a key says whether anything
 * can be done about it:
 *
 *   K0_bare      target alone                        — what a consumer does today
 *   K3_qname     target as a published qualifiedName
 *   K4_fileName  (file, name)                        — SQL's own unit of resolution
 *   K5_owner     (ownerName, name) within the file   — the `contains` key: source IS the owner
 *
 * A key that does not move a count is reported as not moving it. `K5` is expected to move `contains`
 * and nothing else, and that asymmetry is the point: it is a property of SQL's grammar, not a
 * tunable.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/sql/resolution-census.mts --files N [--out FILE] [--list N]
 *
 * `--files N` walks the whole admitted SQL corpus and takes a DETERMINISTIC STRIDED sample of N
 * files from it, sorted by `repo/relative/path`. The admission rule is byte-identical to
 * `ambiguity-split.mts` and `ontology-census.mts` (git work tree, git-tracked, <=512 KiB,
 * `detectLanguageFromPath === "sql"`) and is restated rather than imported, so this instrument
 * carries no dependency on those CLIs and its population can be re-derived from this file alone.
 * Sample membership is a pure function of the corpus listing, so a before/after pair at the same N
 * is the same file set even when the corpus has grown between the two runs.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const fail = (m: string): never => { console.error(`resolution-census: ${m}`); process.exit(2) }

// The `--files` off-by-one recorded in `ambiguity-split.mts` is reproduced deliberately: the same
// guard, because a substituted default is a DIFFERENT POPULATION that agrees with the 600-file run
// on every count, and this file is meant to be comparable with that one.
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

const TYPES = ["calls", "uses", "contains", "brain_import", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type T = typeof TYPES[number]

type Pub = {
  file: string
  name: string
  qualifiedName: string
  kind: string
  ownerName: string | null
}
type Edge = {
  type: string
  source: string
  target: string
  file: string
  memberKind: string | null
  external: string | null
  sourceKind: string | null
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

console.log(`resolution census — production parseFile`)
console.log(`corpus root         ${CORPUS}`)
console.log(`--files             ${N}${N === 600 ? "   (DEFAULT — not passed on the command line)" : ""}`)
console.log(`repos scanned       ${reposScanned}`)
console.log(`admitted population ${String(population).padStart(8)}`)
console.log(`sample              ${String(picked.length).padStart(8)}  (deterministic stride over the sorted population)`)

// ------------------------------------------------------------------ parse

const byName = new Map<string, Pub[]>()
const byQname = new Map<string, Pub[]>()
const byFileName = new Map<string, Pub[]>()
const byOwnerName = new Map<string, Pub[]>()
const edges: Edge[] = []
let symbols = 0
let emptyNames = 0
let withDistinctQname = 0
let degraded = 0
let parseFailures = 0
const symbolKinds = new Map<string, number>()
const unknownEndpoints = new Map<string, number>()
const publishedDottedNames = new Set<string>()

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
  const kindOfName = new Map<string, string>()
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    if (name.length === 0) { emptyNames++; continue }
    const kind = String(s?.kind ?? "")
    symbolKinds.set(kind, (symbolKinds.get(kind) ?? 0) + 1)
    if (name.includes(".")) publishedDottedNames.add(name)
    if (!kindOfName.has(name)) kindOfName.set(name, kind)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) withDistinctQname++
    const p: Pub = {
      file: f.label,
      name,
      qualifiedName: q,
      kind,
      ownerName: s?.ownerName == null ? null : String(s.ownerName),
    }
    add(byName, name, p)
    if (q.length > 0 && q !== name) add(byQname, q, p)
    add(byFileName, `${f.label}\u0000${name}`, p)
    if (p.ownerName != null) add(byOwnerName, `${f.label}\u0000${p.ownerName}\u0000${name}`, p)
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
      sourceKind: kindOfName.get(src) ?? null,
    })
  }
}

console.log(`symbols published   ${String(symbols).padStart(8)}`)
console.log(`  distinct published names            ${byName.size}`)
console.log(`  of which contain '.'                ${publishedDottedNames.size}`)
console.log(`  qualifiedName != bare name          ${withDistinctQname}`)
console.log(`empty names         ${String(emptyNames).padStart(8)}`)
console.log(`degraded / failures ${String(degraded).padStart(8)} / ${parseFailures}`)

// ------------------------------------------------------------------ classify

const EMPTY = () => ({
  edges: 0,
  // resolution under each key, over the stated edge population
  k0_bare: 0, k3_qname: 0, k4_fileName: 0, k5_owner: 0,
  // cause A
  ambiguous: 0, ambiguousWithDistinctQname: 0, ambiguousMultiFile: 0,
  // cause B, all three conjuncts required
  unresolved: 0,
  unresolvedDotted: 0,
  B_hit: 0,
  unresolvedNotDotted: 0,
  // cause C
  externalLabelled: 0,
  unresolvedAfterExternal: 0,
  selfLoops: 0,
})
const rows = new Map<string, ReturnType<typeof EMPTY>>()
for (const t of TYPES) rows.set(t, EMPTY())
const unknownRow = EMPTY()
const allRow = EMPTY()

// Counts the edge, the B predicate and the C label. The RESOLUTION KEYS are counted in the walk
// below and ONLY there: this function used to count them too, and a key that resolved was then
// incremented once here and once in the walk — which is how `K4_fileName` came to report 4,006
// resolutions over a 2,218-edge population. A key count above the population it is a rate over is
// not a small error, it is an unusable number, so the keys live in one place.
const bump = (r: ReturnType<typeof EMPTY>, e: Edge, resolvedK0: boolean) => {
  r.edges++
  if (e.source === e.target) r.selfLoops++
  if (resolvedK0) return
  if (e.external != null) { r.externalLabelled++; return }
  // Not resolved under the bare name and not labelled external: the only candidate defect.
  r.unresolved++
  const dot = e.target.lastIndexOf(".")
  if (dot > 0) {
    r.unresolvedDotted++
    const tail = e.target.slice(dot + 1)
    // THE B PREDICATE. The target as written is unpublished, and its final segment IS
    // published — so a single canonical name function would have bound this edge.
    if (byName.has(tail)) r.B_hit++
  } else {
    r.unresolvedNotDotted++
  }
}

const ambiguousTargets = new Map<string, Set<string>>()
const B_examples: { target: string; finalSegment: string; type: string; file: string }[] = []
const unresolvedByName = new Map<string, number>()
const externalByKind = new Map<string, number>()

for (const e of edges) {
  const hits = byName.get(e.target)
  const resolvedK0 = hits != null && hits.length > 0
  const row = rows.get(e.type) ?? unknownRow
  bump(row, e, resolvedK0)
  bump(allRow, e, resolvedK0)
  if (resolvedK0 && hits!.length > 1) {
    row.ambiguous++
    allRow.ambiguous++
    const distinctQ = new Set(hits!.map((h) => h.qualifiedName)).size > 1
    if (distinctQ) { row.ambiguousWithDistinctQname++; allRow.ambiguousWithDistinctQname++ }
    if (new Set(hits!.map((h) => h.file)).size > 1) { row.ambiguousMultiFile++; allRow.ambiguousMultiFile++ }
    const s = ambiguousTargets.get(e.target) ?? new Set<string>()
    s.add(e.file)
    ambiguousTargets.set(e.target, s)
  }
  // Per-KEY resolution, counted once per edge and independently of K0 so a key that reaches a
  // symbol K0 misses is visible rather than hidden behind the short-circuit.
  if (resolvedK0) { row.k0_bare++; allRow.k0_bare++ }
  if (byQname.has(e.target)) { row.k3_qname++; allRow.k3_qname++ }
  if (byFileName.has(`${e.file}\u0000${e.target}`)) { row.k4_fileName++; allRow.k4_fileName++ }
  // K5 is the `contains` key: the edge's SOURCE is the owner, so (file, source, target) is the
  // strongest key SQL's grammar allows. Counted on every type so the asymmetry is visible — a key
  // that helps one type and not the others is a fact about the grammar, not a tuning failure.
  if (byOwnerName.has(`${e.file}\u0000${e.source}\u0000${e.target}`)) { row.k5_owner++; allRow.k5_owner++ }
  if (!resolvedK0 && e.external != null) externalByKind.set(e.external, (externalByKind.get(e.external) ?? 0) + 1)
  if (!resolvedK0 && e.external == null) {
    unresolvedByName.set(e.target, (unresolvedByName.get(e.target) ?? 0) + 1)
    const dot = e.target.lastIndexOf(".")
    if (dot > 0 && byName.has(e.target.slice(dot + 1)) && B_examples.length < LIST) {
      B_examples.push({ target: e.target, finalSegment: e.target.slice(dot + 1), type: e.type, file: e.file })
    }
  }
}

// ------------------------------------------------------------------ report

const pad = (v: unknown, n: number) => String(v).padStart(n)
console.log("")
console.log("CAUSE B — FORMAT MISMATCH: target contains '.', target itself unpublished, final segment published")
console.log("  type".padEnd(14) + pad("edges", 10) + pad("unresolved", 12) + pad("dotted", 9) + pad("B_hit", 9) + pad("notDotted", 11) + pad("external", 10))
for (const t of TYPES) {
  const r = rows.get(t)!
  console.log("  " + t.padEnd(14) + pad(r.edges, 10) + pad(r.unresolved, 12) + pad(r.unresolvedDotted, 9) + pad(r.B_hit, 9) + pad(r.unresolvedNotDotted, 11) + pad(r.externalLabelled, 10))
}
console.log("  " + "ALL".padEnd(14) + pad(allRow.edges, 10) + pad(allRow.unresolved, 12) + pad(allRow.unresolvedDotted, 9) + pad(allRow.B_hit, 9) + pad(allRow.unresolvedNotDotted, 11) + pad(allRow.externalLabelled, 10))

console.log("")
console.log("CAUSE A — NAME IS NOT AN IDENTIFIER")
console.log("  type".padEnd(14) + pad("edges", 10) + pad("ambiguous", 11) + pad("noDistinctQname", 15) + pad("multiFile", 11))
for (const t of TYPES) {
  const r = rows.get(t)!
  console.log("  " + t.padEnd(14) + pad(r.edges, 10) + pad(r.ambiguous, 11) + pad(r.ambiguous - r.ambiguousWithDistinctQname, 15) + pad(r.ambiguousMultiFile, 11))
}
console.log("  " + "ALL".padEnd(14) + pad(allRow.edges, 10) + pad(allRow.ambiguous, 11) + pad(allRow.ambiguous - allRow.ambiguousWithDistinctQname, 15) + pad(allRow.ambiguousMultiFile, 11))

console.log("")
console.log("RESOLUTION KEYS — over the stated edge population")
console.log("  type".padEnd(14) + pad("edges", 10) + pad("K0_bare", 10) + pad("K3_qname", 11) + pad("K4_fileName", 13) + pad("K5_owner", 10))
for (const t of TYPES) {
  const r = rows.get(t)!
  console.log("  " + t.padEnd(14) + pad(r.edges, 10) + pad(r.k0_bare, 10) + pad(r.k3_qname, 11) + pad(r.k4_fileName, 13) + pad(r.k5_owner, 10))
}
console.log("  " + "ALL".padEnd(14) + pad(allRow.edges, 10) + pad(allRow.k0_bare, 10) + pad(allRow.k3_qname, 11) + pad(allRow.k4_fileName, 13) + pad(allRow.k5_owner, 10))

console.log("")
console.log("CAUSE C — external labels already on the edge")
for (const [k, v] of [...externalByKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${pad(v, 8)}`)

if (B_examples.length > 0) {
  console.log("")
  console.log(`B examples (up to ${LIST}):`)
  for (const b of B_examples) console.log(`  ${b.type} ${JSON.stringify(b.target)} -> final segment ${JSON.stringify(b.finalSegment)} IS published   ${b.file}`)
} else {
  console.log("")
  console.log("B examples: NONE — no unresolved dotted target had its final segment published.")
}

const topUnresolved = [...unresolvedByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, LIST)
console.log("")
console.log(`top unresolved targets (up to ${LIST}) — the remainder after external labelling:`)
for (const [n, c] of topUnresolved) console.log(`  ${pad(c, 7)}  ${n}`)

const topAmbig = [...ambiguousTargets.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, LIST)
console.log("")
console.log(`top ambiguous targets by declaring-FILE count (up to ${LIST}):`)
for (const [n, files] of topAmbig) console.log(`  ${pad(files.size, 7)} files  ${n}`)

// ------------------------------------------------------------------ artifact

const out = {
  instrument: "validation/m14/fixtures/sql/resolution-census.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CORPUS,
  reposScanned,
  admittedPopulation: population,
  requestedFiles: N,
  sampleFiles: picked.length,
  sampling: `deterministic stride over the ${population} admitted files sorted by repo/relative/path`,
  symbolsPublished: symbols,
  distinctPublishedNames: byName.size,
  publishedNamesContainingDot: publishedDottedNames.size,
  symbolsWithQualifiedNameDistinctFromName: withDistinctQname,
  emptySymbolNames: emptyNames,
  degradedFiles: degraded,
  parseFailures,
  symbolKinds: Object.fromEntries([...symbolKinds.entries()].sort((a, b) => b[1] - a[1])),
  unknownLiteralEndpoints: Object.fromEntries(unknownEndpoints),
  causeB: {
    predicate: "target contains '.', target itself unpublished, final segment IS a published name",
    total: allRow.B_hit,
    unresolvedDotted: allRow.unresolvedDotted,
    unresolvedNotDotted: allRow.unresolvedNotDotted,
    examples: B_examples,
  },
  causeA: {
    ambiguous: allRow.ambiguous,
    ambiguousWithDistinctQname: allRow.ambiguousWithDistinctQname,
    ambiguousMultiFile: allRow.ambiguousMultiFile,
    topByDeclaringFileCount: Object.fromEntries(topAmbig),
  },
  causeC: {
    externalLabelled: Object.fromEntries(externalByKind),
    total: allRow.externalLabelled,
    unresolvedAfterExternal: allRow.unresolved,
  },
  resolutionKeys: {
    K0_bare: allRow.k0_bare,
    K3_qname: allRow.k3_qname,
    K4_fileName: allRow.k4_fileName,
    K5_owner: allRow.k5_owner,
    edges: allRow.edges,
  },
  perType: Object.fromEntries([...rows.entries()].map(([k, v]) => [k, v])),
  typesOutsideTheTen: Object.fromEntries(
    [...new Set(edges.map((e) => e.type))].filter((t) => !(TYPES as readonly string[]).includes(t))
      .map((t) => [t, edges.filter((e) => e.type === t).length]),
  ),
  topUnresolvedTargets: Object.fromEntries(topUnresolved),
}
if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log("")
  console.log(`wrote ${OUT}`)
}