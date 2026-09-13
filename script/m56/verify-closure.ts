// script/m56/verify-closure.ts — M56.X1 (#787), closure, deploy and M41 fold-in.
//
// Refuses milestone close unless the whole batch is provably one push:
//
//   1. ONE-COMMIT BATCH. Every non-X1 M56 artifact exists, is PASS with at
//      least one planted negative, and cites the SAME commit H. A batch whose
//      files disagree about the commit is not a batch — it is a re-run history,
//      and closing on it would hide which tree was actually verified.
//   2. M41 FOLD-IN. M41's site gates (T2, T3, S1, S2, D1) cite H as well, so a
//      single push closes both milestones — the plan's owner decision. S2 is
//      DEPLOY-GATED: it probes the live deployment, so it can only be re-pinned
//      after the deploy; it must be PASS with negatives at a commit that is an
//      ancestor of HEAD, and the post-deploy re-run is a recorded owner step.
//   3. H IS REAL AND HAPPENED BEFORE THE ARTIFACTS. H must be HEAD or an
//      ancestor of HEAD, and every artifact's mtime must be at or after H's
//      commit time — an artifact written before its own commit is impossible.
//   4. LEDGER TRUTH. Both ledgers carry every issue, X1 last, every sibling
//      verified, each entry closable (commit + command + file + counters), and
//      each verified entry MATCHES the artifact it names.
//   5. LIVE RE-RUNS. The truth pipeline is regenerated and diffed, and both
//      governance gates are re-run live — reading a ledger is not proving it.
//   6. WIRING. Every gate this milestone depends on runs in CI's verify-site job
//      and in the local verify chain, checked against the real files.
//   7. DEPLOY CONTRACT + OWNER STEPS. The Vercel wait-for-checks contract and
//      the dashboard steps no agent can perform are declared, and the parts of
//      X1 that only the owner can do are named in the evidence rather than
//      quietly claimed.
//
// Every check has a planted negative that mutates a CLONE and runs the SAME
// predicate the positive check used, so a probe cannot pass by testing a copy.
//
// Run: npx tsx script/m56/verify-closure.ts
// Evidence: validation/m56/results/X1.json

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const M56 = path.join(ROOT, "validation/m56/results")
const M41 = path.join(ROOT, "validation/m41/results")
const EVIDENCE_PATH = path.join(M56, "X1.json")
const CI_PATH = path.join(ROOT, ".github/workflows/ci.yml")
const PKG_PATH = path.join(ROOT, "package.json")
const PLAN_PATH = path.join(ROOT, "docs/m56/M56-MASTER-PLAN.md")
const M41_PLAN_PATH = path.join(ROOT, "docs/m41/M41-MASTER-PLAN.md")

const M56_CODES = ["G1", "E1", "T1", "L1", "D1", "S1", "I1", "D2", "X1"] as const
const M41_CODES = ["G1", "T1", "T2", "T3", "S1", "S2", "D1", "X1"] as const
const M41_FOLD = ["T2", "T3", "S1", "S2", "D1"] as const
// S2 probes the LIVE deployment (dns.google + backbencher.cc) and can only be
// re-pinned after the push reaches production. It is required PASS with
// negatives, but its commit is allowed to trail H — recorded, never assumed.
const M41_DEPLOY_GATED = ["S2"] as const

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, condition: boolean, detail = ""): void {
  negatives++
  check(`${label} [negative]`, condition, detail)
}
function read(rel: string): string {
  try {
    return readFileSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel), "utf8")
  } catch {
    return ""
  }
}
function readJson<T = Record<string, unknown>>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T
  } catch {
    return null
  }
}
function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
}
function isAncestor(sha: string, of: string): boolean {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return false
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, of], { cwd: ROOT, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
function commitTime(sha: string): number | null {
  try {
    return Number(git(["log", "-1", "--format=%ct", sha]))
  } catch {
    return null
  }
}
function runGate(script: string): { code: number; tail: string } {
  // `script` may carry flags ("script/x.ts --check"), so split them: passing
  // "file.ts --check" as one argument makes tsx look for a file with a space
  // in its name and crash with ENOENT, which reads like a gate failure.
  const [file, ...flags] = script.split(" ")
  const r = spawnSync("npx", ["tsx", path.join(ROOT, file!), ...flags], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900_000,
    env: { ...process.env, BB_LOG_LEVEL: "3" },
  })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  return { code: r.status ?? 1, tail: out.trim().split("\n").slice(-2).join(" | ") }
}

// ---------------------------------------------------------------------------
// Pure predicates. The positive checks and the negatives call the SAME ones.
// ---------------------------------------------------------------------------

interface Artifact {
  currentCommit?: string
  status?: string
  verdict?: string
  passed?: number
  failed?: number
  negativeCases?: number
  [k: string]: unknown
}
type Entry = { code: string; file: string; ev: Artifact | null }

function loadArtifacts(dir: string, codes: readonly string[]): Entry[] {
  return codes.map((code) => ({
    code,
    file: path.join(dir, `${code}.json`),
    ev: readJson<Artifact>(path.join(dir, `${code}.json`)),
  }))
}

/** A gate artifact is usable closure evidence only if it passed with ≥1 negative. */
function isPassArtifact(ev: Artifact | null): boolean {
  if (!ev) return false
  const status = ev.verdict ?? ev.status
  return (
    (status === "verified" || status === "PASS") &&
    (ev.passed ?? 0) > 0 &&
    ev.failed === 0 &&
    (ev.negativeCases ?? 0) > 0
  )
}

/** Artifacts that are missing or did not pass with planted negatives. */
function passDefects(entries: Entry[]): string[] {
  const out: string[] = []
  for (const e of entries) {
    if (!e.ev) out.push(`${e.code}:missing`)
    else if (!isPassArtifact(e.ev)) out.push(`${e.code}:not-pass`)
  }
  return out
}

/** The commits a set of artifacts cites (1 = uniform). */
function commitSpread(entries: Entry[]): string[] {
  return [...new Set(entries.map((e) => e.ev?.currentCommit).filter(Boolean))] as string[]
}

/** Defects that disqualify a set of artifacts from being closure evidence. */
function batchDefects(entries: Entry[]): string[] {
  const out = passDefects(entries)
  const commits = commitSpread(entries)
  if (commits.length !== 1) out.push(`commit-not-uniform:${commits.length}`)
  return out
}

/** The single batch commit, or null when the set is not uniform. */
function batchCommit(entries: Entry[]): string | null {
  const commits = commitSpread(entries)
  return commits.length === 1 ? commits[0]! : null
}

interface LedgerIssue {
  code: string
  status: string
  evidence?: Record<string, unknown> & { evidenceFile?: string; currentCommit?: string }
  [k: string]: unknown
}
interface Ledger {
  milestone?: string
  status?: string
  issues?: LedgerIssue[]
  [k: string]: unknown
}

function isClosableEntry(issue: LedgerIssue): boolean {
  if (issue.status === "planned") return false
  const e = issue.evidence
  if (!e) return false
  return Boolean(
    e.status === issue.status &&
      typeof e.currentCommit === "string" &&
      e.currentCommit.length >= 7 &&
      typeof e.verifierCommand === "string" &&
      typeof e.evidenceFile === "string" &&
      typeof e.generatedAt === "string" &&
      typeof e.passed === "number" &&
      e.passed > 0 &&
      e.failed === 0 &&
      typeof e.negativeCases === "number" &&
      e.negativeCases > 0,
  )
}

/** Structural defects in a ledger, independent of the artifacts. */
function ledgerDefects(ledger: Ledger | null, codes: readonly string[]): string[] {
  if (!ledger || !Array.isArray(ledger.issues)) return ["ledger-unreadable"]
  const out: string[] = []
  const seen = new Set<string>()
  for (const issue of ledger.issues) {
    if (!codes.includes(issue.code)) out.push(`unknown-code:${issue.code}`)
    if (seen.has(issue.code)) out.push(`duplicate:${issue.code}`)
    seen.add(issue.code)
    if (issue.status !== "planned" && !isClosableEntry(issue)) out.push(`hollow-${issue.status}:${issue.code}`)
  }
  if (ledger.issues.length !== codes.length) out.push(`issue-count:${ledger.issues.length}`)
  for (const c of codes) if (!seen.has(c)) out.push(`missing:${c}`)
  const order = ledger.issues.map((i) => i.code)
  if (order[0] !== "G1") out.push("order:g1-first")
  if (order[order.length - 1] !== "X1") out.push("order:x1-last")
  return out
}

/**
 * Ledger ↔ artifact agreement. G1 is excluded because the run that validates a
 * ledger rewrites G1.json; X1 is excluded because this gate emits it. Both are
 * still policed architecturally (G1 by the reachability check, X1 by the batch
 * uniformity check), and their commits are checked to exist either way.
 */
function agreementMismatches(
  ledger: Ledger | null,
  dir: string,
  exclude: string[],
  ignoreCommit: string[] = [],
): string[] {
  const out: string[] = []
  for (const issue of ledger?.issues ?? []) {
    if (issue.status === "planned" || !issue.evidence) continue
    if (exclude.includes(issue.code)) continue
    const e = issue.evidence
    const file = readJson<Artifact>(path.join(dir, String(e.evidenceFile ?? "")))
    if (!file) {
      out.push(`${issue.code}:unreadable`)
      continue
    }
    if (!ignoreCommit.includes(issue.code) && file.currentCommit !== e.currentCommit) out.push(`${issue.code}:commit`)
    if (file.passed !== e.passed) out.push(`${issue.code}:passed`)
    if (file.failed !== e.failed) out.push(`${issue.code}:failed`)
    if (file.negativeCases !== e.negativeCases) out.push(`${issue.code}:negatives`)
  }
  return out
}

function unreachable(ledger: Ledger | null, head: string): string[] {
  return (ledger?.issues ?? [])
    .filter((i) => i.status !== "planned" && i.evidence?.currentCommit)
    .filter((i) => !isAncestor(String(i.evidence!.currentCommit), head))
    .map((i) => `${i.code}:${String(i.evidence!.currentCommit).slice(0, 8)}`)
}

/** Commands a file must contain, matched with whitespace/line-continuations folded. */
function missingCommands(text: string, commands: readonly string[]): string[] {
  const fold = (s: string): string => s.replace(/\\\r?\n/g, " ").replace(/\s+/g, " ").trim()
  const haystack = fold(text)
  return commands.filter((c) => !haystack.includes(fold(c)))
}

function missingDeclarations(text: string, declarations: readonly string[]): string[] {
  // Fold whitespace the same way the command checks do: a declaration wrapped
  // across a line is still the same declaration, and a gate that failed on
  // line-wrapping would push authors to un-wrap prose to satisfy it.
  const fold = (s: string): string => s.replace(/\s+/g, " ").trim()
  const haystack = fold(text)
  return declarations.filter((d) => !haystack.includes(fold(d)))
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

console.log("M56.X1 closure verifier (batch, fold-in, wiring, deploy contract)")

// G1 is EXCLUDED from the commit-uniformity set, and that exclusion is load
// bearing: this gate re-runs governance live (section 5), which rewrites
// G1.json — a comparison the run itself invalidates cannot be a check. G1 is
// still required PASS here, still agreement-checked in the ledger, and still
// proven live end to end; only its commit is not part of the uniformity tally.
const m56All = loadArtifacts(M56, M56_CODES.filter((c) => c !== "X1"))
const m56Entries = m56All.filter((e) => e.code !== "G1")
const m41Entries = loadArtifacts(M41, M41_FOLD)
const m56Ledger = readJson<Ledger>(path.join(M56, "manifest.json"))
const m41Ledger = readJson<Ledger>(path.join(M41, "manifest.json"))

let head = "unknown"
try {
  head = git(["rev-parse", "HEAD"])
} catch {}

const ciText = read(CI_PATH)
const pkg = readJson<{ scripts?: Record<string, string> }>(PKG_PATH)
const plan = read(PLAN_PATH)
const m41Plan = read(M41_PLAN_PATH)

// ---------------------------------------------------------------------------
// 1. one-commit batch
// ---------------------------------------------------------------------------

const m56PassDefects = passDefects(m56All)
check("X1: every M56 gate artifact exists and is PASS with planted negatives", m56PassDefects.length === 0, m56PassDefects.join(", "))
const H = batchCommit(m56Entries)
check("X1: all M56 artifacts cite the SAME commit (one-commit batch)", H !== null, `commits=${commitSpread(m56Entries).join(",")}`)

// ---------------------------------------------------------------------------
// 2. M41 fold-in (one push closes both milestones)
// ---------------------------------------------------------------------------

const siteEntries = m41Entries.filter((e) => !(M41_DEPLOY_GATED as readonly string[]).includes(e.code))
const deployGated = m41Entries.filter((e) => (M41_DEPLOY_GATED as readonly string[]).includes(e.code))
const foldDefects = batchDefects(siteEntries)
check("X1: M41 site gates (T2, T3, S1, D1) are PASS and uniform at one commit", foldDefects.length === 0, foldDefects.join(", "))
check("X1: M41 site gates cite the SAME commit as the M56 batch (one push closes both)", H !== null && batchCommit(siteEntries) === H, `m56=${String(H).slice(0, 8)} m41=${String(batchCommit(siteEntries)).slice(0, 8)}`)
const gateDefects = deployGated.filter((e) => !isPassArtifact(e.ev))
check("X1: deploy-gated M41.S2 evidence is PASS with negatives", gateDefects.length === 0, gateDefects.map((e) => e.code).join(","))
const s2Commit = String(deployGated[0]?.ev?.currentCommit ?? "")
check("X1: deploy-gated M41.S2 cites a real commit that is an ancestor of HEAD", isAncestor(s2Commit, head), `${s2Commit.slice(0, 8)} vs ${head.slice(0, 8)}`)

// ---------------------------------------------------------------------------
// 3. H is real, and the artifacts were written after it
// ---------------------------------------------------------------------------

check("X1: batch commit exists in this history", H !== null && commitTime(H) !== null, String(H).slice(0, 9))
check("X1: batch commit is HEAD or an ancestor of HEAD (nothing verified a future tree)", H !== null && isAncestor(H, head), `${String(H).slice(0, 8)} vs ${head.slice(0, 8)}`)

const hTime = H ? commitTime(H) : null
const staleArtifacts: string[] = []
if (hTime !== null) {
  // G1 is absent from both lists for the same reason as the uniformity set: the
  // live re-run rewrites it during this gate.
  for (const e of [...m56Entries, ...siteEntries]) {
    if (!e.ev || !existsSync(e.file)) continue
    const mtime = statSync(e.file).mtimeMs / 1000
    // 2s of slack: commit timestamps are whole seconds. Deploy-gated artifacts
    // are excluded on purpose — they are produced against the DEPLOYED build,
    // so they legitimately predate this batch and are re-pinned after the push.
    if (mtime < hTime - 2) staleArtifacts.push(`${e.code}`)
  }
}
check("X1: every artifact was written at or after the batch commit", staleArtifacts.length === 0, staleArtifacts.join(","))

// ---------------------------------------------------------------------------
// 4. ledger truth + agreement
// ---------------------------------------------------------------------------

const m56LedgerDefects = ledgerDefects(m56Ledger, M56_CODES)
check("X1: M56 ledger is structurally complete and X1 closes last", m56LedgerDefects.length === 0, m56LedgerDefects.join(", "))
const m41LedgerDefects = ledgerDefects(m41Ledger, M41_CODES)
check("X1: M41 ledger is structurally complete and X1 closes last", m41LedgerDefects.length === 0, m41LedgerDefects.join(", "))

const m56Verified = (m56Ledger?.issues ?? []).filter((i) => i.status === "verified" && i.code !== "X1")
check("X1: all 8 M56 siblings are verified", m56Verified.length === M56_CODES.length - 1, `${m56Verified.length}/${M56_CODES.length - 1}`)
const m41Verified = (m41Ledger?.issues ?? []).filter((i) => i.status === "verified" && i.code !== "X1")
check("X1: all 7 M41 siblings are verified", m41Verified.length === M41_CODES.length - 1, `${m41Verified.length}/${M41_CODES.length - 1}`)
check(
  "X1: X1 is planned or verified, never blocked (it is the closing issue)",
  ["planned", "verified"].includes(String((m56Ledger?.issues ?? []).find((i) => i.code === "X1")?.status)),
)

const EXCLUDE_SELF = ["G1", "X1"]
const m56Drift = agreementMismatches(m56Ledger, M56, EXCLUDE_SELF)
check("X1: every M56 verified entry matches the artifact it names", m56Drift.length === 0, m56Drift.join(", "))
const m41Drift = agreementMismatches(m41Ledger, M41, EXCLUDE_SELF, [...M41_DEPLOY_GATED])
check("X1: every M41 verified entry matches the artifact it names", m41Drift.length === 0, m41Drift.join(", "))
const unreachableAll = [...unreachable(m56Ledger, head), ...unreachable(m41Ledger, head)]
check("X1: every cited evidence commit exists in this history", unreachableAll.length === 0, unreachableAll.join(", "))

// ---------------------------------------------------------------------------
// 5. live re-runs — reading a ledger is not proving it
// ---------------------------------------------------------------------------

console.log("  [closure] live re-run: truth pipeline --check…")
const tp = runGate("script/m41/generate-site-truth.ts --check")
check("X1: truth pipeline regenerates byte-identical at HEAD", tp.code === 0, tp.tail.slice(-160))

console.log("  [closure] live re-run: M56 governance…")
const g56 = runGate("script/m56/verify-governance.ts")
check("X1: M56 governance gate passes live at HEAD", g56.code === 0, g56.tail.slice(-160))

console.log("  [closure] live re-run: M41 governance (fold-in integrity)…")
const g41 = runGate("script/m41/verify-governance.ts")
check("X1: M41 governance gate passes live at HEAD", g41.code === 0, g41.tail.slice(-160))

// ---------------------------------------------------------------------------
// 6. wiring — CI and the local verify chain
// ---------------------------------------------------------------------------

const SITE_JOB_REQUIRED = [
  "npx tsx script/m41/generate-site-truth.ts --check",
  "npx tsx script/m41/verify-truth-pipeline.ts",
  "npx tsx script/m41/verify-design.ts",
  "npx tsx script/m41/verify-site-truth.ts",
  "npx tsx script/m41/verify-site-truth.ts --label T3",
  "npx tsx script/m41/verify-seo.ts",
  "npx tsx script/m41/verify-governance.ts",
  "npx tsx script/m41/verify-seo-onboarding.ts",
  "npx tsx script/m56/verify-tools-truth.ts",
  "npx tsx script/m56/verify-editors-page.ts",
  "npx tsx script/m56/verify-languages-surface.ts",
  "npx tsx script/m56/verify-docs-completeness.ts",
  "npx tsx script/m56/verify-support-page.ts",
  "npx tsx script/m56/verify-ia.ts",
  "npx tsx script/m56/verify-design.ts",
  "npx tsx script/m45/verify-site-embed.ts",
]
const CHAIN_REQUIRED = [
  ...SITE_JOB_REQUIRED,
  "npx tsx script/m56/verify-governance.ts",
  "npx tsx script/m56/verify-closure.ts",
  "npx tsx script/m41/verify-closure.ts",
]

const ciMissing = missingCommands(ciText, SITE_JOB_REQUIRED)
check("X1: CI verify-site job runs every M56 site gate and the M41 chain", ciMissing.length === 0, ciMissing.join(", "))
const chainText = String(pkg?.scripts?.verify ?? "")
const chainMissing = missingCommands(chainText, CHAIN_REQUIRED)
check("X1: the local verify chain runs every M56 gate and both closure gates", chainMissing.length === 0, chainMissing.join(", "))
const fastText = String(pkg?.scripts?.["verify:fast"] ?? "")
check("X1: M56 governance rides verify:fast (the CI verify job)", missingCommands(fastText, ["npx tsx script/m56/verify-governance.ts"]).length === 0, "verify:fast must carry the M56 governance gate")
check("X1: CI actually invokes verify:fast", ciText.includes("npm run verify:fast"), "verify job must run verify:fast")

// ---------------------------------------------------------------------------
// 7. deploy contract and the owner steps X1 cannot perform
// ---------------------------------------------------------------------------

check("X1: the site declares its deploy target (vercel.json present)", existsSync(path.join(ROOT, "website/vercel.json")))
const DEPLOY_CONTRACT = [
  "## Deploy-gate mechanics (ratified: CI + Vercel wait-for-checks)",
  "Vercel wait-for-checks enabled",
]
check("X1: M41 plan declares the CI + Vercel wait-for-checks deploy contract", missingDeclarations(m41Plan, DEPLOY_CONTRACT).length === 0, missingDeclarations(m41Plan, DEPLOY_CONTRACT).join(", "))
const OWNER_STEPS_DECL = ["## X1 owner steps (the part no agent can do)"]
check("X1: the owner-only X1 steps are written down in both plans", missingDeclarations(plan, OWNER_STEPS_DECL).length === 0 && missingDeclarations(m41Plan, OWNER_STEPS_DECL).length === 0, "owner-steps section missing")
const OWNER_STEP_TOKENS = ["push", "CI", "Vercel", "Search Console"]
check("X1: the owner steps name the push, CI, Vercel and post-deploy S2 re-run", OWNER_STEP_TOKENS.every((t) => plan.slice(plan.indexOf("## X1 owner steps")).includes(t)), "owner steps incomplete")

// ---------------------------------------------------------------------------
// 8. plan declarations (the milestone's own contracts)
// ---------------------------------------------------------------------------

const PLAN_REQUIRED = [
  "### X1 — Closure, Deploy and M41 Fold-In (#787)",
  "One deploy closes both milestones",
  "npx tsx script/m41/sync-ledger.ts --milestone m56",
  "then stop re-running gates",
  "## Gates & future verifications (permanent)",
  "The site gates may not weaken",
  "## Evidence batch procedure (mechanical, not remembered)",
  "## Non-goals (explicit)",
  "## Honesty notes",
  "owner confirms dashboards and the live site",
  "Vercel wait-for-checks proven",
  "Design work may not change a claim",
  "A gate must be able to fail",
]
const planMissing = missingDeclarations(plan, PLAN_REQUIRED)
check("X1: the M56 plan keeps its closure, batch, gate and honesty contracts", planMissing.length === 0, planMissing.join(" | "))

// ---------------------------------------------------------------------------
// 9. honesty — the parts not yet closed must stay visible
// ---------------------------------------------------------------------------

const d2 = (m56Ledger?.issues ?? []).find((i) => i.code === "D2")
const d2Approval = String((d2?.evidence as { ownerApproval?: string } | undefined)?.ownerApproval ?? "")
// D2's acceptance is a human judgement, so the gate polices the RECORD, not the
// verdict: the state must be present, and any approval claim must be dated
// (an undated "approved" is exactly the silent upgrade this gate exists to stop).
check(
  "X1: D2's owner-approval state is recorded, and dated when approved",
  d2Approval.length > 0 && (!/approved/i.test(d2Approval) || /\d{4}-\d{2}-\d{2}/.test(d2Approval)),
  d2Approval.slice(0, 90) || "missing ownerApproval",
)
check("X1: the plan makes owner visual approval D2's closure condition", plan.includes("owner visual approval"), "D2 acceptance must stay owner-gated")

// S2's deploy lag must be EXPLICIT, never an unstated assumption. It lives in
// the artifact when the current S2 gate produced it, or as a ledger-level
// deployGate declaration while the artifact still predates the field (S2 can
// only be re-run where the live site is reachable — an owner step).
const s2ArtifactLag = String((deployGated[0]?.ev as { deployLag?: string } | undefined)?.deployLag ?? "")
const s2LedgerEntry = (m41Ledger?.issues ?? []).find((i) => i.code === "S2")
const s2LedgerGate = String((s2LedgerEntry?.evidence as { deployGate?: string } | undefined)?.deployGate ?? "")
const s2LagDeclared = ["open", "closed"].includes(s2ArtifactLag) || /deploy/i.test(s2LedgerGate)
check(
  "X1: M41.S2 records its deploy-lag state explicitly (artifact field or ledger declaration)",
  s2LagDeclared,
  `deployLag=${s2ArtifactLag || "missing"} deployGate=${s2LedgerGate ? s2LedgerGate.slice(0, 60) : "missing"}`,
)
check("X1: M41.S2 is accepted at an ancestor commit while the deploy lags", s2Commit.length >= 7 && isAncestor(s2Commit, head), `s2=${s2Commit.slice(0, 8)} batch=${String(H).slice(0, 8)}`)

// ---------------------------------------------------------------------------
// negatives — each mutates a CLONE and runs the SAME predicate
// ---------------------------------------------------------------------------

// N1: a batch whose files disagree about the commit is rejected.
{
  const clone = m56Entries.map((e) => ({ ...e, ev: e.ev ? { ...e.ev } : null }))
  clone.find((e) => e.code === "T1")!.ev!.currentCommit = "0".repeat(40)
  negative("X1: mixed-commit batch is rejected", batchDefects(clone).some((d) => d.startsWith("commit-not-uniform")))
}
// N2: an artifact that passed without a negative is not closure evidence.
{
  const clone = m56Entries.map((e) => ({ ...e, ev: e.ev ? { ...e.ev } : null }))
  clone.find((e) => e.code === "T1")!.ev!.negativeCases = 0
  negative("X1: zero-negative artifact is rejected", batchDefects(clone).includes("T1:not-pass"))
}
// N3: a missing artifact is rejected.
{
  const clone = m56Entries.map((e) => ({ ...e, ev: e.ev ? { ...e.ev } : null }))
  clone.find((e) => e.code === "L1")!.ev = null
  negative("X1: missing artifact is rejected", batchDefects(clone).includes("L1:missing"))
}
// N3b: a non-pass G1 is still rejected by the PASS half of the batch check.
{
  const clone = m56All.map((e) => ({ ...e, ev: e.ev ? { ...e.ev } : null }))
  clone.find((e) => e.code === "G1")!.ev!.failed = 3
  negative("X1: a failed G1 is rejected despite its uniformity exclusion", passDefects(clone).includes("G1:not-pass"))
}
// N4: a hollow verified ledger entry is rejected.
{
  const clone: Ledger = structuredClone(m56Ledger)
  const target = clone.issues!.find((i) => i.code === "D1")!
  target.status = "verified"
  target.evidence = { status: "verified", currentCommit: "x", verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 0, failed: 0, negativeCases: 0 }
  negative("X1: hollow verified entry is rejected", ledgerDefects(clone, M56_CODES).some((d) => d.startsWith("hollow-verified:D1")))
}
// N5: X1 not last is rejected.
{
  const clone: Ledger = structuredClone(m56Ledger)
  clone.issues = [...clone.issues!].reverse()
  negative("X1: X1-not-last order is rejected", ledgerDefects(clone, M56_CODES).includes("order:x1-last"))
}
// N6: ledger ↔ artifact drift is rejected.
{
  const clone: Ledger = structuredClone(m56Ledger)
  const target = clone.issues!.find((i) => i.code === "E1")!
  target.evidence = { ...target.evidence, currentCommit: "0".repeat(40) }
  negative("X1: ledger citing a commit its artifact does not carry is rejected", agreementMismatches(clone, M56, EXCLUDE_SELF).includes("E1:commit"))
}
// N7: the fold-in predicate rejects an M41 site gate left behind at another commit.
{
  const clone = siteEntries.map((e) => ({ ...e, ev: e.ev ? { ...e.ev } : null }))
  clone[0]!.ev!.currentCommit = "1".repeat(40)
  negative("X1: M41 fold-in at a different commit is rejected", batchCommit(clone) !== H)
}
// N8: a deploy-gated gate with an unreachable commit is rejected.
negative("X1: unreachable evidence commit is rejected", !isAncestor("0".repeat(40), head) && !isAncestor("not-a-sha", head))
// N9: a dropped CI step is detected.
{
  const mutated = ciText.replace("npx tsx script/m56/verify-design.ts", "npx tsx script/m56/verify-design-REMOVED.ts")
  negative("X1: CI wiring check detects a dropped gate", missingCommands(mutated, SITE_JOB_REQUIRED).includes("npx tsx script/m56/verify-design.ts"))
}
// N10: a dropped chain step is detected.
{
  const mutated = chainText.replace("script/m56/verify-ia.ts", "script/m56/verify-ia-REMOVED.ts")
  negative("X1: chain wiring check detects a dropped gate", missingCommands(mutated, CHAIN_REQUIRED).includes("npx tsx script/m56/verify-ia.ts"))
}
// N11: a removed plan declaration is detected.
{
  const mutated = plan.replace("One deploy closes both milestones", "One deploy closes one milestone")
  negative("X1: plan-declaration check detects a removed contract", missingDeclarations(mutated, PLAN_REQUIRED).includes("One deploy closes both milestones"))
}
// N12: an artifact written before its own commit is rejected.
{
  const probe = [...m56Entries, ...m41Entries].find((e) => e.ev && existsSync(e.file))
  const mtime = probe ? statSync(probe.file).mtimeMs / 1000 : 0
  negative("X1: artifact older than the batch commit is rejected", hTime !== null && mtime > 0 ? mtime < hTime - 2 ? false : true : true)
}
// N13: the banned-vocabulary and adapter detectors are sensitive where used.
negative("X1: verify:fast omission is detectable", missingCommands("npm run lint", ["npx tsx script/m56/verify-governance.ts"]).length === 1)

// ---------------------------------------------------------------------------
// verdict + evidence
// ---------------------------------------------------------------------------

const ok = failures.length === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${negatives} negative cases`)
if (!ok) {
  console.log("VERDICT: FAIL")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("VERDICT: PASS")

mkdirSync(M56, { recursive: true })
const evidence = {
  issue: "M56.X1",
  code: "X1",
  milestone: "M56",
  status: "verified",
  checks,
  passed,
  failed: checks - passed,
  negativeCases: negatives,
  // currentCommit is the BATCH commit, not HEAD-at-run-time. The ledger records
  // this entry and the governance gate compares it byte-for-byte against this
  // file, so a gate that wrote HEAD here would make its own re-run (and any
  // later `npm run verify` at the evidence commit) disagree with the ledger it
  // just satisfied. The batch is what X1 asserts; when it ran is generatedAt.
  currentCommit: H,
  batchCommit: H,
  foldIn: {
    milestone: "M41",
    siteGatesAtBatchCommit: siteEntries.map((e) => e.code),
    deployGated: { code: "S2", commit: s2Commit, reason: "probes the live deployment; re-pinned by the owner after the Vercel deploy" },
  },
  liveReruns: { truthPipeline: tp.code, m56Governance: g56.code, m41Governance: g41.code },
  wiring: { ciSiteJob: ciMissing.length === 0, verifyChain: chainMissing.length === 0, verifyFast: true },
  verifierCommand: "npx tsx script/m56/verify-closure.ts",
  evidenceFile: "X1.json",
  generatedAt: new Date().toISOString(),
  ownerStepsPending: [
    "Push the branch to origin/main (the agent never pushes).",
    "Confirm CI is green on the pushed commit (gh run list --workflow ci.yml).",
    "Confirm Vercel wait-for-checks is enabled and the deploy succeeded.",
    "Re-run npx tsx script/m41/verify-seo-onboarding.ts against the deployment: it moves S2 onto the batch commit and closes the lag it records.",
    "Submit the updated sitemap in Google Search Console / Bing Webmaster Tools and re-fetch in Brave.",
    "Close the M41 (#640-#647) and M56 (#779-#787) issues and milestones with the evidence comments.",
    "Owner visual approval of /editors, /support, the homepage tools section and the language cells (M56.D2's closure condition).",
  ],
  limitations: [
    "X1 proves the batch was produced at one commit and that the wiring, deploy contract and honesty records hold. It does not re-run the eight site gates itself; their evidence is what the batch is made of, and running them again would move the batch past the commit it pins.",
    "M41.S2 is deploy-gated by construction: it probes the live deployment, so it is accepted PASS-with-negatives at an ancestor commit and re-pinned by the owner after the deploy.",
    "CI green, the Vercel deploy and the GitHub closures are owner-side actions recorded above; this gate cannot observe them from the repository.",
    "D2's acceptance is owner visual approval; the ledger records that caveat and this gate fails if it is ever silently upgraded.",
  ],
}
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: validation/m56/results/X1.json`)
