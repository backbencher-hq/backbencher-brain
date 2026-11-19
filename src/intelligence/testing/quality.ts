// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the test-quality engine: independent content/graph dimensions per test file, with unsupported dimensions declared instead of fabricated.
// WHICH TOOL IT SERVES — bb_analyze (mutability read, requiresIndex true, mode
//   test_quality).
// WHY IT IS SHAPED THIS WAY — a metric is only reported when it was measured; the
//   content classifiers are frozen, named tables PER LANGUAGE because the
//   language's own assertion/parameterization vocabulary is the evidence, and
//   measuring Go with JavaScript syntax (P1-3, bettercap ISSUE-06) scored seven
//   Go files with 114 real `t.Fatalf`/`t.Errorf` sites as `assertions: 0` and
//   fired "parameterization" on the printf verb `%s` while anchoring as
//   `it.each/test.each`. The vocabularies below name the observed token in
//   `observedAnchor`; an anchor string is never hard-coded.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_analyze.md, docs/BB_TEST_QUALITY.md, validation/tools/bb_analyze/**;
//   gates: npx tsx script/verify-test-quality.ts, npx tsx script/verify-analyze.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/handler.ts,
//   script/tool-docs/curation/bb_analyze.ts, and the gates named above.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   the read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

// Test quality engine (M9.11) — evidence-based, capability-flagged, honest unknowns.
//
// Philosophy:
//   * Every dimension is INDEPENDENTLY measured (never a multiplier of a synthetic overall).
//   * A metric is only reported when it can actually be measured from the index or file
//     content; otherwise it is explicitly `unknown` (supported=false) — never fabricated.
//   * Verify-before-clone: dimensions without a deterministic graph/Table source are only
//     claimed when content evidence is observed with a bounded confident verification.
//   * P1-3: the vocabulary is the LANGUAGE's, not one language's projected onto all.
//     A Go file is measured with Go assertion idioms, a Python file with Python's, JS/TS
//     with theirs; an unrecognised language gets the declared `generic-superset` fallback
//     and the payload says so (provenance.unknowns).
import { readFile } from "node:fs/promises"
import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type {
  TestQualityDimension,
  TestQualityDimensionId,
  TestQualityFile,
  TestQualityIssue,
  TestQualityReport,
} from "../contracts"
import { makeProvenance } from "../evidence"
import { codeTestClause, nonCodeUnknown, noEvidenceUnknown } from "./test-intel"

export interface QualityOptions {
  /** max test files to deeply analyze (content read). default 50 */
  maxFiles?: number
  /** bytes cap per content read to bound cost. default 64KB */
  maxBytes?: number
  /** Scope the report to test files under this project-relative path prefix. */
  filePath?: string
}

type Dim = {
  supported: boolean
  relevance: number | null
  evidenceStrength: number | null
  penaltyPotential: number | null
  observedAnchor: string | null
  confidence: number | null
}

function dim(partial: Partial<Dim> & { supported: boolean }): Dim {
  return {
    relevance: null,
    evidenceStrength: null,
    penaltyPotential: null,
    observedAnchor: null,
    confidence: null,
    ...partial,
  }
}

const UNKNOWN: Dim = dim({ supported: false })

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/** Escape %/_/\ so a path is a VALUE in a LIKE comparison, never a pattern. */
function escapeLikeValue(value: string): string {
  let out = ""
  for (const ch of value) out += ch === "\\" || ch === "%" || ch === "_" ? "\\" + ch : ch
  return out
}

/**
 * A project-relative path scope: the FILE ITSELF, or any file under it on a
 * whole segment boundary — the same rule `dependencies` and `complexity` use.
 * The exact-match arm is why it exists here: without it
 * `filePath: "test/unit/engine.test.ts"` (a real code test file) was a scope
 * with zero rows, and the report said no test file lives at that path.
 */
function testFileScope(filePath: string | undefined): { sql: string; params: string[] } {
  if (!filePath) return { sql: "", params: [] }
  let clean = filePath
  while (clean.endsWith("/")) clean = clean.slice(0, -1)
  return { sql: " AND (relative_path = ? OR relative_path LIKE ? ESCAPE '\\')", params: [clean, escapeLikeValue(clean) + "/%"] }
}

// ── Language vocabularies (P1-3) ────────────────────────────────────────────
//
// Each pattern carries a LABEL that is a literal token appearing in the source.
// The dimension's `observedAnchor` is `${label} × ${count}` for the label(s)
// that actually matched — so an anchor can never name a construct the file does
// not contain (the defect: every Go file reported "it.each/test.each template"
// when the only match was `%s`).
type TokenPattern = { re: RegExp; label: string }

interface TestVocabulary {
  id: string
  /** brain_file.language values (lowercase) that select this vocabulary. */
  languages: string[]
  assertions: TokenPattern[]
  errorPaths: TokenPattern[]
  parameterization: TokenPattern[]
  /** literal token that appears in an observed fixture-setup call. */
  fixtures: TokenPattern[]
  longTestName: RegExp
  longTestNameLabel: string
  commentLine: RegExp
  commentLabel: string
}

const GO_VOCAB: TestVocabulary = {
  id: "go",
  languages: ["go"],
  assertions: [
    // One pattern per literal token so `observedAnchor` can name the token that
    // actually matched (`t.Fatal × 2` is not `t.Fatalf × 2`).
    { re: /\bt\.Fatalf\(/g, label: "t.Fatalf" },
    { re: /\bt\.Errorf\(/g, label: "t.Errorf" },
    { re: /\bt\.Fatal\(/g, label: "t.Fatal" },
    { re: /\bt\.Error\(/g, label: "t.Error" },
    { re: /\brequire\.[A-Z]\w*\(/g, label: "require" },
    { re: /\bassert\.[A-Z]\w*\(/g, label: "assert" },
    { re: /\bcmp\.Diff\(/g, label: "cmp.Diff" },
  ],
  errorPaths: [
    { re: /if[^\n]*\berr\s*!=\s*nil/g, label: "if err != nil" },
    { re: /if[^\n]*\berr\s*==\s*nil/g, label: "if err == nil" },
    { re: /\brecover\(\)/g, label: "recover()" },
  ],
  // Go table tests / subtest runners. The printf verb `%s` is NOT parameterization.
  parameterization: [
    { re: /\bt\.Run\(/g, label: "t.Run" },
    { re: /for\s+[^\n]*range\s+tests\b/g, label: "range tests" },
  ],
  fixtures: [
    { re: /\bt\.TempDir\(/g, label: "t.TempDir" },
    { re: /\bos\.MkdirTemp\(/g, label: "os.MkdirTemp" },
    { re: /\bioutil\.TempFile\(/g, label: "ioutil.TempFile" },
    { re: /\bos\.CreateTemp\(/g, label: "os.CreateTemp" },
    { re: /\bos\.MkdirAll\(/g, label: "os.MkdirAll" },
    { re: /\bt\.Setenv\(/g, label: "t.Setenv" },
    { re: /\bhttptest\.NewServer\(/g, label: "httptest.NewServer" },
  ],
  longTestName: /\bfunc\s+(?:Test|Benchmark|Example)[A-Za-z0-9_]{11,}\(/g,
  longTestNameLabel: "func Test",
  commentLine: /(^|\n)\s*(\/\/|\/\*)/g,
  commentLabel: "//",
}

const PYTHON_VOCAB: TestVocabulary = {
  id: "python",
  languages: ["python", "py"],
  assertions: [
    { re: /^\s*assert\s+/gm, label: "assert" },
    { re: /\bself\.assert[A-Z]\w*\(/g, label: "self.assert" },
    { re: /\bassert[A-Z]\w*\(/g, label: "assert" },
  ],
  errorPaths: [
    { re: /\bpytest\.raises\(/g, label: "pytest.raises" },
    { re: /\bassert_raises\(/g, label: "assert_raises" },
    { re: /\bself\.assertRaises\(/g, label: "self.assertRaises" },
    { re: /^\s*except\b/gm, label: "except" },
  ],
  parameterization: [
    { re: /@pytest\.mark\.parametrize/g, label: "pytest.mark.parametrize" },
    { re: /\.subTest\(/g, label: "subTest" },
  ],
  fixtures: [
    { re: /\btmp_path\b/g, label: "tmp_path" },
    { re: /\btmpdir\b/g, label: "tmpdir" },
    { re: /\bNamedTemporaryFile\(/g, label: "NamedTemporaryFile" },
    { re: /\bmkdtemp\(/g, label: "mkdtemp" },
  ],
  longTestName: /\bdef\s+test_[a-z0-9_]{10,}\(/g,
  longTestNameLabel: "def test_",
  commentLine: /(^|\n)\s*#/g,
  commentLabel: "#",
}

const JS_VOCAB: TestVocabulary = {
  id: "javascript",
  languages: ["javascript", "typescript", "jsx", "tsx", "javascriptreact", "typescriptreact"],
  assertions: [
    { re: /\bexpect\s*\(/g, label: "expect" },
    { re: /\bassert(?:\.[A-Za-z]+)?\s*\(/g, label: "assert" },
    { re: /\bshould\./g, label: "should." },
    { re: /\.toBe\(/g, label: "toBe" },
    { re: /\.toEqual\(/g, label: "toEqual" },
    { re: /\.toStrictEqual\(/g, label: "toStrictEqual" },
    { re: /\.toThrow\(/g, label: "toThrow" },
    { re: /\.toMatch\(/g, label: "toMatch" },
    { re: /\.toContain\(/g, label: "toContain" },
  ],
  errorPaths: [
    { re: /\btry\s*\{/g, label: "try {" },
    { re: /\bcatch\s*\(/g, label: "catch (" },
    { re: /\.toThrow\(/g, label: "toThrow" },
    { re: /\brejects\b/g, label: "rejects" },
    { re: /\bresolves\b/g, label: "resolves" },
  ],
  parameterization: [
    { re: /\bit\.each\b/g, label: "it.each" },
    { re: /\btest\.each\b/g, label: "test.each" },
    { re: /\bdescribe\.each\b/g, label: "describe.each" },
  ],
  fixtures: [
    { re: /\bbeforeEach\(/g, label: "beforeEach" },
    { re: /\bbeforeAll\(/g, label: "beforeAll" },
    { re: /\bmsw\./g, label: "msw" },
  ],
  longTestName: /\b(?:it|test|describe)\s*\(\s*['"`][^'"`]{24,}['"`]/g,
  longTestNameLabel: "it(",
  commentLine: /(^|\n)\s*(\/\/|\/\*)/g,
  commentLabel: "//",
}

const RUST_VOCAB: TestVocabulary = {
  id: "rust",
  languages: ["rust"],
  assertions: [
    { re: /\bassert_eq!\(/g, label: "assert_eq!" },
    { re: /\bassert_ne!\(/g, label: "assert_ne!" },
    { re: /\bassert!\(/g, label: "assert!" },
    { re: /\bdebug_assert(?:_eq|_ne)?!\(/g, label: "debug_assert!" },
  ],
  errorPaths: [
    { re: /#\[should_panic\]/g, label: "should_panic" },
    { re: /\bpanic!\(/g, label: "panic!" },
  ],
  // Rust has no in-language parameterization construct; the dimension is declared
  // unsupported rather than fabricated as 0.
  parameterization: [],
  fixtures: [{ re: /\btempdir\(/g, label: "tempdir" }],
  longTestName: /\bfn\s+[a-z0-9_]{16,}\(/g,
  longTestNameLabel: "fn ",
  commentLine: /(^|\n)\s*(\/\/|\/\*)/g,
  commentLabel: "//",
}

/** Fallback for a language with no registered vocabulary: the documented
 *  generic superset. Its use is DECLARED in provenance, so an under-scored
 *  language is visible rather than silent. */
const GENERIC_VOCAB: TestVocabulary = {
  id: "generic-superset",
  languages: [],
  assertions: [
    { re: /\bassert(?:\.[A-Za-z]+)?\s*\(/g, label: "assert" },
    { re: /\bexpect\s*\(/g, label: "expect" },
    { re: /\bshould\./g, label: "should." },
  ],
  errorPaths: [
    { re: /\btry\s*\{/g, label: "try {" },
    { re: /\bcatch\s*\(/g, label: "catch (" },
    { re: /\bthrows\b/g, label: "throws" },
  ],
  parameterization: [
    { re: /\bit\.each\b/g, label: "it.each" },
    { re: /\btest\.each\b/g, label: "test.each" },
  ],
  fixtures: [
    { re: /\btempdir\(/gi, label: "tempdir" },
    { re: /\bfixtures?\//gi, label: "fixtures/" },
  ],
  longTestName: /\b(?:it|test|describe)\s*\(\s*['"`][^'"`]{24,}['"`]/g,
  longTestNameLabel: "it(",
  commentLine: /(^|\n)\s*(\/\/|\/\*|#)/g,
  commentLabel: "//",
}

export const TEST_VOCABULARIES: Record<string, TestVocabulary> = {
  go: GO_VOCAB,
  python: PYTHON_VOCAB,
  javascript: JS_VOCAB,
  rust: RUST_VOCAB,
  "generic-superset": GENERIC_VOCAB,
}

/** The shared low-level token table. Kept exported (script/m15 asserts every
 *  entry is a global RegExp). `parameterized` deliberately no longer contains
 *  the printf verb `%s` or the `$x` proxy — that was bettercap ISSUE-06's false
 *  positive; it now names real data-driven-test constructs only. */
export const CONTENT_CLASSIFIERS = {
  assertCall: /\bassert(?:\.[A-Za-z]+)?\s*\(/g,
  expectCall: /\bexpect\s*\(/g,
  shouldMember: /\bshould\./g,
  chainedMatcher: /\.(?:toBe|toEqual|toStrictEqual|toThrow|toBeTruthy|toBeFalsy|toMatch|toContain|rejects|resolves)\s*\(/g,
  rejectsResolves: /\b(rejects|resolves)\b/g,
  tryBlock: /\btry\s*\{/g,
  throwMatcher: /\btoThrow|throws\b/g,
  catchClause: /\bcatch\s*\(/g,
  parameterized: /\b(?:it|test)\.each\b|\b(?:describe|it|test)\s*\(\s*`/g,
  commentLine: /(^|\n)\s*(\/\/|\/\*|#)/g,
  longTestName: /\b(?:it|test|describe)\s*\(\s*['"`][^'"`]{24,}['"`]/g,
  spyMockCall: /\b(jest|sinon)\.(fn|spyOn|mock)\b|vi\.(fn|spyOn|mock)|\.mockImplementation|nock\(/g,
} as const

/** Mock-library import prefixes: a framework import is graph evidence that the
 *  file builds stubs. `startsWith` on a list, not a regex. Test frameworks
 *  themselves are NOT mocking evidence (`testing`/`pytest` are not mock libs). */
const MOCK_LIB_PREFIXES = ["jest", "vitest", "mocha", "chai", "sinon", "@sinonjs", "testdouble", "nock", "msw", "@testing-library", "ava", "tap", "node:test", "github.com/stretchr/testify/mock", "go.uber.org/mock", "github.com/golang/mock"]

/** Import prefixes that are TEST FRAMEWORKS, never fixture evidence. */
const TEST_FRAMEWORK_PREFIXES = ["testing", "github.com/stretchr/testify", "pytest", "unittest", "mock", "coverage", "vitest", "jest", "mocha", "chai", "sinon", "@testing-library", "ava", "tap", "node:test", "node:assert", "assert"]

/** Node.js builtin modules: stdlib, never fixture evidence. */
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "string_decoder", "timers", "tls", "trace_events", "tty", "url", "util",
  "v8", "vm", "wasi", "worker_threads", "zlib",
])

/** Python stdlib modules (bounded, common set) — stdlib, never fixture evidence. */
const PY_STDLIB = new Set([
  "os", "sys", "io", "re", "json", "time", "datetime", "pathlib", "tempfile", "shutil", "subprocess", "typing",
  "unittest", "collections", "functools", "itertools", "math", "random", "logging", "copy", "types", "abc",
  "dataclasses", "enum", "warnings", "threading", "contextlib", "inspect", "hashlib", "base64", "csv", "pickle",
  "socket", "struct", "textwrap", "traceback", "uuid", "argparse", "glob", "fnmatch", "stat", "errno", "signal",
])

/** Pick the vocabulary for a brain_file.language value. Returns the vocabulary
 *  and whether the generic fallback was used (the caller must DECLARE it). */
export function vocabularyFor(language: string | null | undefined): { id: string; vocabulary: TestVocabulary; fallback: boolean } {
  const lang = String(language ?? "").toLowerCase()
  for (const [id, vocab] of Object.entries(TEST_VOCABULARIES)) {
    if (id === "generic-superset") continue
    if (vocab.languages.includes(lang)) return { id, vocabulary: vocab, fallback: false }
  }
  return { id: GENERIC_VOCAB.id, vocabulary: GENERIC_VOCAB, fallback: true }
}

function isRelativeImport(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("/")
}

function firstSegment(spec: string): string {
  const cleaned = spec.replace(/^@/, "")
  return cleaned.split("/")[0] ?? ""
}

/** Is this import stdlib/framework plumbing (NOT fixture evidence)? */
export function isInfrastructureImport(language: string | null, spec: string): boolean {
  if (!spec) return true
  const lang = String(language ?? "").toLowerCase()
  if (TEST_FRAMEWORK_PREFIXES.some((prefix) => spec === prefix || spec.startsWith(prefix + "/"))) return true
  if (lang === "go") {
    // Go stdlib import paths have no dot in their first segment ("testing", "os").
    return !firstSegment(spec).includes(".")
  }
  if (lang === "javascript" || lang === "typescript" || lang === "jsx" || lang === "tsx") {
    if (spec.startsWith("node:")) return true
    return !isRelativeImport(spec) && NODE_BUILTINS.has(firstSegment(spec))
  }
  if (lang === "python" || lang === "py") {
    return PY_STDLIB.has(firstSegment(spec))
  }
  return false
}

function countPatterns(content: string, patterns: TokenPattern[]): { total: number; matched: Array<{ label: string; count: number }> } {
  const matched: Array<{ label: string; count: number }> = []
  let total = 0
  for (const p of patterns) {
    const count = (content.match(p.re) || []).length
    if (count > 0) {
      matched.push({ label: p.label, count })
      total += count
    }
  }
  matched.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return { total, matched }
}

/** Anchor naming only tokens that were OBSERVED. `label × count` for the
 *  strongest matched label(s); null when nothing matched. */
function observedAnchorFor(matched: Array<{ label: string; count: number }>): string | null {
  if (matched.length === 0) return null
  return matched.slice(0, 2).map((m) => `${m.label} × ${m.count}`).join(", ")
}

export interface TestContentInput {
  relativePath: string
  /** brain_file.language */
  language: string | null
  /** bounded file content */
  content: string
  /** brain_import import_path values for this file (graph evidence) */
  imports?: string[]
}

export interface TestContentMeasurement {
  relativePath: string
  language: string
  /** the vocabulary used: "go" | "python" | "javascript" | "rust" | "generic-superset" */
  vocabulary: string
  /** true when the generic fallback measured a language with no registered vocabulary (declared) */
  vocabularyFallback: boolean
  dimensions: TestQualityDimension[]
  unsupported: string[]
  issues: TestQualityIssue[]
  strengths: string[]
}

/** Measure ONE test file's content with its LANGUAGE's vocabulary. Pure (no DB),
 *  exported so the gate can exercise the exact measurement the engine uses. */
export function measureTestContent(input: TestContentInput): TestContentMeasurement {
  const { id: vocabId, vocabulary, fallback } = vocabularyFor(input.language)
  const language = String(input.language ?? "").toLowerCase()
  const c = input.content
  const imports = input.imports ?? []
  const issues: TestQualityIssue[] = []
  const strengths: string[] = []
  const unsupported: string[] = []
  const dims: Record<TestQualityDimensionId, Dim> = {
    assertions: { ...UNKNOWN },
    mocking: { ...UNKNOWN },
    error_handling: { ...UNKNOWN },
    parameterization: { ...UNKNOWN },
    docs: { ...UNKNOWN },
    fixtures: { ...UNKNOWN },
  }

  // -- assertions --------------------------------------------------------------
  const asserts = countPatterns(c, vocabulary.assertions)
  dims.assertions = dim({
    supported: true,
    evidenceStrength: clamp01(asserts.total / 6),
    penaltyPotential: asserts.total === 0 ? 1 : clamp01(1 - asserts.total / 6),
    observedAnchor: observedAnchorFor(asserts.matched),
    confidence: 0.85,
  })
  if (asserts.total === 0) issues.push({ category: "no_assertion_evidence", description: `no ${vocabId} assertion statement observed` })
  else strengths.push(`${asserts.total} assertion site(s): ${observedAnchorFor(asserts.matched)}`)

  // -- error handling ----------------------------------------------------------
  const err = countPatterns(c, vocabulary.errorPaths)
  dims.error_handling = dim({
    supported: true,
    evidenceStrength: clamp01(err.total / 3),
    penaltyPotential: err.total === 0 ? 1 : clamp01(1 - err.total / 3),
    observedAnchor: observedAnchorFor(err.matched),
    confidence: 0.8,
  })
  if (err.total === 0) issues.push({ category: "no_error_path_evidence", description: `no ${vocabId} error-path evidence observed` })
  else strengths.push(`${err.total} error-path site(s): ${observedAnchorFor(err.matched)}`)

  // -- parameterization --------------------------------------------------------
  if (vocabulary.parameterization.length === 0) {
    // The language has no known data-driven test construct: UNKNOWN, never a fabricated 0.
    unsupported.push("parameterization")
    dims.parameterization = { ...UNKNOWN }
  } else {
    const param = countPatterns(c, vocabulary.parameterization)
    dims.parameterization = dim({
      supported: true,
      evidenceStrength: clamp01(param.total / 3),
      penaltyPotential: 0, // absence is not penalized heavily
      observedAnchor: observedAnchorFor(param.matched),
      confidence: 0.75,
    })
    if (param.total > 0) strengths.push(`parameterized cases: ${observedAnchorFor(param.matched)}`)
  }

  // -- docs --------------------------------------------------------------------
  const comments = (c.match(vocabulary.commentLine) || []).length
  const longNames = (c.match(vocabulary.longTestName) || []).length
  const docsTotal = comments + longNames
  dims.docs = dim({
    supported: true,
    evidenceStrength: clamp01(docsTotal / 6),
    penaltyPotential: clamp01(1 - docsTotal / 6),
    observedAnchor: observedAnchorFor([
      ...(comments > 0 ? [{ label: vocabulary.commentLabel, count: comments }] : []),
      ...(longNames > 0 ? [{ label: vocabulary.longTestNameLabel, count: longNames }] : []),
    ]),
    confidence: 0.7,
  })

  // -- fixtures (real fixtures, not a stdlib import) ---------------------------
  const fixtureHits = countPatterns(c, vocabulary.fixtures)
  const fixtureImports = imports.filter((spec) => (spec.length > 0 && !isRelativeImport(spec) ? !isInfrastructureImport(language, spec) : false))
  const localFixtureImports = imports.filter((spec) => spec.length > 0 && isRelativeImport(spec))
  const fixtureEvidence = fixtureHits.total + fixtureImports.length + localFixtureImports.length
  const fixturesAnchor = observedAnchorFor(fixtureHits.matched) ?? (localFixtureImports.length > 0 ? `import: ${localFixtureImports[0]}` : null)
  dims.fixtures = dim({
    supported: true,
    evidenceStrength: clamp01(fixtureEvidence / 3),
    observedAnchor: fixturesAnchor,
    confidence: fixtureHits.total > 0 || localFixtureImports.length > 0 ? 0.8 : 0.5,
  })
  if (fixtureHits.total > 0) strengths.push(`fixture setup: ${observedAnchorFor(fixtureHits.matched)}`)
  else if (localFixtureImports.length > 0) strengths.push(`local fixture module(s): ${localFixtureImports[0]}`)

  // -- mocking (content spy/mock call sites; graph mock-import is graph-only) --
  const spyHits = (c.match(CONTENT_CLASSIFIERS.spyMockCall) || []).length
  const mockImports = imports.filter((spec) => MOCK_LIB_PREFIXES.some((prefix) => spec === prefix || spec.startsWith(prefix + "/")))
  if (mockImports.length > 0 || spyHits > 0) {
    dims.mocking = dim({
      supported: true,
      evidenceStrength: clamp01((mockImports.length > 0 ? 0.5 : 0) + Math.min(spyHits, 4) / 8),
      penaltyPotential: 0,
      observedAnchor: mockImports.length > 0 ? `mock-library import: ${mockImports[0]}` : "spy/mock call site",
      confidence: 0.8,
    })
    strengths.push("mocking evidence present")
  } else {
    dims.mocking = dim({ supported: true, evidenceStrength: 0, penaltyPotential: 0, confidence: 0.6 })
  }

  const dimObjs = (Object.keys(dims) as TestQualityDimensionId[]).map((id) => ({ id, ...dims[id] })).sort((a, b) => a.id.localeCompare(b.id))
  for (const d of dimObjs) if (!d.supported && !unsupported.includes(d.id)) unsupported.push(d.id)
  return {
    relativePath: input.relativePath,
    language: language || "unknown",
    vocabulary: vocabId,
    vocabularyFallback: fallback,
    dimensions: dimObjs,
    unsupported: unsupported.sort(),
    issues,
    strengths,
  }
}

/** Per-file overall: confidence-weighted mean over MEASURED dimensions only, with
 *  an EFFECTIVE penalty. The pre-fix formula clamped `strength - 0.5·penalty` at 0
 *  (triage UNLOCKED: the penalty was inert — "no evidence" contributed exactly 0
 *  and could never pull a file down). Multiplicative form: the penalty scales the
 *  credit, so a zero-assertion dimension contributes 0 while a partially-measured
 *  one is genuinely reduced by half its penalty share. */
export function overallScore(dimensions: TestQualityDimension[]): number | null {
  const measured = dimensions.filter((d) => d.supported && d.evidenceStrength !== null)
  if (measured.length === 0) return null
  let sum = 0
  let w = 0
  for (const d of measured) {
    const conf = d.confidence ?? 0.5
    const penalty = clamp01(d.penaltyPotential ?? 0)
    sum += conf * clamp01((d.evidenceStrength ?? 0) * (1 - 0.5 * penalty))
    w += conf
  }
  return w > 0 ? sum / w : null
}

/** Aggregate over a set of measured files: mean of per-file overalls where
 *  present + per-dimension means. Pure, exported for the projection gate. */
export function aggregateQuality(
  files: Array<Pick<TestQualityFile, "relativePath" | "dimensions">>,
): { mean: number | null; perDimension: Record<string, number | null> } {
  const overalls = files.map((f) => overallScore(f.dimensions)).filter((x): x is number => x !== null)
  const perDim: Record<string, number | null> = {}
  for (const id of ["assertions", "mocking", "error_handling", "parameterization", "docs", "fixtures"] as const) {
    const vals = files.flatMap((f) => f.dimensions.filter((d) => d.id === id && d.evidenceStrength !== null).map((d) => d.evidenceStrength as number))
    perDim[id] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  return { mean: overalls.length > 0 ? overalls.reduce((a, b) => a + b, 0) / overalls.length : null, perDimension: perDim }
}

export async function testQuality(projectId: ProjectID, options: QualityOptions = {}): Promise<TestQualityReport> {
  const maxFiles = options.maxFiles ?? 50
  const maxBytes = options.maxBytes ?? 64 * 1024
  // Optional scope: test files under a project-relative path prefix, or in one
  // named file, applied at the SQL layer so a scoped call reads less, not
  // post-filtered. Neither statement here aliases brain_file, so the predicate
  // uses the bare column (unambiguous — brain_import has no relative_path).
  const scope = testFileScope(options.filePath)
  const scopeSql = scope.sql
  const scopeParams: string[] = scope.params

  const raw = await BrainDatabase.getRawInstance(projectId)

  // M50.A2 residual: a test file must be CODE. The indexer's is_test_file flag
  // matches directory segments (…/spec/…) regardless of file type, so on a real
  // repo all 30 flagged files were JSON data fixtures (script/m14/spec/*.json)
  // and this tool listed them as test files, read them as "tests", and reported
  // every quality dimension as unsupported. Non-code flagged files are excluded
  // and the exclusion is declared in provenance.unknowns (never silent).
  const codeClause = codeTestClause("")

  // All code test files for this project, with absolute path + language.
  const files = raw.prepare(
    "SELECT id, relative_path AS rel, path, language, COALESCE(line_count,0) AS lines " +
      "FROM brain_file WHERE project_id = ? AND COALESCE(is_test_file,0) = 1" + scopeSql + codeClause.sql + " ORDER BY relative_path",
  ).all(projectId, ...scopeParams, ...codeClause.params) as Array<{ id: string; rel: string; path: string; language: string | null; lines: number }>

  // How many is_test_file rows were excluded as non-code (for the disclosure).
  const flaggedFiles = (raw.prepare(
    "SELECT COUNT(*) c FROM brain_file WHERE project_id = ? AND COALESCE(is_test_file,0) = 1" + scopeSql,
  ).get(projectId, ...scopeParams) as { c: number }).c
  const nonCodeTestFiles = Math.max(0, flaggedFiles - files.length)

  // Import/mock/relationship evidence per test file (from the graph).
  // Scoped together with the file set so evidence and files always agree.
  const importRows = raw.prepare(
    "SELECT f.id AS fileId, COALESCE(i.import_path, '') AS target " +
      "FROM brain_file f JOIN brain_import i ON i.file_id = f.id AND i.project_id = f.project_id " +
      "WHERE f.project_id = ? AND COALESCE(f.is_test_file,0) = 1" + scopeSql + codeClause.sql,
  ).all(projectId, ...scopeParams, ...codeClause.params) as Array<{ fileId: string; target: string }>

  const fileImports = new Map<string, string[]>()
  for (const r of importRows) {
    if (!r.target) continue
    const arr = fileImports.get(r.fileId) ?? []
    arr.push(r.target)
    fileImports.set(r.fileId, arr)
  }

  const report: TestQualityFile[] = []
  let analyzed = 0
  const vocabularyCoverage = new Map<string, number>()
  const fallbackLanguages = new Map<string, number>()

  for (const f of files) {
    const imports = fileImports.get(f.id) ?? []
    let content: string | null = null

    if (analyzed < maxFiles) {
      analyzed++
      try {
        const buf = await readFile(f.path)
        content = buf.subarray(0, maxBytes).toString("utf8")
      } catch {
        content = null
      }
    }

    if (content !== null) {
      const measurement = measureTestContent({ relativePath: f.rel, language: f.language, content, imports })
      vocabularyCoverage.set(measurement.vocabulary, (vocabularyCoverage.get(measurement.vocabulary) ?? 0) + 1)
      if (measurement.vocabularyFallback) {
        const lang = measurement.language
        fallbackLanguages.set(lang, (fallbackLanguages.get(lang) ?? 0) + 1)
      }
      report.push({
        relativePath: f.rel,
        overall: overallScore(measurement.dimensions),
        dimensions: measurement.dimensions,
        unsupported: measurement.unsupported,
        issues: measurement.issues,
        strengths: [...measurement.strengths, `vocabulary: ${measurement.vocabulary}`],
      })
    } else {
      // Content unreadable → content-backed dimensions are genuinely unknown, never
      // fabricated. Graph-only evidence (fixtures/mocking by import) still reports.
      const language = String(f.language ?? "")
      const fixtureImports = imports.filter((spec) => (spec.length > 0 && !isRelativeImport(spec) ? !isInfrastructureImport(language, spec) : false))
      const mockImports = imports.filter((spec) => MOCK_LIB_PREFIXES.some((prefix) => spec === prefix || spec.startsWith(prefix + "/")))
      const dims: Record<TestQualityDimensionId, Dim> = {
        assertions: { ...UNKNOWN },
        mocking: mockImports.length > 0 ? dim({ supported: true, evidenceStrength: 0.5, penaltyPotential: 0, observedAnchor: `mock-library import: ${mockImports[0]}`, confidence: 0.8 }) : { ...UNKNOWN },
        error_handling: { ...UNKNOWN },
        parameterization: { ...UNKNOWN },
        docs: { ...UNKNOWN },
        fixtures: dim({ supported: true, evidenceStrength: clamp01(fixtureImports.length / 3), observedAnchor: fixtureImports[0] ?? null, confidence: fixtureImports.length > 0 ? 0.8 : 0.5 }),
      }
      const dimObjs = (Object.keys(dims) as TestQualityDimensionId[]).map((id) => ({ id, ...dims[id] })).sort((a, b) => a.id.localeCompare(b.id))
      report.push({
        relativePath: f.rel,
        overall: overallScore(dimObjs),
        dimensions: dimObjs,
        unsupported: ["assertions", "error_handling", "parameterization", "docs"],
        issues: [],
        strengths: [],
      })
    }
  }

  const aggregate = aggregateQuality(report)
  const unsupportedCount = report.reduce((n, r) => n + r.unsupported.length, 0)
  const vocabularyUnknowns = [...vocabularyCoverage.entries()].map(([vocab, count]) => `language-vocabulary: ${vocab} (${count} file(s))`)
  for (const [lang, count] of fallbackLanguages.entries()) {
    vocabularyUnknowns.push(`language-vocabulary-fallback: ${lang || "unknown"} has no registered vocabulary — measured with the generic superset (${count} file(s)); its assertion idioms may be under-counted`)
  }
  return {
    files: report,
    aggregate,
    provenance: makeProvenance({
      evidenceClass: "static_finding",
      engine: "test-quality@intelligence",
      engineVersion: "m10.03",
      projectId,
      source: "brain_file+brain_import+bounded-source-content",
      limitations: [
        "Content heuristics do not measure runtime assertion effectiveness, branch coverage, mutation score, or flakiness.",
        "Each file is measured with its language's vocabulary; observedAnchor names the observed token, never a hard-coded construct.",
      ],
      sampled: files.length > maxFiles,
      unknowns: [
        ...report.flatMap((file) => file.unsupported).filter((value, index, values) => values.indexOf(value) === index),
        ...vocabularyUnknowns,
        ...(nonCodeTestFiles > 0 ? [nonCodeUnknown(nonCodeTestFiles)!] : []),
        ...(files.length === 0 ? [noEvidenceUnknown()] : []),
      ],
    }),
    summary: {
      filesWithContent: report.filter((r) => r.dimensions.some((d) => d.supported)).length,
      filesUnknown: report.filter((r) => r.overall === null).length,
      unsupportedDimensionCount: unsupportedCount,
      returned: report.length,
      totalFiles: files.length,
      truncated: files.length > maxFiles,
    },
  }
}
