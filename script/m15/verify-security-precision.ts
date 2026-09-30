// script/m15/verify-security-precision.ts — the fix-differential precision gate.
//
// WHY THIS FILE EXISTS
//
// Every precision number previously available for bb_security was a proxy: "is
// there a sink token near the reported line". A proxy cannot decide whether a
// change helped. This runs the oracle in ./security-oracle.ts, which uses a
// REAL FIX as the ground-truth label, and publishes a number that means
// something: of the findings reported on a known-vulnerable file, how many
// SURVIVED the security fix that repairs it.
//
// Measured baseline (2026-09-30, at this commit):
//
//   8/8 vulnerable fixtures detected
//   1/8 fixtures: every finding disappeared when the vulnerability was fixed
//   7/9 findings (77.8%) persisted through a real fix
//
// That number is bad and it is the reason this gate exists. It is pinned so
// that:
//
//   - a change that makes precision WORSE fails here immediately, and
//   - a change that makes it BETTER is visible as a diff against the constant,
//     which is what makes the analyzer-lane work in
//     docs/m48/SECURITY-PRECISION-PROPOSAL.md decidable rather than a guess.
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
// Exit: non-zero if any assertion failed.

import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { runOracle, summarise, FIXTURES } from "./security-oracle"
import { SecurityHarness } from "./security-harness"
import { writeSealed } from "../lib/evidence.ts"

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m15/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

const h = new SecurityHarness()

/**
 * The published baseline. Every number here was measured on this machine at the
 * commit that introduced this file; a regression fails, an improvement shows up
 * as a lower `persistedFraction` than the constant.
 *
 * `floor` semantics: these are MINIMA. Improvement is welcome and is reported;
 * regression is a failure.
 */
const BASELINE = {
  measuredAt: "2026-09-30",
  fixtures: 8,
  /** Every known-vulnerable fixture must still produce a finding. */
  minDetectedVulnerable: 8,
  /** Findings that survived their own security fix, as a fraction of all. */
  maxPersistedFraction: 7 / 9,
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
  // is supposed to have removed. This is the check that keeps the label honest:
  // if a "fixed" variant still concatenated, the fixture would be labelled with
  // a vulnerability it does not contain.
  if (fx.vuln === "sql_injection" && /['"]\s*\+\s*\w/.test(fx.vulnerable)) {
    h.nk(`oracle: ${fx.id} — the vulnerable body really concatenates`, true)
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
h.ck(
  `precision: findings surviving their own fix did not increase (floor <= ${(BASELINE.maxPersistedFraction * 100).toFixed(1)}%)`,
  s.persistedFraction <= BASELINE.maxPersistedFraction + 1e-9,
  `persistedFraction=${(s.persistedFraction * 100).toFixed(1)}% (${s.findingsThatPersistedOnFix}/${s.findingsInVulnerableFiles}) baseline=${(BASELINE.maxPersistedFraction * 100).toFixed(1)}%`,
)
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

// ── publish ────────────────────────────────────────────────────────────────
const improved = s.persistedFraction < BASELINE.maxPersistedFraction
const record = h.record_({
  issue: "M15.XP",
  code: "XP",
  tool: "bb_security",
  title: "fix-differential precision",
  extra: {
    method: "fix-differential oracle: index a known-vulnerable file and its real fix; a finding that survives the fix did not track the vulnerability",
    baseline: BASELINE,
    measured: s,
    improvedOnBaseline: improved,
    perFixture: outcomes,
    limitations: [
      "RECALL IS NOT MEASURED. `detectedVulnerableFixture` is a floor (every fixture must produce at least one finding), not a score; a detector that reported nothing would fail it rather than score well.",
      "The eight fixtures are patterns chosen by the author, not a sample of real-world vulnerabilities. This number is a REGRESSION BASELINE and must never be published as a detection rate.",
      "The fixed variants are written to be clean, so any finding in one is a suspected false positive for that class. A second real vulnerability in a 'fixed' body would be mislabelled; none is known, but the fixtures are small enough to check by reading.",
      "Coverage is a floor on what a detector CAN report, not on what it reports correctly: see docs/m48/SECURITY-PRECISION-PROPOSAL.md for the 16% measurement on a real 168k-symbol index.",
    ],
  },
})
writeSealed(path.join(RESULTS_DIR, "xp1.json"), record)

console.log(`\n${"=".repeat(72)}`)
console.log(`precision: ${h.failed === 0 ? "BASELINE HELD" : "REGRESSION"} (${h.totalPassed}/${h.checks}, ${h.negativePassed}/${h.negatives} negatives)`)
console.log(`  findings surviving a real fix: ${s.findingsThatPersistedOnFix}/${s.findingsInVulnerableFiles} = ${(s.persistedFraction * 100).toFixed(1)}%  (baseline ${(BASELINE.maxPersistedFraction * 100).toFixed(1)}%)`)
console.log(`  fixtures fully cleared by their fix: ${s.trackedItsFix}/${s.fixtures}`)
console.log(`${"=".repeat(72)}`)
if (h.failed > 0) for (const f of h.failures) console.log(`  FAIL: ${f.detail}`)
process.exit(h.failed > 0 ? 1 : 0)