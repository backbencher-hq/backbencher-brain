// script/m61/verify-closure.ts — M61.X1 (issue #849).
//
// The program-closure audit for "Verifier Truth". It audits M61's own ledger and
// RE-AUDITS THE IDE LANE at the current HEAD, sequentially (V2 discipline: the
// concurrent-run cascade must not be possible inside the audit itself).
//
//   Pass 1  the milestone bar: G1 re-executed. G1 itself re-executes V1–V6, so
//           the whole milestone bar is re-earned in this run, not cited.
//   Pass 2  the ledger: validated WHOLE (structure, closure rules, D-7, and the
//           projection rule — every entry is the derivation of its record)
//           through the same pure core G1 enforces, plus this run's own entry.
//   Pass 3  the lane: the m24/m29/m42/m44/m55 closure gates re-executed at HEAD,
//           plus the 41-gate ladder record read as the lane's machine record of
//           its own run — green AND fresh (the one freshness rule this program
//           uses: the pin is an ancestor of HEAD and no lane file changed since;
//           a pin equal to HEAD is un-passable, since evidence must be committed).
//   Pass 4  the known-gaps inventory: GENERATED from the live records (their
//           declared limitations) plus the lint's census and the claim-pins'
//           coverage census — byte-gated, so it cannot drift from what the
//           evidence actually says.
//   Pass 5  the spot-check pack: present, non-empty, and naming every issue. The
//           VERDICT ITSELF STAYS WITH THE OWNER (IDE Honesty Contract §8 rule 5:
//           owner spot-checks are the closure authority; agents never self-close).
//   Pass 6  negatives: every rule above is proven able to fail.
//
// Run: npx tsx script/m61/verify-closure.ts
// Evidence: validation/m61/results/X1.json (sealed)

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { readEvidence, readEvidenceAllowingLegacy, writeSealed } from "../lib/evidence.ts"
import { coverageCensus, loadClaims } from "./claim_pins.ts"
import { canFailProofs, lint, loadRegistry } from "./gate_lint.ts"
import {
  EXPECTED_CODES,
  EXPECTED_ISSUE_NUMBERS,
  entryDrift,
  inventoryFindings,
  ladderFindings,
  ledgerEntryFrom,
  packFindings,
  SELF_OWNED_CODES,
  validateLedger,
  type Ledger,
  type LadderDeps,
} from "./governance_core.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE_DIR = path.join(ROOT, "validation/m61/results")
const LEDGER_PATH = path.join(EVIDENCE_DIR, "manifest.json")
const INVENTORY = path.join(EVIDENCE_DIR, "KNOWN-GAPS.md")
const SPOT_PACK = path.join(EVIDENCE_DIR, "SPOT-CHECK-PACK.md")
const LADDER_RECORD = "validation/m53/results/R1.json"
/** This gate, and the record it writes last — excluded from the inventory's
 *  census so the generated artifact is stable across its own runs. */
const SELF_GATE = "script/m61/verify-closure.ts"

/** The lane's closure gates, re-audited at HEAD in this order. */
const LANE_CLOSURES: Array<[string, string]> = [
  ["m24", "script/m24/verify-closure.ts"],
  ["m29", "script/m29/verify-closure.ts"],
  ["m42", "script/m42/verify-closure.ts"],
  ["m44", "script/m44/verify-closure.ts"],
  ["m55", "script/m55/verify-closure.ts"],
]

/** The lane scope the ladder's freshness is judged against — the same scope the
 *  m55 closure applies (C2). A change here means the ladder's run no longer
 *  describes this tree. */
const LANE_SCOPE = [
  "script/m24/",
  "script/m25/",
  "script/m26/",
  "script/m27/",
  "script/m28/",
  "script/m29/",
  "script/m42/",
  "script/m44/",
  "script/m53/",
  "script/m55/",
  "ide/vscode/src/",
]

const HEAD = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
})()
const LADDER_DEPS: LadderDeps = {
  isAncestor: (commit) => {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] })
      return true
    } catch {
      return false
    }
  },
  laneChanged: (commit) => {
    try {
      return execFileSync("git", ["diff", "--name-only", `${commit}..HEAD`], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "" && LANE_SCOPE.some((p) => l.startsWith(p)))
    } catch {
      return ["git-unavailable"]
    }
  },
}

/** X1's own declared limitations. A module-level constant because the known-gaps
 *  inventory states them for X1 too — and it is generated BEFORE X1's record for
 *  this run is written, so reading X1.json there would make the artifact change
 *  the moment the run that generated it finishes (a self-referential drift). */
const X1_LIMITATIONS = [
  "X1 is the auditor, so its own ledger entry is written from THIS run's measurements (the projection rule) and then validated whole — a pre-existing pin would make a fresh HEAD unverifiable, and the m29 self-referential-trap rationale applies.",
  "The lane re-audit re-executes the five closure gates; the 41-gate ladder is read as the lane's machine record (green AND fresh by the shared relevance rule) rather than re-run — X1 re-running it would duplicate ~40 minutes, and the ladder's own refresh is covered by the lane's own gates.",
  "The known-gaps inventory is byte-gated against a fresh generation: it carries the records' declared limitations and the residue censuses, not an opinion about them.",
  "The verdict is the OWNER's (IDE Honesty Contract §8 rule 5). This gate proves the audit is complete and CAN FAIL; it never self-closes the milestone.",
]

/** The known-gaps inventory: generated from the live records, the lint's census
 *  and the claim pins' coverage residue. ONE generator — the gate's Pass 4, the
 *  `--generate-inventory` mode, and the byte-gate all use this. */
function renderInventory(): string {
  const lines: string[] = []
  lines.push("# M61 known gaps — generated, do not hand-edit")
  lines.push("")
  lines.push("Generated by `script/m61/verify-closure.ts` from the live records: every")
  lines.push("limitation the evidence declares, the lint's census, and the claim pins'")
  lines.push("coverage residue. Regeneration is byte-gated, so a gap cannot be quietly")
  lines.push("dropped from a hand edit, and a closed gap cannot linger in prose.")
  lines.push("")
  lines.push("## Declared limitations, per record")
  lines.push("")
  for (const code of EXPECTED_CODES) {
    if (code === "X1") {
      lines.push(`- **X1** — ${X1_LIMITATIONS.length} declared limitation(s)`)
      for (const l of X1_LIMITATIONS) lines.push(`  - ${l}`)
      continue
    }
    const file = path.join(EVIDENCE_DIR, `${code}.json`)
    if (!existsSync(file)) {
      lines.push(`- **${code}** — no record yet`)
      continue
    }
    const read = readEvidence<{ limitations?: string[] }>(file)
    const lims = read.ok && Array.isArray(read.record.limitations) ? read.record.limitations : []
    lines.push(`- **${code}** — ${lims.length} declared limitation(s)`)
    for (const l of lims) lines.push(`  - ${l}`)
  }
  lines.push("")
  lines.push("## The lint's census (wiring residue)")
  lines.push("")
  // The census excludes THIS gate and its own record. X1.json is written at the
  // END of the run that generates this file, so counting it would make the
  // generated artifact change the instant its own generator finished — the
  // self-reference this milestone bans everywhere else. The exclusion is stated
  // in the output, never a silent subtraction.
  const report = lint(loadRegistry())
  const selfGates = report.gates.filter((g) => g.gate === SELF_GATE).length
  const selfRecords = existsSync(path.join(EVIDENCE_DIR, "X1.json")) ? 1 : 0
  lines.push(`- gates: ${report.gateCount - selfGates} (this gate's own row excluded); records: ${report.recordCount - selfRecords} (X1.json excluded); on-demand gates: ${report.onDemandCount}`)
  lines.push(`- declared non-gates: ${report.declaredNonGates.length}; declared artifact records: ${report.artifactRecords.length}`)
  for (const g of report.gates.filter((x) => x.tiers.includes("on-demand"))) lines.push(`  - on-demand: ${g.gate}`)
  lines.push("")
  lines.push("## Claim-pin coverage residue (published vs pinned)")
  lines.push("")
  for (const c of coverageCensus(loadClaims())) {
    lines.push(`- \`${c.doc}\` (${c.status}): ${c.published} lane claim(s) published, ${c.pinned} pinned`)
  }
  lines.push("")
  return lines.join("\n")
}

let checks = 0
let passed = 0
let mutantsCaught = 0
let mutantsTotal = 0
const failures: string[] = []
const checksList: string[] = []
function check(label: string, ok: boolean, detail?: string): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label} — ${detail}` : label)
  checksList.push(`${ok ? "ok" : "FAIL"}: ${label}${!ok && detail ? ` — ${detail}` : ""}`)
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail?: string): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`M: ${label}`, caught, detail)
}

console.log("M61.X1 — program-closure audit (issue #849)\n")

// --- Pass 1: the milestone bar (G1, which re-executes V1–V6 itself) ---------------
console.log("pass 1: the milestone bar — G1 re-executed (it re-executes V1–V6)")
const g1Run = spawnSync("npx", ["tsx", "script/m61/verify-governance.ts"], { cwd: ROOT, encoding: "utf8", timeout: 900_000 })
const g1Out = `${g1Run.stdout ?? ""}${g1Run.stderr ?? ""}`
const g1Verdict = (g1Out.match(/M61\.G1: (VERIFIED|KNOWN-GAP) \(\d+\/\d+ checks/g) ?? []).pop() ?? "(no verdict line)"
check("X1: M61 governance re-executes green at this HEAD", (g1Run.status ?? 1) === 0, `${g1Verdict} (rc=${g1Run.status})`)

// --- Pass 2: the ledger, validated whole ------------------------------------------
console.log("\npass 2: the ledger — validated whole through G1's own core")
const ledgerRead = readEvidenceAllowingLegacy<Ledger>(LEDGER_PATH)
if (!ledgerRead.ok) {
  check("X1: the ledger reads through the trusted path", false, `${ledgerRead.kind} — ${ledgerRead.reason}`)
} else {
  check("X1: the ledger reads through the trusted path", true)
  const plan = readFileSync(path.join(ROOT, "docs/m61/M61-MASTER-PLAN.md"), "utf8")
  const ledger = ledgerRead.record
  const ledgerErrors = validateLedger(ledger, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS, SELF_OWNED_CODES.filter((c) => c !== "G1"))
  check("X1: the ledger validates whole (structure, closure, D-7)", ledgerErrors.length === 0, ledgerErrors.slice(0, 5).join(" | "))

  // Every entry the ledger carries is the derivation of the record it points at —
  // the projection rule, re-checked here from DISK (G1 derives it on write; this
  // audit re-derives it independently, so a hand edit after G1's run is caught).
  // X1's OWN entry is checked too — against the record the PREVIOUS run left, not
  // this run's snapshot (which is written below). The closure rule exempts the
  // auditor's entry (only its own run may judge that); the derivation rule must
  // not be exempted with it, or a hand-typed X1 entry would ride into the ledger
  // unexamined by anyone.
  const projectionDrift: string[] = []
  for (const issue of ledger.issues) {
    if (issue.status === "planned") continue
    const file = issue.evidence?.evidenceFile
    const abs = file ? path.join(EVIDENCE_DIR, file) : ""
    if (!file || !existsSync(abs)) {
      projectionDrift.push(`${issue.code}: record missing`)
      continue
    }
    const read = readEvidence<Record<string, unknown>>(abs)
    if (!read.ok) {
      projectionDrift.push(`${issue.code}: record unreadable (${read.kind})`)
      continue
    }
    const drift = entryDrift(issue.evidence, ledgerEntryFrom(read.record, canFailProofs(read.record)))
    if (drift.length > 0) projectionDrift.push(`${issue.code}: ${drift.join(", ")}`)
  }
  check("X1: every ledger entry is the derivation of the record it points at", projectionDrift.length === 0, projectionDrift.slice(0, 4).join(" | "))

  // --- Pass 3: the lane, re-audited sequentially at HEAD -------------------------
  console.log("\npass 3: the lane — m24/m29/m42/m44/m55 closures re-executed at this HEAD, sequentially")
  const laneResults: Array<{ lane: string; gate: string; rc: number; verdict: string }> = []
  for (const [lane, gate] of LANE_CLOSURES) {
    const r = spawnSync("npx", ["tsx", gate], { cwd: ROOT, encoding: "utf8", timeout: 900_000 })
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
    const verdicts = out.match(/(VERIFIED|KNOWN-GAP|BLOCKED|PASS|FAIL)[^\n]*/g)
    const verdict = verdicts ? verdicts[verdicts.length - 1]!.slice(0, 120) : "(no verdict line)"
    laneResults.push({ lane, gate, rc: r.status ?? 1, verdict })
    check(`X1: ${lane} closure re-executes green`, (r.status ?? 1) === 0, `${gate} — ${verdict}`)
  }

  const ladderRead = readEvidence<{ status?: string; gates?: Array<{ ok?: boolean; name?: string }>; mutantsCaught?: number; currentCommit?: string }>(path.join(ROOT, LADDER_RECORD))
  const ladderErrors = ladderRead.ok ? ladderFindings(ladderRead.record, LADDER_DEPS) : [`the ladder record is not a trusted read: ${ladderRead.kind}`]
  check("X1: the 41-gate lane ladder record is green AND fresh at this HEAD, with its can-fail proof", ladderErrors.length === 0, ladderErrors.join(" | "))

  // --- Pass 4: the known-gaps inventory (generated, byte-gated) -------------------
  console.log("\npass 4: the known-gaps inventory — generated from the live records")
  const inventory = renderInventory()
  let onDisk: string | null = null
  try {
    onDisk = readFileSync(INVENTORY, "utf8")
  } catch {}
  writeFileSync(INVENTORY, inventory)
  const invErrors = inventoryFindings(onDisk, inventory)
  check("X1: the known-gaps inventory regenerates byte-identically", invErrors.length === 0, invErrors.join(" | "))

  // --- Pass 5: the spot-check pack -------------------------------------------------
  console.log("\npass 5: the spot-check pack (the verdict stays the owner's)")
  const packText = existsSync(SPOT_PACK) ? readFileSync(SPOT_PACK, "utf8") : ""
  const packProblems = packFindings(packText, ledger.issues.map((i) => i.code))
  check("X1: the spot-check pack exists and names every issue", packProblems.length === 0, packProblems.join(" | "))
  check("X1: the pack states the verdict is the owner's, not the gate's", /owner/i.test(packText) && /verdict/i.test(packText))

  // --- Pass 6: negatives -----------------------------------------------------------
  console.log("\nnegatives: every rule above can fail")
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  {
    const forged = clone(ledger)
    forged.issues.find((i) => i.code === "V2")!.evidence = undefined
    mutant("a verified issue with no evidence block passes the ledger", validateLedger(forged, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS).some((e) => e.startsWith("hollow-verified:V2")))
  }
  {
    const foreign = clone(ledger)
    foreign.issues.find((i) => i.code === "V5")!.artifacts = ["script/m37/verify-x.ts"]
    mutant("another lane's file passes D-7", validateLedger(foreign, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS).some((e) => e.startsWith("V5:")))
  }
  {
    const v1 = readEvidence<Record<string, unknown>>(path.join(EVIDENCE_DIR, "V1.json")).record ?? {}
    const derived = ledgerEntryFrom(v1, canFailProofs(v1))
    mutant("a hand-typed ledger entry passes the projection audit", entryDrift({ ...derived, passed: (derived.passed ?? 0) + 1 }, derived).length > 0)
  }
  {
    // The auditor's own entry: exempt from the CLOSURE rule, never from the
    // derivation rule. A hand-typed X1 count in the ledger must fail here.
    const x1 = readEvidence<Record<string, unknown>>(path.join(EVIDENCE_DIR, "X1.json")).record ?? {}
    const derived = ledgerEntryFrom(x1, canFailProofs(x1))
    mutant("a hand-typed X1 ledger entry passes the projection audit", entryDrift({ ...derived, passed: (derived.passed ?? 0) + 1 }, derived).length > 0)
    // ...and the closure exemption stays narrow: a hollow projected entry is still
    // caught while the auditor's own entry is exempted.
    const leaked = clone(ledger)
    const v3 = leaked.issues.find((i) => i.code === "V3")!
    v3.evidence = { ...v3.evidence, failed: 4, realFailed: 4 }
    mutant(
      "the self-owned exemption leaks to a projected entry",
      validateLedger(leaked, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS, SELF_OWNED_CODES.filter((c) => c !== "G1")).some((e) => e.startsWith("hollow-verified:V3")),
    )
  }
  {
    const red = { status: "verified", gates: [{ name: "a", ok: true }, { name: "b", ok: false }], mutantsCaught: 1, currentCommit: HEAD }
    mutant("a ladder with a red gate passes the lane audit", ladderFindings(red, LADDER_DEPS).length > 0)
    const noProof = { status: "verified", gates: [{ name: "a", ok: true }], currentCommit: HEAD }
    mutant("a ladder with no can-fail proof passes the lane audit", ladderFindings(noProof, LADDER_DEPS).length > 0)
    const stale = { status: "verified", gates: [{ name: "a", ok: true }], mutantsCaught: 1, currentCommit: "0".repeat(40) }
    mutant("a ladder pinned to a commit that is not an ancestor of HEAD passes", ladderFindings(stale, { isAncestor: () => false, laneChanged: () => [] }).length > 0)
    const dirty = { status: "verified", gates: [{ name: "a", ok: true }], mutantsCaught: 1, currentCommit: HEAD }
    mutant("a ladder whose lane changed underneath it passes", ladderFindings(dirty, { isAncestor: () => true, laneChanged: () => ["script/m24/verify-server.ts"] }).length > 0)
  }
  {
    mutant("a spot-check pack missing an issue passes", packFindings("# pack\nV1 V2 V3 V4 V5 V6 G1", ["V1", "G1", "X1"]).length === 1)
    mutant("an empty spot-check pack passes", packFindings("   \n", ["V1"]).length > 0)
  }
  {
    mutant("a hand-edited known-gaps inventory passes", inventoryFindings("hand edited text", "generated text").length > 0)
    mutant("a missing known-gaps inventory passes", inventoryFindings(null, "generated").length > 0)
  }

  // --- The artifact block: one snapshot, both files written last (G8) -------------
  // X1's own record and the ledger's derived X1 entry come from the SAME snapshot,
  // taken after every check has run; nothing runs after the writes, so the record
  // cannot disagree with its run (the class this milestone exists to kill).
  const buildEvidence = (commit: string) => ({
    issue: "M61.X1 program-closure audit (issue #849)",
    code: "X1",
    milestone: "M61",
    status: failures.length === 0 && mutantsCaught === mutantsTotal ? "verified" : "known-gap",
    checks,
    passed,
    failed: checks - passed,
    realFailed: checks - passed,
    negatives: { total: mutantsTotal, caught: mutantsCaught },
    checksList,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m61/verify-closure.ts",
    evidenceFile: "X1.json",
    generatedAt: new Date().toISOString(),
    audit: {
      head: HEAD,
      governance: g1Verdict,
      laneClosures: laneResults,
      ladder: { record: LADDER_RECORD, status: ladderRead.ok ? ladderRead.record.status : "unreadable", pin: ladderRead.ok ? (ladderRead.record.currentCommit ?? null) : null },
      inventory: { file: "validation/m61/results/KNOWN-GAPS.md" },
    },
    limitations: X1_LIMITATIONS,
  })
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  const staged = buildEvidence(HEAD)
  const x1 = ledger.issues.find((i) => i.code === "X1")!
  Object.assign(x1, { status: staged.status, evidence: ledgerEntryFrom(staged as unknown as Record<string, unknown>, canFailProofs(staged as unknown as Record<string, unknown>)) })
  ledger.status = ledger.issues.every((i) => i.status === "verified") ? "closed" : "open"
  const finalErrors = validateLedger(ledger, plan, EXPECTED_CODES, EXPECTED_ISSUE_NUMBERS, SELF_OWNED_CODES.filter((c) => c !== "G1"))
  check("X1: the ledger validates WHOLE with this run's own measured X1 entry", finalErrors.length === 0, finalErrors.slice(0, 5).join(" | "))
  const final = buildEvidence(HEAD)
  Object.assign(x1, { status: final.status, evidence: ledgerEntryFrom(final as unknown as Record<string, unknown>, canFailProofs(final as unknown as Record<string, unknown>)) })
  ledger.status = ledger.issues.every((i) => i.status === "verified") ? "closed" : "open"
  writeSealed(path.join(EVIDENCE_DIR, "X1.json"), final)
  writeSealed(LEDGER_PATH, ledger)
}

console.log(`\nM61.X1: ${failures.length === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} checks, ${mutantsCaught}/${mutantsTotal} mutants)`)
console.log(`Evidence (sealed): ${path.join(EVIDENCE_DIR, "X1.json")}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
}
process.exitCode = failures.length === 0 ? 0 : 1
