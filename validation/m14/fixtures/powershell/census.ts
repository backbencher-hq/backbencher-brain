/**
 * M14 ONTOLOGY CENSUS — powershell. The BEFORE instrument.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts` is the arbiter, and it refuses to report for a
 * language with no RULING TABLE (`RULED_BY_LANG` has no `powershell` entry, so it exits 2
 * with "no RULING TABLE"). That refusal is the arbiter being honest — a gate with an empty
 * table would call every un-emitted type RULED-UNJUSTIFIED, which is a verdict about the
 * TABLE and not about the lane. So the arbiter cannot answer "which of the 10 types does
 * PowerShell emit", and the lane needs that answer measured rather than asserted.
 *
 * So this file is the census, and it is deliberately the same corpus admission the arbiter
 * uses — `git ls-files` over every repo under BB_CORPUS_ROOT, gated on
 * `detectLanguageFromPath(abs, text) === "powershell"` — so the numbers here and the
 * arbiter's numbers are the same population, not two populations that happen to look alike.
 *
 * ## Production entry point, deliberately
 *
 * Counts come from `parseFile` in `src/ast/pool-worker.ts`, NOT from `analyze()`. `analyze()`
 * is the per-file unit: it skips the pipeline stages (the worker pool, the size gates, the
 * structural fallback above 1 MB, the enhancements). A count taken at `analyze()` is a count
 * of a code path production never takes.
 *
 * ## Why this is a DRIVER that forks shards
 *
 * `src/ast/engine.ts:1412` installs a per-file self-destruct timer: `parser.parse()` is
 * synchronous WASM and cannot be interrupted from the event loop, so a pathological input
 * hangs forever and the engine kills the whole process with `[BB-HANG] … — exiting` after
 * 120 s. That is correct production behaviour (the indexer is incremental and resumes), and
 * it means a single-file census in ONE process reports a truncated population and exits 1.
 * The first run of this file did exactly that.
 *
 * So the census shards the corpus across child processes, and when a shard dies it reads the
 * offending path out of the child's stderr, records it as EXCLUDED with its reason, and
 * re-runs that shard without it. Exclusions are printed, not hidden: a census that silently
 * drops the files it could not parse is the "empty result over a non-empty corpus" failure
 * this project refuses.
 *
 * ## What it reports
 *
 * Per relationship type: edge count, distinct files, the files themselves, the confidence
 * distribution (anything under 0.7 is a HEURISTIC per honesty contract §4 and is counted as
 * one), the `evidenceClass` distribution, and the RESOLUTION rate at both endpoints —
 * measured twice, because "resolves" has two honest answers and reporting only one hides the
 * interesting half:
 *
 *   intra-file  both endpoints name a symbol declared in the SAME file. This is the rate the
 *               analyzer is answerable for: it is the analyzer's own symbol table.
 *   corpus-wide both endpoints name a symbol declared in ANY sampled file. This is the rate a
 *               reader of `bb_graph` actually experiences, because a `calls` edge to a cmdlet
 *               defined in a sibling file resolves in the store and not here.
 *
 * It also reports the standing-rule counters: SymbolKind values that are empty or `unknown`,
 * symbols with empty names, and relationship endpoints equal to the literal `unknown`
 * (ledger rule R7).
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/powershell/census.ts [--out path.json] [--shard-size N]
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "powershell"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/**
 * A NULL-PROTOTYPE counter map.
 *
 * This exists because the first version of this file used `{}` and produced two
 * fabricated findings out of its own bug. `kindCounts["constructor"] = (kindCounts["constructor"] ?? 0) + 1`
 * does not start at 0: `Object.prototype.constructor` is the `Object` function, which is
 * not `undefined`, so `?? 0` keeps it and `Object + 1` STRINGIFIES the function source.
 * The census then reported a SymbolKind reading
 *
 *     function Object() { [native code] }function Object() { [native code] }1function ...
 *
 * which reads like a catastrophic analyzer defect and was nothing of the kind — the
 * analyzer emits `constructor` correctly and every other SymbolKind cleanly. The same
 * collision silently NaN'd the corpus-wide resolution figure for `calls`, `uses`,
 * `contains` and `instantiates`, because a cmdlet or type named `constructor`,
 * `toString` or `valueOf` hit the same inherited members.
 *
 * A duplicate key is VALID JavaScript, which is exactly why nothing typechecked and
 * nothing threw. `Object.create(null)` has no inherited members, so the only key that
 * can exist is one that was put there.
 */
const counter = (): Record<string, number> => Object.create(null)

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const SHARD_SIZE = Number(argOf("--shard-size") ?? "120") || 120
const SELF = path.resolve(process.argv[1])

// ---------------------------------------------------------------- corpus
// Identical admission to the arbiter, so the two are measuring one population.
function enumerate(): { repo: string; dir: string; rel: string; abs: string }[] {
  const out: { repo: string; dir: string; rel: string; abs: string }[] = []
  for (const e of readdirSync(CR)) {
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
      try {
        if (statSync(abs).size > 512 * 1024) continue
        readFileSync(abs, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== LANG) continue
      out.push({ repo: e, dir, rel, abs })
    }
  }
  return out
}

// ---------------------------------------------------------------- shard worker
type ShardResult = {
  files: number
  filesOk: number
  filesFailed: number
  filesWithParseErrors: number
  totalSymbols: number
  totalRels: number
  totalImports: number
  totalExports: number
  perType: Record<string, {
    n: number
    files: string[]
    confidences: Record<string, number>
    evidenceClasses: Record<string, number>
    heuristic: number
    missingLine: number
    examples: string[]
    /** PS26 — EXACT distinct-file set, uncapped. `files` below is a 400-entry DISPLAY cap
     *  that existed to keep the printed table narrow, and it made three types print
     *  `files 400`, which reads as an exact count and is not one. The cap is still there
     *  for the examples; this is the number a verdict should quote. Bounded by the
     *  admitted file count (1,092), so it costs at most one label per file per type. */
    fileSet: string[]
    intraBoth: number
    intraSrc: number
    intraTgt: number
    srcNames: Record<string, number>
    tgtNames: Record<string, number>
  }>
  symbolNames: string[]
  kindCounts: Record<string, number>
  emptyKind: number
  emptyName: number
  unknownEndpoint: number
  unknownEndpointExamples: { file: string; type: string; source: string; target: string }[]
  nonOntologyTypes: Record<string, number>
  parseErrorFiles: { file: string; n: number }[]
}

async function runShard(slice: { repo: string; dir: string; rel: string; abs: string }[]): Promise<ShardResult> {
  const perType: ShardResult["perType"] = {}
  const symbolNames: string[] = []
  const kindCounts: Record<string, number> = counter()
  const nonOntologyTypes: Record<string, number> = counter()
  const unknownEndpointExamples: ShardResult["unknownEndpointExamples"] = []
  const parseErrorFiles: ShardResult["parseErrorFiles"] = []
  let filesOk = 0, filesFailed = 0, filesWithParseErrors = 0
  let totalSymbols = 0, totalRels = 0, totalImports = 0, totalExports = 0
  let emptyKind = 0, emptyName = 0, unknownEndpoint = 0

  const bucket = (t: Type) => {
    let b = perType[t]
    if (!b) {
      b = { n: 0, files: [], fileSet: [], confidences: counter(), evidenceClasses: counter(), heuristic: 0, missingLine: 0, examples: [], intraBoth: 0, intraSrc: 0, intraTgt: 0, srcNames: counter(), tgtNames: counter() }
      perType[t] = b
    }
    return b
  }

  let idx = 0
  const worker = async () => {
    while (true) {
      const i = idx++
      if (i >= slice.length) return
      const f = slice[i]
      const label = `${f.repo}/${f.rel}`
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { filesFailed++; continue }
      filesOk++
      const syms = r.symbols ?? []
      const rels = r.relationships ?? []
      totalSymbols += syms.length
      totalRels += rels.length
      totalImports += (r.imports ?? []).length
      totalExports += (r.exports ?? []).length

      const names = new Set<string>()
      for (const s of syms) {
        const nm = String(s?.name ?? "")
        const kd = String(s?.kind ?? "")
        kindCounts[kd] = (kindCounts[kd] ?? 0) + 1
        if (kd === "" || kd.toLowerCase() === "unknown") emptyKind++
        if (nm.trim() === "") emptyName++
        names.add(nm); names.add(nm.toLowerCase())
        symbolNames.push(nm)
      }
      const errs = r.errors ?? []
      if (errs.length > 0) { filesWithParseErrors++; parseErrorFiles.push({ file: label, n: errs.length }) }

      for (const x of rels) {
        const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
        if (!ALL_TYPES.includes(t as Type)) { nonOntologyTypes[t] = (nonOntologyTypes[t] ?? 0) + 1; continue }
        const b = bucket(t as Type)
        b.n++
        if (b.files.length < 400 && !b.files.includes(label)) b.files.push(label)
        if (!b.fileSet.includes(label)) b.fileSet.push(label)
        const src = String(x?.source ?? "")
        const tgt = String(x?.target ?? "")
        const conf = Number(x?.confidence ?? NaN)
        const ck = Number.isNaN(conf) ? "NaN" : String(conf)
        b.confidences[ck] = (b.confidences[ck] ?? 0) + 1
        if (!(conf >= 0.7)) b.heuristic++
        const ec = String((x?.metadata as any)?.evidenceClass ?? "(none)")
        b.evidenceClasses[ec] = (b.evidenceClasses[ec] ?? 0) + 1
        if (typeof x?.line_number !== "number") b.missingLine++
        b.srcNames[src] = (b.srcNames[src] ?? 0) + 1
        b.tgtNames[tgt] = (b.tgtNames[tgt] ?? 0) + 1
        const sHit = names.has(src) || names.has(src.toLowerCase())
        const tHit = names.has(tgt) || names.has(tgt.toLowerCase())
        if (sHit) b.intraSrc++
        if (tHit) b.intraTgt++
        if (sHit && tHit) b.intraBoth++
        if (src === "unknown" || tgt === "unknown") {
          unknownEndpoint++
          if (unknownEndpointExamples.length < 25) unknownEndpointExamples.push({ file: label, type: t, source: src, target: tgt })
        }
        if (b.examples.length < 6) b.examples.push(`${src} -[${t}]-> ${tgt} @${x?.line_number ?? "?"} c=${ck}`)
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()))

  return {
    files: slice.length, filesOk, filesFailed, filesWithParseErrors,
    totalSymbols, totalRels, totalImports, totalExports,
    perType, symbolNames, kindCounts, emptyKind, emptyName,
    unknownEndpoint, unknownEndpointExamples, nonOntologyTypes, parseErrorFiles,
  }
}

// ---------------------------------------------------------------- child mode
if (process.env.BB_CENSUS_SHARD) {
  const slice = JSON.parse(readFileSync(process.env.BB_CENSUS_SHARD, "utf8"))
  const res = await runShard(slice)
  writeFileSync(`${process.env.BB_CENSUS_SHARD}.out`, JSON.stringify(res))
  console.log(`shard ok: ${res.filesOk}/${res.files} files, ${res.totalRels} rels`)
  process.exit(0)
}

// ---------------------------------------------------------------- driver
const all = enumerate()
const byRepo: Record<string, number> = {}
for (const f of all) byRepo[f.repo] = (byRepo[f.repo] ?? 0) + 1

console.log(`powershell ontology census`)
console.log(`corpus root: ${CR}`)
console.log(`admitted files (whole): ${all.length}`)
console.log(`admitted per repo: ${JSON.stringify(byRepo)}`)
console.log(`sampling method: git-tracked files, gated on detectLanguageFromPath === "powershell"; WHOLE admitted set, no sampling cut\n`)

const tmp = mkdtempSync(path.join(os.tmpdir(), "ps-census-"))
const excluded: { file: string; reason: string }[] = []
const shards: ReturnType<typeof enumerate>[] = []
for (let i = 0; i < all.length; i += SHARD_SIZE) shards.push(all.slice(i, i + SHARD_SIZE))

const merged: ShardResult = {
  files: 0, filesOk: 0, filesFailed: 0, filesWithParseErrors: 0,
  totalSymbols: 0, totalRels: 0, totalImports: 0, totalExports: 0,
  perType: Object.create(null), symbolNames: [], kindCounts: counter(), emptyKind: 0, emptyName: 0,
  unknownEndpoint: 0, unknownEndpointExamples: [], nonOntologyTypes: {}, parseErrorFiles: [],
}

const bump = (dst: Record<string, number>, src: Record<string, number>) => {
  for (const [k, v] of Object.entries(src)) dst[k] = (dst[k] ?? 0) + v
}

let shardNo = 0
for (const shard of shards) {
  shardNo++
  let pending = shard
  // A shard can die more than once: each death removes one hanging file.
  for (let attempt = 0; attempt < 12 && pending.length > 0; attempt++) {
    const inPath = path.join(tmp, `shard-${shardNo}-${attempt}.json`)
    writeFileSync(inPath, JSON.stringify(pending))
    const r = spawnSync("npx", ["tsx", SELF], {
      env: { ...process.env, BB_CENSUS_SHARD: inPath },
      encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, timeout: 900000,
    })
    if (r.status === 0 && r.stdout && /shard ok:/.test(r.stdout)) {
      const res: ShardResult = JSON.parse(readFileSync(`${inPath}.out`, "utf8"))
      merged.files += res.files; merged.filesOk += res.filesOk; merged.filesFailed += res.filesFailed
      merged.filesWithParseErrors += res.filesWithParseErrors
      merged.totalSymbols += res.totalSymbols; merged.totalRels += res.totalRels
      merged.totalImports += res.totalImports; merged.totalExports += res.totalExports
      merged.emptyKind += res.emptyKind; merged.emptyName += res.emptyName
      merged.unknownEndpoint += res.unknownEndpoint
      merged.symbolNames.push(...res.symbolNames)
      bump(merged.kindCounts, res.kindCounts)
      bump(merged.nonOntologyTypes, res.nonOntologyTypes)
      merged.unknownEndpointExamples.push(...res.unknownEndpointExamples)
      merged.parseErrorFiles.push(...res.parseErrorFiles)
      for (const [t, b] of Object.entries(res.perType)) {
        const d = merged.perType[t] ?? (merged.perType[t] = {
          n: 0, files: [], fileSet: [], confidences: counter(), evidenceClasses: counter(), heuristic: 0,
          missingLine: 0, examples: [], intraBoth: 0, intraSrc: 0, intraTgt: 0, srcNames: counter(), tgtNames: counter(),
        })
        d.n += b.n
        d.heuristic += b.heuristic
        d.missingLine += b.missingLine
        d.intraBoth += b.intraBoth; d.intraSrc += b.intraSrc; d.intraTgt += b.intraTgt
        for (const fl of b.files) if (d.files.length < 400 && !d.files.includes(fl)) d.files.push(fl)
        for (const fl of b.fileSet) if (!d.fileSet.includes(fl)) d.fileSet.push(fl)
        bump(d.confidences, b.confidences)
        bump(d.evidenceClasses, b.evidenceClasses)
        bump(d.srcNames, b.srcNames)
        bump(d.tgtNames, b.tgtNames)
        for (const e of b.examples) if (d.examples.length < 6) d.examples.push(e)
      }
      pending = []
      break
    }
    // Dead: find the offender the engine named, or fall back to dropping the last file.
    const m = /\[BB-HANG\].*? on (.+?) — exiting/.exec(`${r.stderr ?? ""}`)
    const offender = m ? m[1] : null
    const idx = offender ? pending.findIndex((f) => f.abs === offender) : pending.length - 1
    if (idx < 0) {
      console.error(`shard ${shardNo} died and the offending file is not in this shard: ${r.stderr?.slice(0, 400)}`)
      process.exitCode = 1
      pending = []
      break
    }
    const bad = pending[idx]
    excluded.push({ file: `${bad.repo}/${bad.rel}`, reason: offender ? "engine [BB-HANG]: parser.parse() exceeded 120 s and self-destructed the process" : "shard child died with no [BB-HANG] line; last file of the shard dropped to make progress" })
    console.error(`  excluded ${bad.repo}/${bad.rel} — ${excluded[excluded.length - 1].reason}`)
    pending = pending.slice(0, idx).concat(pending.slice(idx + 1))
  }
  console.log(`  shard ${shardNo}/${shards.length} done (running total: ${merged.totalRels} rels)`)
}
rmSync(tmp, { recursive: true, force: true })

// ---------------------------------------------------------------- cross-shard resolution
const corpusNames = new Set<string>()
for (const n of merged.symbolNames) { corpusNames.add(n); corpusNames.add(n.toLowerCase()) }

// ---------------------------------------------------------------- report
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const corpusHit = (rec: Record<string, number>): number => {
  let hit = 0
  for (const [k, v] of Object.entries(rec)) if (corpusNames.has(k) || corpusNames.has(k.toLowerCase())) hit += v
  return hit
}

console.log(`\nfiles attempted ${all.length}   excluded ${excluded.length}   parsed ok ${merged.filesOk}   failed ${merged.filesFailed}   with parse errors ${merged.filesWithParseErrors}`)
console.log(`symbols ${merged.totalSymbols}   relationships ${merged.totalRels}   imports[] ${merged.totalImports}   exports[] ${merged.totalExports}`)
console.log(`distinct symbol names corpus-wide ${corpusNames.size}`)
if (excluded.length) {
  console.log(`\nEXCLUDED FILES (each printed, none silent):`)
  for (const e of excluded) console.log(`  ${e.file} — ${e.reason}`)
}

console.log("\n=== RELATIONSHIP TYPES (production parseFile) ===")
console.log(`${w("type", 13)}${w("n", 9)}${w("files", 8)}${w("intraBoth", 11)}${w("intraSrc", 10)}${w("intraTgt", 10)}${w("corpusBoth", 12)}${w("heur<0.7", 10)}${w("noLine", 8)}evidenceClass`)
console.log("-".repeat(135))
const table: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const b = merged.perType[t]
  if (!b || b.n === 0) {
    console.log(`${w(t, 13)}${w("0", 9)}${w("-", 8)}${w("-", 11)}${w("-", 10)}${w("-", 10)}${w("-", 12)}${w("-", 10)}${w("-", 8)}NOT EMITTED`)
    table[t] = { n: 0 }
    continue
  }
  const cb = corpusHit(b.srcNames) + corpusHit(b.tgtNames)
  console.log(
    `${w(t, 13)}${w(String(b.n), 9)}${w(String(b.fileSet.length), 8)}${w(pct(b.intraBoth, b.n), 11)}${w(pct(b.intraSrc, b.n), 10)}${w(pct(b.intraTgt, b.n), 10)}${w(pct(cb, b.n * 2), 12)}${w(pct(b.heuristic, b.n), 10)}${w(String(b.missingLine), 8)}${JSON.stringify(b.evidenceClasses)}`,
  )
  table[t] = {
    n: b.n, files: b.files, distinctFiles: b.fileSet, confidences: b.confidences, evidenceClasses: b.evidenceClasses,
    intraBoth: b.intraBoth, intraSrc: b.intraSrc, intraTgt: b.intraTgt,
    corpusBothEndpoints: cb, corpusBothPct: pct(cb, b.n * 2),
    heuristic: b.heuristic, missingLine: b.missingLine, examples: b.examples,
  }
}

console.log("\n=== CONFIDENCE DISTRIBUTION PER TYPE ===")
for (const t of ALL_TYPES) {
  const b = merged.perType[t]
  if (!b || b.n === 0) continue
  console.log(`${w(t, 13)}${Object.entries(b.confidences).sort((a, x) => Number(a[0]) - Number(x[0])).map(([k, v]) => `${k}:${v}`).join("  ")}`)
}

console.log("\n=== FILES + EXAMPLES PER EMITTED TYPE ===")
for (const t of ALL_TYPES) {
  const b = merged.perType[t]
  if (!b || b.n === 0) continue
  console.log(`${t}:`)
  for (const e of b.examples.slice(0, 4)) console.log(`    ${e}`)
  console.log(`    files (${b.fileSet.length} distinct): ${b.files.slice(0, 5).join(", ")}`)
}

console.log("\n=== STANDING-RULE COUNTERS ===")
console.log(`SymbolKind values: ${JSON.stringify(Object.fromEntries(Object.entries(merged.kindCounts).sort((a, x) => x[1] - a[1])))}`)
console.log(`empty/unknown kind: ${merged.emptyKind}`)
console.log(`symbols with empty name: ${merged.emptyName}`)
console.log(`relationship endpoints == literal "unknown": ${merged.unknownEndpoint}${merged.unknownEndpointExamples.length ? ` e.g. ${JSON.stringify(merged.unknownEndpointExamples.slice(0, 3))}` : ""}`)
console.log(`relationship types OUTSIDE the 10-type ontology: ${JSON.stringify(merged.nonOntologyTypes)}`)
const worst = merged.parseErrorFiles.sort((a, x) => x.n - a.n).slice(0, 10)
console.log(`files carrying parse errors: ${merged.filesWithParseErrors}; worst: ${JSON.stringify(worst)}`)

const emitted = ALL_TYPES.filter((t) => (merged.perType[t]?.n ?? 0) > 0)
console.log(`\nEMITTED ${emitted.length}/10: ${emitted.join(", ")}`)
console.log(`NOT EMITTED: ${ALL_TYPES.filter((t) => !emitted.includes(t)).join(", ")}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    language: LANG, corpusRoot: CR,
    admittedFiles: all.length, admittedPerRepo: byRepo,
    samplingMethod: "git-tracked files gated on detectLanguageFromPath === powershell; WHOLE admitted set",
    excluded,
    filesOk: merged.filesOk, filesFailed: merged.filesFailed, filesWithParseErrors: merged.filesWithParseErrors,
    totalSymbols: merged.totalSymbols, totalRels: merged.totalRels,
    totalImports: merged.totalImports, totalExports: merged.totalExports,
    corpusSymbolNames: corpusNames.size,
    types: table,
    kindCounts: merged.kindCounts,
    emptyKind: merged.emptyKind, emptyName: merged.emptyName,
    unknownEndpoint: merged.unknownEndpoint,
    unknownEndpointExamples: merged.unknownEndpointExamples,
    nonOntologyTypes: merged.nonOntologyTypes,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}