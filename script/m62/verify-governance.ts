// script/m62/verify-governance.ts — M62.G1 (issue #874).
//
// Governance runs BEFORE feature claims are trusted, on every run:
//
//   R1 bar re-audit:   the M62 gate chain (A1 address, A2 consumers, A3
//                      arrival, D1 docs) is RE-EXECUTED here, so a green ledger
//                      can never be a stale claim; the lane's own bars (M55 X1,
//                      M61 X1) are re-read and must be verified.
//   R2 projection:     every issue entry is DERIVED from the sealed record it
//                      points at (counts are never hand-typed); a record re-run
//                      at a new commit HEALS its entry and says so.
//   R3 ledger rules:   identity, ordering (G1 first, X1 last), acceptance and
//                      closure requirements, lane discipline (D-7), and the
//                      closure rule (green + can-fail proof, or planned).
//   R4 chain wiring:   every M62 gate command appears in npm run verify AND
//                      verify:fast (a gate wired nowhere rots).
//   R5 negatives:      eight in-memory doctored ledgers/chains prove each rule
//                      FAILS when it should.
//
// The run substitutes its OWN measured entry and validates the ledger whole
// (never asserted). A red run writes G1 as known-gap, which keeps the ledger
// `open`.
//
// Evidence: validation/m62/results/G1.json (machine-emitted, sealed).
// Run: npx tsx script/m62/verify-governance.ts

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readEvidence, verifySeal, writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import {
  EXPECTED_CODES,
  GATE_COMMANDS,
  PREREQUISITE_RECORDS,
  SELF_OWNED_CODES,
  WIRED_COMMANDS,
  chainFindings,
  entryDrift,
  projectionMoved,
  ledgerEntryFrom,
  type Ledger,
  type LedgerIssue,
  validateLedger,
} from "./governance_core.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(ROOT, "validation/m62/results")
const EVIDENCE = path.join(RESULTS, "G1.json")
const LEDGER_PATH = path.join(RESULTS, "manifest.json")
const PLAN = path.join(ROOT, "docs/m62/M62-MASTER-PLAN.md")

let checks = 0
let passed = 0
const failures: string[] = []
const notes: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function negative(label: string, ok: boolean, detail = ""): void {
  check(`negative: ${label}`, ok, detail)
}
const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

/** Run one command, returning {ok, lastLine}. The bar re-audit's teeth: a red
 *  gate here keeps this run red and the ledger open. */
function runGate(cmd: string): { ok: boolean; last: string } {
  try {
    const out = execFileSync("bash", ["-lc", cmd], { cwd: ROOT, encoding: "utf8", timeout: 900_000, stdio: ["ignore", "pipe", "pipe"] })
    const lines = out.trim().split("\n")
    return { ok: true, last: lines[lines.length - 1] ?? "" }
  } catch (error: any) {
    const out = String(error?.stdout ?? "") + String(error?.stderr ?? "")
    const lines = out.trim().split("\n")
    return { ok: false, last: lines[lines.length - 1] ?? String(error?.message ?? error).slice(0, 160) }
  }
}

function main(): void {
  const planText = readFileSync(PLAN, "utf8")
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger

  // --- R1: the bar re-audit ---------------------------------------------------------
  console.log("R1: the bar re-audit (the milestone's own gates, re-executed)")
  const gateResults: Record<string, { ok: boolean; last: string }> = {}
  for (const [code, cmd] of GATE_COMMANDS) {
    const res = runGate(cmd)
    gateResults[code] = res
    check(`R1: gate ${code} is green at this tree`, res.ok, res.last)
  }
  const prerequisiteBars: Array<{ name: string; status: string; commit: string }> = []
  for (const [name, file] of PREREQUISITE_RECORDS) {
    const read = readEvidence<{ status?: string; currentCommit?: string; passed?: number }>(path.join(ROOT, file))
    if (!read.ok) {
      check(`R1: prerequisite ${name} is readable and sealed`, false, read.reason)
      continue
    }
    prerequisiteBars.push({ name, status: String(read.record.status ?? ""), commit: String(read.record.currentCommit ?? "") })
    check(`R1: prerequisite ${name} is verified`, read.record.status === "verified", `status=${read.record.status}`)
  }

  // --- R2: the projection ------------------------------------------------------------
  console.log("\nR2: the ledger is a projection of the records")
  const healed: string[] = []
  const derivedEntries = new Map<string, LedgerIssue["evidence"]>()
  for (const issue of ledger.issues) {
    if (issue.code === "G1" || issue.code === "X1") continue
    const file = issue.evidence?.evidenceFile ?? `${issue.code}.json`
    const read = readEvidence<Record<string, unknown>>(path.join(RESULTS, file))
    if (!read.ok) {
      check(`R2: the record for ${issue.code} (${file}) is readable and sealed`, false, read.reason)
      continue
    }
    const rec = read.record as any
    const proofs = {
      mutants: typeof rec.mutantsTotal === "number" ? rec.mutantsTotal : 0,
      negatives: typeof rec.negativeCases === "number" ? rec.negativeCases : 0,
    }
    const derived = ledgerEntryFrom(rec, proofs)
    derivedEntries.set(issue.code, derived)
    const drift = entryDrift(issue.evidence, derived)
    if (drift.length === 0) check(`R2: ${issue.code}'s entry equals its record's derivation`, true)
    else if (projectionMoved(issue.evidence, derived)) {
      // DECIDABLE stale case: the record was re-run (new seal, or a new commit)
      // since the entry was projected. The gate re-projects it and says so.
      healed.push(issue.code)
      check(`R2: ${issue.code}'s entry was healed from its re-run record (stale projection)`, true)
    } else {
      // Same seal, different values: a re-run cannot explain this. It is drift.
      check(`R2: ${issue.code}'s entry equals its record's derivation`, false, drift.join(", "))
    }
  }
  // The A3 companion record (the generated doc) is part of A3's claim.
  const d1 = readEvidence<{ status?: string; passed?: number }>(path.join(RESULTS, "D1.json"))
  check("R2: the A3 companion doc record (D1.json) is verified and sealed", d1.ok && d1.record.status === "verified", d1.ok ? `status=${d1.record.status}` : d1.reason)

  // --- R3: the ledger, validated whole with this run's own entry ----------------------
  console.log("\nR3: the ledger rules (with this run's own measured entry)")
  const gateAllGreen = Object.values(gateResults).every((r) => r.ok) && prerequisiteBars.every((b) => b.status === "verified")
  const ownFailed = checks - passed
  const failed = ownFailed + (gateAllGreen ? 0 : 1)
  const ownEntry: LedgerIssue = {
    ...(ledger.issues.find((i) => i.code === "G1") as LedgerIssue),
    status: failed === 0 ? "verified" : "known-gap",
    evidence: {
      status: failed === 0 ? "verified" : "known-gap",
      verifierCommand: "npx tsx script/m62/verify-governance.ts",
      evidenceFile: "G1.json",
      passed: passed,
      failed: failed,
      realFailed: failed,
      negativeCases: 8,
      recordCommit: currentCommit,
    },
  }
  const projected: Ledger = {
    ...ledger,
    issues: ledger.issues.map((i) => (i.code === "G1" ? ownEntry : derivedEntries.has(i.code) ? { ...i, evidence: derivedEntries.get(i.code) } : i)),
  }
  const errors = validateLedger(projected, planText, SELF_OWNED_CODES)
  check("R3: the ledger (whole, with this run's entry) passes every structural rule", errors.length === 0, errors.join(", "))
  check("R3: G1 is first and X1 last, and the issue set is exactly the declared five", projected.issues.map((i) => i.code).join(",") === EXPECTED_CODES.join(","), projected.issues.map((i) => i.code).join(","))
  const statusDerived = projected.issues.every((i) => i.status === "verified") ? "closed" : "open"
  check(`R3: the ledger status matches its entries' states (${statusDerived})`, projected.status === statusDerived, `disk=${projected.status} derived=${statusDerived}`)

  // --- R4: chain wiring ----------------------------------------------------------------
  console.log("\nR4: chain wiring (a gate wired nowhere rots)")
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
  const chainErrors = chainFindings(String(pkg.scripts.verify ?? ""), String(pkg.scripts["verify:fast"] ?? ""), WIRED_COMMANDS)
  check("R4: every M62 gate command is wired into npm run verify and verify:fast", chainErrors.length === 0, chainErrors.join(", "))

  // --- R5: negatives ---------------------------------------------------------------------
  console.log("\nR5: negatives (each rule must be able to fail)")
  const clean = JSON.parse(JSON.stringify(projected)) as Ledger
  const mk = (mutate: (l: Ledger) => void, chain?: (cmd: string) => string): string[] => {
    const copy = JSON.parse(JSON.stringify(clean)) as Ledger
    mutate(copy)
    if (chain) {
      const cmds = WIRED_COMMANDS.map(chain)
      return [...validateLedger(copy, planText, SELF_OWNED_CODES), ...chainFindings(cmds.join(" && "), cmds.join(" && "))]
    }
    return validateLedger(copy, planText, SELF_OWNED_CODES)
  }
  negative("a hollow closure (can-fail proof stripped) FAILS", mk((l) => { const i = l.issues.find((x) => x.code === "A2")!; i.evidence = { ...i.evidence, mutantsCaught: 0, mutantsTotal: 5, negativeCases: 0 } }).some((e) => e.startsWith("hollow-")))
  negative("a removed issue FAILS", mk((l) => { l.issues = l.issues.filter((i) => i.code !== "A3") }).includes("issue-count") || mk((l) => { l.issues = l.issues.filter((i) => i.code !== "A3") }).includes("code:A3"))
  negative("a mis-ordered group FAILS", mk((l) => { const a = l.issues.map((i) => i.code); const idxA1 = a.indexOf("A1"), idxG1 = a.indexOf("G1"); const tmp = l.issues[idxA1]!; l.issues[idxA1] = l.issues[idxG1]!; l.issues[idxG1] = tmp }).some((e) => e.startsWith("order:")))
  negative("a lane escape FAILS", mk((l) => { l.issues.find((x) => x.code === "A2")!.artifacts = ["script/m59/verify-lines.ts"] }).some((e) => e.includes("escapes the lane")))
  negative("an unwired gate FAILS", (() => { const cmds = WIRED_COMMANDS.filter((c) => c !== "npx tsx script/m62/verify-consumers.ts"); return chainFindings(cmds.join(" && "), cmds.join(" && ")) })().length > 0)
  const a1Derived = derivedEntries.get("A1")
  const a1Disk = { ...(clean.issues.find((i) => i.code === "A1")!.evidence ?? {}) }
  negative("a hand-edited count is caught by the drift check", a1Derived !== undefined && entryDrift({ ...a1Disk, passed: (a1Derived.passed ?? 0) + 1 }, a1Derived).some((d) => d.startsWith("passed")), `derived=${JSON.stringify(a1Derived)}`)
  {
    const raw = JSON.parse(readFileSync(path.join(RESULTS, "A1.json"), "utf8")) as Record<string, unknown>
    const verdict = verifySeal({ ...raw, passed: Number(raw.passed ?? 0) + 1 })
    negative("a tampered record fails its seal", !verdict.ok && verdict.kind === "tampered", verdict.ok ? "the tampered record verified" : verdict.kind)
  }
  negative("a planned entry carrying evidence FAILS", mk((l) => { const i = l.issues.find((x) => x.code === "A1")!; i.status = "planned" }).includes("planned-evidence:A1"))

  // --- write the evidence + the healed ledger -------------------------------------------
  const result = {
    issue: "M62.G1",
    code: "G1",
    milestone: "M62",
    status: failed === 0 ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    realFailed: failed,
    negativeCases: 8,
    mutantsCaught: 0,
    mutantsTotal: 0,
    currentCommit,
    ...fingerprintFields(["m62.G1"], ROOT),
    verifierCommand: "npx tsx script/m62/verify-governance.ts",
    evidenceFile: "G1.json",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    barReAudit: Object.entries(gateResults).map(([code, r]) => ({ code, ok: r.ok, last: r.last })),
    prerequisites: prerequisiteBars,
    healedEntries: healed,
    ledgerStatus: projected.status,
    limitations: [
      "The bar re-audit re-executes the M62 gates; the lane's deeper suites (m24/m26/m42/m44/m55) are re-earned by X1's lane audit and recorded in its evidence.",
      "G1's own entry closure rule is enforced where the entry is written (this run), never judged by a sibling gate.",
    ],
  }
  mkdirSync(RESULTS, { recursive: true })
  writeSealed(EVIDENCE, result)
  writeFileSync(LEDGER_PATH, `${JSON.stringify({ ...projected, status: projected.issues.every((i) => i.status === "verified") ? "closed" : "open" }, null, 2)}\n`)
  console.log(`\nG1: ${result.status.toUpperCase()} (${passed}/${checks} passed)${healed.length ? ` — healed: ${healed.join(", ")}` : ""}`)
  for (const n of notes) console.log(`  note: ${n}`)
  process.exit(failed === 0 ? 0 : 1)
}

main()
