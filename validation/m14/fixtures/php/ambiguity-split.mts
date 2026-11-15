/**
 * AMBIGUITY SPLIT — php's incoming side, priced per EDGE, with the two counters the fleet's
 * `amb` column does not print together.
 *
 * ## WHY THIS EXISTS
 *
 * `script/m14/incoming-check.ts` reports ONE number per type and calls it `ambiguousTargets`. The
 * number is built like this:
 *
 *   published: Map<name, kind[]>      // value is a DEDUPED ARRAY OF KINDS
 *   ambiguous  <=>  hits.length > 1   // i.e. MORE THAN ONE DISTINCT KIND
 *
 * So the fleet-wide `amb` column is a **KIND** count. Three `.btn` rules in three files are all
 * kind `class`, so that instrument calls the name RESOLVED, and a reverse walk still collides on
 * all three. This lane's own incoming section in `docs/analyzers/php.md` instead
 * counts a target matching **more than one published declaration** — a SYMBOL count. Both are
 * defensible; they are different populations, and neither is comparable to the other's.
 *
 * So both are printed here, from ONE symbol set, on ONE walk:
 *
 *   multiSymbol   target resolves to >1 published SYMBOL   — what `bb_impact` actually collides on
 *   multiKind     target resolves to >1 distinct KIND       — `incoming-check`'s rule, the fleet's
 *
 * `script/m14/incoming-check.ts` is shared machinery and is NOT edited here. The delta is a §8
 * report item.
 *
 * ## WHY PHP'S BUCKETS ARE NOT SQL'S
 *
 * `validation/m14/fixtures/sql/ambiguity-split.mts` buckets collisions as B1 owner-scoped,
 * B2 cross-file, B3 kind-differs, B4 indistinguishable. Those carry over, with one addition that
 * only makes sense for this language:
 *
 * PHP's own name resolution is (NAMESPACE, LEAF). `src/ast/real-php-analyzer.ts` publishes
 * `metadata.fqn = "${ns}\\${name}"` and `pool-worker.ts:997` turns that into the symbol's
 * `qualifiedName`. So "two files declare `Query`" is not one collision in PHP — it is a collision
 * only if the two declarations share a namespace. `App\Models\Query` and `App\Reports\Query` are
 * DIFFERENT PHP types, and an edge keyed on the bare leaf cannot say which it means.
 *
 *   B2a_crossFileSameNs   different files, SAME namespace      — a genuine PHP collision
 *   B2b_crossFileDiffNs   different files, DIFFERENT namespace — cause A proper: the published
 *                                                               bare name is not an identifier,
 *                                                               and PHP's own resolution says so
 *
 * B2b is the population a qualified key would recover and B2a is the part it cannot. Collapsing
 * them into one "cross-file" column, which is what the SQL lane's shape invites, hides exactly
 * the distinction that decides whether re-spelling an edge target is worth its edge volume.
 *
 * ## THE RESOLUTION KEYS
 *
 * Measured for EVERY edge of every type, so each figure is a rate over a stated population:
 *
 *   K0_bare        target alone                              — what a consumer does today
 *   K1_ownerScoped (target, the edge SOURCE's ownerName)     — for `contains` the source IS the owner
 *   K2_fqn         target matched as a SYMBOL's `metadata.fqn`      — PHP's real identity
 *   K3_qualified   target matched as a SYMBOL's `qualifiedName`     — what `pool-worker.ts:997` writes
 *   K1orK2 / K2orK3 as named
 *
 * K2 and K3 are reported as separate columns rather than one because `pool-worker.ts:997` computes
 * `qualifiedName || metadata?.fqn || (scope ? scope.name : name)`. For a namespaced php class the
 * two agree; for a MEMBER symbol the analyzer sets neither, so `qualifiedName` collapses to the
 * bare name and K3 can only repeat K0. Whether that actually happens is a measurement below, not
 * an assumption: this lane's analyzer is not assumed to behave as the sql lane's does.
 *
 * ## UNRESOLVED is split by the analyzer's OWN label where it has one
 *
 * A target that resolves to nothing is either external (a vendored package, a PHP builtin, a
 * third-party interface) or unpublished (this analyzer failed to emit a declaration for it). Those
 * are opposite findings and a flat count hides both. `metadata.external` is the analyzer's own
 * answer, read through production `parseFile`, so this instrument cannot disagree with it; what is
 * left unlabelled and unresolved is the only part that is a candidate defect.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/php/ambiguity-split.mts --files N [--out FILE] [--list N]
 *
 * `--files N` walks the whole admitted php corpus and takes a DETERMINISTIC STRIDED sample of N
 * files from it, sorted by `repo/relative/path`. The admission rule is byte-identical to
 * `script/m14/ontology-coverage-gate.ts` (git work tree, git-tracked, <=512 KiB,
 * `detectLanguageFromPath === "php"`) and is re-stated here rather than imported so this
 * instrument carries no dependency on that CLI. Sample membership is a pure function of the corpus
 * listing, so a before/after pair taken at the same N is the same set of files even when the
 * corpus grew between the two runs. Pass `--files` equal to the admitted population for the full
 * walk; the header echoes the resolved arguments so a substituted default is visible in the log
 * rather than only in the count.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { phpInternalKind, PHP_INTERNAL_PROVENANCE } from "../../../../src/ast/php-internal-symbols"

const argv = process.argv.slice(2)
const fail = (m: string): never => {
  console.error(`ambiguity-split: ${m}`)
  process.exit(2)
}

/**
 * A flag with no value used to fall through to the default here, and a default that happened to
 * agree with the default run is the one disagreement a reader cannot detect. So a valueless flag
 * is a hard exit, and the resolved arguments are echoed in the header.
 */
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
const LANG = "php"
const SIZE_CAP = 512 * 1024

/** The store's spellings are inconsistent for `imports` across two files; both are accepted. */
const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "brain_import",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const

type Pub = {
  file: string
  id: string
  qualifiedName: string
  fqn: string | null
  kind: string
  ownerName: string | null
  ownerKind: string | null
  namespace: string | null
}
type Edge = {
  type: string
  source: string
  target: string
  file: string
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const picked: typeof admitted = []
if (population <= N) picked.push(...admitted)
else for (let i = 0; i < N; i++) picked.push(admitted[Math.floor((i * population) / N)])

console.log(`ambiguity split — php — production parseFile`)
console.log(`corpus root         ${CORPUS}`)
console.log(`--files             ${N}${argv.includes("--files") ? "" : "   (DEFAULT — not passed on the command line)"}`)
console.log(`--list              ${LIST}`)
console.log(`repos scanned       ${reposScanned}`)
console.log(`admitted population ${String(population).padStart(8)}`)
console.log(`sample              ${String(picked.length).padStart(8)}  (deterministic stride over the sorted population)`)

// ------------------------------------------------------------------ parse

const byName = new Map<string, Pub[]>()
const byQname = new Map<string, Pub[]>()
const byFqn = new Map<string, Pub[]>()
/** `${ownerName}\\${name}` — PHP's own spelling, and the only key that separates two methods. */
const byOwnerFqn = new Map<string, Pub[]>()
const edges: Edge[] = []
let symbols = 0
let emptyNames = 0
let withQualifiedName = 0
let withFqn = 0
let symbolsWithDerivedNamespace = 0
let degraded = 0
let parseFailures = 0
/** Names THIS file published, for the same-file half of the cause-C guard. */
const fileNames = new Set<string>()
const symbolKinds = new Map<string, number>()
const unknownEndpoints = new Map<string, number>()

/**
 * CAUSE C GUARD, measured against the PUBLISHED PRODUCT rather than against an internal
 * counter, because that is what a consumer resolves against.
 *
 * `phpInternalKind` is the analyzer's own externality rule, read from the same module the
 * analyzer reads. Three populations, and they answer different questions:
 *
 *   internalTargets              edges whose TARGET php-src declares. The externality claim.
 *   internalShadowedInFile       of those, the ones THIS FILE also declares — the exact
 *                                population the analyzer's per-file guard suppresses, so this
 *                                is the falsifier for that guard. PHP gives the local
 *                                declaration precedence over the global table, so an edge here
 *                                is a LOCAL edge and must not be labelled external.
 *   internalDeclaredInCorpus     of those, the ones SOME OTHER admitted file declares. Not
 *                                shadowed — the analyzer cannot see another file — so these
 *                                ARE labelled external, and the number is the margin between
 *                                "php-src declares it" and "no corpus file does", which is the
 *                                class where a false external claim is possible at all.
 */
const guard = {
  internalTargets: 0,
  internalShadowedInFile: 0,
  internalDeclaredInCorpus: 0,
  byKind: new Map<string, number>(),
  shadowedNames: new Map<string, string>(),
  externalNames: new Map<string, string>(),
  labelsPresent: 0,
  labelsAbsentOnInternalTarget: 0,
}
/** Which symbol `metadata` keys actually SURVIVE the worker boundary. Read, not assumed. */
const survivingMetadataKeys = new Map<string, number>()

/**
 * PHP's own name resolution is (NAMESPACE, LEAF), so the namespace is what separates
 * `App\Models\Query` from `App\Reports\Query`. Two derivations, in order:
 *
 *   1. the prefix of `qualifiedName` before the leaf, when `qualifiedName` carries a `\`.
 *      This is how a namespaced class survives the strip: `pool-worker.ts:997` COMPUTES
 *      `qualifiedName` from `metadata.fqn` BEFORE the allowlist runs, so the namespace
 *      reaches the product inside `qualifiedName` even though `metadata.namespace` does not.
 *   2. `ownerName` when `ownerKind` is `namespace` — how this analyzer publishes a top-level
 *      declaration in a namespace (`ownerName: owner ?? ns`).
 *
 * Returns null for a genuinely global declaration, which is correct: PHP resolves those in
 * the global namespace and there is no prefix to read.
 */
function deriveNamespace(q: string, name: string, s: any): string | null {
  if (q.length > 0 && q !== name) {
    const i = q.lastIndexOf("\\")
    if (i > 0) return q.slice(0, i)
  }
  if (String(s?.ownerKind ?? "") === "namespace") {
    const o = String(s?.ownerName ?? "")
    if (o.length > 0) return o
  }
  return null
}

/**
 * Count into a Map<string, number>, optionally remembering one example site. The third
 * argument is only kept while the map is below `EXAMPLE_CAP`, so an unbounded population does
 * not turn into an unbounded artifact.
 */
const EXAMPLE_CAP = 400
const bump = (m: Map<string, number>, key: string, example?: string) => {
  m.set(key, (m.get(key) ?? 0) + 1)
  if (example !== undefined && m.size <= EXAMPLE_CAP) {
    const prev = exampleSites.get(key)
    if (prev === undefined) exampleSites.set(key, `${example} (first seen)`)
  }
}
/** key -> where it was first seen; separate from the counter so the counter stays a count. */
const exampleSites = new Map<string, string>()

const add = (m: Map<string, Pub[]>, key: string, p: Pub) => {
  const arr = m.get(key)
  if (arr) arr.push(p)
  else m.set(key, [p])
}

for (const f of picked) {
  let r: any
  try {
    r = await parseFile(f.abs, LANG)
  } catch {
    parseFailures++
    continue
  }
  if (!r) {
    parseFailures++
    continue
  }
  if (r.fallback === true) degraded++
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    if (name.length === 0) {
      emptyNames++
      continue
    }
    const kind = String(s?.kind ?? "")
    symbolKinds.set(kind, (symbolKinds.get(kind) ?? 0) + 1)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) withQualifiedName++
    const md = (s?.metadata ?? {}) as Record<string, any>
    for (const k of Object.keys(md)) survivingMetadataKeys.set(k, (survivingMetadataKeys.get(k) ?? 0) + 1)
    const fqn = typeof md.fqn === "string" && md.fqn.length > 0 ? md.fqn : null
    if (fqn) withFqn++
    // The namespace comes from `qualifiedName`, NOT from `metadata.namespace`.
    //
    // MEASURED, and the reason is a shared-machinery fact, not a preference: `parseFile`
    // returns symbol `metadata` through a HARDCODED ALLOWLIST at `pool-worker.ts:1087`,
    // and php is not in it. The allowlist reads 27 keys (`m.isSelector`, `m.headingLevel`,
    // `m.bindingSite`, …) and php's 9 published symbol keys intersect it at ZERO, so
    // `metadata.namespace` and `metadata.fqn` never reach this instrument. Reading them
    // anyway is what made the FIRST version of this file print `B2b_crossFileDiffNs 0`
    // — a probe that cannot fire, which is indistinguishable from a probe that found
    // nothing. Deriving the namespace from the ONE field that survives makes the probe
    // capable of firing, and `control` below asserts that it did.
    const derivedNs = deriveNamespace(q, name, s)
    if (derivedNs != null) symbolsWithDerivedNamespace++
    const p: Pub = {
      file: f.label,
      id: String(s?.id ?? name),
      qualifiedName: q,
      fqn,
      kind,
      ownerName: s?.ownerName == null ? null : String(s.ownerName),
      ownerKind: s?.ownerKind == null ? null : String(s.ownerKind),
      namespace: derivedNs,
    }
    fileNames.add(name)
    add(byName, name, p)
    if (q.length > 0 && q !== name) add(byQname, q, p)
    if (fqn && fqn !== name) add(byFqn, fqn, p)
    if (p.ownerName != null && p.ownerName.length > 0) {
      const ok = `${p.ownerName}\\${name}`
      if (ok !== name) add(byOwnerFqn, ok, p)
    }
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    const md = (rel?.metadata ?? {}) as Record<string, any>
    if (src === "unknown") unknownEndpoints.set(`${label}:source`, (unknownEndpoints.get(`${label}:source`) ?? 0) + 1)
    if (tgt === "unknown") unknownEndpoints.set(`${label}:target`, (unknownEndpoints.get(`${label}:target`) ?? 0) + 1)

    // ---- cause C guard, per edge, inside the file that produced it
    const ik = tgt.length > 0 ? phpInternalKind(tgt) : null
    if (ik !== null) {
      guard.internalTargets++
      bump(guard.byKind, ik)
      if (fileNames.has(tgt)) {
        guard.internalShadowedInFile++
        if (guard.shadowedNames.size < 400) bump(guard.shadowedNames, tgt, f.label)
      } else if (byName.has(tgt)) {
        guard.internalDeclaredInCorpus++
        if (guard.externalNames.size < 400) bump(guard.externalNames, tgt, f.label)
      }
      // Did the analyzer's own label agree with this instrument's rule?
      if (md.external != null) guard.labelsPresent++
      else guard.labelsAbsentOnInternalTarget++
    }
    edges.push({
      type: label,
      source: src,
      target: tgt,
      file: f.label,
      external: md.external == null ? null : String(md.external),
      confidence: typeof rel?.confidence === "number" ? rel.confidence : null,
      evidenceClass: md.evidenceClass == null ? null : String(md.evidenceClass),
    })
  }
}

console.log(`symbols published   ${String(symbols).padStart(8)}`)
console.log(`  qualifiedName != bare name: ${withQualifiedName}   metadata.fqn present: ${withFqn}`)
console.log(`empty names         ${String(emptyNames).padStart(8)}`)
console.log(`degraded / failures ${String(degraded).padStart(8)} / ${parseFailures}`)
console.log("")
console.log("PROBE CONTROLS — a probe that cannot fire reads the same as a probe that found nothing,")
console.log("so each is asserted against the symbols this walk actually published.")
console.log(`  control  namespace probe CAN fire : ${symbolsWithDerivedNamespace > 0 ? "YES" : "NO"}  (${symbolsWithDerivedNamespace} symbols carry a namespace)`)
console.log(`  control  qualifiedName probe fires : ${withQualifiedName > 0 ? "YES" : "NO"}  (${withQualifiedName} symbols)`)
console.log(`  control  bare-name probe fires     : ${byName.size > 0 ? "YES" : "NO"}  (${byName.size} distinct names)`)
console.log(`  DIAGNOSTIC symbol metadata surviving the worker boundary: ${JSON.stringify(Object.fromEntries([...survivingMetadataKeys].sort((a, b) => b[1] - a[1])))}`)
console.log(`    (pool-worker.ts:1087 forwards a HARDCODED allowlist. php's published symbol keys intersect it at 0,`)
console.log(`     so metadata.fqn and metadata.namespace are absent above BY DESIGN of that allowlist, and any`)
console.log(`     column keyed on them would be a vacuous zero. K2 below is keyed on qualifiedName instead.)`)

// ------------------------------------------------------------------ resolve

type Row = {
  edges: number
  selfLoops: number
  emptyTarget: number
  k0: number
  multiSymbol: number
  multiKind: number
  k1: number
  k2: number
  k3: number
  k1orK2: number
  k2orK3: number
  /**
   * How many edges the BARE name missed and a later key caught. Kept OUT of k1/k2/k3 on
   * purpose.
   *
   * The first revision of this file incremented `k3` from the fallback lookup
   * (`if (viaQualified) row.k3++`) AND from the per-edge key test below it, so an edge that
   * resolved through `byQname` was counted in k3 twice — once as "reached k3 by falling back"
   * and once as "k3 resolves this edge". `imports` printed k3 = 36,124 over 28,630 edges,
   * which is arithmetically impossible and was the only symptom: every key column is capped
   * at one increment per edge, so a column above its own edge count is a double count and
   * nothing else. These two counters are the honest form of that question.
   */
  viaQualifiedLookup: number
  viaOwnerFqnLookup: number
  B1_ownerScoped: number
  B2a_crossFileSameNs: number
  B2b_crossFileDiffNs: number
  B3_kindDiffers: number
  B4_indistinct: number
  labelledExternal: number
  labelledExternalKinds: Map<string, number>
  unlabelledUnresolved: number
  unlabelledTopTargets: Map<string, number>
  lowConfidence: number
  nonStructural: number
  distinctTargets: number
  multiSymbolDistinctTargets: number
  multiKindDistinctTargets: number
  examples: Map<string, Map<string, string[]>>
}
const blank = (): Row => ({
  edges: 0,
  selfLoops: 0,
  emptyTarget: 0,
  k0: 0,
  multiSymbol: 0,
  multiKind: 0,
  k1: 0,
  k2: 0,
  k3: 0,
  k1orK2: 0,
  k2orK3: 0,
  viaQualifiedLookup: 0,
  viaOwnerFqnLookup: 0,
  B1_ownerScoped: 0,
  B2a_crossFileSameNs: 0,
  B2b_crossFileDiffNs: 0,
  B3_kindDiffers: 0,
  B4_indistinct: 0,
  labelledExternal: 0,
  labelledExternalKinds: new Map(),
  unlabelledUnresolved: 0,
  unlabelledTopTargets: new Map(),
  lowConfidence: 0,
  nonStructural: 0,
  distinctTargets: 0,
  multiSymbolDistinctTargets: 0,
  multiKindDistinctTargets: 0,
  examples: new Map(),
})
const perType: Record<string, Row> = {}
for (const t of TYPES) perType[t] = blank()
const outsideTheTen: Record<string, number> = {}

const ex = (r: Row, bucket: string, e: Edge, hits: Pub[]) => {
  let m = r.examples.get(bucket)
  if (!m) {
    m = new Map()
    r.examples.set(bucket, m)
  }
  const key = `${e.file}|${e.target}`
  if (m.has(key) || m.size >= LIST) return
  m.set(key, [
    hits
      .slice(0, 5)
      .map((h) => `${h.file}#${h.id}(${h.kind}${h.namespace ? ` ns=${h.namespace}` : ""})`)
      .join(" ; "),
    `edgeSource=${e.source}`,
  ])
}

/** The owner of the SYMBOL the edge came FROM, when the source names a published declaration. */
const ownerOfSource = (src: string): string | null => {
  const h = byName.get(src)
  if (!h || h.length === 0) return null
  const owners = new Set(h.map((x) => x.ownerName ?? ""))
  return owners.size === 1 ? [...owners][0] : null
}

for (const e of edges) {
  const row = perType[e.type]
  if (!row) {
    outsideTheTen[e.type] = (outsideTheTen[e.type] ?? 0) + 1
    continue
  }
  row.edges++
  if (e.confidence != null && e.confidence < 0.7) row.lowConfidence++
  if (e.evidenceClass != null && e.evidenceClass !== "structural") row.nonStructural++
  if (e.target.length === 0) {
    row.emptyTarget++
    continue
  }
  if (e.source === e.target) {
    row.selfLoops++
    continue
  }

  // Same resolution ORDER `incoming-check.ts` uses: bare name, then qualified name.
  //
  // `byFqn` (metadata.fqn) is deliberately NOT consulted: it is empty for php because
  // `pool-worker.ts:1087` does not forward that key. A lookup against an always-empty map
  // would return 0 and read as "no edge resolves under fqn", which is the vacuous zero.
  let hits = byName.get(e.target)
  let viaQualified = false
  let viaOwnerFqn = false
  if (!hits || hits.length === 0) {
    const q = byQname.get(e.target)
    if (q && q.length > 0) {
      hits = q
      viaQualified = true
    }
  }
  if (!hits || hits.length === 0) {
    const o = byOwnerFqn.get(e.target)
    if (o && o.length > 0) {
      hits = o
      viaOwnerFqn = true
    }
  }

  if (!hits || hits.length === 0) {
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
  if (kinds.size > 1) {
    row.multiKind++
    row.multiKindDistinctTargets++
  }
  if (viaQualified) row.viaQualifiedLookup++
  if (viaOwnerFqn) row.viaOwnerFqnLookup++

  // ---- resolution under each candidate key, over the WHOLE edge population of the type.
  // Every key counter below is incremented AT MOST ONCE PER EDGE, so no column can exceed
  // `row.edges`. That invariant is asserted at the end of the walk, because a column above
  // its own edge count is how the previous revision's double count announced itself.
  if (hits.length === 1) {
    row.k0++
    row.k1++
    row.k2++
    row.k3++
    row.k1orK2++
    row.k2orK3++
    continue
  }
  row.multiSymbol++
  row.multiSymbolDistinctTargets++

  const srcOwner = ownerOfSource(e.source)
  const byOwner = srcOwner == null ? [] : hits.filter((h) => (h.ownerName ?? "") === srcOwner || (h.namespace ?? "") === srcOwner)
  const byQ = byQname.get(e.target) ?? []
  const byO = byOwnerFqn.get(e.target) ?? []
  if (byOwner.length === 1) row.k1++
  if (byO.length === 1) row.k2++
  if (byQ.length === 1) row.k3++
  if (byOwner.length === 1 || byO.length === 1) row.k1orK2++
  if (byO.length === 1 || byQ.length === 1) row.k2orK3++

  // ---- cause bucket, independent of the key tests above
  const files = new Set(hits.map((h) => h.file))
  const owners = new Set(hits.map((h) => `${h.ownerName ?? ""}|${h.file}`))
  const namespaces = new Set(hits.map((h) => h.namespace ?? ""))
  let bucket: keyof Row
  if (files.size > 1) bucket = namespaces.size > 1 ? "B2b_crossFileDiffNs" : "B2a_crossFileSameNs"
  else if (owners.size > 1) bucket = "B1_ownerScoped"
  else if (kinds.size > 1) bucket = "B3_kindDiffers"
  else bucket = "B4_indistinct"
  row[bucket]++
  ex(row, bucket, e, hits)
}

// ------------------------------------------------------------------ report

const pad = (s: string | number, n: number) => String(s).padStart(n)
const live = TYPES.filter((t) => perType[t].edges > 0)

console.log("")
console.log("A. RESOLUTION under each candidate key — denominator is EVERY edge of the type")
console.log("   K0 bare   K1 +ownerName   K2 ownerName\\name   K3 qualifiedName   K1|K2   K2|K3   selfLp   <0.7")
console.log("   viaQ/viaO = bare name MISSED, this later key caught it (not part of K1/K2/K3)")
console.log("")
console.log("type".padEnd(13) + pad("edges", 9) + pad("K0", 9) + pad("K1", 8) + pad("K2", 8) + pad("K3", 8) + pad("K1|K2", 8) + pad("K2|K3", 8) + pad("selfLp", 8) + pad("<0.7", 7))
console.log("-".repeat(94))
for (const t of live) {
  const r = perType[t]
  console.log(
    t.padEnd(13) + pad(r.edges, 9) + pad(r.k0, 9) + pad(r.k1, 8) + pad(r.k2, 8) + pad(r.k3, 8) +
      pad(r.k1orK2, 8) + pad(r.k2orK3, 8) + pad(r.selfLoops, 8) + pad(r.lowConfidence, 7),
  )
}

// INVARIANT. Every key counter is incremented at most once per edge, so none can exceed
// `edges`. The first revision violated it (`imports` k3 36,124 > 28,630 edges) and the
// violation was only visible as an arithmetic impossibility in this table, which is a weak
// thing to rely on. It is asserted, and a violation aborts with the offending columns named.
{
  const KEYS = ["k0", "k1", "k2", "k3", "k1orK2", "k2orK3", "viaQualifiedLookup", "viaOwnerFqnLookup", "distinctTargets", "multiSymbol", "multiKind", "labelledExternal", "unlabelledUnresolved"] as const
  const bad: string[] = []
  for (const t of live) {
    const r = perType[t]
    for (const k of KEYS) if ((r as any)[k] > r.edges) bad.push(`${t}.${k}=${(r as any)[k]} > edges=${r.edges}`)
  }
  console.log("")
  console.log(`INVARIANT every key counter <= edges of its type: ${bad.length === 0 ? "HOLDS" : "VIOLATED"}`)
  for (const b of bad) console.log(`  VIOLATION ${b}`)
  if (bad.length > 0) throw new Error(`ambiguity-split: ${bad.length} double-counted column(s); the walk's key columns are not per-edge`)
}

console.log("")
console.log("B. THE TWO AMBIGUITY COUNTERS SIDE BY SIDE — the fleet's `amb` column is the RIGHT one")
console.log("   multiSymbol = >1 published SYMBOL (what bb_impact collides on)")
console.log("   multiKind   = >1 distinct KIND   (script/m14/incoming-check.ts's rule = the fleet column)")
console.log("")
console.log("type".padEnd(13) + pad("multiSym", 11) + pad("multiKind", 11) + pad("distinctSym", 13) + pad("distinctKind", 13) + pad("fleet under-reads by", 20))
console.log("-".repeat(82))
for (const t of live) {
  const r = perType[t]
  if (r.multiSymbol === 0 && r.multiKind === 0) continue
  const ratio = r.multiKind === 0 ? "inf" : `${(r.multiSymbol / r.multiKind).toFixed(1)}x`
  console.log(
    t.padEnd(13) + pad(r.multiSymbol, 11) + pad(r.multiKind, 11) + pad(r.multiSymbolDistinctTargets, 13) + pad(r.multiKindDistinctTargets, 13) + pad(ratio, 20),
  )
}

console.log("")
console.log("C. CAUSE BUCKETS — denominator is the multiSymbol edges of the type")
console.log("   B1 same file/diff owner   B2a cross-file SAME ns   B2b cross-file DIFF ns")
console.log("   B3 same file/owner/diff kind   B4 indistinguishable (file+owner+kind all equal)")
console.log("")
console.log("type".padEnd(13) + pad("multiSym", 11) + pad("B1owner", 10) + pad("B2aSameNs", 12) + pad("B2bDiffNs", 12) + pad("B3kind", 9) + pad("B4same", 9) + pad("B2b share", 12))
console.log("-".repeat(88))
for (const t of live) {
  const r = perType[t]
  if (r.multiSymbol === 0) continue
  const b2b = (100 * r.B2b_crossFileDiffNs) / r.multiSymbol
  console.log(
    t.padEnd(13) + pad(r.multiSymbol, 11) + pad(r.B1_ownerScoped, 10) + pad(r.B2a_crossFileSameNs, 12) +
      pad(r.B2b_crossFileDiffNs, 12) + pad(r.B3_kindDiffers, 9) + pad(r.B4_indistinct, 9) + pad(`${b2b.toFixed(1)}%`, 12),
  )
}

console.log("")
console.log("D. UNRESOLVED, by the analyzer's OWN `metadata.external` label (not a guess)")
let anyUnresolved = false
for (const t of live) {
  const r = perType[t]
  const tot = r.labelledExternal + r.unlabelledUnresolved
  if (tot === 0) continue
  anyUnresolved = true
  const kinds = JSON.stringify(Object.fromEntries([...r.labelledExternalKinds].sort((a, b) => b[1] - a[1])))
  console.log(`  ${t.padEnd(12)} unresolved ${pad(tot, 6)} = external ${pad(r.labelledExternal, 6)} ${kinds}  + UNLABELLED ${pad(r.unlabelledUnresolved, 6)}`)
}
if (!anyUnresolved) console.log("  none")

console.log("")
console.log("F. CAUSE C GUARD — the externality claim, and the two places it could be wrong")
console.log(`   edges whose TARGET php-src declares            ${guard.internalTargets}`)
console.log(`     of those, THIS FILE also declares (NOT external) ${guard.internalShadowedInFile}   <- falsifier for the per-file guard`)
console.log(`     of those, another admitted file declares       ${guard.internalDeclaredInCorpus}   <- the false-external margin`)
console.log(`   analyzer's metadata.external present on them    ${guard.labelsPresent} / absent ${guard.labelsAbsentOnInternalTarget}`)
console.log(`   by kind: ${JSON.stringify(Object.fromEntries([...guard.byKind].sort((a, b) => b[1] - a[1])))}`)
if (guard.shadowedNames.size > 0) {
  console.log(`   shadowed names (internal AND declared in the same file) — first ${guard.shadowedNames.size}:`)
  for (const [n, c] of [...guard.shadowedNames].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`     ${n} x${c}  first: ${exampleSites.get(n)}`)
}
if (guard.externalNames.size > 0) {
  console.log(`   internal names another corpus file declares — first ${guard.externalNames.size}:`)
  for (const [n, c] of [...guard.externalNames].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`     ${n} x${c}  first: ${exampleSites.get(n)}`)
}

console.log("")
console.log(`UNKNOWN literal endpoints: ${JSON.stringify(Object.fromEntries(unknownEndpoints))}`)
console.log(`SYMBOL KINDS: ${JSON.stringify(Object.fromEntries([...symbolKinds].sort((a, b) => b[1] - a[1])))}`)
console.log(`edge types outside the 10: ${JSON.stringify(outsideTheTen)}`)

console.log("")
console.log("E. TOP UNLABELLED-UNRESOLVED TARGETS — the only unresolved population that is a candidate defect")
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
  console.log(`F. EXAMPLES ${t} — ${r.multiSymbol} ambiguous`)
  for (const b of ["B1_ownerScoped", "B2a_crossFileSameNs", "B2b_crossFileDiffNs", "B3_kindDiffers", "B4_indistinct"] as const) {
    const m = r.examples.get(b)
    if (!m || m.size === 0) continue
    console.log(`  [${b}] ${r[b]}`)
    for (const v of [...m.values()].slice(0, 5)) console.log(`    ${v[0]}\n      ${v[1]}`)
  }
}

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        instrument: "validation/m14/fixtures/php/ambiguity-split.mts",
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
        symbolsWithFqn: withFqn,
        symbolsWithDerivedNamespace,
        probeControls: {
          namespaceProbeCanFire: symbolsWithDerivedNamespace > 0,
          qualifiedNameProbeCanFire: withQualifiedName > 0,
          bareNameProbeCanFire: byName.size > 0,
        },
        symbolMetadataSurvivingWorkerBoundary: Object.fromEntries([...survivingMetadataKeys].sort((a, b) => b[1] - a[1])),
        distinctPublishedOwnerFqns: byOwnerFqn.size,
        emptySymbolNames: emptyNames,
        degradedFiles: degraded,
        parseFailures,
        distinctPublishedNames: byName.size,
        /**
         * The names themselves, not only the count. `script/m14/incoming-check.ts` and the
         * generator `validation/m14/fixtures/php/internal-symbol-table.mts` both need the SET to
         * intersect against a table, and a count cannot be intersected — which is why that
         * generator's guard printed INCONCLUSIVE until this walk serialised them.
         */
        publishedNames: [...byName.keys()],
        distinctPublishedFqns: byFqn.size,
        symbolKinds: Object.fromEntries([...symbolKinds].sort((a, b) => b[1] - a[1])),
        unknownLiteralEndpoints: Object.fromEntries(unknownEndpoints),
        causeCGuard: {
          rule: "phpInternalKind() from src/ast/php-internal-symbols.ts — the analyzer's own externality rule, read from the same module the analyzer reads",
          phpSrcCommit: PHP_INTERNAL_PROVENANCE.commit,
          internalTargets: guard.internalTargets,
          internalShadowedInFile: guard.internalShadowedInFile,
          internalDeclaredInCorpus: guard.internalDeclaredInCorpus,
          byKind: Object.fromEntries([...guard.byKind].sort((a, b) => b[1] - a[1])),
          labelsPresent: guard.labelsPresent,
          labelsAbsentOnInternalTarget: guard.labelsAbsentOnInternalTarget,
          shadowedNames: Object.fromEntries([...guard.shadowedNames].sort((a, b) => b[1] - a[1])),
          externalNames: Object.fromEntries([...guard.externalNames].sort((a, b) => b[1] - a[1])),
        },
        edgeTypesOutsideTheTen: outsideTheTen,
        ambiguityCounterpair: {
          note: "the fleet `amb` column is multiKIND; multiSymbol is what bb_impact collides on",
          byType: Object.fromEntries(
            live.map((t) => [
              t,
              {
                edges: perType[t].edges,
                multiSymbol: perType[t].multiSymbol,
                multiKind: perType[t].multiKind,
                ratio: perType[t].multiKind === 0 ? null : perType[t].multiSymbol / perType[t].multiKind,
              },
            ]),
          ),
          totals: {
            edges: live.reduce((a, t) => a + perType[t].edges, 0),
            multiSymbol: live.reduce((a, t) => a + perType[t].multiSymbol, 0),
            multiKind: live.reduce((a, t) => a + perType[t].multiKind, 0),
          },
        },
        perType: Object.fromEntries(
          live.map((t) => {
            const { examples, ...rest } = perType[t]
            return [
              t,
              {
                ...rest,
                labelledExternalKinds: Object.fromEntries(rest.labelledExternalKinds),
                unlabelledTopTargets: Object.fromEntries(
                  [...rest.unlabelledTopTargets].sort((a, b) => b[1] - a[1]).slice(0, 60),
                ),
                examples: Object.fromEntries(
                  [...examples].map(([b, m]) => [
                    b,
                    [...m].slice(0, LIST).map(([k, v]) => ({ key: k, hits: v[0], edgeSource: v[1] })),
                  ]),
                ),
              },
            ]
          }),
        ),
      },
      null,
      2,
    ),
  )
  console.log("")
  console.log(`wrote ${OUT}`)
}