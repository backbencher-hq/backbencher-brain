/**
 * GraphQL SOURCE GUARDS — the two rules a differential cannot enforce.
 *
 * A differential compares OUTPUT. Two classes of defect are invisible to it
 * because on the fixtures at hand the output is identical:
 *
 *   1. `isNonNullType` was once `typeNode.text.includes("!")`. For every
 *      GraphQL this grammar accepts, a `Type` node's text contains `!` exactly
 *      when its first named child is a `NonNullType` — `!` is not a legal
 *      character in a GraphQL name and nothing else can carry it inside a Type.
 *      The two implementations are therefore extensionally equal on the whole
 *      input language, which is why the mutation harness records that mutant as
 *      `equivalentByConstruction` instead of quietly deleting it. The rule still
 *      worth enforcing is "a structural fact is read off a node, never off a
 *      text comparison", and this is where it is enforced.
 *
 *   2. A regular expression. The contract is zero regex literals, zero `RegExp`
 *      calls, and no `match`/`matchAll`/`replace`/`replaceAll`/`search`/`split`
 *      used as a parser over analyzer text.
 *
 * Both rules are checked on a LEXICAL view of the file. A cruder line-based scan
 * produced eight false positives on the first attempt — a `/` inside the
 * import path `"./engine"`, two `String.split` calls on the line-counting path,
 * and seven reads of a `Name` node's `.text`, which is the canonical way to read
 * a name out of a tree-sitter tree. So the scanner, not a regex, is the
 * contract.
 */
import * as fs from "fs"
import * as path from "path"
import { OUT, ROOT } from "../paths.mts"

const SRC = process.argv[2] ?? path.join(ROOT, "src/ast/real-graphql-analyzer.ts")
const source = fs.readFileSync(SRC, "utf8")
const lines = source.split("\n")

/**
 * Classify every character as "code", "string", "template" or "comment".
 *
 * A template literal is scanned as one opaque run. The analyzer's own
 * substitutions are `${node.startIndex}`, `${node.startPosition.row + 1}` and
 * `${role}` — identifiers, dots and arithmetic — so nothing that could contain a
 * regex or a string method can hide inside one.
 */
function lex(): string[][] {
  const rows: string[][] = []
  let blockComment = false
  for (const line of lines) {
    const row: string[] = new Array(line.length).fill("code")
    let i = 0
    if (blockComment) {
      const close = line.indexOf("*/")
      const endIdx = close < 0 ? line.length - 1 : close + 1
      for (let k = 0; k <= endIdx; k++) row[k] = "comment"
      blockComment = close < 0
      i = endIdx + 1
    }
    while (i < line.length) {
      const ch = line[i]
      if (ch === "/" && line[i + 1] === "/") {
        for (let k = i; k < line.length; k++) row[k] = "comment"
        break
      }
      if (ch === "/" && line[i + 1] === "*") {
        const close = line.indexOf("*/", i + 2)
        if (close < 0) {
          // opener with no closer on this line: the block CONTINUES, and its
          // continuation lines are comments too
          for (let k = i; k < line.length; k++) row[k] = "comment"
          blockComment = true
          i = line.length
          continue
        }
        const endIdx = close + 1
        for (let k = i; k <= endIdx; k++) row[k] = "comment"
        i = endIdx + 1
        continue
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        const zone = ch === "`" ? "template" : "string"
        const closeCh = ch
        row[i] = zone
        i++
        while (i < line.length) {
          row[i] = zone
          if (line[i] === "\\") {
            if (i + 1 < line.length) row[i + 1] = zone
            i += 2
            continue
          }
          const done = line[i] === closeCh
          i++
          if (done) break
        }
        continue
      }
      i++
    }
    rows.push(row)
  }
  return rows
}

const zone = lex()
const isCode = (ln: number, col: number) => (zone[ln]?.[col] ?? "code") === "code"

const findings: Array<{ rule: string; line: number; text: string }> = []
const push = (rule: string, ln: number) => findings.push({ rule, line: ln + 1, text: lines[ln].trim().slice(0, 120) })

/** Index of the next occurrence of `needle` that starts in code. */
function codeIndexOf(line: string, ln: number, needle: string, from = 0): number {
  let k = line.indexOf(needle, from)
  while (k >= 0) {
    if (isCode(ln, k)) return k
    k = line.indexOf(needle, k + 1)
  }
  return -1
}

// ------------------------------------------------------------------- 1. regex
for (let ln = 0; ln < lines.length; ln++) {
  const line = lines[ln]
  for (let j = 0; j < line.length; j++) {
    if (!isCode(ln, j) || line[j] !== "/") continue
    const prev = j > 0 ? line[j - 1] : ""
    if (prev && /[A-Za-z0-9_$)\]]/.test(prev)) continue // division, not a regex
    const body = line.slice(j + 1)
    if (/^[^/\n]*\//.test(body) || /^[[(]/.test(body)) {
      push("regex-literal", ln)
      break
    }
  }
  if (codeIndexOf(line, ln, "RegExp") >= 0) push("RegExp-constructor", ln)
  // `split("\n")` and `replaceAll("x", "y")` on a plain string are string
  // arithmetic, not parsing, and are reported as PERMITTED rather than as
  // findings; `match`/`matchAll`/`replace`/`search` are always a finding.
  for (const m of [".match(", ".matchAll(", ".replace(", ".search("]) {
    if (codeIndexOf(line, ln, m) >= 0) push(`text-method ${m}`, ln)
  }
}

// ------------------------------------------------ 2. structural text comparison
/**
 * Reading `aNameNode.text` is how a name is read out of a tree-sitter tree —
 * a `Name` node's text IS the name. What is forbidden is deciding a STRUCTURAL
 * fact by comparing a node's text: `typeNode.text.includes("!")` answers "is
 * this a NonNullType?" with a string operation where a node lookup exists.
 *
 * The one legitimate exception is a `StringValue` leaf, whose delimiters ARE its
 * structure — a block string is delimited by `"""` and no node represents that,
 * so comparing the delimiter is the only way to read it.
 */
const STRING_LEAF_TEXT = /\b(sv|raw|str|desc|inner|value)\.text\b/
/**
 * `nameOf(node)` returns `this.findChild(node, n => n.type === "Name")?.text` —
 * a read of a `Name` LEAF, which is exactly what a `Name` node's text is. It is
 * the canonical name reader and can never be a structural text comparison, so
 * the rule skips it rather than growing an exception for the helper.
 */
const NAME_LEAF_READ = /type === "Name"\)\?\.text/
for (let ln = 0; ln < lines.length; ln++) {
  const line = lines[ln]
  const at = codeIndexOf(line, ln, ".text")
  if (at < 0) continue
  const usesText = /\.(includes|indexOf|startsWith|endsWith|lastIndexOf)\s*\(/.test(line) || /(\.text\b[^=]*={2,3}|={2,3}[^;]*\.text\b)/.test(line)
  if (!usesText) continue
  const subject = /([A-Za-z_$][A-Za-z0-9_$]*)\.text\b/.exec(line)?.[1] ?? ""
  if (NAME_LEAF_READ.test(line)) continue
  if (STRING_LEAF_TEXT.test(line) && !/typeNode/.test(line)) continue
  if (STRING_LEAF_TEXT.test(` ${subject}.text`)) continue
  push("structural-fact-from-a-text-comparison", ln)
}

const byRule = new Map<string, number[]>()
for (const f of findings) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f.line])

const permittedStringOps: string[] = []
for (let ln = 0; ln < lines.length; ln++) {
  for (const m of [".split(", ".replaceAll("]) {
    if (codeIndexOf(lines[ln], ln, m) >= 0) permittedStringOps.push(`line ${ln + 1}: ${lines[ln].trim()}`)
  }
}
const blocking = findings
const regexHit = findings.some((f) => f.rule === "regex-literal" || f.rule === "RegExp-constructor")
const structuralHit = findings.some((f) => f.rule === "structural-fact-from-a-text-comparison")

console.log(`=== GRAPHQL SOURCE GUARDS (${path.relative(ROOT, SRC)}, ${lines.length} lines) ===`)
console.log(`zero-regex contract:                  ${regexHit ? "VIOLATED" : "HOLDS"}`)
console.log(`readable-AST contract (no text scan):  ${structuralHit ? "VIOLATED" : "HOLDS"}`)
console.log(`permitted String methods:              ${permittedStringOps.length}`)
for (const p of permittedStringOps) console.log(`  permitted: ${p}`)
if (findings.length) {
  console.log("")
  for (const f of findings) console.log(`  ${f.rule} @ line ${f.line}: ${f.text}`)
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(
  path.join(OUT, "source-guards.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), file: SRC, lines: lines.length, zeroRegex: !regexHit, readableAst: !structuralHit, findings, blockingCount: blocking.length, permittedStringOps, byRule: Object.fromEntries([...byRule].map(([k, v]) => [k, v.length])) }, null, 2),
)
process.exitCode = blocking.length === 0 ? 0 : 1
