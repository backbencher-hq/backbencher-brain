// script/m61/verify-reproducibility.ts — M61.V3 verifier + mutation suite
// (issue #844).
//
// Proves the reproducibility auditor (script/m61/reproducibility.ts) honors
// its declared laws, and that the suite CAN FAIL.
//
//   R1 sample integrity:  the sample file is the single owner of the sampled
//                         set (the auditor hardcodes no member), declares a
//                         minimum >= 5, covers every required milestone, names
//                         scripts that exist, and holds no duplicate records.
//   R2 decision cores:    classifyRun (kill != drift), diffRecords (field-
//                         precise, volatile-aware), sampleVerdict (never
//                         silently ages out a blocked member; enforces the
//                         minimum and the milestone coverage).
//   R3 doctored stored:   a stored record whose `passed` was altered is FLAGGED
//                         as non-reproducing, with the field and both values —
//                         through the auditor's real run path.
//   R4 real audit at HEAD: the declared sample is re-executed in an isolated
//                         temp checkout; every member reproduces, and the REAL
//                         stored evidence is byte-unchanged by the audit.
//
// Mutants (source-level copies) prove the suite CAN FAIL:
//   M1 diff-blind:        diffRecords returns [] unconditionally.
//   M2 blocked-silent:    sampleVerdict stops failing undeclared blocks.
//   M3 kill-as-drift:     classifyRun reports a harness kill as "failed".
//   M4 minimum-ignored:   sampleVerdict drops the declared-minimum check.
//   M5 clobber-blind:     assertStoredUntouched returns [] unconditionally.
//
// Run: npx tsx script/m61/verify-reproducibility.ts
// Evidence: validation/m61/results/V3.json (sealed)

import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import {
  ROOT,
  assertStoredUntouched,
  classifyRun,
  createIsolatedCheckout,
  diffRecords,
  hashEvidenceFiles,
  headCommit,
  loadSample,
  removeIsolatedCheckout,
  runAudit,
  sampleVerdict,
  type MemberResult,
  type Sample,
} from "./reproducibility.ts"

const RESULTS = path.join(ROOT, "validation/m61/results")

let passed = 0
let failed = 0
const failures: string[] = []
const checks: string[] = []
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed++
  else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
  }
  checks.push(`${ok ? "ok" : "FAIL"}: ${name}${detail && !ok ? ` — ${detail}` : ""}`)
}

const src = readFileSync(path.join(ROOT, "script/m61/reproducibility.ts"), "utf8")
// Comments carry the declared evidence path; code must not carry a member.
const codeOnly = src
  .split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n")

// --- R1: sample integrity --------------------------------------------------------
console.log("R1: sample integrity (single owner, minimum, coverage)")
const sample: Sample = loadSample()
check("R1: the sample parses and declares a minimum", typeof sample.declaredMinimum === "number")
check("R1: the declared minimum is at least 5", sample.declaredMinimum >= 5, `declared ${sample.declaredMinimum}`)
check(
  "R1: the sample declares at least the minimum number of members",
  sample.members.length >= sample.declaredMinimum,
  `${sample.members.length} members`,
)
const memberMilestones = new Set(sample.members.map((m) => m.milestone))
const missingMilestones = sample.requiredMilestones.filter((r) => !memberMilestones.has(r))
check("R1: every required milestone has a sampled member", missingMilestones.length === 0, missingMilestones.join(","))
const dupRecords = sample.members.map((m) => m.record).filter((r, i, a) => a.indexOf(r) !== i)
check("R1: no record is sampled twice", dupRecords.length === 0, dupRecords.join(","))
const badScripts = sample.members.filter((m) => {
  const scriptRel = m.verifierCommand.replace(/^npx tsx /, "").replace(/^bun run /, "")
  return !existsSync(path.join(ROOT, scriptRel))
})
check("R1: every member's verifier script exists", badScripts.length === 0, badScripts.map((m) => m.verifierCommand).join(" | "))
const badRecords = sample.members.filter((m) => !existsSync(path.join(ROOT, m.record)))
check("R1: every member's stored record exists", badRecords.length === 0, badRecords.map((m) => m.record).join(" | "))
// The auditor must not carry a member list of its own — the sample file is the owner.
check(
  "R1: the auditor hardcodes no member record (sample file is the owner)",
  !/validation\//.test(codeOnly),
  "a validation/ path appears in reproducibility.ts code",
)

// --- R2: decision cores ----------------------------------------------------------
console.log("\nR2: decision cores (kill != drift, field-precise diff, no silent aging)")
check("R2: classifyRun — a timeout is a harness kill, not a drift", classifyRun({ exitCode: null, signal: null, timedOut: true }) === "killed")
check("R2: classifyRun — a signal is a harness kill", classifyRun({ exitCode: null, signal: "SIGTERM", timedOut: false }) === "killed")
check("R2: classifyRun — exit 0 is a clean run", classifyRun({ exitCode: 0, signal: null, timedOut: false }) === "ok")
check("R2: classifyRun — a non-zero exit is a real failure", classifyRun({ exitCode: 1, signal: null, timedOut: false }) === "failed")

const stable = sample.stableFields
const vol = sample.declaredVolatileFields
const rec = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  status: "verified",
  checks: 3,
  passed: 3,
  failed: 0,
  realFailed: 0,
  checksList: ["ok: a", "ok: b", "ok: c"],
  ...over,
})
check("R2: diffRecords — identical records do not diverge", diffRecords(rec(), rec(), stable, vol).length === 0)
const dPassed = diffRecords(rec(), rec({ passed: 2 }), stable, vol)
check(
  "R2: diffRecords — a changed count diverges, with both values",
  dPassed.some((d) => d.field === "passed" && d.stored === 3 && d.fresh === 2),
  JSON.stringify(dPassed),
)
const dList = diffRecords(rec(), rec({ checksList: ["ok: a", "FAIL: b", "ok: c"] }), stable, vol)
check(
  "R2: diffRecords — a flipped check diverges, naming its index",
  dList.some((d) => d.field === "checksList[1]"),
  JSON.stringify(dList),
)
check(
  "R2: diffRecords — a changed volatile field (generatedAt) does not diverge",
  diffRecords(rec(), rec({ generatedAt: "1999-01-01T00:00:00.000Z", currentCommit: "deadbeef" }), stable, vol).length === 0,
)

const member = (over: Partial<MemberResult>): MemberResult => ({
  milestone: "m24",
  record: "validation/m24/results/P1.json",
  verifierCommand: "npx tsx script/m24/verify-positions.ts",
  outcome: "reproduced",
  runClass: "ok",
  ...over,
})
const mkSample = (over: Partial<Sample> = {}): Sample => ({ ...sample, declaredBlocked: [], ...over })
const okSet = sample.requiredMilestones.map((m) => member({ milestone: m, record: `validation/${m}/results/R.json` }))
check("R2: sampleVerdict — all reproduced -> verified", sampleVerdict(okSet, mkSample()).status === "verified")
const divergedSet = okSet.map((m, i) => (i === 0 ? member({ ...m, outcome: "diverged", divergences: [{ field: "passed", stored: 3, fresh: 2 }] }) : m))
const divergedVerdict = sampleVerdict(divergedSet, mkSample())
check(
  "R2: sampleVerdict — a diverged member is a FAILURE naming the field",
  divergedVerdict.status === "known-gap" && divergedVerdict.failures.some((f) => f.includes("passed")),
  divergedVerdict.failures.join(" | "),
)
// A NON-required member is blocked: the five required milestones still
// reproduce, so only the declaration rule is under test.
const extra = member({ milestone: "m61", record: "validation/m61/results/V1.json", outcome: "blocked", reason: "runtime missing" })
const blockedSet = [...okSet, extra]
check(
  "R2: sampleVerdict — an UNDECLARED block is a failure (never silently aged out)",
  sampleVerdict(blockedSet, mkSample()).status === "known-gap",
)
check(
  "R2: sampleVerdict — a DECLARED block is accepted",
  sampleVerdict(blockedSet, mkSample({ declaredBlocked: [{ record: extra.record, reason: "runtime missing" }] })).status === "verified",
)
const tooFew = okSet.slice(0, Math.max(1, sample.declaredMinimum - 1))
check(
  "R2: sampleVerdict — fewer than the declared minimum reproduced fails",
  sampleVerdict(tooFew, mkSample({ requiredMilestones: [] })).status === "known-gap",
)
const noCov = okSet.map((_, i) => member({ milestone: "m24", record: `validation/m24/results/R${i}.json` }))
check(
  "R2: sampleVerdict — a required milestone with no reproducing member fails",
  sampleVerdict(noCov, mkSample({ requiredMilestones: ["m55"] })).status === "known-gap",
)

// --- one isolated checkout, used by R3 and R4 ------------------------------------
const workdir = mkdtempSync(path.join(os.tmpdir(), "bb-m61-v3-"))
const checkout = path.join(workdir, "checkout")
const commit = headCommit()
const storedRecords = sample.members.map((m) => m.record)

// --- R3: a doctored stored record is flagged --------------------------------------
console.log("\nR3: a doctored stored record is flagged as non-reproducing")
createIsolatedCheckout(commit, checkout)
let realAudit: ReturnType<typeof runAudit> | null = null
try {
  const doctoredRoot = path.join(workdir, "stored")
  const target = sample.members.find((m) => m.milestone === "m24")!
  mkdirSync(path.join(doctoredRoot, path.dirname(target.record)), { recursive: true })
  const original = JSON.parse(readFileSync(path.join(ROOT, target.record), "utf8")) as Record<string, unknown>
  writeFileSync(path.join(doctoredRoot, target.record), JSON.stringify({ ...original, passed: Number(original.passed ?? 0) + 7 }, null, 2) + "\n")
  const reduced: Sample = { ...sample, declaredMinimum: 1, requiredMilestones: [], members: [target] }
  const doctored = runAudit(reduced, { storedRoot: doctoredRoot, isolatedRoot: checkout, commit })
  const m = doctored.verdict.members[0]
  check("R3: the doctored record is reported as diverged", m.outcome === "diverged", `outcome=${m.outcome} (${m.reason ?? ""})`)
  check(
    "R3: the divergence names the altered field with both values",
    (m.divergences ?? []).some((d) => d.field === "passed" && d.stored !== d.fresh),
    JSON.stringify(m.divergences ?? []),
  )
  check("R3: the doctored audit verdict is known-gap", doctored.verdict.status === "known-gap")

  // --- R4: the real audit at HEAD ---------------------------------------------------
  console.log("\nR4: the real audit at HEAD (isolated checkout, stored evidence untouched)")
  const before = hashEvidenceFiles(ROOT, storedRecords)
  realAudit = runAudit(sample, { isolatedRoot: checkout, commit })
  const clobbered = assertStoredUntouched(before, hashEvidenceFiles(ROOT, storedRecords))
  check(
    "R4: the real stored evidence is byte-unchanged (independent hash)",
    clobbered.length === 0,
    clobbered.join(", "),
  )

  check(
    "R4: every sampled member reproduces",
    realAudit.verdict.diverged === 0,
    realAudit.verdict.failures.slice(0, 4).join(" | "),
  )
  check(
    "R4: at least the declared minimum reproduced",
    realAudit.verdict.reproduced >= sample.declaredMinimum,
    `reproduced ${realAudit.verdict.reproduced} < ${sample.declaredMinimum}`,
  )
  check("R4: the audit verdict is verified", realAudit.verdict.status === "verified", realAudit.verdict.failures.join(" | "))
  check("R4: the real stored evidence is byte-unchanged by the audit", realAudit.storedUntouched, realAudit.storedViolations.join(", "))
  check("R4: the audit reports its isolation mode", realAudit.isolation === "git-worktree-detached")
} finally {
  removeIsolatedCheckout(checkout)
  rmSync(workdir, { recursive: true, force: true })
}

// --- mutants: the suite CAN FAIL -------------------------------------------------
console.log("\nmutants: the suite can fail (source-level copies)")
for (const f of readdirSync(path.join(ROOT, "script/m61"))) {
  if (f.startsWith(".mutant-repro-")) rmSync(path.join(ROOT, "script/m61", f), { force: true })
}

async function runMutant(name: string, from: string, to: string, probe: (mod: Record<string, unknown>) => boolean): Promise<void> {
  if (!src.includes(from)) {
    check(`M: ${name} (mutation anchor exists)`, false, "anchor not found — the mutant is stale")
    return
  }
  const mutantPath = path.join(ROOT, "script/m61", `.mutant-repro-${name}.ts`)
  writeFileSync(mutantPath, src.replace(from, to))
  try {
    const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
    check(`M: ${name}`, probe(mod) === true, "the mutant did NOT manifest the defect — the suite could not fail")
  } catch (e) {
    check(`M: ${name}`, true, `(mutant crashed — still caught: ${(e as Error).message})`)
  } finally {
    rmSync(mutantPath, { force: true })
  }
}

await runMutant(
  "diff-blind",
  "  const volatile = new Set(volatileFields)",
  "  return []\n  const volatile = new Set(volatileFields)",
  (mod) => {
    const d = (mod.diffRecords as typeof diffRecords)(rec(), rec({ passed: 2 }), stable, vol)
    return d.length === 0
  },
)

await runMutant(
  "blocked-silent",
  '    } else if (m.outcome === "blocked" && !declaredBlocked.has(m.record)) {',
  "    } else if (false) {",
  (mod) => {
    const v = (mod.sampleVerdict as typeof sampleVerdict)(blockedSet, mkSample())
    return v.status === "verified"
  },
)

await runMutant(
  "kill-as-drift",
  '  if (input.timedOut) return "killed"',
  '  if (input.timedOut) return "failed"',
  (mod) => {
    const c = (mod.classifyRun as typeof classifyRun)({ exitCode: null, signal: null, timedOut: true })
    return c === "failed"
  },
)

await runMutant(
  "minimum-ignored",
  "  if (reproduced < sample.declaredMinimum) {",
  "  if (false) {",
  (mod) => {
    const v = (mod.sampleVerdict as typeof sampleVerdict)(tooFew, mkSample({ requiredMilestones: [] }))
    return v.status === "verified"
  },
)

await runMutant(
  "clobber-blind",
  "  const violations: string[] = []\n  for (const [p, h] of Object.entries(before)) {",
  "  return []\n  const violations: string[] = []\n  for (const [p, h] of Object.entries(before)) {",
  (mod) => {
    const v = (mod.assertStoredUntouched as typeof assertStoredUntouched)({ "a.json": "h1" }, { "a.json": "CHANGED" })
    return v.length === 0
  },
)

// --- evidence --------------------------------------------------------------------
// The record must never disagree with the run that produced it: the record is
// written twice — once so the trusted read can verify it, then re-written so
// the self-read check is itself counted in the record it describes.
const buildEvidence = () => ({
  issue: "M61.V3 reproducibility auditor (issue #844)",
  code: "V3",
  milestone: "M61",
  status: failed === 0 ? "verified" : "known-gap",
  checks: checks.length,
  passed,
  failed,
  realFailed: failed,
  failures,
  checksList: checks,
  currentCommit: commit,
  verifierCommand: "npx tsx script/m61/verify-reproducibility.ts",
  evidenceFile: "V3.json",
  generatedAt: new Date().toISOString(),
  sample: {
    file: "script/m61/reproducibility-sample.json",
    declaredMinimum: sample.declaredMinimum,
    requiredMilestones: sample.requiredMilestones,
    members: sample.members.map((m) => `${m.milestone}:${m.record}`),
  },
  audit: realAudit
    ? {
        isolation: realAudit.isolation,
        reproduced: realAudit.verdict.reproduced,
        diverged: realAudit.verdict.diverged,
        blocked: realAudit.verdict.blocked,
        storedUntouched: realAudit.storedUntouched,
        perMember: realAudit.verdict.members.map((m) => `${m.milestone}:${m.outcome}`),
      }
    : null,
  limitations: [
    "The sample is runtime-light by design (component-level gates): the audit proves the recorded commands reproduce, not that every heavy editor/giant-repo leg does. Heavy legs are re-run by their own milestone closures; extending the sample is a one-line change to the sample file.",
    "Isolation is a detached git worktree at HEAD with the repo's node_modules symlinked in; a member that needs an uncommitted build artifact (dist/) is not a sample member.",
    "Divergence is detected on the declared stable fields plus the per-check verdict list; it does not compare free-text fields the gates may legitimately vary.",
  ],
})
writeSealed(path.join(RESULTS, "V3.json"), buildEvidence())
const selfRead = readFileSync(path.join(RESULTS, "V3.json"), "utf8")
check("R: this verifier's own evidence is a sealed record", selfRead.includes("bbSeal"))
writeSealed(path.join(RESULTS, "V3.json"), buildEvidence())

console.log(`\nM61.V3: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks.length})`)
console.log(`Evidence (sealed): ${path.join(RESULTS, "V3.json")}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
}
process.exitCode = failed === 0 ? 0 : 1
