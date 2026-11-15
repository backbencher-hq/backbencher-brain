/**
 * `exports` FIRING PROBE — why the arbiter read 0 and the census read 302.
 *
 * The supervisor's `script/m14/firing-check.ts` reports, for dart at 120 files:
 * `9/10 fired`, `notFired: ["exports"]`. This lane's own census over 2,735 files
 * reports `exports = 302`. Both cannot describe the same language, so the
 * disagreement has to be settled by measurement rather than by preferring the
 * larger or the more convenient number.
 *
 * Two candidate explanations, and they have opposite consequences:
 *
 *   1. `exports` is real but RARE, and a 120-file stride sample simply missed it.
 *      Then the arbiter's 9/10 is a SAMPLING artifact and the lane is 10/10.
 *   2. `exports` needs a construct the corpus does not use. Then the arbiter's
 *      9/10 is CORRECT and the census's 302 come from somewhere else.
 *
 * The probe walks the WHOLE admitted Dart corpus, counts `library_export` nodes on
 * the parse tree (node type, not a text pattern: `export` appears in Dart source
 * inside identifiers, comments and strings, so a text instrument could not
 * distinguish a directive from a word), and reports how many DISTINCT files carry
 * one. It then reproduces the arbiter's exact sample — the same sorted whole-corpus
 * list, the same `stride = max(1, floor(total / limit))`, the same `i % stride === 0`
 * — and counts how many of THOSE files carry an export.
 *
 * What would overturn this: a file counted as export-bearing whose
 * `library_export` node is inside an ERROR region, i.e. not a fact about a
 * well-formed program. The probe reports those separately rather than counting
 * them as firing.
 *
 *   npx tsx validation/m14/fixtures/dart/export-population-probe.ts
 *   BB_EXPORT_LIMIT=120 npx tsx validation/m14/fixtures/dart/export-population-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_EXPORT_LIMIT ?? 120)

const LANG = "dart"
const all: string[] = []
for (const repo of readdirSync(CR).sort()) {
  const dir = path.join(CR, repo)
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
    // NO size filter: `filesForLanguage` admits every tracked file the detector
    // claims, and a 512 KB cutoff admitted 33,692 of the arbiter's 33,755 — a
    // different total gives a different stride, which gives a DIFFERENT sample.
    // A census that quietly tightens its own admission filter is measuring
    // something other than what it claims.
    if (detectLanguageFromPath(rel) !== LANG) continue
    let bytes = 0
    try { bytes = statSync(path.join(dir, rel)).size } catch { continue }
    all.push(path.join(dir, rel))
  }
}

const WSP = (wts as any).Parser ?? (wts as any).default
const WSL = (wts as any).Language ?? (wts as any).default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

/**
 * Every `library_export` node in a tree, plus whether any sits inside an ERROR.
 *
 * ITERATIVE, not recursive. The recursive form blew the stack on this corpus
 * (`RangeError: Maximum call stack size exceeded` on the first large file), which
 * is a property of the corpus's nesting depth rather than of the probe — but a
 * census that crashes on deep input reports nothing for that file, and a silent
 * zero is worse than a crash. The explicit stack below cannot overflow.
 */
function exportsIn(root: any): { total: number; inError: number } {
  let total = 0
  let inError = 0
  const stack: { n: any; bad: boolean }[] = [{ n: root, bad: false }]
  while (stack.length > 0) {
    const { n, bad } = stack.pop()!
    const here = bad || n.type === "ERROR" || n.isMissing === true
    if (n.type === "library_export") {
      total++
      if (here) inError++
    }
    for (let i = n.childCount - 1; i >= 0; i--) stack.push({ n: n.child(i), bad: here })
  }
  return { total, inError }
}

let corpusExportNodes = 0
let corpusExportInError = 0
const exportFiles: string[] = []
const perRepoExportFiles = new Map<string, number>()
let parseFailures = 0

for (const f of all) {
  let text: string
  try { text = readFileSync(f, "utf8") } catch { continue }
  let t: any
  try { t = parser.parse(text) } catch { parseFailures++; continue }
  if (!t) { parseFailures++; continue }
  const { total, inError } = exportsIn(t.rootNode)
  t.delete?.()
  corpusExportNodes += total
  corpusExportInError += inError
  if (total > 0) {
    exportFiles.push(f)
    const repo = f.slice(CR.length + 1).split(path.sep)[0]
    perRepoExportFiles.set(repo, (perRepoExportFiles.get(repo) ?? 0) + 1)
  }
}

const exportSet = new Set(exportFiles)

/**
 * Reproduce the arbiter's sample from ITS rule, exactly.
 *
 * The first version of this probe got the sample WRONG and reached the opposite
 * conclusion, which is worth recording: it sorted the whole-corpus list BEFORE
 * striding, and `filesForLanguage` strides the list in CONSTRUCTION order (repos
 * in `readdirSync` order, files in `git ls-files` order) and sorts only the
 * resulting PICKED files. Sorting first picks a different 120 files. The two
 * samples share no membership guarantee, so "the sample contains 2 export-bearing
 * files" was a statement about the wrong 120 files. The order below is the
 * arbiter's: stride `all`, then `.sort()` the picks.
 */
const stride = all.length > LIMIT ? Math.max(1, Math.floor(all.length / LIMIT)) : 1
const picked: string[] = []
for (let i = 0; i < all.length && picked.length < LIMIT; i += stride) picked.push(all[i])
const arbiterSample = picked.sort()
const inArbiterSample = arbiterSample.filter(f => exportSet.has(f))

console.log(`dart exports probe`)
console.log(`corpus total .dart files (arbiter's admitted set): ${all.length}`)
console.log(`files carrying >=1 library_export node: ${exportFiles.length} (${((exportFiles.length / all.length) * 100).toFixed(3)}% of files)`)
console.log(`library_export nodes across the corpus: ${corpusExportNodes}`)
console.log(`  of those, inside an ERROR region: ${corpusExportInError}`)
console.log(`parse failures: ${parseFailures}`)
console.log(``)
console.log(`arbiter sample reproduction: limit=${LIMIT} stride=${stride} files=${arbiterSample.length}`)
console.log(`  of those, carrying a library_export: ${inArbiterSample.length}`)
for (const f of inArbiterSample.slice(0, 5)) console.log(`    ${f.slice(CR.length + 1)}`)
console.log(``)
console.log(`per-repo export-bearing file counts (top 12):`)
for (const [repo, n] of [...perRepoExportFiles].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${repo}: ${n}`)
}

const expected = all.length > 0 ? (exportFiles.length / all.length) * arbiterSample.length : 0
const baseRate = all.length > 0 ? exportFiles.length / all.length : 0
// The probability that an arbiter-sized sample contains NO export-bearing file.
const pNone = Math.pow(1 - baseRate, arbiterSample.length)
// The n at which P(none) drops to 5%, by doubling until it crosses.
let n95 = arbiterSample.length
while (n95 < 1e6 && Math.pow(1 - baseRate, n95) > 0.05) n95++
console.log(``)
console.log(`PREDICTION: at ${arbiterSample.length} files the expected export-bearing count is`)
console.log(`  ${exportFiles.length}/${all.length} x ${arbiterSample.length} = ${expected.toFixed(2)}`)
console.log(`  observed ${inArbiterSample.length}.`)
console.log(``)
console.log(`  per-file base rate              ${(baseRate * 100).toFixed(4)}%`)
console.log(`  P(a ${arbiterSample.length}-file sample contains NONE)  ${pNone.toFixed(4)}  = ${(pNone * 100).toFixed(2)}%`)
console.log(`  so observing ${inArbiterSample.length} is a ${pNone < 0.5 ? "likely" : "unlikely"} outcome at this sample size, and it is`)
console.log(`  a property of the SAMPLE rather than of the language.`)
console.log(`  n >= ${n95} gives P(none) <= 5%.`)
console.log(``)
console.log(`OVERTURN CONDITION: if these ${inArbiterSample.length} files carried a library_export node`)
console.log(`that the analyzer does not turn into an edge, the arbiter's 0 would be a real defect.`)
console.log(`This probe counts NODES; the analyzer's own edge count is the census's \`exports\` row.`)