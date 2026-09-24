// script/m60/routing-outlier-selftest.ts — negative tests for the extension-routing
// discriminant. Every case is a synthetic lane row fed to the pure rule, so the
// instrument's convictions can be checked without a corpus walk.
//
// (No R-number is claimed: the ledger owns R1-R10 and each is enforced by G1/X1. This
// census is not wired into G1 yet, so it is a round instrument, not a standing rule.)
//
// WHY THESE CASES AND NOT OTHERS
// ------------------------------
// The dangerous failure mode of a census like this is not missing a finding, it is
// INVENTING one: a rate comparison that convicts whatever is loudest would have
// convicted `.gradle` (a Groovy DSL, i.e. the routed language, 60 % in geb) and the
// 2-file `.lhs` bucket, and then "fixed" two non-defects. So the cases below pin the
// refusals as tightly as the convictions:
//
//   1 a clean `.py` beside a broken `.pyx` convicts                      (the #913 shape)
//   2 the SAME shape acquits when `.pyx` parses fine                      (no rate-only alarm)
//   3 canonical is POOLED over declared same-language buckets, so a lane   (the launder guard)
//     whose biggest bucket is its own defect cannot set its own baseline
//   4 `.gradle` diverges 9x and is still not a finding                     (same-language ruling)
//   5 a 2-file bucket is below-floor: reported, not convicted               (small denominator)
//   6 an extension absent from the relation table is a failure              (new registry entry)
//   7 a registry change that moves a declared extension fails               (router cross-check)
//   8 a NEW finding drifts the baseline                                     (regression)
//   9 the declared baseline itself does not drift                           (no false alarm)
//  10 a FIXED finding without a baseline ruling drifts                      (two-sided gate)
//  11 a lane with no declared canonical bucket falls back to its own errPct (and says so)
//  12 the #913 RULING itself: the live registry routes none of the three   (the ruling, asserted)
//  13 a retired extension that still routes somewhere fails the census      (retirement is not silence)
//  14 a retired extension that reappears as a bucket is still a finding      (no exemption by history)
//
// Run: bun script/m60/routing-outlier-selftest.ts   (exit 0 pass, 1 fail)
import {
  classifyLane, canonicalRate, classifyBucket, computeDrift, driftAgainst, routerDisagreements,
  EXTENSION_RELATION, BASELINE, MIN_FILES, GAP_PTS, RATIO, type LaneRow,
} from "./routing-outlier-census"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

let passed = 0
const failures: string[] = []
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) passed++
  else failures.push(`${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

const cython: LaneRow = { lane: "cython:python", lang: "python", exts: { py: { files: 86, errorFiles: 2 }, pyx: { files: 270, errorFiles: 231 }, pxd: { files: 44, errorFiles: 42 } } }
const healthy: LaneRow = { lane: "x:python", lang: "python", exts: { py: { files: 86, errorFiles: 2 }, pyx: { files: 270, errorFiles: 10 } } }
const grails: LaneRow = { lane: "grails-core:groovy", lang: "groovy", exts: { groovy: { files: 338, errorFiles: 6 }, gradle: { files: 23, errorFiles: 8 } } }
const hledger: LaneRow = { lane: "hledger:haskell", lang: "haskell", exts: { hs: { files: 186, errorFiles: 3 }, lhs: { files: 2, errorFiles: 2 } } }

check("1 clean .py beside broken .pyx convicts", classifyLane(cython).findings.map((f) => f.ext).sort(), ["pxd", "pyx"])
check("2 healthy .pyx is not a finding", classifyLane(healthy).findings.length, 0)
check("3 canonical is pooled, not largest-bucket", [canonicalRate(cython).canonical, canonicalRate(cython).canonicalFiles], [2.33, 86])
check("4 .gradle diverges 9x and does not convict", [classifyLane(grails).findings.length, classifyLane(grails).divergences.map((f) => f.ext)], [0, ["gradle"]])
check("5 two-file bucket is below-floor, not a finding", [classifyLane(hledger).findings.length, classifyLane(hledger).belowFloor.map((f) => f.ext)], [0, ["lhs"]])
check("6 undeclared extension is a failure", classifyLane({ lane: "new:python", lang: "python", exts: { newpyx: { files: 50, errorFiles: 50 } } }).undeclared.map((u) => u.ext), ["newpyx"])
check("7 a moved registry entry fails the table check", routerDisagreements((p) => (p.endsWith(".pyx") ? "python" : detectLanguageFromPath(p))).map((d) => d.ext).sort(), ["pyx"])
// The live baseline was emptied by the #913 ruling, so `driftAgainst` is what keeps the
// two-sided gate exercised: an empty baseline can silence the vanish direction entirely.
const PRE_RULING = [{ lang: "python", ext: "pyx" }, { lang: "python", ext: "pxd" }, { lang: "groovy", ext: "gsp" }]
check("8 a new finding drifts the baseline", driftAgainst([...PRE_RULING, { lang: "ruby", ext: "rbx" }], PRE_RULING).newFindings, ["ruby.rbx"])
check("9 the declared baseline does not drift", computeDrift([]).drift, false)
check("9b the live baseline is empty BY RULING (the three findings retired)", BASELINE.length, 0)
check("10 a fixed finding without a baseline ruling drifts", driftAgainst(PRE_RULING.slice(1), PRE_RULING).vanishedFindings, ["python.pyx"])
check("10b a reappearing retired finding is a NEW finding, not a vanished one", computeDrift([{ lang: "python", ext: "pyx" }]).newFindings, ["python.pyx"])
check("11 a lane with no canonical bucket falls back and says so", [canonicalRate({ lane: "x:newlang", lang: "newlang", errPct: 12.5, exts: { weird: { files: 30, errorFiles: 30 } } }).pooled, canonicalRate({ lane: "x:newlang", lang: "newlang", errPct: 12.5, exts: { weird: { files: 30, errorFiles: 30 } } }).canonical], [false, 12.5])

// The ruling, asserted against the live registry rather than against the table: this is
// the one case that fails if EXTENSION_LANGUAGE is edited back to routing any of them.
const RETIRED = ["pyx", "pxd", "gsp"]
check("12 #913: the live registry routes none of pyx/pxd/gsp", RETIRED.map((e) => detectLanguageFromPath(`probe.${e}`)), RETIRED.map(() => null))
check("12b #913: the formats are still DECLARED other-format (retired, not forgotten)", RETIRED.map((e) => [EXTENSION_RELATION[e].relation, EXTENSION_RELATION[e].retired === true]), RETIRED.map(() => ["other-format", true]))
// The strong form: EVERY declaration in the table — same-language, other-format,
// unmeasured, retired — must match the live registry, so a re-added registry line fails
// here even though the artifact would carry no bucket for it yet.
check("12c every declared routing claim agrees with the live registry", routerDisagreements((p) => detectLanguageFromPath(p) as string | null), [])
check("13 a retired extension that routes nowhere is not a disagreement", routerDisagreements((p) => (RETIRED.some((e) => p.endsWith(`.${e}`)) ? null : detectLanguageFromPath(p))).map((d) => d.ext), [])
check("14 a retired extension reappearing as a bucket is still a finding", classifyLane({ lane: "cython:python", lang: "python", exts: { py: { files: 86, errorFiles: 2 }, pyx: { files: 270, errorFiles: 231 } } }).findings.map((f) => f.ext), ["pyx"])

// The thresholds are load-bearing: each one must be able to refuse alone.
check("thresholds refuse on files alone", classifyBucket("python", "pyx", { files: MIN_FILES - 1, errorFiles: MIN_FILES - 1 }, 1).kind, "below-floor")
// rate 6 vs canonical 1: the RATIO passes (6x) and the GAP refuses (+5pts)
check("thresholds refuse on gap alone", classifyBucket("python", "pyx", { files: 100, errorFiles: 6 }, 1).kind, "none")
// rate 19 vs canonical 4: the GAP passes (+15pts) and the RATIO refuses (4.75x)
check("thresholds refuse on ratio alone", classifyBucket("python", "pyx", { files: 100, errorFiles: 19 }, 4).kind, "none")
check("thresholds admit when all three hold", classifyBucket("python", "pyx", { files: 100, errorFiles: 21 }, 4).kind, "finding")
check("every declared extension carries a relation the rule knows", Object.values(EXTENSION_RELATION).every((d) => ["same-language", "other-format", "ambiguous-sniff"].includes(d.relation)), true)
// A `same-language` entry needs a reason; a CONVICTING relation needs an argument:
// the failure mode this guards is a table that grows by adding extensions with a
// placeholder note and thereby acquits them without saying why.
check("every declared extension carries a written note", Object.values(EXTENSION_RELATION).every((d) => d.note.trim().length > 0), true)
check("every convicting relation carries an argument", Object.values(EXTENSION_RELATION).filter((d) => d.relation === "other-format").every((d) => d.note.length >= 60), true)

console.log(`routing-outlier selftest: ${passed} passed, ${failures.length} failed (thresholds MIN_FILES=${MIN_FILES} GAP_PTS=${GAP_PTS} RATIO=${RATIO})`)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
