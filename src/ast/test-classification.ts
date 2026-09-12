// src/ast/test-classification.ts — M57.T1/T5 (#789, #793)
//
// ONE definition of "what is a test file", consumed by the indexer's
// is_test_file flag, the analysis-exclusion predicates, and the test-intel
// read tools. Before M57 two detectors disagreed: the indexer flagged
// directory segments with no regard for file type (all 30 flagged files on the
// real index were JSON data fixtures), while AnalysisExclusions.isTestPath
// used name-shape rules (`_test.go`, `Tests?` stem) with no file-type gate.
//
// The rule, in order:
//   1. A file that is not CODE is never a test file (the file-type gate).
//   2. A code file IS a test file when its path shape says so: a test/spec/e2e
//      directory segment, a `.test.`/`.spec.` infix, a `test_|spec_` prefix,
//      a `_test.`/`_spec.` infix (Go/Rust style), or a `Tests?` stem suffix.
//
// The non-code vocabulary lives here so M50's test-intel fix and this
// classifier share one definition (they must never drift apart again).

/** Non-code formats: data, config, docs, generated output. Never test files. */
export const NON_CODE_TEST_LANGUAGES = [
  "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "md", "markdown",
  "txt", "csv", "tsv", "xml", "svg", "lock", "log", "sql", "graphql", "proto",
] as const

const NON_CODE_LANG_SET = new Set<string>(NON_CODE_TEST_LANGUAGES)

/** Extension fallback when no stored language is available. */
const NON_CODE_EXTENSIONS = [
  ".json", ".jsonc", ".json5", ".yaml", ".yml", ".toml", ".ini", ".md",
  ".markdown", ".txt", ".csv", ".tsv", ".xml", ".svg", ".lock", ".log",
  ".graphql", ".gql", ".proto", ".snap", ".env",
]

const TEST_DIR_SEGMENTS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"])

export function isNonCodeLanguage(language: string | null | undefined): boolean {
  if (!language) return false
  return NON_CODE_LANG_SET.has(language.toLowerCase())
}

function hasNonCodeExtension(relativePath: string): boolean {
  const lower = relativePath.toLowerCase()
  return NON_CODE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function pathShapeSaysTest(relativePath: string): boolean {
  const segments = relativePath.split("/")
  const base = segments[segments.length - 1]
  const lower = base.toLowerCase()
  if (segments.slice(0, -1).some((s) => TEST_DIR_SEGMENTS.has(s.toLowerCase()))) return true
  if (lower.includes(".test.") || lower.includes(".spec.")) return true
  if (lower.startsWith("test_") || lower.startsWith("spec_")) return true
  if (/(_test|_spec)\.[a-z]+$/.test(lower)) return true
  const dot = lower.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  return /Tests?$/.test(stem)
}

/**
 * The canonical predicate. `language` is the indexer's stored language (may be
 * null for pre-classification calls — the extension fallback then applies).
 * Order matters: the file-type gate wins over ANY path shape.
 */
export function isTestFileCandidate(relativePath: string, language?: string | null): boolean {
  if (isNonCodeLanguage(language) || (!language && hasNonCodeExtension(relativePath))) return false
  return pathShapeSaysTest(relativePath)
}
