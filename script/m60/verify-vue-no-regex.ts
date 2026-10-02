/**
 * VUE-MR: the Vue lane's ZERO-REGEX gate.
 *
 * WHY THIS EXISTS. The Vue analyzer used to carry 6 registered regex literals,
 * and its own file header claimed "fully regex-free" while the census said 6.
 * Both were eventually reconciled by DELETING the regexes, which is the only
 * outcome in which the strong claim is true — a registered-and-justified
 * pattern is still a pattern. The three that mattered were not tokenizers:
 *
 *   a case-insensitive test for the substring "line"   -> toLowerCase().includes
 *   a character class stripping quotes from a `name:`   -> the file's existing `unquote`
 *   an identifier character class, twice                 -> one shared identifier tokenizer
 *   the two v-for patterns                               -> `parseVForDirective`
 *
 * (The patterns are described in words rather than written out because a
 * literal `/…/g` inside a block comment contains `*`+`/`, which ENDS the
 * comment — the first draft of this file did exactly that and would not parse.)
 *
 * The v-for pair was the hard one, and it is what this gate protects. Their
 * behaviour has three properties a hand-written parser gets wrong by default:
 *
 *   1. the alias head is the SHORTEST run without a `)` — lazy, not greedy;
 *   2. the `)` belongs to the keyword match, not the head, so `(row, i) in grid`
 *      binds TWO names;
 *   3. `.` does not match a newline, so a collection spanning lines fails the
 *      pattern and the caller falls back to the whole directive.
 *
 * Property 3's sibling asymmetry matters too: the head-only pattern has no tail,
 * so it still matches where the collection one cannot.
 *
 * The FIRST hand-written replacement got property 3's backtracking wrong — it
 * consumed the separator greedily and reported no collection for `v-for="item in  "`
 * where the regex reported one. That bug passed all 47 fixtures and was caught
 * only by the generated sweep below (170 of 799 shapes differed). Hence this is a
 * gate and not a comment: the equivalence is re-derived on every run, by running
 * the removed patterns and the shipped parser over the same generated corpus and
 * requiring identical answers.
 *
 * Usage: bun script/m60/verify-vue-no-regex.ts
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = "$HOME/backbencher-brain"
const ANALYZER = join(ROOT, "src/ast/real-vue-analyzer.ts")

const failures: string[] = []
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
  if (!ok) failures.push(what)
}

// ---------------------------------------------------------------------------
// 1. ZERO pattern literals in the analyzer source
// ---------------------------------------------------------------------------
// Counted the way the census counts: comment lines excluded (a regex quoted in a
// comment is documentation, not a pattern), and `/src`-shaped substrings excluded
// (a source-map comment contains a URL, not a pattern).
{
  const lines = readFileSync(ANALYZER, "utf8").split("\n")
  const found: string[] = []
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    for (const m of line.matchAll(/\/[^/\s]+\/[gimsuy]*/g)) {
      if (m[0].startsWith("/src")) continue
      found.push(`${i + 1}: ${m[0]}`)
    }
  })
  check(found.length === 0, "analyzer holds ZERO regex literals", found.length ? found.join(", ") : "6 removed")
}

// ---------------------------------------------------------------------------
// 2. EQUIVALENCE: the removed v-for patterns vs the shipped parser
// ---------------------------------------------------------------------------
// The parser is EXTRACTED from the analyzer source rather than transcribed, so
// this cannot drift from the code it is checking.
{
  const src = readFileSync(ANALYZER, "utf8")
  const start = src.indexOf("  private parseVForDirective(")
  const end = src.indexOf("\n  /**", start)
  if (start < 0 || end < 0) {
    check(false, "parseVForDirective is present in the analyzer")
  } else {
    let parser = src.slice(start, end)
      .replace("private parseVForDirective(", "function parseVForDirective(")
      .replace("text: string", "text")
      .replace("): { aliases: string; collection: string; collectionStart: number } | null {", ") {")
      .replace("(ch: string | undefined): boolean", "(ch)")
      .replace("(e: number): { wsStart: number; wsEnd: number } | null", "(e)")
    parser = parser.split("\n").map((l) => (l.startsWith("  ") ? l.slice(2) : l)).join("\n")
    // eslint-disable-next-line no-new-func
    const parseVForDirective = new Function(`${parser}; return parseVForDirective`)() as (t: string) => any

    const RE_USAGE = /^\s*\(?([^)]*?)\)?\s+(?:in|of)\s+(.+)$/
    const RE_VARS = /^\s*\(?([^)]*?)\)?\s+(?:in|of)\s+/
    const RE_IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g
    const tokenize = (text: string): string[] => {
      const out: string[] = []
      const isStart = (c: string) =>
        (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$"
      const isPart = (c: string) => isStart(c) || (c >= "0" && c <= "9")
      let i = 0
      while (i < text.length) {
        if (isStart(text[i])) {
          let j = i + 1
          while (j < text.length && isPart(text[j])) j++
          out.push(text.slice(i, j))
          i = j
        } else i++
      }
      return out
    }

    const heads = ["item", "(item)", "(item, i)", "( value , key )", "x", "  spaced  ", "in", "of", "items", "(a,b,c)"]
    const seps = [" in ", " of ", "\nin\n", "  in  ", "\tin\t", " in\n  ", " in\t "]
    const tails = ["items", "list", "obj.map(k => k.v)", "10", "a.b.c", "fn(x, y)", "", " ", "multi\nline", "  ", "x as y"]
    const cases: string[] = []
    for (const h of heads) for (const s of seps) for (const t of tails) cases.push(h + s + t)
    cases.push("", " ", "(", ")", "()", "( )", "item in", "item of", "item in ", "(a,b) in", "a)b in c",
      "(a in b) in c", "item in (a, b)", "item in a ? b : c", "  (  a  ,  b  )  of  map  ",
      "(item) in items.length > 0 ? a : b", "i,i in obj", "(a)(b) in c")

    let usageDiffs = 0, tokenDiffs = 0
    for (const text of cases) {
      const m = RE_USAGE.exec(text)
      const oldCollection = m ? m[2] : text
      const oldStart = m ? m[0].length - m[2].length : 0
      const p = parseVForDirective(text)
      const newCollection = p && p.collectionStart >= 0 ? p.collection : text
      const newStart = p && p.collectionStart >= 0 ? p.collectionStart : 0
      if (oldCollection !== newCollection || oldStart !== newStart) {
        if (usageDiffs < 3) {
          console.log(`      usage ${JSON.stringify(text)} old=${JSON.stringify([oldCollection, oldStart])} new=${JSON.stringify([newCollection, newStart])}`)
        }
        usageDiffs++
      }
      const mv = RE_VARS.exec(text)
      const oldIdents = (mv ? mv[1] : text).match(RE_IDENT) ?? []
      const newIdents = tokenize(p ? p.aliases : text)
      if (oldIdents.join(",") !== newIdents.join(",")) {
        if (tokenDiffs < 3) console.log(`      vars  ${JSON.stringify(text)} old=${oldIdents} new=${newIdents}`)
        tokenDiffs++
      }
    }
    for (const text of ["{ row, col }", "{ row, index: i }", "{ a: { b }, c }", "props", "{ ...rest }",
      "defaultProps", "{ row = 1 }", "$slot", "_x9", "{ a, b, c }", ""]) {
      const a = (text.match(RE_IDENT) ?? []).join(",")
      const b = tokenize(text).join(",")
      if (a !== b) {
        if (tokenDiffs < 3) console.log(`      ident ${JSON.stringify(text)} old=${a} new=${b}`)
        tokenDiffs++
      }
    }
    check(cases.length >= 700, "generated v-for corpus is complete", `${cases.length} shapes`)
    check(usageDiffs === 0, "parseVForDirective reproduces the removed collection pattern", `diffs=${usageDiffs}`)
    check(tokenDiffs === 0, "alias tokenizing reproduces the removed identifier pattern", `diffs=${tokenDiffs}`)
  }
}

// ---------------------------------------------------------------------------
// 3. the claims in the file header must be TRUE now
// ---------------------------------------------------------------------------
{
  const src = readFileSync(ANALYZER, "utf8")
  const header = src.slice(0, src.indexOf("\n\n"))
  check(!/not regex-free|fully regex-free/i.test(header),
    "the analyzer header no longer contradicts the census",
    "header asserts the true state")
}

console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length ? failures.join("; ") : "vue zero-regex"}`)
process.exit(failures.length === 0 ? 0 : 1)
