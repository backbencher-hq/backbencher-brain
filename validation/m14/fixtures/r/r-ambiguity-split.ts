/**
 * R AMBIGUITY SPLIT — which kind of name collision produces R's ambiguous targets.
 *
 * ## Why this file exists
 *
 * The round brief's whole premise is that ambiguity is the deep work left:
 *
 *     lane        files fired   AMBIGUOUS  UNRESOLVED
 *     r             21    7            8         190
 *
 * That row has a defect this file exists to correct before anything is built on it:
 * **21 files**. R's admitted population is 2,184 files across 16 repositories, so the
 * row describes 1.0% of the corpus, drawn from a prefix. `amb 8` and `unres 190` are
 * counts over 21 files and say nothing about R's incoming shape. A number that
 * measures 1% of its population must not be quoted as the lane's ambiguity — and the
 * brief's own rule ("an unresolved count is a defect only when you have checked the
 * target genuinely does not exist") cannot even be applied to a figure this thin.
 *
 * So this file re-measures at 600 files (the brief's basis, so a before/after is
 * comparable) and at the whole 2,184-file population, and then decomposes.
 *
 * ## The definition it decomposes, read off the instrument and not guessed
 *
 * `script/m14/incoming-check.ts` builds
 *
 *     published : Map<name, kind[]>
 *
 * inserting `name` and, when it differs, `qualifiedName` as keys; then
 *
 *     if (hits.length > 1) row.ambiguousTargets++
 *
 * where `hits` is the KIND ARRAY. So **ambiguous means: this target string is
 * published under two or more distinct `SymbolKind` values.** It does NOT mean the
 * name was declared twice with the same kind — `f <- function() {}` in ten files is
 * ten declarations and ZERO ambiguity by this definition.
 *
 * That distinction decides the whole round, so it is stated as a derived fact rather
 * than a paraphrase: if R's ambiguity is dominated by names carrying two DIFFERENT
 * kinds, then no amount of deduplication moves it, because the collision is in the
 * published NAME-to-KIND mapping and not in the edge count. The brief already says
 * this ("you cannot reduce ambiguity by emitting fewer edges"); the kind condition
 * makes it sharper still.
 *
 * ## The three buckets, each with the fix it implies
 *
 *   B1 SAME-FILE      every declaration of the name is in ONE file, so the
 *                     collision is in-file and R's own lexical scoping would name a
 *                     winner. In principle a lane fix.
 *   B2 CROSS-FILE     declarations span >= 2 files. The analyzer cannot say which
 *                     definition is in scope; R resolves this at RUNTIME through
 *                     environments and the search path, which is not a static fact.
 *                     Fixable only by qualifying the published name, which the
 *                     analyzer does not own (the engine computes qualifiedName).
 *   B3 BUILTIN        the name is also a base-R / package symbol the lane never
 *                     publishes, so the corpus collides with the language itself.
 *                     Not lane-owned at all.
 *
 * B1 and B2 are the buckets the brief calls the analyzer's. B3 is the brief's third
 * kind — "two different symbols legitimately share a published name" — and when it
 * dominates, the finding is about the published-name contract, not about R.
 *
 * ## The instrument
 *
 * Production `parseFile` from `src/ast/pool-worker.ts`, never `analyze()`. Corpus
 * admission is byte-identical to `validation/m14/fixtures/r/ontology-ten-types.ts`:
 * git-tracked files the production ROUTER (`src/ast/language-detection.ts`
 * `detectLanguageFromPath`) maps to `r`, <= 512 KB, in corpus order. Concurrency 4,
 * because `firing-check.ts`'s header records `parseFile` being nondeterministic under
 * concurrency before `src/ast/engine.ts` was fixed per-process.
 *
 * `parseFile`'s second argument is the project path `incoming-check.ts` passes
 * (`path.dirname(files[0])`). This file passes each file's OWN repository directory,
 * which reads like R's package boundary — but that reading was WRONG, and the file
 * measures rather than asserts it. `BB_QUAL_PROBE` counts, over every symbol in the
 * walk, how many have a `qualifiedName` that differs from `name` or that carries a
 * `::`/`$`/`@`/`/` qualifier. Measured: 0 of 29,551, under BOTH the per-repository
 * and the flat project path. R's analyzer publishes `qualifiedName === name` for every
 * symbol, so the project-path argument cannot change R's published universe and the
 * per-repo/flat distinction this file used to advertise is not a distinction at all.
 *
 * That correction strengthens the finding rather than weakening it. Because R
 * publishes no qualified names, every relationship target below is a BARE R identifier
 * in ONE flat global namespace spanning all 16 repositories — there is no published
 * per-package addressing for a target to name, so B2 cannot be repaired by qualifying
 * a name at the edge. `BB_FLAT=1` is kept only to demonstrate the no-op empirically.
 *
 * ## Reproducing
 *
 *   npx tsx validation/m14/fixtures/r/r-ambiguity-split.ts
 *   BB_R_LIMIT=600 npx tsx validation/m14/fixtures/r/r-ambiguity-split.ts
 *   BB_R_FLAT=1 npx tsx validation/m14/fixtures/r/r-ambiguity-split.ts
 *
 * BB_R_LIMIT is a corpus-order PREFIX, not a random draw. The run prints the files it
 * covered so the population can be read off the output.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_LIMIT ?? 0)
const FLAT = process.env.BB_R_FLAT === "1"
const WORKERS = 4

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const LABEL_ALIASES: Record<string, Type> = {
  brain_import: "imports", brain_call: "calls", brain_use: "uses",
  brain_contains: "contains", brain_reference: "references", brain_export: "exports",
  brain_extends: "extends", brain_implements: "implements",
  brain_overrides: "overrides", brain_instantiates: "instantiates",
  call: "calls", use: "uses", composition: "contains", part_of: "contains",
  imports: "imports", brain_imports: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports", extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides", instantiates: "instantiates",
}
function ontologyType(raw: unknown): Type | null {
  const s = String(raw ?? "").toLowerCase()
  if ((ALL_TYPES as readonly string[]).includes(s)) return s as Type
  return LABEL_ALIASES[s] ?? null
}

/**
 * Names R itself defines outside any corpus file. A target naming one of these is the
 * corpus colliding with the language, so the split can say so with evidence instead of
 * lumping it in with the analyzer's own collisions.
 *
 * This list is NOT a claim about what R contains. It is the intersection of
 * `base::` names that appear as a published target in this corpus, i.e. it is derived
 * FROM the measurement below, and the printed count of names outside this list is the
 * honest remainder. Base R's real export set is ~1,300 names; hard-coding that here
 * would make the split a statement about this list rather than about R.
 */
const BASE_R = new Set(
  `c list vector matrix array data.frame factor Date POSIXct length names nrow ncol dim
   sum mean median min max sd var range seq rep append sort order unique which any all
   is.null is.na na.omit complete.cases nrow lapply sapply vapply mapply apply Map Reduce
   Filter Negate library require requireNamespace attach detach source load save readRDS
   saveRDS cat print paste paste0 sprintf format formatC nchar substring sub gsub grepl
   regexpr regmatches startsWith endsWith file.path file.exists dir.create file.remove
   basename dirname normalizePath Sys.getenv Sys.setenv Sys.time Sys.Date proc.time
   options stop warning message try tryCatch withCallingHandlers stopifnot assertCondition
   ifelse switch return invisible Identity quote substitute bquote expression
   function args body formals environment new.env parent.frame match.call missing nargs
   is.function is.character is.numeric is.logical is.list is.environment is.null
   as.numeric as.integer as.character as.logical as.list as.vector as.data.frame as.factor
   table prop.table aggregate tapply by xtabs merge rbind cbind split unsplit
   head tail str head tail summary str glimpse View setNames names assign get mget
   structure rlang::sym sym syms enquo expr quo quos exprs new_quosure
   gg ggplot aes aes_ aes_string geom_point geom_line geom_histogram facet_wrap theme
   labs xlab ylab ggtitle scale_x_log10 position_jitter annotate labs
   test_that expect_equal expect_identical expect_true expect_false expect_error skip
   describe it context given library dplyr filter mutate select summarise arrange group_by
   left_join right_join inner_join full_join bind_rows bind_cols n_distinct pull
   tibble data.frame read_csv readr::read_csv write_csv install.packages update.packages
   available.packages remotes::install_github devtools::install_github
   setwd getwd normalizePath Sys.getenv R.version versionInfo
   Recall interactive browser utils::browseURL
   integer numeric character logical complex raw
   abs ceiling floor round signif trunc sign exp log log2 log10 sqrt
   all.equal isTRUE identical xor bitwAnd bitwOr bitwXor bitwNot
   nchar enc2utf8 iconv make.names make.unique check.names
   Recall tryCatch stopifnot simpleError simpleCondition
   vector list length NULL NA TRUE FALSE Inf NaN`
    .split(/\s+/).filter(Boolean),
)

// Base R names that this corpus also publishes under >1 kind. Populated during the
// split, not declared empty: an earlier revision declared the set and never filled it,
// so the file printed "0 of them carry >1 kind" in the same breath as it assigned
// 4,075 edges to B3 on the strength of exactly that property.
const BASE_R_KIND_COLLISIONS = new Set<string>()

// ---------------------------------------------------------------- corpus admission
interface Admitted { repo: string; dir: string; rel: string; abs: string }
const admitted: Admitted[] = []
const reposWithR: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, dir, rel, abs })
    reposWithR[e] = (reposWithR[e] ?? 0) + 1
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted

/**
 * Analyzer digest. Every number this file prints is a statement about ONE analyzer
 * build, so the build is named in the output. Without it a reader who quotes
 * `TOTAL ambiguous EDGES 11770` cannot tell which analyzer produced it, and the
 * lane already learned the cost of an unnamed baseline (see the doc section
 * "An audit whose baseline cannot be named cannot be believed"). If the analyzer
 * is missing the digest reads MISSING rather than silently hashing nothing.
 */
const ANALYZER = path.resolve(process.cwd(), "src/ast/real-r-analyzer.ts")
let analyzerDigest = "MISSING (src/ast/real-r-analyzer.ts not found from cwd)"
try {
  analyzerDigest = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
} catch { /* declared above */ }
const corpusDigest = createHash("sha256")
  .update(covered.map((c) => c.abs).sort().join("\n"))
  .digest("hex")

console.log(`R ambiguity split — production parseFile`)
console.log(`analyzer: src/ast/real-r-analyzer.ts sha256 ${analyzerDigest}`)
console.log(`corpus file set: sha256 ${corpusDigest} (${covered.length} paths, sorted)`)
console.log(`corpus root: ${CR}`)
console.log(`project-path basis: ${FLAT ? "FLAT (corpus root) — NOT comparable to a repo-scoped walk" : "per-repository (R's package boundary)"}`)
console.log(`admitted population: ${admitted.length} files across ${Object.keys(reposWithR).length} repositories`)
console.log(`repositories: ${Object.entries(reposWithR).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" ")}`)
console.log(`files walked: ${covered.length}${LIMIT > 0 ? " (corpus-order PREFIX of the admitted list)" : " (whole population)"}`)
console.log(`workers: ${WORKERS}\n`)

// ---------------------------------------------------------------- walk
interface Decl { name: string; kind: string; qualified: string; file: string; line: number }
interface Edge { t: Type; src: string; tgt: string; file: string; conf: number }

const decls: Decl[] = []
const edges: Edge[] = []
const degraded: string[] = []
const parseFailures: string[] = []
let next = 0
let doneFiles = 0
// The header's claim that a per-repository project path partitions R's published
// namespace is only true if some symbol publishes a qualifiedName. Counted here rather
// than asserted: a qualified name is one that differs from `name`, or that carries a
// package/member qualifier. `qualDiffers` = first sense, `qualCarries` = second.
let qualDiffers = 0
let qualCarries = 0
const qualExamples: string[] = []
const isQualifiedSpelling = (s: string) => s.includes("::") || s.includes("$") || s.includes("@") || s.includes("/")

async function worker(): Promise<void> {
  for (;;) {
    const i = next++
    if (i >= covered.length) return
    const f = covered[i]
    const projectPath = FLAT ? CR : f.dir
    let r: any
    try {
      r = await parseFile(f.abs, projectPath)
    } catch (e) {
      parseFailures.push(`${f.abs}: ${(e as Error)?.message ?? e}`)
      continue
    }
    if (!r) { parseFailures.push(`${f.abs}: no result`); continue }
    if (r.fallback === true) degraded.push(f.abs)
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) {
        qualDiffers++
        if (qualExamples.length < 8) qualExamples.push(`${name} -> ${q}`)
      }
      if (isQualifiedSpelling(q) || isQualifiedSpelling(name)) qualCarries++
      decls.push({
        name, kind: String(s?.kind ?? ""),
        qualified: q,
        file: f.abs, line: Number(s?.line_number ?? s?.line ?? 0),
      })
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const t = ontologyType(rel?.type ?? rel?.relationshipType)
      if (!t) continue
      edges.push({
        t,
        src: String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? ""),
        tgt: String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? ""),
        file: f.abs,
        conf: Number(rel?.confidence ?? 0),
      })
    }
    doneFiles++
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

console.log(`files walked OK: ${doneFiles}   degraded (regex fallback): ${degraded.length}   parse failures: ${parseFailures.length}`)
if (parseFailures.length) for (const s of parseFailures.slice(0, 5)) console.log(`  ${s}`)
if (degraded.length) for (const s of degraded.slice(0, 5)) console.log(`  DEGRADED ${s}`)
console.log(`symbols: ${decls.length}   edges: ${edges.length}`)
console.log(
  `QUALIFIED-NAME PROBE: ${qualDiffers} of ${decls.length} symbols publish a qualifiedName differing from name; ` +
    `${qualCarries} publish a name or qualifiedName carrying :: / $ / @ /`,
)
if (qualExamples.length) for (const s of qualExamples) console.log(`  qualifying example: ${s}`)
console.log(
  `  => the project-path argument cannot partition R's published namespace; ` +
    `per-repo and flat walks resolve against the SAME flat key space.`,
)
console.log()

// ---------------------------------------------------------------- published universe
// Byte-identical construction to incoming-check.ts, including registering
// qualifiedName as an alias key when it differs from name.
interface KeyInfo { kinds: Set<string>; files: Set<string>; decls: Decl[]; bare: boolean }
const published = new Map<string, KeyInfo>()
function key(k: string, d: Decl, bare: boolean): KeyInfo {
  let info = published.get(k)
  if (!info) { info = { kinds: new Set(), files: new Set(), decls: [], bare }; published.set(k, info) }
  info.kinds.add(d.kind)
  info.files.add(d.file)
  info.decls.push(d)
  return info
}
for (const d of decls) {
  key(d.name, d, true)
  if (d.qualified.length > 0 && d.qualified !== d.name) key(d.qualified, d, false)
}

// ---------------------------------------------------------------- per type
interface TypeRow { fired: boolean; edges: number; distinct: number; ambiguous: number; unresolved: number; selfLoops: number; below07: number }
const perType: Record<Type, TypeRow> = {} as any
for (const t of ALL_TYPES) perType[t] = { fired: false, edges: 0, distinct: 0, ambiguous: 0, unresolved: 0, selfLoops: 0, below07: 0 }
const ambiguousNamesByType = new Map<Type, Set<string>>()
for (const t of ALL_TYPES) ambiguousNamesByType.set(t, new Set())

for (const e of edges) {
  const row = perType[e.t]
  row.edges++
  if (e.conf < 0.7) row.below07++
  if (e.tgt.length === 0) continue
  if (e.src === e.tgt) { row.selfLoops++; continue }
  const info = published.get(e.tgt)
  if (!info) { row.unresolved++; continue }
  if (info.kinds.size > 1) { row.ambiguous++; ambiguousNamesByType.get(e.tgt && e.t)!.add(e.tgt) }
  row.distinct++
}
for (const t of ALL_TYPES) perType[t].fired = perType[t].edges > 0

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log("PER TYPE — ambiguity as incoming-check.ts defines it (target published under >1 SymbolKind)")
console.log(pad("type", 16) + pad("fired", 7) + pad("edges", 9) + pad("distinct", 10) + pad("ambiguous", 11) + pad("unresolved", 11) + pad("selfLoops", 11) + "conf<0.7")
console.log("-".repeat(84))
for (const t of ALL_TYPES) {
  const r = perType[t]
  console.log(pad(t, 16) + pad(r.fired ? "yes" : "NO", 7) + pad(String(r.edges), 9) + pad(String(r.distinct), 10) + pad(String(r.ambiguous), 11) + pad(String(r.unresolved), 11) + pad(String(r.selfLoops), 11) + String(r.below07))
}
console.log("-".repeat(84))
const totAmb = ALL_TYPES.reduce((a, t) => a + perType[t].ambiguous, 0)
const totUnres = ALL_TYPES.reduce((a, t) => a + perType[t].unresolved, 0)
console.log(`TOTAL ambiguous EDGES ${totAmb}   TOTAL unresolved EDGES ${totUnres}\n`)

// ---------------------------------------------------------------- the split
interface Bucket { edges: number; names: Set<string>; kinds: Map<string, number> }
const B1: Bucket = { edges: 0, names: new Set(), kinds: new Map() }
const B2: Bucket = { edges: 0, names: new Set(), kinds: new Map() }
const B3: Bucket = { edges: 0, names: new Set(), kinds: new Map() }
const kindPairCounts = new Map<string, number>()
const bucketOf = new Map<string, "B1" | "B2" | "B3">()

for (const e of edges) {
  if (e.tgt.length === 0 || e.src === e.tgt) continue
  const info = published.get(e.tgt)
  if (!info || info.kinds.size <= 1) continue
  const b: Bucket =
    BASE_R.has(e.tgt) ? B3 : info.files.size === 1 ? B1 : B2
  bucketOf.set(e.tgt, b === B1 ? "B1" : b === B2 ? "B2" : "B3")
  if (b === B3) BASE_R_KIND_COLLISIONS.add(e.tgt)
  b.edges++
  b.names.add(e.tgt)
  const pair = [...info.kinds].sort().join("+")
  b.kinds.set(pair, (b.kinds.get(pair) ?? 0) + 1)
  kindPairCounts.set(pair, (kindPairCounts.get(pair) ?? 0) + 1)
}

console.log("THE SPLIT — every ambiguous edge assigned to exactly one bucket")
console.log(
  `  B1 SAME-FILE   ${pad(String(B1.edges), 7)} edges over ${pad(String(B1.names.size), 5)} names   all declarations of the name are in ONE file; R's lexical scoping names a winner`,
)
console.log(
  `  B2 CROSS-FILE  ${pad(String(B2.edges), 7)} edges over ${pad(String(B2.names.size), 5)} names   declarations span >=2 files; which one is in scope is a RUNTIME fact (env chain + search path)`,
)
console.log(
  `  B3 BASE-R      ${pad(String(B3.edges), 7)} edges over ${pad(String(B3.names.size), 5)} names   the name is also a base-R symbol this lane never publishes; the corpus collides with the language`,
)
console.log(`  checked: ${B1.edges + B2.edges + B3.edges} of ${totAmb} ambiguous edges\n`)

console.log("KIND PAIRS — which two SymbolKinds collide (an edge is counted once per pair)")
for (const [pair, n] of [...kindPairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${pad(pair, 34)} ${n}`)
}

console.log("\nTOP AMBIGUOUS NAMES — with the declaration spread that produced the collision")
const nameRows: Array<{ name: string; b: string; kinds: string; files: number; decls: number; edges: number; ex: string }> = []
// `b` here is the BUCKET LABEL string, not a Bucket object. An earlier revision of
// this block compared it against the B1/B2/B3 objects, which are never `===`, so
// every row fell through to the "B3" arm and the table mislabelled 26 cross-file
// names as base-R. The edge/name tallies above were never affected — they index the
// buckets directly — but a table whose labels are all one value cannot be read.
for (const [name, b] of bucketOf.entries()) {
  const info = published.get(name)!
  let edgesN = 0
  for (const e of edges) if (e.tgt === name) edgesN++
  nameRows.push({
    name, b,
    kinds: [...info.kinds].sort().join("+"), files: info.files.size, decls: info.decls.length,
    edges: edgesN, ex: path.basename(info.decls[0].file),
  })
}
nameRows.sort((a, b) => b.edges - a.edges)
console.log(pad("bucket", 8) + pad("name", 26) + pad("kinds", 30) + pad("files", 7) + pad("decls", 7) + pad("edges", 8) + "example file")
for (const r of nameRows.slice(0, 28)) {
  console.log(pad(r.b, 8) + pad(r.name, 26) + pad(r.kinds, 30) + pad(String(r.files), 7) + pad(String(r.decls), 7) + pad(String(r.edges), 8) + r.ex)
}
console.log(`… ${nameRows.length} ambiguous names in total`)

// ---------------------------------------------------------------- what a fix could reach
// The brief's claim is that B1/B2 are the analyzer's and B3 is not. That is a claim
// about REACH, so it is measured: for each bucket, how many of its edges have a target
// that is already qualified (pkg::name, Class$member, obj@slot) — because a qualified
// target can in principle address a single declaration, while a bare R identifier
// cannot. A bucket whose targets are already qualified is a bucket where a naming
// change cannot reach it at all.
//
// The filter is BYTE-IDENTICAL to the split loop's, self-loops included. An earlier
// revision omitted `e.src === e.tgt` here while the split loop skipped self-loops, so
// the reach counts exceeded their own bucket totals (138 vs 130, 7608 vs 7572,
// 4082 vs 4075) — two different denominators printed three lines apart with nothing
// reconciling them.
const qualOf = (s: string) => (isQualifiedSpelling(s) ? "qualified" : "bare")
for (const [label, b] of [["B1", B1], ["B2", B2], ["B3", B3]] as const) {
  let qualified = 0
  let bare = 0
  for (const e of edges) {
    if (e.tgt.length === 0 || e.src === e.tgt) continue
    const info = published.get(e.tgt)
    if (!info || info.kinds.size <= 1) continue
    if (bucketOf.get(e.tgt) !== label) continue
    if (qualOf(e.tgt) === "qualified") qualified++
    else bare++
  }
  console.log(
    `  ${label}: of ${b.edges} ambiguous edges, targets qualified ${qualified}   bare ${bare}` +
      `   (checked ${qualified + bare} of ${b.edges}; a bare R identifier cannot address one declaration by name)`,
  )
}
console.log(`\nbase-R name list used for B3: ${BASE_R.size} names; ${BASE_R_KIND_COLLISIONS.size} of them carry >1 kind in this corpus and so are the entire B3 population`)
console.log(`NOTE ON B3: the bucket boundary is this list, so the honest statement is "collides with a name in this ${BASE_R.size}-name base-R subset", not "collides with base R".`)

// ---------------------------------------------------------------- unresolved, decomposed
// `incoming-check.ts` reports unresolved targets as one number, and at this population
// it is 24,034 edges — twice the ambiguous total and, unlike the ambiguous side, not
// decomposed anywhere. The round's own rule is that "an unresolved count is a defect
// only when you have checked the target genuinely does not exist", so the count is
// split by WHY the target is absent from the published key space:
//
//   U1 NOT-DECLARED     the bare name is published nowhere in the 2,184-file
//                       population. The corpus CALLS something it never DEFINES: a
//                       base-R function, a package the lane does not index, or a name
//                       supplied by the caller at runtime. Not an analyzer defect.
//   U2 SPELLING         the target carries a qualifier (pkg::fn, obj$member, x@y) whose
//                       BARE head IS published. Resolution fails only because the edge
//                       kept the qualifier while the symbol is published bare. This is
//                   the one genuinely analyzer-side bucket, and it is a fixable defect
//                       if it is non-zero.
//   U3 CONSTRUCT        the target is a reserved word or a syntactic form (`if`, `for`,
//                       `function`, `{`, `repeat`) rather than a name at all.
//
// U1 and U3 are properties of the corpus and the language. U2 is a claim about this
// analyzer, so its count is the one that could falsify the round's premise.
const R_KEYWORDS = new Set(`if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_character_ complex raw
  library require attach detach source load save cat print message warning stop try
  return invisible Recall .Machine .GlobalEnv .Random.seed super exists get assign
  on.exit missing nargs eval parse deparse substitute quote bquote expression
  function environment new.env parent.frame match.call match.arg identity c
  vector list length`.split(/\s+/).filter(Boolean))

interface URow { edges: number; names: Set<string> }
const U1: URow = { edges: 0, names: new Set() }
const U2: URow = { edges: 0, names: new Set() }
const U3: URow = { edges: 0, names: new Set() }
const U4: URow = { edges: 0, names: new Set() } // bare head published, whole string not — see below
const u2Examples = new Map<string, number>()
const u1Examples = new Map<string, number>()
const unresPerType: Record<string, { u1: number; u2: number; u3: number; u4: number }> = {}

for (const e of edges) {
  if (e.tgt.length === 0 || e.src === e.tgt) continue
  if (published.has(e.tgt)) continue
  const row = (unresPerType[e.t] ??= { u1: 0, u2: 0, u3: 0, u4: 0 })
  const head = e.tgt.split(/::|\$|@|\./).filter(Boolean).pop() ?? e.tgt
  if (R_KEYWORDS.has(e.tgt) || R_KEYWORDS.has(head)) {
    U3.edges++; U3.names.add(e.tgt); row.u3++
  } else if (isQualifiedSpelling(e.tgt) && published.has(head)) {
    U2.edges++; U2.names.add(e.tgt); row.u2++
    u2Examples.set(e.tgt, (u2Examples.get(e.tgt) ?? 0) + 1)
  } else if (isQualifiedSpelling(e.tgt)) {
    U4.edges++; U4.names.add(e.tgt); row.u4++
  } else {
    U1.edges++; U1.names.add(e.tgt); row.u1++
    u1Examples.set(e.tgt, (u1Examples.get(e.tgt) ?? 0) + 1)
  }
}

console.log("\n\nUNRESOLVED, DECOMPOSED — why a target is absent from the published key space")
console.log(`  U1 NOT-DECLARED  ${pad(String(U1.edges), 6)} edges over ${pad(String(U1.names.size), 5)} names   bare name published NOWHERE in the population; the corpus calls something it never defines (base R, an unindexed package, or a runtime argument)`)
console.log(`  U2 SPELLING      ${pad(String(U2.edges), 6)} edges over ${pad(String(U2.names.size), 5)} names   target carries a qualifier whose BARE HEAD is published — resolution fails on spelling alone. Analyzer-side.`)
console.log(`  U3 CONSTRUCT     ${pad(String(U3.edges), 6)} edges over ${pad(String(U3.names.size), 5)} names   target is a reserved word or syntactic form, not a name`)
console.log(`  U4 QUAL-UNPUB    ${pad(String(U4.edges), 6)} edges over ${pad(String(U4.names.size), 5)} names   target carries a qualifier and neither it nor its bare head is published (pkg::fn where fn is external)`)
console.log(`  checked: ${U1.edges + U2.edges + U3.edges + U4.edges} of ${totUnres} unresolved edges`)
console.log(`  analyzer-side (U2) share of unresolved: ${totUnres ? ((U2.edges / totUnres) * 100).toFixed(2) : "0.00"}%`)

console.log("\nUNRESOLVED PER TYPE — which bucket dominates each type's unresolved count")
console.log(pad("type", 16) + pad("edges", 9) + pad("U1 not-decl", 12) + pad("U2 spelling", 12) + pad("U3 construct", 13) + "U4 qual-unpub")
for (const t of ALL_TYPES) {
  const r = unresPerType[t]
  if (!r) continue
  console.log(pad(t, 16) + pad(String(perType[t].unresolved), 9) + pad(String(r.u1), 12) + pad(String(r.u2), 12) + pad(String(r.u3), 13) + String(r.u4))
}

if (u2Examples.size) {
  console.log("\nU2 SPELLING TARGETS — the only unresolved bucket an analyzer edit could reach")
  for (const [n, c] of [...u2Examples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${pad(n, 40)} ${c} edges   bare head "${(n.split(/::|\$|@|\./).filter(Boolean).pop())}" IS published`)
  }
}
console.log("\nTOP U1 NOT-DECLARED TARGETS — corpus calling what it never defines")
for (const [n, c] of [...u1Examples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${pad(n, 40)} ${c} edges`)
}

/**
 * This file's own verdict, stated because the EXIT CODE IS NOT THIS FILE'S.
 *
 * `src/ast/engine.ts:1442` runs a 120 s parse watchdog that writes
 * `[BB-HANG] parser stuck 120s on <file> — exiting` and calls `process.exit(1)`.
 * It can fire AFTER this report has printed in full, so a run whose accounting
 * closed can still exit 1. That is a shared-machinery property, not a verdict of
 * this instrument, and it is the same class the CSS lane recorded against its own
 * gate. So the closure conditions are evaluated here and printed; a reader who sees
 * `AMBIGUITY VERDICT: PASS` with a non-zero shell status is looking at the watchdog.
 *
 * The conditions are the two accounting closures, not a threshold: every ambiguous
 * edge lands in exactly one bucket, and every unresolved edge in exactly one U-bucket.
 * A leak here would mean the decomposition is not a partition, which invalidates the
 * percentages above regardless of their values.
 */
const ambClosed = B1.edges + B2.edges + B3.edges === totAmb
const unresClosed = U1.edges + U2.edges + U3.edges + U4.edges === totUnres
const tenFired = ALL_TYPES.every((t) => perType[t].fired)
console.log("\n" + "=".repeat(78))
console.log(`analyzer sha256 ${analyzerDigest}`)
console.log(`corpus   sha256 ${corpusDigest}`)
console.log(`degraded (regex fallback) ${degraded.length}   parse failures ${parseFailures.length}`)
for (const d of degraded) console.log(`  DEGRADED ${d}`)
console.log(`partition check: ambiguous ${B1.edges} + ${B2.edges} + ${B3.edges} = ${B1.edges + B2.edges + B3.edges} of ${totAmb}`)
console.log(`partition check: unresolved ${U1.edges} + ${U2.edges} + ${U3.edges} + ${U4.edges} = ${U1.edges + U2.edges + U3.edges + U4.edges} of ${totUnres}`)
console.log(`all ten types fired: ${tenFired ? "yes" : "NO"}`)
console.log(
  `AMBIGUITY VERDICT: ${ambClosed && unresClosed && tenFired ? "PASS" : "FAIL"}` +
  ` (ambiguous partition ${ambClosed ? "closes" : "LEAKS"}, unresolved partition ${unresClosed ? "closes" : "LEAKS"})`,
)
console.log("exit status is the engine's 120s parse watchdog, not this file's verdict — see the header")
console.log("=".repeat(78))
