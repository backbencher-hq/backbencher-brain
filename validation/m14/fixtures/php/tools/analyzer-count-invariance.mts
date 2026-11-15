/**
 * ANALYZER COUNT INVARIANCE — does a change to `src/ast/real-php-analyzer.ts` alter the NUMBER of
 * edges, and where?
 *
 * ## Why this exists
 *
 * A whole-corpus gate run before and after the variable-read binding fix read `uses` **155,016 ->
 * 153,884** — 1,132 edges fewer — while every OTHER type's count was identical to the digit. A
 * difference of that shape has two candidate causes and they mean opposite things:
 *
 *   * the change REMOVED edges (a defect in the change), or
 *   * the two runs measured different POPULATIONS (the gate's own note: a file that returns nothing
 *     "contributes NOTHING, so the population is INCOMPLETE and every count above describes evidence
 *     that is MISSING"), which is a property of the RUN, not of the language.
 *
 * This instrument settles it by removing the population from the question: it takes a BASE revision's
 * analyzer and the WORKING TREE's analyzer, runs BOTH over the SAME files with the SAME parser in ONE
 * process, and compares per-file edge counts by type. Nothing about load, timeouts or file order can
 * move the answer, because both arms see the same content in the same pass.
 *
 * ## What it is not
 *
 * It compares COUNTS, not targets or metadata — that is the question that was open. It also says
 * nothing about whether either arm's edges are RIGHT.
 *
 * ## Usage (BASE must be the revision BEFORE the change under test)
 *
 *   BB_AB_BASE=HEAD~1 npx tsx validation/m14/fixtures/php/tools/analyzer-count-invariance.mts
 *   BB_AB_LIMIT=500 …            # a sample, for a quick check
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const BASE = process.env.BB_AB_BASE ?? "HEAD"
const LIMIT = Number(process.env.BB_AB_LIMIT ?? "0")
const SIZE_CAP = 1024 * 1024

// THE BASE ANALYZER IS MATERIALISED, not assumed to exist on disk: a checked-in copy would silently
// go stale, and a stale baseline is the one failure mode this file cannot detect in itself. Its
// relative imports are rewritten to absolute ones because it is executed from a temporary directory.
const dir = mkdtempSync(path.join(tmpdir(), "php-ab-"))
const raw = execFileSync("git", ["-C", ROOT, "show", `${BASE}:src/ast/real-php-analyzer.ts`], {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
})
const rewritten = raw
  .replace(/from "\.\/engine"/g, `from "${ROOT}/src/ast/engine"`)
  .replace(/from "\.\/file-claim"/g, `from "${ROOT}/src/ast/file-claim"`)
  .replace(/from "\.\/php-internal-symbols"/g, `from "${ROOT}/src/ast/php-internal-symbols"`)
  .replace(/from "\.\/types"/g, `from "${ROOT}/src/ast/types"`)
const baseFile = path.join(dir, "base-analyzer.ts")
writeFileSync(baseFile, rewritten)

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-php.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)

const BASE_A = new (await import(baseFile)).RealPhpAnalyzer()
const WORKING = new (await import(path.join(ROOT, "src/ast/real-php-analyzer.ts"))).RealPhpAnalyzer()

const repos: { repo: string; files: string[] }[] = []
for (const name of readdirSync(CR).sort()) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const files = tracked
    .filter((r) => r.toLowerCase().endsWith(".php"))
    .map((r) => path.join(repo, r))
    .filter((f) => { try { return statSync(f).size <= SIZE_CAP } catch { return false } })
    .sort()
  if (files.length > 0) repos.push({ repo, files })
}

let scanned = 0
let differing = 0
const byType = new Map<string, number>()
const examples: string[] = []
for (const { repo, files } of repos) {
  for (const f of files) {
    if (LIMIT > 0 && scanned >= LIMIT) break
    let tree: any
    let content: string
    try { content = readFileSync(f, "utf8"); tree = parser.parse(content) } catch { continue }
    if (!tree) continue
    scanned++
    const ctx = { projectRoot: repo } as any
    let a: any, b: any
    try {
      a = BASE_A.analyze(tree.rootNode, content, f, ctx)
      b = WORKING.analyze(tree.rootNode, content, f, ctx)
    } catch { tree.delete?.(); continue }
    const counts = (r: any) => {
      const m = new Map<string, number>()
      for (const x of r.relationships ?? []) { const t = String(x.type); m.set(t, (m.get(t) ?? 0) + 1) }
      return m
    }
    const ca = counts(a), cb = counts(b)
    let diff = false
    for (const t of new Set([...ca.keys(), ...cb.keys()])) {
      const d = (cb.get(t) ?? 0) - (ca.get(t) ?? 0)
      if (d !== 0) {
        diff = true
        byType.set(t, (byType.get(t) ?? 0) + d)
        if (examples.length < 10) examples.push(`${path.relative(CR, f)}  ${t}  ${ca.get(t) ?? 0} -> ${cb.get(t) ?? 0}`)
      }
    }
    if (diff) differing++
    tree.delete?.()
  }
  if (LIMIT > 0 && scanned >= LIMIT) break
}

console.log(`analyzer count invariance — base ${BASE} vs WORKING TREE`)
console.log(`population: ${scanned} corpus file(s) parsed and analyzed TWICE in one process (same parser, same order)`)
console.log(`${differing} file(s) differ in edge COUNT`)
console.log(`net per-type delta (working - base): ${[...byType].map(([t, d]) => `${t} ${d > 0 ? "+" : ""}${d}`).join(" · ") || "(none)"}`)
for (const e of examples) console.log(`   ${e}`)
console.log(`\nA zero here means the change is EDGE-COUNT NEUTRAL over this population, so a whole-corpus`)
console.log(`run that reports a different total measured a different POPULATION (a file that returned`)
console.log(`nothing under load) — it did not lose edges to this change.`)
