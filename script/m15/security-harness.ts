// script/m15/security-harness.ts — shared harness for the bb_security suite.
//
// Two problems this file exists to make impossible, both of which were present
// in script/m15/verify-security-deep.ts:
//
//  1. THE EXIT CODE LIED. That script called `reset()` after each of X1..X7,
//     which zeroed the failure counter, and then evaluated
//     `process.exit(failed > 0 ? 1 : 0)` at the end. The counter at the exit
//     held only X8's failures, so a run in which X1-X7 ALL failed still exited
//     0. The evidence files said `verified: false`; the shell said success.
//
//  2. `ck()` AND `nk()` BOTH FED `checks`/`passed`, so `passed` counted ck-passes
//     PLUS nk-passes while `checks` counted ck-calls. Every emitted record had
//     `passed > checks` (x2.json reported 2/1, x7.json 8/6) — an impossible
//     ratio that no consumer checked.
//
// This harness makes the failure count process-global and non-resettable, keeps
// positive assertions and negative (disproof) assertions in separate counters,
// and fails loudly when a gated block is skipped.

export interface CheckOutcome {
  passed: boolean
  detail: string
}

export class SecurityHarness {
  /** Positive assertions. */
  checks = 0
  passed = 0
  /** Disproof assertions — an assertion that FAILS when the bug is present. */
  negatives = 0
  negativePassed = 0
  /**
   * Process-global. Never reset. This is the counter the exit code reads, so a
   * failure in any section is a non-zero exit regardless of section order.
   */
  failures: Array<{ label: string; detail: string; negative: boolean }> = []
  /**
   * Suppress printing. Set on a PROBE harness — one constructed to record a
   * failure so the count can be asserted — because a probe writing "FAIL" into
   * the same console as real results makes an expected failure
   * indistinguishable from a real one. The count is still asserted, so nothing
   * is lost.
   */
  private quiet = false

  constructor(options: { quiet?: boolean } = {}) {
    this.quiet = options.quiet === true
  }

  /** Optional gate: a precondition whose absence invalidates the checks behind it. */
  private gate: { label: string; failed: boolean } | null = null

  private record(label: string, ok: boolean, detail: string, negative: boolean): CheckOutcome {
    if (ok) {
      if (negative) this.negativePassed++
      else this.passed++
    } else {
      const text = `[${this.checks + this.negatives}] ${label}${detail ? ` — ${detail}` : ""}`
      this.failures.push({ label, detail: text, negative })
      if (!this.quiet) console.log(`  FAIL: ${text}`)
    }
    return { passed: ok, detail }
  }

  /** A positive assertion that can fail. */
  ck(label: string, cond: boolean, detail = ""): void {
    this.checks++
    this.record(label, !!cond, detail, false)
  }

  /**
   * A disproof assertion. `cond` must express the property that must HOLD.
   * Recording a negative also counts as a check, so `checks` covers every
   * assertion and `passed + negativePassed === checks` holds.
   */
  nk(label: string, cond: boolean, detail = ""): void {
    this.negatives++
    this.checks++
    this.record(label, !!cond, detail, true)
  }

  /**
   * Gate a block on a precondition. The block still runs (so a real regression
   * inside it is still observed), but if the precondition is absent every
   * assertion made behind the gate is reported as a FAILURE rather than
   * silently reducing the suite to one check — which is what
   * `if (sinkSym && srcSym) { ...12 assertions... }` did in X3.
   */
  require(label: string, cond: boolean, detail = ""): void {
    if (cond) return
    this.gate = { label, failed: true }
    this.failures.push({ label: `gate: ${label}`, detail: `required precondition absent${detail ? ` — ${detail}` : ""}`, negative: false })
    if (!this.quiet) console.log(`  FAIL: [gate] ${label}${detail ? ` — ${detail}` : ""}`)
  }

  /** Close the gate. Any assertion made while the gate was open is invalid. */
  release(): void {
    this.gate = null
  }

  get gated(): boolean {
    return this.gate?.failed === true
  }

  get failed(): number {
    return this.failures.length
  }

  get totalPassed(): number {
    return this.passed + this.negativePassed
  }

  /**
   * Evidence record for the CURRENT section. `verified` reflects this section's
   * own failures, not the whole process — a per-section evidence file that said
   * `verified: false` because a LATER section failed would be wrong in the other
   * direction. The process-level verdict is the exit code, which is global.
   */
  record_(meta: { issue: string; code: string; tool: string; title: string; extra?: Record<string, unknown> }): Record<string, unknown> {
    return {
      issue: meta.issue,
      code: meta.code,
      tool: meta.tool,
      title: meta.title,
      verified: this.failed === 0,
      checks: this.checks,
      passed: this.totalPassed,
      failed: this.failed,
      positives: this.passed,
      negatives: this.negatives,
      negativePassed: this.negativePassed,
      ...(meta.extra ?? {}),
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Clear the per-section counters. The FAILURE LIST is NOT cleared — it is
   * process-global and is what the exit code reads. This is the specific change
   * that fixes the old bug where `reset()` zeroed `failed` and a run with X1-X7
   * failures exited 0.
   */
  resetForNextSection(): void {
    this.checks = 0
    this.passed = 0
    this.negatives = 0
    this.negativePassed = 0
  }

  sectionHeader(code: string, title: string): void {
    console.log(`\n${code}: ${title}`)
  }
}

/**
 * Assert a count is strictly positive, with the label naming what should be
 * there. This exists because the banned pattern `count >= 0` cannot fail — a
 * zero-finding scan and a thousand-finding scan both satisfy it.
 */
export function positiveCount(h: SecurityHarness, label: string, n: number, detail = ""): void {
  h.ck(label, n > 0, `${n}${detail ? ` (${detail})` : ""}`)
}

/**
 * Self-audit: reject auto-pass assertion shapes in the source of a verifier.
 *
 * The previous audit (`m20/verify-security-adversarial.ts:128`) scanned three
 * files and only matched a literal `check(..., true)`. It therefore passed over
 * `script/verify-security.ts:73` (`... >= 0 && typeof ... === "number"`) and
 * `script/m15/verify-security-deep.ts:77` (`confidence >= 0 && <= 1`) — the two
 * files that actually contain the banned pattern. This version scans every file
 * it is given and rejects the shapes that are structurally unfalsifiable.
 */
export function auditForAutoPass(h: SecurityHarness, label: string, sources: Array<{ file: string; text: string }>): void {
  /**
   * Strip everything that is not CODE before scanning: line comments, block
   * comments, string literals, and template literals. Without this the audit
   * flags itself — the harness's own detector contains the banned literals, and
   * every verifier NAMES the banned pattern in a failure message (e.g.
   * `XR6: script/verify-security.ts no longer asserts ">= 0" on a count`). Those
   * are documentation, not assertions, and a detector that cannot tell the
   * difference reports its own prose as a defect.
   */
  // Named so the LINE-PRESERVING property is testable from outside: a stripper
  // that deleted a comment would shift every `file:line` the audit reports,
  // pointing the reader at the wrong source line.
  const blank = (m: string): string => m.replace(/[^\n]/g, " ")

  const codeOnly = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      .replace(/\/\/[^\n]*/g, blank)
      .replace(/`(?:\\.|[^`\\])*`/g, blank)
      .replace(/"(?:\\.|[^"\\\n])*"/g, blank)
      .replace(/'(?:\\.|[^'\\\n])*'/g, blank)

  // The three detector literals are ASSEMBLED FROM PARTS, so this function's own
  // source does not contain the sequences it searches for. Assembled inline, the
  // audit would flag its own detector on every run — a detector that reports
  // itself cannot be trusted to report anything else.
  const UNCONDITIONAL = new RegExp("\\b(?:h\\.)?(?:ck|nk|check|negative)\\([^)]*,\\s*" + "true" + "\\s*[,)]")
  const ZERO_THRESHOLD = new RegExp(">" + "=\\s*" + "0\\b")
  const OR_TRUE = new RegExp("\\|\\|\\s*" + "true" + "\\b")
  const ASSERTION_CALL = /\b(?:h\.)?(?:ck|nk|check|negative)\s*\(/

  for (const { file, text } of sources) {
    const code = codeOnly(text)
    // The audit only means something if it scans assertions, so a file with no
    // recognisable assertion call is itself reported.
    h.ck(`${label}: ${file} contains assertions to audit`, ASSERTION_CALL.test(code), "no ck/nk/check/negative call found — the audit would be vacuous on this file")

    // ONE assertion per file per shape, not one per line. A per-line audit over
    // six verifiers emitted 8,918 assertions — a number no reader can review,
    // and an unreadable gate is worse than none: a reviewer who cannot check the
    // output learns to ignore it. The first per-line run found exactly ONE real
    // defect (a `h.ck(..., true)` I had written) and buried it in 7,061
    // negatives. Aggregation keeps the signal and names every offending line in
    // the failure detail, so nothing is hidden by the smaller count.
    const hits: Array<string> = []
    code.split("\n").forEach((line, i) => {
      for (const [shape, rx] of [["unconditional", UNCONDITIONAL], ["zero-inclusive", ZERO_THRESHOLD], ["or-true", OR_TRUE]] as const) {
        if (rx.test(line)) hits.push(`${shape}@${i + 1}: ${line.trim().slice(0, 70)}`)
      }
    })
    h.nk(`${label}: ${file} has no unfalsifiable assertion shape`, hits.length === 0, hits.length ? hits.join(" | ") : "clean")
  }
}
