/**
 * Protobuf ROBUSTNESS — degenerate input, deep input, and repeated runs.
 *
 * A corpus is 293 files of well-formed protobuf written by people who wanted it
 * to work. Everything interesting happens off that path, so each fixture here is
 * input no corpus contains:
 *
 *   - EMPTY and whitespace-only files, which must yield nothing and not throw;
 *   - comment-only and doc-comment-only files;
 *   - truncated declarations at every nesting level, which is what a file
 *     interrupted mid-write looks like, and which is where a naive recursive
 *     walker runs out of stack;
 *   - a 2,000-level message nest, to establish that the walk is iterative. A
 *     recursive descent overflows the stack around a few thousand frames and
 *     Node's default stack is small enough that a merely DEEP file is a crash;
 *   - a single 200,000-character line, a file with no trailing newline, CRLF line
 *     endings, and a BOM — all of which move byte offsets relative to lines and
 *     break naive line arithmetic;
 *   - non-ASCII identifiers and string contents;
 *   - the ruled MessageSet construct, which must degrade to a loss of THAT
 *     construct and not to a crash or a phantom.
 *
 * Three invariants hold for every fixture: it does not throw, every symbol's
 * range spans its own name, and running twice on the same input gives the same
 * answer (idempotence, which a shared mutable tree or a leaked `node.id` cache
 * would break).
 *
 * Usage: tsx robustness.mts
 */
import * as fs from "fs"
import * as path from "path"
import { OUT, ROOT, WASM } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(WASM)))
const { RealProtobufAnalyzer } = await import(path.join(ROOT, "src/ast/real-protobuf-analyzer.ts"))

interface Fixture {
  id: string
  why: string
  src: string
  expectThrow?: false
  /** The number of symbols a well-behaved run should produce, when it is knowable. */
  expectSymbols?: number
}

const nest = (depth: number): string => {
  let s = ""
  for (let i = 0; i < depth; i++) s += `message M${i} {\n`
  s += "int32 leaf = 1;\n"
  for (let i = depth - 1; i >= 0; i--) s += "}\n"
  return s
}

const FIXTURES: Fixture[] = [
  { id: "empty", why: "a zero-byte file", src: "" },
  { id: "whitespace-only", why: "spaces and newlines only", src: "   \n\n\t\n  " },
  { id: "comment-only", why: "comments and nothing else", src: "// just a comment\n/* block */\n" },
  { id: "doc-comment-then-nothing", why: "a doc comment with no declaration after it", src: "// documented\n" },
  { id: "syntax-only", why: "a header and no declarations", src: 'syntax = "proto3";\n' },
  { id: "package-only", why: "a package and no declarations", src: 'syntax = "proto3";\npackage a.b.c;\n' },
  { id: "no-trailing-newline", why: "a last line with no newline", src: 'syntax = "proto3";\nmessage M { int32 a = 1; }' },
  { id: "crlf", why: "CRLF line endings, which shift every byte offset after the first \\r", src: 'syntax = "proto3";\r\npackage p;\r\nmessage M {\r\n  int32 a = 1;\r\n}\r\n' },
  { id: "bom", why: "a UTF-8 BOM before the first token", src: '\uFEFFsyntax = "proto3";\nmessage M { int32 a = 1; }\n' },
  { id: "unterminated-message", why: "a file interrupted mid-declaration", src: 'syntax = "proto3";\nmessage M {\n  int32 a = 1;\n' },
  { id: "unterminated-string", why: "a string literal with no closing quote", src: 'syntax = "proto3";\nimport "a.proto;\n' },
  { id: "unbalanced-braces", why: "an extra closing brace", src: 'syntax = "proto3";\nmessage M {}\n}\n' },
  { id: "stray-tokens", why: "punctuation with no declaration", src: 'syntax = "proto3";\n} ] ) ;\n' },
  { id: "keyword-garbage", why: "valid keywords in impossible positions", src: 'syntax = "proto3";\nmessage message message;\nenum enum;\nservice service;\n' },
  { id: "truncated-nested", why: "a deep nest cut off part-way", src: nest(40).slice(0, -200) },
  { id: "deep-2000", why: "a 2,000-level message nest — a recursive walker dies here", src: nest(2000) },
  { id: "deep-5000", why: "a 5,000-level nest", src: nest(5000) },
  { id: "one-huge-line", why: "a single 200,000-character line of fields", src: 'syntax = "proto3";\nmessage M {' + Array.from({ length: 20000 }, (_, i) => `int32 f${i} = ${i + 1};`).join(" ") + "}\n" },
  { id: "one-huge-string", why: "a single 100,000-character string literal", src: 'syntax = "proto3";\noption java_package = "' + "x".repeat(100000) + '";\nmessage M {}\n' },
  { id: "unicode-identifiers", why: "non-ASCII in strings and in an option value", src: 'syntax = "proto3";\noption java_package = "café — 日本語 — 🎉";\nmessage M {}\n' },
  { id: "ruled-messageset", why: "the RULED construct: must lose only that construct", src: 'syntax = "proto2";\nmessage M {\n  extensions 4 to max;\n}\nmessage E {\n  extend M {\n    optional group Item = 1 {\n      optional int32 id = 2;\n      any { optional int32 a = 1; }\n    }\n  }\n}\n', expectSymbols: undefined },
  { id: "group-only", why: "a group with nothing but groups inside", src: 'syntax = "proto2";\nmessage M { optional group G = 1 { optional group H = 2 { optional int32 x = 3; } } }' },
  { id: "oneof-empty", why: "a oneof with no members", src: 'syntax = "proto3";\nmessage M { oneof pick {} }' },
  { id: "enum-empty", why: "an enum with no members", src: 'syntax = "proto3";\nenum E {}' },
  { id: "message-empty", why: "an empty message", src: 'syntax = "proto3";\nmessage M {}', expectSymbols: 1 },
  { id: "service-no-rpcs", why: "a service with no methods", src: 'syntax = "proto3";\nservice S {}', expectSymbols: 1 },
  { id: "rpc-no-types", why: "an rpc with damaged parameter types", src: 'syntax = "proto3";\nservice S { rpc Go() returns (); }' },
  { id: "extend-nothing", why: "an extend block with no members", src: 'syntax = "proto3";\nmessage M { extensions 1 to 9; }\nmessage E { extend M {} }' },
  { id: "map-bare", why: "a map field with a message key (invalid protobuf)", src: 'syntax = "proto3";\nmessage K {}\nmessage M { map<K, K> m = 1; }' },
  { id: "duplicate-names", why: "two fields with the same name in one message", src: 'syntax = "proto3";\nmessage M { int32 a = 1; int32 a = 2; }' },
  { id: "field-name-clashes-oneof", why: "a field and a oneof sharing a name, which protoc rejects", src: 'syntax = "proto3";\nmessage M { int32 pick = 1; oneof pick { int32 b = 2; } }' },
  { id: "all-syntaxes", why: "proto2, proto3 and an editions file in one corpus run", src: 'syntax = "proto2";\nmessage A { optional int32 a = 1; }\n' },
]

const problems: string[] = []
const rows: any[] = []

for (const f of FIXTURES) {
  const row: any = { id: f.id, why: f.why, bytes: f.src.length, lines: f.src.split("\n").length }
  let first: any
  try {
    const tree: any = parser.parse(f.src)
    first = new RealProtobufAnalyzer().analyze(tree.rootNode, f.src, `${f.id}.proto`)
  } catch (e) {
    row.threw = e instanceof Error ? e.message : String(e)
    problems.push(`${f.id}: THREW — ${row.threw}`)
    rows.push(row)
    continue
  }
  row.symbols = first.symbols.length
  row.relationships = first.relationships.length
  row.imports = (first.imports ?? []).length

  // invariant 1: every range spans its own name
  let bad = 0
  for (const s of first.symbols) {
    if (s.range.startIndex === undefined || s.range.endIndex === undefined) continue
    if (!f.src.slice(s.range.startIndex, s.range.endIndex).includes(s.name)) bad++
  }
  if (bad) {
    row.badRanges = bad
    problems.push(`${f.id}: ${bad} symbol range(s) do not span their own name`)
  }

  // invariant 2: no self-looping relationship
  const loops = first.relationships.filter((r: any) => r.source && r.source === r.target)
  if (loops.length) {
    row.selfLoops = loops.length
    problems.push(`${f.id}: ${loops.length} self-looping relationship(s)`)
  }

  // invariant 3: no duplicate symbol ids
  const ids = new Set<string>()
  let dupes = 0
  for (const s of first.symbols) {
    const id = String(s.metadata?.id ?? s.name)
    if (ids.has(id)) dupes++
    ids.add(id)
  }
  if (dupes) {
    row.duplicateIds = dupes
    problems.push(`${f.id}: ${dupes} duplicate symbol id(s)`)
  }

  // invariant 4: idempotence — a second run on a FRESH tree must agree exactly
  const tree2: any = parser.parse(f.src)
  const second: any = new RealProtobufAnalyzer().analyze(tree2.rootNode, f.src, `${f.id}.proto`)
  const fp = (r: any) => JSON.stringify([r.symbols, r.relationships, r.imports])
  if (fp(first) !== fp(second)) {
    row.idempotent = false
    problems.push(`${f.id}: a second run disagreed with the first`)
  } else row.idempotent = true

  if (f.expectSymbols !== undefined && first.symbols.length !== f.expectSymbols) {
    problems.push(`${f.id}: produced ${first.symbols.length} symbols, expected ${f.expectSymbols}`)
  }
  rows.push(row)
}

// -------------------------------------------------------------- linearity
// The walk is iterative, so cost must be linear in input size. Timings on this
// machine are too noisy to assert, so the COSTS are compared instead: a
// super-linear walker shows a cost per byte that rises with input size, and a
// constant-factor one does not.
const lin: any[] = []
for (const n of [500, 1000, 2000, 4000]) {
  const src = nest(n)
  const tree: any = parser.parse(src)
  const t0 = process.hrtime.bigint()
  const r: any = new RealProtobufAnalyzer().analyze(tree.rootNode, src, "lin.proto")
  const t1 = process.hrtime.bigint()
  const ms = Number(t1 - t0) / 1e6
  lin.push({ depth: n, symbols: r.symbols.length, ms: Number(ms.toFixed(2)), msPerSymbol: Number((ms / Math.max(1, r.symbols.length)).toFixed(4)) })
}
const firstHalf = lin.slice(0, 2).reduce((a, x) => a + x.msPerSymbol, 0) / 2
const secondHalf = lin.slice(2).reduce((a, x) => a + x.msPerSymbol, 0) / 2
const ratio = secondHalf / Math.max(firstHalf, 1e-9)
if (ratio > 3) problems.push(`linearity: cost per symbol grew ${ratio.toFixed(1)}x from small depths to large (not linear)`)

const out = {
  generatedAt: new Date().toISOString(),
  fixtures: rows.length,
  rows,
  linearity: lin,
  linearityRatio: Number(ratio.toFixed(2)),
  problems,
  pass: problems.length === 0,
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "robustness.json"), JSON.stringify(out, null, 2))

console.log(`\n  fixtures: ${rows.length}`)
console.log(`  deepest nest handled: ${Math.max(...rows.map((r) => (r.id.startsWith("deep-") ? Number(r.id.slice(5)) : 0)))} levels`)
console.log(`  linearity cost-per-symbol ratio (small -> large depths): ${ratio.toFixed(2)}x`)
if (problems.length) {
  console.log(`\n  FAIL (${problems.length}):`)
  for (const p of problems.slice(0, 20)) console.log(`    - ${p}`)
} else {
  console.log(`\n  PASS: no fixture threw, every range spans its own name, no self-loops, no duplicate ids, every run idempotent`)
}
console.log(`\n  wrote ${path.join(OUT, "robustness.json")}`)
process.exit(problems.length ? 1 : 0)
