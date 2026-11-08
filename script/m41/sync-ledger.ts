// script/m41/sync-ledger.ts — evidence-batch helper (mechanical, derived).
//
// Copies each verified issue's evidence-file facts (commit, pass/fail counts,
// negative cases, generation time) into the ledger's nested evidence block.
// Nothing here is authored by hand: the numbers come from the artifacts, and
// G1 then rejects a ledger that disagrees with them.
//
// Only keys the ledger ENTRY already declares are written — the file's values
// replace the entry's values, and the entry's shape is left alone. That keeps
// milestone-specific fields (mutantsCaught, realFailed, checks) intact instead
// of flattening every milestone into one schema.
//
// Usage:
//   npx tsx script/m41/sync-ledger.ts                 # M41 (default)
//   npx tsx script/m41/sync-ledger.ts --milestone m45 # any milestone with a ledger
//   npx tsx script/m41/sync-ledger.ts --check         # report drift, write nothing
//   npx tsx script/m41/sync-ledger.ts --milestone m56 --drop-unreachable-citations
//       # withdraw the evidence of entries whose cited commit this history no
//       # longer resolves, so the next batch re-earns them (see the note below)
//
// WHY --drop-unreachable-citations EXISTS. An artifact's commit is a claim about
// a tree that must still exist. A rewrite (squash-merge, restored superseded
// artifact, branch replan) can leave that commit unreachable, and then the
// ledger names a run nobody can inspect — and the governance gate, correctly,
// fails on it. The ledger has NO vocabulary for "the run happened, at a commit
// this history does not have": validateLedger accepts planned / verified /
// known-gap / blocked, and any non-planned entry must describe a PASSING
// artifact (failed === 0). So the two honest options were to re-point the
// citation at a commit the run never happened at, or to hand-edit validation/.
// Neither is acceptable, and the deadlock is self-referential: the governance
// gate cannot re-earn its own artifact while its own citation is the thing that
// is broken. This flag takes the third option — it WITHDRAWS the entry's
// evidence (status planned, evidence removed) and says so loudly, leaving the
// entry to be re-earned by re-running its verifier at HEAD, which is what the
// batch procedure above already prescribes.
//
// The batch procedure it completes:
//   1. run every M41 verifier at ONE HEAD (no commits in between)
//   2. npx tsx script/m41/sync-ledger.ts
//   3. npx tsx script/m41/verify-governance.ts  → green
//   4. commit the evidence + ledger, then STOP re-running gates
// Step 4 matters: re-running a single verifier afterwards moves that artifact
// past the ledger and G1 goes red again — which is the honest signal that the
// batch is no longer a batch (the M45 closure lesson).
//
// Run: npx tsx script/m41/sync-ledger.ts

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { writeSealed } from "../lib/evidence.ts"
import { reRecordRegisterRow } from "../m61/seal_register.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

const args = process.argv.slice(2)
const MILESTONE = args.includes("--milestone") ? (args[args.indexOf("--milestone") + 1] ?? "m41") : "m41"
const CHECK_ONLY = args.includes("--check")
const DROP_UNREACHABLE = args.includes("--drop-unreachable-citations")

/** Object present at all? (`git cat-file` — a sha that is merely well-formed is not evidence.) */
function commitExists(sha: string): boolean {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return false
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] })
    return true
  } catch {
    return false
  }
}

/** Ancestry from HEAD, or reachable from a preserved ref — the same two arms the
 *  governance gate uses, so this helper cannot disagree with the thing it exists
 *  to satisfy. */
function commitReachable(sha: string): boolean {
  if (!commitExists(sha)) return false
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] })
    return true
  } catch { /* fall through: the rewrite severed ancestry, not the object */ }
  try {
    const out = execFileSync("git", ["for-each-ref", "--contains", sha, "--format=%(refname)"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return out.trim().length > 0
  } catch {
    return false
  }
}
const RESULTS = path.join(ROOT, "validation", MILESTONE, "results")
const MANIFEST_PATH = path.join(RESULTS, "manifest.json")

// Facts a verifier writes that a ledger entry may record. Value-only: a key
// absent from the ledger entry is left absent (G1 validates the entry's shape).
const SYNCED_KEYS = ["currentCommit", "generatedAt", "passed", "failed", "realFailed", "negativeCases", "checks", "mutantsCaught", "mutantsTotal", "ownerApproval"] as const

// Synced for information, but NOT part of the agreement contract — the gate
// compares commit + counts only, because it rewrites its own artifact in the
// run that validates the ledger. Keeping the drift report on the same contract
// means `--check` and the gate can never disagree about what "in sync" means.
const NON_CONTRACT_KEYS = new Set<string>(["generatedAt"])

type EvidenceFile = Record<string, unknown>

interface Issue {
  code: string
  status: string
  evidence?: Record<string, unknown> & { evidenceFile?: string }
}

interface Ledger {
  updatedAt: string
  issues: Issue[]
}

const ledger = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Ledger
const changed: string[] = []
const skipped: string[] = []
const unverified: string[] = []
const dropped: string[] = []

// Entries this run will (re-)derive from their artifact. Two ways in, both under the explicit
// flag: the entry's citation does not resolve (withdraw it), or a previous run already withdrew
// it and the verifier has since been re-run (redeem it). A redeemed entry finds its artifact at
// the conventional path — `<CODE>.json` in the milestone's results — which is where every
// verifier in these milestones writes, and where a withdrawn entry no longer has a pointer.
const redeem = new Map<string, string>()
if (DROP_UNREACHABLE) {
  for (const issue of ledger.issues) {
    if (issue.evidence) {
      const cited = String(issue.evidence.currentCommit ?? "")
      if (commitReachable(cited)) continue
      dropped.push(`${issue.code}(${cited.slice(0, 12) || "no-commit"})`)
      const named = issue.evidence.evidenceFile
      issue.status = "planned"
      delete issue.evidence
      redeem.set(issue.code, typeof named === "string" ? named : `${issue.code}.json`)
    } else if (issue.status === "planned" && existsSync(path.join(RESULTS, `${issue.code}.json`))) {
      redeem.set(issue.code, `${issue.code}.json`)
    }
    if (!changed.includes(issue.code)) changed.push(issue.code)
  }
}

for (const issue of ledger.issues) {
  const named = redeem.get(issue.code)
  const isRedeem = named !== undefined
  if (!isRedeem && (issue.status === "planned" || !issue.evidence)) {
    skipped.push(`${issue.code}(planned)`)
    continue
  }
  const evidenceFile = named ?? issue.evidence!.evidenceFile
  const file = path.join(RESULTS, String(evidenceFile))
  if (!evidenceFile || !existsSync(file)) {
    skipped.push(`${issue.code}(no ${evidenceFile})`)
    continue
  }
  const e = JSON.parse(readFileSync(file, "utf8")) as EvidenceFile
  // A re-derivation may not put back the citation that was just withdrawn: an artifact that is
  // itself pinned at a commit this history cannot resolve is not evidence at this commit, however
  // green it says it is. Without this the withdrawal and the re-derivation would trade places and
  // the ledger would end the run exactly as it started.
  if (isRedeem) {
    const cited = String(e.currentCommit ?? "")
    if (!commitReachable(cited)) {
      unverified.push(`${issue.code}:unreachable-commit(${cited.slice(0, 12) || "none"})`)
      issue.status = "planned"
      delete issue.evidence
      continue
    }
  }
  // A ledger may not call an issue verified while its artifact says otherwise.
  const fileStatus = e.verdict ?? e.status
  if (fileStatus !== undefined && fileStatus !== "verified" && fileStatus !== "PASS") {
    unverified.push(`${issue.code}:${String(fileStatus)}`)
    // Not re-earnable: the entry stays planned, which is the honest record of a citation the
    // history lost and an artifact that does not pass.
    continue
  }
  const prior = (issue.evidence ?? {}) as Record<string, unknown>
  const next: Record<string, unknown> = { ...prior }
  if (isRedeem) {
    // Re-derived from the artifact alone: a withdrawn entry has no fields left to preserve, so
    // the artifact's own verification fields are the honest ones to record. Only keys a
    // verifier writes are copied — never a key invented here.
    issue.status = "verified"
    if (!changed.includes(issue.code)) changed.push(issue.code)
    next.evidenceFile = evidenceFile
    next.status = fileStatus
    for (const key of [...SYNCED_KEYS, "verifierCommand"] as const) {
      if (e[key] !== undefined) next[key] = e[key]
    }
  }
  const contractBefore: Record<string, unknown> = {}
  const contractAfter: Record<string, unknown> = {}
  for (const key of SYNCED_KEYS) {
    if (e[key] === undefined) continue
    // A verifier may introduce a field after its ledger entry was first derived
    // (ownerApproval for D2 is the case); sync copies it rather than requiring a
    // hand edit of the ledger. Agreement is still compared only where the prior
    // entry already carried the key.
    next[key] = e[key]
    if (prior[key] === undefined) continue
    if (!NON_CONTRACT_KEYS.has(key)) {
      contractBefore[key] = prior[key]
      contractAfter[key] = e[key]
    }
  }
  if (JSON.stringify(contractAfter) !== JSON.stringify(contractBefore) && !changed.includes(issue.code)) changed.push(issue.code)
  issue.evidence = next
}

if (changed.length > 0 && !CHECK_ONLY) {
  ledger.updatedAt = new Date().toISOString()
  // M61 D-1 (the seal law): the manifest is a RECORD and is written through the
  // ONE write path. This helper stamped RAW JSON, so a projection left the
  // previous run's envelope over new bytes — the stale seal M61.A1's A2 measured
  // on the m41 and m56 ledgers (2026-10-17, both sealed 2026-10-08, both
  // rewritten since by this helper).
  // `Ledger` is a named interface, so it has no implicit index signature and does not
  // satisfy `Record<string, unknown>` structurally. The cast is the shape boundary, not
  // a lie about the contents: writeSealed serialises the object it is given.
  writeSealed(MANIFEST_PATH, ledger as unknown as Record<string, unknown>)
  // ...and a registered ledger that was just resealed must MOVE ITS REGISTER ROW,
  // or M61.A1's A4 fails on the digest this write just changed.
  const moved = reRecordRegisterRow(ROOT, MANIFEST_PATH, `${MILESTONE} ledger re-synced from its evidence files by script/m41/sync-ledger.ts, which writes through writeSealed: content and seal moved together; verdicts unchanged`)
  if (moved.ok) console.log(`  register: ${moved.path} row moved ${moved.oldDigest.slice(0, 8)} -> ${moved.newDigest.slice(0, 8)}`)
}

let head = "unknown"
try {
  head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

console.log(`${MILESTONE.toUpperCase()} ledger sync (derived from evidence files)${CHECK_ONLY ? " [check only]" : ""}`)
for (const code of changed) console.log(`  ${CHECK_ONLY ? "drift" : "updated"}: ${code}`)
for (const code of skipped) console.log(`  skipped: ${code}`)
for (const code of unverified) console.log(`  REFUSED (artifact is not verified): ${code}`)
for (const d of dropped) console.log(`  ${CHECK_ONLY ? "would withdraw" : "withdrew"}: evidence cites a commit this history cannot resolve — ${d}`)
if (changed.length === 0) console.log("  already in sync")
console.log(`  HEAD: ${head}`)
