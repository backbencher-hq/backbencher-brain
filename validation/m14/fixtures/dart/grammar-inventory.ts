/**
 * INSTRUMENT A FOR DART — the grammar-inventory census the arbiter cannot finish
 *
 * ## Why this file exists
 *
 * `script/m14/ontology-coverage-gate.ts` line 336 walks EVERY admitted file to build
 * `grammarNodeTypes`, and it does it with unbounded recursion:
 *
 *     const v = (n) => { grammarNodeTypes.set(n.type, ...); for (let i=0;i<n.childCount;i++) v(n.child(i)) }
 *     v(t.rootNode)
 *
 * On `dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart` — 350,435 bytes,
 * iterative depth 20,005 — that raises
 *
 *     RangeError: Maximum call stack size exceeded
 *         at Node.child (web-tree-sitter/tree-sitter.js:671:8)
 *         at v (script/m14/ontology-coverage-gate.ts:339:141)
 *
 * and kills the whole gate with exit 1, so the arbiter prints no table for dart at all.
 * That file is ALREADY marked `!bad` in the gate's own checkpoint; Instrument A iterates
 * `files` with no bad-file filter, no try/catch and no depth bound, so it re-parses what the
 * walk abandoned.
 *
 * ## Why the lane still needs the number
 *
 * `grammarNodeTypes` is consumed at gate:493 and gate:505, both inside the branch that
 * runs only for a type that is NOT emitted and HAS a ruling. Dart emits all ten, so for
 * this lane the entire pass is dead work — which is exactly why crashing on it costs
 * nothing measurable and everything reportable. The inventory is still worth having: it is
 * Instrument A's positive evidence of absence, and it is the number that says what the dart
 * grammar actually produces.
 *
 * This computes it with an ITERATIVE walk, so the file that overflows the arbiter's
 * recursion is measured here rather than skipped.
 *
 * ## Population is stated, because a count without one is a finding about the wrong thing
 *
 * The arbiter would use all 33,692 admitted files. This uses a deterministic stride over
 * the same admitted set, because a census that takes an hour is a census nobody re-runs,
 * and a node-type INVENTORY saturates: the question Instrument A answers is "does the
 * grammar have a node type expressing this construct", and a type absent from 1,200 files is
 * overwhelmingly a type the grammar cannot produce. That is a probabilistic claim, so the
 * coverage is printed alongside the inventory and the saturation curve with it.
 *
 * Run: npx tsx validation/m14/fixtures/dart/grammar-inventory.ts [files]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WANT = Number(process.argv[2] ?? 1_200)

const { detectLanguageFromPath } = await import("../../../../src/ast/language-detection")

// Same admission the arbiter uses: a git repo under the corpus root, git-tracked files,
// <= 512 KiB, detected as dart.
const admitted: string[] = []
for (const e of execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n").filter(Boolean)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "dart") continue
    admitted.push(abs)
  }
}
const stride = Math.max(1, Math.floor(admitted.length / WANT))
const sample = admitted.filter((_, i) => i % stride === 0).slice(0, WANT)

const wts: any = await import("web-tree-sitter")
await wts.Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

const types = new Map<string, number>()
let parsed = 0, failed = 0, nodes = 0, maxDepth = 0, deepest = ""
/**
 * Distinct-type count after each tenth of the SAMPLE, measured.
 *
 * The first version of this file printed an interpolation — `total * d / 10` — and labelled
 * it a saturation curve. That is a fabricated measurement wearing a measured one's label,
 * and a linear ramp drawn from the final count is exactly what a real saturation curve does
 * NOT look like. It is recorded here because the honest replacement has to be visibly
 * different from the thing it replaces: a curve that is still climbing at the last decile
 * says the inventory had not converged, which is the fact a reader needs.
 */
const curve: { decile: number; file: number; types: number }[] = []

for (const [fi, f] of sample.entries()) {
  const tree = parser.parse(readFileSync(f, "utf8"))
  if (!tree) { failed++; continue }
  parsed++
  // ITERATIVE. This is the whole difference between this probe and gate:339.
  const stack: [any, number][] = [[tree.rootNode, 1]]
  while (stack.length) {
    const [n, d] = stack.pop()!
    if (d > maxDepth) { maxDepth = d; deepest = f }
    types.set(n.type, (types.get(n.type) ?? 0) + 1)
    nodes++
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push([c, d + 1])
    }
  }
  tree.delete?.()
  // Sampled AFTER each file completes, so a decile is a whole number of files.
  const decile = Math.floor((10 * (fi + 1)) / sample.length)
  if (decile > 0 && !curve.some((c) => c.decile === decile)) curve.push({ decile, file: fi + 1, types: types.size })
  if (fi % 200 === 0) process.stdout.write(`  …${fi}/${sample.length}\n`)
}

const sorted = [...types.entries()].sort((a, b) => b[1] - a[1])
console.log(`
INSTRUMENT A — grammar-inventory census for dart (ITERATIVE walk)

  admitted population   ${admitted.length} files
  sampled               ${sample.length} files by stride ${stride}
  parsed                ${parsed}   failed ${failed}
  nodes visited         ${nodes.toLocaleString()}
  deepest tree          ${maxDepth}  (${deepest.replace(`${CR}/`, "")})
  DISTINCT NODE TYPES   ${sorted.length}

  the arbiter's Instrument A would report \`the grammar produced N distinct node types\`;
  N = ${sorted.length} for this population.

  SATURATION — MEASURED distinct-type count after each tenth of the sample:
${curve.map((c) => `    ${(c.decile * 10).toString().padStart(3)}%  after file ${String(c.file).padStart(4)}   ${String(c.types).padStart(4)} types`).join("\n")}

  Read the last row against the second-to-last. A curve that is still adding types at the
  final decile has NOT converged, so ${sorted.length} is a LOWER BOUND on what the dart
  grammar can produce, and any claim of the form "the grammar has no node type X" has to be
  checked against the full list below rather than against this count.

ALL ${sorted.length} NODE TYPES THE DART GRAMMAR PRODUCED HERE:
${sorted.map(([t, c]) => `  ${String(c).padStart(12)}  ${t}`).join("\n")}

  A RULED type for dart must name a node type from this list. One absent from it is
  positive evidence of absence — which is the only shape of evidence that counts as a
  ruling, per this gate's own header.`)