/**
 * JULIA LANE — text helpers with no regex in them.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The lane brief forbids regex in the analyzer, in a census script and in an oracle, on the ground
 * that regex over source text matches comments and string literals, misses nested syntax and
 * breaks silently on the next grammar version. The census needed two things a regex was doing, and
 * both are LEXICAL questions about one specific input — the analyzer's own TypeScript — rather than
 * pattern questions about julia source:
 *
 *   1. collapse a node's layout so two spellings of the same declaration compare equal (`f( x )` and
 *      `f(x)` are ONE method to julia, so the `overrides` signature key must be indifferent to it);
 *   2. read the string literals out of `src/ast/real-julia-analyzer.ts` so instrument A' can ask
 *      which node types the analyzer claims, without counting a name that appears only in prose.
 *
 * (2) is the only place a scanner rather than a parser is defensible, and it is defensible only
 * because the input is TypeScript and never julia. A scanner is written here rather than a pattern
 * because "a `//` inside a template literal is not a comment" is a loop, and as a pattern it is a
 * nested-quantifier argument.
 *
 * DECLARED LIMITATION OF THE SCANNER
 * ----------------------------------
 * It is a lexical scanner, not a TypeScript parser. It handles line comments, block comments, single
 * and double quoted strings, template literals with `${ … }` interpolation, and it does NOT attempt
 * to disambiguate a `/` that opens a regex literal from a `/` that is division. The input has no
 * division expression, so nothing in it depends on that case. The number the scanner feeds is
 * printed on every census run — "45 node-type claims, 0 unknown" — so a change in its behaviour is
 * visible in the output rather than inferred from a count that quietly moved.
 */

export function collapseSpace(text: string): string {
  const words: string[] = []
  let word = ""
  for (const ch of text) {
    if (ch.trim() === "") {
      if (word) { words.push(word); word = "" }
    } else {
      word += ch
    }
  }
  if (word) words.push(word)
  return words.join(" ")
}

/** The segments of a dotted path, or `null` when the text is not dotted. */
export function pathSegments(text: string): string[] | null {
  const parts = text.split(".")
  return parts.length > 1 ? parts : null
}

// ---------------------------------------------------------------- lexical scanner

type Span = { kind: "code" | "comment" | "string" | "template"; start: number; text: string }

/**
 * Split source into alternating code and non-code spans, each carrying its offset in the full text.
 *
 * A loop rather than a pattern, because the case that makes this hard — a comment marker inside a
 * string, a template inside a template, a `}` closing an interpolation that is not the template — is
 * a case a loop gets right by construction and a pattern gets right by being long.
 */
export function lex(src: string): Span[] {
  const out: Span[] = []
  let codeStart = 0
  let code = ""
  let i = 0
  const openCode = () => { codeStart = i; code = "" }
  const closeCode = () => { if (code) out.push({ kind: "code", start: codeStart, text: code }) }
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === "//" || two === "/*") {
      closeCode()
      let j: number
      if (two === "//") {
        j = src.indexOf("\n", i)
        j = j < 0 ? src.length : j
      } else {
        const end = src.indexOf("*/", i + 2)
        j = end < 0 ? src.length : end + 2
      }
      out.push({ kind: "comment", start: i, text: src.slice(i, j) })
      i = j
      openCode()
      continue
    }
    const ch = src[i]!
    if (ch === '"' || ch === "'") {
      closeCode()
      let j = i + 1
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue }
        if (src[j] === ch) { j++; break }
        if (src[j] === "\n") break
        j++
      }
      out.push({ kind: "string", start: i, text: src.slice(i, j) })
      i = j
      openCode()
      continue
    }
    if (ch === "`") {
      closeCode()
      let j = i + 1
      let depth = 0
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue }
        if (src[j] === "`" && depth === 0) { j++; break }
        if (src[j] === "$" && src[j + 1] === "{") { depth++; j += 2; continue }
        if (src[j] === "}" && depth > 0) { depth--; j++; continue }
        j++
      }
      out.push({ kind: "template", start: i, text: src.slice(i, j) })
      i = j
      openCode()
      continue
    }
    code += ch
    i++
  }
  closeCode()
  return out
}

/**
 * Source with every COMMENT and TEMPLATE LITERAL blanked, so offsets hold and the result reads as
 * one line-preserving string.
 *
 * STRING LITERALS ARE KEPT, and that is not an oversight — they are the payload. Instrument A' asks
 * "which node types does this analyzer claim?", and a node-type claim IS a string literal
 * (`n.type === "identifier"`), so blanking strings answers the question with zero every time. A first
 * version of this function blanked them along with the comments and the census dutifully reported
 * "node-type CLAIMS: 0, NOT produced: 0" — an entirely fictional clean bill of health, from a
 * gate that had stopped looking at anything. The regression that mattered was not the count being
 * wrong; it was the count being zero and reading as a pass.
 *
 * A `//` inside a kept string is still not a comment, because `lex` consumes whole string spans before
 * it ever looks for a comment marker inside them.
 */
export function codeOnly(src: string): string {
  const spans = lex(src)
  let out = ""
  for (const s of spans) {
    out += s.kind === "comment" || s.kind === "template" ? " ".repeat(s.text.length) : s.text
  }
  return out
}

/** The 1-based line of an offset. */
export function lineAt(src: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line++
  return line
}

/** Every offset in the CODE spans of `src` at which `needle` begins. */
export function findInCode(src: string, needle: string): number[] {
  const hits: number[] = []
  for (const span of lex(src)) {
    if (span.kind !== "code") continue
    let at = span.text.indexOf(needle)
    while (at >= 0) {
      hits.push(span.start + at)
      at = span.text.indexOf(needle, at + needle.length)
    }
  }
  return hits
}


// ---------------------------------------------------------------- node-type claims (instrument A')
//
// The three positions in which a string literal in an analyzer IS a claim about a grammar node type,
// and nowhere else. This list is the whole definition of "claim", and it is the part that has to be
// narrow: an earlier version of this census extracted EVERY snake_case literal in the analyzer and
// accused 32 names, of which 30 were relationship-type names, evidence-class names and
// `IMPLICIT_OR_CONSTANT` members — none of which claims to be a node. A false accusation is as
// useless as a missed one, so the extraction below is positional rather than lexical.

export type NodeTypeClaim = { name: string; line: number; shape: string }

const COMPARISON_OPERATORS = ["===", "!==", "==", "!="]

export type ClaimScan = { claims: NodeTypeClaim[]; warnings: string[] }

/**
 * Every node-type claim in a TypeScript source, read from the three shapes:
 *
 *   1. `X.type === "literal"` / `!==` / `==` / `!=` — a node-type COMPARISON
 *   2. `firstNamedChildOfType(<expr>, "literal")` — a lookup's type argument
 *   3. the literals inside `new Set([ … ])` of a named `const`, for the caller-named node-type Sets
 *
 * Shape 1 requires the operator, because `.type` also appears as a bare read (`map(c => c.type)`) and
 * taking the next literal on the line would then attribute an unrelated string to the grammar.
 */
export function scanNodeTypeClaims(src: string, nodeTypeSetNames: string[]): ClaimScan {
  const code = codeOnly(src)
  const claims: NodeTypeClaim[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const add = (name: string, at: number, shape: string) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    claims.push({ name, line: lineAt(src, at), shape })
  }

  // 1. node-type COMPARISON. `.type` then an operator then a literal.
  for (const at of findInCode(code, ".type")) {
    let i = at + ".type".length
    while (i < code.length && code[i] === " ") i++
    const op = COMPARISON_OPERATORS.find((o) => code.startsWith(o, i))
    if (!op) continue
    i += op.length
    while (i < code.length && code[i] === " ") i++
    if (code[i] !== '"') continue
    const lit = readQuoted(code, i)
    if (lit) add(lit.value, lit.offset, ".type comparison")
  }

  // 2. lookup type argument — the LAST literal in the call's parentheses, so a node-type string that
  // is an argument cannot be confused with one that is part of the expression.
  for (const at of findInCode(code, "firstNamedChildOfType(")) {
    let depth = 1
    let i = at + "firstNamedChildOfType(".length
    let last: { value: string; offset: number } | null = null
    while (i < code.length && depth > 0) {
      const ch = code[i]!
      if (ch === "(") depth++
      else if (ch === ")") { depth--; if (depth === 0) break }
      else if (ch === '"') {
        const lit = readQuoted(code, i)
        if (lit) { last = lit; i = lit.offset + lit.rawLength; continue }
      }
      i++
    }
    if (last) add(last.value, last.offset, "firstNamedChildOfType argument")
  }

  // 3. node-type Sets, located BY NAME.
  for (const setName of nodeTypeSetNames) {
    const declAt = findInCode(code, `const ${setName}`)[0]
    if (declAt === undefined) { warnings.push(`node-type Set not located by name: ${setName} — its literals are NOT counted`); continue }
    const openAt = findInCode(code, "new Set([").filter((o) => o > declAt)[0]
    if (openAt === undefined) { warnings.push(`new Set([ not located after const ${setName}`); continue }
    const closeAt = findInCode(code, "])").filter((o) => o > openAt)[0]
    if (closeAt === undefined) { warnings.push(`]) not located for ${setName}`); continue }
    let i = openAt + "new Set([".length
    while (i < closeAt) {
      if (code[i] !== '"') { i++; continue }
      const lit = readQuoted(code, i)
      if (!lit) { i++; continue }
      add(lit.value, lit.offset, `member of ${setName}`)
      i = lit.offset + lit.rawLength
    }
  }
  return { claims, warnings }
}

function readQuoted(code: string, at: number): { value: string; offset: number; rawLength: number } | null {
  let raw = ""
  let j = at + 1
  while (j < code.length && code[j] !== '"') {
    if (code[j] === "\\") { raw += code[j]! + (code[j + 1] ?? ""); j += 2; continue }
    if (code[j] === "\n") return null
    raw += code[j]
    j++
  }
  if (j >= code.length) return null
  return { value: raw, offset: at, rawLength: j + 1 - at }
}
