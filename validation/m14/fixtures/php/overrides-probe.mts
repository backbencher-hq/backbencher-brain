/**
 * PHP `overrides` — the measure that decides EMITTED / RULED / GAP.
 *
 * ## The question
 *
 * Production `parseFile` emits **2** `overrides` edges across the 4,621-file
 * corpus (measured by `census-harness.mts`; this probe re-measures them from
 * `parseFile` rather than asserting the number, because an asserted premise
 * cannot be falsified). Is the near-absence because PHP has no such construct,
 * or because the analyzer cannot reach it?
 *
 * The answer is decided by reading the production context path, not by the
 * edge count, and the chain is short:
 *
 *   1. `RealPhpAnalyzer` emits `overrides` when
 *      `inFileMethods?.has(name) || context?.overrideCompanion?.get(base)?.has(name)`
 *      (src/ast/real-php-analyzer.ts:1777-1778, 1815). So the CONSTRUCT is read.
 *   2. `pool-worker.ts:1212` `contextFor()` returns `{ projectIndex }` and
 *      NEVER `overrideCompanion`. So the cross-file channel is empty.
 *   3. `parallel-indexer.ts:1300` `PROJECT_INDEX_EXTENSIONS = { ".sol": "solidity" }`.
 *      `.php` is not in it, so no project index is built for PHP at all and
 *      `contextFor` returns `undefined` for a `.php` file.
 *   4. `parallel-indexer.ts:1094` calls `parseFile(file, projectPath)` with no
 *      context at all.
 *
 * So the analyzer reads the construct; the PIPELINE never hands it the index.
 * That is a GAP in shared machinery, and no edit to the analyzer can close it.
 * Both halves of that claim are measured below: `S` is what production could
 * have emitted unaided, `C` is what it would emit WITH the companion, and
 * `productionEdges` is what it does emit.
 *
 * ## What this probe measures
 *
 * The ruling still needs a corpus number, so this counts on the parse tree:
 *
 *   S  SAME-FILE opportunities — a class whose declared base is declared in the
 *      SAME file, where a method name is declared on both. This is the only
 *      shape the analyzer can resolve with no index, so it bounds what
 *      production *could* emit unaided.
 *
 *   C  CROSS-FILE opportunities — the same, with the base resolved through a
 *      companion built from the WHOLE corpus, matching the shape
 *      `AnalyzeContext.overrideCompanion` carries (`Map<classLeaf, Set<method>>`).
 *      Built here from the analyzer's own emitted SYMBOLS, which is what
 *      `mergeSymbolsIntoOverrideCompanion` (src/ast/override-context.ts) does.
 *
 *   F  FALSE-RATE of C — of the cross-file opportunities, how many name a
 *      method the base does NOT declare. This is the number that decides
 *      whether feeding the companion is safe, and it is the number the M12
 *      audit reported as 66.7% for the removed guess edge.
 *
 * USAGE: npx tsx validation/m14/fixtures/php/overrides-probe.mts
 *        BB_JSON=1 ... > overrides-probe.json
 *        BB_SHARD=0 BB_NSHARDS=8 ...   # see SHARDING below
 *        BB_SKIP=<path substring>     # see SHARDING below
 *
 * ## SHARDING — why this probe can be run in pieces
 *
 * `src/ast/engine.ts:1408-1413` arms a 120s `parseBomb` timer around the
 * SYNCHRONOUS `parser.parse()` and calls `process.exit(1)` when it fires. So one
 * pathological file kills any in-process sweep of the whole corpus, and no
 * amount of try/catch in the caller can stop it. Measured on this corpus: the
 * first full-corpus attempt of this probe died on
 * `phpunit/src/Event/Exception/UnknownEventTypeException.php`, and the same
 * corpus completed on the census harness — so the kill is a TIMING-dependent
 * 120s timer, not a deterministic property of the file.
 *
 * The shard split is the honest workaround: `BB_SHARD=k` over `BB_NSHARDS=n`
 * runs every k-th admitted file in its own process, so a shard that dies costs
 * at most 1/n of the sweep, and `BB_SKIP=<substring>` removes the killer. A
 * report produced this way states the shards and the skipped files, because a
 * number from a sweep that quietly dropped files would be the exact dishonesty
 * this lane exists to prevent.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const admitted: { repo: string; dir: string; rel: string; abs: string }[] = []
const repoFilter = process.env.BB_REPOS ? process.env.BB_REPOS.split(",") : null
for (const e of readdirSync(CR)) {
  if (repoFilter && !repoFilter.includes(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    // `git ls-files` lists BROKEN SYMLINKS, which are tracked files that do not
    // exist on disk. An unwrapped statSync here aborts the whole probe on a file
    // in a repo that has nothing to do with php (cabal ships
    // cabal.project.symlink.broken), so the stat is guarded like the census
    // harness guards its own.
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs) !== "php") continue
    admitted.push({ repo: e, dir, rel, abs })
  }
}
admitted.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))

// ---- sharding / skip. See the SHARDING note in the header.
const SKIP = (process.env.BB_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const skippedByEnv = SKIP.length
const afterSkip = admitted.filter((f) => !SKIP.some((s) => f.abs.includes(s)))
const NSHARDS = Number(process.env.BB_NSHARDS ?? 1)
const SHARD = Number(process.env.BB_SHARD ?? 0)
const files = NSHARDS > 1 ? afterSkip.filter((_, i) => i % NSHARDS === SHARD) : afterSkip
const shardInfo = { shard: SHARD, nshards: NSHARDS, skippedByEnv, filesAdmittedAll: afterSkip.length + skippedByEnv, filesInThisShard: files.length }


// ---------------------------------------------------------------- ONE pass
//
// The class -> base map comes from the EMITTED `extends` EDGES, not from
// `metadata.baseClass`, and the reason is a property of the production entry
// point worth recording.
//
// `pool-worker.ts:958-1011` rebuilds every symbol through an explicit ALLOWLIST
// of metadata keys: css's selector vocabulary and markdown's outline keys,
// nothing else. `real-php-analyzer.ts:697` publishes `metadata.baseClass` and
// `real-php-analyzer.ts:1734` reads it back, but both happen INSIDE `analyze()`,
// before the narrowing. So through `parseFile`, `symbol.metadata` is
// `undefined` for every php class. MEASURED: a probe that read
// `metadata.baseClass` off `parseFile` reported `classesWithBase: 0` over 4,286
// symbols, while the same corpus emitted 2,808 `extends` edges.
//
// `extends` DOES survive (it is a relationship, not symbol metadata) and it
// carries the same fact.
//
// ONE pass, not two. The first version walked the corpus twice: once for
// symbols and once for `metadata.baseClass`. Both halves now read the same
// `parseFile` result, so the second walk was pure duplicated cost — and it is
// not a small cost, because it is what pushed the probe into the `parseBomb`
// range (see the SHARDING note: 8 attempts, 8 DIFFERENT files killed, so the
// kill is a concurrency artifact of the probe rather than a property of any
// file).
type Decl = { methods: Set<string>; priv: Set<string>; file: string }
const decls = new Map<string, Decl[]>()
const baseByLeaf = new Map<string, string>()
type Sub = { owner: string; file: string; methods: Set<string>; base?: string; priv: Set<string> }
const subs: Sub[] = []
const productionEdges: { file: string; from: string; to: string; conf: number; line?: number; evidenceClass?: string }[] = []
const productionFiles = new Set<string>()
let idx = 0
let symbolsTotal = 0
let skippedPass2 = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const file = `${f.repo}/${f.rel}`
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      skippedPass2++
      continue
    }
    if (r?.fallback) {
      skippedPass2++
      continue
    }
    // (a) production `overrides`, measured rather than asserted.
    for (const x of (r?.relationships ?? []) as any[]) {
      const ty = String(x?.type ?? "")
      if (ty === "overrides") {
        productionFiles.add(file)
        if (productionEdges.length < 200) {
          productionEdges.push({
            file,
            from: String(x?.source ?? ""),
            to: String(x?.target ?? ""),
            conf: typeof x?.confidence === "number" ? x.confidence : -1,
            line: x?.line_number,
            evidenceClass: (x?.metadata as any)?.evidenceClass,
          })
        }
      } else if (ty === "extends") {
        const from = String(x?.source ?? "")
        const to = String(x?.target ?? "")
        if (from && to) baseByLeaf.set(`${file}|${from}`, to)
      }
    }
    // (b) per-owner member sets, and the class/interface rows themselves.
    const byOwner = new Map<string, { methods: Set<string>; priv: Set<string> }>()
    for (const s of (r?.symbols ?? []) as any[]) {
      symbolsTotal++
      const owner = String(s?.ownerName ?? "")
      const name = String(s?.name ?? "")
      if (!owner) continue
      let m = byOwner.get(owner)
      if (!m) {
        m = { methods: new Set(), priv: new Set() }
        byOwner.set(owner, m)
      }
      if (String(s?.kind) === "method") {
        m.methods.add(name)
        if (String(s?.visibility) === "private") m.priv.add(name)
      }
      if (String(s?.kind) !== "class" && String(s?.kind) !== "interface") continue
      if (!name) continue
      let a = decls.get(owner)
      if (!a) {
        a = []
        decls.set(owner, a)
      }
      // one Decl per (class, file) so a same-file base and a cross-file base
      // with the same leaf stay distinguishable
      let d = a.find((x) => x.file === file)
      if (!d) {
        d = { methods: new Set(), priv: new Set(), file }
        a.push(d)
      }
      d.methods.add(name)
      if (String(s?.visibility) === "private") d.priv.add(name)
    }
    for (const s of (r?.symbols ?? []) as any[]) {
      const kind = String(s?.kind)
      if (kind !== "class" && kind !== "interface") continue
      const owner = String(s?.name ?? "")
      if (!owner) continue
      const m = byOwner.get(owner) ?? { methods: new Set(), priv: new Set() }
      subs.push({ owner, file, methods: m.methods, base: baseByLeaf.get(`${file}|${owner}`), priv: m.priv })
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_WORKERS ?? 8) }, () => worker()))

// ---------------------------------------------------------------- decide
let classesWithBase = 0
let baseDeclaredInFile = 0
let sameFileOpp = 0
const sameFileExamples: string[] = []
let crossFileOpp = 0
let crossFileTrue = 0
let crossFileFalse = 0
let crossFileBaseNotInCorpus = 0
let crossFileAmbiguousBase = 0
let crossFileResolvedBases = 0
let crossFileMethodsCompared = 0
let crossFileUndecidableMethods = 0
let crossFileAmbiguous = 0
let crossFilePrivateSuppressed = 0
const crossTrue: string[] = []
const crossFalse: string[] = []
let emittedCrossFile = 0
const emittedExamples: string[] = []

for (const s of subs) {
  if (!s.base) continue
  classesWithBase++
  const candidates = decls.get(s.base) ?? []
  const inFile = candidates.find((c) => c.file === s.file)
  if (inFile) {
    baseDeclaredInFile++
    for (const m of s.methods) {
      if (inFile.priv.has(m)) continue // a private base method is never inherited
      if (inFile.methods.has(m)) {
        sameFileOpp++
        if (sameFileExamples.length < 15) sameFileExamples.push(`${s.file}: ${s.owner}.${m} -> ${s.base}.${m}`)
      }
    }
    continue
  }
  // The base is not declared anywhere in the admitted corpus, so the question
  // "does the base declare this method" is UNDECIDABLE here rather than false.
  // Counted, because without it `crossFileOpportunities: 0` is uninterpretable —
  // 0 opportunities because 0 bases are resolvable and 0 opportunities because
  // 2,000 resolvable bases share no method name read identically on the page,
  // and only one of those is a finding.
  if (candidates.length === 0) {
    crossFileBaseNotInCorpus++
    for (const m of s.methods) crossFileUndecidableMethods++
    continue
  }
  if (candidates.length > 1) {
    // The name-keyed ambiguity the analyzer documents. Counted separately and
    // NEVER resolved by picking one: that would be a guess.
    crossFileAmbiguousBase++
    for (const m of s.methods) {
      if (candidates.some((c) => c.methods.has(m))) crossFileAmbiguous++
      else crossFileUndecidableMethods++
    }
    continue
  }
  const c = candidates[0]
  crossFileResolvedBases++
  for (const m of s.methods) {
    crossFileMethodsCompared++
    if (c.priv.has(m)) {
      crossFilePrivateSuppressed++
      continue
    }
    if (c.methods.has(m)) {
      crossFileOpp++
      crossFileTrue++
      if (crossTrue.length < 15) crossTrue.push(`${s.file}: ${s.owner}.${m} -> ${s.base}.${m}`)
    } else {
      // THE fabrication test. A rule that published these would invent a
      // caller — this is the class the removed 0.5 guess edge produced.
      crossFileFalse++
      if (crossFalse.length < 15) crossFalse.push(`${s.file}: ${s.owner}.${m} -> ${s.base}.${m} (base does NOT declare it)`)
    }
  }
}

// ---------------------------------------------------------------- what the analyzer
// would emit IF the companion were supplied. Same rule, companion fed in.
const companion = new Map<string, Set<string>>()
for (const [k, arr] of decls) {
  if (arr.length !== 1) continue
  companion.set(k, arr[0].methods)
}
for (const s of subs) {
  if (!s.base) continue
  const inFile = (decls.get(s.base) ?? []).find((c) => c.file === s.file)
  const baseMethods = inFile?.methods ?? companion.get(s.base)
  if (!baseMethods) continue
  for (const m of s.methods) {
    if (inFile && inFile.priv.has(m)) continue
    if (baseMethods.has(m)) {
      emittedCrossFile++
      if (emittedExamples.length < 15) emittedExamples.push(`${s.file}: ${s.owner}.${m} -> ${s.base}.${m}`)
    }
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  shard: shardInfo,
  filesScanned: files.length,
  skippedPass2,
  symbolsTotal,
  classesWithBase,
  baseDeclaredInSameFile: baseDeclaredInFile,
  sameFileOpportunities: sameFileOpp,
  sameFileExamples,
  crossFileResolvableBases: classesWithBase - baseDeclaredInFile,
  crossFileOpportunities: crossFileOpp,
  crossFileTrue: crossFileTrue,
  crossFileBaseNotInCorpus,
  crossFileAmbiguousBase,
  crossFileResolvedBases,
  crossFileMethodsCompared,
  crossFileUndecidableMethods,
  crossFileFalse: crossFileFalse,
  crossFileAmbiguousName: crossFileAmbiguous,
  crossFilePrivateBaseMethodSuppressed: crossFilePrivateSuppressed,
  crossFileTrueExamples: crossTrue,
  crossFileFalseExamples: crossFalse,
  wouldEmitWithCompanion: emittedCrossFile,
  wouldEmitExamples: emittedExamples,
  productionEmits: productionEdges.length,
  productionFiles: productionFiles.size,
  productionEdges,
}
if (process.env.BB_JSON) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(`php overrides probe — ${out.generatedAt}`)
  console.log(`shard ${SHARD}/${NSHARDS}  env-skipped ${skippedByEnv}  files scanned: ${out.filesScanned}   pass-2 skipped (parse fail/fallback): ${skippedPass2}   symbols: ${symbolsTotal}`)
  console.log(`classes with a declared base: ${out.classesWithBase}`)
  console.log(`  base declared in the SAME file: ${out.baseDeclaredInSameFile}`)
  console.log(`S same-file override opportunities (resolvable with NO index): ${sameFileOpp}`)
  for (const e of out.sameFileExamples) console.log(`    ${e}`)
  console.log(`  base NOT in the same file: ${out.crossFileResolvableBases}`)
  console.log(`C cross-file opportunities (base resolvable via a corpus companion): ${out.crossFileOpportunities}`)
  console.log(`  TRUE (base declares the method): ${out.crossFileTrue}`)
  console.log(`  FALSE (base does NOT declare it): ${out.crossFileFalse}`)
  console.log(`  base NOT declared anywhere in the corpus (UNDECIDABLE, not false): ${out.crossFileBaseNotInCorpus}`)
  console.log(`  base name-ambiguous (>=2 declaring files, never resolved): ${out.crossFileAmbiguousBase}`)
  console.log(`  base resolvable to exactly ONE file: ${out.crossFileResolvedBases}`)
  console.log(`  subclass methods compared against a resolvable base: ${out.crossFileMethodsCompared}  (undecidable, ambiguous or absent base: ${out.crossFileUndecidableMethods})`)
  console.log(`  name-ambiguous base (never resolved): ${out.crossFileAmbiguousName}`)
  console.log(`  private base method (correctly not an override): ${out.crossFilePrivateBaseMethodSuppressed}`)
  for (const e of out.crossFileFalseExamples) console.log(`    FALSE: ${e}`)
  console.log(`would emit IF overrideCompanion were supplied: ${out.wouldEmitWithCompanion}`)
  for (const e of out.wouldEmitExamples) console.log(`    ${e}`)
  console.log(`production parseFile EMITS: ${out.productionEmits} overrides edges in ${out.productionFiles} files`)
  for (const e of out.productionEdges.slice(0, 25)) console.log(`    ${e.file}:${e.line}  ${e.from} -> ${e.to}  conf=${e.conf} evidence=${e.evidenceClass}`)
}
