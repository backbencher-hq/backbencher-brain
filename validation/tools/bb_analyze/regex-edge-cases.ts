// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the edge-case suite for the content classifiers in
//   src/intelligence/testing/quality.ts (charter §7.2(c)). It imports the SAME
//   frozen table the scorer uses, so a row cannot be allowlisted with a regex
//   other than the one that runs.
// WHICH TOOL IT SERVES — bb_analyze (mode test_quality); the classifiers score
//   test-file content for assertions / error paths / parameterization / docs /
//   mocking.
// WHY IT EXISTS — a regex accepted as unavoidable must be shown to match what it
//   claims, not to exist. Each pattern is checked for: empty input, no-match,
//   match at a word/line boundary, Unicode (multi-byte and astral), multiline
//   behaviour, the anchors/quantifiers it actually uses, and a megabyte of input
//   staying under a time box so catastrophic backtracking cannot hide.
// WHERE ITS EVIDENCE LIVES — validation/tools/regex-allowlist.json rows that
//   point here; run: npx tsx validation/tools/bb_analyze/regex-edge-cases.ts
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/testing/quality.ts
//   (CONTENT_CLASSIFIERS) and the allowlist rows.
// CONTRACTS IT MUST NOT BREAK — zero regexes unallowlisted; every allowlisted
//   row's test file exists and is non-empty (script/tools/verify-regex-policy.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { CONTENT_CLASSIFIERS as C } from "../../../src/intelligence/testing/quality"

let checks = 0
let failed = 0
function ck(label: string, condition: boolean, detail = ""): void {
  checks++
  if (!condition) {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
const count = (re: RegExp, text: string): number => (text.match(new RegExp(re.source, re.flags)) || []).length

// ── empty input: every classifier answers 0, none throws ────────────────────
for (const [name, re] of Object.entries(C)) {
  ck(`${name}: empty input is 0`, count(re, "") === 0, String(count(re, "")))
}

// ── no-match: ordinary prose carries no framework evidence ──────────────────
const prose = "The quick brown fox jumps over the lazy dog. Nothing here asserts anything."
for (const [name, re] of Object.entries(C)) {
  ck(`${name}: no-match on prose`, count(re, prose) === 0, `got ${count(re, prose)}`)
}

// ── boundary behaviour of the patterns that actually use \b ─────────────────
ck("assertCall: matches assert(", count(C.assertCall, "assert(x)") === 1)
ck("assertCall: matches assert.equal(", count(C.assertCall, "assert.equal(a, b)") === 1)
ck("assertCall: word boundary rejects xassert(", count(C.assertCall, "xassert(x)") === 0)
ck("assertCall: word boundary rejects assertx(", count(C.assertCall, "assertx(x)") === 0)
ck("expectCall: matches expect(", count(C.expectCall, "expect(value)") === 1)
ck("expectCall: rejects expected(", count(C.expectCall, "expected(value)") === 0)
ck("shouldMember: needs the dot", count(C.shouldMember, "should.equal(1)") === 1 && count(C.shouldMember, "should equal") === 0)
ck("chainedMatcher: matches a chained toBe(", count(C.chainedMatcher, "expect(a).toBe(1)") === 1)
ck("chainedMatcher: matches a chained rejects(", count(C.chainedMatcher, "assert.rejects(p)") === 1)
ck("catchClause: requires the call paren", count(C.catchClause, "catch (e) {}") === 1 && count(C.catchClause, "catch e") === 0)
ck("tryBlock: requires the brace", count(C.tryBlock, "try {") === 1 && count(C.tryBlock, "try") === 0)

// ── Unicode: multi-byte and astral characters must not break or inflate ────
const unicode = "café — expect(value) ✓ 𝕏𝕐ℤ 日本語 expect(other)"
ck("expectCall: multi-byte text still matches", count(C.expectCall, unicode) === 2, String(count(C.expectCall, unicode)))
ck("assertCall: astral characters do not create a phantom match", count(C.assertCall, "𝕏𝕐ℤ assert(1)") === 1)
ck("commentLine: multi-byte comment still matches", count(C.commentLine, "// café\n") === 1)

// ── multiline: the only anchors/quantifiers in the set that see lines ──────
const multi = "describe('x', () => {\n  // a comment\n  it('works', () => { expect(1).toBe(1) })\n})"
ck("commentLine: matches a comment after a newline", count(C.commentLine, multi) === 1, String(count(C.commentLine, multi)))
ck("commentLine: matches a hash comment at start", count(C.commentLine, "# shell test\n") === 1)
ck("longTestName: 24+ character descriptive name matches", count(C.longTestName, "it('this name is definitely longer than twenty-four chars', () => {})") === 1)
ck("longTestName: a short name does not", count(C.longTestName, "it('short', () => {})") === 0)
ck("parameterized: it.each", count(C.parameterized, "it.each([1,2])('x', () => {})") === 1)
ck("parameterized: template case", count(C.parameterized, "test(`case ${n}`, () => {})") === 1)
ck("spyMockCall: jest.fn", count(C.spyMockCall, "jest.fn()") === 1 && count(C.spyMockCall, "jester") === 0)

// ── escaping of caller text: a source file is data, never a pattern ────────
// (the classifiers take file CONTENT; a name containing regex metacharacters
//  must be matched literally by the \b/\s structure they use, and must not
//  throw on invalid-looking input)
const hostile = "expect(a.b*c?d+e[f]g[h]i(j)k|l{m}n^o$p.q)"
ck("regex metacharacters in content do not throw", (() => { try { count(C.expectCall, hostile); return true } catch { return false } })(), "")
ck("expectCall: counts the real call in hostile content", count(C.expectCall, hostile) === 1)

// ── long input: linear-time assertion (catastrophic backtracking cannot hide) ─
const long = "x".repeat(1_000_000) + " expect(1) " + "y".repeat(1_000_000)
const started = Date.now()
let total = 0
for (const re of Object.values(C)) total += count(re, long)
const elapsed = Date.now() - started
ck("1 MB of input: all classifiers stay under one second", elapsed < 1_000, `${elapsed}ms for ${Object.keys(C).length} patterns`)
ck("1 MB of input: the planted expect( is still found exactly once", count(C.expectCall, long) === 1)

// ── every classifier is a global regex (the scorer relies on match-all) ────
for (const [name, re] of Object.entries(C)) {
  ck(`${name}: is global`, re.flags.includes("g"), re.flags)
}

console.log(`${checks - failed}/${checks} regex edge-case checks passed`)
process.exit(failed === 0 ? 0 : 1)
