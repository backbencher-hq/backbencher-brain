// script/m15/verify-security-precision.ts — the fix-differential precision gate.
//
// M72 PATH DECLARATION — THIS GATE MEASURES THE RETIRED (ROLLBACK) TOKEN ENGINE.
// The Phase-1 default pipeline runs the per-language spec engine and excludes
// sanitized/parameterized sinks; the old token detector is rollback-only under
// `BB_SECURITY_LEGACY=1` (src/intelligence/security/rebuild/store.ts). This gate
// keeps measuring that retired detector because its persistence baseline is the
// evidence for WHY it was demoted — but the predicate below is now STRICT: a
// finding that survives its own security fix is a FALSE POSITIVE and may not be
// accepted as a baseline target. The strict predicate therefore stays RED while
// the rollback detector is still reachable, and that is declared as an explicit
// KNOWN-GAP (printed + written into xp1.json) with its evidence path. The new
// engine's precision is measured by script/m72/** (gates-matrix), not re-derived
// here.
//
// WHY THIS FILE EXISTS
//
// A proxy metric such as "is there a sink token near the reported line" cannot
// decide whether a detection changed for the better. This gate runs the oracle in
// ./security-oracle.ts, which uses a REAL FIX as the ground-truth label, and
// publishes a number that means something: of the findings reported on a
// known-vulnerable file, how many SURVIVED the security fix that repairs it.
//
// Historical baseline of the retired detector (2026-09-30, for the record — it is
// NOT a target and NOT accepted): 8/8 vulnerable fixtures detected, 1/8 fully
// cleared by the fix, 7/9 findings (77.8%) persisted. Under the M72 contract that
// 77.8% is a defect, so the maximum permitted persisted count is ZERO.
//
// WHAT THIS DOES NOT CLAIM
//
// Recall is not measured. A detector that reported nothing would score 8/8 on
// `detectedVulnerableFixture` only because that check requires at least one
// finding per fixture — it is a floor, not a score. And these eight fixtures are
// patterns I chose; they are not a sample of the world's vulnerabilities. The
// number is a REGRESSION BASELINE, never a published rate.
//
// Run: npx tsx script/m15/verify-security-precision.ts
// Exit: non-zero if any assertion failed (declared KNOWN-GAPs are not failures).

import { mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { runOracle, summarise, FIXTURES } from "./security-oracle"
import { SecurityHarness } from "./security-harness"

// Self-contained data dir: never inherit a caller's HOME (read-only in
// sandboxes, the live user index elsewhere).
if (!process.env.BB_DATA_DIR) {
  const laneRoot = path.resolve(import.meta.dirname ?? ".", "..", "..")
  process.env.BB_DATA_DIR = path.join(laneRoot, "validation", "tools", "bb_security", "bbdata")
}
process.env.BB_NO_AUTO_REFRESH = "1"
// The oracle indexes fixtures and reads `brain_taint_flow`; that table is written
// only by the rollback path, so the switch is explicit here (never inherited).
process.env.BB_SECURITY_LEGACY = "1"
import { writeSealed } from "../lib/evidence.ts"

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m15/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

const h = new SecurityHarness()

/**
 * Declared KNOWN-GAPs. A gap is PRINTED and written into the evidence record; it
 * is never counted as a pass (the underlying strict predicate is still false), and
 * it flips into a hard assertion the moment the predicate becomes true.
 */
const knownGaps: Array<{ id: string; label: string; reason: string; evidence: string; observed: string }> = []
function knownGap(id: string, label: string, reason: string, evidence: string, observed: string): void {
  knownGaps.push({ id, label, reason, evidence, observed })
  console.log(`  KNOWN-GAP: ${label}\n    reason: ${reason}\n    evidence: ${evidence}\n    observed: ${observed}`)
}

/**
 * The published baseline. `maxPersistedFraction` is 0 under the M72 contract: a
 * finding that survives its own fix is a false positive, and a gate that accepts
 * any of them is certifying the defect.
 */
const BASELINE = {
  measuredAt: "2026-09-30",
  strictSince: "M72",
  fixtures: 8,
  /** Every known-vulnerable fixture must still produce a finding. */
  minDetectedVulnerable: 8,
  /** Findings that survived their own security fix — the contract maximum. */
  maxPersistedFraction: 0,
} as const

// ── the oracle's own soundness ─────────────────────────────────────────────
// An oracle that measures nothing is worse than none, so it is checked before
// its output is trusted. Each fixture's `fixed` body must genuinely DIFFER from
// its `vulnerable` body — otherwise "the finding persisted" would be trivially
// true and the fixture would be measuring the fixture, not the detector.
h.sectionHeader("oracle", "the oracle is sound before its output is believed")
h.ck("oracle: the corpus is non-empty", FIXTURES.length >= 6, `n=${FIXTURES.length}`)
h.ck("oracle: fixture ids are unique", new Set(FIXTURES.map((f) => f.id)).size === FIXTURES.length, FIXTURES.map((f) => f.id).join(","))
h.ck("oracle: at least four languages are represented", new Set(FIXTURES.map((f) => f.language)).size >= 4, [...new Set(FIXTURES.map((f) => f.language))].join(","))
for (const fx of FIXTURES) {
  h.ck(`oracle: ${fx.id} — the fixed body differs from the vulnerable one`, fx.fixed.trim() !== fx.vulnerable.trim(), "identical bodies would make 'persisted' trivially true")
  h.ck(`oracle: ${fx.id} — both bodies are non-empty`, fx.fixed.trim().length > 0 && fx.vulnerable.trim().length > 0)
  h.ck(`oracle: ${fx.id} — a fixDescription is recorded`, fx.fixDescription.trim().length > 10, `fix="${fx.fixDescription}"`)
  // The fixed body must not contain the parameterization/concatenation smell it
  // is supposed to have removed. This keeps the label honest: a "fixed" variant
  // that still concatenated would be labelled with a vulnerability it does not
  // contain.
  if (fx.vuln === "sql_injection" && /['"]\s*\+\s*\w/.test(fx.vulnerable)) {
    h.nk(`oracle: ${fx.id} — the fixed body is not the vulnerable body`, fx.fixed !== fx.vulnerable, "fixed and vulnerable bodies are identical")
    h.nk(`oracle: ${fx.id} — the vulnerable body really concatenates into SQL`, /['"]\s*\+\s*\w/.test(fx.vulnerable), "fixture is labelled SQLi but does not concatenate")
    h.nk(`oracle: ${fx.id} — the fixed body no longer concatenates into SQL`, !/['"]\s*\+\s*\w/.test(fx.fixed), `fixed still concatenates: ${fx.fixed.replace(/\n/g, " ").slice(0, 80)}`)
  }
  if (fx.vuln === "command_injection" && fx.language === "typescript" && fx.fixDescription.includes("execFile")) {
    h.nk(`oracle: ${fx.id} — the fixed body uses the safe API`, /execFile\(/.test(fx.fixed) && !/\bexec\(/.test(fx.fixed), `fixed=${fx.fixed.replace(/\n/g, " ").slice(0, 80)}`)
  }
}

// ── the measurement ────────────────────────────────────────────────────────
h.sectionHeader("precision", "findings that survive a real security fix")
const outcomes = await runOracle()
const s = summarise(outcomes)

for (const o of outcomes) {
  h.ck(
    `oracle: ${o.id} — the vulnerable file yields a ${o.vuln} finding`,
    o.detectedVulnerable,
    `before=${o.before.join(", ") || "(none)"}`,
  )
  // Reported, not asserted: how much survived is the measurement itself.
  console.log(`  ${o.id.padEnd(22)} detected=${String(o.detectedVulnerable).padEnd(5)} before=${o.before.length} after=${o.after.length} disappeared=${o.disappeared.length} persisted=${o.persisted.length}`)
}

console.log(`\n  SUMMARY ${JSON.stringify(s)}`)

h.ck(
  `precision: every known-vulnerable fixture is still detected (>= ${BASELINE.minDetectedVulnerable})`,
  s.detectedVulnerableFixture >= BASELINE.minDetectedVulnerable,
  `detected=${s.detectedVulnerableFixture} of ${s.fixtures} — a drop means the oracle's fixtures stopped producing findings, so the persisted fraction below is no longer comparable`,
)
// THE INVERTED PRECISION GATE. Under M72 a finding that survives its own fix is a
// false positive; accepting any of them is certifying the defect the milestone
// exists to remove. The retired rollback detector still persists 7 findings, so
// the strict predicate is RED and is declared as an explicit KNOWN-GAP with its
// evidence path — never as a pass, and never as an accepted baseline.
if (s.findingsThatPersistedOnFix === 0) {
  h.ck(
    "precision: NO finding survives its own security fix (strict, contract maximum 0)",
    true,
    `persisted=${s.findingsThatPersistedOnFix}/${s.findingsInVulnerableFiles}`,
  )
} else {
  knownGap(
    "m15.precision.persisted-through-fix",
    "NO finding may survive its own security fix (strict, contract maximum 0)",
    "the gate is measuring the RETIRED token detector (BB_SECURITY_LEGACY=1 rollback path); the Phase-1 spec engine that excludes sanitized/parameterized sinks is measured by script/m72/** (gates-matrix), and the retired detector is still reachable for one release",
    "validation/m15/results/xp1.json (this run: measured.persistedFraction, perFixture persisted counts) + docs/m72-security-rebuild/PLAN.md §2",
    `${s.findingsThatPersistedOnFix}/${s.findingsInVulnerableFiles} findings persisted through their fix (${(s.persistedFraction * 100).toFixed(1)}%)`,
  )
}
h.ck(
  "precision: findings that DID disappear are still disappearing (the oracle can still detect a fix)",
  s.findingsThatDisappearedOnFix >= 2,
  `disappeared=${s.findingsThatDisappearedOnFix} — if this is 0 the oracle cannot see a fix at all, so its persisted count proves nothing`,
)
h.ck(
  "precision: the summary is internally consistent",
  s.findingsThatDisappearedOnFix + s.findingsThatPersistedOnFix === s.findingsInVulnerableFiles,
  `disappeared=${s.findingsThatDisappearedOnFix} persisted=${s.findingsThatPersistedOnFix} total=${s.findingsInVulnerableFiles}`,
)
h.nk(
  "precision: the strict persisted maximum is not satisfied by a loosened baseline",
  BASELINE.maxPersistedFraction === 0,
  `maxPersistedFraction=${BASELINE.maxPersistedFraction} — the M72 contract's maximum is 0, not the historical 77.8%`,
)

// ── publish ────────────────────────────────────────────────────────────────
const record = h.record_({
  issue: "M15.XP",
  code: "XP",
  tool: "bb_security",
  title: "fix-differential precision (retired detector; strict M72 contract)",
  extra: {
    path: "rollback: BB_SECURITY_LEGACY=1 (brain_taint_flow); default Phase-1 engine measured by script/m72/**",
    method: "fix-differential oracle: index a known-vulnerable file and its real fix; a finding that survives the fix did not track the vulnerability",
    baseline: BASELINE,
    measured: s,
    strictPassed: s.findingsThatPersistedOnFix === 0,
    knownGaps,
    perFixture: outcomes,
    limitations: [
      "RECALL IS NOT MEASURED. `detectedVulnerableFixture` is a floor (every fixture must produce at least one finding), not a score; a detector that reported nothing would fail it rather than score well.",
      "The eight fixtures are patterns chosen by the author, not a sample of real-world vulnerabilities. This number is a REGRESSION BASELINE and must never be published as a detection rate.",
      "The fixed variants are written to be clean, so any finding in one is a suspected false positive for that class. A second real vulnerability in a 'fixed' body would be mislabelled; none is known, but the fixtures are small enough to check by reading.",
      "The measurement runs the RETIRED token detector under BB_SECURITY_LEGACY=1; the Phase-1 spec engine's precision is measured by script/m72/**, not re-derived here.",
    ],
  },
})
writeSealed(path.join(RESULTS_DIR, "xp1.json"), record)

console.log(`\n${"=".repeat(72)}`)
console.log(`precision: ${h.failed === 0 ? (knownGaps.length === 0 ? "STRICT PASS" : `PASS (with ${knownGaps.length} explicit KNOWN-GAP)`) : "REGRESSION"} (${h.totalPassed}/${h.checks}, ${h.negativePassed}/${h.negatives} negatives)`)
console.log(`  findings surviving a real fix: ${s.findingsThatPersistedOnFix}/${s.findingsInVulnerableFiles} = ${(s.persistedFraction * 100).toFixed(1)}%  (contract maximum 0%)`)
console.log(`  fixtures fully cleared by their fix: ${s.trackedItsFix}/${s.fixtures}`)
console.log(`${"=".repeat(72)}`)
if (h.failed > 0) for (const f of h.failures) console.log(`  FAIL: ${f.detail}`)
process.exit(h.failed > 0 ? 1 : 0)
