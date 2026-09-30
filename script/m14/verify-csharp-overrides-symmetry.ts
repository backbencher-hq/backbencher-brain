/**
 * 2026-09-29: assert that csharp's `overrides` is excluded from comparison on BOTH sides, or on
 * neither. A coupling, enforced as a coupling.
 *
 * THE HAZARD. C923 derives csharp's member-level interface contract into truth and then SKIPS it
 * (`if (e.label === "overrides") continue`), while the analyzer-side compared allowlist omits the
 * label too. Both sides are excluded, so the two never see each other and the lane is quiet.
 *
 * That is the only reason it is quiet, and nothing enforces it. The truth-side skip and the
 * analyzer-side allowlist are in different places, in different files' worth of code, with no
 * shared symbol between them. A future change that adds `overrides` to ONE side produces a
 * spectacular and completely fictional result:
 *
 *   - added to the ALLOWLIST only  -> every true edge reads as MISSING, hundreds of rows
 *   - added to the TRUTH skip only -> every analyzer edge reads as UNEXPLAINED
 *
 * Neither is a defect in the analyzer. Both are the two halves of a pair drifting apart, and both
 * would be reported as a lane collapse. differential.ts's own comment says the pair "must be
 * removed TOGETHER, or the pair desyncs silently" — which is a warning, and a warning is not a
 * gate. This file is the gate.
 *
 * WHAT IT ASSERTS, and it is deliberately narrow:
 *   SYMMETRY  `overrides` is in the compared set if and only if the truth-side skip is absent.
 *   That biconditional is the whole invariant. It does not judge whether excluding `overrides`
 *   is the RIGHT call — that is a modelling decision with an existing justification
 *   (script/m60/verify-c923-interface-members.ts) — only that the two halves agree, because a
 *   half-applied exclusion is a defect under either answer.
 *
 * WHY READ THE SOURCE RATHER THAN ASK THE ORACLE. The truth-side skip is a statement about what
 * deriveCSharpEdges RETURNS, and the oracle really does return `overrides` edges — so querying it
 * cannot tell whether the skip exists downstream. Only the two text sites carry the invariant.
 * A gate that measured the wrong thing would pass while the pair desynced, which is worse than
 * having no gate, so the check is anchored on the exact strings the two halves use.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const DIFF = path.join(ROOT, "script/m14/differential.ts")
const src = fs.readFileSync(DIFF, "utf8")

/** The truth-side half: the skip, exactly as C923 left it. */
const TRUTH_SKIP = /if\s*\(\s*e\.label\s*===\s*["']overrides["']\s*\)\s*continue/
/** The analyzer-side half: the compared allowlist entry for csharp. */
const ALLOW_CSHARP = /\(\s*lang\s*===\s*["']csharp["']\s*\?\s*\[([^\]]*)\]/

const problems: string[] = []

const truthSkips = src.match(new RegExp(TRUTH_SKIP.source, "g")) ?? []
const m = src.match(ALLOW_CSHARP)
const allowLabels = (m?.[1] ?? "")
  .split(",")
  .map((s) => s.trim().replace(/^["']|["']$/g, ""))
  .filter(Boolean)
const compared = allowLabels.includes("overrides")

console.log(`overrides exclusion symmetry — the two halves that must agree\n`)
console.log(`  truth-side skip present:  ${truthSkips.length > 0 ? `yes (${truthSkips.length} site)` : "NO"}`)
console.log(`  compared set (analyzer):  ${allowLabels.join(", ")}`)
console.log(`  'overrides' compared:     ${compared}`)

// The biconditional. Same value on BOTH sides is the invariant; which value is a modelling decision.
//
// The direction of each failure is worth getting right, because getting it backwards produces a
// gate that passes on the desync it exists to catch — which is what the first version of this file
// did, and it was caught only by a replay that refused to fail.
//
//   truth SKIPS overrides, analyzer COMPARES them  -> truth contributes no rows, the analyzer
//       contributes edges with nothing to match -> they read as UNEXPLAINED fabrications.
//   truth DERIVES overrides, analyzer EXCLUDES them -> every true edge has no analyzer row to
//       satisfy it -> they read as MISSING.
//
// So the two failure modes are UNEXPLAINED and MISSING respectively, and the current state
// (skip present, not compared) excludes on both sides, which is the only quiet combination.
const skipped = truthSkips.length > 0
if (skipped && compared) {
  problems.push("truth SKIPS `overrides` but the analyzer-side compared set INCLUDES it — every analyzer `overrides` edge now has no truth row to match and reads as UNEXPLAINED (fabrication)")
}
if (!skipped && !compared) {
  problems.push("truth DERIVES `overrides` but the analyzer-side compared set EXCLUDES it — every true `overrides` edge now has no analyzer row to satisfy it and reads as MISSING")
}
if (skipped && !compared) {
  // the correct, intended state — reported, not flagged
  console.log(`\n  consistent: excluded on BOTH sides. Truth contributes no \`overrides\` rows and no`)
  console.log(`  analyzer \`overrides\` edge is compared, so the two can never disagree.`)
}
if (truthSkips.length > 1) {
  problems.push(`${truthSkips.length} truth-side skips for \`overrides\` — expected exactly one; a duplicate means one copy was edited while the other stayed`)
}

if (problems.length > 0) {
  console.log(`\nPROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(`  ! ${p}`)
  console.log(`\n  Either half of this pair, changed alone, reads as a lane collapse. Neither is an`)
  console.log(`  analyzer defect. Fix BOTH in one commit — the same instruction differential.ts already`)
  console.log(`  carries in prose, now enforced.`)
  process.exit(1)
}

console.log(`\nVERDICT: PASS — the exclusion is symmetric, so the two halves cannot desync into a`)
console.log(`  fictional lane collapse. Symmetry is all this asserts; whether excluding \`overrides\` is`)
console.log(`  the right modelling call is a separate judgement with its own evidence.`)
