/**
 * WHY R1 FAILS — is `qualifiedName` missing, or is `ownerName` missing?
 *
 * `ambiguity-repairability.mts` measured, on the same 600-file draw
 * `099e7a868f7b73ee`:
 *
 *   fill    4,627 declarations   distinctQualifiedNames 1   distinctOwners 13
 *   width   1,721 declarations   distinctQualifiedNames 1   distinctOwners 13
 *   height  1,699 declarations   distinctQualifiedNames 1   distinctOwners 11
 *
 * Those three numbers cannot both be true if `qualifiedName = ownerName + "." + name`
 * (`src/ast/real-xml-analyzer.ts:790`, `:920`), because 13 distinct owners would give
 * 13+ distinct qualified names. So one of the two fields is not being written, and
 * WHICH one decides whether the repair is a one-line change or a rewrite:
 *
 *   - `ownerName` empty, `qualifiedName` empty  -> nothing to qualify with; the fix is
 *     to track the owning element, which is a design change.
 *   - `ownerName` SET, `qualifiedName` EMPTY    -> the identity already exists in the
 *     symbol and the graph is simply not given it; the fix is to publish it.
 *
 * This file counts the joint distribution over the whole draw, by kind, so the answer
 * is a population and not three names that happen to be at the top of a list. It also
 * counts what R1 would repair IF `qualifiedName` were populated everywhere, which is
 * the falsifiable projection: a rule whose projected repair rate is not computed before
 * it is implemented is a guess.
 *
 * ZERO REGEX. READ-ONLY with respect to the corpus.
 *
 *   npx tsx validation/m14/fixtures/xml/qualified-name-population.mts [--files N]
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "fs"
import * as path from "path"
import { execFileSync } from "child_process"
import { createHash } from "crypto"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WANT = Number(process.env.BB_XML_FILES ?? 600)
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
const OUT = process.env.BB_XML_OUT
const EXPECTED_DRAW = "099e7a868f7b73ee"

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

// ── corpus draw: identical method to `ambiguity-split.mts` so the draw matches
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

// ── parse
/** `ownerName`/`qualifiedName` presence classes. The classes are the answer. */
type Presence = "both" | "ownerOnly" | "qualifiedOnly" | "neither"
type Decl = {
  file: string
  name: string
  qualified: string
  owner: string
  kind: string
  presence: Presence
}

const decls: Decl[] = []
const declsByName = new Map<string, Decl[]>()
const rels: { type: Type; src: string; tgt: string }[] = []
let degraded = 0
let parseFailures = 0

for (const f of sample) {
  let r: any
  try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
  if (!r) { parseFailures++; continue }
  if (r.fallback === true) degraded++
  const fileKey = `${f.repo}/${f.rel}`
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const owner = String(s?.ownerName ?? "")
    const qualified = String(s?.qualifiedName ?? "")
    const d: Decl = {
      file: fileKey, name, qualified, owner,
      kind: String(s?.kind ?? ""),
      presence: owner.length > 0 && qualified.length > 0 ? "both"
        : owner.length > 0 ? "ownerOnly"
        : qualified.length > 0 ? "qualifiedOnly"
        : "neither",
    }
    decls.push(d)
    let a = declsByName.get(name)
    if (!a) { a = []; declsByName.set(name, a) }
    a.push(d)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    rels.push({
      type: label,
      src: String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? ""),
      tgt: String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? ""),
    })
  }
}

// ── Q1: the joint distribution, by kind
const byKind: Record<string, Record<Presence, number>> = {}
for (const d of decls) {
  let row = byKind[d.kind]
  if (!row) { row = { both: 0, ownerOnly: 0, qualifiedOnly: 0, neither: 0 }; byKind[d.kind] = row }
  row[d.presence]++
}
const overall: Record<Presence, number> = { both: 0, ownerOnly: 0, qualifiedOnly: 0, neither: 0 }
for (const d of decls) overall[d.presence]++

// ── Q2: THE PROJECTION. If `qualifiedName` were `owner + "." + name` wherever an owner
// exists, how many ambiguous edges become unique? This is falsifiable BEFORE the edit:
// `projectedR1Leaves` is the number the edit has to beat.
const projectedQualified = (d: Decl) =>
  d.presence === "both" ? d.qualified
    : d.owner.length > 0 ? `${d.owner}.${d.name}`
    : d.name

/**
 * THE PROJECTION FOR THE FIX THIS LANE CAN ACTUALLY MAKE.
 *
 * Measured on the draw, an attribute symbol carries `ownerName` and no
 * `qualifiedName` (`src/ast/real-xml-analyzer.ts:2285-2301` pushes neither), so
 * `parallel-indexer.ts:3038` falls back to the bare name and 83,454 `property`
 * symbols enter the store's `_res_qname` table under `fill`, `width`, `height` —
 * 4,627 of them named `fill`. Publishing `ownerName + "." + name` there is a
 * one-site edit, so it gets a projected number BEFORE the edit: an edit with no
 * projected number cannot be checked, and this lane has already shipped one claim
 * that way.
 *
 * `qualifiedEqualsName` is the class the first presence table could not see: it asks
 * only whether the field is EMPTY, and a symbol whose `qualifiedName` is the bare name
 * reads as `both`. Measured rather than assumed — 83,454 rows land here.
 */
const D1_QUALIFIED = (d: Decl) => (d.owner.length > 0 ? `${d.owner}.${d.name}` : d.qualified.length > 0 ? d.qualified : d.name)

const projectedQByName = new Map<string, Set<string>>()
for (const d of decls) {
  const q = projectedQualified(d)
  let s = projectedQByName.get(q)
  if (!s) { s = new Set(); projectedQByName.set(q, s) }
  s.add(d.file)
}

/** Largest candidate set a single target name presents to the reverse walk. */
const maxCandidates = new Map<string, number>()
for (const [n, a] of declsByName) maxCandidates.set(n, a.length)

let ambiguousEdges = 0
let resolvableEdges = 0
let unresolved = 0
let projectedUnique = 0
let projectedStillAmbiguous = 0
let d1Unique = 0
let d1StillAmbiguous = 0
let d1CandidateShrinkEdges = 0
let d1CandidateBefore = 0
let d1CandidateAfter = 0
const perType: Record<string, {
  edges: number; ambiguous: number; projectedUnique: number; projectedLeaves: number
  d1Unique: number; d1Leaves: number; unresolved: number
}> = {}
for (const t of ALL_TYPES) perType[t] = { edges: 0, ambiguous: 0, projectedUnique: 0, projectedLeaves: 0, d1Unique: 0, d1Leaves: 0, unresolved: 0 }

for (const e of rels) {
  if (e.tgt.length === 0 || e.src === e.tgt) continue
  const row = perType[e.type]
  row.edges++
  const cands = declsByName.get(e.tgt)
  if (!cands || cands.length === 0) { unresolved++; row.unresolved++; continue }
  resolvableEdges++
  if (cands.length <= 1) continue
  ambiguousEdges++
  row.ambiguous++
  const q = new Set(cands.map(projectedQualified))
  if (q.size === 1) { projectedUnique++; row.projectedUnique++ } else { projectedStillAmbiguous++; row.projectedLeaves++ }

  const q1 = new Set(cands.map(D1_QUALIFIED))
  if (q1.size === 1) { d1Unique++; row.d1Unique++ } else { d1StillAmbiguous++; row.d1Leaves++ }
  d1CandidateShrinkEdges++
  d1CandidateBefore += cands.length
  d1CandidateAfter += q1.size
}
const declaredNames = new Set(decls.map((d) => d.name))
const targetNames = new Set<string>()
for (const e of rels) if (e.tgt.length > 0 && declaredNames.has(e.tgt)) targetNames.add(e.tgt)
let namesProjectedUnique = 0
let namesD1Unique = 0
let maxCandidateBefore = 0
let maxCandidateAfter = 0
for (const n of targetNames) {
  const a = declsByName.get(n)!
  if (new Set(a.map(projectedQualified)).size === 1) namesProjectedUnique++
  if (new Set(a.map(D1_QUALIFIED)).size === 1) namesD1Unique++
  maxCandidateBefore = Math.max(maxCandidateBefore, a.length)
  maxCandidateAfter = Math.max(maxCandidateAfter, new Set(a.map(D1_QUALIFIED)).size)
}

const qualifiedEqualsNameByKind = (kind: string) =>
  decls.filter((d) => d.kind === kind && d.owner.length > 0 && d.qualified === d.name).length

const report = {
  instrument: "qualified-name-population",
  question:
    "is qualifiedName absent because ownerName is absent, or is qualifiedName simply not written " +
    "on symbols that already carry an owner? and if it were written, how many ambiguous edges become unique?",
  draw: DRAW,
  drawMatchesAmbiguitySplit: DRAW === EXPECTED_DRAW,
  expectedDraw: EXPECTED_DRAW,
  filesSampled: sample.length,
  reposInDraw: new Set(sample.map((f) => f.repo)).size,
  symbols: decls.length,
  degradedParses: degraded,
  parseFailures,
  q1_presence: {
    overall,
    byKind,
    qualifiedEqualsName: {
      what: "symbols whose qualifiedName is the BARE name, i.e. ownerName is set but never applied",
      measured: {
        "property": qualifiedEqualsNameByKind("property"),
        "class": qualifiedEqualsNameByKind("class"),
        "namespace": qualifiedEqualsNameByKind("namespace"),
        "type": qualifiedEqualsNameByKind("type"),
        "module": qualifiedEqualsNameByKind("module"),
      },
      all: decls.filter((d) => d.owner.length > 0 && d.qualified === d.name).length,
      whyItIsBroken:
        "the per-kind rows above are filtered by kind, because the first version of this block filtered the " +
        "whole population once per kind and printed the SAME total five times — which is how a number gets " +
        "reported as a breakdown it never was",
    },
  },
  q2_projection: {
    whatThisIs:
      "the number of ambiguous edges that WOULD be unique if every symbol carrying an ownerName also " +
      "carried qualifiedName = owner + '.' + name. Computed before any edit, so the edit can be checked against it.",
    resolvableEdges,
    ambiguousEdges,
    unresolved,
    projectedUnique,
    projectedStillAmbiguous,
    projectedRepairPct: ambiguousEdges ? projectedUnique / ambiguousEdges : 0,
    distinctTargetNames: targetNames.size,
    namesProjectedUnique,
    nameProjectedPct: targetNames.size ? namesProjectedUnique / targetNames.size : 0,
  },
  q3_projectionForD1: {
    whatThisIs:
      "the same question for the ONE edit this lane owns: publishing qualifiedName = owner + '.' + name on " +
      "attribute symbols, which src/ast/real-xml-analyzer.ts:2285-2301 currently does not publish at all. " +
      "pre-fix numbers, so the edit has something to be checked against.",
    resolvableEdges,
    ambiguousEdges,
    d1Unique,
    d1StillAmbiguous,
    d1RepairPct: ambiguousEdges ? d1Unique / ambiguousEdges : 0,
    whatItDoesNotMove:
      "d1StillAmbiguous stays >0 because the same qualified name is declared in more than one FILE, which no " +
      "per-symbol edit can reach. A qualified name is unique within a scope, not across a corpus.",
    candidateSet: {
      what:
        "how many declarations a reverse walk must choose among for one edge. The binary ambiguous flag does " +
        "not move when this shrinks, so it is reported separately rather than as a coverage claim.",
      edgesMeasured: d1CandidateShrinkEdges,
      candidatesBefore: d1CandidateBefore,
      candidatesAfter: d1CandidateAfter,
      meanCandidatesBefore: d1CandidateShrinkEdges ? d1CandidateBefore / d1CandidateShrinkEdges : 0,
      meanCandidatesAfter: d1CandidateShrinkEdges ? d1CandidateAfter / d1CandidateShrinkEdges : 0,
      worstTargetCandidatesBefore: maxCandidateBefore,
      worstTargetCandidatesAfter: maxCandidateAfter,
    },
    distinctTargetNames: targetNames.size,
    namesD1Unique,
    nameProjectedPct: targetNames.size ? namesD1Unique / targetNames.size : 0,
  },
  perType,
}

if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2))

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pc = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)

console.log(`qualified-name population — xml, ${report.filesSampled} files, ${report.reposInDraw} repos, draw ${DRAW}`)
console.log(`draw matches ambiguity-split: ${report.drawMatchesAmbiguitySplit}   degraded ${degraded}  parseFailures ${parseFailures}`)
console.log("")
console.log("Q1  ownerName / qualifiedName presence, by kind")
console.log(pad("kind", 14) + pad("both", 12) + pad("ownerOnly", 12) + pad("qualOnly", 12) + pad("neither", 12) + "total")
console.log("-".repeat(62))
for (const [k, v] of Object.entries(byKind).sort((a, b) => (b[1].both + b[1].ownerOnly + b[1].qualifiedOnly + b[1].neither) - (a[1].both + a[1].ownerOnly + a[1].qualifiedOnly + a[1].neither))) {
  const t = v.both + v.ownerOnly + v.qualifiedOnly + v.neither
  console.log(pad(k, 14) + pad(String(v.both), 12) + pad(String(v.ownerOnly), 12) + pad(String(v.qualifiedOnly), 12) + pad(String(v.neither), 12) + String(t))
}
console.log("-".repeat(62))
console.log(pad("ALL", 14) + pad(String(overall.both), 12) + pad(String(overall.ownerOnly), 12) + pad(String(overall.qualifiedOnly), 12) + pad(String(overall.neither), 12) + String(decls.length))
console.log("")
console.log("Q2  projection: qualifiedName written on every symbol that carries an ownerName")
console.log(`  resolvable edges      ${resolvableEdges}`)
console.log(`  ambiguous edges       ${ambiguousEdges}`)
console.log(`  projected unique      ${projectedUnique}  (${pc(projectedUnique, ambiguousEdges)})`)
console.log(`  projected still ambig ${projectedStillAmbiguous}  (${pc(projectedStillAmbiguous, ambiguousEdges)})`)
console.log(`  distinct target names ${targetNames.size}; projected unique ${namesProjectedUnique} (${pc(namesProjectedUnique, targetNames.size)})`)
console.log("")
console.log("Q1b symbols whose qualifiedName IS the bare name (owner set, never applied)")
const q1b = report.q1_presence.qualifiedEqualsName
for (const [k, n] of Object.entries(q1b.measured)) console.log(`     ${pad(k, 12)} ${n}`)
console.log(`     ${pad("ALL", 12)} ${q1b.all}`)
console.log(`     property + class = ${q1b.measured.property + q1b.measured.class} of ${report.symbols} symbols`)
console.log("")
console.log("Q3  the one edit this lane owns: qualifiedName on attribute symbols (PRE-FIX)")
console.log(`  ambiguous edges       ${ambiguousEdges}`)
console.log(`  projected unique      ${d1Unique}  (${pc(d1Unique, ambiguousEdges)})`)
console.log(`  projected still ambig ${d1StillAmbiguous}  (${pc(d1StillAmbiguous, ambiguousEdges)})`)
console.log(`  candidate set per ambiguous edge: ${d1CandidateBefore} -> ${d1CandidateAfter}`)
console.log(`    mean ${(d1CandidateShrinkEdges ? d1CandidateBefore / d1CandidateShrinkEdges : 0).toFixed(1)} -> ${(d1CandidateShrinkEdges ? d1CandidateAfter / d1CandidateShrinkEdges : 0).toFixed(1)}`)
console.log(`    worst single target ${maxCandidateBefore} -> ${maxCandidateAfter} candidates`)
console.log(`  names: ${targetNames.size}; projected unique ${namesD1Unique} (${pc(namesD1Unique, targetNames.size)})`)
console.log("")
console.log(pad("type", 14) + pad("edges", 9) + pad("ambiguous", 11) + pad("projUnique", 12) + pad("projLeaves", 12) + pad("d1Unique", 10) + pad("d1Leaves", 10) + "unres")
console.log("-".repeat(78))
for (const t of ALL_TYPES) {
  const r = perType[t]
  console.log(pad(t, 14) + pad(String(r.edges), 9) + pad(String(r.ambiguous), 11) + pad(String(r.projectedUnique), 12) + pad(String(r.projectedLeaves), 12) + pad(String(r.d1Unique), 10) + pad(String(r.d1Leaves), 10) + String(r.unresolved))
}