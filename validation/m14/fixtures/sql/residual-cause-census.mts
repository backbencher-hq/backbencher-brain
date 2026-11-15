/**
 * SQL RESIDUAL CAUSE CENSUS — bucket the incoming gate's `unresolved` edges by NAMED CAUSE.
 *
 * ## WHY THIS EXISTS
 *
 * `script/m14/incoming-gate.ts` reports `unresolved 1577` for this lane and is correct about the
 * count, but a count is not a cause. Clause 2 of the standard requires every unresolved edge to be
 * classified by a NAMED CAUSE with a measured count, and the gate's own worklist prints at most 25
 * sample NAMES per type — the remaining 1,400 are "omitted by the cap and never collected"
 * (its own words). This census collects them.
 *
 * ## THE POPULATION IS THE GATE'S OWN, NOT A COPY OF IT
 *
 * The file list is produced by running the gate itself with `BB_LIST_FILES=1`, which prints the
 * exact stride sample it would measure and exits before parsing. A probe that discovered its own
 * files could disagree with the gate about the population, and every count below would then be a
 * number about a different question. The file list is an INPUT to this script.
 *
 * ## THE OUTCOME PER EDGE IS THE GATE'S OWN RULE, IMPORTED
 *
 * `classifyEdge` / `externalClaimOf` come from `script/m14/incoming-rule.ts` — the shared module
 * both the gate and its censuses read. The resolution rule is NOT re-implemented here: the two
 * mistakes this programme has already paid for (kind-count read as declaration-count; a copied
 * published-map rule) both came from a census that kept its own copy of a rule.
 *
 * ## WHAT IS ADDED, AND ONLY THIS
 *
 * For each edge whose outcome is `unresolved`, WHERE the target would have had to be declared for
 * the edge to answer, which is a fact about this run's key space plus the file's own text:
 *
 *   queryLocalBinding   the edge's own file BINDS this name in a query-local scope (a CTE or a
 *                       derived-table alias) and no file declares it — a query-local name read as
 *                       a database object.
 *   ownFileDeclares     the edge's own file declares it but the string did not bind — a spelling
 *                       mismatch, not a missing declaration.
 *   projectElsewhere    another file of the SAME PROJECT (outside this run's sampled set) declares
 *                       it. Measured against the project's UNSAMPLED admitted list, which is the
 *                       fact the gate prints as "SAMPLE, NOT POPULATION".
 *   extKind:<kind>      the analyzer ALREADY computed a named external kind and published it on
 *                       `metadata.external` as a string, a spelling the arbiter cannot read
 *                       (`incoming-rule.ts:462` requires `=== true`).
 *   absentEverywhere    nothing in the project (sampled or admitted) declares it and no local
 *                       binding names it: the genuine hole.
 *
 * USAGE:
 *   bun validation/m14/fixtures/sql/residual-cause-census.mts \
 *     --filelist FILE --out FILE [--limit N] [--tsv FILE]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge, type ProjectFacts } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : undefined
}
const FILELIST = flag("--filelist")
const OUT = flag("--out")
const TSV = flag("--tsv")
const LIMIT = Number(flag("--limit") ?? 0) || 0
if (!FILELIST || !OUT) {
  console.error("usage: residual-cause-census.mts --filelist FILE --out FILE [--limit N] [--tsv FILE]")
  process.exit(2)
}

// THE SAMPLE THE GATE MEASURED — read, never re-derived.
const sampled: string[] = []
for (const line of readFileSync(FILELIST, "utf8").split("\n")) {
  const t = line.trim()
  if (t.startsWith("BB_LIST_FILES_FILE:")) sampled.push(t.slice("BB_LIST_FILES_FILE:".length).trim())
}
const files = LIMIT > 0 ? sampled.slice(0, LIMIT) : sampled
const repoOf = (f: string): string => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])

/**
 * THE PROJECT'S OWN ADMITTED FILE LIST — the `git ls-files` set, filtered the way the gate filters
 * it, so "declared in another file of the same project" is a claim about files that EXIST rather
 * than about files this run happened to draw. Built per repo, once.
 */
const admitByExtension = (rel: string, exts: string[]): boolean => {
  const base = path.basename(rel)
  const dot = base.lastIndexOf(".")
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ""
  return exts.includes(ext) || exts.includes(base.toLowerCase())
}
/** The gate's SIZE_CAP is part of its population claim (its header says so), so the "does the
 *  project declare this somewhere the run did not sample" arm must use the SAME cap: a 3.7 MB
 *  file is not in the population the gate measured, and counting it here would answer a question
 *  about a population the gate never claimed. */
const SIZE_CAP = 1024 * 1024
const admittedByRepo = new Map<string, string[]>()
{
  let entries: string[] = []
  try { entries = readdirSync(CR) } catch { entries = [] }
  for (const name of entries) {
    const dir = path.join(CR, name)
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    admittedByRepo.set(dir, tracked
      .filter((rel) => admitByExtension(rel, ["sql"]))
      .map((rel) => path.join(dir, rel))
      .filter((abs) => { try { return readFileSync(abs).length <= SIZE_CAP } catch { return false } }))
  }
}

type KeyFacts = { count: number; kinds: Set<string>; files: Set<string> }
type KeySpace = Map<string, KeyFacts>
const bump = (space: KeySpace, key: string, kind: string, file: string): void => {
  let f = space.get(key)
  if (!f) space.set(key, (f = { count: 0, kinds: new Set(), files: new Set() }))
  f.count++
  f.kinds.add(kind)
  f.files.add(file)
}

// ── WALK THE SAMPLED POPULATION, exactly as the gate walks it ────────────────────────────────
const projectSpace = new Map<string, KeySpace>()
const pooled: KeySpace = new Map()
const fileText = new Map<string, string>()
type Edge = {
  label: string; src: string; srcFile: string; line: number | null; tgt: string
  md: Record<string, unknown>; claim: ReturnType<typeof externalClaimOf>
  repo: string; outcome: string; decls: number
}
const edges: Edge[] = []
let parsed = 0, failed = 0

const CONC = 8
for (let i = 0; i < files.length; i += CONC) {
  const batch = files.slice(i, i + CONC)
  const results = await Promise.all(batch.map(async (f) => {
    try { return { f, r: await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } } catch { return { f, r: null } }
  }))
  for (const { f, r } of results) {
    if (!r) { failed++; continue }
    parsed++
    const repo = repoOf(f)
    let space = projectSpace.get(repo)
    if (!space) projectSpace.set(repo, (space = new Map()))
    try { fileText.set(f, readFileSync(f, "utf8")) } catch { /* a file that cannot be read declares nothing */ }
    for (const s of (r as any).symbols ?? []) {
      const name = String(s?.name ?? "")
      if (!name) continue
      const kind = String(s?.kind ?? "")
      bump(space, name, kind, f)
      bump(pooled, name, kind, f)
      const q = String(s?.qualifiedName ?? "")
      if (q && q !== name) { bump(space, q, kind, f); bump(pooled, q, kind, f) }
    }
    for (const rel of (r as any).relationships ?? []) {
      const label = String(rel?.type ?? "")
      const tgt = String(rel?.target ?? rel?.to ?? "")
      if (!label || !tgt) continue
      const md = (rel?.metadata ?? {}) as Record<string, unknown>
      edges.push({
        label, src: String(rel?.source ?? ""), srcFile: f,
        line: typeof rel?.line === "number" ? rel.line : null,
        tgt, md, claim: externalClaimOf(rel), repo, outcome: "", decls: 0,
      })
    }
  }
  if (i % 80 === 0) console.error(`  … ${i + batch.length}/${files.length} parsed`)
}

// ── OUTCOME PER EDGE, through the gate's own rule ────────────────────────────────────────────
const projected = new Map<string, KeySpace>()
for (const [repo, space] of projectSpace) {
  const p: KeySpace = new Map()
  for (const [k, v] of space) p.set(k, v)
  projected.set(repo, p)
}
const asDecl = (space: KeySpace): Map<string, number> => new Map([...space].map(([k, v]) => [k, v.count]))
const asKinds = (space: KeySpace): Map<string, Set<string>> => new Map([...space].map(([k, v]) => [k, v.kinds]))
const pooledDecl = asDecl(pooled), pooledKinds = asKinds(pooled)
const projDecl = new Map([...projected].map(([r, s]) => [r, asDecl(s)]))
const projKinds = new Map([...projected].map(([r, s]) => [r, asKinds(s)]))
const facts: ProjectFacts | undefined = undefined

for (const e of edges) {
  const isContains = isContainsEdge(e.label)
  const space = projected.get(e.repo)
  const ownFileDeclares = (space?.get(e.tgt)?.files.has(e.srcFile)) ?? false
  const c = classifyEdge(projDecl.get(e.repo) ?? new Map(), projKinds.get(e.repo) ?? new Map(), e.tgt, e.claim, facts, isContains, ownFileDeclares)
  e.outcome = c.outcome
  e.decls = c.decls
}

// ── THE UNSAMPLED PROJECT KEY SPACE, for the "declared outside this run" bucket ──────────────
// ONE PARSE PER UNSAMPLED FILE, symbols only. This is the fact the gate's own header names:
// a stride sample truncates each project's symbol table, so a target whose declaration lives in
// an unsampled file of the same repository reads `unresolved` here for a reason that is about
// THIS RUN and not about the analyzer.
const sampledByRepo = new Map<string, Set<string>>()
for (const f of files) {
  const repo = repoOf(f)
  let s = sampledByRepo.get(repo)
  if (!s) sampledByRepo.set(repo, (s = new Set()))
  s.add(f)
}
const outsideNames = new Map<string, Set<string>>() // repo -> names declared only outside the sample
let outsideParsed = 0
for (const [repo, all] of admittedByRepo) {
  const sampledSet = sampledByRepo.get(repo) ?? new Set()
  const rest = all.filter((f) => !sampledSet.has(f))
  if (rest.length === 0) continue
  const names = new Set<string>()
  for (let i = 0; i < rest.length; i += CONC) {
    const batch = rest.slice(i, i + CONC)
    const rs = await Promise.all(batch.map(async (f) => {
      try { return await parseFile(f, repo, { projectRoot: repo } as any) } catch { return null }
    }))
    for (const r of rs) {
      if (!r) continue
      outsideParsed++
      for (const s of (r as any).symbols ?? []) {
        const n = String(s?.name ?? "")
        if (n) names.add(n)
        const q = String((s as any)?.qualifiedName ?? "")
        if (q) names.add(q)
      }
    }
  }
  outsideNames.set(repo, names)
  console.error(`  … outside-sample symbols: ${path.basename(repo)} ${names.size}`)
}

// ── BUCKET THE UNRESOLVED ────────────────────────────────────────────────────────────────────
const buckets = new Map<string, number>()
const bucketByType = new Map<string, Map<string, number>>()
const samples = new Map<string, string[]>()
const tsv: string[] = ["type\tsrcFile\tline\ttarget\tbucket\tmetadataKeys\tqualified\texternalKind"]

/** Does the file BIND this name in a query-local scope? A `cte`'s own name, or a derived-table
 *  alias. Read from the file's TEXT with the two spellings PostgreSQL writes them in, and only
 *  as a HINT: a bucket built on a text scan is named `textScan` in the report, never `proven`. */
const localBindingHint = (text: string, name: string): boolean => {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${n}\\s+AS\\s*\\(`, "i").test(text)          // WITH <name> AS (
    || new RegExp(`\\)\\s*(?:AS\\s+)?${n}\\b`, "i").test(text)        // ) AS <name> / ) <name>
    || new RegExp(`\\bWITH\\s+(?:RECURSIVE\\s+)?${n}\\b`, "i").test(text)
}

for (const e of edges) {
  const unresolved = e.outcome === "unresolved" || e.outcome === "externalRefuted" || e.outcome === "causeRefuted"
  if (!unresolved) continue
  const q = typeof e.md.qualified === "string" ? e.md.qualified : ""
  const extKind = typeof e.md.external === "string" ? e.md.external : ""
  const ownSpace = projectSpace.get(e.repo)
  const ownFileHasIt = ownSpace?.get(e.tgt)?.files.has(e.srcFile) ?? false
  const outsideHasIt = outsideNames.get(e.repo)?.has(e.tgt) ?? false
  const text = fileText.get(e.srcFile) ?? ""

  let bucket: string
  if (e.outcome !== "unresolved") bucket = `REFUTED-${e.claim?.kind ?? "?"}`
  else if (extKind) bucket = `extKind:${extKind}`
  else if (outsideHasIt) bucket = "projectElsewhere"
  else if (ownFileHasIt) bucket = "ownFileDeclares"
  else if (localBindingHint(text, e.tgt)) bucket = "queryLocalBinding-textHint"
  else bucket = "absentEverywhere"

  buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
  let byType = bucketByType.get(e.label)
  if (!byType) bucketByType.set(e.label, (byType = new Map()))
  byType.set(bucket, (byType.get(bucket) ?? 0) + 1)
  const sk = `${e.label}|${bucket}`
  let s = samples.get(sk)
  if (!s) samples.set(sk, (s = []))
  if (s.length < 8) s.push(`${path.relative(CR, e.srcFile)}:${e.line ?? "?"} -> ${e.tgt}${q ? ` (qualified ${q})` : ""}${extKind ? ` [external ${extKind}]` : ""}`)
  tsv.push([e.label, path.relative(CR, e.srcFile), String(e.line ?? ""), e.tgt, bucket, Object.keys(e.md).join(","), q, extKind].join("\t"))
}

// ── PER-TYPE OUTCOME TABLE, so the buckets can be read against the gate's columns ────────────
const perType = new Map<string, Record<string, number>>()
for (const e of edges) {
  let row = perType.get(e.label)
  if (!row) perType.set(e.label, (row = {}))
  row.edges = (row.edges ?? 0) + 1
  row[e.outcome] = (row[e.outcome] ?? 0) + 1
}

const report = {
  population: {
    filelist: FILELIST, sampledFiles: files.length, parsed, failed,
    repos: projectSpace.size,
    unsampledFilesParsed: outsideParsed,
    cap: LIMIT > 0 ? LIMIT : "none (whole filelist)",
  },
  totals: {
    edges: edges.length,
    unresolved: edges.filter((e) => e.outcome === "unresolved").length,
    resolved: edges.filter((e) => e.outcome === "resolved").length,
    refuted: edges.filter((e) => e.outcome.endsWith("Refuted")).length,
  },
  buckets: Object.fromEntries([...buckets].sort((a, b) => b[1] - a[1])),
  bucketByType: Object.fromEntries([...bucketByType].map(([t, m]) => [t, Object.fromEntries([...m].sort((a, b) => b[1] - a[1]))])),
  samples: Object.fromEntries(samples),
  perType: Object.fromEntries(perType),
}
writeFileSync(OUT, JSON.stringify(report, null, 2))
if (TSV) writeFileSync(TSV, tsv.join("\n") + "\n")
console.log(JSON.stringify({ population: report.population, totals: report.totals, buckets: report.buckets, bucketByType: report.bucketByType, perType: Object.fromEntries(perType) }, null, 2))
