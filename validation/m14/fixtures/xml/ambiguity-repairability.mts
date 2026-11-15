/**
 * AMBIGUITY REPAIRABILITY — the falsifiable half of `ambiguity-split.mts`.
 *
 * ## The question
 *
 * `ambiguity-split.mts` measured the split on 600 files / draw `099e7a868f7b73ee`:
 *
 *   B1 same-file 500 · B2 cross-file 9,211 · B3 cross-kind 4,369
 *
 * The round brief calls B1 and B2 "yours to repair" and B3 a finding about the
 * published-name contract. Repairing them needs a rule that makes a name resolve to
 * exactly ONE declaration, and the rule has to be stated so a non-zero count of a
 * named shape can overturn it. A rule with no reachable overturn condition is
 * decorative, so this file computes the overturn counts for each candidate rule
 * BEFORE any of them is implemented.
 *
 * ## Why there is a candidate at all
 *
 * `src/ast/real-xml-analyzer.ts:780` and `:934` publish a symbol under
 * `identity = ownerName ? ownerName + "\0" + name : name`, and set
 * `qualifiedName = ownerName ? ownerName + "." + name : name`. So the analyzer already
 * computes a two-part identity and already publishes it — and then hands the graph the
 * BARE `name`, because `addRelationship` (`:633`) takes two strings and every one of its
 * ~20 call sites passes a name.
 *
 * The store can already read the qualified form. `src/ast/parallel-indexer.ts:3435-3437`
 * tries, in order, `name === target`, `qualifiedName === target`,
 * `target.endsWith(":" + qualifiedName)`, `qualifiedName.endsWith("." + leaf)`, and
 * `:3774` / `:4001` join `brain_relationship.target_external` against a
 * `qualified_name PRIMARY KEY` temp table. So a qualified endpoint is not unreadable to
 * the indexer — which makes "just qualify the endpoints" a TESTABLE rule rather than a
 * guess.
 *
 * ## The three candidate rules, and what would overturn each
 *
 *   R1 qualify-both    emit `Owner.child` on both ends.
 *                       Overturned by: any edge whose endpoint qualified name is still
 *                       published by >1 declaration, counted as `R1_not_unique`.
 *   R2 owner-pair      emit the bare child but let the store bind `(source, target)` as a
 *                       PAIR, which is what `contains` already means.
 *                       Overturned by: any edge where >1 declaration of the target name
 *                       carries that same owner, counted as `R2_not_unique`.
 *   R3 same-file-first scope the target to the edge's own file before matching.
 *                       Overturned by: any edge whose target has >1 declaration INSIDE the
 *                       edge's own file, counted as `R3_not_unique`.
 *
 * ## What is NOT measured here
 *
 * This file does not claim any rule IMPROVES anything. It counts what each rule would
 * leave unresolved. A rule that leaves 90 % of the ambiguous edges ambiguous is not a
 * repair, and the numbers here are what say so. Whether the store's ORDER BY picks the
 * right one of several remaining candidates is a property of
 * `parallel-indexer.ts`, is reported as `storeOrderIsNotModelled`, and is not claimed.
 *
 * ## Discipline
 *
 * - Entries come from `parseFile`, the production pool-worker entry point. This lane
 *   deleted its own parser once already (§8 item 8) because an instrument that builds
 *   one truncates silently and its own coverage claim becomes unfalsifiable.
 * - Same corpus draw as `ambiguity-split.mts`, so the before/after is comparable: the
 *   draw fingerprint is printed and asserted equal to `099e7a868f7b73ee`.
 * - ZERO REGEX. String work is `splitOnChars` / `indexOf` / `slice`, like every
 *   instrument in this lane.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/xml/ambiguity-repairability.mts [--files N]
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "fs"
import * as path from "path"
import { execFileSync } from "child_process"
import { createHash } from "crypto"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WANT = Number(process.env.BB_XML_FILES ?? 600)
/** Mirrors `ambiguity-split.mts` and `ontology-census.mts`: no repo takes more than its share. */
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
const OUT = process.env.BB_XML_OUT

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

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

/** The draw `ambiguity-split.mts` was measured on, at 600 files. */
const EXPECTED_DRAW = "099e7a868f7b73ee"

// ─────────────────────────────────────────────────────────── corpus discovery
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const byRepo = new Map<string, FileRow[]>()
for (const e of readdirSync(CR).sort()) {
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
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    rows.push({ repo: e, dir, rel, abs })
  }
  if (rows.length > 0) byRepo.set(e, rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
}

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

const DRAW = (() => {
  const h = createHash("sha256")
  for (const f of sample) {
    let size = -1
    try { size = statSync(f.abs).size } catch {}
    h.update(`${f.repo}/${f.rel} ${size}\n`)
  }
  return h.digest("hex").slice(0, 16)
})()

// ─────────────────────────────────────────────────────────── parse and index
/** One declaration: the tuple every candidate rule is tested against. */
type Decl = {
  file: string
  name: string
  qualified: string
  owner: string
  kind: string
  startLine: number
  endLine: number
}

const declsByName = new Map<string, Decl[]>()
const declsByFile = new Map<string, Decl[]>()
const rels: { type: Type; src: string; tgt: string; file: string }[] = []

let symbols = 0
let degraded = 0
let parseFailures = 0

for (const f of sample) {
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch {
    parseFailures++
    continue
  }
  if (!r) { parseFailures++; continue }
  if (r.fallback === true) degraded++
  const fileKey = `${f.repo}/${f.rel}`

  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const d: Decl = {
      file: fileKey,
      name,
      qualified: String(s?.qualifiedName ?? ""),
      owner: String(s?.ownerName ?? ""),
      kind: String(s?.kind ?? ""),
      startLine: Number(s?.startLine ?? s?.line ?? 0),
      endLine: Number(s?.endLine ?? 0),
    }
    let byName = declsByName.get(name)
    if (!byName) { byName = []; declsByName.set(name, byName) }
    byName.push(d)
    let byFile = declsByFile.get(fileKey)
    if (!byFile) { byFile = []; declsByFile.set(fileKey, byFile) }
    byFile.push(d)
  }

  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    rels.push({
      type: label,
      src: String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? ""),
      tgt: String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? ""),
      file: fileKey,
    })
  }
}

// ─────────────────────────────────────────────────────────── candidate rules
type RuleVerdict = {
  /** Edges this rule would leave ambiguous. */
  notUnique: number
  /** Edges this rule would make unique out of an ambiguous edge. */
  newlyUnique: number
  /** Edges that were already unique and stay unique. */
  alreadyUnique: number
}

type TypeRow = RuleVerdict & {
  fired: boolean
  edges: number
  /** Ambiguness judged on the bare published name — `ambiguity-split.mts`'s condition. */
  ambiguousByBareName: number
  unresolved: number
  /** R1/R2/R3 applied only to the edges R1 says it can repair. */
  R1_leaves: number
  R2_leaves: number
  R3_leaves: number
}

const blank = (): TypeRow => ({
  fired: false, edges: 0, ambiguousByBareName: 0, unresolved: 0,
  notUnique: 0, newlyUnique: 0, alreadyUnique: 0,
  R1_leaves: 0, R2_leaves: 0, R3_leaves: 0,
})
const perType: Record<string, TypeRow> = {}
for (const t of ALL_TYPES) perType[t] = blank()

const distinct = <T>(xs: T[]): T[] => [...new Set(xs)]

for (const e of rels) {
  const row = perType[e.type]
  row.edges++
  if (e.tgt.length === 0 || e.src === e.tgt) continue

  const cands = declsByName.get(e.tgt)
  if (!cands || cands.length === 0) { row.unresolved++; continue }

  // ── the condition `ambiguity-split.mts` reported: >1 DECLARATION of the name
  const ambiguousByName = cands.length > 1
  if (ambiguousByName) row.ambiguousByBareName++

  // ── R1: qualify both ends. Unique iff the target name is published under exactly
  //    one distinct qualified name across the whole draw.
  const qnames = distinct(cands.map((c) => (c.qualified.length > 0 ? c.qualified : c.name)))
  const r1Unique = qnames.length === 1
  if (ambiguousByName) { if (r1Unique) row.newlyUnique++; else row.R1_leaves++ }

  // ── R2: bind (source, target) as a pair. Unique iff exactly one declaration of the
  //    target name is OWNED BY THE EDGE'S SOURCE.
  const owned = cands.filter((c) => c.owner.length > 0 && c.owner === e.src)
  const r2Unique = owned.length === 1
  if (ambiguousByName) { if (r2Unique) row.newlyUnique++; else row.R2_leaves++ }

  // ── R3: scope to the edge's own file first. Unique iff exactly one declaration of
  //    the target name lives in that file.
  const inFile = cands.filter((c) => c.file === e.file)
  const r3Unique = inFile.length === 1
  if (ambiguousByName) { if (r3Unique) row.newlyUnique++; else row.R3_leaves++ }

  if (!ambiguousByName) row.alreadyUnique++
  else if (!r1Unique && !r2Unique && !r3Unique) row.notUnique++
}

for (const t of ALL_TYPES) perType[t].fired = perType[t].edges > 0

// ─────────────────────────────────────────────────────────── the repairable surface
/**
 * Per distinct ambiguous target name: the counts each rule would have to beat, and
 * the shape of the collision. `topByEdges` is what decides which bucket to work on.
 */
type NameRow = {
  name: string
  edges: number
  declarations: number
  files: number
  kinds: number
  distinctQualifiedNames: number
  distinctOwners: number
  /** The largest number of declarations sharing ONE qualified name — the floor R1 hits. */
  maxDeclsPerQualifiedName: number
  /** The largest number of declarations owned by ONE owner — the floor R2 hits. */
  maxDeclsPerOwner: number
}
const byName = new Map<string, NameRow>()
for (const e of rels) {
  if (e.tgt.length === 0 || e.src === e.tgt) continue
  const cands = declsByName.get(e.tgt)
  if (!cands || cands.length <= 1) continue
  let row = byName.get(e.tgt)
  if (!row) {
    const q = new Map<string, number>()
    const o = new Map<string, number>()
    for (const c of cands) {
      const qk = c.qualified.length > 0 ? c.qualified : c.name
      q.set(qk, (q.get(qk) ?? 0) + 1)
      if (c.owner.length > 0) o.set(c.owner, (o.get(c.owner) ?? 0) + 1)
    }
    row = {
      name: e.tgt,
      edges: 0,
      declarations: cands.length,
      files: distinct(cands.map((c) => c.file)).length,
      kinds: distinct(cands.map((c) => c.kind)).length,
      distinctQualifiedNames: q.size,
      distinctOwners: o.size,
      maxDeclsPerQualifiedName: Math.max(0, ...q.values()),
      maxDeclsPerOwner: o.size === 0 ? 0 : Math.max(0, ...o.values()),
    }
    byName.set(e.tgt, row)
  }
  row.edges++
}
const nameRows = [...byName.values()]
const edgeTotal = rels.reduce((a, e) => a + (e.tgt.length > 0 && e.src !== e.tgt ? 1 : 0), 0)

/** Per name: does ANY of the three rules make it unique? That is the repairable set. */
const repairedBySomeRule = nameRows.filter(
  (r) => r.distinctQualifiedNames === 1 || r.maxDeclsPerOwner === 1 || r.files >= r.declarations,
)
const edgesRepairedBySomeRule = repairedBySomeRule.reduce((a, r) => a + r.edges, 0)

const sum = (f: (r: TypeRow) => number) => ALL_TYPES.reduce((a, t) => a + f(perType[t]), 0)

const report = {
  instrument: "ambiguity-repairability",
  draw: DRAW,
  drawMatchesAmbiguitySplit: DRAW === EXPECTED_DRAW,
  expectedDraw: EXPECTED_DRAW,
  filesSampled: sample.length,
  reposInDraw: new Set(sample.map((f) => f.repo)).size,
  symbols,
  declarationsIndexed: [...declsByName.values()].reduce((a, d) => a + d.length, 0),
  degradedParses: degraded,
  parseFailures,
  distinctDeclaredNames: declsByName.size,
  edgesWithNonEmptyNonLoopTarget: edgeTotal,
  storeOrderIsNotModelled:
    "which of several remaining candidates parallel-indexer.ts picks is its ORDER BY, not this file's; " +
    "no rule below is claimed to select a unique symbol in the store, only to leave at most one candidate",
  global: {
    ambiguousByBareName: sum((r) => r.ambiguousByBareName),
    alreadyUnique: sum((r) => r.alreadyUnique),
    unresolved: sum((r) => r.unresolved),
    /** Left ambiguous by R1 — the falsifiable number that decides whether R1 is a repair. */
    R1_leaves: sum((r) => r.R1_leaves),
    R2_leaves: sum((r) => r.R2_leaves),
    R3_leaves: sum((r) => r.R3_leaves),
    /** Ambiguous and untouched by all three. */
    notUnique: sum((r) => r.notUnique),
  },
  perType,
  ambiguousNames: {
    count: nameRows.length,
    edges: nameRows.reduce((a, r) => a + r.edges, 0),
    R1_wouldBeUnique: nameRows.filter((r) => r.distinctQualifiedNames === 1).length,
    R2_wouldBeUnique: nameRows.filter((r) => r.maxDeclsPerOwner === 1).length,
    R3_wouldBeUnique: nameRows.filter((r) => r.files >= r.declarations).length,
    repairedBySomeRule: repairedBySomeRule.length,
    repairedBySomeRuleEdges: edgesRepairedBySomeRule,
    repairedBySomeRuleEdgePct: edgeTotal ? edgesRepairedBySomeRule / edgeTotal : 0,
    untouchedByEveryRule: nameRows.length - repairedBySomeRule.length,
    untouchedByEveryRuleEdges: edgeTotal - edgesRepairedBySomeRule,
  },
  topByEdges: [...nameRows].sort((a, b) => b.edges - a.edges).slice(0, 30),
}

if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pc = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)

console.log(`ambiguity repairability — xml, ${report.filesSampled} files, ${report.reposInDraw} repos, draw ${DRAW}`)
console.log(`draw matches ambiguity-split (${EXPECTED_DRAW}): ${report.drawMatchesAmbiguitySplit}`)
console.log(`symbols ${symbols}  declarations ${report.declarationsIndexed}  distinct names ${report.distinctDeclaredNames}  degraded ${degraded}  parseFailures ${parseFailures}`)
console.log("")
console.log(pad("type", 14) + pad("fired", 7) + pad("edges", 9) + pad("ambiguous", 11) + pad("R1leaves", 10) + pad("R2leaves", 10) + pad("R3leaves", 10) + "unres")
console.log("-".repeat(80))
for (const t of ALL_TYPES) {
  const r = perType[t]
  console.log(
    pad(t, 14) + pad(r.fired ? "yes" : "NO", 7) + pad(String(r.edges), 9) + pad(String(r.ambiguousByBareName), 11)
    + pad(String(r.R1_leaves), 10) + pad(String(r.R2_leaves), 10) + pad(String(r.R3_leaves), 10) + String(r.unresolved),
  )
}
console.log("-".repeat(80))
console.log("")
console.log(`ambiguous edges ${report.global.ambiguousByBareName} of ${edgeTotal} resolvable (${pc(report.global.ambiguousByBareName, edgeTotal)})`)
console.log(`  R1 qualify-both leaves  ${report.global.R1_leaves}  (${pc(report.global.R1_leaves, report.global.ambiguousByBareName)} still ambiguous)`)
console.log(`  R2 owner-pair  leaves   ${report.global.R2_leaves}  (${pc(report.global.R2_leaves, report.global.ambiguousByBareName)} still ambiguous)`)
console.log(`  R3 same-file  leaves    ${report.global.R3_leaves}  (${pc(report.global.R3_leaves, report.global.ambiguousByBareName)} still ambiguous)`)
console.log(`  untouched by all three  ${report.global.notUnique}`)
console.log("")
console.log(`ambiguous names ${report.ambiguousNames.count}; repaired by at least one rule ${report.ambiguousNames.repairedBySomeRule} (${report.ambiguousNames.edgesRepairedBySomeRuleEdges} edges, ${pc(report.ambiguousNames.repairedBySomeRuleEdges, edgeTotal)} of resolvable edges)`)
console.log(`  untouched by every rule ${report.ambiguousNames.untouchedByEveryRule} names / ${report.ambiguousNames.untouchedByEveryRuleEdges} edges`)
console.log("")
console.log("top ambiguous names by edge count:")
console.log(pad("name", 26) + pad("edges", 8) + pad("decls", 8) + pad("files", 8) + pad("kinds", 7) + pad("dQName", 9) + "maxPerQ")
for (const r of report.topByEdges.slice(0, 15)) {
  console.log(pad(r.name, 26) + pad(String(r.edges), 8) + pad(String(r.declarations), 8) + pad(String(r.files), 8) + pad(String(r.kinds), 7) + pad(String(r.distinctQualifiedNames), 9) + String(r.maxDeclsPerQualifiedName))
}