/**
 * solidity-no-regex-census — the Solidity lane's D5 no-regex gate, at the AST level.
 *
 * THE CONTRACT: `src/ast/real-solidity-analyzer.ts` uses NO regular expressions. The analyzer's own
 * head comment and docs state it, and it is a construction property, not a lint promise: every
 * string rule in that file is a character scan. This gate is the evidence, and it is AST-level
 * because a text scan cannot tell `split("\n")` from `split(/x/)` — a string argument is not a
 * regex. It parses the analyzer with the project's TypeScript parser and counts:
 *
 *   - RegExpLiteral nodes                       (`/.../`)                     FAIL if > 0
 *   - `new RegExp(...)` / `RegExp(...)` calls                                FAIL if > 0
 *   - regex-taking String methods called with a REGEX argument                FAIL if > 0
 *   - the same methods called with a STRING argument                          REPORTED, allowed
 *     (character-scan code is written this way: `text.split("::")`),
 *   - `String.prototype.replace` etc. with a regex-typed argument             FAIL
 *
 * A "no regex" claim that only greps for `/` would fail on every comment, file path and division
 * operator; a claim that only checks literals would miss `new RegExp(source)`. The two counts are
 * printed separately so a reader can see which one a future edit trips.
 *
 * Exit: 0 clean · 1 regex usage found. Usage:
 *   bun run script/m14/solidity-no-regex-census.ts [--json]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import ts from "typescript"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const TARGET = path.join(ROOT, "src/ast/real-solidity-analyzer.ts")
const JSON_OUT = process.argv.includes("--json")

const REGEX_METHODS = new Set(["match", "matchAll", "replace", "replaceAll", "search", "split"])

/** Pure-String whitespace collapse (this instrument's own rule: no regex, either). */
function collapseSpaces(text: string): string {
  let out = ""
  let pending = false
  for (const ch of text) {
    const ws = ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
    if (ws) { if (out.length > 0) pending = true; continue }
    if (pending) { out += " "; pending = false }
    out += ch
  }
  return out
}

const src = readFileSync(TARGET, "utf8")
const sf = ts.createSourceFile(TARGET, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const findings: Array<{ line: number; kind: string; text: string }> = []
let literalCount = 0
let constructorCount = 0
let regexArgCount = 0
let stringArgCount = 0
let regexTypedCallCount = 0

function lineOf(n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
}

const visit = (n: ts.Node): void => {
  if (ts.isRegularExpressionLiteral(n)) {
    literalCount++
    findings.push({ line: lineOf(n), kind: "RegExpLiteral", text: n.getText(sf).slice(0, 80) })
  }
  if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "RegExp") {
    constructorCount++
    findings.push({ line: lineOf(n), kind: "new RegExp", text: n.getText(sf).slice(0, 80) })
  }
  if (ts.isCallExpression(n)) {
    // A bare `RegExp(x)` call is the same constructor.
    if (ts.isIdentifier(n.expression) && n.expression.text === "RegExp") {
      constructorCount++
      findings.push({ line: lineOf(n), kind: "RegExp()", text: n.getText(sf).slice(0, 80) })
    }
    if (ts.isPropertyAccessExpression(n.expression) && REGEX_METHODS.has(n.expression.name.text)) {
      const m = n.expression.name.text
      const a = n.arguments[0]
      if (a && ts.isRegularExpressionLiteral(a)) {
        regexArgCount++
        findings.push({ line: lineOf(n), kind: `.${m}(/regex/)`, text: n.getText(sf).slice(0, 80) })
      } else if (a && ts.isStringLiteral(a)) {
        stringArgCount++
      } else if (a && ts.isIdentifier(a)) {
        // The argument is a variable — only a finding when its declared type is RegExp.
        const name = a.text
        const decl = sf.statements.find(
          (s): s is ts.VariableStatement =>
            ts.isVariableStatement(s) &&
            s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name),
        )
        const isRegexTyped =
          decl !== undefined &&
          decl.declarationList.declarations.some(
            (d) =>
              ts.isIdentifier(d.name) &&
              d.name.text === name &&
              d.type !== undefined &&
              collapseSpaces(d.type.getText(sf)) === "RegExp",
          )
        if (isRegexTyped) {
          regexTypedCallCount++
          findings.push({ line: lineOf(n), kind: `.${m}(regex-var ${name})`, text: n.getText(sf).slice(0, 80) })
        }
      }
    }
  }
  ts.forEachChild(n, visit)
}
visit(sf)

const failures: string[] = []
if (literalCount > 0) failures.push(`${literalCount} regex literal(s)`)
if (constructorCount > 0) failures.push(`${constructorCount} RegExp constructor call(s)`)
if (regexArgCount > 0) failures.push(`${regexArgCount} regex argument(s) to String methods`)
if (regexTypedCallCount > 0) failures.push(`${regexTypedCallCount} regex-typed variable argument(s) to String methods`)

const report = {
  schemaVersion: 1,
  instrument: "script/m14/solidity-no-regex-census.ts",
  measuredAt: new Date().toISOString(),
  target: path.relative(ROOT, TARGET),
  sourceBytes: src.length,
  counts: {
    regexLiterals: literalCount,
    regexpConstructors: constructorCount,
    regexArgumentsToStringMethods: regexArgCount,
    regexTypedVariableArguments: regexTypedCallCount,
    stringArgumentsToStringMethods: stringArgCount,
  },
  findings,
  ok: failures.length === 0,
  note:
    "string arguments to split/replace/etc. are ALLOWED and counted separately: this lane's rules are character scans, and `text.split(\"::\")` is the shape they are written in. The gate fails only on an actual regex.",
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 1))
  process.exit(report.ok ? 0 : 1)
}
console.log(`solidity-no-regex-census — ${report.target} (${src.length} bytes)`)
console.log(`  RegExpLiteral ${literalCount} · new RegExp ${constructorCount} · regex arg to String method ${regexArgCount} · regex-typed var arg ${regexTypedCallCount}`)
console.log(`  (allowed and counted: ${stringArgCount} STRING argument(s) to split/replace/etc. — character scans)`)
for (const f of findings) console.log(`  L${f.line} ${f.kind}: ${f.text}`)
console.log(report.ok ? "RESULT: CLEAN — the analyzer uses no regular expression" : `RESULT: FAIL — ${failures.join(" · ")}`)
process.exit(report.ok ? 0 : 1)
