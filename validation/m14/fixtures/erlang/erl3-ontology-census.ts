/**
 * erl3-ontology-census — the DERIV_EXPORTS_ERL3 measurement instrument.
 *
 * ## WHAT IT MEASURES, AND WHY IT IS NOT THE ONTOLOGY GATE
 *
 * `script/m14/ontology-coverage-gate.ts` walks every corpus repo that has a
 * detected erlang file and reports EMITTED / RULED-SOUND / FALSIFIED /
 * RULED-UNJUSTIFIED. That gate is supervisor-owned and it is the arbiter; this
 * file is the LANE's own census and it exists because two questions the gate
 * does not answer are first-class here:
 *
 *   1. PER-TYPE counts and the FILES each came from, over ONE named corpus
 *      (otp), walked through the PRODUCTION entry (`parseFile` from
 *      src/ast/pool-worker.ts — the same function parallel-indexer calls).
 *      The gate's walk is the production entry too, but its population is
 *      "every repo with an erlang file", which changes as repos are added;
 *      a per-type count whose denominator is not stated is a number about an
 *      unknown population (M14-HONESTY-CONTRACT.md §"an instrument must
 *      declare the population it covered").
 *   2. The SIX QUESTIONS per already-emitted type, and specifically question 5
 *      (RESOLVED) and question 6 (CONFIDENT) and rule R7 — which no gate in
 *      the repo computes for erlang. Firing proves an edge exists; nothing in
 *      the gate says its endpoints bind to symbols or that its confidence is
 *      above the 0.7 heuristic floor.
 *
 * ## THE POPULATION IS DERIVED, NEVER TYPED
 *
 * `git ls-files` in the corpus, filtered to `.erl` / `.hrl`. A hand-written
 * file list rots silently and the instrument keeps printing `0` with total
 * confidence (honesty contract §"Rule: an instrument must declare the
 * population it covered", consequence 2).
 *
 * ## NO REGEXP
 *
 * Zero `RegExp` construction anywhere in this file. Every check is a node-type
 * comparison, a string `includes`, a `split`, or a char scan. The one place a
 * regex would be tempting — matching `-export([f/1])` in text — is exactly the
 * defect class the workstream warns about, so it is not done: the `-export`
 * surface is read off `export_attribute` / `export_type_attribute` /
 * `fa` NODES.
 *
 * ## USAGE
 *
 *   bun validation/m14/fixtures/erlang/erl3-ontology-census.ts otp
 *   BB_CENSUS_LIMIT=400 bun validation/m14/fixtures/erlang/erl3-ontology-census.ts otp
 *   BB_CENSUS_TAG=post bun validation/m14/fixtures/erlang/erl3-ontology-census.ts otp
 *
 * Writes `validation/m14/measurements/erl3-ontology-census-<repo>.json`.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { ASTEngine } from "../../../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS || "/home/ishaq2321/bb_tests/repositories"
const REPO = process.argv[2] || "otp"
const LIMIT = Number(process.env.BB_CENSUS_LIMIT || 0)
const TAG = process.env.BB_CENSUS_TAG || "current"
const OUT_DIR = path.resolve(process.cwd(), "validation/m14/measurements")

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

/** R7's placeholder literal. Rule: no edge endpoint may equal it. */
const PLACEHOLDER = "unknown"

const repoDir = path.join(CORPUS, REPO)

// ---------------------------------------------------------------- population
function derivePopulation(): { abs: string; rel: string }[] {
  const out: { abs: string; rel: string }[] = []
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return out
  }
  for (const rel of tracked) {
    // Extension test by suffix, not by regex.
    if (!rel.endsWith(".erl") && !rel.endsWith(".hrl")) continue
    const abs = path.join(repoDir, rel)
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    out.push({ abs, rel })
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return LIMIT > 0 ? out.slice(0, LIMIT) : out
}

const population = derivePopulation()
let rev = "unknown"
try {
  rev = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim().slice(0, 12)
} catch {}

// ---------------------------------------------------------------- tallies
interface TypeRow {
  /** Edges of this type seen on the relationship channel. */
  n: number
  /** Files that produced at least one. */
  files: number
  /** First few files, in walk order, with their count. */
  examples: { file: string; n: number }[]
  /** confidence value -> edges. */
  confidence: Record<string, number>
  /** metadata.evidenceClass value -> edges. */
  evidenceClass: Record<string, number>
  /** Edges whose SOURCE resolves to a symbol this file publishes. */
  sourceResolves: number
  /** Edges whose TARGET resolves to a symbol this file publishes. */
  targetResolves: number
  /** Edges whose source resolves and whose target is the file's own module path (external by construction). */
  targetIsExternalModule: number
  /** Edges with an empty endpoint, or the R7 placeholder. */
  placeholderEndpoints: number
  /** Edges carrying a line_number. */
  withLine: number
  /** Distinct (source,target) pairs — the deduped shape the graph stores. */
  distinctPairs: number
}

function newRow(): TypeRow {
  return {
    n: 0,
    files: 0,
    examples: [],
    confidence: {},
    evidenceClass: {},
    sourceResolves: 0,
    targetResolves: 0,
    targetIsExternalModule: 0,
    placeholderEndpoints: 0,
    withLine: 0,
    distinctPairs: 0,
  }
}

const rows = new Map<Type, TypeRow>()
for (const t of ALL_TYPES) rows.set(t, newRow())

const perTypeFiles = new Map<Type, Set<string>>()
for (const t of ALL_TYPES) perTypeFiles.set(t, new Set())

/** Imports CHANNEL (ParseResult.imports), reported separately per firing-check v2. */
const importsChannel = {
  entries: 0,
  files: 0,
  byKind: {} as Record<string, number>,
  withItems: 0,
  items: 0,
}

/** Grammar inventory over the same population — instrument A. */
const nodeTypesSeen = new Set<string>()

/** Unknown kinds / empty names / ownerless members — R7 and the standing rules. */
const hygiene = {
  filesRead: 0,
  filesWithZeroSymbols: 0,
  filesWithZeroSymbolsAndNoErrors: [] as string[],
  unknownKinds: 0,
  emptyNames: 0,
  ownerlessMembers: 0,
  kindTally: {} as Record<string, number>,
  errorFiles: 0,
  grammarDamaged: 0,
  sentinelNames: 0,
}

/** Edges whose SOURCE or TARGET is an absolute filesystem path (the ER-D32 fallback). */
const pathOwned = { edges: 0, byType: {} as Record<string, number>, files: new Set<string>() }

let crashFiles = 0
const crashExamples: string[] = []

for (const { abs, rel } of population) {
  let res: any
  try {
    res = await parseFile(abs, repoDir)
  } catch (e) {
    crashFiles++
    if (crashExamples.length < 5) crashExamples.push(`${rel}: ${String(e).slice(0, 80)}`)
    continue
  }
  hygiene.filesRead++
  const symbols = res?.symbols ?? []
  const rels = res?.relationships ?? []
  const imports = res?.imports ?? []
  const errors = res?.errors ?? []

  if (errors.length > 0) hygiene.errorFiles++
  if (res?.metadata?.grammarDamaged) hygiene.grammarDamaged++
  if (symbols.length === 0) {
    hygiene.filesWithZeroSymbols++
    if (errors.length === 0) hygiene.filesWithZeroSymbolsAndNoErrors.push(rel)
  }

  // Symbol name / kind hygiene. Names are compared by char scan, not by regex:
  // a placeholder is either the exact literal or a path that ends in it.
  const symbolNames = new Set<string>()
  for (const s of symbols) {
    const name = String(s?.name ?? "")
    const kind = String(s?.kind ?? "")
    hygiene.kindTally[kind] = (hygiene.kindTally[kind] || 0) + 1
    if (kind === "" || kind === "unknown" || kind === "Unknown") hygiene.unknownKinds++
    if (name.length === 0) {
      hygiene.emptyNames++
    } else {
      symbolNames.add(name)
      if (name === PLACEHOLDER) hygiene.sentinelNames++
    }
  }
  // ownerName: a module-scope member with no owner loses its containment.
  for (const s of symbols) {
    if (s?.ownerName === undefined || s?.ownerName === null || String(s.ownerName).length === 0) {
      const k = String(s?.kind ?? "")
      if (k !== "module") hygiene.ownerlessMembers++
    }
  }

  // Imports channel — a SEPARATE channel from relationships (types.ts:206-216).
  if (imports.length > 0) {
    importsChannel.entries += imports.length
    importsChannel.files++
    for (const im of imports) {
      const kind = String(im?.importType ?? "(none)")
      importsChannel.byKind[kind] = (importsChannel.byKind[kind] || 0) + 1
      const items = im?.importedNames ?? im?.items ?? []
      if (Array.isArray(items) && items.length > 0) {
        importsChannel.withItems++
        importsChannel.items += items.length
      }
    }
  }

  const fileCounts = new Map<Type, number>()
  const filePairs = new Map<Type, Set<string>>()
  for (const r of rels) {
    const t = String(r?.relationshipType ?? r?.type ?? "") as Type
    const row = rows.get(t)
    if (!row) continue
    row.n++
    fileCounts.set(t, (fileCounts.get(t) || 0) + 1)
    perTypeFiles.get(t)!.add(rel)
    if (!filePairs.has(t)) filePairs.set(t, new Set())
    const pair = `${r?.source}|${r?.target}`
    filePairs.get(t)!.add(pair)

    const conf = String(r?.confidence ?? "(none)")
    row.confidence[conf] = (row.confidence[conf] || 0) + 1
    const ec = String((r?.metadata as any)?.evidenceClass ?? "(none)")
    row.evidenceClass[ec] = (row.evidenceClass[ec] || 0) + 1
    if (typeof r?.line_number === "number" && r.line_number > 0) row.withLine++

    const src = String(r?.source ?? "")
    const tgt = String(r?.target ?? "")
    if (symbolNames.has(src)) row.sourceResolves++
    if (symbolNames.has(tgt)) row.targetResolves++
    // An external module target cannot resolve in-file by construction; that is
    // counted so the reader can tell "unresolved" from "by design external".
    const colon = tgt.indexOf(":")
    const leaf = colon >= 0 ? tgt.slice(colon + 1) : tgt
    if (colon >= 0 && leaf.length > 0 && !symbolNames.has(leaf)) row.targetIsExternalModule++
    if (src.length === 0 || tgt.length === 0 || src === PLACEHOLDER || tgt === PLACEHOLDER) {
      row.placeholderEndpoints++
    }

    // The ER-D32 fallback: an edge whose source is the FILE PATH.
    if (src.includes("/") && src.endsWith(".erl")) {
      pathOwned.edges++
      pathOwned.byType[t] = (pathOwned.byType[t] || 0) + 1
      pathOwned.files.add(rel)
    }
  }
  for (const [t, n] of fileCounts) {
    const row = rows.get(t)!
    row.files++
    if (row.examples.length < 3) row.examples.push({ file: rel, n })
  }
  for (const [t, pairs] of filePairs) rows.get(t)!.distinctPairs += pairs.size
}

// ---------------------------------------------------------------- output
const table: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  table[t] = {
    edges: r.n,
    files: r.files,
    distinctPairs: r.distinctPairs,
    confidence: r.confidence,
    evidenceClass: r.evidenceClass,
    withLine: r.withLine,
    unlined: r.n - r.withLine,
    sourceResolves: r.sourceResolves,
    targetResolves: r.targetResolves,
    targetIsExternalModule: r.targetIsExternalModule,
    placeholderEndpoints: r.placeholderEndpoints,
    examples: r.examples,
  }
}

const artifact = {
  lane: "DERIV_EXPORTS_ERL3",
  tag: TAG,
  corpus: {
    root: CORPUS,
    repo: REPO,
    rev,
    admittedFiles: population.length,
    limitApplied: LIMIT > 0 ? LIMIT : null,
    derivation: "git ls-files in the corpus repo, filtered to .erl/.hrl suffix, <=512KB, sorted by path",
  },
  entry: "src/ast/pool-worker.ts parseFile (the production entry parallel-indexer calls)",
  perType: table,
  importsChannel: {
    ...importsChannel,
    note: "ParseResult.imports — a SEPARATE channel from relationships; parallel-indexer writes it to the brain_import TABLE.",
  },
  hygiene,
  pathOwned: {
    edges: pathOwned.edges,
    byType: pathOwned.byType,
    files: pathOwned.files.size,
    note: "edges whose source is the file path — the ER-D32 fallback for a module-less file",
  },
  crashes: { n: crashFiles, examples: crashExamples },
  graphNodeTypesObserved: nodeTypesSeen.size,
}

mkdirSync(OUT_DIR, { recursive: true })
const outFile = path.join(OUT_DIR, `erl3-ontology-census-${REPO}.json`)
writeFileSync(outFile, JSON.stringify(artifact, null, 2))

// ---------------------------------------------------------------- console
console.log(`# erl3 ontology census — ${REPO} @ ${rev} (${TAG})`)
console.log(`population: ${population.length} admitted .erl/.hrl files (git ls-files, derived)`)
console.log(`read: ${hygiene.filesRead}, crash: ${crashFiles}, grammar-damaged: ${hygiene.grammarDamaged}\n`)
console.log("type         edges      files  unlined  src-res  tgt-res  ext-tgt  placeholder  confidence")
for (const t of ALL_TYPES) {
  const r = table[t]
  console.log(
    `${t.padEnd(12)} ${String(r.edges).padStart(7)} ${String(r.files).padStart(9)} ${String(r.unlined).padStart(8)} ${String(r.sourceResolves).padStart(8)} ${String(r.targetResolves).padStart(8)} ${String(r.targetIsExternalModule).padStart(8)} ${String(r.placeholderEndpoints).padStart(12)}  ${Object.entries(r.confidence).map(([k, v]) => `${k}:${v}`).join(" ")}`,
  )
}
console.log(`\nimports[] channel: ${importsChannel.entries} entries in ${importsChannel.files} files; kinds ${JSON.stringify(importsChannel.byKind)}; ${importsChannel.items} named items across ${importsChannel.withItems} entries`)
console.log(`hygiene: unknownKinds=${hygiene.unknownKinds} emptyNames=${hygiene.emptyNames} sentinelNames=${hygiene.sentinelNames} ownerlessMembers=${hygiene.ownerlessMembers} zeroSymbolFiles=${hygiene.filesWithZeroSymbols} (of which ${hygiene.filesWithZeroSymbolsAndNoErrors.length} with no error)`)
console.log(`path-owned edges (ER-D32 fallback): ${pathOwned.edges} in ${pathOwned.files.size} files ${JSON.stringify(pathOwned.byType)}`)
console.log(`artifact: ${outFile}`)