/**
 * JSON LANE CENSUS — production `parseFile`, every relationship type counted.
 *
 * ## Why this exists and why it calls `parseFile`
 *
 * The ontology gate answers "is this type emitted?" by running the production entry
 * point over the corpus. This harness answers the questions a gate cannot: how MANY
 * edges of each type, whether both endpoints bind to real symbols, whether any symbol
 * has an empty name or an unknown kind, whether any edge endpoint is the placeholder
 * literal `unknown`, and how much of the graph is below the 0.7 heuristic threshold.
 *
 * It goes through `parseFile` from `src/ast/pool-worker.ts` and NOT
 * `RealJsonAnalyzer.analyze()`. `analyze()` is a per-file unit that skips the
 * pipeline stages — the pool-worker size gates, the timeout policy, the truncation
 * path and the enhancement passes. A count taken from `analyze()` is a count of the
 * analyzer, not of the product; every number in the lane's report comes from here.
 *
 * ## Sampling method — stated, not implied
 *
 * The population is every git-TRACKED file in the corpus root for which
 * `detectLanguageFromPath(path, text) === "json"` — the same admission test the
 * ontology gate uses, so the two answer about the same population. Tracked files only,
 * because an untracked build artifact is not what a consumer of the graph sees.
 *
 * Files are enumerated in a DETERMINISTIC order (repo name, then git path) and the
 * sample is the first `LIMIT` of them. It is therefore a prefix of the sorted
 * population, not a random draw: reproducible from a clean corpus, and biased towards
 * repos whose names sort early. The bias is stated here rather than left for a reader
 * to discover. `LIMIT=0` means the whole admitted population.
 *
 * ## What it measures
 *
 *   - relationship type -> edge count, distinct files, up to 6 example files
 *   - SymbolKind histogram, flagging any empty/unknown/unrecognised kind
 *   - symbols with an empty name
 *   - relationship endpoints equal to the literal `unknown` (rule R7)
 *   - per-type endpoint resolution: both endpoints / source only / target only /
 *     neither, resolved against the file's own symbol set by name OR qualifiedName
 *   - per-type confidence histogram, and the sub-0.7 heuristic count
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/json/census.ts [--limit N] [--out file.json]
 */
import { spawn } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { admittedFiles, describeWalk } from "./admitted-files"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const argv = process.argv.slice(2)
const argOf = (flag: string, dflt: string) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const LIMIT = Number(argOf("--limit", "0"))
const OUT = argOf("--out", "")
const MAX_BYTES = 512 * 1024
/** A pre-built population list, so a child process does not re-walk the whole corpus root. */
const MANIFEST = argOf("--manifest", "")
/** Restrict to one repo. Used by `--chunked` to give each child a bounded slice. */
const ONLY_REPO = argOf("--repo", "")
/** Absolute paths to skip. Used by `--chunked` to drop a file that hangs the parser. */
const EXCLUDE = new Set(argv.flatMap((a, i) => (a === "--exclude-file" && argv[i + 1] ? [argv[i + 1]] : [])))
const CHUNKED = argv.includes("--chunked")
/** How many repo children run at once. Each child holds one wasm parser. */
const CONCURRENCY = Number(argOf("--concurrency", "4"))

type FileRow = { repo: string; dir: string; rel: string; abs: string }

// ---------------------------------------------------------------- population
// The admission rules live in `admitted-files.ts` so this lane has ONE denominator.
// They used to be inline here and were re-derived, differently, by three probes — see
// that file's header for the two ways the copies diverged and what each cost.
const population: FileRow[] = []
if (MANIFEST) {
  population.push(...(JSON.parse(readFileSync(MANIFEST, "utf8")) as FileRow[]))
} else {
  const walk = admittedFiles(CR, MAX_BYTES)
  for (const f of walk.files) population.push({ repo: f.repo, dir: f.dir, rel: f.rel, abs: f.abs })
  console.log(describeWalk(walk, CR))
}
const admitted = population
const files = (LIMIT > 0 ? population.slice(0, LIMIT) : population).filter(
  (f) => (ONLY_REPO === "" || f.repo === ONLY_REPO) && !EXCLUDE.has(f.abs),
)

const perRepo: Record<string, number> = {}
for (const f of admitted) perRepo[f.repo] = (perRepo[f.repo] ?? 0) + 1

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(2)}%`)

if (CHUNKED) {
  /**
   * WHY THIS MODE EXISTS — a parser hang destroys a whole-corpus census.
   *
   * `src/ast/engine.ts:1441` arms a 120-second timer around the SYNCHRONOUS
   * `parser.parse()` and calls `process.exit(1)` when it fires. `setTimeout` cannot interrupt
   * synchronous WASM, so killing the process is the only option available to that code — but
   * the consequence for a census is total: one pathological file ends the run before any tally
   * is printed, and every other file in the corpus is silently unmeasured.
   *
   * The file that does it here is
   *   clj-kondo/resources/clj_kondo/impl/cache/built_in/java/
   *     java.util.concurrent.CompletableFuture$UniComposeExceptionally.transit.json
   * which is 200 bytes of CLOJURE TRANSIT (`["^ ","~:members",…]`) admitted as JSON purely
   * because the filename ends `.json`. It is a `language-detection.ts` admission question and
   * that file is shared, so this lane reports it rather than editing it.
   *
   * The response is to run the SAME population through the SAME production `parseFile` in
   * bounded per-repo children, so a hang costs one repo rather than the run. A child that dies
   * is retried with the hanging file excluded, and the exclusion is REPORTED in the output
   * (`excludedFiles`) and in the printed header — never silently absorbed, because a census
   * that quietly drops the file it could not measure is exactly the "empty result over a
   * non-empty corpus" the workstream calls a failed check.
   *
   * Each child reads a pre-built manifest rather than re-walking the corpus root, so the
   * 138 children cost one enumeration instead of 138.
   */
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "json-census-"))
  const byRepo = new Map<string, FileRow[]>()
  for (const f of admitted) {
    const list = byRepo.get(f.repo) ?? []
    list.push(f)
    byRepo.set(f.repo, list)
  }
  const repos = [...byRepo.keys()].sort()
  console.log(`json lane census (chunked) — ${admitted.length} admitted files across ${repos.length} repos, ${CONCURRENCY} children at a time`)
  console.log(`scratch: ${tmpRoot}\n`)

  const excluded: string[] = []
  const failedRepos: string[] = []
  const results = new Map<string, any>()
  let next = 0
  let done = 0

  /** Run one repo's slice in a child process, retrying without any file that hangs. */
  async function runRepo(repo: string): Promise<void> {
    const dropped = new Set<string>()
    for (let attempt = 1; attempt <= 8; attempt++) {
      const manifest = path.join(tmpRoot, `${repo.replace(/[^A-Za-z0-9._-]/g, "_")}.manifest.json`)
      const slice = byRepo.get(repo)!.filter((f) => !dropped.has(f.abs))
      writeFileSync(manifest, JSON.stringify(slice))
      const outFile = `${manifest}.out.json`
      const args = ["tsx", path.join(import.meta.dirname, "census.ts"), "--manifest", manifest, "--out", outFile]
      for (const d of dropped) args.push("--exclude-file", d)
      let stderr = ""
      let code = 0
      try {
        const r = await new Promise<{ code: number; stderr: string }>((resolve) => {
          const child = spawn("npx", args, { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, BB_LOG_LEVEL: process.env.BB_LOG_LEVEL ?? "error" } })
          let buf = ""
          child.stderr.on("data", (c) => {
            buf += String(c)
          })
          child.on("close", (c) => resolve({ code: c ?? 0, stderr: buf }))
        })
        code = r.code
        stderr = r.stderr
      } catch (e: any) {
        stderr = String(e?.message ?? e)
      }
      if (code === 0) {
        results.set(repo, JSON.parse(readFileSync(outFile, "utf8")))
        done++
        console.log(`  [${done}/${repos.length}] ${repo} — ${slice.length} file(s)${dropped.size ? `, ${dropped.size} excluded` : ""}`)
        return
      }
      // The engine names the file it gave up on, so the exclusion is derived, not guessed.
      const m = /\[BB-HANG\] parser stuck \d+s on (.+?) — exiting/.exec(stderr)
      if (m && !dropped.has(m[1])) {
        dropped.add(m[1])
        excluded.push(m[1])
        console.log(`  [${repo}] parser hang on ${path.basename(m[1])} — retrying without it (attempt ${attempt})`)
        continue
      }
      failedRepos.push(repo)
      done++
      console.log(`  [${done}/${repos.length}] ${repo} — FAILED, no verdict (exit ${code})`)
      return
    }
    failedRepos.push(repo)
    done++
  }

  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
    while (true) {
      const i = next++
      if (i >= repos.length) return
      await runRepo(repos[i])
    }
  }))

  // ------------------------------------------------------------------ aggregate
  const agg: any = {
    tool: "json lane census (chunked aggregate)",
    corpusRoot: CR,
    admittedPopulation: admitted.length,
    sampled: admitted.length - excluded.length,
    sampleMethod: "whole admitted population, run through production parseFile in per-repo children; files that hang the parser are excluded and listed",
    perRepoPopulation: Object.fromEntries([...byRepo.entries()].map(([r, v]) => [r, v.length])),
    excludedFiles: excluded,
    reposWithNoVerdict: failedRepos,
    parseFailures: 0,
    parseFailureExamples: [] as string[],
    filesWithSymbols: 0,
    filesWithAnyEdge: 0,
    symbolsTotal: 0,
    emptyNameSymbols: 0,
    emptyNameExamples: [] as string[],
    emptyKindSymbols: 0,
    unknownKindSymbols: 0,
    badKindExamples: [] as string[],
    relationshipsTotal: 0,
    unknownEndpointEdges: 0,
    unknownEndpointExamples: [] as string[],
    types: {} as any,
    symbolKinds: {} as Record<string, number>,
    heuristicEdgesTotal: 0,
    confidentEdgesTotal: 0,
  }
  const add = (arr: string[], more: string[], cap = 6) => {
    for (const m of more) if (arr.length < cap) arr.push(m)
  }
  for (const repo of repos) {
    const r = results.get(repo)
    if (!r) continue
    agg.parseFailures += r.parseFailures
    agg.filesWithSymbols += r.filesWithSymbols
    agg.filesWithAnyEdge += r.filesWithAnyEdge
    agg.symbolsTotal += r.symbolsTotal
    agg.emptyNameSymbols += r.emptyNameSymbols
    agg.emptyKindSymbols += r.emptyKindSymbols
    agg.unknownKindSymbols += r.unknownKindSymbols
    agg.relationshipsTotal += r.relationshipsTotal
    agg.unknownEndpointEdges += r.unknownEndpointEdges
    add(agg.parseFailureExamples, r.parseFailureExamples ?? [])
    add(agg.emptyNameExamples, r.emptyNameExamples ?? [])
    add(agg.badKindExamples, r.badKindExamples ?? [])
    add(agg.unknownEndpointExamples, r.unknownEndpointExamples ?? [])
    for (const [k, v] of Object.entries(r.symbolKinds ?? {})) agg.symbolKinds[k] = (agg.symbolKinds[k] ?? 0) + Number(v)
    for (const t of ALL_TYPES) {
      const row = r.types?.[t]
      if (!row || row.verdict !== "EMITTED") continue
      const a = (agg.types[t] ??= {
        verdict: "EMITTED",
        edges: 0,
        files: 0,
        examples: [] as string[],
        resolution: { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0, total: 0 },
        confidence: { under07: 0, min: 1, max: 0, total: 0 },
        evidenceClass: {} as Record<string, number>,
      })
      a.edges += row.edges
      a.files += row.files
      add(a.examples, row.examples ?? [])
      if (row.resolution) {
        a.resolution.both += row.resolution.both
        a.resolution.sourceOnly += row.resolution.sourceOnly
        a.resolution.targetOnly += row.resolution.targetOnly
        a.resolution.neither += row.resolution.neither
        a.resolution.total += row.resolution.total
      }
      if (row.confidence) {
        a.confidence.under07 += row.confidence.under07
        a.confidence.total += row.confidence.total
        a.confidence.min = Math.min(a.confidence.min, row.confidence.min ?? 1)
        a.confidence.max = Math.max(a.confidence.max, row.confidence.max ?? 0)
      }
      for (const [k, v] of Object.entries(row.evidenceClass ?? {})) a.evidenceClass[k] = (a.evidenceClass[k] ?? 0) + Number(v)
    }
  }
  for (const t of ALL_TYPES) {
    const a = agg.types[t]
    if (!a) {
      agg.types[t] = { verdict: "NOT-EMITTED", edges: 0 }
      continue
    }
    a.resolution.bothPct = pct(a.resolution.both, a.resolution.total)
    a.confidence.under07Pct = pct(a.confidence.under07, a.confidence.total)
  }
  agg.heuristicEdgesTotal = Object.values(agg.types).reduce((n: number, t: any) => n + (t.confidence?.under07 ?? 0), 0)
  agg.confidentEdgesTotal = Object.values(agg.types).reduce((n: number, t: any) => n + (t.confidence?.total ?? 0), 0)
  agg.symbolKinds = Object.fromEntries(Object.entries(agg.symbolKinds).sort((a, b) => Number(b[1]) - Number(a[1])))
  printCensus(agg)
  process.exit(0)
}



// ---------------------------------------------------------------- tallies
type TypeRow = { edges: number; files: Set<string>; examples: string[] }
const byType = new Map<string, TypeRow>()
const kindHistogram = new Map<string, number>()
let symbolsTotal = 0
let emptyNameSymbols = 0
let emptyKindSymbols = 0
let unknownKindSymbols = 0
const emptyNameExamples: string[] = []
const badKindExamples: string[] = []
let unknownEndpointEdges = 0
const unknownEndpointExamples: string[] = []
const typeConf: Record<string, { under07: number; total: number; min: number; max: number }> = {}
const typeResolve: Record<string, { both: number; sourceOnly: number; targetOnly: number; neither: number; total: number }> = {}
const typeEvidence: Record<string, Record<string, number>> = {}
let relsTotal = 0
let filesWithAnyEdge = 0
let filesWithSymbols = 0
let parseFailures = 0
const failureExamples: string[] = []

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f.abs, f.dir)
  } catch (e: any) {
    parseFailures++
    if (failureExamples.length < 6) failureExamples.push(`${f.repo}/${f.rel}: ${String(e?.message ?? e)}`)
    continue
  }
  const label = `${f.repo}/${f.rel}`
  const syms = r.symbols ?? []
  if (syms.length > 0) filesWithSymbols++
  const byName = new Set<string>()
  const byQualified = new Set<string>()
  for (const s of syms) {
    byName.add(String(s.name))
    byQualified.add(String(s.qualifiedName ?? s.name))
  }
  const resolves = (v: unknown) => byName.has(String(v)) || byQualified.has(String(v))

  for (const s of syms) {
    symbolsTotal++
    const name = String(s.name ?? "")
    if (name.trim().length === 0) {
      emptyNameSymbols++
      if (emptyNameExamples.length < 6) emptyNameExamples.push(`${label} kind=${String(s.kind)}`)
    }
    const kind = String(s.kind ?? "")
    kindHistogram.set(kind, (kindHistogram.get(kind) ?? 0) + 1)
    if (kind.trim().length === 0) {
      emptyKindSymbols++
      if (badKindExamples.length < 6) badKindExamples.push(`${label} ${name || "(no name)"}`)
    } else if (kind === "unknown" || kind === "Unknown") {
      unknownKindSymbols++
      if (badKindExamples.length < 6) badKindExamples.push(`${label} ${name}`)
    }
  }

  const rels = r.relationships ?? []
  if (rels.length > 0) filesWithAnyEdge++
  for (const x of rels) {
    relsTotal++
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    if (!ALL_TYPES.includes(t)) continue
    const row = byType.get(t) ?? { edges: 0, files: new Set<string>(), examples: [] }
    row.edges++
    row.files.add(label)
    if (row.examples.length < 6) row.examples.push(`${label}:${x.line_number ?? 0} ${x.source} -[${t}]-> ${x.target}`)
    byType.set(t, row)

    const src = String(x.source ?? "")
    const tgt = String(x.target ?? "")
    if (src === "unknown" || tgt === "unknown") {
      unknownEndpointEdges++
      if (unknownEndpointExamples.length < 6) unknownEndpointExamples.push(`${label}: ${src} -[${t}]-> ${tgt}`)
    }
    const sOk = resolves(src)
    const tOk = resolves(tgt)
    const cell = (typeResolve[t] ??= { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0, total: 0 })
    cell.total++
    if (sOk && tOk) cell.both++
    else if (sOk) cell.sourceOnly++
    else if (tOk) cell.targetOnly++
    else cell.neither++

    const conf = Number(x.confidence ?? 0)
    const cc = (typeConf[t] ??= { under07: 0, total: 0, min: 1, max: 0 })
    cc.total++
    if (Number.isFinite(conf)) {
      if (conf < 0.7) cc.under07++
      if (conf < cc.min) cc.min = conf
      if (conf > cc.max) cc.max = conf
    }
    const ev = String((x.metadata ?? {}).evidenceClass ?? "(absent)")
    typeEvidence[t] ??= {}
    typeEvidence[t][ev] = (typeEvidence[t][ev] ?? 0) + 1
  }
}

// ---------------------------------------------------------------- report
const out: any = {
  tool: "json lane census",
  corpusRoot: CR,
  admittedPopulation: population.length,
  sampled: files.length,
  sampleMethod: LIMIT > 0 ? `deterministic prefix of (repo, git-path)-sorted population, first ${LIMIT}` : "whole admitted population",
  perRepoPopulation: perRepo,
  parseFailures,
  parseFailureExamples: failureExamples,
  filesWithSymbols,
  filesWithAnyEdge,
  symbolsTotal,
  emptyNameSymbols,
  emptyNameExamples,
  emptyKindSymbols,
  unknownKindSymbols,
  badKindExamples,
  relationshipsTotal: relsTotal,
  unknownEndpointEdges,
  unknownEndpointExamples,
  types: {} as any,
}
for (const t of ALL_TYPES) {
  const row = byType.get(t)
  const r = typeResolve[t]
  const c = typeConf[t]
  const e = typeEvidence[t]
  out.types[t] = row
    ? {
        verdict: "EMITTED",
        edges: row.edges,
        files: row.files.size,
        examples: row.examples,
        resolution: r
          ? {
              bothPct: pct(r.both, r.total),
              sourceOnly: r.sourceOnly,
              targetOnly: r.targetOnly,
              neither: r.neither,
              both: r.both,
              total: r.total,
            }
          : null,
        confidence: c ? { under07: c.under07, under07Pct: pct(c.under07, c.total), min: c.min, max: c.max, total: c.total } : null,
        evidenceClass: e ?? null,
      }
    : { verdict: "NOT-EMITTED", edges: 0 }
}
out.symbolKinds = Object.fromEntries([...kindHistogram.entries()].sort((a, b) => b[1] - a[1]))
out.heuristicEdgesTotal = Object.values(typeConf).reduce((a, c) => a + c.under07, 0)
out.confidentEdgesTotal = Object.values(typeConf).reduce((a, c) => a + c.total, 0)

/**
 * Print a census RESULT, whether it came from this process or from an aggregation of
 * per-repo children. Takes the result object rather than reading the closures above, so the
 * chunked path and the single-process path cannot print different things.
 */
function printCensus(o: any): void {
  console.log(`json lane census — population ${o.admittedPopulation}, sampled ${o.sampled}, parse failures ${o.parseFailures}`)
  if (o.excludedFiles?.length) console.log(`EXCLUDED ${o.excludedFiles.length} file(s) that hang the parser: ${o.excludedFiles.join(" | ")}`)
  console.log(`symbols ${o.symbolsTotal} (empty name ${o.emptyNameSymbols}, empty kind ${o.emptyKindSymbols}, unknown kind ${o.unknownKindSymbols})`)
  console.log(`relationships ${o.relationshipsTotal}, endpoints equal to literal "unknown": ${o.unknownEndpointEdges}`)
  console.log(`files with symbols ${o.filesWithSymbols}, files with any edge ${o.filesWithAnyEdge}`)
  console.log("")
  console.log(`${"type".padEnd(14)}${"edges".padStart(9)}${"files".padStart(7)}${"both%".padStart(9)}${"srcOnly".padStart(8)}${"neither".padStart(8)}${"<0.7".padStart(7)}`)
  console.log("-".repeat(64))
  for (const t of ALL_TYPES) {
    const row = o.types[t]
    if (!row || row.verdict !== "EMITTED") {
      console.log(`${t.padEnd(14)}${"0".padStart(9)}${"-".padStart(7)}${"-".padStart(9)}${"-".padStart(8)}${"-".padStart(8)}${"-".padStart(7)}`)
      continue
    }
    const r = row.resolution
    const c = row.confidence
    console.log(
      `${t.padEnd(14)}${row.edges.toLocaleString().padStart(9)}${String(row.files).padStart(7)}${(r?.bothPct ?? "n/a").padStart(9)}${String(r?.sourceOnly ?? "-").padStart(8)}${String(r?.neither ?? "-").padStart(8)}${String(c?.under07 ?? "-").padStart(7)}`,
    )
  }
  console.log("-".repeat(64))
  console.log(`heuristic (<0.7) ${o.heuristicEdgesTotal} of ${o.confidentEdgesTotal} confidence-bearing edges = ${pct(o.heuristicEdgesTotal, o.confidentEdgesTotal)}`)
  console.log("symbol kinds: " + Object.entries(o.symbolKinds).map(([k, v]) => `${k}=${v}`).join(" "))
  if (o.emptyNameExamples?.length) console.log("empty-name examples: " + o.emptyNameExamples.join(" | "))
  if (o.badKindExamples?.length) console.log("bad-kind examples: " + o.badKindExamples.join(" | "))
  if (o.unknownEndpointExamples?.length) console.log("unknown-endpoint examples: " + o.unknownEndpointExamples.join(" | "))
  if (o.parseFailureExamples?.length) console.log("parse failure examples: " + o.parseFailureExamples.join(" | "))
  for (const t of ALL_TYPES) {
    const e = o.types[t]?.evidenceClass
    if (e) console.log(`evidenceClass[${t}]: ` + Object.entries(e).map(([k, v]) => `${k}=${v}`).join(" "))
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(o, null, 2))
    console.log(`\nwrote ${OUT}`)
  }
}

printCensus(out)
