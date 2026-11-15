/**
 * GraphQL — ROBUSTNESS: degenerate inputs and pathological depth.
 *
 * Every other gate in this lane feeds the analyzer well-formed, ASCII, shallow
 * GraphQL. That is a comfortable test set, and it hid a real defect: the
 * `findDescendant` helper recursed to the depth of the subtree whenever the
 * predicate did not match early, and `[[[…[Int]]]]` is exactly that case because
 * the `NamedType` sits at the BOTTOM. **List nesting 2,749 deep threw
 * `RangeError: Maximum call stack size exceeded`**, and the engine's guard turns any
 * throw into a minimal result — so the file yielded ZERO symbols and one opaque
 * error, silently losing a whole type definition. Now 20,000 deep.
 *
 * It survived the corpus for a reason worth recording: `A & B & C` never triggered
 * it, because the left-recursive rules put a `NamedType` at depth 1, so the
 * predicate matched immediately and the recursion never went deep. 5,000 clauses
 * still work. A defect that only one shape of input can reach is a defect a
 * representative corpus will not find.
 *
 * Two properties are asserted, and both are stated rather than assumed:
 *
 *   NO THROW, NO BAD RANGE — every file in `fixtures-robustness/` produces a result
 *   (possibly zero symbols), never an exception, and every symbol's range is
 *   1-based and its `startIndex`/`endIndex` slice out its own source text.
 *
 *   NO DEPTH CEILING — the nesting depths below are chosen well past the old
 *   failure point. They are a floor on what must work, not a claim about where the
 *   limit now is: the two subtree walks are iterative, so nothing in this analyzer
 *   recurses per node any more, and the remaining depth cost is tree-sitter's.
 */
import * as fs from "fs"
import * as path from "path"
import { GQL, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-graphql.wasm"))))
const { RealGraphqlAnalyzer } = await import(path.join(ROOT, "src/ast/real-graphql-analyzer.ts"))

const FIXTURES = path.join(GQL, "fixtures-robustness")
const problems: string[] = []
const rows: any[] = []

/** A file may legitimately produce nothing; it may not throw, and any symbol it does
 *  produce must have a 1-based range whose offsets slice out its own source text. */
function check(f: string, buf: Buffer): { symbols: number; relationships: number } {
  const src = buf.toString("utf8")
  let res: any
  try {
    res = new RealGraphqlAnalyzer().analyze(parser.parse(src).rootNode, src, f)
  } catch (e: any) {
    problems.push(`${f}: THREW ${e?.constructor?.name}: ${String(e?.message).slice(0, 120)}`)
    return { symbols: -1, relationships: -1 }
  }
  for (const s of res.symbols) {
    if (s.range.startLine < 1 || s.range.startColumn < 1 || s.range.endLine < 1 || s.range.endColumn < 1) {
      problems.push(`${f}: ${s.name} has a non-1-based range ${JSON.stringify(s.range)}`)
    }
    const seg = src.slice(s.range.startIndex ?? 0, s.range.endIndex ?? 0)
    if (seg.length && !seg.includes(s.name)) {
      problems.push(`${f}: ${s.name} range does not contain its own name (slice gave ${JSON.stringify(seg.slice(0, 40))})`)
    }
    const line = src.split("\n")[s.range.startLine - 1] ?? ""
    if (line.length && s.range.startColumn > line.length + 1) {
      problems.push(`${f}: ${s.name} startColumn ${s.range.startColumn} is past the end of its line (${line.length} chars)`)
    }
  }
  rows.push({ file: f, bytes: buf.length, symbols: res.symbols.length, relationships: res.relationships.length, exports: res.exports.length })
  return { symbols: res.symbols.length, relationships: res.relationships.length }
}

console.log("=== degenerate inputs: every one must produce a result, never an exception ===")
for (const f of fs.readdirSync(FIXTURES).filter((x) => x.endsWith(".graphql")).sort()) {
  const r = check(f, fs.readFileSync(path.join(FIXTURES, f)))
  console.log(`  ${f.padEnd(38)} ${String(r.symbols).padStart(6)} symbols  ${String(r.relationships).padStart(6)} rel`)
}

/** Depth cases, generated rather than committed: a 20,000-deep file is 40 KB of
 *  brackets, and committing generated input is how a repository acquires fixtures
 *  nobody can regenerate. */
const DEPTHS: Array<[string, (n: number) => string]> = [
  ["nested list   [[…[Int]]]", (n) => `type Q { a: ${"[".repeat(n)}Int${"]".repeat(n)} }\n`],
  ["nested object {k:{k:…}}", (n) => { let inner = "Int"; for (let i = 0; i < n; i++) inner = `{ k: ${inner} }`; return `type Q { a(x: ${inner}): Int }\n` }],
  ["implements    A & B & C…", (n) => `${Array.from({ length: n }, (_, i) => `interface N${i} { x: Int }`).join("\n")}\ntype Big implements ${Array.from({ length: n }, (_, i) => `N${i}`).join(" & ")} { x: Int }\n`],
  ["union         A | B | C…", (n) => `${Array.from({ length: n }, (_, i) => `type T${i} { x: Int }`).join("\n")}\nunion U = ${Array.from({ length: n }, (_, i) => `T${i}`).join(" | ")}\n`],
  ["on locations  A | B | C…", (n) => `directive @d on ${Array.from({ length: n }, () => "FIELD_DEFINITION").join(" | ")}\ntype Q { a: String @d }\n`],
]

console.log("\n=== pathological depth: past the old 2,749 failure point ===")
for (const [label, build] of DEPTHS) {
  for (const depth of [1000, 5000, 20000]) {
    const src = build(depth)
    let verdict: string
    try {
      const res: any = new RealGraphqlAnalyzer().analyze(parser.parse(src).rootNode, src, "depth")
      verdict = `${String(res.symbols.length).padStart(6)} symbols  ${String(res.relationships.length).padStart(6)} rel`
    } catch (e: any) {
      verdict = `THREW ${e?.constructor?.name}`
      problems.push(`${label} at depth ${depth}: THREW ${e?.constructor?.name}: ${String(e?.message).slice(0, 100)}`)
    }
    console.log(`  ${label.padEnd(24)} depth ${String(depth).padStart(6)}  ${verdict}`)
  }
}

// ---------------------------------------------------------------- linearity ---
// "A single iterative DFS" is a claim about complexity, and a claim about complexity
// needs a CURVE, not one file. The same schema SHAPE is generated at six sizes and
// the cost per 1k symbols is compared across a 30x range: a super-linear term shows
// up as that figure RISING with size, because the fixed cost amortises while the
// quadratic term does not. The corpus sweep already hinted at this (cost per line
// FALLS from 120 to 69 ms/1k between small and large files) but n=2 is weak, so it
// is measured here deliberately.
console.log("\n=== scaling: the same shape at six sizes, 30x range ===")
const buildScaled = (types: number): string => {
  const out: string[] = ["directive @tag(name: String) repeatable on FIELD_DEFINITION | OBJECT", "enum Role { ADMIN USER GUEST }", "interface Node { id: ID! }", "input Filter { role: Role = USER limit: Int = 10 }"]
  for (let i = 0; i < types; i++) {
    out.push(`type T${i} implements Node {`, `  id: ID!`, `  name(limit: Int, filter: Filter): String @tag(name: "t${i}")`, `  child: T${(i + 1) % types}`, `}`)
  }
  return out.join("\n") + "\n"
}
const scale: Array<{ types: number; lines: number; symbols: number; ms: number; per1kSym: number }> = []
for (const types of [50, 100, 200, 400, 800, 1600]) {
  const src = buildScaled(types)
  const tree = parser.parse(src)
  new RealGraphqlAnalyzer().analyze(tree.rootNode, src, "warm")
  let symbols = 0
  const t0 = Date.now()
  for (let r = 0; r < 5; r++) symbols = new RealGraphqlAnalyzer().analyze(tree.rootNode, src, "s").symbols.length
  const ms = (Date.now() - t0) / 5
  const per1kSym = (ms / symbols) * 1000
  scale.push({ types, lines: src.split("\n").length, symbols, ms: Number(ms.toFixed(1)), per1kSym: Number(per1kSym.toFixed(1)) })
  console.log(`  ${String(types).padStart(5)} types  ${String(symbols).padStart(6)} sym  ${ms.toFixed(0).padStart(5)} ms  ${per1kSym.toFixed(1).padStart(7)} ms/1k sym`)
}
// The MILLISECONDS above are printed, not gated. This machine re-measures the same
// binary over a 3x range between runs — one session measured cost per 1k symbols
// FALLING 457 -> 241, the next RISING 120 -> 366, on identical code — so a
// time-based linearity gate here would be a flaky gate, and a flaky gate gets
// disabled. Linearity is asserted the way gate 10b already measures cost: by
// COUNTING. Accessor calls are the analyzer's only super-linear risk (a hidden
// per-node re-walk of the source, a re-split of the content, a per-symbol subtree
// scan), and calls-per-symbol is exact, machine-independent, and the thing that
// would actually betray a quadratic term.
const N: any = (wts as any).Node ?? (wts as any).default?.Node
function countedPerSymbol(src: string): { calls: number; symbols: number } {
  const proto: any = N?.prototype
  if (!proto) return { calls: -1, symbols: -1 }
  const keys = ["namedChildCount", "namedChild", "child", "childCount", "type", "startPosition", "endPosition", "startIndex", "endIndex", "text", "namedChildren", "children"]
  const saved: Record<string, PropertyDescriptor> = {}
  let calls = 0
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(proto, k)
    if (!d) continue
    saved[k] = d
    if (d.get) Object.defineProperty(proto, k, { ...d, get() { calls++; return d.get!.call(this) } })
    else if (typeof d.value === "function") Object.defineProperty(proto, k, { ...d, value: function (...a: any[]) { calls++; return d.value.apply(this, a) } })
  }
  let symbols = 0
  try {
    symbols = new RealGraphqlAnalyzer().analyze(parser.parse(src).rootNode, src, "count").symbols.length
  } finally {
    for (const k of keys) if (saved[k]) Object.defineProperty(proto, k, saved[k])
  }
  return { calls, symbols }
}

const counted: Array<{ types: number; symbols: number; calls: number; perSymbol: number }> = []
for (const types of [50, 100, 200, 400, 800, 1600]) {
  const src = buildScaled(types)
  const c = countedPerSymbol(src)
  const perSymbol = Number((c.calls / c.symbols).toFixed(2))
  counted.push({ types, symbols: c.symbols, calls: c.calls, perSymbol })
  console.log(`  ${String(types).padStart(5)} types  ${String(c.symbols).padStart(6)} sym  ${String(c.calls).padStart(9)} accessor calls  ${perSymbol.toFixed(2).padStart(7)} per symbol`)
}
if (counted[0].perSymbol > 0) {
  // Allow a small drift for the fixed per-call cost (a handful of reads do not
  // scale with the input), then require the LAST size to be within it.
  const first = counted[0].perSymbol
  const last = counted[counted.length - 1].perSymbol
  const ratio = last / first
  const TOLERANCE = 1.5
  console.log(`  counted cost per symbol, smallest vs largest: ${ratio.toFixed(2)}x  (tolerance ${TOLERANCE}x)`)
  if (ratio > TOLERANCE) problems.push(`accessor calls per symbol grew ${ratio.toFixed(2)}x across a 32x size range, so a super-linear term exists`)
  // and the absolute figure must not climb at all with size
  const drift = Math.max(...counted.map((c) => c.perSymbol)) - Math.min(...counted.map((c) => c.perSymbol))
  if (drift / Math.min(...counted.map((c) => c.perSymbol)) > TOLERANCE) problems.push(`accessor calls per symbol are not constant (spread ${drift.toFixed(2)} per symbol across sizes)`)
}

// ------------------------------------------------------------- idempotence ---
// The analyzer holds a per-call `node.type` memo on the INSTANCE, and the engine
// happens to construct a fresh analyzer per file. That is a caller invariant, not a
// guarantee, so the property is asserted directly: one shared instance, every
// fixture, four orderings, and twenty repeats of one file, all byte-identical to a
// fresh instance per file. A memo that outlived a call would answer with the
// PREVIOUS tree's type, and this is the only instrument that would see it.
console.log("\n=== idempotence: one shared instance, four orderings, 20 repeats ===")
const FIXDIR = path.join(GQL, "fixtures")
const fixFiles = fs.readdirSync(FIXDIR).filter((x) => x.endsWith(".graphql")).sort()
const loaded = new Map(fixFiles.map((f) => { const src = fs.readFileSync(path.join(FIXDIR, f), "utf8"); return [f, { src, tree: parser.parse(src) }] as const }))
const fingerprint = (r: any): string =>
  JSON.stringify({
    s: r.symbols.map((x: any) => [x.name, x.kind, x.range.startLine, x.range.startColumn, x.range.startIndex]),
    r: r.relationships.map((x: any) => [x.source, x.target, x.type, x.line_number]),
    e: r.exports.map((x: any) => x.name).sort(),
  })
/** The engine's ParseResult carries the same shapes, so the same fingerprint works. */
const fingerprintDirect = (r: any): string => fingerprint(r)
const baseline = new Map<string, string>()
for (const f of fixFiles) { const d = loaded.get(f)!; baseline.set(f, fingerprint(new RealGraphqlAnalyzer().analyze(d.tree.rootNode, d.src, f))) }
const shared = new RealGraphqlAnalyzer()
const orders: Array<[string, string[]]> = [
  ["forward", fixFiles],
  ["again", fixFiles],
  ["reversed", [...fixFiles].reverse()],
  ["reversed again", [...fixFiles].reverse()],
]
for (const [label, order] of orders) {
  let diffs = 0
  for (const f of order) { const d = loaded.get(f)!; if (fingerprint(shared.analyze(d.tree.rootNode, d.src, f)) !== baseline.get(f)) diffs++ }
  console.log(`  ${label.padEnd(16)} ${diffs === 0 ? "identical" : `${diffs} DIFFERENCE(S)`}`)
  if (diffs) problems.push(`idempotence: ${diffs} difference(s) on a shared instance, order "${label}"`)
}
let repeatDiffs = 0
{ const f = fixFiles[0]; const d = loaded.get(f)!; for (let i = 0; i < 20; i++) if (fingerprint(shared.analyze(d.tree.rootNode, d.src, f)) !== baseline.get(f)) repeatDiffs++ }
console.log(`  20 repeats       ${repeatDiffs === 0 ? "identical" : `${repeatDiffs} DIFFERENCE(S)`}`)
if (repeatDiffs) problems.push(`idempotence: ${repeatDiffs} difference(s) over 20 repeats of one file on a shared instance`)

// ------------------------------------------------- the production engine path ---
// Every other gate in this lane calls the analyzer DIRECTLY. Production does not:
// `ASTEngine.parseFile` adds timeout handling, the ERROR/MISSING walk and the
// ambiguity counters between the tree and the result. So the engine path is compared
// against the direct one, identity by identity, rather than by count.
//
// The FIRST version of this check reported all seven fixtures differing, with a
// syntax error at line 1 columns 1-8 on every one. It was the check's fault:
// `parseFile(filePath, content, context?)` takes the file's CONTENT as its second
// argument, and the language string had been passed there, so the engine parsed the
// 7-character word "graphql" as a GraphQL document. The wasm hash and the signature
// were checked before any of it was reported as a production defect — the same
// lesson as a mutation whose anchor no longer applies, applied to a much scarier
// looking result.
console.log("\n=== production path: engine.parseFile vs the direct analyzer ===")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
let differing = 0
for (const f of fs.readdirSync(FIXDIR).filter((x) => x.endsWith(".graphql")).sort()) {
  const d = loaded.get(f)!
  const viaEngine: any = await ASTEngine.parseFile(path.join(FIXDIR, f), d.src)
  const same = fingerprintDirect(viaEngine) === baseline.get(f)
  if (!same) { differing++; console.log(`  ${f} DIFFERS via the engine`) }
}
console.log(`  ${fixFiles.length} fixtures, ${differing} differing`)
if (differing) problems.push(`the production engine path changed ${differing} file(s) relative to the direct analyzer`)

fs.writeFileSync(path.join(GQL, "out", "robustness.json"), JSON.stringify({ productionPath: { files: fixFiles.length, differing }, fixtures: rows, depths: DEPTHS.map(([l]) => l), scale, countedScaling: counted, idempotence: { orders: orders.map(([l]) => l), repeatDiffs }, problems }, null, 2) + "\n")
if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):`)
  for (const p of problems.slice(0, 20)) console.log(`  ${p}`)
}
process.exitCode = problems.length ? 1 : 0
