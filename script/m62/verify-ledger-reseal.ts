#!/usr/bin/env tsx
// script/m62/verify-ledger-reseal.ts — the ledger refresh must be UNABLE to lie.
//
// WHAT THIS GATES. `script/m62/reseal-ledger.ts` corrects a sealed ledger whose
// rows have drifted from the evidence they summarise. That is a powerful thing to
// hand a script: it can promote a row's status. The whole safety argument is that
// a row's status is COPIED from its evidence file and only when that file's own
// seal verifies — so a hand-edited evidence file cannot promote anything, because
// a tampered file is not read as evidence.
//
// Those words are worth nothing without a gate that plants the defects and
// requires them to be caught. That is what this is.
//
// THE MUTANTS, and why each is the one that matters:
//   M1 tampered evidence   — the highest-consequence one. If a file whose seal is
//                            broken could still promote a row, the seal would be
//                            decorative and the tool would be a forgery machine.
//   M2 missing evidence   — must leave the row alone, never invent a status.
//   M3 no-op ledger        — an agreeing ledger must change nothing, so the tool
//                            cannot churn a clean record.
//   M4 empty reason        — `refreshStaleSeal` refuses an empty reason; the tool
//                            must not be able to bypass that by writing one itself.
//
// Plus the real leg: the committed m27 ledger must AGREE with its evidence, which
// is the drift that made X1's completion bar red in the first place.

import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { SEAL_KEY, readEvidence, refreshStaleSeal, sealFor, verifySeal } from "../lib/evidence.ts"
import { applyRefresh, planRefresh } from "./reseal-ledger.ts"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}
const negative = (name: string, ok: boolean, detail = ""): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`)
}

const ROOT = process.cwd()
const LEDGER = path.join(ROOT, "validation", "m27", "results", "manifest.json")

// ---------------------------------------------------------------------------
// The real leg: does the committed ledger agree with its evidence?
// ---------------------------------------------------------------------------
{
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Record<string, unknown>
  const verdict = verifySeal(ledger)
  check(
    "the committed m27 ledger's own seal verifies",
    verdict.ok,
    verdict.ok ? `sealed ${verdict.seal.contentSha256.slice(0, 12)}` : `*** ${verdict.reason} ***`,
  )
  const plan = planRefresh(ledger, path.dirname(LEDGER))
  check(
    "every ledger row agrees with its sealed evidence (no drift)",
    plan.changed.length === 0,
    plan.changed.length === 0
      ? `${plan.agreed.length} rows checked, 0 drifted`
      : `*** ${plan.changed.length} drifted: ${plan.changed.map((c) => `${c.code} ${c.from}->${c.to}`).join("; ")} ***`,
  )
  check(
    "no evidence file behind a ledger row failed its seal",
    plan.tampered.length === 0,
    plan.tampered.length === 0 ? "none tampered" : `*** ${plan.tampered.join(", ")} ***`,
  )
}

// ---------------------------------------------------------------------------
// The sandbox: a throwaway ledger + evidence to plant defects in.
// ---------------------------------------------------------------------------
const work = mkdtempSync(path.join(os.tmpdir(), "bb-reseal-"))
const results = path.join(work, "results")
mkdirSync(results, { recursive: true })

const sandboxLedger = path.join(results, "manifest.json")
/** Write a record SEALED. refreshStaleSeal only repairs `tampered`, so seeding
 *  by calling it on an unsealed file silently produced unsealed files and every
 *  downstream leg then measured the wrong thing — kind=unsealed where the leg
 *  expected `tampered`. Sealing is done here, explicitly. */
const writeSealedRecord = (file: string, record: Record<string, unknown>): void => {
  const bare = { ...record }
  delete bare[SEAL_KEY]
  writeFileSync(file, `${JSON.stringify({ ...bare, [SEAL_KEY]: sealFor(bare) }, null, 2)}\n`)
}

const seed = (ledger: Record<string, unknown>, evidence: Record<string, unknown>): void => {
  writeSealedRecord(sandboxLedger, ledger)
  writeSealedRecord(path.join(results, "W1.json"), evidence)
}

const LEDGER_SEED = { issues: [{ code: "W1", status: "known-gap", evidence: { status: "known-gap" } }] }
const EVIDENCE_VERIFIED = { code: "W1", status: "verified", checks: 3, passed: 3 }
const EVIDENCE_GAP = { code: "W1", status: "known-gap", checks: 3, passed: 1 }

seed(LEDGER_SEED, EVIDENCE_VERIFIED)

{
  const plan = planRefresh(JSON.parse(readFileSync(sandboxLedger, "utf8")), results)
  check(
    "a ledger that disagrees with a SEALED evidence file is planned for correction",
    plan.changed.length === 1 && plan.changed[0]!.to === "verified",
    plan.changed.length === 1 ? `W1 known-gap -> ${plan.changed[0]!.to}` : `no change planned (${plan.changed.length})`,
  )
}

// --- M1: TAMPERED EVIDENCE MUST NOT PROMOTE ---------------------------------
{
  const p = path.join(results, "W1.json")
  // change the CONTENT and leave the OLD SEAL in place — exactly what a forgery
  // or a careless hand-edit looks like. (Stripping the seal instead would yield
  // `unsealed`, which is a different state and a different refusal.)
  const rec = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
  rec["status"] = "forged-verified"
  writeFileSync(p, `${JSON.stringify(rec, null, 2)}\n`)
  const tampered = verifySeal(JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>)
  check("control: the tampered evidence file's seal is detected as tampered", !tampered.ok && tampered.kind === "tampered", tampered.ok ? "*** seal still verified ***" : `kind=${tampered.kind}`)

  const plan = planRefresh(JSON.parse(readFileSync(sandboxLedger, "utf8")), results)
  negative(
    "M1: TAMPERED evidence does NOT promote the row",
    plan.changed.length === 0 && plan.tampered.includes("W1 (W1.json)"),
    plan.changed.length > 0 ? `*** it planned ${plan.changed[0]!.from} -> ${plan.changed[0]!.to} from a TAMPERED file ***` : `refused; reported tampered=${plan.tampered.join(",") || "none"}`,
  )

  // and --apply must refuse outright when anything is tampered
  // The refusal must be in applyRefresh itself, not in the CLI wrapper, so any
  // caller gets it. This asserts that directly.
  const ledgerObj = JSON.parse(readFileSync(sandboxLedger, "utf8")) as Record<string, unknown>
  const bytesBefore = readFileSync(sandboxLedger, "utf8")
  const res = applyRefresh(sandboxLedger, ledgerObj, results, "M1 probe: must refuse")
  check(
    "M1: applyRefresh REFUSES when any evidence is tampered, and writes nothing",
    !res.ok && readFileSync(sandboxLedger, "utf8") === bytesBefore,
    !res.ok ? res.reason.slice(0, 90) : "*** a tampered file was written over ***",
  )
  seed(LEDGER_SEED, EVIDENCE_VERIFIED)
}

// --- M2: MISSING EVIDENCE MUST NOT BE INVENTED ------------------------------
{
  rmSync(path.join(results, "W1.json"))
  const plan = planRefresh(JSON.parse(readFileSync(sandboxLedger, "utf8")), results)
  check(
    "M2: a row with NO evidence file is left alone, never given an invented status",
    plan.changed.length === 0 && plan.noEvidence.includes("W1"),
    plan.noEvidence.includes("W1") ? "reported as having no evidence" : `*** changed anyway: ${JSON.stringify(plan.changed)} ***`,
  )
  seed(LEDGER_SEED, EVIDENCE_VERIFIED)
}

// --- M3: AN ALREADY-AGREEING LEDGER IS A NO-OP ------------------------------
{
  const ledger = JSON.parse(readFileSync(sandboxLedger, "utf8")) as Record<string, unknown>
  ;(ledger.issues as Array<Record<string, unknown>>)[0]!.evidence = { status: "verified" }
  writeFileSync(sandboxLedger, `${JSON.stringify(ledger, null, 2)}\n`)
  refreshStaleSeal(sandboxLedger, "sandbox: make the ledger agree")
  const before = readFileSync(sandboxLedger, "utf8")
  const plan = planRefresh(JSON.parse(before), results)
  const applied = applyRefresh(sandboxLedger, JSON.parse(before), results, "sandbox no-op")
  const after = readFileSync(sandboxLedger, "utf8")
  check(
    "M3: a ledger that already agrees is left byte-identical",
    plan.changed.length === 0 && applied.applied.length === 0 && before === after,
    plan.changed.length === 0 && before === after ? "no bytes moved" : "*** the no-op moved bytes ***",
  )
  seed(LEDGER_SEED, EVIDENCE_VERIFIED)
}

// --- M4: THE REASON IS REQUIRED ---------------------------------------------
{
  const rec = JSON.parse(readFileSync(path.join(results, "W1.json"), "utf8")) as Record<string, unknown>
  writeFileSync(path.join(results, "W1.json"), `${JSON.stringify(rec, null, 2)}\n`)
  const blank = refreshStaleSeal(path.join(results, "W1.json"), "   ")
  negative(
    "M4: refreshStaleSeal refuses a blank reason (the repair must be justified)",
    !blank.ok,
    blank.ok ? "*** a blank reason was accepted ***" : blank.reason,
  )
  const missing = refreshStaleSeal(path.join(results, "does-not-exist.json"), "a real reason")
  negative(
    "M4: refreshStaleSeal refuses a file that does not exist",
    !missing.ok,
    missing.ok ? "*** a missing file was refreshed ***" : missing.reason,
  )
}

// --- the control: a properly sealed, genuinely-changed record DOES re-seal ----
{
  const p = path.join(results, "W1.json")
  // A GENUINE stale seal: the record carries a seal that no longer matches its
  // content. That is what refreshStaleSeal exists to repair — as opposed to an
  // unsealed file, which it refuses.
  const rec = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
  rec["checks"] = 99
  writeFileSync(p, `${JSON.stringify(rec, null, 2)}\n`)
  const res = refreshStaleSeal(p, "sandbox control: a real content change")
  check(
    "control: a genuinely-changed record DOES re-seal with a stated reason",
    res.ok,
    res.ok ? `re-sealed to ${res.newDigest.slice(0, 12)}` : `*** ${res.reason} ***`,
  )
  check(
    "control: and the re-sealed record then verifies",
    readEvidence(p).ok,
    "trusted read accepts it",
  )
}

rmSync(work, { recursive: true, force: true })

const failed = checks.filter((c) => !c.ok).length
console.log(`\nLEDGER RESEAL: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)