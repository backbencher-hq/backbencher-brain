/**
 * GraphQL — THE SIX QUESTIONS, over the PRODUCTION corpus, through production `parseFile`.
 *
 * Why this file exists: `out/corpus-sweep.json` and `out/project-resolution.json` answered the
 * same questions on 2026-09-28 against a 47-file LOCAL corpus, and that was before the lane
 * emitted `exports`, `references`, `overrides` or `imports`. Their `relHistogram` carries three
 * relationship types; the arbiter now measures seven. A number that answers a different question
 * about a different population is worse than no number, so both are superseded by this one.
 *
 * Population: the SAME corpus the arbiter admits — `git ls-files` under `$BB_CORPUS_ROOT`, files
 * under 512 KB, `detectLanguageFromPath(abs, text) === "graphql"` — 1,905 files. Same admission
 * rule means the two instruments count the same set of files and the denominator is honest.
 *
 * Entry point: `parseFile` from `src/ast/pool-worker.ts`. NOT `analyze()` — `analyze()` is a
 * per-file unit that skips the pool, timeouts, truncation and enhancement stages, so every number
 * here would describe a code path production never runs.
 *
 * The six questions, and which field of this file's output answers each:
 *
 *   1 exists     source-derived, published in `docs/analyzers/graphql.md`; not
 *                measurable from output and not claimed here
 *   2 fires      `types[].count > 0` — a count from production parseFile on 1,905 files
 *   3 correct    `differential` — this probe does not adjudicate; the differential does, and its
 *                limitation (a second walker over the same grammar, so a shared grammar bug is
 *                invisible to both) is stated there and in the doc
 *   4 labelled   `types[].roles` — the same measured edge under two labels is the divergence this
 *                histogram exists to surface, so the role mix is printed, not just the total
 *   5 resolved   `types[].resolution` — BOTH endpoints against the file's own symbol set, then
 *                again against the PROJECT symbol set, because a split GraphQL schema resolves
 *                `user.login` only at project scope and an in-file-only rate would call that a defect
 *   6 confident  `types[].confidence` — the sub-0.7 share, counted separately per the contract
 *
 * Every number is written with its denominator. `resolvedInFile` and `resolvedProject` are reported
 * over DIFFERENT populations (the file's symbols vs the project's) and are never summed or averaged
 * into one figure.
 */
import * as path from "path"
import * as fs from "fs"
import { execFileSync } from "child_process"
import { statSync } from "fs"
import { ROOT } from "../paths.mts"
import { fileURLToPath } from "node:url"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "out")

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))

/** The ontology's ten, in the arbiter's order, so the two outputs line up row for row. */
const TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const

// ───────────────────────────────────────────────────────────── population
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of fs.readdirSync(CR)) {
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
    try { if (statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "graphql") continue
    files.push({ repo: e, dir, rel, abs })
  }
}

// ───────────────────────────────────────────────────────────── accumulators
interface Row {
  count: number
  /** capped at 4 — the files the type was SEEN in, for a reader to look at */
  files: Set<string>
  /** EVERY distinct file the type appeared in — a census count, not a sample */
  allFiles: Set<string>
  roles: Map<string, number>
  confBelow07: number
  confTotal: number
  confSum: number
  confBuckets: Map<string, number>
  /** both endpoints bind in the file's own symbol set */
  bothInFile: number
  /** both endpoints bind in the PROJECT symbol set (bare name matches anywhere) */
  bothProject: number
  bothProjectInclSpec: number
  /** at least one endpoint is the literal `unknown` */
  unknownEndpoints: number
  sampleFiles: string[]
  sampleEdges: string[]
}
const rows = new Map<string, Row>()
const row = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = {
      count: 0, files: new Set(), allFiles: new Set(), roles: new Map(), confBelow07: 0, confTotal: 0, confSum: 0,
      confBuckets: new Map(), bothInFile: 0, bothProject: 0, bothProjectInclSpec: 0, unknownEndpoints: 0,
      sampleFiles: [], sampleEdges: [],
    }
    rows.set(t, r)
  }
  return r
}
for (const t of TYPES) row(t)

const kindHistogram = new Map<string, number>()
const EMPTY_NAME_OR_KIND = new Map<string, number>()
const relTypesOutsideOntology = new Map<string, number>()
const errorsPerFile: { file: string; n: number }[] = []

let filesParsed = 0
let filesWithParseError = 0
let totalSymbols = 0
let totalRelationships = 0
let filesWithZeroRelationships = 0

/** name -> how many symbols carry it, accumulated ACROSS files, for the project-scope test. */
const projectNames = new Map<string, number>()

const { resumableWalk, resetCheckpoint } = await import(path.join(ROOT, "script/m14/resumable-walk.ts"))
const CHECKPOINT = path.join(ROOT, "validation/m14/measurements/sixq-graphql.txt")

/**
 * `--fresh` discards the checkpoint history and re-walks every file.
 *
 * It is NOT optional convenience, it is the only way this probe can produce a number. Every
 * accumulator below — counts, roles, confidences, resolution buckets, the triple buffer — lives in
 * MEMORY and is populated from inside `run()`, and `resumableWalk` does not call `run()` for a
 * file a previous run recorded. So a resumed walk reports a fully-populated artifact computed over
 * nothing: this probe ran once already, printed `admittedFiles: 1905, filesParsed: 0`, and
 * OVERWROTE 156,759 measured relationships with zeros while exiting 0.
 *
 * `script/m14/ontology-coverage-gate.ts` has the same shape and the same exposure — it tallies
 * `observed` inside `run()` and then, on a fully-resumed walk, prints `emitted 0/10` for every
 * language. That one is shared machinery and is reported rather than edited. This one is the
 * lane's, so it refuses to run rather than reporting the empty measurement.
 */
const FRESH = process.argv.includes("--fresh")
if (FRESH) resetCheckpoint(CHECKPOINT)

// The triple buffer lives under /tmp, not in the repo: it is derived, it is large, and it is
// rebuilt by the run that writes it. Truncated at the start of every run so a resumed walk cannot
// append to a previous run's edges and over-count them.
const triplesPath = "/tmp/opencode/graphql-sixq-triples.tsv"
/**
 * Accumulated in memory and written ONCE at the end. The first draft called
 * `triplesPath.appendFileSync(...)` — `triplesPath` is a string, so every call threw a TypeError
 * inside `run()`, `resumableWalk` swallowed it per file, and the probe reported a full pass with an
 * EMPTY triple buffer: every in-file resolution number correct and every project-scope number 0.
 * A silent per-file throw that leaves a headline count untouched is worth naming, so the write is
 * now a single statement that cannot be skipped per file, and the buffer size is asserted.
 */
const allTriples: string[] = []

const walkOpts = {
  id: (i: number) => files[i].abs,
  concurrency: 8,
  run: async (i: number) => {
    const f = files[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (e: any) {
      filesWithParseError++
      errorsPerFile.push({ file: `${f.repo}/${f.rel}`, n: 1 })
      return
    }
    filesParsed++

    const syms: any[] = Array.isArray(r.symbols) ? r.symbols : []
    totalSymbols += syms.length
    const inFile = new Set<string>()
    for (const s of syms) {
      const nm = String(s?.name ?? "")
      const qn = String(s?.qualifiedName ?? "")
      if (nm) inFile.add(nm)
      if (qn) inFile.add(qn)
      if (!nm || !qn) {
        const k = `${!nm ? "empty_name" : ""}${!nm && !qn ? "+" : ""}${!qn ? "empty_qualified_name" : ""}`
        EMPTY_NAME_OR_KIND.set(k, (EMPTY_NAME_OR_KIND.get(k) ?? 0) + 1)
      }
      if (nm) projectNames.set(nm, (projectNames.get(nm) ?? 0) + 1)
      const kind = String(s?.kind ?? "")
      kindHistogram.set(kind === "" ? "(empty kind)" : kind, (kindHistogram.get(kind === "" ? "(empty kind)" : kind) ?? 0) + 1)
    }

    const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
    totalRelationships += rels.length
    if (rels.length === 0) filesWithZeroRelationships++

    // ONE parse per file, and the triples are buffered to disk so project-scope resolution is
    // computed from THIS run's relationships. The first draft of this probe re-walked the corpus
    // for the second pass and reported `contains` at 100.05% project-resolution — a rate above
    // 100% is impossible, and it appeared because the two passes did not return the same edge
    // counts for the same file. `parseFile` runs a pool with per-file timeouts, so a second walk
    // under different load can hand back a truncated document. Measuring it once and deriving
    // both rates from it removes the second source of drift as well.

    for (const x of rels) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
      const src = String(x?.source ?? x?.from ?? "")
      const tgt = String(x?.target ?? x?.to ?? "")
      if (!TYPES.includes(t as any)) {
        relTypesOutsideOntology.set(t === "" ? "(empty type)" : t, (relTypesOutsideOntology.get(t === "" ? "(empty type)" : t) ?? 0) + 1)
        continue
      }
      const R = row(t)
      R.count++
      R.allFiles.add(`${f.repo}/${f.rel}`)
      if (R.files.size < 4) R.files.add(`${f.repo}/${f.rel}`)

      const role = String(x?.metadata?.relationshipRole ?? x?.relationshipRole ?? "(no role)")
      R.roles.set(role, (R.roles.get(role) ?? 0) + 1)

      const conf = typeof x?.confidence === "number" ? x.confidence : null
      if (conf !== null) {
        R.confTotal++
        R.confSum += conf
        if (conf < 0.7) R.confBelow07++
        const b = conf.toFixed(1)
        R.confBuckets.set(b, (R.confBuckets.get(b) ?? 0) + 1)
      }

      const isUnknown = (v: string) => v === "unknown"
      if (isUnknown(src) || isUnknown(tgt)) R.unknownEndpoints++

      // Resolution. `exports` from `(file)` is a SENTINEL SOURCE by design — a document exports
      // its declarations, and `(file)` names the document itself, not a symbol in it. Counting it
      // against the symbol set would understate the type by construction, and calling it a defect
      // would be wrong; it is measured as its own row so the rate is readable rather than flattering.
      const srcIsSentinel = src === "(file)"
      const srcOk = srcIsSentinel || inFile.has(src)
      const tgtOk = inFile.has(tgt)
      if (srcOk && tgtOk) R.bothInFile++

      if (R.sampleEdges.length < 3) R.sampleEdges.push(`${src} -[${t}]-> ${tgt}`)
      // Tab-separated, escaped: a GraphQL name cannot contain a tab or a newline, and an endpoint
      // carrying one would be a defect this probe should surface rather than hide in a CSV.
      const esc = (v: string) => v.replace(/[\t\n\r]/g, " ")
      // Column 5 is the base an `imports` target resolves against. It MUST be the importing
      // FILE's own directory, not the repository root: a GraphQL `#import "./x.graphql"` is
      // resolved by eslint-plugin-graphql relative to the importing file, and the corpus proves
      // it — `b.graphql` and `c.graphql` are siblings under
      // `gql-graphql-tools/packages/import/tests/documents/import-test/default/`, not at the
      // repository root. This column carried `f.dir` (the repo root) until this pass, which
      // resolved 0 of 170 `imports` targets and reported the type as 0% on disk. The number was
      // a fact about the base, not about the corpus.
      allTriples.push(`${t}\t${esc(src)}\t${esc(tgt)}\t${srcOk ? 1 : 0}${tgtOk ? 1 : 0}\t${path.dirname(f.abs)}\t${f.dir}`)
    }
  },
}

/**
 * The population this artifact describes, decided BEFORE anything is written.
 *
 * `run()` is what fills every accumulator, so `walked === 0` means the artifact is about a
 * population that was never observed. Writing it anyway is how a 156,759-relationship census
 * became a zero census without a single non-zero exit code. `alreadyDone` is reported because a
 * resumed walk is legitimate for a crash-tolerant walk — it is illegitimate for one whose
 * accumulators do not survive the process.
 */
const walkStats = { total: files.length, walked: 0, alreadyDone: 0, skippedBad: 0, partial: false, checkpoint: CHECKPOINT }
await resumableWalk(CHECKPOINT, files.length, walkOpts).then((s) => {
  walkStats.walked = s.walked
  walkStats.alreadyDone = s.alreadyDone
  walkStats.skippedBad = s.skippedBad
  walkStats.partial = s.partial
})

if (walkStats.walked === 0) {
  throw new Error(
    `the walk parsed 0 of ${walkStats.total} admitted files: ${walkStats.alreadyDone} were already ` +
    `recorded in ${walkStats.checkpoint} and every accumulator in this probe is populated only from ` +
    `inside run(), which a resumed walk does not call. Re-run with --fresh. Refusing to write an ` +
    `artifact describing a population this run did not observe.`,
  )
}
if (walkStats.walked + walkStats.alreadyDone < walkStats.total || walkStats.skippedBad > 0) {
  console.warn(
    `WARNING partial population: ${walkStats.walked} walked + ${walkStats.alreadyDone} already done ` +
    `of ${walkStats.total} admitted, ${walkStats.skippedBad} skipped as bad. Every count below is a ` +
    `statement about THAT population.`,
  )
}
console.log(
  `walk: ${walkStats.walked} newly walked, ${walkStats.alreadyDone} already done, ` +
  `${walkStats.skippedBad} skipped bad, of ${walkStats.total} admitted (fresh=${FRESH})`,
)

// ───────────────────────────────────────────────────────────── project-scope resolution
// One write, then an assertion that the buffer actually holds an edge per counted edge. Without the
// assertion the failure mode above — a full-looking pass over an empty buffer — is invisible.
const ontologyEdgeTotal = TYPES.reduce((a, t) => a + rows.get(t)!.count, 0)
fs.writeFileSync(triplesPath, allTriples.join("\n"))
if (allTriples.length !== ontologyEdgeTotal) {
  throw new Error(
    `triple buffer holds ${allTriples.length} rows for ${ontologyEdgeTotal} counted edges — ` +
    `the buffer and the counters have diverged, so the project-scope numbers below are void`,
  )
}
console.log(`triple buffer: ${allTriples.length} rows for ${ontologyEdgeTotal} counted edges`)

// The project name table is complete now, so the bare-name fallback the store actually performs
// (a bare name binds only when it is unique) can be applied — over the BUFFERED triples, not over
// a second parse.
let endpointBucketReport: Record<string, Record<string, number>> = {}
const uniq = new Set<string>()
for (const [n, c] of projectNames) if (c === 1) uniq.add(n)

/**
 * Why an endpoint does or does not bind, as a BUCKET rather than a percentage.
 *
 * A single rate is the wrong instrument here and this corpus shows why: `references` targets are
 * mostly `String`, `Int` and friends — names the GraphQL SPECIFICATION defines and no file can
 * declare, so no `brain_symbol` row will ever exist for them and the store's two resolution
 * strategies cannot land them. That is a property of the STORE, not a defect in the edge, and a
 * bare "44.78% resolved" reports it as if the analyzer were wrong. `uses` has the same shape one
 * level down: a selection names a bare member like `name`, which 300+ types in this corpus carry,
 * so the store refuses it BY DESIGN — it binds a bare name only when the name is unique.
 *
 * So every endpoint lands in exactly one bucket and both the buckets and the headline are published:
 *
 *   inFile          binds in this file's own symbol set
 *   sentinel        `(file)` — the `exports` source, a document naming itself, not a symbol
 *   specVocabulary  a name the specification defines; unresolvable by the store, correct on the edge
 *   uniqueBare      exactly one project symbol carries this bare name — the store's bare fallback lands
 *   ambiguous       several project symbols carry it — undecidable by design, and leaving it bare is correct
 *   dangling        nothing in the corpus declares it — the only bucket that is a defect candidate
 *
 * `bothEndsBindUnderStoreRules` counts inFile + sentinel + uniqueBare. `…IncludingSpecVocabulary`
 * additionally admits specVocabulary, and the gap between the two is the size of the store's blind spot.
 */
/**
 * Spec vocabulary: names the GraphQL SPECIFICATION reserves, which no document may declare and no
 * `brain_symbol` row will ever exist for. The store's two strategies cannot land them.
 *
 * The first cut of this set was the five built-in scalars plus three introspection META-fields
 * (`__typename`, `__schema`, `__type`). That is the set `out/project-resolution.json` listed, and it
 * was too narrow by the whole introspection TYPE family: measuring with it bucketed `__Type.kind`,
 * `__Type.fields`, `__InputValue.name` and 30-odd qualified introspection members as DANGLING, which
 * reads as an analyzer defect and is not one — the graphiql fixture that declares
 * `type FullType { kind: __Type }` names a type the specification defines in
 * `src/type/introspection.ts`. GraphQL reserves the `__` prefix for introspection and forbids any
 * user schema from declaring it, so the honest rule is the PREFIX rather than a hand-kept list: a
 * name or any dot-separated component of a qualified name beginning `__` is spec vocabulary. That
 * rule is checkable against the specification's own reservation, so it does not rot as the
 * introspection surface grows.
 */
const BUILTIN_SCALARS = new Set(["Int", "Float", "String", "Boolean", "ID"])
const INTROSPECTION_META = new Set(["__typename", "__schema", "__type"])
const isSpecVocabulary = (v: string): boolean =>
  BUILTIN_SCALARS.has(v) || INTROSPECTION_META.has(v) || v.split(/[.\]]/).some((c) => c.startsWith("__"))

/**
 * `imports` is a FILE-to-FILE edge, so its source is a document's name and its target is a path.
 * Neither is a symbol, so a symbol oracle reports the type 0% by construction. The source is
 * bucketed `fileName` rather than `dangling` because that is what it is: bucketing it `dangling`
 * would put 170 phantom dangling endpoints in the table and make the one bucket that IS a defect
 * candidate mean two different things. The target's real oracle is the filesystem, reported
 * separately as `onDisk`.
 */
const bucketOf = (v: string, inFileOk: boolean, type?: string): string => {
  if (inFileOk) return "inFile"
  if (v === "(file)") return "sentinel"
  if (type === "imports") return "fileName"
  if (isSpecVocabulary(v)) return "specVocabulary"
  const c = projectNames.get(v)
  if (c === 1) return "uniqueBare"
  if (c !== undefined && c > 1) return "ambiguous"
  return "dangling"
}
/**
 * `dangling` is the only bucket that is a defect candidate — the others are the store's blind spot,
 * a design refusal, or correct on the face of the edge. So the DANGLING NAMES are captured, not
 * just their count: a count says how many, and the names say whether the analyzer is wrong or the
 * corpus simply does not contain the declaration. A query selecting `login` against a schema this
 * corpus does not hold is a corpus fact; a `field_selection` pointing at a name the analyzer
 * invented is a fabrication, and the two are indistinguishable in a count.
 */
const dn = new Map<string, Set<string>>()
{
  const endpointBuckets = new Map<string, Map<string, number>>()
  const B = (t: string) => {
    let m = endpointBuckets.get(t)
    if (!m) { m = new Map(); endpointBuckets.set(t, m) }
    return m
  }
  for (const line of fs.readFileSync(triplesPath, "utf8").split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    const t = parts[0]
    const R = rows.get(t)
    if (!R) continue
    const src = parts[1]
    const tgt = parts[2]
    const srcOk = parts[3][0] === "1"
    const tgtOk = parts[3][1] === "1"
    const bs = bucketOf(src, srcOk, t)
    const bt = bucketOf(tgt, tgtOk, t)
    B(t).set(bs, (B(t).get(bs) ?? 0) + 1)
    B(t).set(bt, (B(t).get(bt) ?? 0) + 1)
    // The set is created on first touch for EVERY type up front. A `?.add` on the first branch and a
    // bare `.add` on the second records the SOURCE side and drops the TARGET side whenever the type
    // has never had a dangling source — which is the usual case, so the samples would be empty for
    // exactly the types worth looking at.
    if (!dn.has(t)) dn.set(t, new Set())
    const dset = dn.get(t)!
    if (bs === "dangling" && dset.size < 60) dset.add(`src: ${src} -[${t}]-> ${tgt}`)
    if (bt === "dangling" && dset.size < 60) dset.add(`tgt: ${src} -[${t}]-> ${tgt}`)
    const STORE_OK = new Set(["inFile", "sentinel", "uniqueBare"])
    if (STORE_OK.has(bs) && STORE_OK.has(bt)) R.bothProject++
    if (STORE_OK.has(bs) || bs === "specVocabulary") {
      if (STORE_OK.has(bt) || bt === "specVocabulary") R.bothProjectInclSpec++
    }
  }
  endpointBucketReport = Object.fromEntries(
    [...endpointBuckets.entries()].map(([t, m]) => [t, Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))]),
  )
}

// ───────────────────────────────────────────────────────────── imports: the right oracle
// `imports` names a FILE, not a symbol, so a symbol-set oracle reports it 0% by construction and
// that number is a statement about the oracle, not about the analyzer. The oracle this type needs
// is the filesystem: does the named path exist, relative to the importing file's own directory?
const importsWellFormed = { n: 0 }
let importsFileExists = 0
let importsFileMissing = 0
let importsUnresolvableSpec = 0
// The SAME 170 targets resolved against the repository root instead of the importing file's
// directory. Kept because the pair is the evidence: 0/170 against the repo root and N/170 against
// the file's own directory is what shows the earlier 0% was the base, not the corpus.
let importsExistsAgainstRepoRoot = 0
const importsMissingSamples: string[] = []
{
  for (const line of fs.readFileSync(triplesPath, "utf8").split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    if (parts[0] !== "imports") continue
    const src = parts[1]
    const tgt = parts[2]
    const bits = parts[3]
    const dir = parts[4]
    const repoRoot = parts[5]
    // The importing file's own name is the SOURCE of an `imports` edge, and the named path is
    // resolved relative to the importing file's directory — which the buffer carries, so this
    // needs no second parse.
    if (!dir) { importsUnresolvableSpec++; continue }
    importsWellFormed.n++
    const abs = path.resolve(dir, tgt)
    if (repoRoot && fs.existsSync(path.resolve(repoRoot, tgt))) importsExistsAgainstRepoRoot++
    if (fs.existsSync(abs)) importsFileExists++
    else {
      importsFileMissing++
      if (importsMissingSamples.length < 6) importsMissingSamples.push(`${src} -> ${tgt} (resolved ${abs})`)
    }
  }
}

// ───────────────────────────────────────────────────────────── determinism
// Is `parseFile` a function of the file alone? This matters because every number in this report is
// a production count, and a production entry point that returns a different edge count for the
// same bytes under different load cannot be the basis of a reproducible measurement. Re-parses a
// bounded deterministic slice sequentially — no pool contention — and compares.
const determinism = { sliceFiles: 0, identical: 0, differing: 0, diffs: [] as string[] }
{
  const slice = files.filter((f) => f.rel.endsWith(".graphql")).slice(0, 60)
  for (const f of slice) {
    const a: any = await parseFile(f.abs, f.dir).catch(() => null)
    const b: any = await parseFile(f.abs, f.dir).catch(() => null)
    if (!a || !b) continue
    determinism.sliceFiles++
    const ka = JSON.stringify((a.relationships ?? []).map((x: any) => [x.source ?? x.from, x.target ?? x.to, String(x.type ?? x.relationshipType)]))
    const kb = JSON.stringify((b.relationships ?? []).map((x: any) => [x.source ?? x.from, x.target ?? x.to, String(x.type ?? x.relationshipType)]))
    if (ka === kb) determinism.identical++
    else {
      determinism.differing++
      if (determinism.diffs.length < 5) determinism.diffs.push(`${f.repo}/${f.rel}: ${JSON.parse(ka).length} then ${JSON.parse(kb).length}`)
    }
  }
}

// ───────────────────────────────────────────────────────────── report
const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 10000) / 100)
const report = {
  generatedAt: new Date().toISOString(),
  entryPoint: "parseFile (src/ast/pool-worker.ts) — NOT analyze()",
  population: {
    corpusRoot: CR,
    admittedFiles: files.length,
    filesParsed,
    filesWithParseError,
    admissionRule: "git ls-files, size <= 512 KB, detectLanguageFromPath === graphql — identical to ontology-coverage-gate.ts",
    repos: Object.entries(files.reduce<Record<string, number>>((a, f) => { a[f.repo] = (a[f.repo] ?? 0) + 1; return a }, {}))
      .sort((a, b) => b[1] - a[1]).map(([repo, n]) => ({ repo, files: n })),
  },
  totals: {
    symbols: totalSymbols,
    relationships: totalRelationships,
    filesWithZeroRelationships,
    projectDistinctNames: projectNames.size,
    projectUniquelyNamedSymbols: uniq.size,
  },
  kinds: Object.fromEntries([...kindHistogram.entries()].sort((a, b) => b[1] - a[1])),
  emptyNameOrQualifiedName: Object.fromEntries(EMPTY_NAME_OR_KIND),
  relationshipTypesOutsideTheTen: Object.fromEntries([...relTypesOutsideOntology.entries()].sort((a, b) => b[1] - a[1])),
  parseErrors: errorsPerFile.sort((a, b) => b.n - a.n).slice(0, 10),
  determinism: {
    ...determinism,
    question: "does production parseFile return the same relationships for the same bytes twice, sequentially, with no pool contention?",
  },
  types: TYPES.map((t) => {
    const r = rows.get(t)!
    return {
      type: t,
      count: r.count,
      // The CENSUS count — every distinct file the type appeared in, out of the 1,905 admitted.
      distinctFiles: r.allFiles.size,
      // The 4-file SAMPLE the gate's own detail column shows. Named as a sample because it is
      // one, and a reader comparing the two numbers should not mistake 4 for the file count.
      filesSampledForNames: [...r.files].slice(0, 4),
      roles: Object.fromEntries([...r.roles.entries()].sort((a, b) => b[1] - a[1])),
      confidence: {
        measuredEdges: r.confTotal,
        mean: r.confTotal ? Math.round((r.confSum / r.confTotal) * 1000) / 1000 : null,
        below_0_7: r.confBelow07,
        below_0_7_pct: pct(r.confBelow07, r.confTotal),
        histogram: Object.fromEntries([...r.confBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      },
      resolution: {
        bothEndpointsInFile: r.bothInFile,
        bothEndpointsInFile_pct: pct(r.bothInFile, r.count),
        bothEndpointsProjectScope: r.bothProject,
        bothEndpointsProjectScope_pct: pct(r.bothProject, r.count),
        bothEndpointsIncludingSpecVocabulary: r.bothProjectInclSpec,
        bothEndpointsIncludingSpecVocabulary_pct: pct(r.bothProjectInclSpec, r.count),
        endpointBuckets: endpointBucketReport[t] ?? {},
        danglingSamples: [...(dn.get(t) ?? [])].slice(0, 40),
        endpointBucketNote: "every endpoint of every edge of this type, counted once each; buckets sum to 2x count",
        note: t === "exports"
          ? "source is the sentinel `(file)`, counted as bound by design"
          : t === "imports"
            ? "a symbol-set oracle reports this type 0% by construction — the target is a FILE. The meaningful rate is onDisk below."
            : undefined,
      },
      onDisk: t === "imports"
        ? {
            edges: r.count,
            wellFormed: importsWellFormed.n,
            base: "the importing file's own directory — column 5 of the triple buffer",
            namedFileExists: importsFileExists,
            namedFileMissing: importsFileMissing,
            targetUnresolvable: importsUnresolvableSpec,
            resolves_pct: pct(importsFileExists, importsWellFormed.n),
            sameTargetsAgainstRepoRoot: importsExistsAgainstRepoRoot,
            repoRootBasePct: pct(importsExistsAgainstRepoRoot, importsWellFormed.n),
            baseNote:
              "the repo-root row is the base this probe used until it was corrected; `b.graphql` and `c.graphql` are siblings under gql-graphql-tools/packages/import/tests/documents/import-test/default/, so the repo root is the wrong base by construction",
            missingSamples: importsMissingSamples,
          }
        : undefined,
      unknownEndpoints: r.unknownEndpoints,
      samples: r.sampleEdges,
    }
  }),
  definitions: {
    bothEndpointsInFile: "both endpoints bind to a name or qualifiedName in the SAME file's symbol set",
    bothEndpointsProjectScope: "each endpoint binds in its own file, or is a bare name exactly ONE project symbol carries — the store's own bare-name fallback",
    below_0_7: "the contract requires heuristic edges to be countable; the gate does not separate them, this does",
  },
}

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "production-six-questions.json"), JSON.stringify(report, null, 1))
console.log(JSON.stringify({
  admittedFiles: files.length, filesParsed, filesWithParseError,
  symbols: totalSymbols, relationships: totalRelationships,
  types: report.types.map((t) => `${t.type} ${t.count} inFile ${t.resolution.bothEndpointsInFile_pct}% proj ${t.resolution.bothEndpointsProjectScope_pct}% lo07 ${t.confidence.below_0_7_pct}%`),
}, null, 1))