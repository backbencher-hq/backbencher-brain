/**
 * INDEPENDENT include-path rule for php, and the shapes the corpora cannot exercise.
 *
 * `phpStaticIncludePath` is the analyzer's own and the differential CALLS IT. That
 * rule has been wrong too: it once published `$this->baseDir.'revision-info.php'`
 * as a `references` target — a string no php symbol can be named, carrying `$`, `->`,
 * `.` and quotes — and both sides agreed on it because both called the same function.
 *
 * Written from the pinned grammar's own include shapes (probe-verified above this
 * file's author), and measured over the full git-tracked corpus of both repos.
 */
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { phpStaticIncludePath } = await import(path.join(ROOT, "src/ast/real-php-analyzer.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const g: any = await (wts as any).Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-php.wasm`))
const parser = new P(); parser.setLanguage(g)

/** Strip one layer of surrounding quotes by first/last char — a char test, not a regex. */
function stripQuotes(t: string): string {
  if (t.length < 2) return t
  const a = t.charCodeAt(0), b = t.charCodeAt(t.length - 1)
  if ((a === 34 && b === 34) || (a === 39 && b === 39)) return t.substring(1, t.length - 1)
  return t
}
/** Does this subtree interpolate a variable? Then its VALUE is not fixed. */
function interpolates(n: any): boolean {
  if (n.type === "variable_name" || n.type === "dynamic_variable_name") return true
  for (let i = 0; i < n.namedChildCount; i++) if (n.namedChild(i) && interpolates(n.namedChild(i))) return true
  return false
}
/**
 * THE STATIC VALUE of one path-shaped node, or undefined when it is not static.
 *
 * Only `.` composes a path. A concatenation's value is the CONCATENATION OF ITS
 * OPERANDS' VALUES — not the source text of the concatenation, which is the defect
 * this whole rule was rewritten for (`__DIR__.'/src/X.php'` published as a target,
 * operator and quotes and all).
 */
function staticValue(n: any): string | undefined {
  switch (n.type) {
    case "string":
      return stripQuotes(String(n.text ?? ""))
    case "encapsed_string":
      return interpolates(n) ? undefined : stripQuotes(String(n.text ?? ""))
    case "name":
    case "qualified_name":
      // __DIR__ / __FILE__ and a defined path constant are static BY DEFINITION; a
      // constant is named at the site even though its value lives in another file.
      return String(n.text ?? "")
    case "binary_expression": {
      const ops: any[] = []
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) ops.push(c) }
      if (ops.length !== 2) return undefined
      const between = String(n.text ?? "").slice(ops[0].endIndex - n.startIndex, ops[1].startIndex - n.startIndex).trim()
      if (between !== ".") return undefined
      const l = staticValue(ops[0]), r = staticValue(ops[1])
      return l === undefined || r === undefined ? undefined : l + r
    }
    default:
      return undefined
  }
}
/** The path-shaped operand of an include node, independently located. */
function independentIncludePath(n: any): string | undefined {
  const SHAPES = new Set(["string", "encapsed_string", "binary_expression", "name", "qualified_name"])
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (!c || !SHAPES.has(c.type)) continue
    return staticValue(c)
  }
  return undefined
}

let files = 0, nodes = 0
let both = 0, sharedOnly = 0, indepOnly = 0, neither = 0
const diffs: string[] = []
const shapes = new Map<string, number>()
const declinedShapes = new Map<string, number>()
for (const repo of ["phpunit", "phpmyadmin"]) {
  const dir = path.join("$HOME/fixtures/repositories", repo)
  for (const f of execSync(`git ls-files -z -- '*.php'`, { cwd: dir, maxBuffer: 1 << 28 }).toString().split("\0").filter(Boolean).sort()) {
    let src: string, root: any
    try { src = readFileSync(path.join(dir, f), "utf8"); root = parser.parse(src).rootNode } catch { continue }
    files++
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (/^(require|include)(_once)?_expression$/.test(n.type)) {
        nodes++
        let first = "(none)"
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) { first = c.type; break } }
        shapes.set(first, (shapes.get(first) ?? 0) + 1)
        const a = phpStaticIncludePath(n)
        const b = independentIncludePath(n)
        if (a !== undefined && b !== undefined) { both++; if (a !== b && diffs.length < 25) diffs.push(`${repo}/${f}  ${n.type}\n      shared: ${JSON.stringify(a)}\n      independent: ${JSON.stringify(b)}`) }
        else if (a !== undefined) { sharedOnly++; declinedShapes.set(first, (declinedShapes.get(first) ?? 0) + 1); if (declinedShapes.get(first)! <= 2) diffs.push(`${repo}/${f}  ${n.type} operand=${first}\n      shared: ${JSON.stringify(a)}\n      independent: (declined)`) }
        else if (b !== undefined) { indepOnly++; if (indepOnly <= 5) diffs.push(`${repo}/${f}  ${n.type} operand=${first}\n      shared: (declined)\n      independent: ${JSON.stringify(b)}`) }
        else neither++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) st.push(c) }
    }
  }
}
console.log(`files=${files}  include/require nodes=${nodes}`)
console.log(`\nPATHS: both=${both}  shared-only=${sharedOnly}  independent-only=${indepOnly}  neither=${neither}`)
console.log(`  disagreements: ${diffs.length}${diffs.length >= 25 ? "+" : ""}`)
for (const d of diffs) console.log("    " + d)
console.log(`\nOPERAND SHAPES in the corpora:`)
for (const [k, v] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(30)} ${v}${declinedShapes.has(k) ? `   (shared accepts ${declinedShapes.get(k)} the independent rule declines)` : ""}`)
process.exit(0)
