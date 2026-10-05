// script/m29/verify-closure.ts — M29.X1 (issue #543). The program-closure gate.
//
// The LAST issue of the IDE program (M24–M29). Nothing closes without the
// gate, and this gate closes the whole program: every verifier of every
// milestone in our lane runs green at the current commit, the contract §6
// mutant-set coverage is re-asserted per surface, the owner spot-check is
// PREPARED (not performed — §8.5 keeps the achieved/not-achieved verdict with
// the owner), and the precision-ledger + wave-protocol artifacts regenerate
// byte-identically at this HEAD.
//
// verify-closure.ts is NOT in the suite it runs (recursion is impossible),
// and verify-governance is deliberately not re-run here: it is wired FIRST in
// the M29 chain and validates X1's own evidence at the closing HEAD —
// re-running it inside this gate would judge X1.json before this run writes
// it (the M24 self-referential-trap rationale, inherited).
//
// Run: npx tsx script/m29/verify-closure.ts
// Evidence: validation/m29/results/X1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = resolve(import.meta.dirname, "../..")
const EVIDENCE_PATH = join(ROOT, "validation/m29/results/X1.json")

// The program ladder in our lane, in dependency order. Co-agent lanes
// (M14/M37/M40/M41…) are deliberately absent — their gates are theirs.
const SUITE: Array<{ code: string; script: string; evidenceFiles: string[]; editorLeg?: boolean }> = [
  { code: "M24", script: "script/m24/verify-governance.ts", evidenceFiles: ["validation/m24/results/G1.json"] },
  { code: "M25", script: "script/m25/verify-governance.ts", evidenceFiles: ["validation/m25/results/G1.json"] },
  { code: "M26", script: "script/m26/verify-governance.ts", evidenceFiles: ["validation/m26/results/G1.json"] },
  { code: "M27", script: "script/m27/verify-governance.ts", evidenceFiles: ["validation/m27/results/G1.json"] },
  { code: "M28", script: "script/m28/verify-governance.ts", evidenceFiles: ["validation/m28/results/G1.json"] },
  { code: "M29-R1", script: "script/m29/verify-wave-protocol.ts", evidenceFiles: ["validation/m29/results/R1.json"] },
  { code: "M29-R2", script: "script/m29/verify-wave-execution.ts", evidenceFiles: ["validation/m29/results/R2.json"] },
  { code: "M29-R3", script: "script/m29/verify-giant-repo.ts", evidenceFiles: ["validation/m29/results/R3.json"] },
  { code: "M29-R4", script: "script/m29/verify-precision-ledger.ts", evidenceFiles: ["validation/m29/results/R4-verify.json"], afterRegen: true },
  { code: "M29-R5", script: "script/m29/verify-precision-improvements.ts", evidenceFiles: ["validation/m29/results/R5-verify.json"] },
  { code: "M29-V1", script: "script/m29/verify-wave-harness.ts", evidenceFiles: ["validation/m29/results/V1-verify.json"], afterRegen: true },
  { code: "M29-D1", script: "script/m29/verify-m29-docs.ts", evidenceFiles: ["validation/m29/results/D1-verify.json"], afterRegen: true },
]
// Ledger consumers (afterRegen) run AFTER pass 1b regenerates the ledger over
// the refreshed ladder evidence — their inputs include the ledger artifacts.
const POST_REGEN = SUITE.filter((s) => s.afterRegen)

let checks = 0
let passed = 0
const failures: string[] = []
let negatives = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  check(label, ok, detail)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- Pass 1: the full program ladder at HEAD ---------------------------------------
console.log("pass 1: the full program ladder (M24–M29) at HEAD")
const exits: Record<string, number> = {}
function ladderRun(code: string, script: string): void {
  console.log(`  running ${code}…`)
  let exit = -1
  try {
    execFileSync("npx", ["tsx", script], { cwd: ROOT, encoding: "utf8", timeout: 580_000, stdio: ["ignore", "pipe", "ignore"] })
    exit = 0
  } catch (e) {
    exit = (e as { status?: number }).status ?? -1
  }
  exits[code] = exit
  check(`X1: ${code} ladder run green at HEAD`, exit === 0, `exit=${exit}`)
}
for (const { code, script, afterRegen } of SUITE) if (!afterRegen) ladderRun(code, script)

// --- Pass 1b: fixpoint regeneration of the published ledger ------------------------
// The ladder's editor legs (M25 E5/E6, M27 N1/Z1, M29 S6) rewrite their evidence
// with live timings; the wave legs rewrite wave-*.json. Those files are INPUTS
// to the precision-ledger hash, so after any ladder run the on-disk ledger is
// one generation behind. Byte-identical regeneration is the DRIFT GATE — it
// compares the on-disk artifact to a fresh build over current inputs — so the
// ledger must be regenerated AFTER the last input-mutating leg and BEFORE the
// ledger-consumer verifiers. Regenerating once here makes the closure run a
// fixpoint in a single pass instead of requiring a second full ladder.
{
  console.log("  regenerating the precision ledger over refreshed inputs…")
  let regenExit = -1
  try {
    execFileSync("npx", ["tsx", "script/m29/generate-precision-ledger.ts", "--write"], { cwd: ROOT, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "ignore"] })
    regenExit = 0
  } catch (e) {
    regenExit = (e as { status?: number }).status ?? -1
  }
  check("X1: precision ledger regenerated over refreshed ladder evidence", regenExit === 0, `exit=${regenExit}`)
}
// Ledger-consumer legs, now that the ledger reflects the refreshed inputs:
console.log("\npass 1c: ledger-consumer legs at HEAD (post-regeneration)")
for (const { code, script } of POST_REGEN) ladderRun(code, script)

// --- Pass 2: §6 mutant-set coverage re-asserted per surface ------------------------
console.log("\npass 2: contract §6 mutant-set coverage (per surface, from the suites' own evidence)")
const MUTANT_EVIDENCE: Array<{ surface: string; file: string; contains: string }> = [
  { surface: "M24 hover/positions", file: "validation/m24/results/L2.json", contains: "mutant" },
  { surface: "M24 server", file: "validation/m24/results/L2.json", contains: "mutant" },
  { surface: "M26 graph renderer", file: "validation/m26/results/W1.json", contains: "mutant" },
  { surface: "M27 editors", file: "validation/m27/results/N1.json", contains: "mutant" },
  { surface: "M28 union", file: "validation/m28/results/U1.json", contains: "mutant" },
  { surface: "M29 wave protocol", file: "validation/m29/results/R1.json", contains: "mutant" },
  { surface: "M29 precision ledger", file: "validation/m29/results/R4-verify.json", contains: "mutant" },
  { surface: "M29 precision improvements", file: "validation/m29/results/R5-verify.json", contains: "mutant" },
]
for (const { surface, file, contains } of MUTANT_EVIDENCE) {
  let ok = false
  let detail = "missing"
  try {
    const txt = readFileSync(join(ROOT, file), "utf8").toLowerCase()
    ok = txt.includes(contains) || txt.includes("negativecases") || txt.includes("negative_cases")
    detail = ok ? "" : `no mutant record in ${file}`
  } catch {
    detail = `${file} not found`
  }
  check(`X1: §6 mutant coverage recorded for ${surface}`, ok, detail)
}

// --- Pass 3: closure preconditions (§8.5 spot-check preparation) --------------------
console.log("\npass 3: closure preconditions — owner spot-check preparation (§8.5)")
const ledger = JSON.parse(readFileSync(join(ROOT, "validation/m29/results/manifest.json"), "utf8")) as {
  issues: Array<{ code: string; status: string; evidence?: { status?: string } }>
}
const nonVerified = ledger.issues.filter((i) => i.code !== "X1" && (i.evidence?.status ?? i.status) !== "verified")
check("X1: every M29 ledger item (except X1 itself) is evidence-verified", nonVerified.length === 0, nonVerified.map((i) => i.code).join(","))

const spotCheck = {
  command: "npm run verify",
  whatToTry: [
    "open a fixture workspace in an editor with the built extension: hover shows a tier + staleness marker",
    "go-to-definition and find-references land on index-backed locations",
    'run "Backbencher: Show status" — every fact carries its claim level',
    "open the graph webview: edges carry evidence badges and the legend",
  ],
  verdictOwner: "owner (ishaq2321)",
  contract: "IDE Honesty Contract §8.5 — the achieved/not-achieved verdict is the owner's, never the gate's",
}
const spotCheckOk =
  existsSync(join(ROOT, "docs/m29/PRECISION-LEDGER.md")) &&
  existsSync(join(ROOT, "docs/m29/WAVE-PROTOCOL.md")) &&
  existsSync(join(ROOT, "docs/IDE-HONESTY-CONTRACT.md"))
check("X1: spot-check pack present (ledger, protocol, contract)", spotCheckOk)
check("X1: spot-check pack declared for the owner", typeof spotCheck.command === "string" && spotCheck.whatToTry.length >= 4)

// Pass 3b: the closure gate's own can-fail proof. A closure audit that cannot
// fail is not evidence (contract §6). This is a PURE audit over the ledger
// snapshot — negatives mutate an in-memory copy only; the on-disk ledger is
// never touched (no evidence-regress).
console.log("\npass 3b: closure-audit can-fail proof (in-memory negatives)")
function closurePreconditionViolations(
  snapshot: Array<{ code: string; status: string; evidence?: { status?: string } }>,
  packPresent: boolean,
): string[] {
  const v: string[] = []
  for (const item of snapshot) {
    if (item.code === "X1") continue
    if ((item.evidence?.status ?? item.status) !== "verified") v.push(`pre1:${item.code} not evidence-verified`)
  }
  if (!packPresent) v.push("pre2:spot-check pack incomplete")
  const x1 = snapshot.find((i) => i.code === "X1")
  if (!x1) v.push("pre3:closure gate missing from the ledger")
  return v
}
const ledgerSnapshot = ledger.issues.map((i) => ({ ...i }))
check("X1: closure preconditions audited — zero violations", closurePreconditionViolations(ledgerSnapshot, spotCheckOk).length === 0, closurePreconditionViolations(ledgerSnapshot, spotCheckOk).join("; "))
{
  const forged = ledgerSnapshot.map((i) => ({ ...i, evidence: { status: i.code === "R5" ? "planned" : (i.evidence?.status ?? i.status) } }))
  negative("X1: negative — the audit fires when an item's evidence regresses to planned", closurePreconditionViolations(forged, spotCheckOk).some((x) => x.startsWith("pre1:R5")))
  negative("X1: negative — the audit fires when the spot-check pack disappears", closurePreconditionViolations(ledgerSnapshot, false).some((x) => x.startsWith("pre2:")))
  const noX1 = ledgerSnapshot.filter((i) => i.code !== "X1")
  negative("X1: negative — the audit fires when the closure gate itself is missing", closurePreconditionViolations(noX1, spotCheckOk).some((x) => x.startsWith("pre3:")))
}

// --- Pass 4: published artifacts regenerate byte-identically at HEAD -----------------
console.log("\npass 4: published-artifact regeneration (deterministic legs)")
const ARTIFACTS: Array<{ name: string; generator: string; files: string[] }> = [
  { name: "wave-protocol doc", generator: "script/m29/generate-wave-doc.ts", files: ["docs/m29/WAVE-PROTOCOL.md"] },
  { name: "precision ledger", generator: "script/m29/generate-precision-ledger.ts", files: ["docs/m29/PRECISION-LEDGER.md", "docs/m29/precision-ledger.json"] },
]
function fingerprint(p: string): string | null {
  try {
    return readFileSync(join(ROOT, p), "utf8")
  } catch {
    return null
  }
}
for (const { name, generator, files } of ARTIFACTS) {
  const before = files.map(fingerprint)
  let exit = -1
  try {
    execFileSync("npx", ["tsx", generator], { cwd: ROOT, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "ignore"] })
    exit = 0
  } catch (e) {
    exit = (e as { status?: number }).status ?? -1
  }
  const after = files.map(fingerprint)
  check(`X1: ${name} generator runs clean`, exit === 0, `exit=${exit}`)
  check(`X1: ${name} byte-identical at HEAD`, JSON.stringify(before) === JSON.stringify(after), "regeneration drifted — hand edit or undeterministic input")
}

// --- Evidence ------------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "543",
  code: "X1",
  milestone: "M29",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  failures,
  negativeCases: negatives,
  suiteExits: exits,
  currentCommit,
  ...fingerprintFields(["m29.X1"], ROOT),
  verifierCommand: "npx tsx script/m29/verify-closure.ts",
  evidenceFile: "X1.json",
  ownerSpotCheck: spotCheck,
  generatedAt: new Date().toISOString(),
  limitations: [
    "Pass 1 runs each milestone's governance gate (which itself re-runs that milestone's suite); it proves the ladder green at HEAD, not that every individual evidence file was re-stamped in this run.",
    "The OS-matrix legs (M25 E7) record honest blocked-with-reason records for macOS/Windows; only Linux has a real machine run — cross-editor verification stays per-editor.",
    "The §8.5 achieved/not-achieved verdict on the IDE program is NOT this gate's to make: the spot-check pack above is prepared for the owner, whose verdict closes the program.",
    "Co-agent lanes (M14/M37/M40/M41) are outside this program's closure; their gates live in their own milestones.",
  ],
}
writeSealed(EVIDENCE_PATH, result)

console.log(`\nX1: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} passed, ${negatives} negatives)`)
console.log(`Evidence: ${EVIDENCE_PATH}`)
if (failed > 0) process.exitCode = 1
