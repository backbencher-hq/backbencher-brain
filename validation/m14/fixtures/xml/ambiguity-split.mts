/**
 * AMBIGUITY SPLIT — the incoming check, with the declaration count the shared
 * instrument does not keep.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-check.ts` answers "can the reverse walk reach a
 * declaration". Its `ambiguousTargets` is the number that matters for that
 * question, and for XML it reads 6,007 on a 600-file draw
 * (`validation/m14/measurements/incoming-whole.tsv`). That number cannot be
 * acted on until it is split, because three causes need three different fixes
 * and only two of them belong to this lane:
 *
 *   B1 same-file      — one name, >1 declaration, all inside ONE file. The
 *                       analyzer published the same name twice in one scope.
 *                       This lane's defect. Fixable here.
 *   B2 cross-file     — one name, 1 kind, >1 file. Two documents each declare it
 *                       and the analyzer does not model which document is in
 *                       scope. This lane's defect, fixable only by publishing a
 *                       qualified identity.
 *   B3 cross-kind     — one name, >1 kind. The published NAME is not a unique
 *                       identifier at all: `item` is a `class` in one document
 *                       and a `property` in another, and no scoping change fixes
 *                       that, because the name was never unique to begin with.
 *                       A finding about the published-name CONTRACT.
 *
 * ## The measurement this file had to correct to produce the split
 *
 * The shared instrument builds `published: Map<name, kind[]>` and calls a target
 * ambiguous when `hits.length > 1` (`incoming-check.ts:177-182`). Because it
 * stores only DISTINCT KINDS, that condition is B3 alone. B1 and B2 — the same
 * kind declared in two places — are invisible to it. So the 6,007 is a B3 count,
 * and B3 is the one bucket that is NOT this lane's to fix. Reporting 6,007
 * without saying that would send the reader after the wrong cause.
 *
 * This file therefore counts DECLARATIONS (`file:startLine:endLine` triples) as
 * well as kinds, and reports the split with the B3-only number beside the total
 * so both readings are checkable against `incoming-whole.tsv`.
 *
 * ## Discipline
 *
 * - Entries come from `parseFile`, the production pool-worker entry point, never
 *   from a lane-owned parser. §8 item 8 of the lane doc measured what happens to
 *   an instrument that builds its own tree-sitter parser: it fails silently and
 *   periodically, and its own coverage claim becomes unfalsifiable.
 * - Label spellings: `imports` and `brain_import` are BOTH accepted and mapped
 *   onto one ontology name, because three `RelationshipType` enums disagree in
 *   this codebase and an analyzer may legitimately emit either.
 * - ZERO REGEX, like every instrument in this lane.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/xml/ambiguity-split.mts [--files N]
 *   npx tsx validation/m14/fixtures/xml/ambiguity-split.mts --draw-only
 *
 * READ-ONLY with respect to the corpus. Writes only the JSON it prints.
 */
import { readdirSync, statSync, readFileSync } from "fs"
import * as path from "path"
import { execFileSync } from "child_process"
import { createHash } from "crypto"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WANT = Number(process.env.BB_XML_FILES ?? 600)
/** Mirrors `ontology-census.mts`: no repo may take more than its share. */
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
const DRAW_ONLY = process.argv.includes("--draw-only")
const OUT = process.env.BB_XML_OUT

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** Store label -> ontology name. Both `imports` spellings are accepted. */
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

// Family-stratified round-robin: every repo gets its share before any repo gets
// a second file, so a 4,000-file repository cannot crowd out a 30-file one.
// Identical in method to `ontology-census.mts`, so a draw from this file and a
// draw from that one are the same kind of draw.
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

const drawRows = sample.map((f) => `${f.repo}/${f.rel}`)
if (DRAW_ONLY) {
  console.log(JSON.stringify({ draw: DRAW, files: sample.length, rows: drawRows }, null, 2))
  process.exit(0)
}

// ─────────────────────────────────────────────────────────── parse and index
/** name -> the declarations published under it. */
type Pub = {
  kinds: Set<string>
  /** `file:startLine:endLine`, so two declarations in one file stay distinct. */
  decls: Set<string>
  files: Set<string>
}
const published = new Map<string, Pub>()
const declaredNames: string[] = []
const rels: { rel: any; file: string }[] = []
let symbols = 0
let degraded = 0
const parseFailures: string[] = []
const kindCounts = new Map<string, number>()
const emptyNames: unknown[] = []
const unknownEndpoints: { type: string; end: string; edge: string }[] = []

function pub(name: string): Pub {
  let p = published.get(name)
  if (!p) {
    p = { kinds: new Set(), decls: new Set(), files: new Set() }
    published.set(name, p)
  }
  return p
}

for (const f of sample) {
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch (e) {
    parseFailures.push(`${f.repo}/${f.rel}: ${(e as Error)?.message ?? e}`)
    continue
  }
  if (!r) {
    parseFailures.push(`${f.repo}/${f.rel}: no result`)
    continue
  }
  if (r.fallback === true) degraded++

  const fileKey = `${f.repo}/${f.rel}`
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    symbols++
    const name = String(s?.name ?? "")
    if (name.length === 0) {
      emptyNames.push({ file: fileKey, kind: String(s?.kind ?? "") })
      continue
    }
    declaredNames.push(name)
    const kind = String(s?.kind ?? "")
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1)
    const sl = String(s?.startLine ?? s?.line ?? "")
    const el = String(s?.endLine ?? "")
    const p = pub(name)
    p.kinds.add(kind)
    p.decls.add(`${fileKey}:${sl}:${el}`)
    p.files.add(fileKey)
    // The shared instrument registers the qualified name as a second key, and so
    // does this one, or the two disagree on the denominator for no stated reason.
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) {
      const qp = pub(q)
      qp.kinds.add(kind)
      qp.decls.add(`${fileKey}:${sl}:${el}`)
      qp.files.add(fileKey)
    }
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) rels.push({ rel, file: fileKey })
}

// ─────────────────────────────────────────────────────────── per-type split
type Bucket = "unique" | "B1_same_file" | "B2_cross_file" | "B3_cross_kind"
type TypeRow = {
  fired: boolean
  edges: number
  targetsDistinct: number
  /** Total ambiguous edges: every edge whose target names >1 declaration OR >1 kind. */
  ambiguousTotal: number
  /** The subset the SHARED instrument counts, i.e. >1 distinct kind. */
  ambiguousCrossKindOnly: number
  B1_sameFile: number
  B2_crossFileSameKind: number
  B3_crossKind: number
  unresolved: number
  selfLoops: number
  emptyTarget: number
}

const blank = (): TypeRow => ({
  fired: false, edges: 0, targetsDistinct: 0, ambiguousTotal: 0, ambiguousCrossKindOnly: 0,
  B1_sameFile: 0, B2_crossFileSameKind: 0, B3_crossKind: 0, unresolved: 0, selfLoops: 0, emptyTarget: 0,
})
const perType: Record<string, TypeRow> = {}
for (const t of ALL_TYPES) perType[t] = blank()

/** Per distinct target name: how many edges named it, and why it collides. */
const targetInfo = new Map<string, { name: string; edges: number; types: Set<string>; bucket: Bucket; kinds: string[]; decls: number; files: number }>()

function classify(name: string): Bucket | null {
  const p = published.get(name)
  if (!p || p.kinds.size === 0) return null
  if (p.kinds.size > 1) return "B3_cross_kind"
  if (p.decls.size > 1) return p.files.size === 1 ? "B1_same_file" : "B2_cross_file"
  return "unique"
}

const UNLABELLED = new Map<string, number>()
for (const { rel, file } of rels) {
  const raw = String(rel?.type ?? rel?.relationshipType ?? "")
  if (!raw) continue
  const label = LABEL_ALIASES[raw]
  if (!label) {
    UNLABELLED.set(raw, (UNLABELLED.get(raw) ?? 0) + 1)
    continue
  }
  const row = perType[label]
  const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
  const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
  row.edges++

  if (src === "unknown" || tgt === "unknown") {
    unknownEndpoints.push({ type: label, end: src === "unknown" ? "source" : "target", edge: file })
  }
  if (tgt.length === 0) {
    row.emptyTarget++
    continue
  }
  if (src === tgt) {
    row.selfLoops++
    continue
  }

  const bucket = classify(tgt)
  if (bucket === null) {
    row.unresolved++
    continue
  }
  row.targetsDistinct++
  if (bucket !== "unique") {
    row.ambiguousTotal++
    if (bucket === "B3_cross_kind") {
      row.B3_crossKind++
      row.ambiguousCrossKindOnly++
    } else if (bucket === "B1_same_file") row.B1_sameFile++
    else row.B2_crossFileSameKind++
  }

  let info = targetInfo.get(tgt)
  if (!info) {
    const p = published.get(tgt)!
    info = {
      name: tgt,
      edges: 0, types: new Set(), bucket,
      kinds: [...p.kinds].sort(), decls: p.decls.size, files: p.files.size,
    }
    targetInfo.set(tgt, info)
  }
  info.edges++
  info.types.add(label)
}

for (const t of ALL_TYPES) perType[t].fired = perType[t].edges > 0

const named = new Set<string>()
for (const { rel } of rels) {
  const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
  if (!label) continue
  const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
  if (tgt.length > 0 && classify(tgt) !== null) named.add(tgt)
}
const orphans = declaredNames.filter((n) => !named.has(n)).length

const sum = (f: (r: TypeRow) => number) => ALL_TYPES.reduce((a, t) => a + f(perType[t]), 0)
const globalSplit = {
  edges: sum((r) => r.edges),
  selfLoops: sum((r) => r.selfLoops),
  unresolved: sum((r) => r.unresolved),
  emptyTarget: sum((r) => r.emptyTarget),
  ambiguousTotal: sum((r) => r.ambiguousTotal),
  ambiguousCrossKindOnly: sum((r) => r.ambiguousCrossKindOnly),
  B1_sameFile: sum((r) => r.B1_sameFile),
  B2_crossFileSameKind: sum((r) => r.B2_crossFileSameKind),
  B3_crossKind: sum((r) => r.B3_crossKind),
}

const ambByBucket = (b: Bucket) =>
  [...targetInfo.values()].filter((i) => i.bucket === b)
    .sort((a, b) => b.edges - a.edges || b.decls - a.decls)

/**
 * `types` is a Set and `rows` go through JSON, so a per-bucket TYPE histogram is
 * computed here rather than left to the reader: which edge types point at an
 * ambiguous name is the question step 2 of the round brief asks, and answering it
 * from a Set in the artifact would mean the reader re-derives it.
 */
const bucketEdgeTypes = (b: Bucket): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const [t, row] of Object.entries(perType)) {
    const key = b === "B1_same_file" ? "B1_sameFile" : b === "B2_cross_file" ? "B2_crossFileSameKind" : "B3_crossKind"
    if (row[key as keyof TypeRow] as number > 0) out[t] = row[key as keyof TypeRow] as number
  }
  return out
}

const report = {
  instrument: "ambiguity-split",
  draw: DRAW,
  filesRequested: WANT,
  filesSampled: sample.length,
  reposInDraw: new Set(sample.map((f) => f.repo)).size,
  reposInCorpus: byRepo.size,
  corpusAdmittedFiles: [...byRepo.values()].reduce((a, r) => a + r.length, 0),
  perRepoCap: PER_REPO,
  symbols,
  degradedParses: degraded,
  parseFailures: parseFailures.slice(0, 10),
  parseFailureCount: parseFailures.length,
  symbolKinds: [...kindCounts.entries()].sort((a, b) => b[1] - a[1]),
  emptyNameSymbols: emptyNames.length,
  unknownEndpointEdges: unknownEndpoints.length,
  unlabelledRelationshipLabels: [...UNLABELLED.entries()].sort((a, b) => b[1] - a[1]),
  distinctTargetNames: targetInfo.size,
  distinctIncomingTargets: named.size,
  orphanDeclarations: orphans,
  orphanRate: declaredNames.length ? orphans / declaredNames.length : 0,
  globalSplit,
  perType,
  topAmbiguousTargets: {
    B1_same_file: ambByBucket("B1_same_file").slice(0, 25),
    B2_cross_file: ambByBucket("B2_cross_file").slice(0, 25),
    B3_cross_kind: ambByBucket("B3_cross_kind").slice(0, 25),
  },
  bucketTargetNameCounts: {
    B1_same_file: ambByBucket("B1_same_file").length,
    B2_cross_file: ambByBucket("B2_cross_file").length,
    B3_cross_kind: ambByBucket("B3_cross_kind").length,
  },
  bucketEdgesByType: {
    B1_same_file: bucketEdgeTypes("B1_same_file"),
    B2_cross_file: bucketEdgeTypes("B2_cross_file"),
    B3_cross_kind: bucketEdgeTypes("B3_cross_kind"),
  },
}

if (OUT) {
  const { writeFileSync } = await import("fs")
  writeFileSync(OUT, JSON.stringify({ ...report, drawRows }, null, 2))
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`ambiguity split — xml, ${report.filesSampled} files, ${report.reposInDraw} repos, draw ${DRAW}`)
console.log(`symbols ${symbols}  degraded parses ${degraded}  parse failures ${report.parseFailureCount}  empty names ${report.emptyNameSymbols}  unknown endpoints ${report.unknownEndpointEdges}`)
console.log("")
console.log(pad("type", 14) + pad("fired", 7) + pad("edges", 9) + pad("distinct", 10) + pad("ambTotal", 10) + pad("B1same", 9) + pad("B2cross", 9) + pad("B3kind", 9) + "unres")
console.log("-".repeat(84))
for (const t of ALL_TYPES) {
  const r = perType[t]
  console.log(
    pad(t, 14) + pad(r.fired ? "yes" : "NO", 7) + pad(String(r.edges), 9) + pad(String(r.targetsDistinct), 10)
    + pad(String(r.ambiguousTotal), 10) + pad(String(r.B1_sameFile), 9) + pad(String(r.B2_crossFileSameKind), 9)
    + pad(String(r.B3_crossKind), 9) + String(r.unresolved),
  )
}
console.log("-".repeat(84))
console.log("")
console.log(`AMBIGUITY SPLIT (edges)`)
console.log(`  total ambiguous          ${globalSplit.ambiguousTotal}`)
console.log(`  B3 cross-kind            ${globalSplit.B3_crossKind}   <- the ONLY bucket the shared instrument counts`)
console.log(`  B2 cross-file, 1 kind    ${globalSplit.B2_crossFileSameKind}`)
console.log(`  B1 same-file             ${globalSplit.B1_sameFile}`)
console.log(`  unresolved               ${globalSplit.unresolved}`)
console.log(`  self-loops               ${globalSplit.selfLoops}`)
console.log("")
console.log(`distinct target names ${report.distinctTargetNames}; names with >1 declaration: ${report.bucketTargetNameCounts.B1_same_file + report.bucketTargetNameCounts.B2_cross_file + report.bucketTargetNameCounts.B3_cross_kind}`)
console.log(`orphan declarations ${orphans} of ${declaredNames.length}`)
