/**
 * WHAT IS THE REMAINING COST OF NESTING? — dart lane.
 *
 * The recursive walk in `real-dart-analyzer.ts` was replaced with an explicit stack because
 * it threw `RangeError: Maximum call stack size exceeded` on
 * `deep_nesting_statement_test.dart` (tree depth **20,004**). The crash is gone, but the
 * file now takes **455,824 ms** — still far past the engine's 120 s analyzer budget, so the
 * file would remain degraded (by timeout rather than by crash) and any genuinely
 * deep-nested real file would be unusable.
 *
 * One measurement, one question: how does `analyze()` cost scale with tree depth? Truncated
 * slices of the SAME file give a scaling series without inventing input — the slices are
 * syntactically incomplete, and that is fine: this measures the traversal, and the tree
 * depth of each slice is printed so the series is read against a measured depth rather than
 * against a line count.
 *
 * Run: npx tsx validation/m14/fixtures/dart/deep-nesting-scaling.ts /tmp/deep-*.dart
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: deep-nesting-scaling.ts <file.dart> [file.dart ...]")
  process.exit(2)
}

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm"))))
const amod: any = await import("../../../../src/ast/real-dart-analyzer")

interface Row { file: string; lines: number; bytes: number; depth: number; nodes: number; ms: number }
const rows: Row[] = []

for (const file of files) {
  const content = fs.readFileSync(file, "utf8")
  const tree = parser.parse(content)
  const root = tree.rootNode
  let depth = 0
  let nodes = 0
  const stack: Array<[any, number]> = [[root, 0]]
  while (stack.length) {
    const [n, d] = stack.pop()!
    nodes++
    if (d > depth) depth = d
    for (let i = 0; i < n.childCount; i++) stack.push([n.child(i), d + 1])
  }
  const analyzer = new amod.RealDartAnalyzer()
  const t0 = Date.now()
  let ok = true
  try {
    analyzer.analyze(root, content, path.basename(file), undefined)
  } catch (e: any) {
    ok = false
    console.log(`  (threw: ${String(e?.message).slice(0, 80)})`)
  }
  rows.push({ file: path.basename(file), lines: content.split("\n").length, bytes: content.length, depth, nodes, ms: Date.now() - t0 })
  console.log(`${path.basename(file)}: depth ${depth}, nodes ${nodes}, bytes ${content.length} -> ${ok ? "" : "THREW, "}${Date.now() - t0} ms`)
  tree.delete?.()
}

// Normalise against the shallowest row, so "is this quadratic" is read off a ratio rather
// than argued from a single 7.6-minute number.
console.log(`\n${"file".padEnd(24)}${"depth".padStart(8)}${"nodes".padStart(9)}${"ms".padStart(10)}${"ms/node".padStart(10)}${"vs depth".padStart(10)}`)
const base = rows[0]
for (const r of rows) {
  const depthRatio = base.depth > 0 ? r.depth / base.depth : 0
  const timeRatio = base.ms > 0 ? r.ms / base.ms : 0
  console.log(
    `${r.file.padEnd(24)}${String(r.depth).padStart(8)}${String(r.nodes).padStart(9)}${String(r.ms).padStart(10)}` +
      `${(r.ms / Math.max(1, r.nodes)).toFixed(3).padStart(10)}` +
      `${(timeRatio / Math.max(0.0001, depthRatio)).toFixed(2).padStart(10)}`,
  )
}
console.log(`\n"vs depth" = time-ratio / depth-ratio against the first row. 1.0 = linear,`)
console.log(`~depth-ratio = quadratic. ms/node is the same statement per node instead of per depth.`)
