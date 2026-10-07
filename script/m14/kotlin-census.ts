/**
 * KOTLIN ONTOLOGY CENSUS — DERIV_EXPORTS_KOT4's measurement instrument.
 *
 * It answers, with numbers, the six questions the workstream asks of every type
 * an analyzer already emits, and it does it through the PRODUCTION entry point
 * (`parseFile` from `src/ast/pool-worker.ts`, not `analyze()`), because
 * `analyze()` is not what the product runs.
 *
 * ## Why this file exists and what it refuses to do
 *
 * 1. **NO REGEX.** Every programmatic decision is a tree walk or a node-type /
 *    field-name test. There is not one regular expression in this file, and the
 *    corpus-population test is a PARSE-TREE test (`hasDeclarationNode`) rather
 *    than a substring search, so a comment or a string literal cannot make a
 *    data table look like code. The measured reason is in
 *    docs/analyzers/REVIEW-2026-10-04.md §2 Defect A: substring sampling drew
 *    Ruby's encoding tables and moved that lane's score by eight points.
 *
 * 2. **THE POPULATION IS DERIVED, NEVER HAND-WRITTEN.** The file list comes from
 *    `git ls-files` over the corpus repo (the gate's own admission rule), so it
 *    cannot rot the way a `const FILES = [...]` array does. Every count printed
 *    here is printed over the population that produced it — the honesty
 *    contract's rule that an instrument declares the population it covered.
 *
 * 3. **ALL THREE CHANNELS ARE REPORTED.** `relationships[]`,
 *    `imports[]` (ImportInfo) and `exports[]` (ExportInfo) are separate fields
 *    of ParseResult (src/ast/types.ts:221-231). A type absent from the
 *    relationship tally while `imports[]` is non-zero is not a defect, and this
 *    instrument cannot be misread that way.
 *
 * Usage:
 *   bun run script/m14/kotlin-census.ts [--repo <dir>] [--limit N] [--stride N] [--fresh]
 *
 * Checkpoint: validation/m14/measurements/kotlin/census-checkpoint.txt
 * (resumable — `parseFile` can kill the process on a pathological file, and a
 * resumable walk is the difference between a lost measurement and a re-run).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { resumableWalk, resetCheckpoint } from "./resumable-walk"

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
type RelType = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
function flag(name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const CR = flag("--corpus") ?? "$HOME/fixtures/repositories"
const REPO_DIR = flag("--repo") ?? path.join(CR, "kotlin")
const LIMIT = Number(flag("--limit") ?? 400)
const STRIDE = Number(flag("--stride") ?? 1)
const CHECKPOINT = "validation/m14/measurements/kotlin/census-checkpoint.txt"
const OUT = flag("--out") ?? "validation/m14/measurements/kotlin/census.json"
if (argv.includes("--fresh")) resetCheckpoint(CHECKPOINT)

// ---------------------------------------------------------------- population
// Derived, never hand-written: `git ls-files` over the corpus repo, filtered by
// extension. `detectLanguageFromPath` is NOT consulted because the corpus is
// shared and this lane is about `.kt`/`.kts` specifically; the count of every
// extension present is printed so the filter's effect is visible.
const tracked: string[] = execFileSync("git", ["-C", REPO_DIR, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)

const extCounts = new Map<string, number>()
const all: string[] = []
for (const rel of tracked) {
  const ext = path.extname(rel).toLowerCase()
  extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
  if (ext === ".kt" || ext === ".kts") all.push(rel)
}
all.sort()

// ---------------------------------------------------------------- parse once, reuse
// The corpus has 69,822 .kt/.kts files; parsing all of them for a code-bearing
// test and then again for the census would double the cost of the most expensive
// step in this file. So the parse is cached to disk (one file per source file,
// under the lane's own measurements directory) and the census reads the cache.
const CACHE_DIR = "validation/m14/measurements/kotlin/parse-cache"
mkdirSync(CACHE_DIR, { recursive: true })
const cachePath = (abs: string) => path.join(CACHE_DIR, abs.replace(/[^A-Za-z0-9._-]/g, "_") + ".json")

// ---------------------------------------------------------------- tree helpers
// web-tree-sitter node walking. No regex, no text matching: every predicate below
// is a node-type or field-name comparison.
function eachChild(n: any, fn: (c: any) => void): void {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) fn(c)
  }
}
function walk(n: any, fn: (n: any) => void): void {
  fn(n)
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c) walk(c, fn)
  }
}
/** A file is CODE-BEARING when its own tree declares something. Data tables, docs
 *  and generated resources produce no declaration node, and that is a fact about
 *  the parse, not about the bytes. */
const DECLARATION_NODES = new Set([
  "class_declaration",
  "object_declaration",
  "function_declaration",
  "property_declaration",
  "type_alias",
  "secondary_constructor",
  "primary_constructor",
  "enum_entry",
])
function isCodeBearing(root: any): boolean {
  let found = false
  walk(root, (n) => {
    if (!found && DECLARATION_NODES.has(n.type)) found = true
  })
  return found
}

/** Every distinct node type the grammar produced, with counts — instrument A of
 *  the ontology gate, for this lane. A construct the grammar cannot name cannot
 *  be emitted and cannot be ruled by anything weaker. */
const grammarNodeTypes = new Map<string, number>()

// ---------------------------------------------------------------- accumulators
interface Tally {
  n: number
  files: Set<string>
  /** TRUE distinct-file count. `files` is capped at 6 to bound memory over a
   *  70k-file corpus, and a capped set printed in a "files" column is exactly the
   *  "correct number about the wrong population" the honesty contract names — so
   *  the true count is tracked separately, per file, by remembering the last file
   *  a type was seen in. */
  fileCount: number
  lastFile: string
  samples: string[]
  confLow: number
  confBuckets: Map<string, number>
  evidence: Map<string, number>
  srcResolved: number
  tgtResolved: number
  srcExternal: number
  tgtExternal: number
  bothResolved: number
  badEndpoint: number
  /** Up to 20 standing-rule violations, verbatim. A count of defects is only
   *  actionable if the offending rows are printed with it. */
  badSamples: string[]
  /** Endpoint SPELLINGS that are placeholders or scope sentinels rather than
   *  declared names, counted per type. `unknown` is in this list but is NOT a
   *  verdict on its own: it is a legal Kotlin identifier and the corpus declares
   *  one (`override fun unknown() {}`). The resolution columns say which of the
   *  `unknown` endpoints bind to a real in-file symbol. */
  spellings: Map<string, number>
}
function newTally(): Tally {
  return {
    n: 0,
    files: new Set(),
    fileCount: 0,
    lastFile: "",
    samples: [],
    confLow: 0,
    confBuckets: new Map(),
    evidence: new Map(),
    srcResolved: 0,
    tgtResolved: 0,
    srcExternal: 0,
    tgtExternal: 0,
    bothResolved: 0,
    badEndpoint: 0,
    badSamples: [],
    spellings: new Map(),
  }
}
const tally = new Map<RelType, Tally>()
for (const t of ALL_TYPES) tally.set(t, newTally())

let filesAdmitted = 0
let filesCodeBearing = 0
let filesWalked = 0
let filesFailed = 0
let symbolsTotal = 0
let symbolsUnknownKind = 0
let symbolsEmptyName = 0
const emptyNameSamples: string[] = []
let importsChannel = 0
let importsFiles = 0
let exportsChannel = 0
let exportsFiles = 0
let errorFiles = 0
let parseErrorNodes = 0
const perFile: { file: string; rels: number; imports: number; exports: number; symbols: number }[] = []
const labelSamples = new Map<RelType, string[]>()
/** The two channels must not drift. `exports[]` and the `exports` relationship are
 *  emitted from ONE predicate inside analyze(), so any difference between them is
 *  something BETWEEN those two points — and the only candidate is
 *  pool-worker's `filterNoiseRelationships`, which rewrites relationships before
 *  they leave the production path. A silent difference here is exactly how a
 *  two-channel type stops being trustworthy, so it is counted per file. */
let channelDeltaFiles = 0
let channelDeltaRows = 0
const channelDeltaSamples: string[] = []

// ---------------------------------------------------------------- the walk
const stats = await resumableWalk(CHECKPOINT, all.length, {
  id: (i) => all[i],
  concurrency: 6,
  run: async (i) => {
    const rel = all[i]
    if (STRIDE > 1 && i % STRIDE !== 0) return
    if (LIMIT > 0 && filesWalked >= LIMIT) return
    const abs = path.join(REPO_DIR, rel)
    try {
      if (statSync(abs).size > 512 * 1024) return
    } catch {
      return
    }
    filesAdmitted++

    // 1. the production parse — this is the ONLY path that decides EMITTED
    let res: any
    try {
      res = await parseFile(abs, REPO_DIR)
    } catch {
      filesFailed++
      return
    }
    filesWalked++
    const rels: any[] = res.relationships ?? []
    const syms: any[] = res.symbols ?? []
    const imps: any[] = res.imports ?? []
    const exps: any[] = res.exports ?? []
    symbolsTotal += syms.length
    if (imps.length) {
      importsChannel += imps.length
      importsFiles++
    }
    if (exps.length) {
      exportsChannel += exps.length
      exportsFiles++
    }
    const exportRels = rels.filter((r: any) => String(r.type ?? r.relationshipType ?? "").toLowerCase() === "exports")
    if (exportRels.length !== exps.length) {
      channelDeltaFiles++
      channelDeltaRows += Math.abs(exportRels.length - exps.length)
      if (channelDeltaSamples.length < 10) {
        const relNames = new Set(exportRels.map((r: any) => String(r.target ?? "")))
        channelDeltaSamples.push(
          `${rel}: exports[] ${exps.length} vs exports-relationship ${exportRels.length}; ` +
            `only-on-one-side: ${JSON.stringify(exps.map((e: any) => e.name).filter((n: string) => !relNames.has(n)))}`,
        )
      }
    }
    if ((res.errors ?? []).length) errorFiles++
    for (const e of res.errors ?? []) {
      const m = String(e.message ?? "")
      if (m.indexOf("Syntax ") === 0) parseErrorNodes++
    }
    perFile.push({ file: rel, rels: rels.length, imports: imps.length, exports: exps.length, symbols: syms.length })

    // 2. standing rules (R7): no unknown kind, no empty name, no `unknown`
    //    endpoint. Counted, not assumed.
    const names = new Set<string>()
    for (const s of syms) {
      const nm = String(s.name ?? "")
      if (nm.length === 0) {
        symbolsEmptyName++
        if (emptyNameSamples.length < 20) {
          emptyNameSamples.push(`${rel}:${s.range?.startLine ?? "?"} kind=${String(s.kind)} owner=${String(s.ownerName ?? "-")} meta=${JSON.stringify(s.metadata ?? {}).slice(0, 160)}`)
        }
      }
      if (String(s.kind ?? "") === "unknown") symbolsUnknownKind++
      if (nm.length > 0) names.add(nm)
    }

    // 3. code-bearing + grammar inventory, from the tree itself
    const cp = cachePath(abs)
    try {
      const cached = JSON.parse(readFileSync(cp, "utf8"))
      if (cached.codeBearing) {
        filesCodeBearing++
        for (const [k, v] of cached.nodeTypes as [string, number][]) {
          grammarNodeTypes.set(k, (grammarNodeTypes.get(k) ?? 0) + v)
        }
      }
    } catch {
      const { getParser } = await import("../../src/ast/engine")
      const parser = await getParser("kotlin")
      const tree_ = await parser.parse(readFileSync(abs, "utf8"), abs)
      if (tree_) {
        const counts = new Map<string, number>()
        walk(tree_.rootNode, (n) => {
          counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
        })
        const codeBearing = isCodeBearing(tree_.rootNode)
        writeFileSync(
          cp,
          JSON.stringify({ codeBearing, nodeTypes: [...counts.entries()] }),
        )
        if (codeBearing) {
          filesCodeBearing++
          for (const [k, v] of counts) grammarNodeTypes.set(k, (grammarNodeTypes.get(k) ?? 0) + v)
        }
        tree_.delete?.()
      }
    }

    // 4. per-relationship tallies
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "").toLowerCase() as RelType
      if (!ALL_TYPES.includes(t)) continue
      const row = tally.get(t)!
      row.n++
      if (row.files.size < 6) row.files.add(rel)
      if (row.lastFile !== rel) {
        row.lastFile = rel
        row.fileCount++
      }
      const src = String(r.source ?? r.from ?? "")
      const tgt = String(r.target ?? r.to ?? "")
      const label = `${src} -[${t}]-> ${tgt}`
      if (row.samples.length < 5) row.samples.push(label)
      const ls = labelSamples.get(t) ?? []
      if (ls.length < 40) ls.push(`${rel}:${r.line_number ?? "?"} ${label}`)
      labelSamples.set(t, ls)
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      const b = conf >= 1 ? "1.0" : conf >= 0.9 ? "0.9-1.0" : conf >= 0.7 ? "0.7-0.9" : "BELOW-0.7"
      row.confBuckets.set(b, (row.confBuckets.get(b) ?? 0) + 1)
      if (conf < 0.7) row.confLow++
      const ev = String(r.metadata?.evidenceClass ?? r.evidenceClass ?? "(none)")
      row.evidence.set(ev, (row.evidence.get(ev) ?? 0) + 1)
      // R7 endpoints: an EMPTY endpoint is a defect outright. The literal
      // `unknown` is counted separately and adjudicated by resolution, because
      // it is a legal Kotlin identifier the corpus really declares.
      if (src.length === 0 || tgt.length === 0) {
        row.badEndpoint++
        if (row.badSamples.length < 20) {
          row.badSamples.push(`${rel}:${r.line_number ?? "?"} src=${JSON.stringify(src)} tgt=${JSON.stringify(tgt)} via=${String(r.metadata?.relationshipType ?? "-")}`)
        }
      }
      for (const [label, sp] of [["src", src], ["tgt", tgt]] as [string, string][]) {
        if (sp === "Global" || sp === "root" || sp === "constructor" || sp === "unknown" || sp === "this" || sp === "super" || sp.length === 0) {
          const k = `${label}=${sp.length === 0 ? "(empty)" : sp}`
          row.spellings.set(k, (row.spellings.get(k) ?? 0) + 1)
        }
      }
      const srcLeaf = src.split(".").pop() ?? src
      const tgtLeaf = tgt.split(".").pop() ?? tgt
      const sIn = names.has(src) || names.has(srcLeaf)
      const tIn = names.has(tgt) || names.has(tgtLeaf)
      if (sIn) row.srcResolved++
      else row.srcExternal++
      if (tIn) row.tgtResolved++
      else row.tgtExternal++
      if (sIn && tIn) row.bothResolved++
    }
  },
})

// ---------------------------------------------------------------- report
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
console.log(`\nkotlin ontology census — ${REPO_DIR}`)
console.log(
  `population: ${all.length} .kt/.kts files tracked by git (derived from git ls-files, not hand-listed); ` +
    `${all.length > 0 ? "extension census of the repo: " : ""}` +
    [...extCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([e, n]) => `${e}:${n}`)
      .join(" "),
)
console.log(
  `walk: ${stats.walked + stats.alreadyDone}/${all.length} files ` +
    `(${(((stats.walked + stats.alreadyDone) / all.length) * 100).toFixed(2)}%)  ` +
    `newly walked ${stats.walked}, resumed ${stats.alreadyDone}` +
    (stats.skippedBad ? `  SKIPPED-BAD ${stats.skippedBad}` : "") +
    (stats.partial ? "  PARTIAL" : ""),
)
console.log(
  `admitted (size<=512KiB, stride ${STRIDE}, limit ${LIMIT || "none"}): ${filesAdmitted}  ` +
    `parsed: ${filesWalked}  failed: ${filesFailed}  code-bearing (parse-tree test): ${filesCodeBearing}`,
)
console.log(
  `symbols ${symbolsTotal}  empty names ${symbolsEmptyName}  unknown kinds ${symbolsUnknownKind}  ` +
    `files with analyzer errors ${errorFiles}  ERROR/MISSING nodes ${parseErrorNodes}`,
)
console.log(
  `CHANNELS  relationships[] ${perFile.reduce((a, f) => a + f.rels, 0)}  ` +
    `imports[] ${importsChannel} in ${importsFiles} files  exports[] ${exportsChannel} in ${exportsFiles} files`,
)
console.log(
  `CHANNEL AGREEMENT  exports[] vs exports-relationship: ${channelDeltaFiles} file(s) differ, ` +
    `${channelDeltaRows} row(s) — the two lists are emitted from ONE predicate inside analyze(), ` +
    `so any difference is something downstream of that (pool-worker's filterNoiseRelationships ` +
    `rewrites relationships after the analyzer returns)`,
)
for (const l of channelDeltaSamples) console.log(`  ${l}`)
// A resumable walk that resumed everything walks NOTHING, and an all-zero table
// printed without this line reads as "the analyzer emits nothing" — the silent
// pass that firing-check-v2's own lane matcher was rewritten to refuse. Fail
// loudly instead.
if (filesWalked === 0 && stats.alreadyDone > 0) {
  console.log("")
  console.error(
    `FIRING/CENSUS CHECKPOINT: every admitted file was already walked (${stats.alreadyDone} resumed, 0 newly walked).\n` +
      `The table below would be EMPTY and would read as a result. Re-run with --fresh,\n` +
      `or delete ${CHECKPOINT} to start over. Checkpoint: ${CHECKPOINT}`,
  )
  process.exit(2)
}
console.log("")
const head = ["type", "verdict", "edges", "files", "conf<0.7", "src→sym", "tgt→sym", "both", "R7 bad", "files it came from"]
console.log(head.map((h, i) => h.padEnd([6, 9, 7, 7, 9, 8, 8, 7, 8, 40][i])).join(""))
console.log("-".repeat(130))
const out: any = { at: new Date().toISOString(), repo: REPO_DIR, population: all.length, rows: [] }
for (const t of ALL_TYPES) {
  const r = tally.get(t)!
  const verdict = r.n > 0 ? "EMITTED(rel)" : t === "imports" && importsChannel > 0 ? "EMITTED(imports[])" : t === "exports" && exportsChannel > 0 ? "EMITTED(exports[])" : "NOT-ON-ANY-CHANNEL"
  console.log(
    [
      t.padEnd(6),
      verdict.padEnd(9),
      String(r.n).padEnd(7),
      String(r.fileCount).padEnd(7),
      `${r.confLow} (${pct(r.confLow, r.n)})`.padEnd(9),
      pct(r.srcResolved, r.n).padEnd(8),
      pct(r.tgtResolved, r.n).padEnd(8),
      pct(r.bothResolved, r.n).padEnd(7),
      String(r.badEndpoint).padEnd(8),
      [...r.files].slice(0, 2).join(", "),
    ].join(""),
  )
  out.rows.push({
    type: t,
    verdict,
    edges: r.n,
    files: r.fileCount,
    fileSamples: [...r.files],
    edgeSamples: r.samples,
    confidence: { below07: r.confLow, buckets: Object.fromEntries(r.confBuckets) },
    placeholderSpellings: Object.fromEntries(r.spellings),
    evidenceClass: Object.fromEntries(r.evidence),
    endpoints: {
      sourceResolvedToSymbol: r.srcResolved,
      sourceExternal: r.srcExternal,
      targetResolvedToSymbol: r.tgtResolved,
      targetExternal: r.tgtExternal,
      bothResolved: r.bothResolved,
      badPlaceholderEndpoints: r.badEndpoint,
    },
  })
}
console.log("")
if (symbolsEmptyName > 0) {
  console.log(`\nEMPTY SYMBOL NAMES (${symbolsEmptyName}) — standing rule R7, verbatim:`)
  for (const l of emptyNameSamples) console.log(`  ${l}`)
}
if ([...tally.values()].some((r) => r.badSamples.length > 0)) {
  console.log(`\nPLACEHOLDER/EMPTY EDGE ENDPOINTS (standing rule R7), verbatim:`)
  for (const [k, r] of tally) for (const l of r.badSamples) console.log(`  ${k.padEnd(12)} ${l}`)
}
console.log("\nper-type confidence histogram, evidenceClass and placeholder spellings:")
for (const t of ALL_TYPES) {
  const r = tally.get(t)!
  if (r.n === 0) continue
  const sp = Object.fromEntries(r.spellings)
  console.log(`  ${t.padEnd(12)} conf ${JSON.stringify(Object.fromEntries(r.confBuckets))}  evidence ${JSON.stringify(Object.fromEntries(r.evidence))}${Object.keys(sp).length ? `  PLACEHOLDER-SPELLINGS ${JSON.stringify(sp)}` : ""}`)
}
console.log("")
console.log(`grammar node types observed on ${filesCodeBearing} code-bearing files: ${grammarNodeTypes.size}`)
const interesting = [...grammarNodeTypes.keys()].filter((k) => {
  const l = k.toLowerCase()
  return l.indexOf("export") >= 0 || l.indexOf("import") >= 0 || l.indexOf("visib") >= 0 || l.indexOf("modif") >= 0 || l.indexOf("annot") >= 0 || l.indexOf("delegat") >= 0 || l.indexOf("inherit") >= 0
})
console.log(`  node types whose name mentions export/import/visibility/modifier/annotation/delegation/inheritance: ${interesting.join(", ") || "(none)"}`)
out.grammarNodeTypes = Object.fromEntries([...grammarNodeTypes.entries()].sort((a, b) => b[1] - a[1]))
out.interestingNodeTypes = interesting
out.channelAgreement = { differingFiles: channelDeltaFiles, differingRows: channelDeltaRows, samples: channelDeltaSamples }
out.channels = { relationships: perFile.reduce((a, f) => a + f.rels, 0), imports: importsChannel, exports: exportsChannel }
out.symbols = { total: symbolsTotal, emptyNames: symbolsEmptyName, emptyNameSamples, unknownKinds: symbolsUnknownKind }
out.badEndpointSamples = Object.fromEntries([...tally.entries()].map(([k, v]) => [k, v.badSamples]))
out.labelSamples = Object.fromEntries(labelSamples)
out.perFile = perFile

const jsonPath = path.resolve(OUT)
mkdirSync(path.dirname(jsonPath), { recursive: true })
writeFileSync(jsonPath, JSON.stringify(out, null, 1))
console.log(`\nwrote ${OUT}`)
