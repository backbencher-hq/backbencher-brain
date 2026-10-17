// script/m61/project-lane-ledgers.ts — the generic lane-ledger projector.
//
// WHAT THIS CLOSES. script/m61/ledger_projection.ts states the rule — a lane
// ledger is a PROJECTION of its records, the record is the authority — and
// script/m61/verify-ledger-truth.ts (V7) enforces it across every lane. But only
// the eight in-scope lanes call the shared owner from inside their own
// governance gate; the other sixteen ledgers are hand-maintained, so whenever a
// lane's record moves (a re-run on a dirty tree, a re-measured artifact, a fixed
// gate) its manifest keeps the old story and both V7.G2 and
// verify-orphan-gates.G5 report the drift. Measured on this tree (2026-10-17):
// 24 entries across 7 lanes claiming `verified` over records that read
// `known-gap`/`blocked`.
//
// This tool is that projection for the lanes that do not own one. It uses the
// SAME function the in-scope gates use (projectLedger), so there is still one
// rule, one set of negatives, and one behaviour: status and every count come
// from the record, a count the record does not report is DROPPED rather than
// left stale, the reason travels with the status, and the lane status is
// derived mechanically. Nothing is ever RAISED: a record that reads
// `known-gap` can never project `verified`, because no code here invents a
// status.
//
// It refuses to guess. A record it cannot trust (missing, unparseable,
// tamper-broken) is reported and the entry is left untouched — rule 3 of the
// shared owner. It never edits a record.
//
// Usage:
//   npx tsx script/m61/project-lane-ledgers.ts --check     # report, write nothing
//   npx tsx script/m61/project-lane-ledgers.ts             # project every lane that drifted
//   npx tsx script/m61/project-lane-ledgers.ts m20 m26     # only these lanes
//
// Exit 0 = every readable lane now agrees with its records (or already did);
// 1 = drift remains, or a finding (a non-verified entry with no reason, a
// `verified` record with no can-fail proof) that a projection cannot repair.

import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { readEvidence, readEvidenceAllowingLegacy, writeSealed } from "../lib/evidence.ts"
import { type ProjectableLedger, LANE_STATUSES, projectLedger } from "./ledger_projection.ts"
import { reRecordRegisterRow } from "./seal_register.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const VALIDATION = path.join(ROOT, "validation")

const argv = process.argv.slice(2)
const CHECK = argv.includes("--check")
const ONLY = argv.filter((a) => !a.startsWith("--"))

type Lane = {
  lane: string
  ledgerPath: string
  resultsDir: string
  ledger: ProjectableLedger
}

/** A claim ledger states a status union per issue. The M14-era `issues[].closed`
 *  shape states no status at all and is not a claim ledger (V7's census names it
 *  the same way); it is skipped here rather than coerced. */
function claimLedgerOf(lane: string): Lane | null {
  const ledgerPath = path.join(VALIDATION, lane, "results", "manifest.json")
  if (!existsSync(ledgerPath)) return null
  let ledger: ProjectableLedger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as ProjectableLedger
  } catch {
    return null
  }
  const issues = Array.isArray(ledger.issues) ? ledger.issues : []
  if (issues.length === 0) return null
  const claimShape = issues.every((i) => typeof (i as Record<string, unknown>).status === "string")
  return claimShape ? { lane, ledgerPath, resultsDir: path.join(VALIDATION, lane, "results"), ledger } : null
}

/** The trusted read, with the legacy arm for records written before M61 opened
 *  the sealing window. They are read (their shape is the only record we have)
 *  but the fact is printed, never hidden: an unsealed record is not evidence of
 *  tampering, and a projection that refused them would leave half the lanes
 *  unprojectable. */
function makeReader(resultsDir: string): (file: string) => Record<string, unknown> | null {
  const cache = new Map<string, Record<string, unknown> | null>()
  return (file: string) => {
    if (cache.has(file)) return cache.get(file) ?? null
    const abs = path.join(resultsDir, file)
    if (!existsSync(abs)) {
      cache.set(file, null)
      return null
    }
    const strict = readEvidence<Record<string, unknown>>(abs)
    const read = strict.ok ? strict : readEvidenceAllowingLegacy<Record<string, unknown>>(abs)
    const record = read.ok ? read.record : null
    cache.set(file, record)
    return record
  }
}

function main(): void {
  const lanes = readdirSync(VALIDATION, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((lane) => ONLY.length === 0 || ONLY.includes(lane))
    .sort()
    .map(claimLedgerOf)
    .filter((l): l is Lane => l !== null)

  console.log(`project-lane-ledgers: ${lanes.length} claim ledger(s)${CHECK ? " [check only]" : ""}`)

  let drifted = 0
  let healed = 0
  const unrepairable: string[] = []

  for (const { lane, ledgerPath, resultsDir, ledger } of lanes) {
    const readRecord = makeReader(resultsDir)
    const before = JSON.stringify({ status: ledger.status, issues: ledger.issues })
    const result = projectLedger(ledger, readRecord, { selfOwned: [] })
    const after = JSON.stringify({ status: result.ledger.status, issues: result.ledger.issues })

    if (before !== after) {
      drifted++
      if (!CHECK) {
        writeSealed(ledgerPath, result.ledger as unknown as Record<string, unknown>)
        // A registered ledger that was just resealed must move its register row,
        // or M61.A1's A4 reports the seal as refreshed when the bytes say
        // otherwise. Measured on this exact path: projecting m41/m56/m21's
        // ledgers moved their digests and left three red rows behind.
        const moved = reRecordRegisterRow(ROOT, ledgerPath, `the ledger was re-projected from its records by script/m61/project-lane-ledgers.ts (${result.healed.length} entr${result.healed.length === 1 ? "y" : "ies"} changed), which writes through writeSealed: content and seal moved together; verdicts unchanged`)
        if (moved.ok) console.log(`      register: row moved ${moved.oldDigest.slice(0, 8)} -> ${moved.newDigest.slice(0, 8)}`)
        healed++
      }
      console.log(`  ${CHECK ? "drift" : "projected"} ${lane}: ${result.healed.length} entr${result.healed.length === 1 ? "y" : "ies"} changed`)
      for (const h of result.healed) console.log(`      ${h}`)
    } else {
      console.log(`  ok    ${lane}`)
    }

    // The findings that matter are the ones that survive the projection. The
    // projection is a fixpoint (ledger_projection M9), so a second pass over
    // the healed ledger reports exactly the state the file will be left in:
    // a `known-gap` entry whose record carries no reason, or a `verified`
    // record with no can-fail proof, is a defect in the RECORD and no
    // projection may invent the missing half.
    const finalState = projectLedger(result.ledger, readRecord, { selfOwned: [] })
    for (const f of finalState.findings) unrepairable.push(`${lane}.${f}`)
  }

  if (unrepairable.length > 0) {
    console.log(`\nfindings a projection cannot repair (${unrepairable.length}):`)
    for (const f of unrepairable) console.log(`  - ${f}`)
  }
  console.log(`\n${CHECK ? "drifted" : "projected"}: ${drifted} lane(s), ${healed} written`)
  const clean = unrepairable.length === 0 && (CHECK ? drifted === 0 : true)
  process.exit(clean ? 0 : 1)
}

main()
