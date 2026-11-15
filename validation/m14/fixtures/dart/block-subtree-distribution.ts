/**
 * HOW BIG IS A `block` SUBTREE ON REAL DART? — choosing a bound from evidence
 *
 * ## Why this has to be measured before anything is bounded
 *
 * `collectDartLocals` is called once per `function_body` / `function_expression_body` /
 * `block` node (real-dart-analyzer.ts:1858) and walks that node's entire subtree. The
 * attribution run put 95% of the deep-nesting cost inside it, and the quadratic comes from
 * the call COUNT rather than the loop: n nested blocks give subtree sizes O(n-d) each.
 *
 * Any fix that bounds the walk needs a number, and the number must come from the corpus
 * rather than from taste. A bound set below the corpus maximum silently changes results on
 * real files; a bound set far above it is not a bound at all. So this measures the
 * distribution of block-subtree sizes and the per-file block count on real Dart, and the
 * fix's constant is then read off the measurement.
 *
 * ## What a fix must preserve
 *
 * Whatever the bound is, it has to be a NO-OP on every file the analyzer currently
 * finishes — otherwise it trades a hang for wrong edges, and a wrong edge is the most
 * expensive thing this project can emit. So the numbers this prints are the acceptance
 * criterion for the fix, not a diagnostic: the chosen bound must exceed the measured
 * maximum, and a 600-file per-type census diff must come back empty.
 *
 * ## Population
 *
 * A deterministic stride over the corpus, not a random sample: stride keeps the repos in
 * the same proportion as a whole-corpus walk without the cost of one, and it is
 * reproducible without a seed.
 *
 * Run: npx tsx validation/m14/fixtures/dart/block-subtree-distribution.ts [files]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WANT = Number(process.argv[2] ?? 1200)

const { detectLanguageFromPath } = await import("../../../../src/ast/language-detection")

// ---- deterministic population: every admitted dart path, then a fixed stride
const all: string[] = []
for (const e of execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n").filter(Boolean)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "dart") continue
    all.push(abs)
  }
}

const stride = Math.max(1, Math.floor(all.length / WANT))
const sample = all.filter((_, i) => i % stride === 0).slice(0, WANT)

const wts: any = await import("web-tree-sitter")
await wts.Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

/**
 * One pass per file, recording the subtree node count under every block-like node.
 *
 * Computed bottom-up from a single traversal rather than by re-walking each block: the
 * point of this probe is to SIZE the walk, and sizing it by performing it would make the
 * probe as slow as the defect.
 */
const TRIGGERS = new Set(["block", "function_body", "function_expression_body"])

const sizes: number[] = []
let parsed = 0, parseFailed = 0, totalBlocks = 0, worstFile = "", worstSize = 0
const perFileBlocks: number[] = []

for (const f of sample) {
  const tree = parser.parse(readFileSync(f, "utf8"))
  if (!tree) { parseFailed++; continue }
  parsed++
  const root = tree.rootNode
  // Iterative post-order, accumulated by node ID.
  //
  // Keyed by `id`, NOT by the node object. web-tree-sitter materialises a NEW wrapper
  // object on every `namedChild(i)` call, so an object-keyed Map never finds a child and
  // every subtree collapses to 1 — which is exactly what the first version of this probe
  // printed: p50=p99=max=1 over 43,347 trigger nodes on real files. A distribution whose
  // maximum is 1 when the file has 6,501 blocks is a broken instrument, and it looked
  // plausible enough to nearly be believed.
  const size = new Map<number, number>()
  const stack: { n: any; seen: boolean }[] = [{ n: root, seen: false }]
  let blocks = 0
  while (stack.length) {
    const { n, seen } = stack.pop()!
    if (!seen) {
      stack.push({ n, seen: true })
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ n: c, seen: false })
      }
      continue
    }
    let s = 1
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) s += size.get(c.id) ?? 0
    }
    size.set(n.id, s)
    if (TRIGGERS.has(n.type)) {
      blocks++
      sizes.push(s)
      if (s > worstSize) { worstSize = s; worstFile = f }
    }
  }
  totalBlocks += blocks
  perFileBlocks.push(blocks)
  tree.delete?.()
}

sizes.sort((a, b) => a - b)
const pct = (p: number) => sizes[Math.min(sizes.length - 1, Math.floor((p / 100) * sizes.length))] ?? 0

console.log(`block-subtree distribution — production census sizes over REAL dart`)
console.log(`population: ${sample.length} files by stride ${stride} of ${all.length} admitted; ${parsed} parsed, ${parseFailed} failed`)
console.log(`trigger nodes: function_body, function_expression_body, block  (real-dart-analyzer.ts:1858)`)
console.log(`observed trigger nodes: ${totalBlocks} across ${parsed} files\n`)

console.log(`  ${"p50".padStart(7)}  ${"p90".padStart(7)}  ${"p99".padStart(7)}  ${"p99.9".padStart(7)}  ${"max".padStart(8)}`)
console.log(`  ${String(pct(50)).padStart(7)}  ${String(pct(90)).padStart(7)}  ${String(pct(99)).padStart(7)}  ${String(pct(99.9)).padStart(7)}  ${String(worstSize).padStart(8)}`)

const over = (k: number) => sizes.filter((s) => s > k).length
console.log(`\n  how many trigger subtrees exceed a candidate bound:`)
for (const k of [1_000, 5_000, 10_000, 20_000, 50_000, 100_000]) {
  console.log(`    > ${String(k).padStart(7)} : ${String(over(k)).padStart(6)} of ${sizes.length}  (${((100 * over(k)) / Math.max(sizes.length, 1)).toFixed(4)}%)`)
}

perFileBlocks.sort((a, b) => a - b)
const bmax = perFileBlocks[perFileBlocks.length - 1] ?? 0
console.log(`\n  blocks per file: p50=${perFileBlocks[Math.floor(perFileBlocks.length / 2)]}  max=${bmax}`)
console.log(`  largest trigger subtree in this population:`)
console.log(`    ${worstSize} nodes — ${worstFile.replace(`${CR}/`, "")}`)

console.log(`
CHOOSING THE BOUND FROM THIS TABLE
  A bound must exceed the corpus maximum to be a no-op on real files, and must sit far
  below the cost of walking it to bound the pathological case. The deep-nesting fixture
  needs ~4n nodes per block, so n=1000 is ~4,000 and n=10,000 is ~40,000 per block.

  The corpus maximum above, against the trigger-subtree counts, decides which side of that
  gap any candidate lands on. If the corpus has trigger subtrees in the tens of thousands
  then a bound there is NOT a no-op and the 600-file census diff will show it.`)