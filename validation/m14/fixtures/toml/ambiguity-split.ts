/**
 * AMBIGUITY SPLIT — toml, with the DECLARATION count the shared instrument does not keep.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-check.ts` publishes one number per lane:
 * `validation/m14/measurements/incoming-whole.tsv` reads toml 600 files / 1 fired /
 * 45 ambiguous / 0 unresolved. 45 is small beside the fleet's 40,791 (fsharp), but it
 * is not yet actionable, for the reason the round brief names:
 *
 *   `incoming-check.ts` builds `published: Map<name, kind[]>`, DEDUPED ON KIND, and
 *   calls a target ambiguous when `hits.length > 1` (`incoming-check.ts:220-224`).
 *   So its `ambiguous` column is a KIND count, not a declaration count. One `property`
 *   and one `namespace` sharing a name read AMBIGUOUS; three `namespace` symbols with
 *   the same name in three files read RESOLVED.
 *
 * For TOML that distinction is not academic, because this lane's symbols are
 * `module` / `namespace` / `property` and its whole identity design makes
 * DOTTED PATHS the published name (`version.ref` resolves to `versions.guava`, not to
 * `guava`). The design was built to be unique PER FILE, so per-file resolution is
 * already 100.0% (the lane doc, "the six questions"). The collisions that remain are
 * therefore across FILES, and the question this file answers is: are they same-kind
 * (so the shared instrument misses them) or cross-kind (so it counts them)?
 *
 * ## The buckets
 *
 * Adapting sql's B1..B4 to TOML's own shape — a TOML `contains` edge's SOURCE is the
 * enclosing table's dotted path, and that is a real disambiguator when the collision
 * is inside one file:
 *
 *   B1_sameFileOwner   >1 declaration, ONE file, DIFFERENT owners. The edge's SOURCE
 *                       already carries the disambiguator. Repairable here.
 *   B2_crossFile       >1 declaration in DIFFERENT files, same or mixed kinds. TOML
 *                       documents are independent — no `include`, no import, no
 *                       anchor — so no field on an edge can say which document's
 *                       declaration is meant without inventing one the language has
 *                       no answer for. The language's and the published-name
 *                       contract's, not the analyzer's.
 *   B3_crossKind       >1 declaration, ONE file, SAME owner, DIFFERENT kinds. The
 *                       published NAME is not an identifier at all. A finding about
 *                       the published-name contract.
 *   B4_indistinct      >1 declaration agreeing on file, owner AND kind. Every field an
 *                       edge could carry is exhausted.
 *
 * ## Resolution keys
 *
 * Measured over the WHOLE edge population of each type, not over the ambiguous subset,
 * so every figure is a rate with a stated denominator:
 *
 *   K0_bare     target alone                                    — what a consumer does today
 *   K1_source   (target, edge SOURCE)                           — for `contains`, source IS the owner
 *   K3_qualified  target matched as a SYMBOL's `qualifiedName`
 *
 * `K3` is included because TOML is the lane where it could plausibly work: the name IS
 * a dotted path, and a dotted path is path-shaped. Whether `qualifiedName` survives
 * production `parseFile` is measured here, not assumed — `pool-worker.ts` recomputes
 * it, and this lane sets `ownerName` rather than `scope`.
 *
 * ## ZERO REGEX, like every instrument in this lane. Entries come from `parseFile`,
 * the production pool-worker entry point.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/toml/ambiguity-split.ts [--files N] [--out FILE] [--list N]
 *   npx tsx validation/m14/fixtures/toml/ambiguity-split.ts --draw-only
 *
 * `--files N` admits the whole git-tracked TOML population under the corpus root
 * (admission byte-identical to `script/m14/ontology-coverage-gate.ts`) and takes a
 * DETERMINISTIC STRIDED sample of N from it, sorted by `repo/relative/path`. Membership
 * is a pure function of the corpus listing, so a before/after pair at the same N is the
 * same file set even when the corpus grew between the two runs — which is exactly the
 * comparison `validation/m14/measurements/incoming-whole.tsv` publishes at N=600.
 *
 * READ-ONLY with respect to the corpus. Writes only `--out`.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const fail = (m: string): never => {
  console.error(`ambiguity-split: ${m}`)
  process.exit(2)
}

/**
 * A valueless flag must not silently fall back to the default population.
 *
 * MEASURED on the sibling instrument this header was adapted from: sql's parser was
 * `const i = argv.indexOf(f); if (i >= 1) ...`, so `--files 1962` in first position
 * resolved to `undefined` and measured the DEFAULT 600 instead. Every internal
 * consistency check passed, because the artifact was internally coherent and simply
 * about something other than what its name said. Hence `i < 0`, a hard exit on a
 * valueless flag, and a receipt echo below.
 */
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const OUT = argOf("--out")
const DRAW_ONLY = argv.includes("--draw-only")
const N = Number(argOf("--files") ?? 600)
const LIST = Number(argOf("--list") ?? 40)
if (!Number.isInteger(N) || N < 1) fail(`--files must be a positive integer, got \`${argOf("--files")}\``)
if (!Number.isInteger(LIST) || LIST < 1) fail(`--list must be a positive integer, got \`${argOf("--list")}\``)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "toml"
const SIZE_CAP = 512 * 1024

const TYPES = [
  "calls",
  "uses",
  "contains",
  "brain_import",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const
type Type = (typeof TYPES)[number]

/**
 * Store label -> ontology name. BOTH `imports` spellings are accepted, because
 * `src/ast/types.ts` and `src/ast/engine.ts` disagree on the VALUE of
 * `RelationshipType.Imports` and an analyzer may legitimately emit either. TOML emits
 * neither today; the table exists so a future `imports` row cannot read 0 by accident.
 */
const LABEL_ALIASES: Record<string, Type> = {
  calls: "calls",
  call: "calls",
  uses: "uses",
  contains: "contains",
  composition: "contains",
  part_of: "contains",
  imports: "imports",
  brain_import: "imports",
  references: "references",
  depends_on: "references",
  related: "references",
  exports: "exports",
  provides: "exports",
  extends: "extends",
  inheritance: "extends",
  implements: "implements",
  implementation: "implements",
  overrides: "overrides",
  override: "overrides",
  instantiates: "instantiates",
}

type Pub = {
  file: string
  id: string
  qualifiedName: string
  kind: string
  ownerName: string | null
  line: number
}
type Edge = {
  type: Type
  rawLabel: string
  source: string
  target: string
  file: string
  isAliasReference: boolean
  confidence: number | null
  evidenceClass: string | null
}

// ------------------------------------------------------------------ population

const admitted: { label: string; abs: string; dir: string }[] = []
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
    admitted.push({ label: `${entry}/${rel}`, abs, dir })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const picked: typeof admitted = []
if (population <= N) picked.push(...admitted)
else for (let i = 0; i < N; i++) picked.push(admitted[Math.floor((i * population) / N)])

console.log(`ambiguity split — toml, production parseFile`)
console.log(`corpus root         ${CORPUS}`)
console.log(`--files             ${N}${N === 600 ? "   (DEFAULT — not passed on the command line)" : ""}`)
console.log(`--list              ${LIST}`)
console.log(`repos scanned       ${reposScanned}`)
console.log(`admitted population ${String(population).padStart(8)}`)
console.log(
  `sample              ${String(picked.length).padStart(8)}  (deterministic stride over the sorted population)`,
)
if (OUT) console.log(`--out               ${OUT}`)

if (DRAW_ONLY) {
  for (const f of picked) console.log(f.abs)
  process.exit(0)
}

// ------------------------------------------------------------------ parse

const byName = new Map<string, Pub[]>()
const byQname = new Map<string, Pub[]>()
const edges: Edge[] = []
let symbols = 0
let emptyNames = 0
let withQualifiedName = 0
let degraded = 0
let parseFailures = 0
const symbolKinds = new Map<string, number>()
const unknownEndpoints = new Map<string, number>()

const add = (m: Map<string, Pub[]>, key: string, p: Pub): void => {
  const arr = m.get(key)
  if (arr) arr.push(p)
  else m.set(key, [p])
}

for (const f of picked) {
  let r: any
  try {
    // ROOTED, so the file-scoped identity is computed from the project the ambiguity is
    // measured in: the analyzer derives `<project-relative dirs>.<stem>`, and an unrooted call
    // collapses every `Cargo.toml` in a repository onto the same prefix — which is the
    // collision this tool exists to count.
    r = await parseFile(f.abs, LANG, { projectRoot: f.dir } as any)
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
    const p: Pub = {
      file: f.label,
      id: String(s?.id ?? name),
      qualifiedName: q,
      kind,
      ownerName: s?.ownerName == null ? null : String(s.ownerName),
      line: Number(s?.startLine ?? s?.range?.startLine ?? 0),
    }
    add(byName, name, p)
    if (q.length > 0 && q !== name) add(byQname, q, p)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const rawLabel = String(rel?.type ?? rel?.relationshipType ?? "")
    const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    const md = (rel?.metadata ?? {}) as Record<string, any>
    if (src === "unknown") unknownEndpoints.set(`${rawLabel}:source`, (unknownEndpoints.get(`${rawLabel}:source`) ?? 0) + 1)
    if (tgt === "unknown") unknownEndpoints.set(`${rawLabel}:target`, (unknownEndpoints.get(`${rawLabel}:target`) ?? 0) + 1)
    const label = LABEL_ALIASES[rawLabel]
    if (!label) continue
    edges.push({
      type: label,
      rawLabel,
      source: src,
      target: tgt,
      file: f.label,
      isAliasReference: md.isAliasReference === true,
      confidence: typeof rel?.confidence === "number" ? rel.confidence : null,
      evidenceClass: md.evidenceClass == null ? null : String(md.evidenceClass),
    })
  }
}

console.log(`symbols published   ${String(symbols).padStart(8)}`)
console.log(`  of which qualifiedName != bare name: ${withQualifiedName}`)
console.log(`empty names         ${String(emptyNames).padStart(8)}`)
console.log(`degraded / failures ${String(degraded).padStart(8)} / ${parseFailures}`)
console.log(`edges collected     ${String(edges.length).padStart(8)}`)

// ------------------------------------------------------------------ resolve

type Row = {
  edges: number
  selfLoops: number
  emptyTarget: number
  k0: number
  multiSymbol: number
  multiKind: number
  k1: number
  k3: number
  k1orK3: number
  B1_sameFileOwner: number
  B2_crossFile: number
  B3_crossKind: number
  B4_indistinct: number
  unresolved: number
  distinctTargets: number
  lowConfidence: number
  nonStructural: number
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
  k3: 0,
  k1orK3: 0,
  B1_sameFileOwner: 0,
  B2_crossFile: 0,
  B3_crossKind: 0,
  B4_indistinct: 0,
  unresolved: 0,
  distinctTargets: 0,
  lowConfidence: 0,
  nonStructural: 0,
  examples: new Map(),
})
const perType: Record<Type, Row> = {} as Record<Type, Row>
for (const t of TYPES) perType[t] = blank()
const outsideTheTen: Record<string, number> = {}
const bump = (m: Map<string, number>, k: string): void => m.set(k, (m.get(k) ?? 0) + 1)

for (const e of edges) {
  const row = perType[e.type]
  if (!row) {
    outsideTheTen[e.rawLabel] = (outsideTheTen[e.rawLabel] ?? 0) + 1
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

  // Same resolution order `incoming-check.ts` uses: bare name, else qualified name.
  let hits = byName.get(e.target)
  let viaQualified = false
  if (!hits || hits.length === 0) {
    hits = byQname.get(e.target)
    viaQualified = hits != null
  }
  if (!hits || hits.length === 0) {
    row.unresolved++
    continue
  }
  row.distinctTargets++

  const kinds = new Set(hits.map((h) => h.kind))
  if (kinds.size > 1) row.multiKind++
  if (viaQualified) row.k3++

  if (hits.length === 1) {
    row.k0++
    row.k1++
    row.k1orK3++
    row.k3++
    continue
  }
  row.multiSymbol++

  // K1: for a `contains` edge the SOURCE is the enclosing table's dotted path, so
  // (target, source) is a genuinely disambiguating pair when both ends are in one file.
  const bySource = hits.filter((h) => `${h.ownerName ?? ""}|${h.file}` === `${e.source}|${e.file}`)
  if (bySource.length === 1) row.k1++
  if (bySource.length === 1 || viaQualified) row.k1orK3++
  if (viaQualified) row.k3++

  const files = new Set(hits.map((h) => h.file))
  const owners = new Set(hits.map((h) => `${h.ownerName ?? ""}|${h.file}`))
  let bucket: string
  if (files.size > 1) bucket = "B2_crossFile"
  else if (owners.size > 1) bucket = "B1_sameFileOwner"
  else if (kinds.size > 1) bucket = "B3_crossKind"
  else bucket = "B4_indistinct"
  row[bucket as "B1_sameFileOwner"]++

  let m = row.examples.get(bucket)
  if (!m) {
    m = new Map()
    row.examples.set(bucket, m)
  }
  const key = `${e.file}|${e.target}`
  if (m.has(key) || m.size >= LIST) continue
  m.set(key, [
    hits
      .slice(0, 6)
      .map((h) => `${h.file}:${h.line} ${h.kind}${h.ownerName ? ` in ${h.ownerName}` : ""}`)
      .join(" ; "),
    `edgeSource=${e.source}  edgeType=${e.type}  aliasRef=${e.isAliasReference}`,
  ])
}

// ------------------------------------------------------------------ report

const pad = (s: string | number, n: number): string => String(s).padStart(n)
const live = TYPES.filter((t) => perType[t].edges > 0)
const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`)

console.log("")
console.log("A. RESOLUTION under each candidate key — denominator is EVERY edge of the type")
console.log("   K0 bare target   K1 +edge SOURCE   K3 qualified name   K1|K3   selfLp   <0.7")
console.log("")
console.log("type".padEnd(13) + pad("edges", 7) + pad("K0", 7) + pad("K1", 7) + pad("K3", 7) + pad("K1|K3", 7) + pad("selfLp", 7) + pad("<0.7", 6))
console.log("-".repeat(72))
for (const t of live) {
  const r = perType[t]
  console.log(
    t.padEnd(13) +
      pad(r.edges, 7) +
      pad(r.k0, 7) +
      pad(r.k1, 7) +
      pad(r.k3, 7) +
      pad(r.k1orK3, 7) +
      pad(r.selfLoops, 7) +
      pad(r.lowConfidence, 6),
  )
}

console.log("")
console.log("B. AMBIGUITY CAUSE BUCKETS — denominator is the multiSymbol edges of the type")
console.log("   multiSym = target resolves to >1 published SYMBOL; multiKind = >1 distinct KIND (`incoming-check`'s rule)")
console.log("")
console.log("type".padEnd(13) + pad("multiSym", 10) + pad("multiKind", 10) + pad("B1same", 9) + pad("B2xFile", 9) + pad("B3kind", 8) + pad("B4same", 8) + pad("unres", 7))
console.log("-".repeat(74))
for (const t of live) {
  const r = perType[t]
  if (r.multiSymbol === 0 && r.unresolved === 0) continue
  console.log(
    t.padEnd(13) +
      pad(r.multiSymbol, 10) +
      pad(r.multiKind, 10) +
      pad(r.B1_sameFileOwner, 9) +
      pad(r.B2_crossFile, 9) +
      pad(r.B3_crossKind, 8) +
      pad(r.B4_indistinct, 8) +
      pad(r.unresolved, 7),
  )
}

console.log("")
console.log("C. AS A RATE, per type — the two columns the shared instrument publishes")
console.log("")
console.log("type".padEnd(13) + pad("edges", 8) + pad("K0rate", 9) + pad("K1rate", 9) + pad("multiSym", 10) + pad("multiKind", 10) + pad("incoming-check AMB", 19))
console.log("-".repeat(78))
for (const t of live) {
  const r = perType[t]
  console.log(
    t.padEnd(13) +
      pad(r.edges, 8) +
      pad(pct(r.k0, r.edges), 9) +
      pad(pct(r.k1, r.edges), 9) +
      pad(r.multiSymbol, 10) +
      pad(r.multiKind, 10) +
      pad(`${r.multiKind}  (${pct(r.multiKind, r.edges)})`, 19),
  )
}

console.log("")
console.log(`UNKNOWN literal endpoints: ${JSON.stringify(Object.fromEntries(unknownEndpoints))}`)
console.log(`SYMBOL KINDS: ${JSON.stringify(Object.fromEntries([...symbolKinds].sort((a, b) => b[1] - a[1])))}`)
console.log(`edge labels outside the 10: ${JSON.stringify(outsideTheTen)}`)

for (const t of live) {
  const r = perType[t]
  if (r.multiSymbol === 0) continue
  console.log("")
  console.log(`D. EXAMPLES ${t} — ${r.multiSymbol} multiSymbol, ${r.multiKind} multiKind`)
  for (const b of ["B1_sameFileOwner", "B2_crossFile", "B3_crossKind", "B4_indistinct"]) {
    const m = r.examples.get(b)
    if (!m || m.size === 0) continue
    console.log(`  [${b}] ${r[b as "B1_sameFileOwner"]} distinct file|target`)
    for (const v of [...m.values()].slice(0, 8)) console.log(`    ${v[0]}\n      ${v[1]}`)
  }
}

if (OUT) {
  const artifact = {
    instrument: "validation/m14/fixtures/toml/ambiguity-split.ts",
    lang: LANG,
    corpusRoot: CORPUS,
    filesRequested: N,
    filesWalked: picked.length,
    admittedPopulation: population,
    sampling: "deterministic stride over the population sorted by repo/relative/path",
    symbols,
    emptyNames,
    withQualifiedName,
    degraded,
    parseFailures,
    edges: edges.length,
    symbolKinds: Object.fromEntries([...symbolKinds].sort((a, b) => b[1] - a[1])),
    unknownEndpoints: Object.fromEntries(unknownEndpoints),
    perType: Object.fromEntries(
      live.map((t) => {
        const r = perType[t]
        return [
          t,
          {
            edges: r.edges,
            k0: r.k0,
            k1: r.k1,
            k3: r.k3,
            k1orK3: r.k1orK3,
            selfLoops: r.selfLoops,
            emptyTarget: r.emptyTarget,
            unresolved: r.unresolved,
            multiSymbol: r.multiSymbol,
            multiKind: r.multiKind,
            B1_sameFileOwner: r.B1_sameFileOwner,
            B2_crossFile: r.B2_crossFile,
            B3_crossKind: r.B3_crossKind,
            B4_indistinct: r.B4_indistinct,
            lowConfidence: r.lowConfidence,
            nonStructural: r.nonStructural,
            distinctTargets: r.distinctTargets,
          },
        ]
      }),
    ),
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
  console.log("")
  console.log(`wrote ${OUT}`)
}