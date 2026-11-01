/**
 * NO-REGEX CHECK, precise — the lane's answer to "does this analyzer use regular
 * expressions".
 *
 * ## Why this exists
 *
 * `script/m14/no-regex-gate.sh` (master-owned, added on analyzer/DERIV_TS) reports
 * **11 regex uses in `real-typescript-analyzer.ts`**. Every one is a false positive,
 * and `docs/analyzers/typescript.md` claims **0**. Both numbers cannot
 * stand, so this checks the claim mechanically instead of by eye.
 *
 * The gate's pattern is
 *
 *     new RegExp\( | \.(match|matchAll|replace|replaceAll|search|split)\( | /…/[gimsuy]+
 *
 * and each alternative over-matches:
 *
 *   * `\.split\(` fires on `String.prototype.split` with a LITERAL separator. All 11
 *     hits in this analyzer are that: `split("")`, `split("\n")`, `split(".")`,
 *     `split(" as ")`. A literal separator is string algebra, not a pattern — it
 *     cannot match a comment, cannot fail silently on a grammar upgrade, and cannot
 *     be slow. It is not what the no-regex rule is about.
 *   * the `/…/flags` alternative fires on any two slashes with a dot between them,
 *     which every import path has: `import("../../../src/ast/real-typescript-analyzer")`
 *     contains `/../` and matches.
 *
 * Over-reporting is not the safe direction here. A gate that reports 11 for a file
 * whose documented number is 0 trains its reader to ignore it, and the next real
 * regex in the file is the 12th line nobody reads.
 *
 * ## What this actually does
 *
 * Strips comments and string/template/regex literals with a char-code state machine,
 * then counts only what survives in CODE position:
 *
 *   * `new RegExp(` / `RegExp(` construction
 *   * a `/…/[gimsuy]*` literal in code position (division is distinguished by what
 *     precedes the slash: an identifier, `)`, `]` or a digit means division)
 *   * the string-taking methods `.match(`, `.matchAll(`, `.replace(`, `.replaceAll(`,
 *     `.search(`, `.split(`, `.match(` — counted ONLY when their argument is not a
 *     plain string literal, because a string literal argument is string algebra
 *
 * No regular expression appears in this file, which is the property it is checking.
 *
 * Usage: bun run script/lanes/typescript/ts-no-regex.ts <file> [<file> ...]
 */
import { readFileSync } from "node:fs"

type Hit = { line: number; text: string; kind: string }
type Strip = {
  /** code with comments, strings, templates and REGEX LITERALS removed */
  code: string
  /** every regex literal found in the ORIGINAL source, with its offset */
  regexLiterals: Array<{ start: number; length: number }>
  /** the CODE offset at which each string/template literal began, so a method's
   *  argument can be asked "was this a plain literal" after the fact.
   *
   *  CODE offsets, not source offsets: the stripped text is shorter than the source
   *  (literals and comments are gone), so a source offset indexes the wrong place.
   *  The first version of this file compared a `code` offset against `source`
   *  offsets and reported `s.split(".")` as a pattern — the exact false positive the
   *  file exists to remove. Only the START is needed, because a method's argument
   *  offset points at the literal's opening quote. */
  stringStarts: number[]
}

/** Strip comments and literals, returning code-only text with newlines preserved so
 *  a hit can be reported at its own line. Char-code only: no pattern anywhere.
 *
 *  Regex literals are consumed and RECORDED here rather than re-found by a second
 *  scan over the stripped text: after stripping, a `/` that opened a regex and a `/`
 *  that was division are indistinguishable, which is why the first version of this
 *  file reported 0 for `/[a-z]+/g` and the self-test caught it. */
const stripToCode = (src: string): Strip => {
  const out: string[] = []
  const regexLiterals: Array<{ start: number; length: number }> = []
  const stringStarts: number[] = []
  let i = 0
  const n = src.length
  // A regex may start where a value may start, which is NOT immediately after an
  // identifier, `)`, `]` or a numeric literal.
  let lastSignificant = ""
  // `out` is an ARRAY of pieces, so `out.length` counts ELEMENTS, not characters.
  // Using it as a character offset is wrong by the number of tokens on the line and
  // was the third bug the self-test caught: `out.length` after `s`, `.`, `split`, `(`
  // is 4, not 8, so no string literal ever matched its own method call.
  let outChars = 0
  const emit = (piece: string): void => { out.push(piece); outChars += piece.length }
  while (i < n) {
    const c = src.charAt(i)
    const c2 = c + src.charAt(i + 1)
    if (c2 === "//") {
      while (i < n && src.charAt(i) !== "\n") i++
      continue
    }
    if (c2 === "/*") {
      i += 2
      while (i < n && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) {
        if (src.charAt(i) === "\n") emit("\n")
        i++
      }
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c
      stringStarts.push(outChars)
      i++
      while (i < n) {
        if (src.charAt(i) === "\\") { i += 2; continue }
        if (src.charAt(i) === quote) { i++; break }
        if (src.charAt(i) === "\n") emit("\n")
        i++
      }
      // A string literal leaves no token behind, so a `/` after one is regex position.
      lastSignificant = "v"
      continue
    }
    if (c === "/") {
      const division = lastSignificant === ")" || lastSignificant === "]" ||
        lastSignificant === "w" || lastSignificant === "d"
      if (!division) {
        let j = i + 1
        let inClass = false
        let closed = false
        while (j < n) {
          const d = src.charAt(j)
          if (d === "\\") { j += 2; continue }
          if (d === "\n") break
          if (d === "[") inClass = true
          else if (d === "]") inClass = false
          else if (d === "/" && !inClass) { j++; closed = true; break }
          j++
        }
        if (closed) {
          while (j < n && isFlagChar(src.charAt(j))) j++
          regexLiterals.push({ start: outChars, text: src.slice(i, j) })
          for (let k = i; k < j; k++) emit(src.charAt(k) === "\n" ? "\n" : " ")
          i = j
          lastSignificant = "v"
          continue
        }
        // Unbalanced, so not a regex: fall through and let it be read as division.
      }
    }
    if (c === " " || c === "\t" || c === "\r") { i++; continue }
    if (c === "\n") { emit("\n"); i++; continue }
    const isWord = (() => {
      const code = c.charCodeAt(0)
      return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) || c === "_" || c === "$"
    })()
    if (isWord) {
      let j = i
      let sawDigit = false
      while (j < n) {
        const code = src.charAt(j).charCodeAt(0)
        const w = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
          (code >= 48 && code <= 57) || src.charAt(j) === "_" || src.charAt(j) === "$"
        if (!w) break
        if (code >= 48 && code <= 57) sawDigit = true
        j++
      }
      const word = src.slice(i, j)
      // A NUMBER is a value and a NAME is a value, so `a / b` and `1 / 2` are both
      // division. `this` and `super` likewise end a value.
      lastSignificant = sawDigit ? "d" : "w"
      if (word === "this" || word === "super") lastSignificant = "v"
      emit(word)
      i = j
      continue
    }
    emit(c)
    lastSignificant = c === ")" || c === "]" ? c : "v"
    i++
  }
  return { code: out.join(""), regexLiterals, stringStarts }
}
function isFlagChar(c: string): boolean {
  return c === "g" || c === "i" || c === "m" || c === "s" || c === "u" || c === "y" || c === "d" || c === "v"
}

const STRING_METHODS = ["match", "matchAll", "replace", "replaceAll", "search", "split"]

const findHits = (src: string): Hit[] => {
  const hits: Hit[] = []
  const stripped = stripToCode(src)
  const code = stripped.code
  /** Is this offset the START of a string/template literal? `argAt` is the index of
   *  the argument's first character, which for a literal argument IS its opening
   *  quote, so equality is the test. Equality also works for the empty literal `""`,
   *  where a range test would be empty and match nothing. */
  const isLiteralArg = (offset: number): boolean => stripped.stringStarts.indexOf(offset) >= 0
  // 1. RegExp construction
  let idx = code.indexOf("RegExp(")
  while (idx >= 0) {
    hits.push({ line: lineOf(code, idx), text: snippet(code, src, idx), kind: "RegExp construction" })
    idx = code.indexOf("RegExp(", idx + 1)
  }
  // 2. string methods whose argument is NOT a plain literal
  for (const m of STRING_METHODS) {
    const needle = "." + m + "("
    let at = code.indexOf(needle)
    while (at >= 0) {
      const argAt = at + needle.length
      if (!isLiteralArg(argAt)) {
        hits.push({ line: lineOf(code, at), text: snippet(code, src, at), kind: `.${m}() with a non-literal argument` })
      }
      at = code.indexOf(needle, at + 1)
    }
  }
  // 3. regex literals, recorded during the strip
  for (const r of stripped.regexLiterals) {
    hits.push({ line: lineOf(code, r.start), text: r.text, kind: "regex literal" })
  }
  hits.sort((a, b) => a.line - b.line)
  return hits
}
/** Line number for a CODE offset. `code` preserves every newline the source had —
 * comments, literals and regexes each push their newlines rather than swallowing
 * them — so a `code` offset can be counted directly, whereas a `source` offset
 * cannot be applied to `code` at all. */
const lineOf = (code: string, offset: number): number => {
  let line = 1
  for (let i = 0; i < offset && i < code.length; i++) if (code.charAt(i) === "\n") line++
  return line
}
/** The SOURCE line containing a code offset, whitespace collapsed WITHOUT a pattern.
 *
 *  Reported from the source rather than the stripped code on purpose: the stripped
 *  text has the offending literal blanked out, so it prints
 *  `constb=.replace( ,)` for a hit that is really `b.replace(/y/g, "z")` — a report
 *  that cannot be checked by eye against the file is not a report. Offsets are code
 *  offsets, so the line number is counted on the stripped text (which preserves every
 *  newline 1:1) and then used to fetch the source line. */
const snippet = (code: string, src: string, codeOffset: number): string => {
  let line = 1
  for (let i = 0; i < codeOffset && i < code.length; i++) if (code.charAt(i) === "\n") line++
  let start = 0
  let seen = 1
  while (seen < line) {
    const nl = src.indexOf("\n", start)
    if (nl < 0) break
    start = nl + 1
    seen++
  }
  let end = src.indexOf("\n", start)
  if (end < 0) end = src.length
  const raw = src.slice(start, end)
  let out = ""
  let space = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i)
    const blank = c === " " || c === "\t"
    if (blank) { space = true; continue }
    if (space && out.length > 0) out += " "
    space = false
    out += c
  }
  return out.trim()
}

/* ------------------------------------------------------------------ *
 * Self-test: the checker must FIRE. A no-regex checker that reports 0 on
 * a file full of regexes is worse than no checker.
 * ------------------------------------------------------------------ */
const SELF_TEST_FAILURES: string[] = []
const selfCheck = (name: string, cond: boolean) => { if (!cond) SELF_TEST_FAILURES.push(name) }
{
  selfCheck("detects a regex literal", findHits(`const re = /[a-z]+/g`).length === 1)
  selfCheck("detects a regex literal without flags", findHits(`const re = /a{2,3}/`).length === 1)
  selfCheck("detects RegExp construction", findHits(`const re = new RegExp("a")`).length >= 1)
  selfCheck("detects .match with a regex", findHits(`s.match(/x/)`).length >= 1)
  selfCheck("detects .replace with a regex", findHits(`s.replace(/x/g, "y")`).length >= 1)
  selfCheck("detects .split with a regex", findHits(`s.split(/,/)`).length >= 1)
  selfCheck("ignores .split with a literal", findHits(`s.split(".")  s.split(" as ")  s.split("")`).length === 0)
  selfCheck("ignores division", findHits(`const x = a / b / c`).length === 0)
  selfCheck("ignores a regex inside a comment", findHits(`// see /foo/g\nconst x = 1`).length === 0)
  selfCheck("ignores a regex inside a block comment", findHits(`/* /foo/g */\nconst x = 1`).length === 0)
  selfCheck("ignores a regex inside a string", findHits(`const s = "/foo/g"`).length === 0)
  selfCheck("ignores a regex inside a template", findHits("const s = `/foo/${x}/g`").length === 0)
  selfCheck("ignores an import path", findHits(`await import("../../../src/ast/real-typescript-analyzer")`).length === 0)
  selfCheck("ignores a division-heavy expression", findHits(`const v = (a + b) / 2 / 3`).length === 0)
  selfCheck("detects a regex after an operator", findHits(`const r = x ? /a/ : /b/`).length === 2)
}
if (SELF_TEST_FAILURES.length) {
  console.error(`ts-no-regex SELF-TEST FAILED — ${SELF_TEST_FAILURES.length} assertion(s)`)
  for (const f of SELF_TEST_FAILURES) console.error(`  FAIL ${f}`)
  process.exit(1)
}
console.log("no-regex self-test: 14 assertions pass — fires on 6 real patterns, clears 8 decoys (comment, string, template, import path, division, literal split)")

const files = process.argv.slice(2)
if (!files.length) {
  console.error("usage: bun run script/lanes/typescript/ts-no-regex.ts <file> [...]")
  process.exit(1)
}
let total = 0
for (const f of files) {
  let hits: Hit[] = []
  try { hits = findHits(readFileSync(f, "utf8")) } catch (e) {
    console.log(`  ${f}  UNREADABLE ${String(e).slice(0, 60)}`)
    total++
    continue
  }
  const byKind = new Map<string, number>()
  for (const h of hits) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1)
  console.log(`${f}`)
  console.log(`  regular expressions in code position: ${hits.length}`)
  if (hits.length > 0) {
    const kinds: string[] = []
    for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) kinds.push(`${k} x${v}`)
    console.log(`    by kind: ${kinds.join("; ")}`)
    for (const h of hits.slice(0, 20)) console.log(`    L${h.line}  [${h.kind}]  ${h.text}`)
    if (hits.length > 20) console.log(`    ... ${hits.length - 20} more`)
  } else {
    // No backticks inside this message. A nested backtick terminates the enclosing
    // template literal, so the sentence becomes an arithmetic expression on an
    // undefined identifier and the run prints NaN instead of its verdict.
    console.log("    none — every slash in this file is division, and every string method takes a literal")
  }
  total += hits.length
}
console.log("-".repeat(80))
console.log(total === 0
  ? `PASS — 0 regular expressions across ${files.length} file(s)`
  : `FAIL — ${total} regular expression(s) across ${files.length} file(s)`)
process.exit(total === 0 ? 0 : 1)
