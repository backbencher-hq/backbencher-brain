// Test quality engine (M9.11) — evidence-based, capability-flagged, honest unknowns.
//
// Philosophy:
//   * Every dimension is INDEPENDENTLY measured (never a multiplier of a synthetic overall).
//   * A metric is only reported when it can actually be measured from the index or file
//     content; otherwise it is explicitly `unknown` (supported=false) — never fabricated.
//   * Verify-before-clone: dimensions without a deterministic graph/Table source are only
//     claimed when content evidence is observed with a bounded confident verification.
import { readFile } from "node:fs/promises"
import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type {
  TestQualityDimension,
  TestQualityDimensionId,
  TestQualityFile,
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

/**
 * The content classifiers, exported as one named table.
 *
 * WHY A REGEX IS UNAVOIDABLE HERE. The dimension asks "does this test exercise
 * assertions / error paths / parameterization" across ANY test framework, and
 * the evidence is statement-level source text. A framework-agnostic superset
 * (`assert`, `assert.equal`, `expect(...)`, `should.`, `toBe`, `it.each`,
 * `try {`, `catch (`) cannot be recognised by `includes`/`startsWith` without
 * missing the forms the model exists to count, and the tree-sitter AST does not
 * expose framework assertion calls as a node type. The sets are enumerated,
 * frozen here, and behaviourally tested by
 * `validation/tools/bb_analyze/regex-edge-cases.ts` (empty input, no-match,
 * boundary, Unicode, multiline, long-input timing). Their output only feeds a
 * confidence-weighted score (0.75-0.85 confidence); no resolved-symbol claim is
 * made from them.
 */
export const CONTENT_CLASSIFIERS = {
  // assertions — real API evidence, framework-agnostic superset. `assertCall`
  // covers both `assert(...)` and node-assert's `assert.equal(` / `assert.deepEqual(`
  // family; `chainedMatcher` matches the MATCHER METHOD rather than the
  // receiver, because `expect(a).toBe(1)` has `(a)` between the two (measured
  // by the edge-case suite: the receiver-anchored form matched neither).
  assertCall: /\bassert(?:\.[A-Za-z]+)?\s*\(/g,
  expectCall: /\bexpect\s*\(/g,
  shouldMember: /\bshould\./g,
  chainedMatcher: /\.(?:toBe|toEqual|toStrictEqual|toThrow|toBeTruthy|toBeFalsy|toMatch|toContain|rejects|resolves)\s*\(/g,
  // error handling — rejects/resolves/try-catch/throws
  rejectsResolves: /\b(rejects|resolves)\b/g,
  tryBlock: /\btry\s*\{/g,
  throwMatcher: /\btoThrow|throws\b/g,
  catchClause: /\bcatch\s*\(/g,
  // parameterization — data-driven tests
  parameterized: /\b(?:it|test)\.each\b|\b(?:describe|it|test)\s*\(\s*`|%s|\$[a-zA-Z]/g,
  // docs — comments and long descriptive test names
  commentLine: /(^|\n)\s*(\/\/|\/\*|#)/g,
  longTestName: /\b(?:it|test|describe)\s*\(\s*['"`][^'"`]{24,}['"`]/g,
  // mocking — spy/mock call sites (graph import evidence is separate)
  spyMockCall: /\b(jest|sinon)\.(fn|spyOn|mock)\b|vi\.(fn|spyOn|mock)|\.mockImplementation|nock\(/g,
} as const

/** Mock-library import prefixes: a framework import is graph evidence that the
 *  file builds stubs. `startsWith` on a list, not a regex. */
const MOCK_LIB_PREFIXES = ["jest", "vitest", "mocha", "chai", "sinon", "@sinonjs", "testdouble", "nock", "msw", "@testing-library", "ava", "tap", "node:test"]

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
  const fileMockImport = new Set<string>()
  for (const r of importRows) {
    if (!r.target) continue
    const arr = fileImports.get(r.fileId) ?? []
    arr.push(r.target)
    fileImports.set(r.fileId, arr)
    if (MOCK_LIB_PREFIXES.some((prefix) => r.target.startsWith(prefix))) fileMockImport.add(r.fileId)
  }

  const report: TestQualityFile[] = []
  let analyzed = 0

  for (const f of files) {
    const dims: Record<TestQualityDimensionId, Dim> = {
      assertions: { ...UNKNOWN },
      mocking: { ...UNKNOWN },
      error_handling: { ...UNKNOWN },
      parameterization: { ...UNKNOWN },
      docs: { ...UNKNOWN },
      fixtures: { ...UNKNOWN },
    }
    const issues: TestQualityFile["issues"] = []
    const strengths: string[] = []
    const unsupported: string[] = []
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

    // -- Graph-backed dimensions (always measurable) ------------------------------
    const imports = fileImports.get(f.id) ?? []
    const hasClaims = imports.length > 0
    dims.fixtures = dim({
      supported: true,
      evidenceStrength: clamp01(imports.length / 4), // more distinct imports ≈ richer setup
      observedAnchor: hasClaims ? imports[0] : null,
      confidence: imports.length > 0 ? 0.8 : 0.5,
      relevance: null,
      penaltyPotential: null,
    })
    if (imports.length > 2) strengths.push("rich import surface (indicates composed fixtures)")

    // -- Content-backed dimensions (only when we actually read the file) ---------
    if (content !== null) {
      const c = content
      const count = (re: RegExp) => (c.match(re) || []).length
      const P = CONTENT_CLASSIFIERS

      // The classifier table above documents why these are regexes; every
      // literal is behaviourally tested by validation/tools/bb_analyze/regex-edge-cases.ts.
      const asserts = count(P.assertCall) + count(P.expectCall) + count(P.shouldMember) + count(P.chainedMatcher)
      dims.assertions = dim({
        supported: true,
        evidenceStrength: clamp01(asserts / 6),
        penaltyPotential: asserts === 0 ? 1 : clamp01(1 - asserts / 6),
        observedAnchor: asserts > 0 ? "assert/expect usage" : null,
        confidence: 0.85,
      })
      if (asserts === 0) issues.push({ category: "no_assertion_evidence", description: "no assert/expect statements observed" })
      else strengths.push(`${asserts} assertion site(s)`)

      // Error handling — rejects/resolves/try-catch/throws.
      const err = count(P.rejectsResolves) + count(P.tryBlock) + count(P.throwMatcher) + count(P.catchClause)
      dims.error_handling = dim({
        supported: true,
        evidenceStrength: clamp01(err / 3),
        penaltyPotential: err === 0 ? 1 : clamp01(1 - err / 3),
        observedAnchor: err > 0 ? "rejects/try/catch/throws" : null,
        confidence: 0.8,
      })
      if (err === 0) issues.push({ category: "no_error_path_evidence", description: "no error-path assertion observed" })

      // Parameterization — data-driven tests.
      const param = count(P.parameterized)
      dims.parameterization = dim({
        supported: true,
        evidenceStrength: clamp01(param / 3),
        penaltyPotential: 0, // absence is not penalized heavily
        observedAnchor: param > 0 ? "it.each/test.each template" : null,
        confidence: 0.75,
      })
      if (param > 0) strengths.push("parameterized cases detected")

      // Docs — comments/docblocks + descriptive test names.
      const comments = count(P.commentLine)
      const longNames = count(P.longTestName)
      dims.docs = dim({
        supported: true,
        evidenceStrength: clamp01((comments + longNames) / 6),
        penaltyPotential: clamp01(1 - (comments + longNames) / 6),
        observedAnchor: comments + longNames > 0 ? "comments/descriptive names" : null,
        confidence: 0.7,
      })
    } else {
      // Content unreadable → these dimensions are genuinely unknown, never fabricated.
      unsupported.push("assertions", "error_handling", "parameterization", "docs")
    }

    // Mocking — measurable via graph (mock lib import) OR content-spy evidence.
    const spyHits = content !== null ? (content.match(CONTENT_CLASSIFIERS.spyMockCall) || []).length : 0
    const mockGraph = fileMockImport.has(f.id)
    if (mockGraph || spyHits > 0) {
      dims.mocking = dim({
        supported: true,
        evidenceStrength: clamp01((mockGraph ? 0.5 : 0) + Math.min(spyHits, 4) / 8),
        penaltyPotential: 0,
        observedAnchor: mockGraph ? "mock-library import" : "spy/mock call sites",
        confidence: 0.8,
      })
      strengths.push("mocking evidence present")
    } else if (content !== null) {
      dims.mocking = dim({ supported: true, evidenceStrength: 0, penaltyPotential: 0, confidence: 0.6 })
    }
    // else mocking stays unknown (no content + no graph evidence) — independent unknown.

    // Weighted mean over measured dims only; penalty dims pull down.
    const measured = Object.values(dims).filter((d) => d.supported && d.evidenceStrength !== null)
    let overall: number | null = null
    if (measured.length > 0) {
      let sum = 0
      let w = 0
      for (const d of measured) {
        const conf = d.confidence ?? 0.5
        const penalty = d.penaltyPotential ?? 0
        sum += conf * clamp01((d.evidenceStrength ?? 0) - 0.5 * penalty)
        w += conf
      }
      overall = w > 0 ? sum / w : null
    }

    const dimObjs: TestQualityDimension[] = (Object.keys(dims) as TestQualityDimensionId[]).map((id) => ({
      id,
      ...dims[id],
    }))
    for (const d of dimObjs) if (!d.supported && !unsupported.includes(d.id)) unsupported.push(d.id)

    report.push({
      relativePath: f.rel,
      overall,
      dimensions: dimObjs.sort((a, b) => a.id.localeCompare(b.id)),
      unsupported: unsupported.sort(),
      issues,
      strengths,
    })
  }

  // The page, not the corpus: `maxFiles` bounds how many files are analysed AND
  // how many are returned. The rows used to be unfiltered, so `limit: 1`
  // answered three files — a `limit` that did not bound the answer, which is the
  // one thing a page-size parameter must never do.
  const page = report.slice(0, maxFiles)
  // Aggregate over the PAGE: content is only read for the page's rows, so an
  // aggregate over the rest would describe measurements that were never taken.
  const overalls = page.map((r) => r.overall).filter((x): x is number => x !== null)
  const perDim: Record<string, number | null> = {}
  for (const id of ["assertions", "mocking", "error_handling", "parameterization", "docs", "fixtures"] as const) {
    const vals = page.flatMap((r) => r.dimensions.filter((d) => d.id === id && d.evidenceStrength !== null).map((d) => d.evidenceStrength as number))
    perDim[id] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }

  const unsupportedCount = page.reduce((n, r) => n + r.unsupported.length, 0)
  return {
    files: page,
    aggregate: { mean: overalls.length > 0 ? overalls.reduce((a, b) => a + b, 0) / overalls.length : null, perDimension: perDim },
    provenance: makeProvenance({ evidenceClass: "static_finding", engine: "test-quality@intelligence", engineVersion: "m10.02", projectId, source: "brain_file+brain_import+bounded-source-content", limitations: ["Content heuristics do not measure runtime assertion effectiveness, branch coverage, mutation score, or flakiness."], sampled: files.length > maxFiles, unknowns: [...page.flatMap((file) => file.unsupported).filter((value, index, values) => values.indexOf(value) === index), ...(nonCodeTestFiles > 0 ? [nonCodeUnknown(nonCodeTestFiles)!] : []), // A zero-code-test corpus must disclose WHY it is zero — the
        // same honesty rule testGaps/testMapping already follow.
        ...(files.length === 0 ? [noEvidenceUnknown()] : [])] }),
    summary: {
      filesWithContent: page.filter((r) => r.dimensions.some((d) => d.supported)).length,
      filesUnknown: page.filter((r) => r.overall === null).length,
      unsupportedDimensionCount: unsupportedCount,
      // Rows returned against the population they were drawn from, so a page is
      // never read as the whole corpus.
      returned: page.length,
      totalFiles: files.length,
      truncated: files.length > page.length,
    },
  }
}
