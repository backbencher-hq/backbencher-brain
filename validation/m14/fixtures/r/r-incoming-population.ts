/**
 * R INCOMING POPULATION — an incoming number is a statement about a FILE SET, and R's file set
 * in the fleet table is 21 files.
 *
 * ## The question this file exists to answer
 *
 * `validation/m14/measurements/incoming-whole.tsv` records, per lane, the ambiguous and
 * unresolved target columns measured over "600 files per lane (129 for `make`, 164 for
 * `clean`, 21 for `r` — their whole corpora)" (`archive/docs-pre-consolidation/analyzers-ONTOLOGY-WORKSTREAM-STATE.md`).
 * The R row is:
 *
 *     r    21    7    8    190
 *
 * 21 files. R's admitted corpus under `detectLanguageFromPath` is 2,184 files across 16
 * repositories, so the fleet's R row was measured over 0.96% of R's corpus — and the
 * population rule that produced 21 is visible without any instrument at all:
 *
 *     corpus files named `*.r`   (lower case)     21
 *     corpus files named `*.R`   (UPPER case)  2,163
 *
 * R source is `.R`. A lower-case glob finds 21 files, and those 21 are Rcpp `inst/examples`
 * scripts, one `r-scales/R/pal-shape.r`, an nvim query test and a testthat snapshot — the
 * least representative R files in the corpus. Every cross-file number in the R row of the
 * fleet's headline table is therefore a statement about 21 example scripts.
 *
 * So this file measures the same two columns over three populations, and says which is which:
 *
 *   LOWER  the 21 lower-case `.r` files — reproduces (or refutes) the fleet row. This is the
 *          parity test: if LOWER does not print `7 / 8 / 190` then the fleet row was not
 *          measured over these 21 files either, and the difference is printed.
 *   R600   600 files drawn from the admitted population by a stated stride, so the columns
 *          are comparable with a 600-file row in the fleet table.
 *   ALL    the whole admitted population, no sampling.
 *
 * ## Why the definitions are re-implemented rather than imported
 *
 * `script/m14/incoming-check.ts` is a top-level script: importing it runs its `main()` over
 * `process.argv`. Its two definitions are therefore transcribed here — `published` keyed by
 * `name` (and `qualifiedName` when it differs), ambiguity meaning "this target string is
 * published under two or more distinct `SymbolKind` values" — and PARITY is not asserted,
 * it is MEASURED: this harness runs the real script as a child process over the LOWER
 * population and prints a field-by-field diff. A transcription nobody checked would be a
 * number about a definition rather than about R.
 *
 * Both self-loop conventions are printed, because the two passes in `incoming-check.ts`
 * disagree: the first pass buckets a self-loop separately and `continue`s, the per-type
 * recomputation does not skip them. Whichever the fleet's total used, it is identifiable.
 *
 * ## The ambiguity split — `ambiguity-brief.md` step 1
 *
 * Per ambiguous EDGE, the declarations that supply the colliding kinds are located and the
 * edge is charged to one of three buckets, because the three have different owners:
 *
 *   B1 SAME-FILE     two colliding declarations in ONE file. The analyzer knows the file and
 *                    the positions; the reverse walk's winner is a choice inside one file.
 *   B2 ONE-REPO      no same-file pair, and every colliding declaration in ONE repository.
 *                    R's package IS the repository, so a same-repository preference rule could
 *                    separate these without touching the name surface.
 *   B3 CROSS-REPO    colliding declarations in two or more repositories. No analyzer-local
 *                    scope separates these: a single-file analyzer cannot know which package
 *                    an index will hold. This is a published-name-contract finding.
 *
 * B2 is also split by whether the colliding declarations live in the SOURCE edge's own
 * repository, because that is the population a same-repository preference rule could reach.
 *
 * ## Reproducing
 *
 *   npx tsx validation/m14/fixtures/r/r-incoming-population.ts --pop lower
 *   npx tsx validation/m14/fixtures/r/r-incoming-population.ts --pop r600
 *   npx tsx validation/m14/fixtures/r/r-incoming-population.ts --pop all
 *
 * Both `--pop=NAME` and `--pop NAME` are accepted. Only the `=` form was matched in the
 * first draft, so the space form above walked the DEFAULT 21-file population while printing
 * a header that named the requested one. It is called out here because a harness that
 * measures the wrong population and says otherwise is worse than one that refuses.
 *
 * Each population's walk is checkpointed to
 * `r-incoming-walk-<corpusDigest12>-<analyzerDigest8>.jsonl`, keyed by BOTH digests, so a
 * spool can never be re-used across an analyzer change the way a corpus-keyed spool alone
 * would allow. A kill resumes: the shared 120-second parse watchdog
 * (`src/ast/engine.ts` `process.exit()`, shared machinery per §8) ends the process, not the
 * measurement.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WORKERS = 4
const argv = process.argv.slice(2)
/** `--pop` accepts BOTH `--pop=NAME` and `--pop NAME`. Only the `=` form was matched at
 *  first, so the documented space form silently ran the DEFAULT population — which reads as
 *  a measurement of the requested population and is not one. An unrecognised value is a
 *  refusal, not a fallback: a typo must not walk 2,184 files. */
function readPop(argv: string[]): "lower" | "r600" | "all" {
  const eq = argv.find((a) => a.startsWith("--pop="))?.slice(6)
  const sp = argv.indexOf("--pop")
  const raw = (eq ?? (sp >= 0 ? argv[sp + 1] : undefined) ?? "lower").toLowerCase()
  if (raw === "lower" || raw === "r600" || raw === "all") return raw
  console.error(`--pop must be one of lower|r600|all; got ${JSON.stringify(raw)}`)
  process.exit(2)
}
const POP = readPop(argv)

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

// ------------------------------------------------------------------ corpus admission
interface Admitted { repo: string; dir: string; rel: string; abs: string; ext: string }
const admitted: Admitted[] = []
const perRepo: Record<string, number> = {}
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
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, dir, rel, abs, ext: path.extname(abs) })
    perRepo[e] = (perRepo[e] ?? 0) + 1
  }
}

/**
 * `R600` — a stride over the corpus-order admitted list, not a prefix.
 *
 * A prefix of the corpus order would be one or two repositories (the list is grouped by
 * `readdirSync(CR).sort()`), so every cross-file column would describe those repositories
 * and nothing else. Stride `i = floor(k * N / 600)` gives each repository a share in
 * proportion to its file count, deterministically and with no RNG to re-seed.
 */
function strideSample(n: number, want: number): number[] {
  if (n <= want) return Array.from({ length: n }, (_, i) => i)
  const out: number[] = []
  for (let k = 0; k < want; k++) out.push(Math.floor((k * n) / want))
  return [...new Set(out)]
}

const lowerIdx = admitted.map((a, i) => (a.ext === ".r" ? i : -1)).filter((i) => i >= 0)
const idx =
  POP === "all" ? admitted.map((_, i) => i)
  : POP === "r600" ? strideSample(admitted.length, 600)
  : lowerIdx
const files = idx.map((i) => admitted[i])

const ANALYZER = path.resolve(process.cwd(), "src/ast/real-r-analyzer.ts")
const analyzerDigest = existsSync(ANALYZER)
  ? createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")
  : "MISSING"
const corpusDigest = createHash("sha256")
  .update(files.map((f) => f.abs).sort().join("\n")).digest("hex")

const extCensus = new Map<string, number>()
for (const a of admitted) extCensus.set(a.ext, (extCensus.get(a.ext) ?? 0) + 1)

console.log(`R incoming population — production parseFile, ${POP}`)
console.log(`analyzer: src/ast/real-r-analyzer.ts sha256 ${analyzerDigest}`)
console.log(`corpus root: ${CR}`)
console.log(`admitted by detectLanguageFromPath === "r": ${admitted.length} files / ${Object.keys(perRepo).length} repositories`)
console.log(`  by extension: ${[...extCensus.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join("  ")}`)
console.log(`  repositories: ${Object.entries(perRepo).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" ")}`)
console.log(`population ${POP}: ${files.length} files  sha256 ${corpusDigest}`)
if (POP === "r600") console.log(`  stride sample: floor(k * ${admitted.length} / 600), deterministic, ${files.length} distinct indices`)
if (POP === "lower") console.log(`  this is the population a lower-case *.r glob yields: ${lowerIdx.length} of ${admitted.length} admitted files (${((lowerIdx.length / admitted.length) * 100).toFixed(2)}%)`)
console.log("")

// ------------------------------------------------------------------ walk, checkpointed
interface Decl { n: string; k: string; q: string; r: string; f: string }
interface Edge { t: Type; s: string; g: string; r: string; f: string }

const SPOOL_DIR = path.resolve(process.cwd(), "validation/m14/fixtures/r")
const SPOOL = path.join(SPOOL_DIR, `r-incoming-walk-${corpusDigest.slice(0, 12)}-${analyzerDigest.slice(0, 8)}.jsonl`)
mkdirSync(SPOOL_DIR, { recursive: true })

const rows = new Map<string, { repo: string; decls: Decl[]; edges: Edge[] }>()
let emptyRowsDropped = 0
if (existsSync(SPOOL)) {
  for (const line of readFileSync(SPOOL, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const j = JSON.parse(line)
      if (!j?.abs) continue
      // A row with no symbols AND no edges is NOT proof the file was parsed — it is what a
      // parse cut short by the shared 120-second watchdog leaves behind, and 233 of the
      // 2,184 admitted files genuinely have none. Counting an empty row as a completed walk
      // is how a truncation becomes a permanent number: the resume skips it forever. This
      // bit 54 edges out of one earlier walk of this same population (`usethis/R/ci.R`,
      // 34 edges; `usethis/R/code-of-conduct.R`, 20 edges), which is how the number was
      // found. Empty rows are therefore dropped from the done-set and re-walked every run;
      // the re-walk is idempotent, so a genuinely empty file costs one parse and nothing else.
      if (!(j.decls?.length) && !(j.edges?.length)) { emptyRowsDropped++; continue }
      rows.set(String(j.abs), { repo: String(j.repo ?? ""), decls: j.decls ?? [], edges: j.edges ?? [] })
    } catch { /* truncated tail: one file is re-walked */ }
  }
}
const spoolBuf: string[] = []
function flush(): void {
  if (!spoolBuf.length) return
  writeFileSync(SPOOL, spoolBuf.join(""), { flag: "a" })
  spoolBuf.length = 0
}

let degraded = 0
const parseFailures: string[] = []
let next = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = next++
    if (i >= files.length) return
    const f = files[i]
    if (rows.has(f.abs)) continue
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (e) {
      parseFailures.push(`${f.abs}: ${(e as Error)?.message ?? e}`)
      return
    }
    const decls: Decl[] = []
    const edges: Edge[] = []
    if (r) {
      if (r.fallback === true) degraded++
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        const name = String(s?.name ?? "")
        if (name.length === 0) continue
        decls.push({ n: name, k: String(s?.kind ?? ""), q: String(s?.qualifiedName ?? ""), r: f.repo, f: f.abs })
      }
      for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
        const t = ontologyType(rel?.type ?? rel?.relationshipType)
        if (!t) continue
        const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
        const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
        if (tgt.length === 0) continue
        edges.push({ t, s: src, g: tgt, r: f.repo, f: f.abs })
      }
    }
    rows.set(f.abs, { repo: f.repo, decls, edges })
    spoolBuf.push(JSON.stringify({ abs: f.abs, repo: f.repo, decls, edges }) + "\n")
    if (spoolBuf.length >= 40) flush()
  }
}

async function walk(): Promise<void> {
  const workers: Promise<void>[] = []
  for (let k = 0; k < WORKERS; k++) workers.push(worker())
  await Promise.all(workers)
  flush()
}

await walk()
console.log(`files walked OK: ${rows.size}   degraded (regex fallback): ${degraded}   parse failures: ${parseFailures.length}`)
console.log(`resumed rows dropped as empty and re-walked: ${emptyRowsDropped}`)
const zeroRows = [...rows.values()].filter((r) => r.decls.length === 0 && r.edges.length === 0).length
console.log(`files with 0 symbols AND 0 edges after this walk: ${zeroRows}  (each was re-walked this run; a count that rises means new truncations)`)
for (const f of parseFailures.slice(0, 5)) console.log(`  ${f}`)
if (rows.size < files.length) {
  console.log(`PARTIAL: ${rows.size} of ${files.length} offered. The numbers below describe ${rows.size} files.`)
}
console.log(`spool: ${path.relative(process.cwd(), SPOOL)}`)
console.log("")

// ------------------------------------------------------------------ scoring
/** name -> distinct kinds, exactly as `incoming-check.ts` builds it. */
const published = new Map<string, string[]>()
/** name -> declarations, for the ambiguity split only. */
const declsByName = new Map<string, Array<{ k: string; r: string; f: string }>>()
let symbols = 0
for (const row of rows.values()) {
  for (const d of row.decls) {
    symbols++
    const kinds = published.get(d.n)
    if (kinds) { if (!kinds.includes(d.k)) kinds.push(d.k) } else published.set(d.n, [d.k])
    if (d.q.length > 0 && d.q !== d.n) {
      const qk = published.get(d.q)
      if (qk) { if (!qk.includes(d.k)) qk.push(d.k) } else published.set(d.q, [d.k])
    }
    const list = declsByName.get(d.n)
    const rec = { k: d.k, r: d.r, f: d.f }
    if (list) list.push(rec); else declsByName.set(d.n, [rec])
  }
}

interface Row { edges: number; targets: number; amb: number; ambSL: number; unres: number; unresSL: number; selfLoops: number }
const perType = new Map<Type, Row>()
for (const t of ALL_TYPES) perType.set(t, { edges: 0, targets: 0, amb: 0, ambSL: 0, unres: 0, unresSL: 0, selfLoops: 0 })

const ambiguousEdges: Edge[] = []
let totalEdges = 0
const distinctTargets = new Set<string>()
for (const row of rows.values()) {
  for (const e of row.edges) {
    totalEdges++
    const r = perType.get(e.t)!
    r.edges++
    if (e.s === e.g) { r.selfLoops++; continue }        // pass 1 of incoming-check.ts:212
    r.ambSL++
    if (!published.has(e.g)) { r.unresSL++; continue }
    if ((published.get(e.g) ?? []).length > 1) { r.amb++; ambiguousEdges.push(e) }
    distinctTargets.add(e.g)
  }
}
// pass 2 of incoming-check.ts:230 — per type, WITHOUT the self-loop skip
const perType2 = new Map<Type, { targets: number; amb: number; unres: number }>()
for (const t of ALL_TYPES) perType2.set(t, { targets: 0, amb: 0, unres: 0 })
for (const row of rows.values()) {
  for (const e of row.edges) {
    const acc = perType2.get(e.t)!
    const hits = published.get(e.g)
    if (!hits) { acc.unres++; continue }
    if (hits.length > 1) acc.amb++
    acc.targets++
  }
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0)
const fired = ALL_TYPES.filter((t) => perType.get(t)!.edges > 0)

console.log(`incoming check — r, ${rows.size} file(s), ${symbols} symbols, ${totalEdges} edges`)
console.log(`fired: ${fired.length}/10  ${fired.join(" ")}`)
console.log("")
console.log(pad("type", 14) + pad("edges", 9) + pad("distinct", 10) + pad("amb", 9) + pad("amb+SL", 9) + pad("unres", 9) + pad("unres+SL", 10) + "selfLoops")
console.log("-".repeat(80))
for (const t of ALL_TYPES) {
  const a = perType.get(t)!
  const b = perType2.get(t)!
  console.log(
    pad(a.edges > 0 ? t : `${t} (no)`, 14) + pad(String(a.edges), 9) + pad(String(b.targets), 10) +
    pad(String(b.amb), 9) + pad(String(a.ambSL), 9) + pad(String(b.unres), 9) + pad(String(a.unresSL), 10) + String(a.selfLoops),
  )
}
console.log("-".repeat(80))
const T = (f: (r: Row) => number) => sum([...perType.values()], f)
console.log(`TOTAL edges ${totalEdges}   ambiguous(pass2) ${sum([...perType2.values()], (r) => r.amb)}   ambiguous(pass1, no self-loops) ${T((r) => r.ambSL)}`)
console.log(`      unresolved(pass2) ${sum([...perType2.values()], (r) => r.unres)}   unresolved(pass1, no self-loops) ${T((r) => r.unresSL)}   selfLoops ${T((r) => r.selfLoops)}`)
console.log(`distinct target names named by at least one edge: ${distinctTargets.size}`)
console.log(`target names published under >1 kind: ${[...published.entries()].filter(([, k]) => k.length > 1).length}`)
console.log("")

// ------------------------------------------------------------------ ambiguity split
type Bucket = "B1 SAME-FILE" | "B2 ONE-REPO" | "B3 CROSS-REPO"
interface Charge { edges: number; names: Set<string>; b2InSourceRepo: number }
const charges = new Map<Bucket, Charge>()
const chargeOf = (b: Bucket): Charge => {
  const c = charges.get(b)
  if (c) return c
  const fresh = { edges: 0, names: new Set<string>(), b2InSourceRepo: 0 }
  charges.set(b, fresh)
  return fresh
}
for (const e of ambiguousEdges) {
  const decls = declsByName.get(e.g) ?? []
  const kinds = [...new Set(decls.map((d) => d.k))]
  if (kinds.length < 2) continue
  const colliding = decls.filter((d) => kinds.includes(d.k))
  const byFile = new Map<string, number>()
  for (const d of colliding) byFile.set(d.f, (byFile.get(d.f) ?? 0) + 1)
  const sameFile = [...byFile.values()].some((n) => n > 1)
  const repos = new Set(colliding.map((d) => d.r))
  const bucket: Bucket = sameFile ? "B1 SAME-FILE" : repos.size === 1 ? "B2 ONE-REPO" : "B3 CROSS-REPO"
  const c = chargeOf(bucket)
  c.edges++
  c.names.add(e.g)
  if (bucket === "B2 ONE-REPO" && repos.has(e.r)) c.b2InSourceRepo++
}
const BUCKETS: Bucket[] = ["B1 SAME-FILE", "B2 ONE-REPO", "B3 CROSS-REPO"]
const charged = sum(BUCKETS, (b) => charges.get(b)?.edges ?? 0)
console.log(`AMBIGUITY SPLIT — every ambiguous edge charged to where its colliding declarations live`)
console.log(pad("bucket", 16) + pad("edges", 9) + pad("share", 9) + pad("names", 9) + "owner")
console.log("-".repeat(72))
for (const b of BUCKETS) {
  const c = charges.get(b)
  if (!c) continue
  const owner =
    b === "B1 SAME-FILE" ? "the analyzer knows the file and the positions"
    : b === "B2 ONE-REPO" ? "R's package IS the repository; a same-repo preference rule could reach it"
    : "no single-file analyzer can separate these"
  console.log(pad(b, 16) + pad(String(c.edges), 9) + pad(`${((c.edges / (ambiguousEdges.length || 1)) * 100).toFixed(1)}%`, 9) + pad(String(c.names.size), 9) + owner)
}
console.log("-".repeat(72))
console.log(`partition check: charged ${charged} of ${ambiguousEdges.length} ambiguous edges${charged === ambiguousEdges.length ? "" : "  <-- DOES NOT CLOSE"}`)
const b2 = charges.get("B2 ONE-REPO")
if (b2) console.log(`B2 sub-split: ${b2.b2InSourceRepo} of ${b2.edges} collide inside the SOURCE edge's own repository; ${b2.edges - b2.b2InSourceRepo} collide in a sibling repository`)
console.log("")

// ------------------------------------------------------------------ parity vs the shared script
if (POP === "lower") {
  console.log(`PARITY — script/m14/incoming-check.ts run as a child over the same ${files.length} files`)
  const args = ["tsx", path.resolve(process.cwd(), "script/m14/incoming-check.ts"), "--json", "r", ...files.map((f) => f.abs)]
  const child = spawnSync("npx", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  if (child.status !== 0) {
    console.log(`  child exited ${child.status}: ${(child.stderr ?? "").split("\n").slice(0, 4).join(" | ")}`)
  } else {
    let j: any
    try { j = JSON.parse(child.stdout.slice(child.stdout.indexOf("{"))) } catch (e) {
      console.log(`  child stdout did not parse: ${(e as Error).message}`)
    }
    if (j) {
      console.log(pad("type", 14) + pad("child fired", 13) + pad("mine", 7) + pad("child amb", 11) + pad("mine", 7) + pad("child unres", 13) + "mine")
      let diffs = 0
      for (const t of ALL_TYPES) {
        const c = j.perType?.[t]
        const m = perType2.get(t)!
        if (!c) { console.log(`  ${t}: absent from child perType`); diffs++; continue }
        const okA = Number(c.ambiguousTargets) === m.amb
        const okU = Number(c.unresolvedTargets) === m.unres
        const okF = Boolean(c.fired) === (perType.get(t)!.edges > 0)
        if (!okA || !okU || !okF) diffs++
        console.log(
          pad(t, 14) + pad(c.fired ? "yes" : "no", 13) + pad(perType.get(t)!.edges > 0 ? "yes" : "no", 7) +
          pad(String(c.ambiguousTargets), 11) + pad(String(m.amb), 7) + pad(String(c.unresolvedTargets), 13) + String(m.unres) +
          (okA && okU && okF ? "" : "   <-- DIFF"),
        )
      }
      const cFiles = Number(j.files)
      console.log(`child files ${cFiles} / mine ${rows.size}   child symbols ${j.symbols} / mine ${symbols}`)
      console.log(diffs === 0 && cFiles === rows.size
        ? `PARITY OK on all 10 types and the file count — the transcription above is faithful and the population matches the fleet row.`
        : `PARITY FAILED on ${diffs} type(s) — the transcription or the population is wrong; the diff above is the finding.`)
      const fleet = { fired: 7, amb: 8, unres: 190 }
      const myTotals = {
        fired: fired.length,
        amb: sum([...perType2.values()], (r) => r.amb),
        unres: sum([...perType2.values()], (r) => r.unres),
      }
      console.log(`fleet tsv row (r): files 21 fired ${fleet.fired} amb ${fleet.amb} unres ${fleet.unres}`)
      console.log(`this run (${POP}):  files ${cFiles} fired ${myTotals.fired} amb ${myTotals.amb} unres ${myTotals.unres}`)
      console.log(myTotals.fired === fleet.fired && myTotals.amb === fleet.amb && myTotals.unres === fleet.unres && cFiles === 21
        ? `MATCH — the fleet's R row was measured over these ${cFiles} files.`
        : `NO MATCH — the fleet's R row was not measured over this population; do not attribute it to these files.`)
    }
  }
}