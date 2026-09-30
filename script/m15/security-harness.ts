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

  /** Optional gate: a precondition whose absence invalidates the checks behind it. */
  private gate: { label: string; failed: boolean } | null = null

  private record(label: string, ok: boolean, detail: string, negative: boolean): CheckOutcome {
    if (ok) {
      if (negative) this.negativePassed++
      else this.passed++
    } else {
      const text = `[${this.checks + this.negatives}] ${label}${detail ? ` — ${detail}` : ""}`
      this.failures.push({ label, detail: text, negative })
      console.log(`  FAIL: ${text}`)
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
    console.log(`  FAIL: [gate] ${label}${detail ? ` — ${detail}` : ""}`)
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
  for (const { file, text } of sources) {
    // Strip line comments so a prohibition named in prose is not self-flagged.
    const code = text.replace(/\/\/[^\n]*/g, "")
    const lines = code.split("\n")
    lines.forEach((line, i) => {
      const at = `${file}:${i + 1}`
      h.nk(
        `${label}: ${at} has no unconditional assertion`,
        !/\b(?:ck|nk|check|negative)\([^)]*,\s*true\s*[,)]/.test(line),
        `unconditional assertion: ${line.trim().slice(0, 90)}`,
      )
      h.nk(
        `${label}: ${at} has no zero-true threshold`,
        !/>=\s*0\b/.test(line),
        `>= 0 is satisfied by an empty set: ${line.trim().slice(0, 90)}`,
      )
      h.nk(
        `${label}: ${at} has no || true escape`,
        !/\|\|\s*true\b/.test(line),
        `|| true makes the assertion unfalsifiable: ${line.trim().slice(0, 90)}`,
      )
    })
  }
}
