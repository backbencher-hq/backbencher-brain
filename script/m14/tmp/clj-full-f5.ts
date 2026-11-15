// CLJ-DEEP · INSTRUMENT 6 — the FULL-EXTENT differential, shardable.
//
// WHY. `differential.ts --sample 100000` reads a whole corpus in ONE wasm
// module, and on metabase (4,122 files) the W11 heap degrades: the lane
// reported `0/4122 fresh (rot 6)` and never finished. The go lane's round 3
// answered the same problem by chunking; this is that, for clojure.
//
// It reuses the harness's OWN oracle (`deriveClojureEdges`) and its OWN
// `normTarget`, and it re-implements the harness's comparison semantics
// verbatim — site-agnostic label+target matching, per-file collapse to one edge
// per (label, target), the compared-label allowlist for the clojure lane — so
// the number it prints is the same claim `differential.ts` makes, just over
// every file instead of 60. Shardable, so each child holds ~500 files.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"

// The labels the clojure lane compares (the harness's allowlist at its
// `filter(...includes(r.label))`): extends, implements, instantiates, overrides
// (every language except csharp/dart/swift/cpp), calls (clojure is in the
// calls set), references (clojure is in the references set). `uses` and
// `contains` are NOT compared for this lane — there is no independent truth
// derivation for them, and auditing a label the truth side does not derive
// manufactures a red (the #910 lesson).
/** Whole-corpus file counts, measured against a corpus at rest. A pin, not a guess. */
const CORPUS_FILE_FLOOR: Record<string, number> = {
  clojure: 143, "clj-kondo": 444, "core.async": 46, metabase: 4253,
}

const COMPARED = new Set(["extends", "implements", "instantiates", "overrides", "calls", "references"])

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try { tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { tracked = [] }
  if (tracked.length === 0) return []
  return tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f)).map(f => path.join(dir, f)).sort()
}

async function main() {
  const argOf = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }
  const repo = argOf("--repo") ?? "clojure"
  const shard = parseInt(argOf("--shard") ?? "0")
  const nshards = parseInt(argOf("--nshards") ?? "1")
  const outPath = argOf("--out")

  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const truthMod: any = await import(path.join(ROOT, "script/m14/clojure-truth.ts"))
  const analyzer = new mod.RealClojureAnalyzer()
  const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))
  const deriveClojureEdgesLegacy = diff.deriveClojureEdges as (r: any) => { label: string; from: string; target: string }[]
  // `calls` is DERIVED here, in the harness, rather than by patching
  // `differential.ts` to delegate. That file is contended - three lanes edit it and
  // a commit in another lane reverted the delegation twice, silently turning every
  // measurement back into a measurement of the legacy oracle while the harness
  // reported numbers that looked fine. A truth oracle belongs in a file its owner
  // keeps; one that a co-agent's commit can revert is not a gate, it is a report.
  const deriveCalls = truthMod.deriveClojureCallsTruth as (
    r: any, isCore: (h: string) => boolean, coreNames: string[]) => { label: string; from: string; target: string }[]
  const CORE: Record<string, unknown> = mod.CLOJURE_CORE_BUILTINS
  const coreNames = Object.keys(CORE)
  const isCore = (h: string) => Boolean(CORE[h])
  const deriveClojureEdges = (root: any) => {
    const rest = deriveClojureEdgesLegacy(root).filter((e) => e.label !== "calls")
    return rest.concat(deriveCalls(root, isCore, coreNames))
  }
  const normTarget = diff.normTarget as (t: string) => string

  const all = listFiles(repo)
  const files = all.filter((_, i) => i % nshards === shard)

  let filesRead = 0, filesWithErrorNodes = 0
  let truthTotal = 0, covered = 0, missing = 0
  let analyzerTotal = 0, unexplained = 0, heuristic = 0
  const missingSamples: string[] = []
  const unexplainedSamples: string[] = []

  for (const file of files) {
    let content: string
    try { content = readFileSync(file, "utf8") } catch { continue }
    if (content.length > 1_500_000) continue
    let root: any
    try { root = parser.parse(content).rootNode } catch { continue }
    filesRead++
    if (root.hasError) filesWithErrorNodes++
    let res: any
    try { res = analyzer.analyze(root, content, file) } catch { continue }

    // The truth side, exactly as the harness builds it.
    const truth = deriveClojureEdges(root)
      .map(e => ({ label: e.label, target: e.target }))
      .filter(e => COMPARED.has(e.label))
    // The analyzer side, the same collapse the harness applies: one edge per
    // (label, target) per file, because the truth oracles are unique per
    // (label, target) while the analyzer emits one per search hit.
    const seenA = new Set<string>()
    const rels: { label: string; target: string; confidence: number }[] = []
    for (const r of (res.relationships ?? []) as any[]) {
      const label = String(r.type)
      if (!COMPARED.has(label)) continue
      const k = `${label}|${r.target}`
      if (seenA.has(k)) continue
      seenA.add(k)
      rels.push({ label, target: String(r.target), confidence: typeof r.confidence === "number" ? r.confidence : 1 })
    }
    truthTotal += truth.length
    analyzerTotal += rels.length
    for (const te of truth) {
      if (rels.some(r => r.label === te.label && normTarget(r.target) === normTarget(te.target))) covered++
      else { missing++; if (missingSamples.length < 60) missingSamples.push(`${path.relative(CORPUS_ROOT, file)} :: ${te.label} -> ${te.target}`) }
    }
    for (const r of rels) {
      if (truth.some(te => te.label === r.label && (normTarget(r.target) === normTarget(te.target) || te.target.includes(normTarget(r.target))))) continue
      if (r.confidence < 0.7) { heuristic++; if (unexplainedSamples.length < 40) unexplainedSamples.push(`HEURISTIC ${path.relative(CORPUS_ROOT, file)} :: ${r.label} -> ${r.target}`) }
      else { unexplained++; if (unexplainedSamples.length < 40) unexplainedSamples.push(`UNEXPLAINED ${path.relative(CORPUS_ROOT, file)} :: ${r.label} -> ${r.target}`) }
    }
  }

  const res = {
    repo, shard, nshards, filesInShard: files.length, filesRead, filesWithErrorNodes,
    truthTotal, covered, missing, analyzerTotal, unexplained, heuristic,
    missingSamples, unexplainedSamples,
  }
  if (outPath) writeFileSync(outPath, JSON.stringify(res, null, 1))
  // A CORPUS FILE FLOOR, because "covered 100.00%" over ZERO files is a pass.
  //
  // This corpus is shared and another lane keeps moving it mid-run: `git ls-files`
  // inside the corpus repo returned 59 and 63 tracked .clj files on four separate
  // occasions, the run read 0 of them, and every number came out perfect —
  // 0 missing, 0 unexplained, 100.00% coverage, `heuristic=0`. A percentage over
  // an empty denominator is not a weak result, it is an ABSENT result wearing a
  // green one, and it is indistinguishable from success in a log.
  //
  // The floor is the file count measured against a whole corpus, so it is a pin
  // rather than a guess. Override with BB_MIN_FILES for a sharded or partial run,
  // where the caller knows what it asked for.
  const floor = Number(process.env.BB_MIN_FILES ?? CORPUS_FILE_FLOOR[repo] ?? 1)
  const truncated = filesRead < floor
  if (truncated) {
    console.error(`\nCORPUS TRUNCATED: read ${filesRead} of ${files.length} listed file(s) for ${repo}, floor is ${floor}.`)
    console.error(`  Every count below is computed over ${filesRead} file(s) and means nothing. This is NOT a pass.`)
    console.error(`  The corpus repo is shared; another lane may be mid-checkout. Re-run when \`git -C <corpus> ls-files\` is whole.`)
  }
  console.log(`${repo} shard ${shard}/${nshards}: files=${filesRead}/${files.length} truth=${truthTotal} covered=${covered} MISSING=${missing} analyzer=${analyzerTotal} unexplained=${unexplained} heuristic=${heuristic} filesWithErrorNodes=${filesWithErrorNodes}${truncated ? "  *** CORPUS TRUNCATED — NOT A PASS ***" : ""}`)
  if (truncated) process.exitCode = 3
}

main().catch((e) => { console.error(e); process.exit(1) })
