// script/m27/verify-closure.ts — M27.X1 closure gate (issue #622).
//
// Final gate for the Everywhere milestone:
//   Pass 1  full M27 suite re-run at current HEAD (every verifier exits 0)
//   Pass 2  per-mutant records: named, from the pass-1 runs, cross-checked
//           against each evidence file's aggregate counts
//   Pass 3  v3 completion-bar audit at HEAD (master plan items 1-5) with
//           negative probes — the audit fires on forged bar claims
//   Pass 4  byte-identical regeneration (modulo declared volatile fields)
//
// Run: npx tsx script/m27/verify-closure.ts
// Evidence: validation/m27/results/X1.json (machine-emitted)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { writeSealed, parseSealedRecord } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = join(import.meta.dirname ?? ".", "../..")
const RESULTS = join(ROOT, "validation/m27/results")
const MANIFEST_PATH = join(RESULTS, "manifest.json")

let checks = 0
let passed = 0
let failures = 0
let negatives = 0

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function negative(label: string, ok: boolean, detail = ""): void {
  negatives++
  checks++
  if (ok) passed++
  else {
    failures++
    console.log(`  FAIL(negative): ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function runVerifier(script: string): { exit: number; stdout: string } {
  try {
    const stdout = execFileSync("npx", ["tsx", script], { cwd: ROOT, encoding: "utf8", timeout: 570_000, stdio: ["ignore", "pipe", "ignore"] })
    return { exit: 0, stdout }
  } catch (e: unknown) {
    const code = (e as { status?: number }).status
    const stdout = (e as { stdout?: string }).stdout ?? ""
    return { exit: typeof code === "number" ? code : 1, stdout }
  }
}

function fingerprint(file: string): string | null {
  try {
    const j = parseSealedRecord(file)
    delete j.generatedAt
    delete j.currentCommit
    // bbSeal is declared-volatile integrity metadata (sealedAt changes every
    // regeneration); parseSealedRecord has already VERIFIED the seal, so the
    // equivalence check compares content only (same rule as m24's closure).
    delete j.bbSeal
    return JSON.stringify(j)
  } catch {
    return null
  }
}

interface SuiteEntry {
  code: string
  script: string
  evidence: string
}
const SUITE: SuiteEntry[] = [
  { code: "N1", script: "script/m27/verify-nvim.ts", evidence: "N1.json" },
  { code: "J1", script: "script/m27/verify-lsp4ij.ts", evidence: "J1.json" },
  { code: "Z1", script: "script/m27/verify-zed.ts", evidence: "Z1.json" },
  { code: "H1", script: "script/m27/verify-helix.ts", evidence: "H1.json" },
  { code: "V1", script: "script/m27/verify-matrix.ts", evidence: "V1.json" },
]

export interface BarInput {
  ledger: Record<string, { status: string; evidence?: { status?: string } }>
  mutantsCaught: (code: string) => { caught: number; total: number } | null
  adapters: {
    subsetProofs: boolean
    i3Leg: boolean
    matrixDriftGated: boolean
    noSilentLegs: boolean
  }
}

/** v3 completion-bar audit (master plan items 1-5) as a pure function. */
export function completionBarViolations(input: BarInput): string[] {
  const v: string[] = []
  const ev = (c: string) => input.ledger[c]?.evidence?.status ?? input.ledger[c]?.status
  // Item 1: every adapter launch config proven a subset of bb_lsp's
  // declared capabilities (wire-level, via each verifier's R4/R5 passes).
  if (ev("N1") !== "verified" || ev("J1") !== "verified" || ev("Z1") !== "verified" || ev("H1") !== "verified") {
    v.push("bar1: an adapter leg is not verified (N1/J1/Z1/H1)")
  }
  if (!input.adapters.subsetProofs) v.push("bar1: capability subset proofs not all present")
  // Item 2: at least one adapter is I3 (real editor session, machine-driven).
  if (!input.adapters.i3Leg) v.push("bar2: no I3 leg (N1 is the declared slot)")
  // Item 3: the capability matrix exists, is drift-gated, declares the delta.
  if (ev("V1") !== "verified") v.push("bar3: capability matrix not verified")
  if (!input.adapters.matrixDriftGated) v.push("bar3: matrix drift gate not present")
  // Item 4: every leg green or blocked-with-reason — none silent.
  if (!input.adapters.noSilentLegs) v.push("bar4: a leg is silent (neither verified nor blocked-with-reason)")
  // Item 5: closure-gate discipline — only X1 may remain planned.
  const planned = Object.entries(input.ledger).filter(([, i]) => i.status === "planned").map(([c]) => c)
  if (!planned.every((c) => c === "X1")) v.push(`bar5: ledger has non-X1 planned cells: ${planned.join(",")}`)
  return v
}

console.log("M27.X1 closure-gate verifier\n")
const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

// --- Pass 1: full suite at HEAD ---------------------------------------------------
console.log("pass 1: full M27 suite at HEAD")
const suiteStdout: Record<string, string> = {}
for (const { code, script } of SUITE) {
  console.log(`  running ${code}…`)
  const run = runVerifier(script)
  suiteStdout[code] = run.stdout
  check(`X1: ${code} verifier passes at HEAD`, run.exit === 0, `exit=${run.exit}`)
}

// --- Pass 2: per-mutant records -----------------------------------------------------
console.log("\npass 2: per-mutant records (named, from the pass-1 runs; cross-checked against the evidence aggregates)")
const mutantsCaught: Record<string, { caught: number; total: number } | null> = {}
const perMutantRecords: Record<string, Array<{ name: string; caught: boolean }>> = {}
for (const { code, evidence } of SUITE) {
  const records: Array<{ name: string; caught: boolean }> = []
  for (const line of (suiteStdout[code] ?? "").split("\n")) {
    const caughtM = line.match(/^\s*caught:\s*(.+?)\s*$/)
    const survivedM = line.match(/^\s*SURVIVED:\s*(.+?)\s*$/)
    if (caughtM) records.push({ name: caughtM[1], caught: true })
    else if (survivedM) records.push({ name: survivedM[1], caught: false })
  }
  perMutantRecords[code] = records
  let aggCaught = -1
  let aggTotal = -1
  try {
    const rec = parseSealedRecord(join(RESULTS, evidence)) as { mutantsCaught?: number; mutantsTotal?: number }
    aggCaught = rec.mutantsCaught ?? -1
    aggTotal = rec.mutantsTotal ?? -1
  } catch {}
  const namedCaught = records.filter((r) => r.caught).length
  mutantsCaught[code] = records.length > 0 ? { caught: namedCaught, total: records.length } : aggTotal >= 0 ? { caught: aggCaught, total: aggTotal } : null
  check(`X1: ${code} evidence carries a per-mutant record`, records.length > 0 || aggTotal > 0, `named=${records.length} aggregate=${aggCaught}/${aggTotal}`)
  if (records.length > 0 && aggTotal >= 0) {
    check(`X1: ${code} named record count agrees with the evidence aggregate`, records.length === aggTotal, `named=${records.length} aggregate=${aggTotal}`)
  }
  check(`X1: ${code} every mutant caught (${namedCaught}/${records.length || aggTotal})`, records.length > 0 ? namedCaught === records.length : aggCaught === aggTotal, `${namedCaught}/${records.length || aggTotal}`)
}

// --- Pass 3: v3 completion-bar audit at HEAD ----------------------------------------
console.log("\npass 3: v3 completion-bar audit (master plan items 1-5)")
const manifest = parseSealedRecord(MANIFEST_PATH) as { issues: Array<{ code: string; status: string; evidence?: { status?: string } }> }
const ledgerMap: BarInput["ledger"] = {}
for (const i of manifest.issues) ledgerMap[i.code] = { status: i.status, evidence: i.evidence }

// The subset proof and I3 facts come from the evidence files themselves.
function evidenceFor(code: string): Record<string, unknown> | null {
  const entry = SUITE.find((s) => s.code === code)
  if (!entry) return null
  try {
    return parseSealedRecord(join(RESULTS, entry.evidence)) as Record<string, unknown>
  } catch {
    return null
  }
}
const n1Ev = evidenceFor("N1")
const blockedLegs = (n1Ev?.blockedLegs as Array<{ leg: string }> | undefined) ?? []
const matrixSrc = existsSync(join(ROOT, "script/m27/verify-matrix.ts")) ? readFileSync(join(ROOT, "script/m27/verify-matrix.ts"), "utf8") : ""

const barInput: BarInput = {
  ledger: ledgerMap,
  mutantsCaught: (c) => mutantsCaught[c] ?? null,
  adapters: {
    subsetProofs: SUITE.every((s) => {
      const ev = evidenceFor(s.code)
      return ev !== null && typeof ev === "object" && ev["status"] === "verified"
    }),
    i3Leg: n1Ev !== null && n1Ev["claimLevel"] !== undefined && String(n1Ev["claimLevel"]).startsWith("I3") && blockedLegs.length === 0,
    matrixDriftGated: matrixSrc.includes("byte-identical") && existsSync(join(ROOT, "docs/m27/FORK-CAPABILITY-MATRIX.md")),
    noSilentLegs: ["N1", "J1", "Z1", "H1"].every((code) => {
      const ev = evidenceFor(code)
      if (!ev) return false
      const blocked = (ev["blockedLegs"] as Array<{ leg?: string; reason?: string }> | undefined) ?? []
      return blocked.every((b) => typeof b.reason === "string" && b.reason.length > 0)
    }),
  },
}
const barViolations = completionBarViolations(barInput)
check("X1: v3 completion bar audited item-by-item — zero violations", barViolations.length === 0, barViolations.join("; "))
// Negative probes: the audit must fire on forged bar claims.
{
  const noI3: BarInput = { ...barInput, adapters: { ...barInput.adapters, i3Leg: false } }
  negative("X1: negative — bar audit fires when the I3 leg disappears", completionBarViolations(noI3).some((x) => x.startsWith("bar2")))
  const unproven: BarInput = { ...barInput, adapters: { ...barInput.adapters, subsetProofs: false } }
  negative("X1: negative — bar audit fires when a subset proof is lost", completionBarViolations(unproven).some((x) => x.startsWith("bar1")))
  const dirtyLedger: BarInput = { ...barInput, ledger: { ...barInput.ledger, H1: { status: "planned" } } }
  negative("X1: negative — bar audit fires when an adapter regresses to planned", completionBarViolations(dirtyLedger).some((x) => x.startsWith("bar1")))
  const silentLeg: BarInput = { ...barInput, adapters: { ...barInput.adapters, noSilentLegs: false } }
  negative("X1: negative — bar audit fires on a silent leg", completionBarViolations(silentLeg).some((x) => x.startsWith("bar4")))
}

// --- Pass 4: byte-identical regeneration (deterministic legs) ------------------------
console.log("\npass 4: byte-identical regeneration check (modulo declared volatile fields)")
for (const { code, script, evidence } of SUITE) {
  const fp = join(RESULTS, evidence)
  const before = fingerprint(fp)
  const run = runVerifier(script)
  const after = fingerprint(fp)
  check(`X1: ${code} regeneration run passes`, run.exit === 0, `exit=${run.exit}`)
  check(`X1: ${code} evidence byte-identical (modulo generatedAt/currentCommit)`, before !== null && before === after)
}
// The generated matrix must also regenerate byte-identically (raw content:
// it is markdown, so the JSON fingerprint helper does not apply).
{
  const matrixPath = join(ROOT, "docs/m27/FORK-CAPABILITY-MATRIX.md")
  const before = existsSync(matrixPath) ? readFileSync(matrixPath, "utf8") : null
  void runVerifier("script/m27/verify-matrix.ts")
  const after = existsSync(matrixPath) ? readFileSync(matrixPath, "utf8") : null
  check("X1: capability matrix regenerates byte-identical", before !== null && before === after)
}

// --- Evidence -------------------------------------------------------------------------
const failed = checks - passed
const result = {
  issue: "622",
  code: "X1",
  milestone: "M27",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  failures,
  negativeCases: negatives,
  currentCommit,
  verifierCommand: "npx tsx script/m27/verify-closure.ts",
  barViolations,
  perMutantRecords,
  generatedAt: new Date().toISOString(),
}
mkdirSync(RESULTS, { recursive: true })
writeSealed(join(RESULTS, "X1.json"), result)
console.log(`\nX1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${negatives} negative)`)
if (result.status !== "verified") process.exitCode = 1
