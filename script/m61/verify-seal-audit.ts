// script/m61/verify-seal-audit.ts — M61.A1: the repo-wide seal audit.
//
// The hole this gate closes, measured at HEAD 306bec22b (2026-10-07): the sealing
// LAW (script/lib/evidence.ts) is verified thoroughly — script/m61/verify-sealing.ts
// proves it against fixtures in a temp dir, mutant by mutant — but nothing ever
// asked the repository's OWN 583 sealed records whether their seals still verify.
// They did not, 24 times: every stale seal was stamped by the single M61 migration
// run at 2026-09-14T23:42:47-48Z and then rewritten by a producer that carried the
// old envelope forward. No gate read any of the 24, so nothing failed and nothing
// was reported. The instance that surfaced the class was M29.R2 — whose trusted read
// of validation/m14/results/M14.0.SPEC.json refused a present, current 109 KB ledger.
//
//   A1  namespace scan:    every `validation/**/*.json` record is classified —
//                          unsealed / sealed-and-valid / sealed-but-stale /
//                          bad-envelope — and the counts are recorded
//   A2  the class is dead: zero stale seals, zero malformed envelopes, and no
//                          sealed record that cannot be parsed
//   A3  not vacuous:       the scan visited records and found seals (a walker that
//                          reads nothing cannot pass), and every sealed record is
//                          re-read through the LIBRARY's trusted read so the gate
//                          cannot drift from the one owner of the seal law
//   A4  register honesty:  each row of validation/m61/seal-refresh-register.json
//                          names a file whose current seal still equals the
//                          refreshed digest — the register can never outlive the
//                          fact it records
//   A5  can-fail proof:    the same classifier, run over copies of a real sealed
//                          record in a temp dir, reports valid / stale / unsealed
//                          for the untouched / edited / stripped copy
//
// Run: npx tsx script/m61/verify-seal-audit.ts
// Evidence: validation/m61/results/A1.json (machine-emitted, SEALED)
//
// Scope, stated rather than implied: the audit covers the evidence namespace
// `validation/`, which is where milestone records live. It does NOT claim that
// every record is sealed — 2,954 of 3,577 were unsealed at the measured commit and
// that is the M61 D-1 migration's own unfinished state, recorded in `data` below.
// Its claim is narrower and exact: every seal that EXISTS verifies.

import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

import { SEAL_KEY, readEvidence, writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const NAMESPACE = path.join(ROOT, "validation")
const REGISTER = path.join(ROOT, "validation/m61/seal-refresh-register.json")
const RESULTS = path.join(ROOT, "validation/m61/results")

let checks = 0
let passed = 0
let failed = 0
let negatives = 0
const checksList: string[] = []
const failures: string[] = []
function check(name: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  }
  checksList.push(`${ok ? "ok" : "FAIL"}: ${name}${detail && !ok ? ` — ${detail}` : ""}`)
}
function negative(name: string, ok: boolean, detail = ""): void {
  negatives++
  check(`${name} [negative]`, ok, detail)
}

export interface StaleSeal {
  path: string
  sealedAt: string
  sealedDigest: string
  actualDigest: string
}
export interface SealAudit {
  scanned: number
  unparseable: number
  unparseablePaths: string[]
  sealed: number
  valid: number
  validPaths: string[]
  stale: StaleSeal[]
  badEnvelope: { path: string; why: string }[]
  unsealed: number
  sealedUnparseable: string[]
}

function walkJson(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      // `node_modules` is the only exclusion: dot-directories inside the evidence
      // namespace are still the namespace (measured 2026-10-07: the four of them
      // hold 84 JSON records and no sealed one — the walk covers them anyway, so
      // that stays measured rather than assumed).
      if (e.name === "node_modules") continue
      walkJson(p, out)
    } else if (e.name.endsWith(".json")) {
      out.push(p)
    }
  }
  return out
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Classify every JSON record under `dir` by the state of its seal. Pure read: no
 * writes, so the same function serves the real namespace and the temp-dir proof.
 */
export function auditRecords(dir: string): SealAudit {
  const audit: SealAudit = { scanned: 0, unparseable: 0, unparseablePaths: [], sealed: 0, valid: 0, validPaths: [], stale: [], badEnvelope: [], unsealed: 0, sealedUnparseable: [] }
  for (const file of walkJson(dir)) {
    audit.scanned++
    const raw = readFileSync(file, "utf8")
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      audit.unparseable++
      if (audit.unparseablePaths.length < 10) audit.unparseablePaths.push(path.relative(dir, file))
      // A record that CLAIMS a seal but cannot be parsed is the worst case: its
      // integrity is unverifiable and every reader would refuse it. Counted apart.
      if (raw.includes(`"${SEAL_KEY}"`)) audit.sealedUnparseable.push(path.relative(dir, file))
      continue
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue
    const record = parsed as Record<string, unknown>
    const rawSeal = record[SEAL_KEY]
    if (rawSeal === undefined) {
      audit.unsealed++
      continue
    }
    audit.sealed++
    const seal = rawSeal as Partial<{ alg: string; sealedAt: string; contentSha256: string }>
    if (seal.alg !== "sha256" || typeof seal.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(seal.contentSha256)) {
      audit.badEnvelope.push({ path: path.relative(dir, file), why: `alg=${String(seal.alg)} digest=${String(seal.contentSha256).slice(0, 12)}` })
      continue
    }
    const { [SEAL_KEY]: _seal, ...content } = record
    const actual = sha256(JSON.stringify(content))
    if (actual === seal.contentSha256) {
      audit.valid++
      if (audit.validPaths.length < 5) audit.validPaths.push(path.relative(dir, file))
    } else {
      audit.stale.push({
        path: path.relative(dir, file),
        sealedAt: String(seal.sealedAt ?? "unknown"),
        sealedDigest: seal.contentSha256,
        actualDigest: actual,
      })
    }
  }
  return audit
}

// ── A1/A2: the namespace scan, and the class is dead ─────────────────────────
const audit = auditRecords(NAMESPACE)
console.log(`seal audit: ${audit.scanned} JSON records scanned — ${audit.sealed} sealed (${audit.valid} valid), ${audit.unsealed} unsealed, ${audit.unparseable} unparseable`)
check("A1: the namespace scan visited records", audit.scanned > 0, `scanned=${audit.scanned}`)
check(
  "A1: the scan found sealed records to verify (a walker that reads nothing cannot pass)",
  audit.sealed > 0 && audit.valid > 0,
  `sealed=${audit.sealed} valid=${audit.valid}`,
)
check(
  "A2: every sealed record's bbSeal verifies (no stale seal anywhere in validation/)",
  audit.stale.length === 0,
  audit.stale.length ? `${audit.stale.length}: ` + audit.stale.slice(0, 8).map((s) => `${s.path} (${s.sealedDigest.slice(0, 8)} != ${s.actualDigest.slice(0, 8)}, sealed ${s.sealedAt.slice(0, 19)})`).join("; ") : "",
)
check(
  "A2: no sealed record carries a malformed bbSeal envelope",
  audit.badEnvelope.length === 0,
  audit.badEnvelope.length ? audit.badEnvelope.slice(0, 5).map((b) => `${b.path} (${b.why})`).join("; ") : "",
)
check(
  "A2: no record claiming a seal is unparseable (an unverifiable seal is a refusal, not a pass)",
  audit.sealedUnparseable.length === 0,
  audit.sealedUnparseable.slice(0, 5).join(", "),
)

// ── A3: agreement with the library's own trusted read ───────────────────────
// The classifier above is this gate's own arithmetic; the library owns the law.
// Every sealed record is therefore re-read through readEvidence, and the two
// verdicts must agree file-for-file — so this gate cannot drift from evidence.ts.
{
  let agreements = 0
  const disagreements: string[] = []
  for (const file of walkJson(NAMESPACE)) {
    const raw = readFileSync(file, "utf8")
    if (!raw.includes(`"${SEAL_KEY}"`)) continue
    const rel = path.relative(ROOT, file)
    const verdict = readEvidence(file)
    let classify: "valid" | "stale" | "bad-envelope" | "unparseable"
    try {
      const record = JSON.parse(raw) as Record<string, unknown>
      const seal = record[SEAL_KEY] as Partial<{ alg: string; contentSha256: string }> | undefined
      if (!seal || seal.alg !== "sha256" || !/^[0-9a-f]{64}$/.test(String(seal.contentSha256))) classify = "bad-envelope"
      else {
        const { [SEAL_KEY]: _s, ...content } = record
        classify = sha256(JSON.stringify(content)) === seal.contentSha256 ? "valid" : "stale"
      }
    } catch {
      classify = "unparseable"
    }
    const librarySays = verdict.ok ? "valid" : verdict.kind === "tampered" ? "stale" : verdict.kind === "bad-seal" ? "bad-envelope" : verdict.kind === "unparseable" ? "unparseable" : "unsealed"
    if (librarySays === classify) agreements++
    else disagreements.push(`${rel}: classifier=${classify} library=${librarySays}`)
  }
  check("A3: every seal verdict agrees with the library's trusted read", disagreements.length === 0, disagreements.slice(0, 5).join("; "))
  check("A3: the agreement check compared every sealed record", agreements === audit.sealed, `agreements=${agreements} sealed=${audit.sealed}`)
}

// ── A4: the refresh register cannot lie ─────────────────────────────────────
{
  if (!existsSync(REGISTER)) {
    console.log("register: absent (no refresh has ever been needed)")
    check("A4: no refresh register exists, so there is nothing to cross-check", true)
  } else {
    const register = JSON.parse(readFileSync(REGISTER, "utf8")) as { entries?: { path: string; oldDigest: string; newDigest: string; why: string; at: string }[] }
    const entries = register.entries ?? []
    const problems: string[] = []
    const seen = new Set<string>()
    for (const e of entries) {
      const file = path.join(ROOT, e.path)
      if (!existsSync(file)) {
        problems.push(`${e.path}: register row names a file that no longer exists`)
        continue
      }
      if (!e.why || !e.why.trim()) problems.push(`${e.path}: register row carries no reason`)
      const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
      const seal = record[SEAL_KEY] as { contentSha256?: string } | undefined
      if (!seal || seal.contentSha256 !== e.newDigest) {
        problems.push(`${e.path}: register says newDigest ${e.newDigest.slice(0, 8)} but the file's seal is ${String(seal?.contentSha256 ?? "ABSENT").slice(0, 8)}`)
      }
      const key = `${e.path}@${e.newDigest}`
      if (seen.has(key)) problems.push(`${e.path}: duplicate register row for the same digest`)
      seen.add(key)
    }
    check("A4: every register row names a file whose seal still equals the refreshed digest", problems.length === 0, problems.slice(0, 5).join("; "))
    check("A4: every register row carries a written reason", entries.every((e) => typeof e.why === "string" && e.why.trim().length > 0))
  }
}

// ── A5: the can-fail proof — the classifier fires on a real record ──────────
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "m61-a1-"))
  try {
    // The source must be a record whose seal VERIFIES, or the proof's baseline is
    // itself the defect (the first draft copied a stale record and "proved" that an
    // untouched copy reads stale — the check below failed and caught it).
    const source = audit.validPaths[0]
    check("A5: the scan found a valid sealed record to use as the proof's baseline", typeof source === "string", `validPaths=${audit.validPaths.length}`)
    if (!source) {
      // Nothing valid to copy: the proof cannot run, and saying so is the honest verdict.
      check("A5: the can-fail proof ran", false, "no valid sealed record exists in the namespace — nothing to copy")
    } else {
      const sourcePath = path.join(NAMESPACE, source)
      const original = readFileSync(sourcePath, "utf8")
      const untouched = path.join(tmp, "untouched.json")
      writeFileSync(untouched, original)
      const cleanAudit = auditRecords(tmp)
      check("A5: a sealed record's untouched copy reads valid", cleanAudit.valid === 1 && cleanAudit.stale.length === 0, `valid=${cleanAudit.valid} stale=${cleanAudit.stale.length}`)

      // One byte of content, changed after sealing: the exact shape of the class.
      const edited = JSON.parse(original) as Record<string, unknown>
      edited.auditProbeEditedAfterSealing = true
      writeFileSync(untouched, `${JSON.stringify(edited, null, 2)}\n`)
      const editedAudit = auditRecords(tmp)
      check(
        "A5: the same record with content added after sealing reads STALE",
        editedAudit.stale.length === 1 && editedAudit.valid === 0,
        `stale=${editedAudit.stale.length} valid=${editedAudit.valid}`,
      )
      negative("A5: the audit's stale verdict is not a constant (the untouched copy passed the same run above)", cleanAudit.stale.length === 0)

      // The seal removed: a different state, and a different repair (not this tool's).
      const { [SEAL_KEY]: _strip, ...stripped } = JSON.parse(original) as Record<string, unknown>
      writeFileSync(untouched, `${JSON.stringify(stripped, null, 2)}\n`)
      const strippedAudit = auditRecords(tmp)
      check("A5: a record with its seal stripped reads unsealed (not valid, not stale)", strippedAudit.unsealed === 1 && strippedAudit.valid === 0 && strippedAudit.stale.length === 0, `unsealed=${strippedAudit.unsealed} valid=${strippedAudit.valid} stale=${strippedAudit.stale.length}`)

      const malformed = { ...(JSON.parse(original) as Record<string, unknown>), [SEAL_KEY]: { alg: "md5", sealedAt: "x", contentSha256: "a".repeat(32) } }
      writeFileSync(untouched, `${JSON.stringify(malformed, null, 2)}\n`)
      const badAudit = auditRecords(tmp)
      check("A5: a malformed envelope reads bad-envelope", badAudit.badEnvelope.length === 1 && badAudit.valid === 0, `bad=${badAudit.badEnvelope.length}`)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ── Emit (through the same sealed write path this gate audits) ───────────────
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const evidence = {
  issue: "M61.A1 evidence seal audit (repo-wide)",
  code: "A1",
  milestone: "M61",
  title: "The seal audit — every seal that exists in validation/ verifies",
  status: failed === 0 ? "verified" : "known-gap",
  checks: checks,
  passed,
  failed,
  realFailed: failed,
  negatives,
  failures,
  checksList,
  currentCommit: commit,
  verifierCommand: "npx tsx script/m61/verify-seal-audit.ts",
  evidenceFile: "A1.json",
  generatedAt: new Date().toISOString(),
  data: {
    namespace: "validation",
    scanned: audit.scanned,
    sealed: audit.sealed,
    valid: audit.valid,
    staleCount: audit.stale.length,
    badEnvelopeCount: audit.badEnvelope.length,
    unsealed: audit.unsealed,
    unparseable: audit.unparseable,
    unparseablePaths: audit.unparseablePaths,
    registerRows: existsSync(REGISTER) ? ((JSON.parse(readFileSync(REGISTER, "utf8")) as { entries?: unknown[] }).entries ?? []).length : 0,
  },
  limitations: [
    "The audit covers the `validation/` evidence namespace (where milestone records live) and says nothing about sealed records stored elsewhere; no other directory was measured.",
    "Its claim is that every seal that EXISTS verifies — not that every record is sealed. The unsealed population is measured and recorded in `data` (with the unparseable records, which are the JSON analyzer's deliberately-invalid fixtures), and sealing the rest is the M61 D-1 migration's own unfinished work, not this gate's.",
    "A seal verifies INTEGRITY (the record is exactly what its writer sealed), not freshness or truth: a stale-DATA record with a valid seal passes here by design.",
    "A5's can-fail proof uses copies of a real sealed record in a temp dir; the classification of the real namespace is the same code path run once, read-only, so no real artifact is written by the audit.",
  ],
}
const seal = writeSealed(path.join(RESULTS, "A1.json"), evidence)
console.log(`\nM61.A1: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} passed, ${negatives} negatives)`)
console.log(`Evidence (sealed ${seal.contentSha256.slice(0, 8)}): validation/m61/results/A1.json`)
process.exit(failed === 0 ? 0 : 1)
