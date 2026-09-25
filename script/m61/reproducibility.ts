// script/m61/reproducibility.ts — M61.V3 (issue #844): the reproducibility
// auditor.
//
// The defect this pins: stored evidence is trusted forever once green. Nothing
// re-executes the recorded commands, so drift in inputs, runtimes, or the
// environment ages evidence silently — a record says "verified" long after it
// stopped being true.
//
// The auditor re-executes the recorded verifier command of each DECLARED sample
// member in an ISOLATED TEMP CHECKOUT of HEAD (a detached git worktree with the
// real node_modules symlinked in), then diffs the freshly produced record
// against the stored one, field by field. Blocked-with-reason on a missing
// runtime — and per D-3's distinguishing rule, a harness KILL (timeout/signal)
// is never recorded as non-reproducibility.
//
// Declared laws (gated by script/m61/verify-reproducibility.ts):
//   R1 duplicate-free:    the sample is owned by script/m61/reproducibility-sample.json;
//                         this module hardcodes no member.
//   R2 never silently aged: a member that does not reproduce is a FAILURE. A
//                         BLOCKED member must be declared (with its reason) in
//                         the sample file, or the audit fails.
//   R3 minimum + coverage: the audit requires >= the declared minimum members
//                         reproduced AND at least one reproducing member for
//                         every required milestone.
//   R4 isolation:         runs happen in a temp checkout; the REAL stored
//                         evidence is byte-unchanged by the audit (hashed
//                         before and after).
//   R5 kill != drift:     a timeout/signal is classified "killed" (blocked),
//                         never "diverged".
//
// Run: npx tsx script/m61/verify-reproducibility.ts
// Evidence: validation/m61/results/V3.json (sealed)

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export const ROOT = path.resolve(import.meta.dirname, "..", "..")
export const SAMPLE_FILE = path.join(ROOT, "script/m61/reproducibility-sample.json")

export type SampleMember = {
  milestone: string
  record: string
  verifierCommand: string
  rationale: string
}

export type Sample = {
  schemaVersion: number
  milestone: string
  declaredMinimum: number
  requiredMilestones: string[]
  stableFields: string[]
  declaredVolatileFields: string[]
  perMemberTimeoutMs: number
  members: SampleMember[]
  declaredBlocked: { record: string; reason: string }[]
}

export function loadSample(file = SAMPLE_FILE): Sample {
  return JSON.parse(readFileSync(file, "utf8")) as Sample
}

// --- pure decision cores (unit-tested + mutation-anchored) -----------------------

export type RunClass = "ok" | "killed" | "failed"

/**
 * D-3's distinguishing rule, as machinery. A harness kill (timeout or signal)
 * is NOT a reproducibility failure — it is re-run/blocked-with-reason. Only a
 * completed run with a non-zero exit is a real failure.
 */
export function classifyRun(input: { exitCode: number | null; signal: string | null; timedOut: boolean }): RunClass {
  if (input.timedOut) return "killed"
  if (input.signal !== null) return "killed"
  if (input.exitCode === 0) return "ok"
  return "failed"
}

export type Divergence = { field: string; stored: unknown; fresh: unknown }

/**
 * Field-precise diff of a freshly produced record against the stored one.
 * Declared-volatile fields (timestamps, seal metadata, the pinned commit) are
 * excluded; the declared stable fields plus the per-check verdict list are
 * compared exactly. `checksList[<i>]` names the FIRST differing check so a
 * divergence is actionable, not a wall of text.
 */
export function diffRecords(stored: Record<string, unknown>, fresh: Record<string, unknown>, stableFields: string[], volatileFields: string[]): Divergence[] {
  const volatile = new Set(volatileFields)
  const out: Divergence[] = []
  for (const f of stableFields) {
    if (volatile.has(f)) continue
    const a = JSON.stringify(stored[f] ?? null)
    const b = JSON.stringify(fresh[f] ?? null)
    if (a !== b) out.push({ field: f, stored: stored[f] ?? null, fresh: fresh[f] ?? null })
  }
  const normalize = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.map((c) => (typeof c === "string" ? c : JSON.stringify(c))) : null
  const sa = normalize(stored.checksList)
  const sb = normalize(fresh.checksList)
  if (JSON.stringify(sa) !== JSON.stringify(sb)) {
    let i = 0
    const n = Math.max(sa?.length ?? 0, sb?.length ?? 0)
    while (i < n && sa?.[i] === sb?.[i]) i++
    out.push({ field: `checksList[${i}]`, stored: sa?.[i] ?? null, fresh: sb?.[i] ?? null })
  }
  return out
}

export type MemberResult = {
  milestone: string
  record: string
  verifierCommand: string
  outcome: "reproduced" | "diverged" | "blocked"
  runClass: RunClass
  reason?: string
  divergences?: Divergence[]
}

export type Verdict = {
  status: "verified" | "known-gap"
  reproduced: number
  diverged: number
  blocked: number
  failures: string[]
  members: MemberResult[]
}

/**
 * The audit verdict. A member either reproduces, diverges (a FAILURE), or is
 * blocked. Blocked is only acceptable when the sample file DECLARES it with a
 * reason — that is the "never silently aged out" law. The verdict also fails if
 * fewer than the declared minimum reproduced, or if a required milestone has no
 * reproducing member.
 */
export function sampleVerdict(members: MemberResult[], sample: Sample): Verdict {
  const failures: string[] = []
  const declaredBlocked = new Set((sample.declaredBlocked ?? []).map((b) => b.record))
  for (const m of members) {
    const label = `${m.milestone}/${path.basename(m.record)}`
    if (m.outcome === "diverged") {
      const detail = (m.divergences ?? [])
        .map((d) => `${d.field}: stored=${JSON.stringify(d.stored)} fresh=${JSON.stringify(d.fresh)}`)
        .join("; ")
      failures.push(`${label} DID NOT REPRODUCE — ${detail}`)
    } else if (m.outcome === "blocked" && !declaredBlocked.has(m.record)) {
      failures.push(`${label} BLOCKED without declaration in the sample — ${m.reason ?? "no reason"}`)
    }
  }
  const reproduced = members.filter((m) => m.outcome === "reproduced").length
  if (reproduced < sample.declaredMinimum) {
    failures.push(`reproduced ${reproduced} < declared minimum ${sample.declaredMinimum}`)
  }
  const covered = new Set(members.filter((m) => m.outcome === "reproduced").map((m) => m.milestone))
  for (const r of sample.requiredMilestones) {
    if (!covered.has(r)) failures.push(`required milestone ${r} has no reproducing member`)
  }
  return {
    status: failures.length === 0 ? "verified" : "known-gap",
    reproduced,
    diverged: members.filter((m) => m.outcome === "diverged").length,
    blocked: members.filter((m) => m.outcome === "blocked").length,
    failures,
    members,
  }
}

/** R4: the audit must leave the real stored evidence byte-identical. */
export function assertStoredUntouched(before: Record<string, string>, after: Record<string, string>): string[] {
  const violations: string[] = []
  for (const [p, h] of Object.entries(before)) {
    if (after[p] !== h) violations.push(p)
  }
  return violations
}

// --- process layer ---------------------------------------------------------------

export function hashFile(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex")
}

export function hashEvidenceFiles(root: string, records: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of records) {
    const abs = path.join(root, r)
    if (existsSync(abs)) out[r] = hashFile(abs)
  }
  return out
}

export function createIsolatedCheckout(commit: string, dir: string, nodeModulesFrom = ROOT): void {
  execFileSync("git", ["worktree", "add", "--detach", dir, commit], { cwd: ROOT, stdio: "pipe" })
  const nm = path.join(nodeModulesFrom, "node_modules")
  if (existsSync(nm)) symlinkSync(nm, path.join(dir, "node_modules"), "dir")
}

export function removeIsolatedCheckout(dir: string): void {
  try {
    execFileSync("git", ["worktree", "remove", "--force", dir], { cwd: ROOT, stdio: "pipe" })
  } catch {
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    execFileSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "pipe" })
  } catch {
    /* prune is best-effort */
  }
}

export function headCommit(root = ROOT): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
}

/** Re-execute one member's recorded command inside `root`; never writes to `storedRoot`. */
export function runMember(m: SampleMember, root: string, timeoutMs: number): { runClass: RunClass; spawnError?: string } {
  const res = spawnSync(m.verifierCommand, {
    cwd: root,
    shell: true,
    timeout: timeoutMs,
    encoding: "utf8",
    env: { ...process.env, BB_REPRODUCIBILITY_RUN: "1" },
  })
  const errCode = (res.error as NodeJS.ErrnoException | undefined)?.code
  if (errCode === "ETIMEDOUT") return { runClass: "killed", spawnError: "the harness killed the command at its declared timeout" }
  if (res.error) return { runClass: "failed", spawnError: `${errCode ?? "spawn"}: ${res.error.message}` }
  return { runClass: classifyRun({ exitCode: res.status, signal: res.signal, timedOut: false }) }
}

export type AuditResult = {
  verdict: Verdict
  commit: string
  startedAt: string
  finishedAt: string
  sample: string
  isolation: "git-worktree-detached"
  storedUntouched: boolean
  storedViolations: string[]
}

/**
 * The audit. `isolatedRoot` is where members run (a temp checkout); `storedRoot`
 * is where the trusted records live (the real repo). They are SEPARATE by
 * construction — running in place would clobber the very records being audited.
 */
export function runAudit(sample: Sample, opts: { storedRoot?: string; isolatedRoot: string; commit: string }): AuditResult {
  const storedRoot = opts.storedRoot ?? ROOT
  const startedAt = new Date().toISOString()
  const records = sample.members.map((m) => m.record)
  const before = hashEvidenceFiles(storedRoot, records)

  const members: MemberResult[] = []
  for (const m of sample.members) {
    const freshAbs = path.join(opts.isolatedRoot, m.record)
    rmSync(freshAbs, { force: true }) // a stale copy must never pass as a fresh run
    const { runClass, spawnError } = runMember(m, opts.isolatedRoot, sample.perMemberTimeoutMs)
    const storedAbs = path.join(storedRoot, m.record)
    const base: MemberResult = { milestone: m.milestone, record: m.record, verifierCommand: m.verifierCommand, outcome: "blocked", runClass }

    if (!existsSync(storedAbs)) {
      members.push({ ...base, reason: "no stored record to compare against" })
      continue
    }
    if (!existsSync(freshAbs)) {
      members.push({ ...base, reason: spawnError ?? `command produced no fresh record (run class: ${runClass})` })
      continue
    }
    const stored = JSON.parse(readFileSync(storedAbs, "utf8")) as Record<string, unknown>
    const fresh = JSON.parse(readFileSync(freshAbs, "utf8")) as Record<string, unknown>
    const divergences = diffRecords(stored, fresh, sample.stableFields, sample.declaredVolatileFields)
    if (divergences.length > 0) {
      members.push({ ...base, outcome: "diverged", divergences })
    } else if (runClass === "killed" || runClass === "failed") {
      // The record matched anyway — but the run did not complete cleanly; this is
      // not a reproduction, it is a blocked run that happens to agree.
      members.push({ ...base, reason: `record matched but the run did not complete (${runClass}${spawnError ? `: ${spawnError}` : ""})` })
    } else {
      members.push({ ...base, outcome: "reproduced" })
    }
  }

  const after = hashEvidenceFiles(storedRoot, records)
  const storedViolations = assertStoredUntouched(before, after)
  const verdict = sampleVerdict(members, sample)
  if (storedViolations.length > 0) {
    verdict.failures.push(`the audit MODIFIED the real stored evidence: ${storedViolations.join(", ")}`)
    verdict.status = "known-gap"
  }

  return {
    verdict,
    commit: opts.commit,
    startedAt,
    finishedAt: new Date().toISOString(),
    sample: path.relative(ROOT, SAMPLE_FILE),
    isolation: "git-worktree-detached",
    storedUntouched: storedViolations.length === 0,
    storedViolations,
  }
}

/** Convenience: build the temp checkout, run the audit, tear it down. */
export function auditAtHead(sample = loadSample()): AuditResult {
  const commit = headCommit()
  const dir = path.join(os.tmpdir(), `bb-m61-repro-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  createIsolatedCheckout(commit, dir)
  try {
    return runAudit(sample, { isolatedRoot: dir, commit })
  } finally {
    removeIsolatedCheckout(dir)
  }
}
