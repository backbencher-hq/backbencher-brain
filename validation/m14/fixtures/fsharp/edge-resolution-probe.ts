/**
 * EDGE RESOLUTION PROBE — can the graph walk to BOTH ends of every edge this lane emits?
 *
 * ## WHY THIS FILE EXISTS
 *
 * `script/m14/firing-check.ts` counts `bothEndsResolve`, but it builds its published-symbol
 * set ONCE PER FILE (`const published = new Set<string>()` inside the per-file loop) and adds
 * only `s.name` and `s.qualifiedName`. On the 400-file fsharp draw that measurement reads:
 *
 *   overrides      63 edges,  0 both-ends, 63 external sources
 *   imports      1353 edges,  35 both-ends (2.6%)
 *   uses          2351 edges,  92 both-ends (3.9%)
 *
 * and two of those three numbers are WRONG for reasons that are properties of the INSTRUMENT,
 * not of the analyzer:
 *
 *   1. A cross-file edge can never resolve in a per-file set. `imports` names a scope in
 *      ANOTHER file by construction, so 2.6% is the instrument's ceiling, not the analyzer's
 *      quality. Reading it as a defect would be a false finding.
 *   2. `s.qualifiedName` is a field the fsharp analyzer never sets — `pool-worker.ts:870`
 *      derives it as `s.qualifiedName || s.metadata?.fqn || (s.scope ? scope.name : name)`.
 *      An edge written as `Owner.member` therefore binds against a set that contains only bare
 *      names, and reads 0% for a reason that has nothing to do with whether the declaration
 *      was published.
 *
 * So this probe resolves every edge under FOUR key schemes and reports each rate, which
 * separates "the declaration was never published" from "the key scheme does not match the
 * spelling the edge uses". Those are opposite findings that look identical in one number.
 *
 * ## THE FOUR SCHEMES
 *
 *   bare        the symbol's own `name`
 *   qualified   `qualifiedName` as `pool-worker.ts:870` computes it
 *   ownerDot    `ownerName ? ownerName + "." + name : name`
 *   lastSegment the final dot-segment of the edge endpoint (the weakest: it ignores the
 *               owner, so it is reported as an AMBIGUITY source, never as a success)
 *
 * `lastSegment` is reported separately on purpose. It is what a name-only reverse walk
 * actually does (`src/lsp/impact.ts` scans outgoing edges and matches targets), so its rate
 * is the rate at which an incoming edge is attributed to the RIGHT declaration — and its
 * `ambiguous` count is the number of places where it is attributed to a WRONG one.
 *
 * ## INSTRUMENT DISCIPLINE
 *
 * No regex. Candidates are located by walking the parse tree; `node.type` and named children
 * only. The corpus walk is `git ls-files` + `detectLanguageFromPath`, the same deterministic
 * population every other m14 instrument uses. Production entry point is `parseFile` from
 * `src/ast/pool-worker.ts` — never `analyze()`.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/fsharp/edge-resolution-probe.ts [--files 400] [--json]
 *
 * READ-ONLY. Writes nothing outside stdout.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "fsharp"

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const FILES_FLAG = argv.indexOf("--files")
const SAMPLE = FILES_FLAG >= 0 ? Number(argv[FILES_FLAG + 1]) || 400 : 400

const ALL_TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Store label -> ontology name. `imports` is stored as `brain_import`. */
const LABEL_ALIASES: Record<string, string[]> = {
  calls: ["calls", "call"],
  uses: ["uses"],
  contains: ["contains", "composition", "part_of"],
  imports: ["brain_import", "imports"],
  references: ["references", "depends_on", "related"],
  exports: ["exports", "provides"],
  extends: ["extends", "inheritance"],
  implements: ["implements", "implementation"],
  overrides: ["overrides", "override"],
  instantiates: ["instantiates"],
}

function ontologyType(rawLabel: string): Type | null {
  for (const [t, labels] of Object.entries(LABEL_ALIASES)) if (labels.includes(rawLabel)) return t as Type
  return null
}

// ------------------------------------------------------------------ corpus walk

type Repo = { name: string; dir: string }

function corpusRepos(): Repo[] {
  const out: Repo[] = []
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return out
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    out.push({ name, dir })
  }
  return out
}

function trackedFiles(dir: string): string[] {
  try {
    const raw = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
    return raw.split("\0").filter(Boolean)
  } catch {
    return []
  }
}

/** Deterministic stride sample, identical in construction to `firing-check.ts`. */
function filesForLanguage(limit: number): { files: string[]; perRepo: Record<string, number>; total: number } {
  const perRepo: Record<string, number> = {}
  const all: string[] = []
  for (const repo of corpusRepos()) {
    const hits: string[] = []
    for (const rel of trackedFiles(repo.dir)) {
      if (detectLanguageFromPath(rel) !== LANG) continue
      hits.push(path.join(repo.dir, rel))
    }
    if (hits.length > 0) perRepo[repo.name] = hits.length
    all.push(...hits)
  }
  const total = all.length
  if (all.length <= limit) return { files: all.sort(), perRepo, total }
  const stride = Math.max(1, Math.floor(all.length / limit))
  const picked: string[] = []
  for (let i = 0; i < all.length && picked.length < limit; i += stride) picked.push(all[i])
  return { files: picked.sort(), perRepo, total }
}

// ------------------------------------------------------------------ key schemes

type SymbolView = { name: string; kind: string; qualifiedName: string; ownerDot: string; lastSegment: string; file: string }

function viewOf(s: any, file: string): SymbolView {
  const name = String(s?.name ?? "")
  const kind = String(s?.kind ?? s?.type ?? "")
  const qnRaw = String(s?.qualifiedName ?? "")
  const fqn = String(s?.metadata?.fqn ?? "")
  const scope = String(s?.scope ?? "")
  // `pool-worker.ts:870` verbatim, so "qualified" means what the store means.
  const qualifiedName = qnRaw || fqn || (scope ? `${scope}.${name}` : name)
  const owner = String(s?.ownerName ?? "")
  return {
    name,
    kind,
    qualifiedName,
    ownerDot: owner ? `${owner}.${name}` : name,
    lastSegment: name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name,
    file,
  }
}

// ------------------------------------------------------------------ measurement

type TypeRow = {
  edges: number
  files: number
  srcBare: number
  srcQualified: number
  srcOwnerDot: number
  srcAny: number
  tgtBare: number
  tgtQualified: number
  tgtOwnerDot: number
  tgtAny: number
  /** Both endpoints bind under the SAME scheme. This is the honest "resolvable" number. */
  bothBare: number
  bothQualified: number
  bothOwnerDot: number
  bothAny: number
  /**
   * Resolution under the STORE'S OWN two strict strategies and nothing else:
   * `src/ast/parallel-indexer.ts` matches a target against `brain_symbol.name` (strategy 1)
   * and `brain_symbol.qualified_name` (strategy 2). This column is those two and no fallback,
   * which is what makes it able to MOVE when FS-P3-1 lands — `bothAny` above unions four
   * schemes including `ownerDot`, and `ownerDot` was already computable from `ownerName`
   * before the fix, so `bothAny` could not register a change in what the STORE can walk.
   * Strategy 3 (a dotted target matched on everything after the first `.`) is deliberately
   * NOT counted here: it is the loose one, and it is the one that attributes an incoming
   * edge to the wrong declaration when two share a name. It is `lastSegmentAmbiguous` here.
   */
  bothStoreKey: number
  srcStoreKey: number
  tgtStoreKey: number
  dottedSrcStoreKey: number
  dottedSrcTotal: number
  /** `lastSegment` bind where >1 published symbol in the population carries that name. */
  lastSegmentBinds: number
  lastSegmentAmbiguous: number
  crossFileEdges: number
  confBelow07: number
}

function blankRow(): TypeRow {
  return {
    edges: 0, files: 0,
    srcBare: 0, srcQualified: 0, srcOwnerDot: 0, srcAny: 0,
    tgtBare: 0, tgtQualified: 0, tgtOwnerDot: 0, tgtAny: 0,
    bothBare: 0, bothQualified: 0, bothOwnerDot: 0, bothAny: 0, bothStoreKey: 0,
    srcStoreKey: 0, tgtStoreKey: 0, dottedSrcStoreKey: 0, dottedSrcTotal: 0,
    lastSegmentBinds: 0, lastSegmentAmbiguous: 0,
    crossFileEdges: 0, confBelow07: 0,
  }
}

async function main(): Promise<void> {
  const { files, perRepo, total } = filesForLanguage(SAMPLE)
  process.stderr.write(`edge-resolution-probe: fsharp — ${files.length} of ${total} corpus files\n`)

  // The population-wide name index, for the ambiguity count. A name that TWO published
  // symbols carry is a place where a name-only reverse walk picks a winner by a rule
  // nobody chose. Built across ALL sampled files, because the collision the reverse walk
  // hits is usually ACROSS files (a base class in one file, an interface in another).
  const nameIndex = new Map<string, Set<string>>()
  const perFileViews: string[][] = []

  const rows: Record<Type, TypeRow> = {} as Record<Type, TypeRow>
  for (const t of ALL_TYPES) rows[t] = blankRow()
  const filesByType = new Map<Type, Set<string>>()

  let parsed = 0
  let failed = 0
  let degraded = 0
  let emptyNames = 0
  let emptyKinds = 0
  let unknownEndpoints = 0
  let symbols = 0
  let relationships = 0

  for (const file of files) {
    let r: any
    try {
      r = await parseFile(file, path.dirname(file))
    } catch {
      failed++
      continue
    }
    if (!r) {
      failed++
      continue
    }
    parsed++
    if (r.fallback === true) degraded++

    const syms: any[] = Array.isArray(r.symbols) ? r.symbols : []
    const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
    symbols += syms.length
    relationships += rels.length

    const views: SymbolView[] = []
    for (const s of syms) {
      const v = viewOf(s, file)
      views.push(v)
      if (v.name.length === 0) emptyNames++
      const k = String(s?.kind ?? "")
      if (k.length === 0 || k === "unknown") emptyKinds++
      if (v.name.length === 0) continue
      for (const key of new Set([v.name, v.qualifiedName, v.ownerDot, v.lastSegment])) {
        if (key.length === 0) continue
        let set = nameIndex.get(key)
        if (!set) {
          set = new Set()
          nameIndex.set(key, set)
        }
        set.add(`${file}::${key}`)
      }
    }
    perFileViews.push(views)

    const bare = new Set(views.map((v) => v.name).filter((s) => s.length > 0))
    const qualified = new Set(views.map((v) => v.qualifiedName).filter((s) => s.length > 0))
    const ownerDot = new Set(views.map((v) => v.ownerDot).filter((s) => s.length > 0))
    // Strategies 1 and 2 of `parallel-indexer.ts`, hoisted out of the edge loop: the union
    // of the two keys the store actually holds, so the per-edge test is two Set lookups.
    const storeSet = new Set<string>([...bare, ...qualified])

    for (const rel of rels) {
      const label = String(rel?.type ?? rel?.relationshipType ?? "")
      if (label.length === 0) continue
      const type = ontologyType(label)
      if (!type) continue
      const row = rows[type]
      row.edges++
      let fs = filesByType.get(type)
      if (!fs) {
        fs = new Set()
        filesByType.set(type, fs)
      }
      fs.add(file)

      const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")

      if (src === "unknown" || tgt === "unknown") unknownEndpoints++
      if (src.length === 0 || tgt.length === 0) unknownEndpoints++

      const sb = bare.has(src)
      const sq = qualified.has(src)
      const so = ownerDot.has(src)
      const tb = bare.has(tgt)
      const tq = qualified.has(tgt)
      const to = ownerDot.has(tgt)
      if (sb) row.srcBare++
      if (sq) row.srcQualified++
      if (so) row.srcOwnerDot++
      if (sb || sq || so) row.srcAny++
      if (tb) row.tgtBare++
      if (tq) row.tgtQualified++
      if (to) row.tgtOwnerDot++
      if (tb || tq || to) row.tgtAny++
      if (sb && tb) row.bothBare++
      if (sq && tq) row.bothQualified++
      if (so && to) row.bothOwnerDot++
      if ((sb || sq || so) && (tb || tq || to)) row.bothAny++
      // Strategies 1 and 2 only: the published `name`, or the published `qualifiedName`.
      if (storeSet.has(src) && storeSet.has(tgt)) row.bothStoreKey++
      const srcStore = storeSet.has(src)
      const tgtStore = storeSet.has(tgt)
      if (srcStore) row.srcStoreKey++
      if (tgtStore) row.tgtStoreKey++
      // The FS-P3-1 measurement, per type: a DOTTED source is one the analyzer qualified on
      // purpose, so it is the only kind that can be store-resolvable ONLY via `qualified_name`.
      if (src.includes(".")) {
        row.dottedSrcTotal++
        if (srcStore) row.dottedSrcStoreKey++
      }

      const lastSrc = src.includes(".") ? src.slice(src.lastIndexOf(".") + 1) : src
      if (lastSrc.length > 0) {
        const owners = nameIndex.get(lastSrc)
        if (owners && owners.size > 1) row.lastSegmentAmbiguous++
        else if (owners && owners.size === 1) row.lastSegmentBinds++
      }

      // Cross-file: the target's file differs from the edge's file, so a per-file set can
      // never bind it. Counted separately so it is never mistaken for a resolution failure.
      if (!bare.has(tgt) && !qualified.has(tgt) && !ownerDot.has(tgt)) {
        const owners = nameIndex.get(tgt.includes(".") ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt)
        if (owners && owners.size > 0) row.crossFileEdges++
      }

      const conf = rel?.confidence
      if (typeof conf === "number" && conf < 0.7) row.confBelow07++
    }
  }

  for (const [t, set] of filesByType) rows[t].files = set.size

  // ------------------------------------------------------------------ ambiguity
  //
  // THE NUMBER THE REVERSE WALK HITS, at the store's own key. `src/lsp/impact.ts` derives
  // reverse edges by scanning outgoing edges and matching targets, so a target that names
  // TWO published symbols is a place the walk picks a winner by a rule nobody chose. This
  // counts it on `qualifiedName` — the column `brain_relationship.source_external` is JOINed
  // against — and not on the bare name, because the bare name was fixed by FS-P3-1's
  // `metadata.fqn` and the collision that remains is a collision the LANGUAGE mandates.
  //
  // The shape it found here is F#'s companion pair: `type AccessControlState = …` followed by
  // `module AccessControlState = …` is an ordinary F# idiom and yields two real declarations
  // with one name. Measured on Grace/src/Grace.Actors/AccessControl.Actor.fs: a `class` at
  // line 23 and a `module_defn` at line 27, both with qualifiedName
  // `AccessControl.AccessControlState`. No per-file spelling separates them, so this is
  // reported rather than engineered around.
  const qnOwners = new Map<string, Set<string>>()
  for (const views of perFileViews) {
    for (const v of views) {
      if (v.qualifiedName.length === 0) continue
      let set = qnOwners.get(v.qualifiedName)
      if (!set) {
        set = new Set()
        qnOwners.set(v.qualifiedName, set)
      }
      set.add(`${v.kind}:${v.file}`)
    }
  }
  const collisions: { key: string; kinds: string[]; count: number }[] = []
  for (const [key, set] of qnOwners) {
    if (set.size <= 1) continue
    const kinds = [...set].map((x) => x.slice(0, x.indexOf(":"))).sort()
    collisions.push({ key, kinds, count: set.size })
  }
  collisions.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
  const kindPairs = new Map<string, number>()
  for (const c of collisions) {
    const pair = [...new Set(c.kinds)].sort().join("+")
    kindPairs.set(pair, (kindPairs.get(pair) ?? 0) + 1)
  }

  const summary = {
    lang: LANG,
    sampleRequested: SAMPLE,
    filesSampled: files.length,
    corpusTotal: total,
    filesParsed: parsed,
    parseFailures: failed,
    degradedFallbacks: degraded,
    symbols,
    relationships,
    emptySymbolNames: emptyNames,
    emptyOrUnknownKind: emptyKinds,
    unknownEndpoints,
    distinctQualifiedNames: qnOwners.size,
    qualifiedNameCollisions: collisions.length,
    collisionKindPairs: Object.fromEntries([...kindPairs].sort((a, b) => b[1] - a[1])),
    collisionExamples: collisions.slice(0, 8).map((c) => `${c.key} — ${c.count} symbols, kinds ${[...new Set(c.kinds)].join(", ")}`),
    perRepo,
  }

  const types = rows

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, types }, null, 2))
    return
  }

  const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${((100 * n) / d).toFixed(1)}%`)
  const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

  console.log("")
  console.log(`edge resolution probe — fsharp, production parseFile, ${files.length}-file stride sample of ${total}`)
  console.log(`corpus: ${CR}`)
  console.log("")
  console.log(`parsed ${parsed}/${files.length}, failures ${failed}, degraded ${degraded}`)
  console.log(`symbols ${symbols}, relationships ${relationships}`)
  console.log(`empty names ${emptyNames}, empty/unknown kind ${emptyKinds}, unknown endpoints ${unknownEndpoints}`)
  console.log("")
  console.log(w("type", 14) + w("edges", 9) + w("files", 8) + w("src%any", 10) + w("tgt%any", 10) + w("both%any", 11) + w("src%STORE", 11) + w("dotSrcStore", 13) + w("crossFile", 11) + w("lastSegAmbig", 13) + w("conf<.7", 9))
  console.log("-".repeat(110))
  for (const t of ALL_TYPES) {
    const r = rows[t]
    console.log(
      w(t, 14) +
        w(String(r.edges), 9) +
        w(String(r.files), 8) +
        w(pct(r.srcAny, r.edges), 10) +
        w(pct(r.tgtAny, r.edges), 10) +
        w(pct(r.bothAny, r.edges), 11) +
        w(pct(r.srcStoreKey, r.edges), 11) +
        w(`${r.dottedSrcStoreKey}/${r.dottedSrcTotal}`, 13) +
        w(String(r.crossFileEdges), 11) +
        w(String(r.lastSegmentAmbiguous), 13) +
        w(String(r.confBelow07), 9),
    )
  }
  console.log("-".repeat(110))
  console.log("")
  console.log("src%any/tgt%any/both%any = the endpoint binds under AT LEAST ONE of bare|qualified|ownerDot.")
  console.log("src%STORE  = the SOURCE binds under the store's OWN two strict strategies")
  console.log("             (parallel-indexer: exact `name`, exact `qualified_name`), no fallback.")
  console.log("dotSrcStore= DOTTED sources that bind, over dotted sources emitted. This is the")
  console.log("             FS-P3-1 measurement per type: a dotted source is one the analyzer")
  console.log("             qualified on purpose, so it is the only kind that can be store-resolvable")
  console.log("             ONLY via `qualified_name` — which is exactly what the store could not")
  console.log("             see before the fix. A union column cannot show this, because it also")
  console.log("             accepts `ownerDot`, which `ownerName` made computable either way.")
  console.log("crossFile = the target is not in this file but IS a name the sample publishes (so a")
  console.log("            population-wide walk reaches it; a per-file walk cannot).")
  console.log("lastSegAmbig = the source's final dot-segment is carried by >1 published symbol, so a")
  console.log("            name-only reverse walk attributes the incoming edge to one of several.")
  console.log("conf<.7 = heuristic edges (honesty contract §4: these must be countable).")
  console.log("")
  console.log(`AMBIGUITY AT THE STORE'S OWN KEY (qualified_name, the column source_external joins against)`)
  console.log(`  distinct qualified names      ${summary.distinctQualifiedNames}`)
  console.log(`  carried by >1 symbol          ${summary.qualifiedNameCollisions}`)
  console.log(`  kind pairs                    ${JSON.stringify(summary.collisionKindPairs)}`)
  for (const e of summary.collisionExamples) console.log(`    ${e}`)
  console.log("  F#'s companion pair (`type X = …` beside `module X = …`) is two real declarations")
  console.log("  with one name, so no per-file spelling separates them. Reported, not engineered around.")
  if (degraded > 0) {
    console.log("")
    console.log(`>>> REFUSING to publish these counts: ${degraded} file(s) fell back to the regex extractor.`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})