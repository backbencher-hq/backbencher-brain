/**
 * M14 ONTOLOGY LANE — DART relationship/symbol census through the PRODUCTION
 * entry point (`parseFile`, src/ast/pool-worker.ts), not `analyze()`.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts dart` refuses to print a table for this
 * lane — `RULED_BY_LANG` has no `dart` entry, so it exits 2 after the parse and
 * before the verdict loop, and the per-type counts it computed internally are
 * never written down. The instrument therefore does not exist for dart in any
 * reusable form, and the numbers in this lane's report have to come from
 * somewhere reproducible.
 *
 * `analyze()` is NOT the production path: it skips the pool worker's size
 * guards (files > 1 MB go to structural extraction and never reach an
 * analyzer), the encoding decode, and the taint enrichment stage. Every count
 * below therefore comes from `parseFile`, and the size-guard population is
 * counted and reported rather than dropped silently.
 *
 * ## What it measures
 *
 *   - relationship types, with counts and example files
 *   - `SymbolKind` distribution, plus any empty/unknown kind
 *   - symbols with an empty name
 *   - relationship endpoints equal to the literal `unknown` (M60 rule R7)
 *   - endpoint resolution per relationship type, in three scopes: this file's
 *     symbols, the whole sample's symbols, and an unresolvable-shape breakdown
 *   - confidence distribution per type, with the sub-0.7 heuristic ratio, and
 *     the `evidenceClass` distribution (M14 honesty contract §4)
 *
 * ## Sampling
 *
 * Deterministic STRIDE over `git ls-files '*.dart'` sorted, per repository:
 * `stride = max(1, floor(tracked / perRepo))`, keep `i % stride === 0`, capped at
 * `perRepo`. No randomness, so a reviewer reproduces the same file set from a
 * clean corpus. Stride (not a prefix) because a sorted path list clusters by
 * directory and a prefix would sample one subtree.
 *
 * ## CONCURRENCY IS NOT SAFE FOR THIS MEASUREMENT — RUN IT AT 1
 *
 * The FILE SET is deterministic; the RESULT is not, unless `BB_DART_CONC=1`.
 * Measured on this corpus, two runs of the same 1,000 files with the same analyzer
 * at `BB_DART_CONC=6`:
 *
 *   symbols 36,550 vs 36,503;  relationships 124,772 vs 124,638 (-0.11%);
 *   every one of `calls`/`uses`/`contains`/`imports`/`references`/`extends`/
 *   `overrides`/`instantiates` came out LOWER in the second run.
 *
 * The same two runs at `BB_DART_CONC=1` are byte-identical (36,550 symbols,
 * 124,772 relationships, every per-type count equal). The engine prints
 * `[BB-PARSE-ERR] … memory access out of bounds` on some file-parses under
 * concurrency — observed twice in ~5,500 file-parses, never at concurrency 1 — so
 * the loss is a failed parse inside the WASM parser, not arithmetic in this file.
 * `parseFile` is shared machinery (`src/ast/pool-worker.ts`), so this file does not
 * change it; the numbers this lane reports are all from `BB_DART_CONC=1`, and the
 * finding is written up for the owner of the pool worker.
 *
 * ## CLI
 *
 * The default sample is the one this lane's doc reports — 2,735 files: 600 per
 * repository for proxicall / riverpod / flutter-packages / dart-sdk (dart-http
 * tracks only 335, so it contributes all of them) — so the command printed in the
 * doc reproduces the doc's table with no extra variable. The default WAS 250 and
 * that was a reproducibility defect rather than a smaller sample: a reviewer
 * running the documented command got 1,250 files and about 52% of every count in
 * the table beside it, with nothing in the output to say the two disagree.
 *
 *   BB_DART_CONC=1 npx tsx validation/m14/fixtures/dart/census.ts
 *   BB_DART_PER_REPO=40 BB_DART_REPOS=dart-http npx tsx .../census.ts
 *   BB_DART_OUT=/tmp/census.json npx tsx .../census.ts
 */
import { execFileSync } from "node:child_process"
import { statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_DART_REPOS ?? "proxicall,dart-http,riverpod,flutter-packages,dart-sdk").split(",").filter(Boolean)
const PER_REPO = Number(process.env.BB_DART_PER_REPO ?? 600)
const OUT = process.env.BB_DART_OUT ?? ""
const CONCURRENCY = Number(process.env.BB_DART_CONC ?? 6)

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- sample
const sample: { repo: string; rel: string; abs: string; bytes: number }[] = []
const repoStats: any[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.dart"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    repoStats.push({ repo, tracked: 0, sampled: 0, note: "not a git repo or no .dart tracked" })
    continue
  }
  tracked.sort()
  const stride = Math.max(1, Math.floor(tracked.length / PER_REPO))
  const picked: string[] = []
  for (let i = 0; i < tracked.length && picked.length < PER_REPO; i += stride) {
    const abs = path.join(dir, tracked[i])
    let bytes = 0
    try { bytes = statSync(abs).size } catch { continue }
    picked.push(tracked[i])
    sample.push({ repo, rel: tracked[i], abs, bytes })
  }
  repoStats.push({ repo, tracked: tracked.length, stride, sampled: picked.length })
}

const overStructuralLimit = sample.filter(f => f.bytes > 1024 * 1024)
const overSkipLimit = sample.filter(f => f.bytes > 5 * 1024 * 1024)

// ---------------------------------------------------------------- tallies
const relCounts = new Map<string, number>()
/** The CAPPED example pointer. Kept, because a reader wants an example, and kept
 *  named `filesWithExamples` because a capped list read as a count is the defect
 *  below. It is NOT the breadth measurement — `relFilesAll` is. */
const relFiles = new Map<string, Set<string>>()
/** The BREADTH measurement: every file carrying the label, uncapped, with the
 *  per-repository split.
 *
 *  `relFiles` capped at six IN ITERATION ORDER (`if (fs.size < 6)`), and the sample
 *  walks proxicall first — so all sixty examples across the ten types were proxicall
 *  files. That is what made `exports` read as a single-repository edge when its
 *  largest repository is dart-http (54 of 104 files). A count and an example are
 *  two questions; this map answers the first and the other answers the second. */
const relFilesAll = new Map<string, Set<string>>()
const relFilesByRepo = new Map<string, Map<string, Set<string>>>()
const relConf = new Map<string, { total: number; heuristic: number; min: number; sum: number }>()
const relEvidence = new Map<string, Map<string, number>>()
const relReason = new Map<string, Map<string, number>>()
const unresolvedShape = new Map<string, Map<string, number>>()
const kindCounts = new Map<string, number>()
const sampleSymbolNames = new Set<string>()
const emptyNames: string[] = []
const emptyKinds: string[] = []
/** The COUNT, and separately the capped list of examples. These were one array, and
 *  the report read `.length` off it while the pushes stopped at 40 — so every run
 *  whose true count exceeded the cap reported exactly 40. Measured on the pre-M14
 *  analyzer over proxicall's full 2,351-file set: the true count is above the cap,
 *  and the first version of this harness printed the cap. */
const unknownEndpointSamples: string[] = []
let unknownEndpointCount = 0
/** The count per LABEL, because "104 rows carry the literal" and "which labels" are
 *  two questions and a reader who has to re-derive the second cannot check the
 *  first. A rule that removes rows from several labels at once has to say which. */
const unknownByLabel = new Map<string, number>()

interface PerType { n: number; srcRes: number; tgtRes: number; bothRes: number; tgtSample: number; bothSample: number }
const res: Map<string, PerType> = new Map()
const perType = (t: string): PerType => {
  let r = res.get(t)
  if (!r) { r = { n: 0, srcRes: 0, tgtRes: 0, bothRes: 0, tgtSample: 0, bothSample: 0 }; res.set(t, r) }
  return r
}

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

/** The shape of an endpoint that resolved to nothing — so an unresolved rate is readable. */
function shapeOf(name: string): string {
  if (name === "unknown") return "literal-unknown"
  if (name.startsWith("package:")) return "package-uri"
  if (name.startsWith("dart:")) return "dart-uri"
  if (name.includes(":")) return "uri-with-suffix"
  if (name.includes(".")) return "dotted-path"
  if (name.includes("/")) return "path"
  if (name.endsWith("*")) return "wildcard"
  return "bare-name"
}

let symbols = 0
let relationships = 0
let parseErrors = 0
let filesWithErrors = 0
let idx = 0
const perRepoFiles: Record<string, number> = {}
const failures: string[] = []
/** Files pool-worker routed to the >1MB structural extractor. Those files get the
 *  fallback's `{name,type,startLine,endLine}` symbols and NO analyzer output at
 *  all, so a kind census over them measures the fallback, not this lane. */
let fallbackFiles = 0
let fallbackSymbols = 0
let symbolsNamedUnknown = 0
/** Files in the sample carrying NO `contains` edge at all. This is the population
 *  `validation/m14/fixtures/dart/zero-contains-probe.ts` characterizes from node
 *  types; the census only counts it, so the two instruments agree on N without the
 *  probe's classification depending on the census's walk. */
const filesWithoutContains: string[] = []
/** Per-repo symbol names — the narrowest honest cross-file resolution scope:
 *  a type declared in ANOTHER FILE OF THE SAME REPOSITORY is a real symbol a
 *  per-file analyzer cannot see, and every other lane label (calls, instantiates,
 *  extends) resolves the same way. */
const repoSymbolNames = new Map<string, Set<string>>()
const perRepoRes = new Map<string, { n: number; both: number; tgt: number }>()
/** Every edge kept for the SECOND resolution phase, grouped by repo. Resolving
 *  against a set that is still being filled would make the answer depend on the
 *  order files happened to finish in, so the per-repo numbers are computed after
 *  every worker has stopped. */
const repoEdges = new Map<string, { label: string; src: string; tgt: string }[]>()

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= sample.length) return
    const f = sample[i]
    let r: any
    try {
      r = await parseFile(f.abs, path.join(CR, f.repo))
    } catch (e: any) {
      failures.push(`${f.repo}/${f.rel}: ${String(e?.message ?? e)}`)
      continue
    }
    perRepoFiles[f.repo] = (perRepoFiles[f.repo] ?? 0) + 1
    if ((r?.errors?.length ?? 0) > 0) filesWithErrors++
    parseErrors += r?.errors?.length ?? 0
    if (r?.fallback === true) fallbackFiles++

    let repoNames = repoSymbolNames.get(f.repo)
    if (!repoNames) { repoNames = new Set(); repoSymbolNames.set(f.repo, repoNames) }
    const fileNames = new Set<string>()
    for (const s of r?.symbols ?? []) {
      symbols++
      const kind = String((s as any).kind ?? "")
      const nm = String(s.name ?? "")
      // Fallback shape: no `kind`, no `range`, a `type` string. Counted apart.
      const isFallback = kind === "" && (s as any).range === undefined && typeof (s as any).type === "string"
      if (isFallback) { fallbackSymbols++; continue }
      bump(kindCounts, kind)
      if (nm.length === 0) emptyNames.push(`${f.repo}/${f.rel}`)
      if (kind === "" || kind === "unknown") emptyKinds.push(`${f.repo}/${f.rel}:${nm}`)
      if (nm === "unknown") symbolsNamedUnknown++
      fileNames.add(nm)
      sampleSymbolNames.add(nm)
      repoNames.add(nm)
      if (typeof s.ownerName === "string" && s.ownerName.length > 0) {
        const qualified = `${s.ownerName}.${nm}`
        // The qualified spelling goes into ALL THREE tables, not just the file's.
        // It went into `fileNames` alone for a long time, so `contains` read 100.0%
        // in-file while `overrides` — whose source AND target are both `Owner.member`
        // — read 0/7,566 in-sample on a sample where the declaring class was plainly
        // present. The column was measuring the absence of a spelling, not the absence
        // of a symbol, and the two disagree by exactly the qualified forms.
        fileNames.add(qualified)
        sampleSymbolNames.add(qualified)
        repoNames.add(qualified)
      }
    }

    const fileLabels = new Set<string>()
    for (const rel of r?.relationships ?? []) {
      relationships++
      const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase() as Type
      const label = ALL_TYPES.includes(t) ? t : `<other:${t}>`
      fileLabels.add(label)
      bump(relCounts, label)
      let fs = relFiles.get(label)
      if (!fs) { fs = new Set(); relFiles.set(label, fs) }
      if (fs.size < 6) fs.add(`${f.repo}/${f.rel}`)
      // The uncapped set. Both live here rather than replacing each other: the six
      // examples are a pointer and the full set is the census, and one array cannot
      // be both without a reader reporting the cap as the number.
      const key = `${f.repo}/${f.rel}`
      let all = relFilesAll.get(label)
      if (!all) { all = new Set(); relFilesAll.set(label, all) }
      all.add(key)
      let byRepo = relFilesByRepo.get(label)
      if (!byRepo) { byRepo = new Map(); relFilesByRepo.set(label, byRepo) }
      let rf = byRepo.get(f.repo)
      if (!rf) { rf = new Set(); byRepo.set(f.repo, rf) }
      rf.add(key)

      const conf = typeof rel.confidence === "number" ? rel.confidence : 1
      let cs = relConf.get(label)
      if (!cs) { cs = { total: 0, heuristic: 0, min: 1, sum: 0 }; relConf.set(label, cs) }
      cs.total++
      cs.sum += conf
      if (conf < cs.min) cs.min = conf
      if (conf < 0.7) cs.heuristic++

      let ev = relEvidence.get(label)
      if (!ev) { ev = new Map(); relEvidence.set(label, ev) }
      bump(ev, String((rel as any).metadata?.evidenceClass ?? "<none>"))

      let rs = relReason.get(label)
      if (!rs) { rs = new Map(); relReason.set(label, rs) }
      const md = (rel as any).metadata ?? {}
      const reasons = Object.keys(md).filter(k => k.startsWith("is") || k.endsWith("Kind") || k.startsWith("surface")).sort()
      bump(rs, reasons.length ? reasons.join("+") : "<none>")

      const src = String(rel.source ?? rel.from ?? rel.fromSymbol ?? "")
      const tgt = String(rel.target ?? rel.to ?? rel.toSymbol ?? "")
      if (src === "unknown" || tgt === "unknown") {
        unknownEndpointCount++
        bump(unknownByLabel, t)
        if (unknownEndpointSamples.length < 40) unknownEndpointSamples.push(`${f.repo}/${f.rel}: ${src} -> ${tgt} [${t}]`)
      }
      const p = perType(label)
      p.n++
      const srcOk = fileNames.has(src)
      const tgtOk = fileNames.has(tgt)
      if (srcOk) p.srcRes++
      if (tgtOk) p.tgtRes++
      if (srcOk && tgtOk) p.bothRes++
      // SAMPLE-scope resolution is NOT computed here. `sampleSymbolNames` is still
      // being filled while the walk runs, so a name declared in a file the walk has
      // not reached yet reads as absent and the answer depends on parse order — the
      // same hazard the per-repo phase below already avoids by construction, and the
      // same one `incoming-census.ts` documents with a measured misfiling. Two bugs
      // lived in these four lines: `tgtSample` was incremented under `if (tgtOk)`
      // so the column printed the in-file rate a second time under a sample-scope
      // heading (`references 857 840/857 98.0% 857/857 100.0% 840/857 98.0%`), and
      // `bothSample` was order-dependent. Both are fixed by moving the work to the
      // settled phase below.
      let edges = repoEdges.get(f.repo)
      if (!edges) { edges = []; repoEdges.set(f.repo, edges) }
      edges.push({ label, src, tgt })
      if (!tgtOk) {
        let us = unresolvedShape.get(label)
        if (!us) { us = new Map(); unresolvedShape.set(label, us) }
        bump(us, shapeOf(tgt))
      }
    }
    if (!fileLabels.has("contains")) filesWithoutContains.push(`${f.repo}/${f.rel}`)
  }
}

const t0 = Date.now()
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
const wallMs = Date.now() - t0

// phase 2 — per-repo cross-file resolution, over a settled symbol set
for (const [repo, edges] of repoEdges) {
  const names = repoSymbolNames.get(repo) ?? new Set<string>()
  for (const e of edges) {
    const rr = perRepoRes.get(`${repo}|${e.label}`) ?? { n: 0, both: 0, tgt: 0 }
    rr.n++
    if (names.has(e.tgt)) rr.tgt++
    if (names.has(e.src) && names.has(e.tgt)) rr.both++
    perRepoRes.set(`${repo}|${e.label}`, rr)
  }
}

// phase 2b — SAMPLE-scope resolution, over the same settled set. The sample pools
// every repository it drew from, so this is the widest scope this harness can
// honestly claim and it is labelled `sample` in the table for that reason.
for (const edges of repoEdges.values()) {
  for (const e of edges) {
    const p = perType(e.label)
    if (sampleSymbolNames.has(e.tgt)) p.tgtSample++
    if (sampleSymbolNames.has(e.src) && sampleSymbolNames.has(e.tgt)) p.bothSample++
  }
}

// ---------------------------------------------------------------- report
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const perRepoByType = (t: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of [...perRepoRes].sort()) {
    const [repo, label] = k.split("|")
    if (label !== t || v.n === 0) continue
    out[repo] = `${v.both}/${v.n} ${pct(v.both, v.n)}`
  }
  return out
}
// The TARGET-only repo-scope rate, and its pooled total. `perRepoByType` answers
// "both ends", which is a different question, and a doc that quoted one while
// naming the other produced a column no instrument field backed: `tgtSample` was
// accumulated and never emitted, and there was no target-in-repo field at all.
const perRepoTgtByType = (t: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, v] of [...perRepoRes].sort()) {
    const [repo, label] = k.split("|")
    if (label !== t || v.n === 0) continue
    out[repo] = `${v.tgt}/${v.n} ${pct(v.tgt, v.n)}`
  }
  return out
}
const perRepoTgtPooled = (t: string): string => {
  let n = 0
  let tgt = 0
  for (const [k, v] of perRepoRes) {
    if (k.split("|")[1] !== t) continue
    n += v.n
    tgt += v.tgt
  }
  return `${tgt}/${n} ${pct(tgt, n)}`
}
const pooledBoth = (t: string): string => {
  let n = 0
  let both = 0
  for (const [k, v] of perRepoRes) {
    if (k.split("|")[1] !== t) continue
    n += v.n
    both += v.both
  }
  return `${both}/${n} ${pct(both, n)}`
}
const out: any = {
  corpusRoot: CR,
  sampling: { method: "deterministic stride over git ls-files '*.dart', sorted, per repo", perRepo: PER_REPO, repos: repoStats },
  sampleFiles: sample.length,
  filesOverStructuralLimit1MB: overStructuralLimit.length,
  filesOverSkipLimit5MB: overSkipLimit.length,
  symbols,
  relationships,
  filesWithParseErrors: filesWithErrors,
  parseErrors,
  wallMs,
  emptySymbolNames: emptyNames.length,
  emptyOrUnknownKind: emptyKinds.length,
  unknownEndpoints: unknownEndpointCount,
  unknownEndpointSamples: unknownEndpointSamples.slice(0, 10),
  unknownEndpointsByLabel: Object.fromEntries([...unknownByLabel].sort((a, b) => b[1] - a[1])),
  emptyNameSamples: emptyNames.slice(0, 10),
  emptyKindSamples: emptyKinds.slice(0, 10),
  filesParsed: perRepoFiles,
  structuralFallbackFiles: fallbackFiles,
  structuralFallbackSymbols: fallbackSymbols,
  symbolsNamedUnknown,
  parseFailures: failures.length,
  parseFailureSamples: failures.slice(0, 10),
  symbolKinds: Object.fromEntries([...kindCounts].sort((a, b) => b[1] - a[1])),
  filesWithoutContains: filesWithoutContains,
  filesWithoutContainsCount: filesWithoutContains.length,
  perType: {},
}
delete out.relationships

const pt: any = {}
for (const t of ALL_TYPES) {
  const n = relCounts.get(t) ?? 0
  const p = perType(t)
  const c = relConf.get(t)
  pt[t] = {
    count: n,
    filesWithExamples: [...(relFiles.get(t) ?? [])],
    filesWith: relFilesAll.get(t)?.size ?? 0,
    filesWithByRepo: Object.fromEntries([...(relFilesByRepo.get(t) ?? [])].map(([r, s]) => [r, s.size]).sort((a, b) => (b[1] as number) - (a[1] as number))),
    resolution: {
      sourceInFile: `${p.srcRes}/${p.n} ${pct(p.srcRes, p.n)}`,
      targetInFile: `${p.tgtRes}/${p.n} ${pct(p.tgtRes, p.n)}`,
      bothInFile: `${p.bothRes}/${p.n} ${pct(p.bothRes, p.n)}`,
      targetInSample: `${p.tgtSample}/${p.n} ${pct(p.tgtSample, p.n)}`,
      bothInSample: `${p.bothSample}/${p.n} ${pct(p.bothSample, p.n)}`,
      bothInSameRepo: perRepoByType(t),
      targetInSameRepoPooled: perRepoTgtPooled(t),
      bothInSameRepoPooled: pooledBoth(t),
      targetInSameRepo: perRepoTgtByType(t),
      unresolvedTargetShapes: Object.fromEntries([...(unresolvedShape.get(t) ?? [])].sort((a, b) => b[1] - a[1])),
    },
    confidence: c ? {
      heuristicBelow0_7: `${c.heuristic}/${c.total} ${pct(c.heuristic, c.total)}`,
      min: Number(c.min.toFixed(3)),
      mean: Number((c.sum / c.total).toFixed(3)),
    } : null,
    evidenceClass: Object.fromEntries([...(relEvidence.get(t) ?? [])].sort((a, b) => b[1] - a[1])),
    reasonCodes: Object.fromEntries([...(relReason.get(t) ?? [])].sort((a, b) => b[1] - a[1])),
  }
}
const other = [...relCounts].filter(([k]) => !ALL_TYPES.includes(k as Type))
if (other.length) pt["<non-ontology labels>"] = Object.fromEntries(other)
out.perType = pt

const line = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`dart ontology census — ${sample.length} files from ${REPOS.length} repo(s), ${wallMs} ms`)
console.log(`symbols ${symbols}  relationships ${relationships}  filesWithParseErrors ${filesWithErrors}  parseErrors ${parseErrors}`)
console.log(`emptySymbolNames ${out.emptySymbolNames}  emptyOrUnknownKind ${out.emptyOrUnknownKind}  unknownEndpoints ${out.unknownEndpoints}`)
console.log(`files >1MB (structural fallback, analyzer never sees them) ${overStructuralLimit.length}  >5MB (skipped) ${overSkipLimit.length}`)
console.log(`structuralFallbackFiles ${fallbackFiles}  structuralFallbackSymbols ${fallbackSymbols}  symbolsNamedUnknown ${symbolsNamedUnknown}\n`)
// Column widths sized to the widest value they hold ("119515/119515 100.0%" is 19
// characters): a narrow column silently ran the next value into this one and the
// table printed a number nobody could read.
console.log(`${line("type", 14)}${line("count", 9)}${line("src\u2208file", 20)}${line("tgt\u2208file", 20)}${line("both\u2208file", 20)}${line("tgt\u2208sample", 20)}${line("both\u2208sample", 20)}${line("tgt\u2208repo", 20)}${line("both\u2208repo", 20)}${line("heur<0.7", 18)}evidenceClass`)
console.log("-".repeat(230))
for (const t of ALL_TYPES) {
  const e = pt[t]
  const h = e.confidence ? e.confidence.heuristicBelow0_7 : "-"
  console.log(`${line(t, 14)}${line(String(e.count), 9)}${line(e.resolution.sourceInFile, 20)}${line(e.resolution.targetInFile, 20)}${line(e.resolution.bothInFile, 20)}${line(e.resolution.targetInSample, 20)}${line(e.resolution.bothInSample, 20)}${line(e.resolution.targetInSameRepoPooled, 20)}${line(pooledBoth(t), 20)}${line(h, 18)}${JSON.stringify(e.evidenceClass)}`)
}
for (const k of Object.keys(pt)) {
  if (k.startsWith("<")) console.log(`${line(k, 14)}${line(String(pt[k].count), 9)}`)
}
console.log("\nsymbol kinds:", JSON.stringify(out.symbolKinds))

// BREADTH — how many files each label fires in, and where. The table above answers
// "how many edges"; this one answers "how widely", which is a different question and
// the one a verdict rests on: a type whose edges all land in one repository is a
// single-corpus claim however large its count.
const repoOrder = REPOS.slice().sort()
console.log(`\nper-type BREADTH over ${sample.length} files (files carrying the label, uncapped)`)
console.log(`${line("type", 14)}${line("edges", 9)}${line("files", 7)}${line("%files", 8)}${line("repos", 7)}${repoOrder.map(r => line(r, 16)).join("")}`)
console.log("-".repeat(46 + 16 * repoOrder.length))
const breadthRows = ALL_TYPES.map(t => ({ t, e: pt[t] as any, f: (relFilesAll.get(t)?.size ?? 0) }))
  .sort((a, b) => b.f - a.f)
for (const { t, e, f } of breadthRows) {
  const byRepo = e.filesWithByRepo as Record<string, number>
  const reposWith = Object.keys(byRepo).length
  console.log(`${line(t, 14)}${line(String(e.count), 9)}${line(String(f), 7)}${line(pct(f, sample.length), 8)}${line(`${reposWith}/${repoOrder.length}`, 7)}${repoOrder.map(r => line(String(byRepo[r] ?? 0), 16)).join("")}`)
}
console.log(`files carrying NO contains edge: ${filesWithoutContains.length}  (characterized by zero-contains-probe.ts, not here)`)

if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }
