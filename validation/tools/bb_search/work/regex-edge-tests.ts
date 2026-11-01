// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the edge-case suite that accompanies the two allowlisted
//   user-pattern `new RegExp` sites of bb_search (charter §7): the regex-search
//   compiler and the isolated scan worker.
// WHICH TOOL IT SERVES — bb_search (`regex:true`: the caller's pattern is DATA,
//   matched against indexed symbol names, never used to parse source).
// WHY IT IS SHAPED THIS WAY — the regex here is the FEATURE, so the risk is not
//   "regex used for parsing" but "user pattern trusted": empty patterns, Unicode
//   names, multiline names, escaping of pattern metacharacters, long inputs and
//   catastrophic backtracking must all be bounded and declared, and an invalid
//   pattern must be a named error rather than a silent empty page.
// WHERE ITS EVIDENCE LIVES — this file is the `testFile` of the two allowlist
//   rows in validation/tools/regex-allowlist.json; run with
//   `npx tsx validation/tools/bb_search/work/regex-edge-tests.ts` (exit 0 = pass).
// EDIT TOGETHER WHEN THIS FILE CHANGES — validation/tools/regex-allowlist.json,
//   src/intelligence/search/regex-search.ts, src/intelligence/search/regex-scan-worker.ts.
// CONTRACTS IT MUST NOT BREAK — no assertion may pass on a crash; the
//   pathological-backtracking case must be TIME-BOXED and must assert that the
//   deadline produced a declared bounded outcome.
// ─────────────────────────────────────────────────────────────────────────────

import { InvalidRegexError, searchRegex, compilePatternForTests } from "../../../../src/intelligence/search/regex-search"
import { matchNames, scanWithDeadline } from "../../../../src/intelligence/search/regex-scan-worker"

let failures = 0
const check = (name: string, pass: boolean, detail = ""): void => {
  if (!pass) {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  } else {
    console.log(`  ok   ${name}`)
  }
}

// 1. A compiled pattern is the caller's RegExp exactly (case rule included).
{
  const lower = compilePatternForTests("^handle", false)
  check("empty flags fold case by default", lower.test("HANDLEREQUEST"))
  const sensitive = compilePatternForTests("^HANDLE", true)
  check("case-sensitive pattern does not fold", !sensitive.test("handleRequest"))
}

// 2. Empty pattern: a valid pattern that matches every name — the feature, not a
//    crash, and the handler's empty-query guard is a separate layer (covered by
//    the mode gate's non-empty-query refusal).
{
  const matched = matchNames({ pattern: "", caseSensitive: false, names: ["", "a", "handleRequest"] })
  check("empty pattern is valid and matches every name", matched.length === 3, String(matched.length))
}

// 3. No-match and match-at-boundary (anchors are the pattern the caller wrote).
{
  const empty = matchNames({ pattern: "^zzz_nothing$", caseSensitive: true, names: ["handleRequest", "handleResponse"] })
  check("no-match returns an empty index set", empty.length === 0)
  const boundary = matchNames({ pattern: "^handleRequest$", caseSensitive: true, names: ["handleRequest", "xhandleRequest", "handleRequestX"] })
  check("anchored pattern matches only the whole name", boundary.length === 1 && boundary[0] === 0, JSON.stringify(boundary))
}

// 4. Unicode: multi-byte (Greek) and astral (emoji) names; the name is data.
{
  const greek = matchNames({ pattern: "^ΣΊΣΥΦΟΣ$", caseSensitive: false, names: ["UNICODE_ΣΊΣΥΦΟΣ", "ΣΊΣΥΦΟΣ", "other"] })
  check("Greek pattern matches its name under case folding", greek.length === 1 && greek[0] === 1, JSON.stringify(greek))
  const astral = matchNames({ pattern: "😀", caseSensitive: true, names: ["plain", "has😀astral", "has\ud83d astral"] })
  check("astral code point matches as one unit and not its surrogate half", astral.length === 1 && astral[0] === 1, JSON.stringify(astral))
}

// 5. Multiline names: no `m`/`s` flags are added, so ^/$ stay whole-string and
//    `.` does not cross a newline. Declared behaviour, asserted.
{
  const anchored = matchNames({ pattern: "^b$", caseSensitive: true, names: ["a\nb", "b"] })
  check("^/$ anchor the whole name (no implicit multiline flag)", anchored.length === 1 && anchored[0] === 1, JSON.stringify(anchored))
  const dot = matchNames({ pattern: "a.b", caseSensitive: true, names: ["a\nb", "axb"] })
  check("dot does not match a newline (no implicit dotAll flag)", dot.length === 1 && dot[0] === 1, JSON.stringify(dot))
}

// 6. Pattern metacharacters are the CALLER'S syntax, not escaped literals: a
//    pattern containing SQL-LIKE or regex metacharacters must behave as a regex.
{
  const literalPercent = matchNames({ pattern: "^get_user$", caseSensitive: true, names: ["get_user", "getXuser"] })
  check("underscore is a regex literal, not a SQL LIKE wildcard", literalPercent.length === 1 && literalPercent[0] === 0, JSON.stringify(literalPercent))
  const escapedDot = matchNames({ pattern: "a\\.b", caseSensitive: true, names: ["a.b", "axb"] })
  check("escaped dot matches only a literal dot", escapedDot.length === 1 && escapedDot[0] === 0, JSON.stringify(escapedDot))
}

// 7. Invalid patterns are named errors, never a silent empty answer.
{
  let named = false
  try {
    compilePatternForTests("([unclosed", false)
  } catch (error) {
    named = error instanceof InvalidRegexError && String((error as Error).message).includes("invalid regex")
  }
  check("invalid pattern raises the named InvalidRegexError", named)
  let bare = false
  try {
    compilePatternForTests("a{2,1}", false)
  } catch (error) {
    bare = error instanceof InvalidRegexError
  }
  check("out-of-order quantifier raises the named InvalidRegexError", bare)
}

// 8. Long input, benign quantifier: must complete (no pathological behaviour on
//    a large name) and is time-boxed through the worker.
{
  const longName = "a".repeat(100_000) + "b"
  const started = Date.now()
  const outcome = await scanWithDeadline({ pattern: "^a+b$", caseSensitive: false, names: [longName] }, 5_000)
  const elapsed = Date.now() - started
  check("100k-char benign input completes inside the budget", !outcome.timedOut && outcome.matchedIndexes.length === 1 && elapsed < 5_000, `timedOut=${outcome.timedOut} ms=${elapsed}`)
}

// 9. Catastrophic backtracking: `(a+)+b` on "a"*30 must be TERMINATED by the
//    deadline and declared (timedOut or isolation-fallback), never allowed to
//    hang the test or the server. Time-boxed assertion.
{
  const started = Date.now()
  const outcome = await scanWithDeadline({ pattern: "(a+)+b", caseSensitive: false, names: ["a".repeat(30), "pre_handleRequestInner"] }, 1_500)
  const elapsed = Date.now() - started
  const bounded = outcome.timedOut === true || outcome.inline === true
  check("catastrophic pattern is bounded and declared (timedOut or inline)", bounded, `timedOut=${outcome.timedOut} inline=${outcome.inline} ms=${elapsed}`)
  check("catastrophic pattern does not run past the deadline plus startup grace", elapsed < 6_000, `ms=${elapsed}`)
}

// 10. searchRegex end-to-end error surfacing (engine contract; the handler turns
//     this into an isError envelope, which the mode gate asserts at the door).
{
  let threw = false
  try {
    await searchRegex("0000000000000000000000000000000000000000", "([unclosed", {})
  } catch (error) {
    threw = error instanceof InvalidRegexError
  }
  check("searchRegex surfaces InvalidRegexError before touching data", threw)
}

console.log(failures === 0 ? "regex edge tests: PASS" : `regex edge tests: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
