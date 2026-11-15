// M14.0.F6 reads `fixture-coverage-groovy: FAIL, uncovered: [lambda_expression]`
// at HEAD: the analyzer branches on a `lambda_expression` node that no committed
// groovy fixture's PARSE contains. Which source shape produces that node in the
// pinned grammar? Parse candidates and report the types each one yields.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
const parser = new P()
parser.setLanguage(lang)

// The corpus census (script/m14/tmp/gr-lambda-census.ts) says the node is REAL:
// 26 files / 60 occurrences across the two pinned corpora, with parent types
// variable_declarator 26, argument_list 20, expression_statement 8,
// range_expression 3, closure 2, return_statement 1 — and the sites look like
// `s -> !s.isEmpty()`, `() -> userCacheManager`, `(K key, V value) -> {`. The
// first version of this probe tested only BRACE forms and concluded the arrow
// was a single exotic spelling; the corpus says otherwise, so the cases below
// are the corpus-derived ones plus the brace controls.
const CASES: Array<[string, string]> = [
  ["bare closure", "def f = { x -> x + 1 }"],
  ["typed param closure", "def f = { int x -> x + 1 }"],
  ["no-param closure", "def f = { x + 1 }"],
  ["explicit def param", "def f = { def x -> x + 1 }"],
  ["two params", "def f = { a, b -> a + b }"],
  ["closure as arg", "list.each { int x -> print x }"],
  ["collect lambda", "def f = [1,2].collect { it * 2 }"],
  ["arrow, typed param", "def f = (int x) -> x + 1"],
  ["arrow, bare param", "def f = s -> !s.isEmpty()"],
  ["arrow, no param", "def f = () -> cacheManager"],
  ["arrow, two typed", "def f = (K key, V value) -> { key }"],
  ["arrow as arg", "list.findAll s -> !s.isEmpty()"],
  ["arrow in gradle", "tasks.register('x') { t -> t.group = 'g'; def h = (String s) -> s }"],
]
for (const [name, src] of CASES) {
  const tree: any = parser.parse(src)
  const types = new Set<string>()
  const stack: any[] = [tree.rootNode]
  let hasLambda = false
  while (stack.length) {
    const n = stack.pop()!
    types.add(n.type)
    if (n.type === "lambda_expression") hasLambda = true
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  console.log(
    `${hasLambda ? "LAMBDA" : "      "}  ${name.padEnd(22)} err=${tree.rootNode.hasError}  types=[${[...types].join(",")}]`,
  )
}
process.exit(0)
