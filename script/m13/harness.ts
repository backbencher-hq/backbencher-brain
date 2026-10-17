// script/m13/harness.ts — shared M13 verification harness (B2 + B3).
//
// One definition of "verified" for every M13 tool issue:
//   - every check passes,
//   - at least one negative (adversarial) case is asserted,
//   - evidence is emitted as machine-readable JSON at validation/m13/results/<code>.json.
//
// A verifier that only runs positive fixtures can never reach `verified` — it is
// capped at `partial`. This is the structural fix for the previous "PASS" that hid
// broken work behind positive-only fixtures.

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * True when a result carries no NaN similarity.
 *
 * The predicate that matters is "not a non-finite NUMBER", not
 * `Number.isFinite(value)`. `SemanticResult.similarity` is `number | null`, and
 * null is the DECLARED marker for "no similarity was computed": a
 * keyword-fallback result is not vector-ranked, so it carries null — and never
 * carried 0, because a zero is a number and consumers treated it as one. See
 * the fallback in `src/intelligence/search/semantic-search.ts`.
 *
 * `Number.isFinite(null)` is false, so using it here fails on a CORRECT result.
 * That went unnoticed because the adversarial and integration scenarios used to
 * return no results at all, and `[].every(...)` is vacuously true. It surfaced
 * when the body column and the terms route made a previously-unmatchable query
 * matchable — i.e. an assertion that separated "no results" from "bad results"
 * only by accident was not asserting anything.
 */
export function noNanSimilarity(row: { similarity?: unknown }): boolean {
  return typeof row.similarity === "number" ? Number.isFinite(row.similarity) : row.similarity === null
}

// The layer vocabulary is SHARED by every milestone that emits through this
// harness. `wire` and `performance` were added when the M64 bb_health battery
// arrived (script/m64/verify-wire.ts drives the real MCP stdio path;
// script/m64/verify-embed-scan.ts asserts cost bounds) — a document may not name
// a layer outside this closed set, and a layer name classifies WHERE the checks
// ran rather than claiming what they covered, which is `checks`/`summary`'s job.
export type EvidenceLayer = "unit" | "integration" | "e2e" | "corpus" | "wire" | "performance"
export const EVIDENCE_LAYERS: readonly EvidenceLayer[] = ["unit", "integration", "e2e", "corpus", "wire", "performance"]
export type EvidenceState = "verified" | "partial" | "known-gap" | "untested"

export interface EvidenceCheck {
  name: string
  pass: boolean
  negative?: boolean
  detail?: string
}

export interface EvidenceMeta {
  issue: string
  code: string
  tool: string
  title: string
  /** Which verification layers this issue's checks exercise. */
  layers: EvidenceLayer[]
  decisions?: Record<string, unknown>
  limitations?: string[]
  /**
   * Which milestone's identity this document carries (default "M13").
   *
   * It exists because a LATER milestone reuses this harness: script/m64's eight
   * bb_health verifiers emit through it. Without a way to declare their identity
   * the harness stamped every one of them `milestone: "M13"` while their `issue`
   * said `M64`, and wrote them into `validation/m13/results/` — so M13's evidence
   * census read eight foreign documents, each internally contradictory, and
   * rejected all eight (correctly) for belonging to someone else.
   */
  milestone?: string
  /** Where write()/emit() put the document. Defaults to validation/<milestone>/results. */
  resultsDir?: string
}

export interface EvidenceDocument {
  schemaVersion: 1
  milestone: string
  issue: string
  code: string
  tool: string
  title: string
  verifiedState: EvidenceState
  layers: EvidenceLayer[]
  checks: EvidenceCheck[]
  negativeCases: number
  summary: { total: number; passed: number; failed: number }
  decisions: Record<string, unknown>
  limitations: string[]
  generatedAt: string
}

/**
 * The results directory for a milestone: `validation/<milestone>/results`.
 *
 * One function rather than a literal per caller, so a reusing milestone (M64)
 * cannot keep writing into another milestone's corpus by accident — which is
 * exactly the misfile this replaced.
 */
export function resultsDirFor(milestone: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "validation", milestone.toLowerCase(), "results")
}

export class Harness {
  private checks: EvidenceCheck[] = []
  private failures = 0
  private negatives = 0

  constructor(readonly meta: EvidenceMeta, private silent = false) {}

  private log(line: string): void {
    if (!this.silent) console.log(line)
  }

  check(name: string, pass: boolean, detail = ""): void {
    this.checks.push({ name, pass, detail })
    if (!pass) this.failures++
    this.log(`  ${pass ? "ok" : "FAIL"}: ${name}${detail ? ` ${detail}` : ""}`)
  }

  /** Assert fn() throws, optionally matching `fragment`. Always counts as a negative case. */
  rejects(name: string, fn: () => unknown, fragment?: string): void {
    let error = ""
    try {
      fn()
    } catch (e) {
      error = String(e)
    }
    const threw = error.length > 0
    const matches = !fragment || error.includes(fragment)
    this.negatives++
    const label = fragment ? `${name} [negative: ${fragment}]` : `${name} [negative]`
    const detail = threw ? (matches ? "" : `threw but missing "${fragment}": ${error.slice(0, 140)}`) : "did not throw"
    this.checks.push({ name: label, pass: threw && matches, negative: true, detail })
    if (!(threw && matches)) this.failures++
    this.log(`  ${threw && matches ? "ok" : "FAIL"}: ${label}${detail ? ` ${detail}` : ""}`)
  }

  /** Async variant of rejects(). */
  async rejectsAsync(name: string, fn: () => Promise<unknown>, fragment?: string): Promise<void> {
    let error = ""
    try {
      await fn()
    } catch (e) {
      error = String(e)
    }
    const threw = error.length > 0
    const matches = !fragment || error.includes(fragment)
    this.negatives++
    const label = fragment ? `${name} [negative: ${fragment}]` : `${name} [negative]`
    const detail = threw ? (matches ? "" : `threw but missing "${fragment}": ${error.slice(0, 140)}`) : "did not throw"
    this.checks.push({ name: label, pass: threw && matches, negative: true, detail })
    if (!(threw && matches)) this.failures++
    this.log(`  ${threw && matches ? "ok" : "FAIL"}: ${label}${detail ? ` ${detail}` : ""}`)
  }

  /** Record an adversarial (negative) check with an explicit pass boolean. */
  negative(name: string, pass: boolean, detail = ""): void {
    this.negatives++
    this.checks.push({ name: `${name} [negative]`, pass, negative: true, detail })
    if (!pass) this.failures++
    this.log(`  ${pass ? "ok" : "FAIL"}: ${name} [negative]${detail ? ` ${detail}` : ""}`)
  }

  /** Assert a value is a JSON-string deep equal of another (negative if unequal). */
  equals(name: string, actual: unknown, expected: unknown): void {
    this.check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual).slice(0, 120)}`)
  }

  /** Compute the evidence state from the recorded checks. */
  state(): EvidenceState {
    const allPass = this.failures === 0
    const hasNegative = this.negatives > 0
    if (allPass && hasNegative) return "verified"
    if (allPass) return "partial"
    return "known-gap"
  }

  /** Build the evidence document (does not write or exit). */
  document(): EvidenceDocument {
    const summary = {
      total: this.checks.length,
      passed: this.checks.filter((c) => c.pass).length,
      failed: this.failures,
    }
    return {
      schemaVersion: 1,
      milestone: this.meta.milestone ?? "M13",
      issue: this.meta.issue,
      code: this.meta.code,
      tool: this.meta.tool,
      title: this.meta.title,
      verifiedState: this.state(),
      layers: this.meta.layers,
      checks: this.checks,
      negativeCases: this.negatives,
      summary,
      decisions: this.meta.decisions ?? {},
      limitations: this.meta.limitations ?? [],
      generatedAt: new Date().toISOString(),
    }
  }

  /** Write evidence JSON to validation/<milestone>/results/<code>.json (no exit). */
  write(codeOverride?: string): EvidenceDocument {
    const doc = this.document()
    const outPath = resolve(
      this.meta.resultsDir ?? resultsDirFor(doc.milestone),
      `${(codeOverride ?? this.meta.code).toLowerCase()}.json`,
    )
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n")
    console.log(
      `${this.meta.code}: ${doc.verifiedState.toUpperCase()} (${doc.summary.passed}/${doc.summary.total} passed, ${this.negatives} negative${this.negatives === 1 ? "" : "s"})`,
    )
    return doc
  }

  /** Write evidence JSON to validation/m13/results/<code>.json and exit non-zero on failure. */
  emit(): never {
    const doc = this.write()
    process.exit(doc.summary.failed === 0 ? 0 : 1)
  }
}
