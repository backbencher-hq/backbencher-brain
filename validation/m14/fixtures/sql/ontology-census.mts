/**
 * SQL ONTOLOGY CENSUS — every count this lane's verdicts rest on.
 *
 * WHY THIS EXISTS, and why it is not the coverage gate.
 *
 * `script/m14/ontology-coverage-gate.ts` refuses to report for a language that
 * has no entry in its `RULED_BY_LANG` table (it exits 2 rather than call every
 * un-emitted type RULED-UNJUSTIFIED, which would be a verdict about the table
 * and not about the lane). That table is supervisor-owned, so this lane cannot
 * unblock the arbiter by editing it. This script is the measurement the missing
 * table entry has to be justified by, and it is deliberately the SAME
 * instrument the arbiter uses — production `parseFile`, not `analyze()` — so a
 * number here is a number the arbiter would print.
 *
 * WHY `parseFile` AND NOT `analyze()`. `analyze()` is a per-file unit: it skips
 * the pool-worker's timeout, its size truncation, its enhancement passes and its
 * `setGrammar` handoff, which is how the SQL recovery passes get their parser.
 * Every count below therefore describes what production emits, including the
 * fallbacks, not what the analyzer class would emit if called directly.
 *
 * WHAT IS COUNTED. For the whole admitted corpus:
 *   - relationship type -> edge count, files, and per-type confidence/label
 *     census (the six questions 2, 4 and 6)
 *   - SymbolKind values actually emitted, with empty/unknown flagged
 *   - symbols with an empty name (standing rule R1)
 *   - relationship endpoints equal to the literal `unknown` (R7)
 *   - endpoint resolution per type, BOTH intra-file and corpus-wide (question 5)
 *
 * RESOLUTION, and why both rates are printed. The analyzer emits per-file
 * relationship arrays with bare names, so "resolved" has two honest meanings:
 * the target is declared in the SAME file, or in ANY admitted file. A consumer
 * running bb_graph is cross-file, so the corpus-wide rate is the one that
 * predicts a dangling edge; the intra-file rate is the one that predicts a
 * mis-scoped analyzer. Printing only one would hide whichever half is worse.
 * `global` is the analyzer's synthetic owner for anonymous queries and is not a
 * symbol by construction, so it is counted and reported, never scored as
 * unresolved.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/ontology-census.mts [--limit N] [--out FILE]
 *   npx tsx validation/m14/fixtures/sql/ontology-census.mts --shards N --shard I --out FILE
 *   npx tsx validation/m14/fixtures/sql/ontology-census.mts --merge FILE... --out FILE
 *
 * WHY SHARDS EXIST, and it is a measurement rather than a precaution. Pass 3 was killed four times by
 * four DIFFERENT files (`day03.sql`, `day11.sql`, `day04.sql`, `day01.sql`), and each kill cost a
 * full corpus walk. The obvious reading — "those files are bad" — was then tested and is FALSE:
 * all 25 `duckdb/benchmark/aoc24/queries/day*.sql` parse solo in 0.7–7.6 s with no fault, and across
 * 4 rounds of 8-way contended parsing of exactly those 25 files, 0 faults and 0 hangs
 * (`measurements/pass3-fault-solo.json`, `measurements/pass3-fault-contended-r1..4.json`). So the
 * fault is not a property of a file and not a property of concurrency alone — it emerges from
 * SUSTAINED wasm state over a long walk, and therefore WHICH file faults moves between runs.
 *
 * The consequence is that name-based `--exclude` can never make this measurement reliable: it is a
 * list of the files that happened to fault on the day, and pass 2's three-name list grew to six by
 * pass 3 precisely because each run added one. The fix that does not chase the list is to bound the
 * process: each shard walks a slice, writes what it saw as JSONL, and exits. A shard that faults
 * kills only its own slice and is re-run; a shard that completes contributes a count that does not
 * depend on how long the process lived.
 *
 * The merge is a separate mode rather than an in-process aggregation because corpus-wide target
 * resolution needs the GLOBAL name set, which no single shard can have. So shards emit raw per-file
 * rows and the merge does the resolution — which also makes the reproducibility check free: run the
 * shards twice and diff the merged totals.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, appendFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "sql"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : Infinity
const OUT = argOf("--out")
const SHARDS = argOf("--shards") ? Number(argOf("--shards")) : 1
const SHARD = argOf("--shard") ? Number(argOf("--shard")) : 0
const MERGE_INPUTS: string[] = []
{
  // Every non-flag argument after `--merge` is an input. A `MERGE_INPUTS.push(argv[++i])` that fires
  // once collected only the FIRST path and silently ignored the rest, which is how pass 3's first
  // merge reported 244 of 1,951 rows as though 244 were the corpus.
  const at = argv.indexOf("--merge")
  if (at >= 0) for (let i = at + 1; i < argv.length; i++) { const a = argv[i]; if (a.startsWith("--")) break; MERGE_INPUTS.push(a) }
}

// ------------------------------------------------------------------ discovery
//
// Identical to the arbiter's discovery, so the two describe the same file set:
// git-tracked files under the corpus root, <= 512 KB, routed to this language by
// PRODUCTION's own `detectLanguageFromPath` (content heuristics included).
const SIZE_CAP = 512 * 1024
const admitted: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const entry of readdirSync(CR)) {
  const dir = path.join(CR, entry)
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
    let text: string
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ repo: entry, dir, rel, abs, text })
  }
}

/**
 * Files EXCLUDED from the walk, and why — recorded in the artifact, never applied silently.
 *
 * `--exclude <path-suffix>` is repeatable and matched as a path suffix. It exists for exactly one
 * measured reason: `src/ast/engine.ts:1411` installs a 120-second self-destruct timer around the
 * SYNCHRONOUS `parser.parse(content)` call and answers a hang with `process.exit(1)`, because
 * setTimeout cannot interrupt blocked C/WASM code and the indexer is incremental. So one corpus
 * file does not fail — it kills the whole process, and with it any instrument built on the
 * production entry point:
 *
 *   [BB-PARSE-ERR] sql | …/duckdb/extension/tpcds/dsdgen/queries/83.sql | memory access out of bounds
 *   [BB-HANG] parser stuck 120s on …/duckdb/extension/tpcds/dsdgen/queries/83.sql — exiting
 *
 * `duckdb/extension/tpcds/dsdgen/queries/83.sql` is the file, and the wasm error it reports is a
 * memory-access fault rather than a slow parse, so the hang is the fault's aftermath. Every other
 * corpus walk on this machine would die on it too — including the shared ontology coverage gate,
 * which is why that gate's own refusal (§ above) is reached at all rather than after a partial run.
 *
 * The exclusion is a NUMBER IN THE ARTIFACT (`excluded`), so a reader can see that 1,459 of 1,460
 * admitted files were measured and which one was not. It is not a silent narrowing of the sample:
 * 1 file of 1,460 is 0.068 %, and the file contributes no symbol any other file in the corpus
 * provides.
 *
 * `validation/m14/fixtures/sql/keep-symbol-census.mts` needs no such exclusion: it calls `analyze`
 * and parses the tree itself, so no engine self-destruct timer is in the path.
 */
const EXCLUDE: string[] = []
{
  const arg = "--exclude"
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === arg && argv[i + 1]) EXCLUDE.push(argv[i + 1])
  }
}
const excluded = EXCLUDE.length
  ? admitted.filter((f) => EXCLUDE.some((suf) => f.abs.endsWith(suf))).map((f) => `${f.repo}/${f.rel}`)
  : []
const admittedAfterExclusion = admitted.filter((f) => !EXCLUDE.some((suf) => f.abs.endsWith(suf)))
if (excluded.length !== EXCLUDE.length) {
  console.error(`--exclude matched ${excluded.length} admitted file(s) for ${EXCLUDE.length} pattern(s); no file was dropped silently`)
}

// A DETERMINISTIC slice, not the first N: the corpus is ordered by repo name
// and then by git's own path order, so taking every k-th admitted file spreads
// the sample across repos and sizes instead of exhausting one repo.
const universe = admittedAfterExclusion.length
const pool = admittedAfterExclusion
// Contiguous slices, not interleaved: the fault is a function of how long a process has been alive
// and how much wasm state it has accumulated, so each shard must be a self-contained bounded walk.
// Round-robin (`i % SHARDS`) would give every shard the same age distribution and re-create the
// problem the sharding exists to bound.
const sliceStart = Math.floor((universe * SHARD) / SHARDS)
const sliceEnd = Math.floor((universe * (SHARD + 1)) / SHARDS)
const selected = LIMIT >= universe
  ? pool.slice(sliceStart, sliceEnd)
  : Array.from({ length: LIMIT }, (_, i) => pool[Math.floor((i * universe) / LIMIT)]).slice(sliceStart, sliceEnd)

// ------------------------------------------------------------------ tallies
type TypeRow = {
  edges: number
  files: Set<string>
  examples: string[]
  byMeta: Map<string, number>
  confidence: Map<string, number>
  evidenceClass: Map<string, number>
  srcGlobal: number
  srcResolve: number
  tgtResolveLocal: number
  tgtResolveCorpus: number
  tgtExternal: number
  unresolvedNames: Map<string, number>
}
const rows = new Map<Type, TypeRow>()
for (const t of ALL_TYPES) {
  rows.set(t, {
    edges: 0,
    files: new Set(),
    examples: [],
    byMeta: new Map(),
    confidence: new Map(),
    evidenceClass: new Map(),
    srcGlobal: 0,
    srcResolve: 0,
    tgtResolveLocal: 0,
    tgtResolveCorpus: 0,
    tgtExternal: 0,
    unresolvedNames: new Map(),
  })
}
const otherTypes = new Map<string, { n: number; examples: string[] }>()

const kindCensus = new Map<string, number>()
const kindExamples = new Map<string, string>()
const emptyNameSymbols: string[] = []
const unknownEndpoints: string[] = []
const corpusNames = new Set<string>()
const filesWithSymbols = new Set<string>()
const filesWithRelationships = new Set<string>()
let parsed = 0
let parseFailures = 0
let emptyFiles = 0
let symbolsTotal = 0
let relationshipsTotal = 0
const perFile: { file: string; symbols: number; relationships: number }[] = []
const bumpedByDegradation: { file: string; class: string }[] = []
const recoveredSerially: string[] = []
const stillTimedOut: string[] = []
const degradedStructural: string[] = []

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

// Pass 1 is required for the corpus-wide name set: an edge in file 1 can target a
// table declared in file 900. Two passes means parsing twice, so pass 1 runs
// `analyze`-free name extraction — it calls parseFile and caches nothing but the
// names, which is the same cost as pass 2 for a small corpus and is CORRECT.
// To avoid the double parse the passes are fused instead: parse every file
// once, buffer the relationships, and resolve after the last file is read.
type Buffered = { file: string; dir: string; type: Type; source: string; target: string; confidence: number; evidenceClass: string; metaKeys: string[]; external?: string }[]
const buffered: Buffered[] = []
const perFileNames = new Map<string, Set<string>>()

/**
 * WAS A FILE DEGRADED BY THE ENGINE'S PER-FILE TIMEOUT? — measured, not assumed.
 *
 * `src/ast/engine.ts:1717` answers its own 120-second analyzer timeout by returning a **basic parse
 * result** rather than an error: `symbols: []`, `relationships: []`, one `errors[]` entry, and
 * `metadata.analysisVersion: "2.0-basic-fallback"`. The object is a SUCCESS to every caller that
 * only looks at `symbols.length`, so a timed-out file is silently indistinguishable from a file
 * that genuinely declares nothing — and this census, in its pass-2 shape, reported exactly that:
 * `parse failures 0` on a run in which three admitted files had crossed the timeout and
 * contributed nothing. That is a false statement about the corpus produced by a successful run,
 * and it is why the pass-2 numbers could not be reproduced from the same HEAD.
 *
 * No regex (per the lane policy): the markers are lowercased substring tests.
 *
 * TWO degradation classes, kept apart because they are opposite findings and conflating them hides
 * one behind the other:
 *
 *   `timeout`   — `engine.ts:1717` answers its 120-second analyzer timeout with a SUCCESS-shaped
 *                 basic parse result (`symbols: []`, `relationships: []`, one `errors[]` entry,
 *                 `metadata.analysisVersion: "2.0-basic-fallback"`). A LOAD policy.
 *   `regexFallback` — `pool-worker.parseFile`'s catch returns `extractFallback(…)` for ANY parse
 *                 error, and `extractFallback` is the language-agnostic **REGEX** extractor. All
 *                 five files this census measured as `fallback: true` are under 20 KB, so this is
 *                 NOT the >1 MB size policy: it is a real parse error answered with regex output.
 *                 A regex extractor's edges are not the analyzer's edges, and the lane's own policy
 *                 forbids regex-derived facts, so such a result is never absorbed — it is re-parsed
 *                 serially, and if it still falls back the file is EXCLUDED from the denominator and
 *                 named in the artifact rather than counted as a file that declares nothing.
 */
function degradationOf(r: any): "timeout" | "regexFallback" | null {
  if (!r) return "timeout"
  const errs: any[] = Array.isArray(r.errors) ? r.errors : []
  for (const e of errs) {
    const m = String(e?.message ?? "").toLowerCase()
    if (m.includes("timeout")) return "timeout"
  }
  const av = String(r?.metadata?.analysisVersion ?? "")
  if (av === "2.0-basic-fallback") return "timeout"
  if (r.fallback === true) return "regexFallback"
  return null
}

type Admitted = (typeof admitted)[number]
const needsRepair: { f: Admitted; deg: "timeout" | "regexFallback" }[] = []
const shardDegradations: any[] = []
const measuredLabels = new Set<string>()

function absorb(f: Admitted, r: any, labelOverride?: string) {
  parsed++
  // A shard row carries the label it was written with. Re-deriving it from `f.repo`/`f.rel` — which a
  // replayed row does not have — silently labelled every replayed file `undefined/undefined`, so
  // every file collapsed onto one Set entry and the resolution tallies answered a different question.
  const label = labelOverride ?? `${f.repo}/${f.rel}`
  const symbols: any[] = Array.isArray(r?.symbols) ? r.symbols : []
  const relationships: any[] = Array.isArray(r?.relationships) ? r.relationships : []
  symbolsTotal += symbols.length
  relationshipsTotal += relationships.length
  const names = new Set<string>()
  perFileNames.set(label, names)

  for (const s of symbols) {
    const name = String(s?.name ?? "")
    if (name.trim().length === 0) emptyNameSymbols.push(label)
    else { names.add(name); corpusNames.add(name) }
    const kind = String(s?.kind ?? "")
    bump(kindCensus, kind)
    if (!kindExamples.has(kind)) kindExamples.set(kind, label)
  }
  if (symbols.length > 0) filesWithSymbols.add(label)
  if (relationships.length > 0) filesWithRelationships.add(label)
  if (symbols.length === 0 && relationships.length === 0) emptyFiles++
  perFile.push({ file: label, symbols: symbols.length, relationships: relationships.length })

  for (const rel of relationships) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "").toLowerCase() as Type
    const source = String(rel?.source ?? rel?.from ?? "")
    const target = String(rel?.target ?? rel?.to ?? "")
    const confidence = typeof rel?.confidence === "number" ? rel.confidence : Number.NaN
    const meta = (rel?.metadata ?? {}) as Record<string, any>
    const evidenceClass = String(meta.evidenceClass ?? "(absent)")
    if (source === "unknown" || target === "unknown") {
      unknownEndpoints.push(`${type} ${source}->${target} in ${label}`)
    }
    if (!ALL_TYPES.includes(type)) {
      const o = otherTypes.get(type) ?? { n: 0, examples: [] }
      o.n++
      if (o.examples.length < 3) o.examples.push(`${source}->${target}`)
      otherTypes.set(type, o)
      continue
    }
    const row = rows.get(type)!
    row.edges++
    row.files.add(label)
    if (row.examples.length < 6) row.examples.push(`${source}->${target}`)
    const role = Object.keys(meta).sort().join(",") || "(none)"
    bump(row.byMeta, role)
    bump(row.confidence, Number.isNaN(confidence) ? "(absent)" : String(confidence))
    bump(row.evidenceClass, evidenceClass)
    buffered.push({
      file: label,
      dir: f.dir,
      type,
      source,
      target,
      confidence,
      evidenceClass,
      metaKeys: Object.keys(meta),
      external: meta.external ? String(meta.external) : undefined,
    })
  }

  // The shard row. Everything the tallies above consume, and nothing else: the census reads names,
  // kinds, endpoints, confidence, the evidence tier and the metadata KEY SET, so emitting more would
  // make the artifact larger for no measurement. Appended per file, so a shard that faults
  // half-way leaves the rows it did finish on disk instead of taking them with it.
  if (SHARD_JSONL) {
    appendFileSync(
      SHARD_JSONL,
      JSON.stringify({
        file: label,
        dir: f.dir,
        symbols: symbols.map((s: any) => ({ name: String(s?.name ?? ""), kind: String(s?.kind ?? "") })),
        rels: relationships.map((rel: any) => {
          const m = (rel?.metadata ?? {}) as Record<string, any>
          return {
            type: String(rel?.type ?? rel?.relationshipType ?? "").toLowerCase(),
            source: String(rel?.source ?? rel?.from ?? ""),
            target: String(rel?.target ?? rel?.to ?? ""),
            confidence: typeof rel?.confidence === "number" ? rel.confidence : null,
            evidenceClass: String(m.evidenceClass ?? "(absent)"),
            metaKeys: Object.keys(m).sort(),
            external: m.external ? String(m.external) : undefined,
          }
        }),
      }) + "\n",
    )
  }
}

const SHARD_JSONL =
  MERGE_INPUTS.length === 0 && SHARDS > 1 && OUT ? `${OUT}.shard${SHARD}.jsonl` : null
if (SHARD_JSONL) writeFileSync(SHARD_JSONL, "")

let idx = 0
const completed: { f: Admitted; r: any }[] = []
async function worker() {
  for (;;) {
    const i = idx++
    if (i >= selected.length) return
    const f = selected[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      parseFailures++
      continue
    }
    // A degraded result is NOT absorbed here. It is queued for the serial repair pass below,
    // because the repair must not race itself: eight concurrent retries lose the same CPU race
    // eight times, which is how a timeout becomes permanent in the artifact.
    const deg = degradationOf(r)
    if (deg !== null) { needsRepair.push({ f, deg }); continue }
    // Buffered, not absorbed here. Eight workers finish in whatever order the machine lets them,
    // and the order-dependent tallies (`examples`, `firstFile`) would then record a timing sample.
    // The buffer is drained in FILE order after the pool drains; see the merge-mode note below.
    completed.push({ f, r })
  }
}

if (MERGE_INPUTS.length > 0) {
  // MERGE MODE. No parsing happens: the shard rows are replayed through the same `absorb`, so the
  // merged totals come from the tally code rather than from a second implementation of it that
  // could drift. `f` is reconstructed with the fields absorb reads, which are `dir` (for the
  // buffered row) and nothing else.
  //
  // ROWS ARE REPLAYED IN FILE ORDER, NOT IN THE ORDER THE SHARD WROTE THEM. Added at pass 9.
  // A shard parses its slice with EIGHT concurrent workers (`worker()` below) and appends each row
  // as that file COMPLETES, so the row order in a shard file is completion order and carries the
  // machine's timing. Replaying that order made every COUNT reproducible — they are order-independent
  // — and every ORDER-DEPENDENT field a timing sample. `perType.*.examples` keeps the FIRST 6 edges
  // of its type and `symbolKinds[].firstFile` keeps the FIRST file to declare a kind, so both are
  // "whichever finished first". Measured at pass 9 on the same 1,955 files at the same HEAD: the
  // numeric leaves were byte-identical across passes 7, 8 and 9 over 247 numeric leaf paths, while
  // two artifacts' `examples` lists differed in 29 places. A reader diffing them had no way to tell
  // that from a regression, and this page's own reproducibility claim is a claim about SELECTED
  // keys, so it could not warn them either. Sorting here costs one array sort, changes no count
  // (proved by the 0-difference measurement above), and makes the whole artifact reproducible.
  const dataRows: { label: string; row: any }[] = []
  const degradationRows: any[] = []
  for (const src of MERGE_INPUTS) {
    const text = readFileSync(src, "utf8")
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      const row = JSON.parse(line)
      if (row.__shardDegradation__) { degradationRows.push(row.__shardDegradation__); continue }
      dataRows.push({ label: String(row.file), row })
    }
  }
  // Degradation metadata is keyed by shard index so its array order is a function of the shard
  // layout rather than of the order the shard happened to flush its trailer in.
  degradationRows.sort((a, b) => (a.shard ?? 0) - (b.shard ?? 0))
  for (const d of degradationRows) {
    shardDegradations.push(d)
    bumpedByDegradation.push(...(d.firstPass ?? []))
    recoveredSerially.push(...(d.recoveredSerially ?? []))
    stillTimedOut.push(...(d.stillDegraded ?? []))
    degradedStructural.push(...(d.regexFallback ?? []))
    parseFailures += d.parseFailures ?? 0
  }
  dataRows.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  for (const { label, row } of dataRows) {
    measuredLabels.add(label)
    absorb({ dir: row.dir } as any, {
      symbols: row.symbols,
      relationships: row.rels.map((rel: any) => ({
        type: rel.type,
        source: rel.source,
        target: rel.target,
        confidence: rel.confidence,
        metadata: Object.fromEntries([
          ...rel.metaKeys.map((k: string) => [k, k === "evidenceClass" ? rel.evidenceClass : k === "external" ? rel.external : true]),
        ]),
      })),
    }, label)
  }
} else {
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  // Drained in FILE order, so the single-shard path is as reproducible as the merged sharded one.
  completed.sort((a, b) => {
    const x = `${a.f.repo}/${a.f.rel}`, y = `${b.f.repo}/${b.f.rel}`
    return x < y ? -1 : x > y ? 1 : 0
  })
  for (const { f, r } of completed) absorb(f, r)
}

/**
 * THE SERIAL REPAIR PASS. One file at a time, no pool, twice.
 *
 * A degraded file is a property of the machine's load at the moment it was parsed, not of the
 * corpus — measured, not assumed: on pass 3's first instrumented run, 5 files timed out under 8-way
 * concurrency, 4 of them parsed cleanly on an immediate in-place retry, and 1 (`big_schema.sql`)
 * did not. Files that fall back to the regex extractor are repaired the same way for the same
 * reason. Whatever still degrades after two solo attempts is EXCLUDED and named, so the artifact
 * states which files were not measured instead of reporting a smaller corpus as though it were the
 * whole one.
 */
for (const item of needsRepair) {
  const { f } = item
  const label = `${f.repo}/${f.rel}`
  bumpedByDegradation.push({ file: label, class: item.deg })
  let repaired = false
  for (let attempt = 0; attempt < 2 && !repaired; attempt++) {
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      parseFailures++
      break
    }
    const deg = degradationOf(r)
    if (deg === null) { repaired = true; recoveredSerially.push(label); absorb(f, r) }
    else if (deg === "regexFallback") degradedStructural.push(label)
    else stillTimedOut.push(label)
  }
  if (!repaired && !stillTimedOut.includes(label)) stillTimedOut.push(`${label} (unrepairable: ${item.deg})`)
}

// ------------------------------------------------------------------ resolution
//
// INDEPENDENT OF EVERY TALLY ABOVE: which admitted files produced a shard row at all. The difference
// between this set and the admitted set is what the run did not measure, derived from the row files
// rather than from any counter — so a shard that died before writing its trailer still shows up here.
const admittedLabels = new Set(admittedAfterExclusion.map((f) => `${f.repo}/${f.rel}`))
const unmeasured = MERGE_INPUTS.length > 0 ? [...admittedLabels].filter((l) => !measuredLabels.has(l)) : []

for (const b of buffered) {
  const row = rows.get(b.type)!
  const local = perFileNames.get(b.file)!
  if (b.source === "global") row.srcGlobal++
  else if (local.has(b.source) || corpusNames.has(b.source)) row.srcResolve++
  if (local.has(b.target)) { row.tgtResolveLocal++; row.tgtResolveCorpus++; continue }
  if (corpusNames.has(b.target)) { row.tgtResolveCorpus++; continue }
  if (b.external) { row.tgtExternal++; continue }
  bump(row.unresolvedNames, b.target)
}

// ------------------------------------------------------------------ report
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(2)}%`)
const top = (m: Map<string, number>, n = 8) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}=${v}`).join(" ")

const report: any = {
  instrument: "validation/m14/fixtures/sql/ontology-census.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  mode: MERGE_INPUTS.length > 0 ? { merge: MERGE_INPUTS } : { shard: SHARD, shards: SHARDS, shardRowFile: SHARD_JSONL },
  corpusRoot: CR,
  corpusRepos: readdirSync(CR).length,
  admittedFilesTotal: universe,
  admittedFilesMeasured: parsed,
  excluded,
  exclusionReason: excluded.length
    ? "src/ast/engine.ts:1411 answers a 120s synchronous parser.parse() hang with process.exit(1), so one file kills any parseFile-based walk. See the exclusion block above; the count of admitted files actually measured is admittedFilesTotal."
    : undefined,
  sampledFiles: selected.length,
  filesWithNoShardRow: unmeasured,
  filesWithNoShardRowNote:
    "admitted files that produced NO shard row — derived from the row files, not from a counter, so a shard that died before its trailer still appears here",
  shardDegradations,
  sampling:
    LIMIT < universe
      ? `deterministic every-k slice, k=${(universe / LIMIT).toFixed(2)}`
      : MERGE_INPUTS.length > 0
        ? "all admitted files, replayed from shard rows"
        : SHARDS > 1
          ? `all admitted files, contiguous shard ${SHARD} of ${SHARDS}`
          : "all admitted files",
  sizeCapBytes: SIZE_CAP,
  parsed,
  parseFailures,
  // PASS-3 INSTRUMENT FIX. `parsed` used to count a file the engine's 120s analyzer timeout had
  // already degraded to a basic parse result, so `parseFailures: 0` could be printed by a run in
  // which files had silently contributed nothing. These three fields are the disclosure that makes
  // `parsed` mean what it says.
  degradedByTimeout: {
    firstPass: bumpedByDegradation,
    recoveredSerially,
    stillDegradedAndExcludedFromDenominator: stillTimedOut,
    detection: "errors[].message contains 'timeout' (case-folded), or metadata.analysisVersion === '2.0-basic-fallback'",
    why: "engine.ts answers its analyzer timeout with a SUCCESS-shaped basic parse result (symbols: [], relationships: [], one error), so a degraded file is indistinguishable from a file that declares nothing unless the marker is checked",
  },
  degradedToRegexFallback: {
    files: degradedStructural,
    repairedSerially: recoveredSerially.filter((f) => !stillTimedOut.includes(f)),
    why: "pool-worker's catch returns extractFallback — the language-agnostic REGEX extractor — for ANY parse error, and it is not the >1MB size policy: every file observed here is under 20 KB. A regex extractor's edges are not the analyzer's edges, so the result is never absorbed into the ontology counts",
  },
  filesYieldingNoSymbolsAndNoRelationships: emptyFiles,
  filesWithSymbols: filesWithSymbols.size,
  filesWithRelationships: filesWithRelationships.size,
  symbols: symbolsTotal,
  relationships: relationshipsTotal,
  distinctSymbolNames: corpusNames.size,
  emptyNamedSymbols: emptyNameSymbols.length,
  emptyNamedSymbolFiles: [...new Set(emptyNameSymbols)].slice(0, 5),
  unknownEndpoints: unknownEndpoints.length,
  unknownEndpointExamples: unknownEndpoints.slice(0, 8),
  symbolKinds: [...kindCensus.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ kind: k || "(empty)", n, firstFile: kindExamples.get(k) })),
  nonOntologyRelationshipTypes: [...otherTypes.entries()].map(([k, v]) => ({ type: k, n: v.n, examples: v.examples })),
  perType: {},
}

console.log("SQL ontology census — production parseFile")
console.log(`corpus root      ${CR}`)
console.log(`admitted files   ${universe}   sampled ${selected.length} (${report.sampling})`)
console.log(`parsed ok        ${parsed}   parse failures ${parseFailures}`)
console.log(`degraded         ${bumpedByDegradation.length} (recovered serially ${recoveredSerially.length}, still degraded ${stillTimedOut.length})   regex-fallback files ${degradedStructural.length}`)
console.log(`symbols          ${symbolsTotal}   relationships ${relationshipsTotal}`)
console.log(`files w/ symbols ${filesWithSymbols.size}   files w/ relationships ${filesWithRelationships.size}   files yielding nothing ${emptyFiles}`)
console.log("")
console.log("per type")
console.log("-".repeat(150))
console.log(`${"type".padEnd(14)}${"edges".padStart(9)}${"files".padStart(7)}${"srcGlobal".padStart(11)}${"tgtLocal".padStart(11)}${"tgtCorpus".padStart(11)}${"external".padStart(10)}${"tgtUnres".padStart(10)}  confidence / evidenceClass`)
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  const unres = [...r.unresolvedNames.values()].reduce((a, b) => a + b, 0)
  console.log(
    `${t.padEnd(14)}${String(r.edges).padStart(9)}${String(r.files.size).padStart(7)}` +
    `${String(r.srcGlobal).padStart(11)}${pct(r.tgtResolveLocal, r.edges).padStart(11)}${pct(r.tgtResolveCorpus, r.edges).padStart(11)}` +
    `${String(r.tgtExternal).padStart(10)}${String(unres).padStart(10)}  ${top(r.confidence, 3)} | ${top(r.evidenceClass, 2)}`,
  )
  report.perType[t] = {
    edges: r.edges,
    /**
     * `filesTotal` is the COUNT and `files` is a sample of at most 8 paths. The count was measured
     * all along and printed by the console table above, but only the 8-example sample reached the
     * JSON, so a reader of the artifact could not check the per-type file counts this lane's
     * documentation quotes — the figures were true and unverifiable from the artifact that
     * produced them. A capped list whose true length is not recorded is indistinguishable from a
     * count of 8, which is the failure the honesty contract calls a count that is not a count.
     */
    filesTotal: r.files.size,
    files: [...r.files].slice(0, 8),
    filesSampleCappedAt: 8,
    examples: r.examples,
    sourceGlobal: r.srcGlobal,
    sourceResolved: r.srcResolve,
    targetResolvedIntraFile: r.tgtResolveLocal,
    targetResolvedCorpusWide: r.tgtResolveCorpus,
    targetLabelledExternal: r.tgtExternal,
    targetUnresolved: unres,
    resolutionIntraFilePct: r.edges ? Number(((r.tgtResolveLocal / r.edges) * 100).toFixed(2)) : null,
    resolutionCorpusWidePct: r.edges ? Number(((r.tgtResolveCorpus / r.edges) * 100).toFixed(2)) : null,
    confidence: Object.fromEntries(r.confidence),
    evidenceClass: Object.fromEntries(r.evidenceClass),
    metadataRoles: Object.fromEntries(r.byMeta),
    // [name, count] pairs serialise as bare arrays, so every consumer that read `x.name` got
    // `undefined` for all twelve entries and the artifact's unresolved-target list was unreadable
    // while looking well-formed. Named, and asserted on the way out.
    topUnresolvedNames: [...r.unresolvedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => ({ name, n })),
  }
}
console.log("-".repeat(150))
console.log("")
console.log(`empty-named symbols: ${emptyNameSymbols.length}`)
console.log(`endpoints equal to the literal 'unknown': ${unknownEndpoints.length}`)
if (unknownEndpoints.length) console.log(`  e.g. ${unknownEndpoints.slice(0, 5).join(" | ")}`)
console.log("")
console.log("SymbolKind census")
for (const k of [...kindCensus.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(k[0] || "(EMPTY)").padEnd(14)} ${String(k[1]).padStart(8)}   first: ${kindExamples.get(k[0])}`)
}
console.log("")
console.log("metadata role census per type")
for (const t of ALL_TYPES) {
  const r = rows.get(t)!
  if (r.edges === 0) continue
  console.log(`  ${t}: ${top(r.byMeta, 10)}`)
}
if (otherTypes.size) {
  console.log("")
  console.log("relationship types OUTSIDE the ontology")
  for (const [k, v] of otherTypes) console.log(`  ${k}: ${v.n}   e.g. ${v.examples.join(" ; ")}`)
}

if (SHARD_JSONL) {
  // The shard's OWN degradation record, appended as a trailer. Without it the merge can see which
  // files produced rows but not WHY any file did not, so a shard that lost four files to the engine's
  // timeout would merge into a census that silently claims the whole corpus.
  appendFileSync(
    SHARD_JSONL,
    JSON.stringify({
      __shardDegradation__: {
        shard: SHARD,
        shards: SHARDS,
        admitted: selected.length,
        absorbed: parsed,
        firstPass: bumpedByDegradation,
        recoveredSerially,
        stillDegraded: stillTimedOut,
        regexFallback: degradedStructural,
        parseFailures,
      },
    }) + "\n",
  )
}

if (MERGE_INPUTS.length > 0 && measuredLabels.size === 0) {
  // "An empty result over a non-empty corpus is a failed check, not a pass." A merge that reads no
  // rows must not go on to print a well-formed census of nothing — which is exactly what
  // `--merge /dev/null` produced on pass 3: a report with 0 symbols, 0 relationships and
  // `admittedFilesTotal: 1955` side by side, which is a false statement about the corpus.
  console.error(`merge read 0 file rows from ${MERGE_INPUTS.length} input(s); refusing to report a census of nothing`)
  process.exit(2)
}

if (OUT) {
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
  // A shard's report goes to `<out>.shardN.json`, never to `<out>`: eight shards and one merge all
  // receive the SAME `--out`, so writing shards to `<out>` makes whichever shard ran last silently
  // become the census — which is exactly what happened on pass 3's first sharded run, and the merged
  // artifact was never written because the merged report was overwritten by shard 7's.
  const outPath = MERGE_INPUTS.length > 0 || SHARDS <= 1 ? OUT : `${OUT}.shard${SHARD}.json`
  writeFileSync(path.resolve(outPath), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\nwrote ${outPath}`)
}