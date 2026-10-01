import { notLike, sql, type SQL } from "drizzle-orm"
import { BrainFileTable, BrainSymbolTable } from "../brain/brain.sql"
import { isTestFileCandidate } from "./test-classification"

// Directory segments that hold generated reference output or third-party code.
// Files under these paths must never surface in analysis results.
const NOISE_DIR_SEGMENTS = new Set([
  "baselines",
  "snapshots",
  "__snapshots__",
  "__generated__",
  "generated",
  "gen",
  "fixtures",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "__pycache__",
])

// M57.T5: the test-dir segment set and the name-shape rules now live in
// test-classification.ts (ONE definition). TEST_DIR_SEGMENTS is kept only for
// the exclusion-SQL builders below, which need the raw segment list.
const TEST_DIR_SEGMENTS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"])

const NOISE_FILE_PATTERNS = [
  /\.d\.[a-z]+$/,
  /\.(min|-min)\.[a-z]+$/,
  /\.(bundle|chunk)\.[a-z]+$/,
  /\.map$/,
  /\.(generated|gen)\.[a-z]+$/i,
  /\.g\.(cs|ts|js|fs)$/i,
  // NOTE: .json is deliberately absent — the JSON analyzer is a verified
  // contract (M12.34, P/R 1.000) whose module/class/property symbols must
  // reach the read surface. Genuinely noisy JSON (package-lock.json,
  // openapi.json, schema.json, *.min.json, Az.*.json, ...) is already
  // excluded at INDEX time by ParallelIndexerConfig.skipPatterns.
]

// Suffix patterns for LIKE-based SQL filtering (mirrors NOISE_FILE_PATTERNS).
const EXCLUDED_FILE_LIKES = [
  "%.d.ts",
  "%.d.mts",
  "%.d.cts",
  "%.min.%",
  "%-min.%",
  "%.bundle.%",
  "%.chunk.%",
  "%.generated.%",
  "%.map",
]

function allExcludedSegments(): string[] {
  return Array.from(new Set([...NOISE_DIR_SEGMENTS, ...TEST_DIR_SEGMENTS]))
}

/** Kept for the SQL LIKE builders; the predicate itself is test-classification.isTestFileCandidate. */
function isTestFileName(base: string): boolean {
  const lower = base.toLowerCase()
  if (lower.includes(".test.") || lower.includes(".spec.")) return true
  if (lower.startsWith("test_") || lower.startsWith("spec_")) return true
  if (/(_test|_spec)\.[a-z]+$/.test(lower)) return true
  const dot = lower.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  return /Tests?$/.test(stem)
}

export function isHardNoisePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase()
  if (NOISE_FILE_PATTERNS.some((pattern) => pattern.test(lower))) return true
  return lower.split("/").some((segment) => NOISE_DIR_SEGMENTS.has(segment))
}

export function isTestPath(relativePath: string): boolean {
  // M57.T5 (#793): delegate to the ONE canonical predicate. The path-shape
  // rules are identical; the file-type gate inside the predicate treats a
  // missing language as "unknown, decide by extension" — for extension-based
  // callers this is exactly the old behavior PLUS the gate, so *.json under a
  // /spec/ dir is no longer "test" here either (it was excluded downstream by
  // isHardNoisePath orderings before; now the predicate says so directly).
  return isTestFileCandidate(relativePath)
}

export function isAnalysisExcluded(relativePath: string): boolean {
  return isHardNoisePath(relativePath) || isTestPath(relativePath)
}

export function isNoiseSymbolName(name: string): boolean {
  if (!name) return true
  if (name.length > 500) return true
  // Synthesized placeholder symbols.
  if (/^(anonymous|anon|unnamed)[_-]/i.test(name)) return true
  if (/^(block|lambda)[_-]\d+/i.test(name)) return true
  if (/^object_\d+$/.test(name)) return true
  // Language keywords indexed as symbols by imperfect parsers.
  if (/^(this|global|window|self|super|arguments|undefined|null)$/.test(name)) return true
  // Absolute file paths indexed as symbol names (indexer artifact).
  if (name.startsWith("/") && name.includes("/")) return true
  // NOTE: soft rules (quoted names, parenthesized names, numeric prefixes,
  // embedded whitespace, pure punctuation) AND dotted-chain names are
  // deliberately absent — they are VERIFIED symbol contracts (CSS selectors
  // like tr[data-order="1001"], F# active patterns (|Even|Odd|), Markdown
  // headings like "1.0.0 - 2026-01-01", YAML merge keys <<, and dotted
  // identifiers like Clojure namespaces com.example.clojure.service and HCL
  // resources aws_security_group.web) that the store layer now persists
  // intentionally. Property-access noise is already excluded at store time.
  return false
}

/**
 * Store-time artifact check for VERIFIED ANALYZER output: unambiguous garbage
 * that can never be a legitimate symbol. Deliberately narrow — quoted names
 * (CSS attribute selectors), parenthesized names (F# active patterns),
 * numeric prefixes and whitespace (Markdown version/heading symbols) and
 * punctuation-only names (YAML merge keys) are all VERIFIED symbol contracts
 * (P/R 1.000 against hand-audited ground truth) and must reach the index.
 * Dotted chains are NOT dropped here either — Dart named constructors
 * (Type.fromJson) are legitimate and must reach the index.
 */
export function isIndexArtifactName(name: string): boolean {
  if (!name) return true
  if (name.length > 500) return true
  if (/^(anonymous|anon|unnamed)[_-]/i.test(name)) return true
  if (/^(block|lambda)[_-]\d+/i.test(name)) return true
  if (/^object_\d+$/.test(name)) return true
  // Language keywords can never be declared identifiers in real code.
  if (/^(this|global|window|self|super|arguments|undefined|null)$/.test(name)) return true
  // Absolute file paths indexed as symbol names.
  if (name.startsWith("/") && name.includes("/")) return true
  return false
}

/**
 * Full store-time artifact check for FALLBACK results (regex-extracted or
 * large-file structural extraction): the narrow hard set PLUS the soft rules
 * that are legitimate in verified analyzer output but pure garbage in regex
 * extraction — quoted string leaks, parenthesized placeholders, numeric
 * literals, embedded whitespace, and pure punctuation.
 */
export function isIndexArtifactNameStrict(name: string): boolean {
  if (isIndexArtifactName(name)) return true
  if (name.includes('"') || name.includes("'")) return true
  if (name.startsWith("(")) return true
  // Numeric garbage parsed from fixtures (-1.0, 0.000…, 1.., .1, 1.2e-20).
  if (/^[+-]?[.\d]/.test(name)) return true
  // Embedded whitespace is a parse artifact; C++ operator names are the exception.
  if (name.includes(" ") && !name.startsWith("operator")) return true
  // Pure punctuation garbage.
  return !/[\p{L}]/u.test(name)
}

// Drizzle conditions for queries that join brain_file as BrainFileTable.
// Covers stale rows indexed before exclusion rules existed, so path checks
// are required even when is_test_file is correct.
export function analysisScopeConditions(): SQL[] {
  return [
    sql`COALESCE(${BrainFileTable.is_test_file}, 0) = 0`,
    ...allExcludedSegments().flatMap((segment) => [
      notLike(BrainFileTable.relative_path, `${segment}/%`),
      notLike(BrainFileTable.relative_path, `%/${segment}/%`),
    ]),
    ...EXCLUDED_FILE_LIKES.map((pattern) => notLike(BrainFileTable.relative_path, pattern)),
  ]
}

// Raw SQL variant for prepared statements that join brain_file under custom aliases.
export function analysisPathScopeSQL(...fileAliases: string[]): string {
  const clauses: string[] = []
  for (const alias of fileAliases) {
    clauses.push(`COALESCE(${alias}.is_test_file, 0) = 0`)
    for (const segment of allExcludedSegments()) {
      clauses.push(`${alias}.relative_path NOT LIKE '${segment}/%'`)
      clauses.push(`${alias}.relative_path NOT LIKE '%/${segment}/%'`)
    }
    for (const pattern of EXCLUDED_FILE_LIKES) {
      clauses.push(`${alias}.relative_path NOT LIKE '${pattern}'`)
    }
  }
  return clauses.join(" AND ")
}

// Symbol-name noise mirrors isIndexArtifactName for SQL-side filtering.
// Soft patterns (quoted names, parenthesized names like F# active patterns,
// numeric prefixes) are intentionally absent: they are VERIFIED symbol
// contracts (CSS attribute selectors, (|Even|Odd|), version headings) that
// the store layer now persists intentionally.
const NOISE_NAME_LIKES = ["anonymous%", "anon_%", "unnamed_%", "block_%", "lambda_%", "/%"]

const NOISE_NAME_GLOBS = ["object_[0-9]*"]
const NOISE_KEYWORD_NAMES = ["this", "global", "window", "self", "super", "arguments", "undefined", "null"]

export function analysisSymbolNameConditions(): SQL[] {
  return [
    ...NOISE_NAME_LIKES.map((pattern) => notLike(BrainSymbolTable.name, pattern)),
    ...NOISE_NAME_GLOBS.map((pattern) => sql`${BrainSymbolTable.name} NOT GLOB ${pattern}`),
    sql`${BrainSymbolTable.name} NOT IN (${sql.join(NOISE_KEYWORD_NAMES.map((k) => sql`${k}`), sql`, `)})`,
    sql`LENGTH(${BrainSymbolTable.name}) < 200`,
    // Symbols without a real location can't be jumped to — indexer artifacts.
    sql`COALESCE(${BrainSymbolTable.line_start}, 0) > 0`,
    // Absolute paths indexed as names (indexer artifact).
    notLike(BrainSymbolTable.name, "/%/%"),
  ]
}

export function analysisSymbolNameScopeSQL(symbolAlias: string): string {
  const clauses = NOISE_NAME_LIKES.map((pattern) => `${symbolAlias}.name NOT LIKE '${pattern}'`)
  clauses.push(...NOISE_NAME_GLOBS.map((pattern) => `${symbolAlias}.name NOT GLOB '${pattern}'`))
  clauses.push(`${symbolAlias}.name NOT IN (${NOISE_KEYWORD_NAMES.map((k) => `'${k}'`).join(",")})`)
  clauses.push(`LENGTH(${symbolAlias}.name) < 200`)
  clauses.push(`COALESCE(${symbolAlias}.line_start, 0) > 0`)
  clauses.push(`${symbolAlias}.name NOT LIKE '/%/%'`)
  return clauses.join(" AND ")
}

export * as AnalysisExclusions from "./analysis-exclusions"
