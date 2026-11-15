import { writeFileSync } from "node:fs"
import path from "node:path"
import { CONTENT_CLASSIFIERS } from "../../../src/intelligence/testing/quality"
const DIR = path.resolve(import.meta.dirname ?? ".", ".")
const reasons: Record<string, string> = {
  assertCall: "Framework-agnostic assertion-site probe for test-quality scoring; a framework's assert call has no AST node type this indexer exposes and includes() cannot express the optional `.word(` form.",
  expectCall: "Detects expect( sites across Jest/Vitest/Mocha/Chai; statement-level source evidence, no AST equivalence exists.",
  shouldMember: "Chai should-style assertions are property accesses (should.equal) that only a pattern can recognise generically.",
  chainedMatcher: "Matcher methods (toBe/toThrow/rejects...) appear after an arbitrary receiver expression, so the matcher method call itself is the only stable anchor.",
  rejectsResolves: "Promise settlement evidence in assertions; two words with word boundaries, matched across any framework.",
  tryBlock: "Error-path evidence: `try {` requires the brace as the next non-space token, which a plain includes('try') cannot enforce without false positives.",
  throwMatcher: "toThrow/throws are matcher/property names whose position cannot be found by string operations without reimplementing word boundaries.",
  catchClause: "Error-path evidence: `catch (` requires the call parenthesis, which includes('catch') cannot distinguish from the keyword followed by an identifier.",
  parameterized: "Data-driven test detection spans it.each/test.each/describe template literals/%s/$var; five alternative shapes with no common prefix.",
  commentLine: "Counts comment lines, which requires an alternation for line start, blank-prefix and three comment styles; character scanning would reimplement the same state machine.",
  longTestName: "Descriptive test names: a minimum name length inside quoted/backticked first argument, which needs the quote alternation and repetition counts.",
  spyMockCall: "Mock evidence: jest/sinon/vi fn/spyOn/mock plus mockImplementation and nock( across four frameworks; the alternatives share no prefix.",
}
const entries = Object.entries(CONTENT_CLASSIFIERS).map(([name, re]) => ({
  file: "src/intelligence/testing/quality.ts",
  match: String(re),
  reason: reasons[name] ?? `Content classifier ${name}.`,
  testFile: "validation/tools/bb_analyze/regex-edge-cases.ts",
}))
writeFileSync(path.join(DIR, "regex-allowlist-rows.json"), JSON.stringify({
  schemaVersion: 1,
  note: "Rows for validation/tools/regex-allowlist.json, one per content classifier in src/intelligence/testing/quality.ts. Each row is keyed by file + exact regex source, and every row points at validation/tools/bb_analyze/regex-edge-cases.ts (61 checks: empty, no-match, boundary, Unicode, multiline, long-input time box, metacharacters).",
  entries,
}, null, 2) + "\n")
console.log(`wrote ${entries.length} rows:`, entries.map((e) => e.match.slice(0, 40)).join(" | "))
