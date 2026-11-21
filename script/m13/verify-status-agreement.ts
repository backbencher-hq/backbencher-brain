// script/m13/verify-status-agreement.ts
//
// Reported on 0.1.9: "Index status still says incomplete vs recordedStatus=complete."
//
// The reported run is the bettercap one: `breakdown: 1972 newly parsed | 1 unchanged | 0
// skipped`. Total discovered 1973, parsed 1972 — so there IS a one-file shortfall, and the
// run recorded `status: complete` because nothing errored. Health derived `incomplete` from
// the counts and printed the stored status beside it, which reads as the tool contradicting
// itself.
//
// The 0.1.9 fix taught health that a DELIBERATE SKIP explains a shortfall. Then this
// release split `skippedFiles` from `unchangedFiles` (so the health message could tell them
// apart) — and the capacity still counted only the skip half, so every UNCHANGED file became
// an "unexplained" shortfall and the contradiction came straight back. This gate pins the
// arithmetic for every cause, because that is the part that keeps regressing.

import { deriveIndexCompleteness } from "../../src/intelligence/health/health-provider"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const derive = (o: Partial<Parameters<typeof deriveIndexCompleteness>[0]>) =>
  deriveIndexCompleteness({
    recordPresent: true,
    storedStatus: "complete",
    recordedTotal: 1973,
    recordedIndexed: 1972,
    runSkippedFiles: 0,
    runUnchangedFiles: 0,
    runErrorFiles: 0,
    ...o,
  } as any)

console.log("M13 index status agreement\n")

// ── the reported shape: 1 unchanged file explains the 1-file gap ─────────────
{
  const r = derive({ runSkippedFiles: 0, runUnchangedFiles: 1 })
  check("THE REPORTED DEFECT: an UNCHANGED file explains the shortfall", r.unexplainedShortfall === 0, `unexplained=${r.unexplainedShortfall}`)
  check("so the status is NOT derived as incomplete", r.derivedStatus === "complete", r.derivedStatus)
  check("and the stored status is NOT contradicted", r.storedStatusContradicted === false, String(r.storedStatusContradicted))
  check("the cause is named as a deliberate skip", r.shortfallCause === "deliberate-skip", r.shortfallCause)
}

// ── a skip explains it too (0.1.9 behaviour must not regress) ───────────────
{
  const r = derive({ runSkippedFiles: 1, runUnchangedFiles: 0 })
  check("an oversize-file SKIP explains the shortfall", r.unexplainedShortfall === 0 && r.derivedStatus === "complete", `${r.unexplainedShortfall}/${r.derivedStatus}`)
}

// ── a mixed run is explained by both together ───────────────────────────────
{
  const r = derive({ recordedTotal: 2000, recordedIndexed: 1997, runSkippedFiles: 2, runUnchangedFiles: 1 })
  check("two skips plus one unchanged explain a 3-file gap", r.unexplainedShortfall === 0 && r.derivedStatus === "complete", `${r.unexplainedShortfall}/${r.derivedStatus}`)
}

// ── a REAL loss is still incomplete, and still contradicts ──────────────────
{
  const r = derive({ recordedTotal: 2000, recordedIndexed: 1995, runSkippedFiles: 0, runUnchangedFiles: 0 })
  check("an UNEXPLAINED shortfall is still incomplete", r.derivedStatus === "incomplete", r.derivedStatus)
  check("and the stored `complete` is contradicted", r.storedStatusContradicted === true, String(r.storedStatusContradicted))
  check("the cause is a write failure, not a skip", r.shortfallCause === "write-failure", r.shortfallCause)
}
{
  const r = derive({ recordedTotal: 2000, recordedIndexed: 1998, runSkippedFiles: 1, runUnchangedFiles: 0 })
  check("a PARTLY explained gap is mixed and still incomplete", r.derivedStatus === "incomplete" && r.explainedBySkips === 1, `${r.derivedStatus}/${r.explainedBySkips}`)
}

// ── no shortfall at all ─────────────────────────────────────────────────────
{
  const r = derive({ recordedTotal: 1973, recordedIndexed: 1973 })
  check("a fully covered index is complete with no complaint", r.derivedStatus === "complete" && r.unexplainedShortfall === 0 && r.storedStatusContradicted === false, `${r.derivedStatus}`)
}

// ── an absent record is declared, not assumed complete ─────────────────────
{
  const r = deriveIndexCompleteness({ recordPresent: false } as any)
  check("an unrecorded index is declared unrecorded", r.derivedStatus === "unrecorded", r.derivedStatus)
}

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "STATUS AGREEMENT: PASS" : `STATUS AGREEMENT: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
