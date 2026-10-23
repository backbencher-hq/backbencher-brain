#!/usr/bin/env bun
/**
 * SVELTE — the CONTROL ARM for the three regex replacements.
 *
 * `no-regex-gate.sh` forbids regex in analyzers because a regex over source text matches
 * comments and string literals, misses nested syntax, and breaks silently on the next grammar
 * version. The three checks it replaced in `real-svelte-analyzer.ts` were STRING tests, and the
 * risk of a hand-written replacement is that it is NARROWER than the pattern it replaced —
 * which no fixture can catch, because the claims path (`publishResolutionClaims`) returns early
 * without a `projectRoot` and the fixture runner passes none. So the replacements are proved
 * directly, on the same cases the patterns decided, and the empty-segment case the lead named
 * is asserted explicitly rather than inspected.
 *
 * This is not a measurement of the corpus and writes nothing: PASS/FAIL arms, exit 3 on any
 * disagreement. `isDottedIdentifierChain` is the one most likely to be got wrong by hand, so
 * its cases include a single segment (valid), the dotted chain (valid), and EVERY shape of
 * empty segment (invalid).
 */
import { containsWhitespace, isDottedIdentifierChain, isUriSchemeSpecifier } from "../../src/ast/real-svelte-analyzer"

let pass = 0
let fail = 0
const check = (arm: string, got: boolean, want: boolean): void => {
  if (got === want) {
    pass++
  } else {
    fail++
    console.error(`  FAIL ${arm}: got ${got}, want ${want}`)
  }
}
const fn = (name: string): void => console.log(`\n${name}`)

// ── 1 · /\s/ — the ECMAScript WhiteSpace + LineTerminator set, refusing a specifier
fn("containsWhitespace — the same accept set as JS \\s (including the Unicode members)")
for (const [s, want] of [
  ["", false],
  ["lodash", false],
  ["@scope/pkg", false],
  ["a.b/c-d+e", false],
  [" ", true],
  ["\t", true],
  ["\n", true],
  ["\v", true],
  ["\f", true],
  ["\r", true],
  ["\u00a0", true], // NBSP
  ["\u1680", true], // ogham space mark
  ["\u2000", true], // en quad ... U+2000–U+200A
  ["\u200a", true],
  ["\u2028", true], // line separator
  ["\u2029", true], // paragraph separator
  ["\u202f", true], // narrow no-break space
  ["\u205f", true], // medium mathematical space
  ["\u3000", true], // ideographic space
  ["\ufeff", true], // BOM / zero-width no-break space
  ["\u200b", false], // ZERO WIDTH SPACE is NOT \\s — must stay accepted
] as Array<[string, boolean]>) {
  check(`containsWhitespace(${JSON.stringify(s)})`, containsWhitespace(s), want)
}

// ── 2 · /^[a-zA-Z][a-zA-Z0-9+.-]*:/ — a URI scheme
fn("isUriSchemeSpecifier — head then colon, letter first")
for (const [s, want] of [
  ["virtual:", true],
  ["http:", true],
  ["data:", true],
  ["a+b.c-d:", true],
  ["a:", true],
  ["A:", true],
  ["", false],
  ["a", false], // no colon
  [":x", false], // empty head
  ["1abc:", false], // head must START with a letter
  ["a_b:", false], // underscore is not in the accept set
  ["a b:", false], // space is not in the accept set
  ["a/b:", false], // slash is not in the accept set
  ["C:\\x", true], // 'C:' IS a scheme by this pattern; the backslash refusal runs first
] as Array<[string, boolean]>) {
  check(`isUriSchemeSpecifier(${JSON.stringify(s)})`, isUriSchemeSpecifier(s), want)
}

// ── 3 · the dotted identifier chain — the empty-segment case the lead named
fn("isDottedIdentifierChain — single segment valid, EMPTY segment invalid")
for (const [s, want] of [
  ["Icon", true],
  ["AccordionPrimitive.Root", true],
  ["Card.Root.Content", true],
  ["$_x.y$1", true],
  ["a1.b2", true],
  ["", false],
  [".", false],
  [".a", false], // EMPTY first segment
  ["a.", false], // EMPTY last segment
  ["a..b", false], // EMPTY middle segment  ← the case a hand-written loop gets wrong
  ["a.b..c", false],
  ["a b", false], // whitespace is not an identifier character
  ["1a", false], // segment must START with a letter/_/$
  ["a-b", false], // '-' is not an identifier character
  ["A.ü", false], // non-ASCII is outside [A-Za-z_$]
] as Array<[string, boolean]>) {
  check(`isDottedIdentifierChain(${JSON.stringify(s)})`, isDottedIdentifierChain(s), want)
}

console.log(`\nsvelte identifier-check control arm: ${pass} PASS · ${fail} FAIL`)
if (fail > 0) {
  console.error("FAIL — a replacement does not decide the same cases the regex decided.")
  process.exit(3)
}
console.log("PASS — the three string tests were replaced without narrowing their accept sets.")
