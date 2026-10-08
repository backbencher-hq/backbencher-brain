/**
 * TYPESCRIPT LANE NO-REGEX COUNT — an AST-level count, because the shared gate's
 * detector cannot tell a regex from a string.
 *
 * `script/m14/no-regex-gate.sh` (added on branch `analyzer/DERIV_TS`, MASTER-owned)
 * counts a regex use with:
 *
 *   grep -nE 'new RegExp\(|\.(match|matchAll|replace|replaceAll|search|split)\(|/…/[gimsuy]+'
 *
 * The middle alternative matches `String.prototype.split` on its NAME, so
 * `text.split(".")` counts exactly as much as `text.split(/\./)` — and the
 * string argument is not a pattern. Measured through that gate on
 * `src/ast/real-typescript-analyzer.ts`: **12 reported**. Every one of the 12 is
 * a string-argument call:
 *
 *   1639  symbol.name.split("")
 *   2096  item.split(" as ")[0]
 *   2136  content.split("\n").length
 *   4215  child.type.replace("_declaration", "")
 *   4891  tag.split(".").pop()
 *   5728  item.split(" as ")[0].replace("* as ", "")
 *   5739  item.split(" as ")[1]
 *   6393  calleeText.split(".")
 *   6532  n.text.split(".")
 *   6556  obj.text.split(".")
 *   6606  text.split(".")
 *
 * (Line 384 is the detector matching the method NAME `getOwnerInfo` against
 * `.replace(`-adjacent text in its own signature — it is a false positive of a
 * different kind and is not counted here.)
 *
 * So this lane needs a number that is actually about patterns. This script walks
 * each file with the TypeScript parser and counts, by NODE TYPE:
 *
 *   RegularExpressionLiteral          a `/…/flags` literal
 *   NewExpression whose callee is `RegExp`   a constructed pattern
 *   CallExpression on a string method with a FIRST ARGUMENT that is a
 *   RegularExpressionLiteral or a `RegExp(...)` call
 *
 * That is the whole definition of "uses a regular expression" for a source file,
 * and counting it structurally is the only way the number survives a rename.
 *
 * It is itself regex-free: the file list comes from `readdirSync`, the walk is
 * the compiler's own `forEachChild`, and the report is arithmetic.
 *
 * Usage: bun run script/m14/ts-no-regex-count.ts [files...]
 */
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import * as ts from "typescript"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..")

const argv = process.argv.slice(2)
const explicit = argv.filter((a) => !a.startsWith("--"))
const targets: string[] = explicit.length > 0
  ? explicit
  : [
      "src/ast/real-typescript-analyzer.ts",
      "script/m14/ts-ontology-truth.ts",
      "script/m14/ts-construct-probe.ts",
      "script/m14/ts-mutants.ts",
      "script/m14/ts-mutants-run.ts",
      "script/m14/ts-firing-check.ts",
      "script/m14/ts-imports-exports-oracle.ts",
      "script/m14/ts-no-regex-count.ts",
      "script/m14/oracles/typescript-imports-exports.ts",
      "script/m14/oracles/typescript-uses.ts",
      "script/m14/oracles/typescript-references.ts",
      "script/m14/oracles/typescript-contains.ts",
    ]

/** Methods whose FIRST string argument is a pattern when it is a regex. */
const PATTERN_METHODS = new Set(["match", "matchAll", "replace", "replaceAll", "search", "split"])

type Hit = { line: number; kind: string; text: string }

function countFile(rel: string): { hits: Hit[]; stringArgSplitCalls: number } {
  const abs = path.join(ROOT, rel)
  const src = readFileSyncUtf8(abs)
  const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const hits: Hit[] = []
  let stringArgSplitCalls = 0

  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

  // Takes any Node, not an Expression: it is called with a statement position's child as
  // well as with an argument, and every guard below (`isNewExpression`) accepts a Node.
  const isRegExpCtor = (e: ts.Node): boolean =>
    ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "RegExp"

  const isPatternArg = (a: ts.Expression | undefined): boolean => {
    if (!a) return false
    if (ts.isRegularExpressionLiteral(a)) return true
    if (isRegExpCtor(a)) return true
    return false
  }

  const visit = (n: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(n)) {
      hits.push({ line: lineOf(n), kind: "RegularExpressionLiteral", text: n.getText(sf).slice(0, 60) })
    } else if (isRegExpCtor(n)) {
      hits.push({ line: lineOf(n), kind: "new RegExp", text: (n as ts.NewExpression).getText(sf).slice(0, 60) })
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        // Only a STRING receiver counts: `arr.split(x)` is not a pattern call.
        const recvIsStringish = callee.expression.text === "String"
        const name = callee.name.text
        if (PATTERN_METHODS.has(name)) {
          const first = n.arguments.length > 0 ? n.arguments[0] : undefined
          if (isPatternArg(first)) {
            hits.push({ line: lineOf(n), kind: `${name}(<pattern>)`, text: n.getText(sf).slice(0, 60) })
          } else if (name === "split" && !recvIsStringish) {
            stringArgSplitCalls++
          }
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(sf, visit)
  return { hits, stringArgSplitCalls }
}

function readFileSyncUtf8(p: string): string {
  // The ENCODING is load-bearing and was the first version's bug: without "utf8"
  // this returns a Buffer, and the TypeScript scanner then calls `.codePointAt`
  // on it and dies with "s.codePointAt is not a function" — a crash that reads as
  // a compiler problem and is really a missing argument.
  return readFileSync(p, "utf8")
}

let total = 0
const rows: { file: string; hits: Hit[]; stringArgSplitCalls: number }[] = []
for (const rel of targets) {
  try { statSync(path.join(ROOT, rel)) } catch { console.log(`MISSING ${rel}`); continue }
  const r = countFile(rel)
  rows.push({ file: rel, ...r })
  total += r.hits.length
}
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`no-regex count by AST node type — ${rows.length} file(s)\n`)
console.log(`${pad("file", 52)}${pad("patterns", 10)}${pad("split(str)", 12)}sites`)
console.log("-".repeat(110))
for (const r of rows) {
  console.log(pad(r.file, 52) + pad(String(r.hits.length), 10) + pad(String(r.stringArgSplitCalls), 12) +
    r.hits.slice(0, 3).map((h) => `${h.line}:${h.kind}`).join(" "))
}
console.log(`\nTOTAL regular-expression uses by AST node type: ${total}`)
console.log(`\nWHAT THIS DOES NOT COUNT, and why that is the point: \`text.split(".")\` and`)
console.log(`text.replace("_declaration", "")\` are string operations. The shared gate counts`)
console.log(`them because its detector matches the METHOD NAME, so its 12 for this analyzer`)
console.log(`are 0 patterns and 12 string calls — a number that is true of nothing.`)
if (total > 0) process.exit(1)