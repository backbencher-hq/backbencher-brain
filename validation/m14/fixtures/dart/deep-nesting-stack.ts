/**
 * WHICH recursion actually blows the stack on dart's deep-nesting files? — dart lane.
 *
 * The whole-corpus coverage gate reports 8 degraded files, and two of them are the dart
 * SDK's own deep-nesting fixtures. Inside the engine all it says is
 * `analyzer timeout, returning basic parse result { error: "Maximum call stack size
 * exceeded" }` — a message with no frames, because the error is raised inside a
 * `Promise.race` and only `.message` is logged. That is enough to know a file failed and
 * not enough to fix it: the analyzer is 4,000 lines and the overflow could be in any of
 * its recursive walks, in type inference, or in the engine's own post-passes.
 *
 * So this probe drives `RealDartAnalyzer.analyze` DIRECTLY on those files and prints the
 * real stack, which names the repeating frame. Nothing is inferred from the message.
 *
 * Run: npx tsx validation/m14/fixtures/dart/deep-nesting-stack.ts
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SYNTAX = "/home/ishaq2321/bb_tests/repositories/dart-sdk/tests/language/syntax"
const TARGETS = [
  path.join(SYNTAX, "deep_nesting_statement_test.dart"),
  path.join(SYNTAX, "deep_nesting_expression_test.dart"),
].filter((p) => !process.argv[2] || p.includes(process.argv[2]))

// A RangeError raised by stack exhaustion carries however many frames fitted; ask for many
// and do not let the runtime truncate the part that matters.
Error.stackTraceLimit = 500

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-dart.wasm"))))

const amod: any = await import("../../../../src/ast/real-dart-analyzer")

for (const target of TARGETS) {
  if (!fs.existsSync(target)) {
    console.log(`MISSING ${target}`)
    continue
  }
  const content = fs.readFileSync(target, "utf8")
  const tree = parser.parse(content)
  const root = tree.rootNode

  // How deep is the tree? If the grammar caps nesting the overflow may not be the tree's
  // depth at all — measured, not assumed, because that decides what the fix is.
  let maxDepth = 0
  const stack: Array<[any, number]> = [[root, 0]]
  while (stack.length) {
    const [n, d] = stack.pop()!
    if (d > maxDepth) maxDepth = d
    for (let i = 0; i < n.childCount; i++) stack.push([n.child(i), d + 1])
  }
  console.log(`\n=== ${path.basename(target)}`)
  console.log(`lines ${content.split("\n").length}, bytes ${content.length}, tree depth ${maxDepth}, nodes ${root.descendantCount ?? "?"}`)

  const analyzer = new amod.RealDartAnalyzer()
  const t0 = Date.now()
  try {
    const res = analyzer.analyze(root, content, path.basename(target), undefined)
    console.log(`OK after ${Date.now() - t0} ms: ${res.symbols?.length ?? 0} symbols, ${res.relationships?.length ?? 0} relationships`)
  } catch (e: any) {
    console.log(`CRASH: ${e?.name}: ${String(e?.message).slice(0, 160)}`)
    const frames = String(e?.stack ?? "").split("\n")
    // Print the TOP frames (where it died) and a repeating-frame census, because the
    // repeating frame IS the recursion.
    console.log(`  top frames:`)
    for (const f of frames.slice(0, 14)) console.log(`    ${f.trim()}`)
    const census = new Map<string, number>()
    for (const f of frames) {
      const key = f.trim().replace(/:\d+:\d+\)?$/, "") + (f.includes(")") ? ")" : "")
      census.set(key, (census.get(key) ?? 0) + 1)
    }
    const top = [...census.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    console.log(`  repeating frames:`)
    for (const [k, n] of top) console.log(`    ${n}x  ${k.slice(0, 130)}`)
  }
  tree.delete?.()
}
