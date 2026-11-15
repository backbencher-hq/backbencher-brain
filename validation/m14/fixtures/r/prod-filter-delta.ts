/**
 * R LANE — WHAT PRODUCTION `parseFile` DROPS THAT `analyze()` EMITTED.
 *
 * ## Why this file exists
 *
 * The lane's firing instrument is production `parseFile`, which is right: `analyze()`
 * is a per-file unit that skips the pipeline stages, so an edge that `analyze()`
 * produces and `parseFile` deletes is an edge that is NOT in the graph. Counting
 * `analyze()` instead would report it as emitted.
 *
 * But nothing measured that delta until now, and the graph turns out to lose edges
 * to a filter in shared machinery — `filterNoiseRelationships` in
 * `src/ast/pool-worker.ts` — on a rule this lane cannot satisfy without abandoning
 * an R idiom. `pool-worker.ts:594` blocks a target whose leaf matches
 * /[{}`<>\n\r\t]/, and in R `<-` is not punctuation in a target: it is half the NAME
 * of a REPLACEMENT FUNCTION.
 *
 *     `S7_data<-` <- function(object, check = TRUE, value) ...   # S7/R/data.R:29
 *
 * S7 exports four of them and roxygen2 wrote `export("S7_data<-")` — with the quotes,
 * because the name contains `<-` — at S7/NAMESPACE:35. So the name is real, R binds
 * it, the package exports it, and the sanitizer deletes both its `contains` and its
 * `exports` edge on the way to the index.
 *
 * ## WHAT IT MEASURES
 *
 * Per file: the edge count and the SYMBOL count from `analyze()` and from `parseFile`,
 * the difference, the set of relationship (type, target) pairs the filter removed, and
 * the symbols that exist in one result and not the other. Reading it as a DIFF rather
 * than as an assurance is the point: `census.ts` reports what production emits, and a
 * number that only production can produce is exactly the number that cannot see a
 * stage downstream of it.
 *
 * NO REGEX. Pairs are compared as sets of joined strings.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/r/prod-filter-delta.ts [--sample N] [--repo NAME]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { ASTEngine } from "../../../../src/ast/engine"
import { RealRAnalyzer } from "../../../../src/ast/real-r-analyzer"
import { parseFile } from "../../../../src/ast/pool-worker"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const SAMPLE_PER_REPO = Number(argOf("--sample") ?? 250)
const REPO_FILTER = new Set(argv.reduce<string[]>((a, v, i) => (v === "--repo" ? [...a, String(argv[i + 1])] : a), []))

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))

const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  if (REPO_FILTER.size && !REPO_FILTER.has(e)) continue
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  let taken = 0
  for (const rel of tracked) {
    if (taken >= SAMPLE_PER_REPO) break
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    taken++
    files.push({ repo: e, dir, rel, abs, text })
  }
}

/** The identity of an edge for set comparison: type, source, target. */
const pair = (e: any): string => `${e.type}|${e.source}|${e.target}`

let analyzeRels = 0
let prodRels = 0
let analyzeSyms = 0
let prodSyms = 0
let filesCompared = 0
let filesWithLoss = 0
/** target -> how many times the filter removed an edge naming it */
const lostByTarget = new Map<string, number>()
const lostByType = new Map<string, number>()
/** symbol name -> true when analyze() published it and parseFile() did not */
const lostSymbols = new Map<string, number>()
/** name -> the file it was seen in, for the report */
const lostSymbolExample = new Map<string, string>()

let cursor = 0
const worker = async (): Promise<void> => {
  for (;;) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let t: any
    try { t = parser.parse(f.text) } catch { continue }
    if (!t) continue
    let a: any
    try { a = new RealRAnalyzer().analyze(t.rootNode, f.text, f.abs) } catch { t.delete?.(); continue }
    t.delete?.()
    let p: any
    try { p = await parseFile(f.abs, f.dir) } catch { continue }
    filesCompared++

    const aPairs = new Map<string, number>()
    for (const e of a.relationships ?? []) aPairs.set(pair(e), (aPairs.get(pair(e)) ?? 0) + 1)
    const pPairs = new Map<string, number>()
    for (const e of p.relationships ?? []) pPairs.set(pair(e), (pPairs.get(pair(e)) ?? 0) + 1)

    analyzeRels += (a.relationships ?? []).length
    prodRels += (p.relationships ?? []).length
    analyzeSyms += (a.symbols ?? []).length
    prodSyms += (p.symbols ?? []).length

    let lostHere = 0
    for (const [k, n] of aPairs) {
      const kept = pPairs.get(k) ?? 0
      if (n <= kept) continue
      lostHere += n - kept
      const parts = k.split("|")
      const type = parts[0]
      const target = parts.slice(2).join("|")
      lostByType.set(type, (lostByType.get(type) ?? 0) + (n - kept))
      lostByTarget.set(target, (lostByTarget.get(target) ?? 0) + (n - kept))
    }
    if (lostHere) filesWithLoss++

    const aNames = new Set((a.symbols ?? []).map((s: any) => s.name))
    const pNames = new Set((p.symbols ?? []).map((s: any) => s.name))
    for (const n of aNames) {
      if (pNames.has(n)) continue
      lostSymbols.set(n, (lostSymbols.get(n) ?? 0) + 1)
      if (!lostSymbolExample.has(n)) lostSymbolExample.set(n, label)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const top = (m: Map<string, number>, n: number): string =>
  [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ")

console.log(`R PRODUCTION-FILTER DELTA — analyze() vs production parseFile`)
console.log(`  files compared      ${filesCompared} of ${files.length} sampled`)
console.log(`  relationships       analyze() ${analyzeRels.toLocaleString()}   parseFile ${prodRels.toLocaleString()}   DELTA ${(analyzeRels - prodRels).toLocaleString()}`)
console.log(`  symbols             analyze() ${analyzeSyms.toLocaleString()}   parseFile ${prodSyms.toLocaleString()}   DELTA ${(analyzeSyms - prodSyms).toLocaleString()}`)
console.log(`  files that lost at least one edge   ${filesWithLoss}`)
console.log("")
console.log(`  EDGES REMOVED, by type:`)
for (const [k, v] of [...lostByType.entries()].sort((x, y) => y[1] - x[1])) console.log(`    ${k.padEnd(14)} ${v}`)
console.log("")
console.log(`  EDGES REMOVED, top targets (the name is what the filter refused):`)
console.log(`    ${top(lostByTarget, 25) || "(none)"}`)
console.log("")
console.log(`  SYMBOLS analyze() PUBLISHED AND parseFile() DID NOT: ${lostSymbols.size} distinct names`)
console.log(`    ${top(lostSymbols, 25) || "(none)"}`)
for (const [n, f] of [...lostSymbolExample.entries()].slice(0, 12)) console.log(`      ${n.padEnd(28)} first seen ${f}`)
process.exit(0)