/**
 * CSS PARSEFILE CENSUS — the lane's own six-questions table, off the PRODUCTION
 * entry point.
 *
 * ## Why this file exists and why it is not `firing-check.ts`
 *
 * `script/m14/firing-check.ts` is the supervisor's instrument and it is the source of
 * this lane's NUMERATOR (the EMITTED column), because numerator and denominator must
 * come from different sources — an agent supplying both is grading its own homework.
 * It is not the source of the DENOMINATOR: that is `css-ontology-probe.ts`, which
 * measures the language rather than the analyzer.
 *
 * This file is the third thing: it is the lane's own read of the EMITTED types, and it
 * exists because two rows of the supervisor's table are structurally incapable of
 * answering the questions this lane must answer:
 *
 *   1. `types[t].files` is ASSIGNED per file rather than accumulated:
 *
 *        for (const [type, set] of filesByType) res.types[type].files = set.size
 *
 *      `filesByType` is rebuilt for every file, so `set` is a Set of ONE path and
 *      `set.size` is 1 whenever the type fired at all. Measured: every type reads
 *      `files=1` on a 300-file sample where `references` is present in 298 of them.
 *      That row cannot be quoted, so this file computes it correctly. Reported as a
 *      §8 item; the shared file is not edited here.
 *
 *   2. Resolution is computed against `name` and `qualifiedName` only. The css
 *      analyzer publishes SCOPED names, and the store binds a relationship endpoint
 *      through the parallel-indexer's own rule. This file measures the same thing a
 *      second way — `source`/`target` against the published name set AND the scope
 *      set — so the number is not an artefact of which spelling the harness tried.
 *
 * ## What it measures, per relationship type
 *
 *   edges                 production `parseFile` produced it
 *   files                 how many of the sampled files carried at least one
 *   examples              the first N edges verbatim, so `Labelled` is auditable
 *   srcPublished/tgtPublished   how many ends bind to a symbol this file published
 *   bothEndsResolve       both ends bind — the `Resolved` question, per type
 *   conf histogram        the `Confident` question: <0.7 is a heuristic by contract
 *   evidenceClassMissing  contract §4.1 requires a machine-readable reason code
 *
 * Plus, across the whole sample rather than per type: SymbolKind census, symbols with
 * empty names, endpoints equal to the literal `unknown`, degraded (`fallback: true`)
 * parses, and parse failures.
 *
 * ## Sampling
 *
 * `git ls-files` order per repo, repos sorted by name, then a deterministic STRIDE
 * across the concatenated list, so the sample spreads over every repo instead of
 * exhausting the first alphabetically. `--files N` sets the sample size; `--all`
 * admits the entire corpus. Same admission rule as
 * `script/m14/ontology-coverage-gate.ts`: git-tracked, a real directory, <= 512 KB,
 * `detectLanguageFromPath(abs, text) === "css"`. Copied rather than imported because
 * the gate is shared machinery that may change under this lane.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/census/css-parsefile-census.ts --files 300
 *   npx tsx validation/m14/census/css-parsefile-census.ts --all --json out.json
 *
 * ## READ-ONLY
 *
 * Writes nothing unless `--json <path>` is given.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const ALL = argv.includes("--all")
const jsonAt = argv.indexOf("--json")
const fi = argv.indexOf("--files")
const SAMPLE = fi >= 0 ? Number(argv[fi + 1]) || 300 : 300
const EXAMPLES_PER_TYPE = 6

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/** store label -> ontology name. `imports` is stored as `imports` by the css analyzer. */
const LABEL: Record<string, Type> = {
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

// ---------------------------------------------------------------- corpus walk

type File = { repo: string; rel: string; abs: string; text: string }

const every: File[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "css") continue
    every.push({ repo: e, rel, abs, text })
  }
}

const byExt: Record<string, number> = {}
for (const f of every) {
  const x = (path.extname(f.rel) || "(none)").toLowerCase()
  byExt[x] = (byExt[x] ?? 0) + 1
}

let files = every
if (!ALL && every.length > SAMPLE) {
  const stride = Math.max(1, Math.floor(every.length / SAMPLE))
  files = []
  for (let i = 0; i < every.length && files.length < SAMPLE; i += stride) files.push(every[i])
}

// ---------------------------------------------------------------- tallies

type Row = {
  edges: number
  files: Set<string>
  srcPublished: number
  tgtPublished: number
  bothEndsResolve: number
  confBuckets: Record<string, number>
  evidenceClassMissing: number
  evidenceClasses: Record<string, number>
  examples: { file: string; line: number | null; source: string; target: string; confidence: number | null; evidenceClass: string | null }[]
}

const blank = (): Row => ({
  edges: 0, files: new Set<string>(), srcPublished: 0, tgtPublished: 0, bothEndsResolve: 0,
  confBuckets: {}, evidenceClassMissing: 0, evidenceClasses: {},
  examples: [],
})

const rows: Record<Type, Row> = Object.fromEntries(ALL_TYPES.map((t) => [t, blank()])) as Record<Type, Row>

const kinds: Record<string, number> = {}
/** Symbol metadata flag -> occurrences. This is the PER-BRANCH firing table: a flag
 *  whose count is 0 is a branch no corpus number in this document can speak about, and
 *  the previous version of this census did not report it at all, which is how a branch
 *  reads as covered when it has never executed. */
const symFlags: Record<string, number> = {}
/** Relationship metadata flag -> occurrences. Same purpose for edges. */
const relFlags: Record<string, number> = {}
let emptyNames = 0
let unknownKind = 0
let symbols = 0
let parseFailures = 0
let degraded = 0
let filesParsed = 0
let errorsReported = 0
const perRepo: Record<string, { files: number; symbols: number; rels: number }> = {}

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f.abs, path.dirname(f.abs))
  } catch {
    parseFailures++
    continue
  }
  if (!r) { parseFailures++; continue }
  filesParsed++
  if (r.fallback === true) degraded++
  const errs = Array.isArray(r.errors) ? r.errors.length : 0
  errorsReported += errs

  const syms: any[] = Array.isArray(r.symbols) ? r.symbols : []
  const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
  symbols += syms.length

  const label = `${f.repo}/${f.rel}`
  const pr = (perRepo[f.repo] ??= { files: 0, symbols: 0, rels: 0 })
  pr.files++
  pr.symbols += syms.length
  pr.rels += rels.length

  // The published name set. Three spellings bind in the store: the bare name, the
  // scoped name `owner.member`, and the qualified name. All three are recorded so a
  // resolution number cannot be produced by one lucky spelling.
  const names = new Set<string>()
  const scoped = new Set<string>()
  for (const s of syms) {
    const n = String(s?.name ?? "")
    const k = String(s?.kind ?? "")
    const q = String(s?.qualifiedName ?? "")
    const sc = String(s?.scope ?? "")
    kinds[k] = (kinds[k] ?? 0) + 1
    if (k.length === 0 || k === "unknown") unknownKind++
    for (const [fk, fv] of Object.entries((s?.metadata ?? {}) as Record<string, unknown>)) {
      if (fv === true) symFlags[fk] = (symFlags[fk] ?? 0) + 1
    }
    if (n.length === 0) { emptyNames++; continue }
    names.add(n)
    if (q.length > 0) names.add(q)
    if (sc.length > 0) {
      scoped.add(`${sc}.${n}`)
      names.add(`${sc}.${n}`)
    }
  }

  const published = (x: string): boolean => names.has(x) || scoped.has(x)

  for (const rel of rels) {
    const raw = String(rel?.type ?? rel?.relationshipType ?? "")
    const t = LABEL[raw]
    if (!t) continue
    const row = rows[t]
    row.edges++
    row.files.add(label)

    const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (published(src)) row.srcPublished++
    if (published(tgt)) row.tgtPublished++
    if (published(src) && published(tgt)) row.bothEndsResolve++

    const conf = typeof rel?.confidence === "number" ? rel.confidence : null
    const b = conf === null ? "(absent)" : conf < 0.7 ? "<0.7" : conf < 0.85 ? "0.7-0.85" : conf < 1 ? "0.85-<1" : "1.0"
    row.confBuckets[b] = (row.confBuckets[b] ?? 0) + 1

    const ec = rel?.metadata?.evidenceClass
    if (ec === undefined) row.evidenceClassMissing++
    else row.evidenceClasses[String(ec)] = (row.evidenceClasses[String(ec)] ?? 0) + 1
    for (const [fk, fv] of Object.entries((rel?.metadata ?? {}) as Record<string, unknown>)) {
      if (fv === true) relFlags[fk] = (relFlags[fk] ?? 0) + 1
    }

    if (row.examples.length < EXAMPLES_PER_TYPE) {
      row.examples.push({
        file: label, line: rel?.line_number ?? rel?.lineNumber ?? null,
        source: src, target: tgt, confidence: conf, evidenceClass: ec === undefined ? null : String(ec),
      })
    }
  }
}

// ---------------------------------------------------------------- report

const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`)
const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)

// MEASURED, not assumed: the scope flags ride the RELATIONSHIP payload, not the
// symbol's. `isMediaScope` on 26,800 edges and 0 symbols is the check — a declared list
// filed under the wrong side reports 0 for a branch that fires 26,800 times, which is
// the exact failure this instrument exists to make visible.
const DECLARED_REL_BRANCHES = [
  "isAnimationRef", "isFontFamilyRef", "isMixinRef", "isComposition", "isCounterStyleRef",
  "isFontFeatureValuesRef", "isVariableRef", "isNamespaceRef", "isCustomMediaRef",
  "isCssImport", "isSassModuleImport", "isKeyframesRedefinition", "isPropertyReregistration",
  "isCustomPropertyRedefinition",
  "isMediaScope", "isLayerScope", "isContainerScope", "isSupportsScope", "isScopeScope",
  "isSelectorChain", "isNestedSelector", "isCustomPropertyScope",
]
const DECLARED_SYM_BRANCHES = [
  "isSelector", "isComplex", "isCustomProperty", "isUtility", "isKeyframes", "isSupports",
  "isAtRule", "isCssModule",
  "isCounterStyleDeclaration", "isCustomMediaDeclaration",
  "isFontFeatureValuesDeclaration", "isPropertyRegistration",
]

const report = {
  tool: "css-parsefile-census",
  corpusRoot: CR,
  admission: "git-tracked, real dir, <=512KB, detectLanguageFromPath(abs,text)==='css'",
  corpusTotal: every.length,
  corpusByExtension: byExt,
  sampled: files.length,
  sampling: ALL ? "ALL admitted files" : `deterministic stride over git ls-files order, stride=${every.length > SAMPLE ? Math.max(1, Math.floor(every.length / SAMPLE)) : "n/a"}`,
  reposInSample: Object.keys(perRepo).length,
  filesParsed, parseFailures, degradedFallbacks: degraded,
  symbolsPerFile: filesParsed === 0 ? 0 : Number((symbols / filesParsed).toFixed(1)),
  relationshipsPerFile: filesParsed === 0 ? 0 : Number(((Object.values(rows).reduce((a, r) => a + r.edges, 0)) / filesParsed).toFixed(1)),
  totalRelationships: Object.values(rows).reduce((a, r) => a + r.edges, 0),
  symbols,
  emptySymbolNames: emptyNames,
  emptyOrUnknownKind: unknownKind,
  kindCensus: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1])),
  parseErrorsReported: errorsReported,
  symbolFlagCensus: Object.fromEntries(Object.entries(symFlags).sort((a, b) => b[1] - a[1])),
  relationshipFlagCensus: Object.fromEntries(Object.entries(relFlags).sort((a, b) => b[1] - a[1])),
  // A declared branch is reported even at 0. `undefined` means the flag was never
  // observed at all, which for a declared branch is itself the finding.
  declaredRelationshipBranches: Object.fromEntries(DECLARED_REL_BRANCHES.map((f) => [f, relFlags[f] ?? 0])),
  declaredSymbolBranches: Object.fromEntries(DECLARED_SYM_BRANCHES.map((f) => [f, symFlags[f] ?? 0])),
  declaredRelationshipBranchesNeverObserved: DECLARED_REL_BRANCHES.filter((f) => relFlags[f] === undefined),
  declaredSymbolBranchesNeverObserved: DECLARED_SYM_BRANCHES.filter((f) => symFlags[f] === undefined),
  types: Object.fromEntries(ALL_TYPES.map((t) => [t, {
    edges: rows[t].edges,
    files: rows[t].files.size,
    srcPublished: rows[t].srcPublished,
    tgtPublished: rows[t].tgtPublished,
    bothEndsResolve: rows[t].bothEndsResolve,
    resolutionRate: pct(rows[t].bothEndsResolve, rows[t].edges),
    confBuckets: rows[t].confBuckets,
    evidenceClassMissing: rows[t].evidenceClassMissing,
    evidenceClasses: rows[t].evidenceClasses,
    examples: rows[t].examples,
  }])),
  perRepo,
}

if (jsonAt !== -1 && argv[jsonAt + 1]) writeFileSync(argv[jsonAt + 1], JSON.stringify(report, null, 2) + "\n")

console.log(`css parseFile census — PRODUCTION entry point (src/ast/pool-worker.ts)`)
console.log(`corpus ${CR}`)
console.log(`admitted corpus: ${every.length} files (${Object.entries(byExt).map(([k, v]) => `${k}=${v}`).join(" ")})`)
console.log(`sampled: ${files.length} files across ${Object.keys(perRepo).length} repos — ${report.sampling}`)
console.log(`parsed ${filesParsed}/${files.length}, parse failures ${parseFailures}, DEGRADED (fallback:true) ${degraded}`)
console.log(`symbols ${symbols.toLocaleString()} (${report.symbolsPerFile}/file), relationships ${report.totalRelationships.toLocaleString()} (${report.relationshipsPerFile}/file), parse errors reported ${errorsReported}`)
console.log(`empty symbol names ${emptyNames}; empty-or-unknown SymbolKind ${unknownKind}`)
console.log("")
console.log(`DECLARED RELATIONSHIP BRANCHES (a 0 is a branch no corpus number can speak about; pinned only by a fixture):`)
for (const f of DECLARED_REL_BRANCHES) {
  const n = relFlags[f] ?? 0
  console.log(`  ${w(f, 34)}${String(n).padStart(8)}${n === 0 ? "   <- NO CORPUS OCCURRENCE" : ""}`)
}
console.log(`DECLARED SYMBOL BRANCHES:`)
for (const f of DECLARED_SYM_BRANCHES) {
  const n = symFlags[f] ?? 0
  console.log(`  ${w(f, 34)}${String(n).padStart(8)}${n === 0 ? "   <- NO CORPUS OCCURRENCE" : ""}`)
}
console.log(`ALL relationship flags observed: ${Object.entries(relFlags).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)
console.log(`kind census: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)
console.log("")
console.log(`ALL symbol flags observed: ${Object.entries(symFlags).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)
console.log("")
console.log(`${w("type", 14)}${w("edges", 9)}${w("files", 8)}${w("srcPub", 9)}${w("tgtPub", 9)}${w("bothRes", 9)}${w("rate", 8)}${w("<0.7", 8)}${w("evMiss", 8)}evidenceClass`)
console.log("-".repeat(130))
for (const t of ALL_TYPES) {
  const r = rows[t]
  const lo = r.confBuckets["<0.7"] ?? 0
  console.log(
    `${w(t, 14)}${w(r.edges.toLocaleString(), 9)}${w(String(r.files.size), 8)}${w(String(r.srcPublished), 9)}${w(String(r.tgtPublished), 9)}${w(String(r.bothEndsResolve), 9)}${w(pct(r.bothEndsResolve, r.edges), 8)}${w(String(lo), 8)}${w(String(r.evidenceClassMissing), 8)}${Object.entries(r.evidenceClasses).map(([k, v]) => `${k}=${v}`).join(" ") || "(none)"}`,
  )
}
console.log("-".repeat(130))
for (const t of ALL_TYPES) {
  if (rows[t].examples.length === 0) continue
  console.log("")
  console.log(`--- ${t}: ${rows[t].edges} edges in ${rows[t].files.size} files; confidence buckets ${JSON.stringify(rows[t].confBuckets)}`)
  for (const e of rows[t].examples) {
    console.log(`    ${e.file}${e.line === null ? "" : `:${e.line}`}  ${e.source} -> ${e.target}  conf=${e.confidence} evidenceClass=${e.evidenceClass ?? "(absent)"}`)
  }
}
