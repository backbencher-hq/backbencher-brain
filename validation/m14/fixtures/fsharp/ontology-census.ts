/**
 * F# ONTOLOGY CENSUS — the instrument behind this lane's per-type verdicts.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is the arbiter, and for `fsharp` it refuses
 * to report at all: `RULED_BY_LANG` carries `bash` and `json` only, and the gate
 * exits 2 with "no RULING TABLE for fsharp" — AFTER the corpus walk, and BEFORE the
 * EMITTED table is printed. So a full 6,619-file run of the arbiter yields zero
 * measured counts for this lane. (Reported to the supervisor rather than patched
 * here: the gate is `script/m14/` shared machinery.)
 *
 * This is the replacement instrument, and it does what §2b of the workstream asks:
 * it drives the PRODUCTION entry point — `parseFile` from `src/ast/pool-worker.ts`,
 * not `analyze()` — over a bounded, stated sample of the corpus, and reports the
 * seven quantities the six questions are asked of.
 *
 * ## What it measures
 *
 *   1. relationship types EMITTED, with counts and the files they came from
 *   2. SymbolKind values, with any empty or unknown kind called out (standing rule:
 *      `SymbolKind` is never empty or `unknown`)
 *   3. symbols with an empty name (standing rule: no empty symbol names)
 *   4. relationship endpoints equal to the literal `unknown` (ledger R7)
 *   5. per-type RESOLUTION RATE: both endpoints bound to a symbol published by the
 *      same parse. A name published elsewhere in the project is reported separately,
 *      because a consumer resolves against the project, not the file.
 *   6. per-type confidence distribution, and the share below 0.7 (honesty contract
 *      §4: a sub-0.7 edge is a heuristic and must be countable as one)
 *
 * ## Sampling
 *
 * `BB_FSHARP_SAMPLE` files (default 400, the workstream's stated floor is 200+ per
 * family), drawn by a seeded shuffle of the git-tracked corpus so the draw is
 * reproducible from a clean checkout. The method and the realized rate are printed.
 *
 * READ-ONLY. Writes nothing.
 *
 *   npx tsx validation/m14/fixtures/fsharp/ontology-census.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "fsharp"
const SAMPLE = Number(process.env.BB_FSHARP_SAMPLE ?? 400)
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ------------------------------------------------------------------ corpus draw
// git-tracked, so a build artifact never enters the sample, and the draw is a pure
// function of (corpus contents, SAMPLE) — no clock, no unseeded RNG.
function admitted(): { repo: string; dir: string; rel: string; abs: string }[] {
  const out: { repo: string; dir: string; rel: string; abs: string }[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      if (rel.endsWith("/test-data") || rel.includes("/obj/") || rel.includes("/bin/")) continue
      let size: number
      try { size = statSync(abs).size } catch { continue }
      // 512 KB, the arbiter's own admission ceiling, so the two instruments admit
      // the same population and a disagreement between them is not an admission
      // disagreement.
      if (size > 512 * 1024) continue
      if (detectLanguageFromPath(abs) !== LANG) continue
      out.push({ repo: e, dir, rel, abs })
    }
  }
  return out
}

/** Mulberry32 over a fixed seed: reproducible, and no dependence on Array#sort stability. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const a2 = items.slice()
  for (let i = a2.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[a2[i], a2[j]] = [a2[j]!, a2[i]!]
  }
  return a2
}

const pool = admitted()
const sample = seededShuffle(pool, 0x5f5a11 >>> 0).slice(0, SAMPLE)

console.log(`fsharp ontology census`)
console.log(`corpus root: ${CR}`)
console.log(`admitted: ${pool.length} git-tracked .fs/.fsi/.fsx files <= 512 KB`)
console.log(`sampled:  ${sample.length} (seeded shuffle, seed 0x5f5a1, slice(0, ${SAMPLE}))`)
console.log(`rate:     ${((sample.length / Math.max(1, pool.length)) * 100).toFixed(1)}% of the admitted population\n`)

// ------------------------------------------------------------------ the walk
type RelRow = { label: string; source: string; target: string; confidence: number; line?: number }

const perType = new Map<Type, {
  n: number
  files: Set<string>
  fileCount: Set<string>
  confBelow07: number
  confSum: number
  confUnknown: number
  srcResolved: number
  tgtResolved: number
  bothResolved: number
  projResolved: number
  unknownEndpoint: number
  examples: string[]
  labelMeta: Map<string, number>
}>()
const ensure = (t: Type) => {
  let r = perType.get(t)
  if (!r) {
    r = { n: 0, files: new Set<string>(), fileCount: new Set<string>(), confBelow07: 0, confSum: 0, confUnknown: 0,
          srcResolved: 0, tgtResolved: 0, bothResolved: 0, projResolved: 0, unknownEndpoint: 0, examples: [], labelMeta: new Map() }
    perType.set(t, r)
  }
  return r
}

/**
 * `RelationshipType.Imports` is NOT the string "imports".
 *
 * src/ast/types.ts:69 declares `Imports = "brain_import"` — nine enum names collapse
 * onto six serialized values, so an edge emitted as `RelationshipType.Imports`
 * arrives downstream carrying the type string `brain_import`. Reading `x.type === "imports"`
 * therefore measures ZERO imports on a language that emits them, and reports it as a gap.
 * `script/m14/verify-doc-truth-emissions.ts:160` already carries the same map. This
 * census normalises on the way IN so the `imports` row is real, and records how many
 * edges arrived under the raw spelling so the normalisation itself is countable.
 */
const SERIALIZED_TO_ONTOLOGY: Record<string, string> = { brain_import: "imports" }
const rawTypeTally = new Map<string, number>()

const kindTally = new Map<string, number>()
const kindBad: { file: string; kind: string; name: string }[] = []
const emptyName: { file: string; kind: string }[] = []
const unknownEndpointRows: { file: string; type: string; source: string; target: string }[] = []
let filesParsed = 0
let filesFailed = 0
let symbolTotal = 0
let relTotal = 0
// cross-file: every name published ANYWHERE in the sample, so an edge whose target
// lives in another file can be distinguished from an edge whose target is nothing.
const corpusNames = new Set<string>()
/** Endpoint pairs held until the whole sample has been walked, then resolved project-wide. */
const pendingEdges: { t: Type; source: string; target: string }[] = []

const CONC = Number(process.env.BB_FSHARP_CONC ?? 6)
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= sample.length) return
    const f = sample[i]!
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { filesFailed++; continue }
    filesParsed++
    const syms: any[] = r?.symbols ?? []
    const rels: any[] = r?.relationships ?? []
    const fileNames = new Set<string>()
    for (const s of syms) {
      const name = typeof s?.name === "string" ? s.name : ""
      const kind = typeof s?.kind === "string" ? s.kind : String(s?.kind ?? "")
      symbolTotal++
      if (name) fileNames.add(name)
      kindTally.set(kind, (kindTally.get(kind) ?? 0) + 1)
      if (!kind || kind === "unknown") kindBad.push({ file: label, kind, name })
      if (!name) emptyName.push({ file: label, kind })
    }
    for (const n of fileNames) corpusNames.add(n)
    relTotal += rels.length
    for (const x of rels) {
      const raw = String(x?.type ?? x?.relationshipType ?? "")
      rawTypeTally.set(raw, (rawTypeTally.get(raw) ?? 0) + 1)
      const norm = raw.toLowerCase()
      const t = (SERIALIZED_TO_ONTOLOGY[norm] ?? norm) as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = ensure(t)
      row.n++
      row.fileCount.add(label)
      if (row.files.size < 6) row.files.add(label)
      const source = typeof x?.source === "string" ? x.source : ""
      const target = typeof x?.target === "string" ? x.target : ""
      const c = typeof x?.confidence === "number" ? x.confidence : NaN
      if (Number.isNaN(c)) row.confUnknown++
      else {
        row.confSum += c
        if (c < 0.7) row.confBelow07++
      }
      if (source === "unknown" || target === "unknown") {
        row.unknownEndpoint++
        if (unknownEndpointRows.length < 40) unknownEndpointRows.push({ file: label, type: t, source, target })
      }
      // A dotted source like `Owner.method` is the lane's own spelling for an
      // override target, so resolution is tested on both the whole endpoint and
      // its LEAF — a consumer that binds by symbol name binds the leaf.
      const leafOf = (s: string) => (s.includes(".") ? (s.split(".").pop() as string) : s)
      const srcOk = !!source && (fileNames.has(source) || fileNames.has(leafOf(source)))
      const tgtOk = !!target && (fileNames.has(target) || fileNames.has(leafOf(target)))
      if (srcOk) row.srcResolved++
      if (tgtOk) row.tgtResolved++
      if (srcOk && tgtOk) row.bothResolved++
      // PROJECT-SCOPE resolution is measured in a SECOND phase, after every name in
      // the sample is known: resolved inline it would be order-dependent, since a
      // target in a file the walk has not reached yet is absent from corpusNames and
      // would be scored unresolved. For F# that matters — `System`, `List` and every
      // base type come from a sibling .fs file — so the endpoint pairs are kept and
      // resolved once the whole sample is in.
      pendingEdges.push({ t, source, target })
      if (row.examples.length < 4) row.examples.push(`${source} -[${t}]-> ${target}`)
      // Question 4's label audit. `metadata.relationshipType` is the lane's primary class
      // marker, but it is not the ONLY one: FS-A6 gave `calls` a second class
      // (`isPipelineCall`) and the construction rules mark their own, so an audit that reads
      // only `relationshipType` would report every one of those rows as unclassed — which is
      // how a mixed label looks like an unlabelled one. Each fallback marker is named here so
      // the audit cannot quietly under-report a class.
      const md = x?.metadata ?? {}
      const mk: string =
        (md.relationshipType as string) ??
        (md.isImport ? "isImport" : md.isPipelineCall ? `pipeline:${md.pipelineOperator ?? "?"}` : md.isNewConstruction || md.isConstructorChain ? "construction" : "-")

      row.labelMeta.set(mk, (row.labelMeta.get(mk) ?? 0) + 1)
    }
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()))

// ------------------------------------------------------------------ phase 2: project scope
// `leafOf` is repeated rather than imported: a consumer binds an edge endpoint by
// SYMBOL NAME, and the lane spells an override target `Owner.method`, so the leaf is
// the name a consumer can actually resolve.
const leafOf2 = (s: string) => (s.includes(".") ? (s.split(".").pop() as string) : s)
for (const e of pendingEdges) {
  const row = perType.get(e.t)
  if (!row) continue
  const sOk = !!e.source && (corpusNames.has(e.source) || corpusNames.has(leafOf2(e.source)))
  const tOk = !!e.target && (corpusNames.has(e.target) || corpusNames.has(leafOf2(e.target)))
  if (sOk && tOk) row.projResolved++
}
console.log(`project-scope name universe: ${corpusNames.size.toLocaleString()} distinct symbol names across the sample`)

// ------------------------------------------------------------------ the report
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(`parse: ${filesParsed} files, ${filesFailed} failed`)
console.log(`symbols: ${symbolTotal.toLocaleString()}   relationships (in ALL_TYPES): ${relTotal.toLocaleString()}\n`)

console.log("RAW type strings as emitted (so the brain_import normalisation is visible)")
for (const [k, v] of [...rawTypeTally.entries()].sort((a, b) => b[1] - a[1])) {
  const mapped = SERIALIZED_TO_ONTOLOGY[k.toLowerCase()]
  console.log(`  ${w(k, 24)}${w(v.toLocaleString(), 10)}${mapped ? `-> normalised to "${mapped}"` : ""}`)
}

console.log("\nPER-TYPE EMISSION (production parseFile)")
console.log("-".repeat(130))
console.log(`${w("type", 13)}${w("edges", 10)}${w("files", 7)}${w("inFile%", 9)}${w("proj%", 8)}${w("<0.7", 8)}${w("meanC", 8)}${w("unkEP", 7)}examples`)
for (const t of ALL_TYPES) {
  const r = perType.get(t)
  if (!r || r.n === 0) {
    console.log(`${w(t, 13)}${w("0", 10)}${w("0", 7)}${w("-", 9)}${w("-", 8)}${w("-", 8)}${w("-", 8)}${w("0", 7)}NOT EMITTED`)
    continue
  }
  const meanC = r.confUnknown === r.n ? "n/a" : (r.confSum / (r.n - r.confUnknown)).toFixed(3)
  console.log(
    `${w(t, 13)}${w(r.n.toLocaleString(), 10)}${w(String(r.fileCount.size), 7)}` +
    `${w(pct(r.bothResolved, r.n), 9)}${w(pct(r.projResolved, r.n), 8)}` +
    `${w(`${r.confBelow07} (${pct(r.confBelow07, r.n)})`, 8)}${w(meanC, 8)}${w(String(r.unknownEndpoint), 7)}` +
    r.examples.slice(0, 1).join(""),
  )
}

console.log("\nPER-TYPE ENDPOINT RESOLUTION, split (question 5). src/tgt are per-endpoint; `both` is the edge-level rate.")
console.log(`  reference point from the workstream: CSS \`references\` resolves at both ends on 66.8% of its edges`)
console.log("-".repeat(130))
console.log(`${w("type", 13)}${w("edges", 10)}${w("src%", 9)}${w("tgt%", 9)}${w("bothInFile%", 12)}${w("bothProject%", 13)}`)
for (const t of ALL_TYPES) {
  const r = perType.get(t)
  if (!r || r.n === 0) continue
  console.log(`${w(t, 13)}${w(r.n.toLocaleString(), 10)}${w(pct(r.srcResolved, r.n), 9)}${w(pct(r.tgtResolved, r.n), 9)}${w(pct(r.bothResolved, r.n), 12)}${w(pct(r.projResolved, r.n), 13)}`)
}

console.log("\nTYPE -> FILES (first 6 of each)")
for (const t of ALL_TYPES) {
  const r = perType.get(t)
  if (!r || r.n === 0) continue
  console.log(`  ${t}: ${[...r.files].join(", ")}`)
}

console.log("\nmetadata.relationshipType distribution per type (label audit, question 4)")
for (const t of ALL_TYPES) {
  const r = perType.get(t)
  if (!r || r.n === 0) continue
  const parts = [...r.labelMeta.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`)
  console.log(`  ${t}: ${parts.join(", ")}`)
}

console.log("\nSymbolKind tally (question: any empty or unknown kind?)")
for (const [k, v] of [...kindTally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${w(k || "<EMPTY>", 16)}${v.toLocaleString()}`)
}
console.log(`  empty-or-unknown kind rows: ${kindBad.length}${kindBad.length ? `  e.g. ${JSON.stringify(kindBad.slice(0, 3))}` : ""}`)
console.log(`  empty-name symbol rows:    ${emptyName.length}${emptyName.length ? `  e.g. ${JSON.stringify(emptyName.slice(0, 3))}` : ""}`)
console.log(`  endpoint === "unknown":    ${unknownEndpointRows.length}${unknownEndpointRows.length ? `  e.g. ${JSON.stringify(unknownEndpointRows.slice(0, 3))}` : ""}`)

// ------------------------------------------------------------------ json artifact
const out = {
  corpusRoot: CR,
  admitted: pool.length,
  sampled: sample.length,
  seed: "0x5f5a1",
  sampleFiles: sample.map((f) => `${f.repo}/${f.rel}`),
  filesParsed,
  filesFailed,
  symbolTotal,
  relTotal,
  rawTypeTally: Object.fromEntries(rawTypeTally),
  serializedToOntology: SERIALIZED_TO_ONTOLOGY,
  projectScopeNames: corpusNames.size,
  perType: Object.fromEntries(ALL_TYPES.map((t) => {
    const r = perType.get(t)
    if (!r || r.n === 0) return [t, { n: 0 }]
    const meanC = r.confUnknown === r.n ? null : r.confSum / (r.n - r.confUnknown)
    return [t, {
      n: r.n,
      files: [...r.files],
      fileCount: r.fileCount.size,
      srcResolved: r.srcResolved,
      tgtResolved: r.tgtResolved,
      bothResolvedInFile: r.bothResolved,
      bothResolvedProjectScope: r.projResolved,
      confBelow07: r.confBelow07,
      meanConfidence: meanC,
      unknownEndpoint: r.unknownEndpoint,
      metadataRelationshipType: Object.fromEntries(r.labelMeta),
      examples: r.examples,
    }]
  })),
  kindTally: Object.fromEntries(kindTally),
  emptyOrUnknownKind: kindBad.length,
  emptyNameSymbols: emptyName.length,
  unknownEndpointRows: unknownEndpointRows.length,
}
if (process.env.BB_FSHARP_JSON) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(process.env.BB_FSHARP_JSON, JSON.stringify(out, null, 2))
  console.log(`\njson: ${process.env.BB_FSHARP_JSON}`)
}
