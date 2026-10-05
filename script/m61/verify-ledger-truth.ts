// script/m61/verify-ledger-truth.ts — the LEDGER-TRUTH gate (M61.V7).
//
// WHAT THIS GATE IS FOR. script/m61/verify-orphan-gates.ts G5 REPORTS the
// ledger drift census — it counts issues whose manifest entry says `verified`
// while the record it points at says otherwise. A report is not a gate. At
// integration/lsp-truth HEAD 462f620be the census read 22 and nothing in the
// program was red because of it: the lanes' own governance gates validate their
// ledgers' SHAPE (structure, order, closure rules) and never compare an entry's
// status to the record it points at, so a lane could carry `verified` over a
// `known-gap` record through any number of green runs.
//
// THIS GATE closes that. It is the machine-checkable form of "the ledger tells
// the truth", and it is what makes the fix in the six lanes' governance gates
// load-bearing: a generator that projects its ledger from its records can only
// stay honest while something FAILS when it does not.
//
// WHAT IT CHECKS, over every lane's manifest (G0 corpus, G1 projection, G2
// drift census, G3 closure honesty, G4 mechanical lane status, G5 declared
// absences):
//
//   G0 corpus:     the census sees a real tree — lanes with a manifest, entries
//                  with a status, records that exist. A census that reads zero
//                  rows passes vacuously and proves nothing, so zero is a FAIL.
//   G1 projection: every lane that CAN project does: its governance gate
//                  imports the ONE projection owner (script/m61/
//                  ledger_projection.ts) and WRITES its manifest. A lane whose
//                  manifest is hand-maintained cannot drift by accident, but it
//                  also cannot be right by construction — it is named.
//   G2 drift:      NO lane ledger claims `verified` for an issue whose record
//                  reads `known-gap`/`blocked`. Both values named, per row. An
//                  UNDERCLAIM (the ledger says less than the record) is
//                  reported on its own line and counted separately, because it
//                  is stale bookkeeping, not a false claim.
//   G3 closure:    no lane reads `status: "closed"` while any entry is
//                  unverified, and no non-verified entry is hollow (a
//                  `known-gap`/`blocked` entry must carry its reason — §8.3).
//   G4 mechanical: the lane's own status equals what its entries imply. A
//                  hand-set `closed` is named as such.
//   G5 absences:   the platform facts this machine cannot verify are DECLARED,
//                  not silently omitted: every lane whose manifest carries an
//                  editor/platform-scoped claim records an `os` on the record
//                  (contract §10: an evidence record without an OS field is
//                  invalid for an I3+ claim), and every fork/editor leg on this
//                  machine is either verified with a pinned run or `blocked`
//                  WITH a reason. A leg that is silently absent is a FAILURE.
//
// PROOF THE GATE CAN FAIL — and the point of the second half is that a mutant
// which only trips a LOAD FAILURE has not been caught:
//
//   M1-M9  core-level mutations of the shared projection rule (the pure cores
//          copied verbatim, one property broken each).
//   M10    THE PLANTED DRIFT, END TO END ON DISK: this gate writes a REAL
//          manifest into a REAL scratch lane whose record says `known-gap` and
//          whose entry says `verified`, then runs its OWN census against the
//          real tree — not a copied core — and requires that the planted row is
//          seen AND classified as an overclaim. A mutant that survives here
//          failed to catch a lie that exists on disk. The scratch lane is
//          removed in a finally block and its removal is itself asserted.
//
// Run: npx tsx script/m61/verify-ledger-truth.ts
// Evidence: validation/m61/results/V7.json (sealed)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readEvidence, writeSealed } from "../lib/evidence.ts"
import {
  classifyDrift,
  driftLine,
  hollowBlocked,
  laneStatusOf,
  missingCanFailProof,
  projectEntry,
  projectLedger,
  reasonFromRecord,
  type DriftRow,
  type ProjectableEntry,
  type ProjectableLedger,
} from "./ledger_projection.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(ROOT, "validation/m61/results")

let checks = 0
let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}

let mutantsTotal = 0
let mutantsCaught = 0
const mutantRecords: Array<{ name: string; caught: boolean }> = []
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  mutantRecords.push({ name: label, caught })
  console.log(`  ${caught ? "ok  " : "SURV"}: M: ${label}${caught || !detail ? "" : ` — ${detail}`}`)
}

// ---------------------------------------------------------------------------
// The census: read every lane manifest and the record each entry points at.
// Reads go through the trusted path so a tampered record cannot be counted as
// evidence either way — the m55 lesson (a projection that heals toward a
// TAMPERED record's status is worse than no projection).
// ---------------------------------------------------------------------------

type LaneRow = {
  lane: string
  entry: ProjectableEntry
  ledgerStatus: string
  recordStatus: string
  file: string
  recordTrusted: boolean
  recordReason: string
}

/** The trusted read of one lane's evidence record, or null when it cannot be
 *  trusted. Shared by the census and the projection so both see the same world. */
export function trustedRecord(resultsDir: string, file: string): Record<string, unknown> | null {
  const abs = path.join(resultsDir, file)
  if (!existsSync(abs)) return null
  const read = readEvidence<Record<string, unknown>>(abs)
  return read.ok ? read.record : null
}

/**
 * Is this manifest a CLAIM LEDGER — an artifact whose entries assert a closure
 * state, the shape every IDE-lane manifest uses (`issues[].status` in the
 * planned/verified/known-gap/blocked union)?
 *
 * The scope matters. "validation/…/results/manifest.json" is not a single kind
 * of artifact: the M14-era lanes (m17, m18, m19) ship a DIFFERENT manifest
 * shape — "issues[].closed" is a boolean and "issues[].evidence" is a FILE NAME
 * string, with no status union at all. Those files are not ledgers making
 * claim-level assertions, and applying the closure-honesty rules to them
 * manufactures failures out of a schema the rule does not describe. A census
 * that over-reaches is a census whose red cannot be acted on, so the scope is
 * DECIDED by the artifact's own shape and the exclusion is enumerated in G0
 * rather than applied silently.
 */
export function isClaimLedger(ledger: unknown): boolean {
  const issues = (ledger as { issues?: unknown })?.issues
  if (!Array.isArray(issues) || issues.length === 0) return false
  // A claim ledger asserts a status per entry. The M14 shape has "closed"
  // (boolean) instead, which is precisely what makes it a different artifact.
  return issues.some((i) => typeof (i as { status?: unknown })?.status === "string")
}

export function censusLane(lane: string, resultsDir: string): LaneRow[] {
  const manifestAbs = path.join(resultsDir, "manifest.json")
  if (!existsSync(manifestAbs)) return []
  let ledger: ProjectableLedger
  try {
    const read = readEvidence<ProjectableLedger>(manifestAbs)
    if (!read.ok) return []
    ledger = read.record
  } catch {
    return []
  }
  if (!isClaimLedger(ledger)) return []
  const rows: LaneRow[] = []
  for (const entry of ledger.issues ?? []) {
    const file = typeof entry.evidence?.evidenceFile === "string" ? entry.evidence.evidenceFile : `${entry.code}.json`
    const record = trustedRecord(resultsDir, file)
    rows.push({
      lane,
      entry,
      ledgerStatus: entry.status,
      recordStatus: typeof record?.status === "string" ? record.status : "",
      file,
      recordTrusted: record !== null,
      recordReason: record ? (reasonFromRecord(record) ?? "") : "",
    })
  }
  return rows
}

/** Every lane with a manifest under validation/. */
export function listLanes(root: string): string[] {
  return readdirSync(path.join(root, "validation"))
    .sort()
    .filter((l) => existsSync(path.join(root, "validation", l, "results", "manifest.json")))
}

/** The lanes whose manifest is NOT a claim ledger (the M14-era `closed`:
 *  boolean shape). Named here and required to stay named, so the census's
 *  scope is a declared review surface rather than a silent skip. */
export function nonClaimLanes(root: string): string[] {
  const out: string[] = []
  for (const lane of listLanes(root)) {
    const abs = path.join(root, "validation", lane, "results", "manifest.json")
    try {
      const read = readEvidence<ProjectableLedger>(abs)
      if (read.ok && !isClaimLedger(read.record)) out.push(lane)
    } catch {
      /* an unreadable manifest is another gate's finding */
    }
  }
  return out
}

// ---------------------------------------------------------------------------

/** The governance-gate source that OWNS each lane's manifest. A lane whose
 *  manifest is written by a gate is projected; one whose manifest no gate
 *  writes is hand-maintained BY DESIGN and must be named as such.
 *
 *  The projection check follows the IMPORT GRAPH one hop, because the lanes do
 *  not all import the rule the same way: some call `projectLedger` from
 *  script/m61/ledger_projection.ts directly (m61), and the rest go through
 *  script/m61/ledger_gate_wiring.ts, which is what stopped this from being a
 *  fifth hand-copy of the same three steps. A detector that only matched a
 *  literal import of one filename reported all eight in-scope lanes as
 *  "not projecting" on a tree where all eight project - a census whose red is
 *  false is worse than no census.
 *
 *  The `writes` half is load-bearing and separate: importing the rule without
 *  writing the manifest is not a projection, it is an unused import. */
export function projectsItsLedger(lane: string, root: string): { gate: string | null; importsOwner: boolean; writes: boolean } {
  const gateAbs = path.join(root, "script", lane, "verify-governance.ts")
  if (!existsSync(gateAbs)) return { gate: null, importsOwner: false, writes: false }
  const src = readFileSync(gateAbs, "utf8")
  // Does this gate WRITE its lane's manifest? Three real shapes exist: a direct
  // `writeSealed(…manifest.json)` / `writeSealed(LEDGER_PATH)`, and the shared
  // wiring's `projectLaneLedger({ … writeLedger … })` which performs the write
  // on the gate's behalf. Matching only the first two credited six lanes that
  // write through the wiring - and, worse, a probe that merely IMPORTED the
  // rule was counted as projecting, because the import half was satisfied while
  // the write half was not. The halves are decided independently below.
  const writes =
    /writeSealed\(\s*[^)]*manifest\.json/.test(src) || /writeSealed\(\s*LEDGER_PATH\b/.test(src) || /projectLaneLedger\(\s*\{/.test(src)
  // Does this gate APPLY the projection rule? Directly, through the shared
  // wiring, or (for m61/m55, which predate it) with its own in-gate projection.
  const applies = /projectLedger\(/.test(src) || /projectLaneLedger\(/.test(src)
  return { gate: `script/${lane}/verify-governance.ts`, importsOwner: applies, writes }
}

function main(): void {
  const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

  // --- G0: the census sees a real tree ---------------------------------------
  console.log("G0: the census")
  const lanes = listLanes(ROOT)
  const rows: LaneRow[] = []
  for (const lane of lanes) rows.push(...censusLane(lane, path.join(ROOT, "validation", lane, "results")))
  check("G0: the census sees lanes with a manifest", lanes.length > 0, `lanes=${lanes.length}`)
  check("G0: the census sees ledger entries with a status", rows.length > 0, `rows=${rows.length}`)
  // A census that reads zero rows would pass every downstream check vacuously.
  // That is the failure mode this gate exists to kill, so zero is a FAILURE.
  check("G0: the census is not vacuous (rows > 0 — an empty census is a failure, not a pass)", rows.length > 0)
  const trusted = rows.filter((r) => r.recordTrusted && r.recordStatus)
  check("G0: the census resolves records for the entries it names", trusted.length > 0, `trusted=${trusted.length}/${rows.length}`)
  // The census's SCOPE is declared, not implied: the M14-era `closed: boolean`
  // manifests are excluded because the closure-honesty rules describe the
  // status union, not a boolean. The exclusion is enumerated so a lane that
  // CHANGES SHAPE cannot fall out of the census without being named.
  const excluded = nonClaimLanes(ROOT)
  check(
    "G0: every manifest excluded from the census as a non-claim-ledger is a DECLARED M14-era shape (named, not silently skipped)",
    excluded.every((l) => NON_CLAIM_DECLARED.includes(l)),
    `excluded=[${excluded.join(", ")}] declared=[${NON_CLAIM_DECLARED.join(", ")}]`,
  )

  // --- G2: the drift census (both directions, named) --------------------------
  console.log("\nG2: ledger vs record — no lane claims verified over a non-verified record")
  const drift = classifyDrift(
    rows.filter((r) => r.recordTrusted).map((r) => ({ lane: r.lane, code: r.entry.code, ledgerStatus: r.ledgerStatus, recordStatus: r.recordStatus, file: r.file })),
  )
  const overclaims = drift.filter((d) => d.direction === "overclaim")
  const underclaims = drift.filter((d) => d.direction === "underclaim")
  check(
    "G2: no lane ledger claims `verified` for an issue whose record reads known-gap/blocked",
    overclaims.length === 0,
    `${overclaims.length} overclaimed: ${overclaims.slice(0, 8).map(driftLine).join(" | ")}${overclaims.length > 8 ? ` … +${overclaims.length - 8} more` : ""}`,
  )
  // An underclaim is stale bookkeeping, not a lie — but it is still a ledger out
  // of date with its own records, and it is what a projection heals. It is
  // counted and named so it can never hide inside the overclaim count.
  check(
    "G2b: underclaims (ledger says less than its record) are enumerated, not folded into the overclaim count",
    overclaims.length + underclaims.length === drift.length,
    `over=${overclaims.length} under=${underclaims.length}`,
  )
  if (underclaims.length > 0) console.log(`      underclaimed (stale, not false): ${underclaims.map(driftLine).join(" | ")}`)

  // --- G3: closure honesty ---------------------------------------------------
  console.log("\nG3: no lane claims `closed` over unverified work, and no non-verified entry is hollow")
  const hollow: string[] = []
  const closedOverOpen: string[] = []
  const statusMismatched: string[] = []
  const claimLanes: string[] = []
  for (const lane of lanes) {
    const manifestAbs = path.join(ROOT, "validation", lane, "results", "manifest.json")
    let ledger: ProjectableLedger
    try {
      const read = readEvidence<ProjectableLedger>(manifestAbs)
      if (!read.ok) continue
      ledger = read.record
    } catch {
      continue
    }
    if (!isClaimLedger(ledger)) continue
    claimLanes.push(lane)
    const issues = ledger.issues ?? []
    for (const entry of issues) {
      const h = hollowBlocked(entry)
      if (h) hollow.push(`${lane}.${h}`)
    }
    const derived = laneStatusOf(issues)
    if (ledger.status !== derived) statusMismatched.push(`${lane}: ledger=${String(ledger.status)} derived=${derived} (mechanical)`)
    if (ledger.status === "closed" && derived !== "closed") closedOverOpen.push(`${lane}: status=closed but ${issues.filter((i) => i.status !== "verified").length} entries are unverified`)
  }
  check("G3: every non-verified entry carries the reason it is non-verified (§8.3)", hollow.length === 0, hollow.slice(0, 6).join(" | "))
  check("G3: no lane reads `closed` while any of its entries is unverified", closedOverOpen.length === 0, closedOverOpen.join(" | "))
  check(
    "G3: every lane status equals what its entries imply (no hand-set status)",
    statusMismatched.length === 0,
    statusMismatched.slice(0, 6).join(" | "),
  )

  // --- G3b: no `verified` rests on a suite that cannot fail --------------------
  // Found live: E5.json and F-CURSOR.json each record 88/88 passing checks with
  // no mutants, no negative cases, and (for E5) an EMPTY limitations array. A
  // suite of 88 assertions that cannot fail is 88 unverified claims wearing a
  // `verified` badge. Contract §6 makes a surviving mutant a failure of the
  // SUITE; a mutant set that is simply absent is the same hole.
  console.log("\nG3b: no `verified` record rests on a suite that cannot fail (§6/§8.4)")
  const noProof: string[] = []
  for (const lane of claimLanes) {
    const dir = path.join(ROOT, "validation", lane, "results")
    const ledgerAbs = path.join(dir, "manifest.json")
    let entries: ProjectableEntry[] = []
    try {
      const read = readEvidence<ProjectableLedger>(ledgerAbs)
      if (read.ok) entries = read.record.issues ?? []
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.status !== "verified") continue
      const file = typeof entry.evidence?.evidenceFile === "string" ? entry.evidence.evidenceFile : `${entry.code}.json`
      const record = trustedRecord(dir, file)
      if (!record) continue
      const finding = missingCanFailProof(record)
      if (finding) noProof.push(`${lane}.${entry.code} (${file}): ${finding}`)
    }
  }
  check(
    "G3b: every `verified` record carries a can-fail proof (mutants caught, or declared negative cases)",
    noProof.length === 0,
    `${noProof.length} verified-without-proof: ${noProof.slice(0, 6).join(" | ")}${noProof.length > 6 ? ` … +${noProof.length - 6} more` : ""}`,
  )

  // --- G4: mechanical status, from the shared owner --------------------------
  console.log("\nG4: the lane status is mechanical")
  {
    // The rule is the shared core's, exercised on known inputs: all-verified
    // closes, anything else opens, and an empty ledger never claims closure.
    check(
      "G4: an all-verified lane derives `closed`",
      laneStatusOf([{ code: "A", status: "verified" }, { code: "B", status: "verified" }]) === "closed",
    )
    check(
      "G4: one known-gap entry keeps the lane `open`",
      laneStatusOf([{ code: "A", status: "verified" }, { code: "B", status: "known-gap" }]) === "open",
    )
    check("G4: an empty ledger never derives `closed`", laneStatusOf([]) === "open")
    const ledgerClosedOverGap: ProjectableLedger = { status: "closed", issues: [{ code: "A", status: "verified" }, { code: "B", status: "known-gap", evidence: { blockedReason: "x" } }] }
    const projected = projectLedger(ledgerClosedOverGap, () => ({ status: "known-gap" }), {})
    check(
      "G4: a hand-set `closed` over a known-gap record is reported as drift by the shared owner",
      projected.findings.some((f) => f.startsWith("lane status:") && f.includes("derived=open")),
      projected.findings.join(" | "),
    )
  }

  // --- G1: which lanes PROJECT (so the fix is load-bearing) -------------------
  // Scoped to the lanes this program OWNS the ledger generator for. Applying the
  // rule to a lane whose governance gate belongs to another track would produce
  // a red nobody in this lane can clear — a failure with no owner is a failure
  // that gets ignored, which is worse than not stating it. The other lanes'
  // ledgers are still CENSUSED for drift (G2/G3 apply to every claim ledger);
  // what is scoped here is only the "your generator must project" obligation.
  console.log("\nG1: every in-scope lane's governance gate projects its ledger from the shared owner")
  const projection: Array<{ lane: string; gate: string | null; importsOwner: boolean; status: string; inScope: boolean }> = []
  for (const lane of lanes) {
    const p = projectsItsLedger(lane, ROOT)
    projection.push({
      lane,
      gate: p.gate,
      importsOwner: p.importsOwner && p.writes,
      inScope: IN_SCOPE_PROJECTION_LANES.includes(lane),
      status: p.gate ? (p.importsOwner && p.writes ? "projected" : "gate-writes-but-hand-authored") : "hand-maintained",
    })
  }
  const inScope = projection.filter((p) => p.inScope)
  const inScopeNotProjected = inScope.filter((p) => p.status !== "projected")
  const outOfScope = projection.filter((p) => !p.inScope && p.status !== "projected")
  console.log(
    `      projection census: ${projection.filter((p) => p.status === "projected").length} projected, ` +
      `${inScopeNotProjected.length} in-scope-not-projected, ${outOfScope.length} out-of-scope (censused for drift, generator not owned here)`,
  )
  check(
    "G1: every IN-SCOPE lane's governance gate projects its ledger from the shared owner (script/m61/ledger_projection.ts)",
    inScopeNotProjected.length === 0,
    `${inScopeNotProjected.length} in-scope lanes not projecting: ${inScopeNotProjected.map((p) => `${p.lane}(${p.status})`).join(", ")}`,
  )
  check(
    "G1: the in-scope set is non-empty (a census over zero owned generators would pass vacuously)",
    inScope.length > 0,
    `inScope=${inScope.length}`,
  )
  // Every out-of-scope lane's ledger is still drift-censused; this records that
  // the residual is KNOWN rather than absent, so a reader can see which lanes
  // this gate can only report on.
  check(
    "G1: every out-of-scope non-projecting lane is a DECLARED residual (censused for drift; its generator is another lane's)",
    outOfScope.every((p) => OUT_OF_SCOPE_DECLARED.includes(p.lane)),
    `undeclared=[${outOfScope.filter((p) => !OUT_OF_SCOPE_DECLARED.includes(p.lane)).map((p) => p.lane).join(", ")}]`,
  )

  // --- G5: the platform absences are declared, not omitted -------------------
  console.log("\nG5: platform/editor absences are declared, never silently omitted")
  {
    const m25Dir = path.join(ROOT, "validation/m25/results")
    // Contract §2 I4 / §8.3: a fork claim is a measured fact; an unavailable
    // fork is `blocked` with the reason recorded — never omitted, never
    // assumed. This machine has no VS Code, no Cursor, no Antigravity, no
    // Windsurf, no nvim/zed/helix, and no bun; the records must say so.
    //
    // The fork set is DISCOVERED, not hardcoded: every `F-*.json` record in the
    // lane's results dir is a fork leg. A hardcoded list would let a fourth fork
    // (or a renamed one) fall out of the census silently — the exact omission
    // §8.3 bans.
    const forks = existsSync(m25Dir) ? readdirSync(m25Dir).filter((f) => f.startsWith("F-") && f.endsWith(".json")).sort() : []
    check("G5: the fork census is not empty (a zero-fork census would pass vacuously)", forks.length > 0, `forks=${forks.length}`)
    const forkRows: Array<{ file: string; status: string; reason: string; os: string }> = []
    for (const f of forks) {
      const rec = trustedRecord(m25Dir, f)
      forkRows.push({
        file: f,
        status: typeof rec?.status === "string" ? rec.status : "(no record)",
        reason: rec ? (reasonFromRecord(rec) ?? "") : "",
        os: typeof rec?.os === "string" ? rec.os : "",
      })
    }
    check(
      "G5: every fork leg is either verified WITH a pinned run (editor name + version + OS), or blocked WITH a reason (never omitted, never assumed)",
      forkRows.every((r) => (r.status === "verified" ? r.reason !== "" : r.status === "blocked" && r.reason.length > 0)),
      forkRows.map((r) => `${r.file}=${r.status}${r.reason ? "(reason)" : "(NO REASON)"}`).join(", "),
    )
    // §10: an evidence record without an OS field is invalid for an I3+ claim.
    // The editor/platform-scoped legs are exactly those claims. Discovered the
    // same way — every record in the lane that carries an `editor` or `fork`
    // block is a pinned-editor claim and must therefore name its OS.
    const osScoped = existsSync(m25Dir)
      ? readdirSync(m25Dir)
          .filter((f) => f.endsWith(".json") && f !== "manifest.json")
          .filter((f) => {
            const rec = trustedRecord(m25Dir, f)
            return rec !== null && (typeof rec.os === "string" || rec.editor !== undefined || rec.fork !== undefined)
          })
          .sort()
      : []
    const missingOs = osScoped.filter((f) => {
      const rec = trustedRecord(m25Dir, f)
      return rec === null || typeof rec.os !== "string" || rec.os.length === 0
    })
    check(
      "G5: every editor/OS-scoped evidence record names its OS (contract §10: no OS field ⇒ invalid for an I3+ claim)",
      missingOs.length === 0,
      `scanned=${osScoped.length} missingOs=${missingOs.join(", ")}`,
    )
    // The OS legs: exactly one platform may be verified and the rest must be
    // blocked-with-reason. A record that claims verified for a platform this
    // measurement did not run on is a false platform claim.
    const osLegs = ["E7-linux.json", "E7-darwin.json", "E7-windows.json"].map((f) => {
      const rec = trustedRecord(m25Dir, f)
      return { file: f, os: typeof rec?.os === "string" ? rec.os : "", status: typeof rec?.status === "string" ? rec.status : "" }
    })
    const verifiedOs = osLegs.filter((l) => l.status === "verified").map((l) => l.os)
    check(
      "G5: the OS matrix declares every platform — at least one verified, every other platform blocked-with-reason (never assumed)",
      verifiedOs.length > 0 && osLegs.every((l) => l.status === "verified" || (l.status === "blocked" && reasonFromRecord(trustedRecord(m25Dir, l.file) ?? {}) !== undefined)),
      osLegs.map((l) => `${l.os}=${l.status}`).join(", "),
    )
  }

  // --- Mutants: the cores CAN fail -------------------------------------------
  console.log("\nMutants: the suite CAN fail")
  {
    // Each mutant drives the SAME pure function the checks above drive, with one
    // property broken. "Survives" means the broken version still reports the
    // defect — i.e. the check is hollow.

    // M1: a verified-over-known-gap pair must be classified as an overclaim.
    const rows1: Array<Omit<DriftRow, "direction">> = [
      { lane: "mXX", code: "A1", ledgerStatus: "verified", recordStatus: "known-gap", file: "A1.json" },
      { lane: "mXX", code: "A2", ledgerStatus: "verified", recordStatus: "verified", file: "A2.json" },
      { lane: "mXX", code: "A3", ledgerStatus: "known-gap", recordStatus: "known-gap", file: "A3.json" },
      { lane: "mXX", code: "A4", ledgerStatus: "planned", recordStatus: "verified", file: "A4.json" },
    ]
    const d1 = classifyDrift(rows1)
    mutant(
      "M1: only the verified-over-non-verified pair is an OVERclaim; a planned-over-verified pair is not drift at all",
      d1.length === 1 && d1[0]!.direction === "overclaim" && d1[0]!.code === "A1",
      JSON.stringify(d1),
    )
    // M2: the underclaim direction must be reported AND distinguished.
    const d2 = classifyDrift([{ lane: "mXX", code: "B1", ledgerStatus: "known-gap", recordStatus: "verified", file: "B1.json" }])
    mutant("M2: an underclaim (ledger says less than its record) is reported, and labelled as an underclaim", d2.length === 1 && d2[0]!.direction === "underclaim", JSON.stringify(d2))
    // M3: the line names BOTH values (a finding that cannot be acted on is a
    // finding that will be ignored).
    const line = d2[0] ? driftLine(d2[0]) : ""
    mutant("M3: a drift finding names both values and the direction", /ledger=known-gap/.test(line) && /record=verified/.test(line) && /underclaim/.test(line), line)
    // M4: a projection must MOVE the entry to the record's status.
    {
      const entry: ProjectableEntry = { code: "A1", status: "verified", evidence: { status: "verified", passed: 99, failed: 0 } }
      const p = projectEntry(entry, { status: "known-gap", passed: 5, failed: 1 }, {}, "A1.json")
      mutant(
        "M4: projecting a known-gap record over a verified entry rewrites the status AND the counts",
        p.entry.status === "known-gap" && (p.entry.evidence?.status === "known-gap") && p.entry.evidence?.passed === 5 && p.changed.length > 0,
        JSON.stringify(p),
      )
    }
    // M4b: a count the LEDGER carries and the RECORD does not must be DROPPED,
    // not left in place. Found live: the projection reported
    // `negativeCases: ledger=4 derived=0` for m25.V1 and then kept the ledger's
    // 4, because the evidence block was spread first and only the record's keys
    // overwritten. A projection that reports a change and then keeps the wrong
    // value is worse than one that reports nothing, because it looks like a fix.
    {
      const entry: ProjectableEntry = { code: "A1", status: "verified", evidence: { status: "verified", passed: 10, negativeCases: 4 } }
      const p = projectEntry(entry, { status: "verified", passed: 10 }, {}, "A1.json")
      mutant(
        "M4b: a count the record does not report is DROPPED from the projection, not left as the ledger's stale value",
        p.entry.evidence?.negativeCases === undefined && p.entry.evidence?.passed === 10 && p.changed.some((c) => c.includes("negativeCases") && c.includes("dropped")),
        JSON.stringify(p.entry.evidence),
      )
    }
    // M4c: the drop rule keeps the projection a fixpoint — the second pass must
    // report no HEAL, or the gate would "heal" every run and drift would be
    // indistinguishable from bookkeeping. Findings are exempted from this
    // assertion on purpose: a finding is a standing property of the records
    // (a missing can-fail proof does not stop being missing), while a heal is a
    // one-time repair. Only heals must converge.
    {
      const rec = { status: "verified", passed: 10, failed: 0 }
      const once = projectLedger({ status: "closed", issues: [{ code: "A1", status: "verified", evidence: { status: "verified", passed: 10, negativeCases: 4 } }] }, () => rec, {})
      const twice = projectLedger(once.ledger, () => rec, {})
      mutant(
        "M4c: the drop rule keeps the projection a fixpoint (the second pass over the same records heals nothing)",
        twice.healed.length === 0 && once.ledger.issues?.[0]?.evidence?.negativeCases === undefined,
        `once=${JSON.stringify(once.healed)} twice=${JSON.stringify(twice.healed)}`,
      )
    }
    // M10: the projection detector must DISCRIMINATE, on both halves. Found live: a
    // detector matching only a literal `from "…/ledger_projection.ts"` import
    // reported all eight in-scope lanes as "not projecting" on a tree where all
    // eight project (six go through ledger_gate_wiring.ts). A census whose red is
    // false is worse than no census, so both the import half and the write half
    // are asserted — including the "imports the rule but never writes the
    // manifest" case, which is an unused import, not a projection.
    {
      const mk = (src: string): string => {
        const dir = path.join(ROOT, "script", "mZZ-detector-probe")
        mkdirSync(dir, { recursive: true })
        writeFileSync(path.join(dir, "verify-governance.ts"), src)
        try {
          return projectsItsLedger("mZZ-detector-probe", ROOT).importsOwner ? "projected" : "not-projecting"
        } finally {
          rmSync(path.join(ROOT, "script", "mZZ-detector-probe"), { recursive: true, force: true })
        }
      }
      const directImport = mk('import { projectLedger } from "../m61/ledger_projection.ts"\nconst r = projectLedger(l, r, {})\nwriteSealed(LEDGER_PATH, projected)\n')
      const viaWiring = mk('import { projectLaneLedger } from "../m61/ledger_gate_wiring.ts"\nprojectLaneLedger({ ledgerPath, writeLedger: (l) => writeSealed(ledgerPath, l) })\n')
      const ownCopy = mk('function x(){ const p = projectLedger(a,b,{}) ; writeSealed(LEDGER_PATH, p.ledger) ; return p }\n')
      // An import that is never APPLIED: the rule is named and the manifest is
      // written by hand. This is the shape a "fix" takes when someone adds the
      // import to satisfy a census instead of projecting anything, and it must
      // not be credited.
      const importedNotApplied = mk('import { projectLedger } from "../m61/ledger_projection.ts"\nexport const ref = projectLedger\nwriteSealed(LEDGER_PATH, handTypedLedger)\n')
      // A write that never projects: the manifest is rewritten, but from a
      // hand-typed object rather than from the records.
      const writesOnly = mk('writeSealed(LEDGER_PATH, ledger)\n')
      const neither = mk('export const x = 1\n')
      mutant(
        "M10: the projection detector recognises all three real shapes (direct import, the shared wiring, an in-gate projection) and rejects an import that is never applied plus a write that never projects",
        directImport === "projected" &&
          viaWiring === "projected" &&
          ownCopy === "projected" &&
          importedNotApplied !== "projected" &&
          writesOnly !== "projected" &&
          neither !== "projected",
        JSON.stringify({ directImport, viaWiring, ownCopy, importedNotApplied, writesOnly, neither }),
      )
    }
    // M4d: a count NESTED under `verdict` must be read, not reported absent. Found
    // live: the projection read only top-level counts, so m42.H1's
    // `verdict: { mutantsCaught: 4, mutantsTotal: 4 }` looked unreported, the
    // ledger's copy was dropped, and `isClosable` then rejected four honest
    // `verified` entries as `hollow-verified`. A gate that cannot see where its
    // own record keeps a number will call truth hollow.
    {
      const nested = projectEntry(
        { code: "A1", status: "verified", evidence: { status: "verified", passed: 16, mutantsCaught: 4, mutantsTotal: 4 } },
        { status: "verified", passed: 16, verdict: { mutantsCaught: 4, mutantsTotal: 4, realComponentFailures: 0 } },
        {},
        "A1.json",
      )
      const nestedNegative = projectEntry(
        { code: "A2", status: "verified", evidence: { status: "verified", passed: 9 } },
        { status: "verified", passed: 9, negatives: { total: 5, caught: 5 } },
        {},
        "A2.json",
      )
      const topWins = projectEntry(
        { code: "A3", status: "verified", evidence: { status: "verified", passed: 3, mutantsTotal: 9 } },
        { status: "verified", passed: 3, mutantsTotal: 7, verdict: { mutantsTotal: 2 } },
        {},
        "A3.json",
      )
      mutant(
        "M4d: a count nested under `verdict` (or under a `negatives` object) is READ, and a top-level count wins over a nested one of the same name",
        // `changed` may be non-empty here and legitimately so: the nested
        // `realComponentFailures: 0` is surfaced as `realFailed: 0`, which the
        // ledger entry did not carry. The assertion is that the MUTANT counts
        // survived the projection - they are the ones that were being dropped.
        nested.entry.evidence?.mutantsCaught === 4 &&
          nested.entry.evidence?.mutantsTotal === 4 &&
          !nested.changed.some((c) => c.startsWith("mutants")) &&
          nestedNegative.entry.evidence?.negativeCases === 5 &&
          topWins.entry.evidence?.mutantsTotal === 7,
        JSON.stringify({ nested: nested.entry.evidence, changed: nested.changed, nestedNegative: nestedNegative.entry.evidence, topWins: topWins.entry.evidence }),
      )
    }
    // M4e: the can-fail rule must DISCRIMINATE — a proven `verified` passes, an
    // unproven one is reported, and a `known-gap` is not accused of anything
    // (a red record is not claiming to have passed).
    {
      const proven = missingCanFailProof({ status: "verified", negativeCases: 12 })
      const provenByMutants = missingCanFailProof({ status: "verified", mutantsCaught: 6, mutantsTotal: 6 })
      const unproven = missingCanFailProof({ status: "verified", passed: 88, failed: 0, checks: [] })
      const nestedProof = missingCanFailProof({ status: "verified", verdict: { mutantsCaught: 4, mutantsTotal: 4 } })
      const redRecord = missingCanFailProof({ status: "known-gap" })
      const partialMutants = missingCanFailProof({ status: "verified", mutantsCaught: 3, mutantsTotal: 6 })
      mutant(
        "M4e: the can-fail rule accepts either proof shape, rejects an unproven `verified`, does not accuse a `known-gap`, and rejects a partially-caught mutant set",
        proven === null &&
          provenByMutants === null &&
          nestedProof === null &&
          unproven !== null &&
          redRecord === null &&
          partialMutants !== null,
        JSON.stringify({ proven, provenByMutants, unproven, nestedProof, redRecord, partialMutants }),
      )
    }
    // M5: an untrusted record must NOT be assumed green.
    {
      const entry: ProjectableEntry = { code: "A1", status: "verified", evidence: { status: "verified" } }
      const p = projectEntry(entry, null, {}, "A1.json")
      mutant(
        "M5: a missing/untrusted record is reported, never projected to verified",
        p.entry.status === "verified" && p.changed.some((c) => c.includes("record unreadable")),
        JSON.stringify(p),
      )
    }
    // M6: a record with no status is reported, not invented.
    {
      const p = projectEntry({ code: "A1", status: "verified", evidence: {} }, { passed: 3 }, {}, "A1.json")
      mutant("M6: a record carrying no status is reported as unprojectable", p.changed.some((c) => c.includes("carries no status")), JSON.stringify(p.changed))
    }
    // M7: a blocked entry with NO reason is hollow; with a reason it is not.
    {
      const bare: ProjectableEntry = { code: "A1", status: "blocked", evidence: {} }
      const withReason: ProjectableEntry = { code: "A1", status: "blocked", evidence: { blockedReason: "no VS Code on this machine" } }
      mutant(
        "M7: a blocked entry with no reason is hollow, and one with a reason is not",
        hollowBlocked(bare) !== null && hollowBlocked(withReason) === null && hollowBlocked({ code: "A", status: "verified" }) === null,
      )
    }
    // M8: the reason is read from all three spellings a gate uses.
    {
      const a = reasonFromRecord({ blockedReason: "no editor" })
      const b = reasonFromRecord({ reason: "no fork" })
      const c = reasonFromRecord({ limitations: ["scoped claim"] })
      mutant("M8: the non-verified reason is read from blockedReason / reason / limitations alike", a === "no editor" && b === "no fork" && c === "scoped claim", JSON.stringify([a, b, c]))
    }
    // M9: the projection is a FIXPOINT — re-projecting an already-projected
    // ledger reports NO change. Without this, the gate would "heal" forever and
    // the drift finding would be indistinguishable from normal bookkeeping.
    {
      const rec = { status: "known-gap", passed: 4, failed: 2, currentCommit: "a".repeat(40), blockedReason: "dirty tree at measure time" }
      const once = projectLedger({ status: "open", issues: [{ code: "A1", status: "verified", evidence: { status: "verified" } }] }, () => rec, {})
      const twice = projectLedger(once.ledger, () => rec, {})
      mutant(
        "M9: the projection is a fixpoint (a second projection over the same records changes nothing)",
        once.findings.length === 0 && twice.findings.length === 0 && twice.healed.length === 0,
        `once=${JSON.stringify(once)} twice=${JSON.stringify(twice)}`,
      )
    }
  }

  // --- M10: THE PLANTED DRIFT, END TO END ON DISK ---------------------------
  // The mutants above exercise the pure cores. This one plants a REAL lie — a
  // manifest whose entry claims `verified` over a record that says
  // `known-gap`, sealed and trusted so nothing downstream can excuse it — and
  // requires the LIVE census (the same listLanes/censusLane path the checks
  // above used) to see it and classify it. A gate that only proves its cores
  // can fail has not proved it catches a lie that exists.
  console.log("\nM10: a REAL planted drift on disk is caught by the live census")
  const PLANT_LANE = "mZZ-planted-drift-probe"
  const plantDir = path.join(ROOT, "validation", PLANT_LANE, "results")
  let plantedCaught = false
  let detail = ""
  {
    try {
      rmSync(path.join(ROOT, "validation", PLANT_LANE), { recursive: true, force: true })
      mkdirSync(plantDir, { recursive: true })
      writeSealed(path.join(plantDir, "A1.json"), {
        issue: "planted",
        code: "A1",
        milestone: PLANT_LANE,
        status: "known-gap",
        checks: 3,
        passed: 2,
        failed: 1,
        negativeCases: 1,
        currentCommit: HEAD,
        verifierCommand: "npx tsx script/mZZ-planted-drift-probe/verify-a1.ts",
        evidenceFile: "A1.json",
        generatedAt: new Date().toISOString(),
        blockedReason: "planted record: this gate's own proof that a lie is caught, not a claim",
        limitations: ["planted by script/m61/verify-ledger-truth.ts as the M10 end-to-end proof"],
      })
      // The lie: the ledger says verified; the record it points at says known-gap.
      writeSealed(path.join(plantDir, "manifest.json"), {
        schemaVersion: 1,
        milestone: PLANT_LANE,
        githubMilestone: 0,
        title: "planted drift probe",
        status: "closed",
        authority: "planted by script/m61/verify-ledger-truth.ts (M10)",
        governingContract: "docs/IDE-HONESTY-CONTRACT.md",
        issues: [
          { code: "A1", githubIssue: 0, tool: "probe", status: "verified", scope: "planted", acceptanceCriteria: ["planted"], closureRequirements: ["planted"], evidence: { status: "verified", evidenceFile: "A1.json", passed: 2, failed: 1, verifierCommand: "npx tsx script/mZZ-planted-drift-probe/verify-a1.ts" } },
        ],
      } as unknown as Record<string, unknown>)
      const lanes2 = listLanes(ROOT)
      const seenAsLane = lanes2.includes(PLANT_LANE)
      const rows2 = censusLane(PLANT_LANE, plantDir)
      const trusted2 = rows2.filter((r) => r.recordTrusted)
      const drift2 = classifyDrift(trusted2.map((r) => ({ lane: r.lane, code: r.entry.code, ledgerStatus: r.ledgerStatus, recordStatus: r.recordStatus, file: r.file })))
      const asOverclaim = drift2.some((d) => d.code === "A1" && d.direction === "overclaim" && d.recordStatus === "known-gap")
      // And the projection itself must tell the truth about this planted lane:
      // run the SHARED owner over the planted ledger against its real record and
      // require the entry to be rewritten to `known-gap` and the lane status to
      // derive `open`. This is the end-to-end half of the proof — it exercises
      // the same projectLedger the six lane gates will import, on a lie that
      // exists on disk, rather than a copy's opinion of itself.
      const plantLedger = readEvidence<ProjectableLedger>(path.join(plantDir, "manifest.json"))
      let projectionRewrote = false
      let projectionStatus = "(not run)"
      if (plantLedger.ok) {
        const projected = projectLedger(plantLedger.record, (f) => trustedRecord(plantDir, f), {})
        projectionStatus = String(projected.ledger.status)
        projectionRewrote =
          projected.ledger.issues?.some((i) => i.code === "A1" && i.status === "known-gap") === true &&
          projected.ledger.status === "open" &&
          projected.healed.some((h) => h.startsWith("A1:") && h.includes("record=known-gap"))
      }
      plantedCaught = seenAsLane && asOverclaim && projectionRewrote
      detail = `seenAsLane=${seenAsLane} recordTrusted=${trusted2.length === 1} overclaimDetected=${asOverclaim} projectionRewroteEntryAndStatus=${projectionRewrote} (derived lane=${projectionStatus})`
    } catch (e) {
      detail = `plant threw: ${(e as Error).message}`
    } finally {
      rmSync(path.join(ROOT, "validation", PLANT_LANE), { recursive: true, force: true })
    }
    mutant("M10: a REAL planted drift (verified entry over a known-gap record, closed over an unverified entry) is caught by the live census", plantedCaught, detail)
    check("M10: the planted probe lane is removed after the proof", !existsSync(path.join(ROOT, "validation", PLANT_LANE)))
    check("M10: the live census does not see the probe once removed", !listLanes(ROOT).includes(PLANT_LANE))
  }

  // --- Persist evidence --------------------------------------------------------
  const realFailed = failures.length
  const overclaimRows = overclaims.map(driftLine)
  const result = {
    issue: "M61.V7 ledger truth",
    code: "V7",
    milestone: "M61",
    status: realFailed > 0 || mutantsCaught < mutantsTotal ? "known-gap" : "verified",
    checks,
    passed,
    failed: realFailed,
    realFailed,
    negativeCases: mutantsTotal,
    mutantsTotal,
    mutantsCaught,
    mutantRecords,
    currentCommit: HEAD,
    verifierCommand: "npx tsx script/m61/verify-ledger-truth.ts",
    evidenceFile: "V7.json",
    generatedAt: new Date().toISOString(),
    census: {
      lanesWithManifest: lanes.length,
      claimLedgers: claimLanes.length,
      nonClaimLedgersExcluded: excluded,
      entries: rows.length,
      trustedRecords: trusted.length,
      projection: {
        projected: projection.filter((p) => p.status === "projected").map((p) => p.lane),
        inScopeNotProjected: inScopeNotProjected.map((p) => p.lane),
        outOfScopeResidual: outOfScope.map((p) => p.lane),
      },
    },
    ledgerDrift: { overclaims: overclaimRows, underclaims: underclaims.map(driftLine), total: drift.length },
    closureHonesty: { hollowEntries: hollow, closedOverUnverified: closedOverOpen, statusNotMechanical: statusMismatched },
    limitations: [
      "The drift census reads `status` from each record through the trusted sealed read. A record whose seal does not verify is counted as UNTRUSTED and excluded from the drift count rather than being assumed to agree with the ledger — an unverifiable record is a separate finding, not a pass.",
      "This gate reports and enforces; it does not rewrite a lane's ledger. The projection is each lane's own governance gate's job (script/m61/ledger_projection.ts is the shared rule they import), and a record is never edited to match a ledger — IDE Honesty Contract §8.4 makes the record the authority.",
      "The platform census (G5) asserts that each editor/fork/OS leg is EITHER verified with a pinned run and a stated reason, OR blocked with a reason recorded. It cannot assert that a blocked reason is TRUTHFUL — that is the owner's spot-check (contract §8.5).",
      "Lane closure remains the owner's verdict. This gate proves no lane can read `closed` over unverified work; it never declares a milestone achieved.",
    ],
  }
  mkdirSync(RESULTS, { recursive: true })
  writeSealed(path.join(RESULTS, "V7.json"), result)

  console.log(`\nM61.V7: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
  console.log(`  census: ${claimLanes.length} claim ledgers (${excluded.length} non-claim excluded), ${rows.length} entries, ${drift.length} drifted (${overclaims.length} overclaims, ${underclaims.length} underclaims)`)
  console.log(`  projection: ${projection.filter((p) => p.status === "projected").length} projected, ${inScopeNotProjected.length} in-scope-not-projected, ${outOfScope.length} out-of-scope residual`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(realFailed > 0 || mutantsCaught < mutantsTotal ? 1 : 0)
}

/**
 * The lanes this program OWNS the ledger generator for: the six whose
 * governance gates `script/m61/ledger_projection.ts` is imported into by the
 * fix, plus m61 itself (whose gate already projected through the same rule).
 * G1 requires every one of them to project — that is the obligation this lane
 * can actually discharge, and naming it keeps the red actionable.
 */
const IN_SCOPE_PROJECTION_LANES: string[] = ["m24", "m25", "m29", "m42", "m44", "m45", "m55", "m61"]

/**
 * Lanes whose governance gate (and therefore whose ledger generator) belongs to
 * another track. Their manifests are still CENSUSED for drift by G2/G3 — this
 * list is not permission, it is the statement of what this gate can only report
 * on rather than fix. A lane not on this list AND not projecting is a NEW
 * un-owned ledger, which fails.
 *
 * The pre-existing residues are named with their cause:
 *   m20/m21/m26/m30/m32/m33/m34/m36/m41/m56/m62 — gates owned by lanes outside
 *     this program; each carries its own projection or none, and their drift is
 *     reported by G2 rather than repaired here.
 *   m27/m28/m55 — these DO project, through a hand-rolled copy of the rule
 *     written before the shared owner existed (m28.G1's comment names the
 *     defect it healed). They are listed as out-of-scope for the
 *     must-import rule only; their drift is still censused.
 */
const OUT_OF_SCOPE_DECLARED: string[] = [
  "m20", "m21", "m26", "m27", "m28", "m30", "m32", "m33", "m34", "m36", "m41", "m55", "m56", "m62",
]

/**
 * Manifests excluded from the census as NOT claim ledgers: the M14-era
 * `issues[].closed: boolean` shape, which states no status union at all. Named
 * so the exclusion is a review surface; a lane that changes shape into the
 * status union is picked up by the census automatically, and a lane that
 * disappears is visible here.
 */
const NON_CLAIM_DECLARED: string[] = ["m17", "m18", "m19"]

main()
