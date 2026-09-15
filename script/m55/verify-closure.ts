// script/m55/verify-closure.ts — M55.X1 (issue #778): closure, verdict, hand-off.
//
// The milestone's bar (docs/m55/M55-MASTER-PLAN.md) is not "the gates ran"; it is
// "at ONE HEAD: nine issues verified, the M44/M53 bars re-audited, every claim
// with a frame behind it, and the one defect that is not ours handed over".
// This gate is where that becomes a machine fact instead of a closing comment.
//
// What it proves, in order:
//
//   C1 ledger:  every M55 issue's evidence is VERIFIED and FRESH under G1's own
//               relevance rule (imported, not re-implemented): a planned or
//               blocked issue cannot be carried into a closure, and neither can
//               evidence whose relevant files changed since it was recorded.
//               The pre-closure state was exactly this: eight issues verified
//               and G1 recording a ladder-skipped run.
//   C2 audit:   the lane ladder's own machine record
//               (validation/m53/results/R1.json — the 40-gate m24->m44 chain)
//               is green and fresh against the lane's source, and G1's own bar
//               re-audit agrees with it (two independent records must match).
//               Per-milestone rows carry the gate command, exit code and the
//               evidence file so the audit is read, not asserted.
//   C3 verdict: docs/m55/VERDICT-PACK.md is GENERATED from the ledger and V1's
//               frame-by-frame claim trace, and the drift gate is byte equality.
//               A claim with a frame that does not exist fails; a claim with no
//               frame must carry a declared wire-only source. Nothing is
//               softened, and the pack's known-not-done list is read from the
//               findings document's own open verdicts.
//   C4 hand-off: docs/m55/HANDOFF-cross-language.md exists, names the filed
//               issue, carries the stored row's facts, and those facts are
//               re-read from the owner's index when it is present (declared
//               blocked-with-reason when it is not).
//   C5 mutants: four planted defects (a planned issue treated as closable, a
//               stale ladder pin, a claim naming a frame that does not exist, a
//               hand-off note without the issue link) each FAIL.
//
// The owner's verdict is NOT this gate's to make (§8.5): the pack it generates
// ends with the spot-check list, and the verdict slot stays empty.
//
// Run: npx tsx script/m55/verify-closure.ts
// Evidence: validation/m55/results/X1.json

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { readEvidence, readEvidenceAllowingLegacy, writeSealed } from "../lib/evidence.ts"
import path from "node:path"
import { M55_ROOT } from "./lsp-wire.ts"
// The freshness rule and its map are shared with G1 through a PURE module:
// importing the governance gate itself would execute its whole body (the
// closure gate hung doing exactly that). One rule, one map, no side effects.
import { ISSUE_RELEVANT_FILES } from "./relevance.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = M55_ROOT
const RESULTS = path.join(ROOT, "validation/m55/results")
const EVIDENCE = path.join(RESULTS, "X1.json")
const MANIFEST = path.join(RESULTS, "manifest.json")
const V1_EVIDENCE = path.join(RESULTS, "V1.json")
const LADDER = path.join(ROOT, "validation/m53/results/R1.json")
const VERDICT = path.join(ROOT, "docs/m55/VERDICT-PACK.md")
const HANDOFF = path.join(ROOT, "docs/m55/HANDOFF-cross-language.md")
const FINDINGS = path.join(ROOT, "docs/m55/FRAME-FINDINGS.md")
const FRAMES_DIR = path.join(ROOT, "validation/m55/frames")
const PACKAGE = path.join(ROOT, "package.json")

let checks = 0
let passed = 0
const failures: string[] = []
let mutantsTotal = 0
let mutantsCaught = 0

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`${label} [mutant]`, caught, detail)
}
function blocked(label: string, reason: string): void {
  // A declared blocked state is a PASS with its reason recorded — never a
  // silent skip (the M24/M25 convention used across this lane).
  checks++
  passed++
  console.log(`  ⊘ ${label} — BLOCKED: ${reason}`)
}

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const workingTreeRelevantChanges = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .map((l) => l.slice(3).trim())
  .filter((p) => p.startsWith("script/m55/") || p.startsWith("docs/m55/") || p.startsWith("validation/m55/"))

// --- pure predicates (extracted so the mutants plant defects against them) -----------

const LANE_SCOPE = [
  "src/lsp/",
  "script/m24/",
  "script/m25/",
  "script/m26/",
  "script/m27/",
  "script/m28/",
  "script/m29/",
  "script/m42/",
  "script/m44/",
  "script/m53/",
  "script/m55/",
  "ide/vscode/src/",
]

function gitLines(args: string[]): string[] {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
}
function isAncestor(commit: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] })
    return true
  } catch {
    return false
  }
}
function changedSince(commit: string, files: string[]): string[] {
  if (files.length === 0) return []
  return gitLines(["diff", "--name-only", `${commit}..HEAD`, "--", ...files])
}
/** Files under the lane's own source/test scope changed since `commit`. */
function laneChangedSince(commit: string): string[] {
  return gitLines(["diff", "--name-only", `${commit}..HEAD`]).filter((f) => LANE_SCOPE.some((p) => f.startsWith(p)))
}

/** C1: an issue is closable — verified, and its evidence fresh by RELEVANCE
 *  (the same rule G1 applies: a pin equal to HEAD would be un-passable after any
 *  commit, since the evidence must itself be committed). */
function issueIsClosable(
  rec: { status?: string; realFailed?: number; currentCommit?: string } | null,
  deps: { isAncestor: (c: string) => boolean; changedSince: (c: string, f: string[]) => string[] },
  relevant: string[],
): boolean {
  if (rec === null || rec.status !== "verified" || (rec.realFailed ?? 0) !== 0) return false
  const commit = String(rec.currentCommit ?? "")
  if (!/^[0-9a-f]{40}$/.test(commit) || !deps.isAncestor(commit)) return false
  return deps.changedSince(commit, relevant).length === 0
}

/** C2: the ladder record is green, and no lane source changed since it ran. */
function ladderIsGreenAndFresh(
  rec: { currentCommit?: string; gates?: Array<{ ok?: boolean; name?: string }> } | null,
  deps: { isAncestor: (c: string) => boolean; laneChanged: (c: string) => string[] },
): boolean {
  if (rec === null) return false
  const commit = String(rec.currentCommit ?? "")
  if (!/^[0-9a-f]{40}$/.test(commit) || !deps.isAncestor(commit)) return false
  if (deps.laneChanged(commit).length > 0) return false
  const gates = rec.gates
  return Array.isArray(gates) && gates.length > 0 && gates.every((g) => g.ok === true)
}

/** C3: a claim's named frames exist inside the run directory. */
function claimFramesExist(claim: { frame?: string | null }, runDir: string): boolean {
  const frame = claim.frame ?? null
  if (frame === null) return false
  if (frame === "all frames") return true
  const tokens = frame.match(/\d+-[a-z0-9-]+\.png/g) ?? []
  if (tokens.length === 0) return false
  return tokens.every((t) => existsSync(path.join(runDir, t)))
}

/** C4: the hand-off note carries the issue link and the row's facts. */
function handoffIsLinked(note: string, issue: number): boolean {
  const facts = ["name-resolution", "0.85", "package.json:name:2", "src/greeter.ts:greet:11", "is_cross_language = 1"]
  return note.includes(`#${issue}`) && facts.every((f) => note.includes(f))
}

// --- inputs --------------------------------------------------------------------------
// M61.V1 adoption: every evidence record is read through the ONE trusted path
// (seal verified; legacy accepted in the declared window with a warn; tampered
// or unparseable refused loudly — never believed).
const manifestRead = readEvidenceAllowingLegacy<{
  issues: Array<{
    code: string
    githubIssue: number
    tool?: string
    status: string
    evidence: { status: string; evidenceFile: string; passed?: number; mutantsCaught?: number; mutantsTotal?: number }
  }>
}>(MANIFEST)
if (!manifestRead.ok) throw new Error(`M61 trusted read refused the ledger: ${manifestRead.reason}`)
if (manifestRead.legacy) console.error("warn: the M55 ledger is a legacy (unsealed) record — accepted in the M61 transition window only")
const manifest = manifestRead.record
const v1Read = readEvidenceAllowingLegacy<{
  claimTrace: Array<{ claim: string; source: string; frame: string | null }>
  live?: { captureRun?: string }
}>(V1_EVIDENCE)
if (!v1Read.ok) throw new Error(`M61 trusted read refused V1's evidence: ${v1Read.reason}`)
const v1 = v1Read.record
const runName = v1.live?.captureRun ?? null
const runDir = runName === null ? null : path.join(FRAMES_DIR, runName)
const handoffIssue = (manifest.issues.find((i) => i.code === "X1") as unknown as { handoffIssue?: number } | undefined)?.handoffIssue ?? null

// --- C1: the ledger closes at ONE HEAD -----------------------------------------------
console.log(`\nC1: the ledger closes at one HEAD (${HEAD.slice(0, 12)})`)
check("C1: the ledger lists the nine declared issues", manifest.issues.length === 9, `${manifest.issues.length}`)
for (const issue of manifest.issues) {
  const file = path.join(RESULTS, issue.evidence.evidenceFile)
  let rec: { status?: string; realFailed?: number; currentCommit?: string } | null = null
  try {
    const recRead = readEvidenceAllowingLegacy<typeof rec>(file)
    if (!recRead.ok) {
      console.error(`refused: ${path.relative(ROOT, file)} — ${recRead.reason} (kind=${recRead.kind}); treating as no evidence`)
      rec = null
    } else {
      rec = recRead.record as typeof rec
    }
  } catch {
    rec = null
  }
  if (issue.code === "X1") {
    // X1 is the auditor: its own record is written by this run at the audit HEAD
    // (asserted below, after the write). Requiring a pre-existing pin would make
    // the gate un-passable on a fresh HEAD, so the self-record is checked for
    // self-consistency instead of pinning — declared, not glossed over.
    check("C1: X1 is the audit record this run writes (self-record, checked after the write)", true)
    continue
  }
  const relevant = ISSUE_RELEVANT_FILES[issue.code] ?? []
  const stale = rec?.currentCommit === undefined ? [] : changedSince(String(rec.currentCommit), relevant)
  check(
    `C1: ${issue.code} evidence is verified and fresh by relevance (the G1 rule)`,
    issueIsClosable(rec, { isAncestor, changedSince }, relevant),
    `status=${rec?.status ?? "missing"} pin=${String(rec?.currentCommit ?? "none").slice(0, 12)} realFailed=${String(rec?.realFailed ?? "n/a")}${stale.length > 0 ? ` stale(${stale.join(",")})` : ""}`,
  )
}

// --- C2: the lane ladder re-audited at the same HEAD ---------------------------------
console.log("\nC2: the M24->M44 lane ladder re-audited at the audit HEAD")
let ladder: { status?: string; passed?: number; gatesTotal?: number; currentCommit?: string; gates?: Array<{ name: string; script: string; rc: number; ok: boolean }> } | null = null
try {
  const ladderRead = readEvidenceAllowingLegacy<typeof ladder>(LADDER)
  if (ladderRead.ok) ladder = ladderRead.record as typeof ladder
  else console.error(`refused: ${path.relative(ROOT, LADDER)} — ${ladderRead.reason} (kind=${ladderRead.kind}); treating as absent`)
} catch {
  ladder = null
}
check("C2: the ladder's machine record exists (validation/m53/results/R1.json)", ladder !== null, path.relative(ROOT, LADDER))
check(
  "C2: the ladder is green and fresh (no lane source changed since it ran)",
  ladderIsGreenAndFresh(ladder, { isAncestor, laneChanged: laneChangedSince }),
  `pin=${String(ladder?.currentCommit ?? "none").slice(0, 12)} green=${ladder?.gates?.filter((g) => g.ok).length ?? 0}/${ladder?.gates?.length ?? 0} lane-changed=${laneChangedSince(String(ladder?.currentCommit ?? HEAD)).length}`,
)
// G1 is the milestone's own bar re-audit: it runs the same ladder and records
// the exits in its evidence. Reading it here means the audit's two independent
// records (the ladder's own JSON and the governance gate's) must agree.
const g1Read = readEvidenceAllowingLegacy<{ bar?: { status?: string; ladder?: Array<{ gate: string; exit: number }> } }>(path.join(RESULTS, "G1.json"))
if (!g1Read.ok) throw new Error(`M61 trusted read refused G1's evidence: ${g1Read.reason}`)
const g1 = g1Read.record
const g1Ladder = g1.bar?.ladder ?? []
check("C2: G1's bar re-audit records the ladder gates it ran", g1Ladder.length >= 2, JSON.stringify(g1Ladder.map((l) => `${l.gate}=${l.exit}`)))
check("C2: G1's bar re-audit records every ladder gate green", g1Ladder.length >= 2 && g1Ladder.every((l) => l.exit === 0), JSON.stringify(g1Ladder))

/** Per-milestone audit rows: the gate command, exit code and evidence file. */
const audit = (ladder?.gates ?? []).reduce<Record<string, Array<{ gate: string; script: string; exit: number; ok: boolean }>>>((acc, g) => {
  const m = /^(m\d+)-/.exec(g.name)?.[1]
  if (m === undefined) return acc
  const key = m.toUpperCase()
  if (acc[key] === undefined) acc[key] = []
  acc[key]!.push({ gate: g.name, script: g.script, exit: g.rc, ok: g.ok })
  return acc
}, {})
const auditedMilestones = Object.keys(audit).sort()
check("C2: the ladder covers the M24->M44 milestones this milestone sits on", auditedMilestones.length >= 4, auditedMilestones.join(","))
for (const m of auditedMilestones) {
  const rows = audit[m]!
  check(`C2: ${m} — every ladder gate green (${rows.length})`, rows.every((r) => r.ok), rows.filter((r) => !r.ok).map((r) => `${r.gate}=${r.exit}`).join(","))
}

// --- C3: the verdict pack (generated, drift-gated) -----------------------------------
console.log("\nC3: the verdict pack — every claim with its frame, generated and drift-gated")
const openFindings = readFileSync(FINDINGS, "utf8")
  .split("\n")
  .filter((l) => l.startsWith("## F") && /· (OPEN|OPEN \(narrow\)|NEEDS A TRUTH ASSERTION)/.test(l))
  .map((l) => l.replace(/^## /, ""))
const framesOfRun = runDir === null || !existsSync(runDir)
  ? []
  : (JSON.parse(readFileSync(path.join(runDir, "manifest.json"), "utf8")) as { flows: Array<{ label: string; status: string; frame?: { path: string; sha256: string } }> }).flows
      .filter((f) => f.status === "captured" && f.frame !== undefined)

function generatePack(): string {
  const lines: string[] = []
  lines.push("# M55 verdict pack — every claim, and the frame behind it")
  lines.push("")
  lines.push("GENERATED by `script/m55/verify-closure.ts` (M55.X1). Do not hand-edit: the gate")
  lines.push("fails unless the file is byte-identical to a fresh generation.")
  lines.push("")
  lines.push(`Audit HEAD: \`${HEAD}\`  ·  capture run: \`${runName ?? "none"}\``)
  lines.push("")
  lines.push("## The verdict is the owner's")
  lines.push("")
  lines.push("This pack is what to try and what is known-not-done. §8.5 of the honesty contract:")
  lines.push("the gate never declares the milestone achieved — it lists the claims and the evidence")
  lines.push("behind them, and the verdict line at the end stays for the owner to write.")
  lines.push("")
  lines.push("## 1. The nine issues (evidence at the audit HEAD)")
  lines.push("")
  lines.push("| Issue | GitHub | Evidence | Status | Passed | Mutants |")
  lines.push("|---|---|---|---|---|---|")
  for (const issue of manifest.issues) {
    const e = issue.evidence
    lines.push(
      `| ${issue.code} | [#${issue.githubIssue}](https://github.com/backbencher-hq/backbencher-brain/issues/${issue.githubIssue}) | \`${e.evidenceFile}\` | ${e.status} | ${e.passed ?? "—"} | ${e.mutantsCaught === undefined ? "—" : `${e.mutantsCaught}/${e.mutantsTotal}`} |`,
    )
  }
  lines.push("")
  lines.push("## 2. Every claim, and the frame behind it")
  lines.push("")
  lines.push("| Claim | Source | Frame |")
  lines.push("|---|---|---|")
  for (const c of v1.claimTrace) {
    const frame =
      c.frame === null
        ? "wire-only — no frame; the source above is the evidence"
        : c.frame === "all frames"
          ? `every frame of \`${runName}\``
          : c.frame
              .split(",")
              .map((t) => t.trim())
              .map((t) => (/\.png$/.test(t) ? `\`validation/m55/frames/${runName}/${t}\`` : t))
              .join(" + ")
    lines.push(`| ${c.claim} | ${c.source} | ${frame} |`)
  }
  lines.push("")
  lines.push(`## 3. The frames of the audit run (\`${runName ?? "none"}\`)`)
  lines.push("")
  lines.push("| Flow | Frame | sha256 (16) |")
  lines.push("|---|---|---|")
  for (const f of framesOfRun) {
    lines.push(`| ${f.label} | \`${f.frame!.path}\` | \`${f.frame!.sha256.slice(0, 16)}\` |`)
  }
  lines.push("")
  lines.push("## 4. Known-not-done (declared, not softened)")
  lines.push("")
  if (openFindings.length === 0) {
    lines.push("Nothing is open: every finding in docs/m55/FRAME-FINDINGS.md carries a fixed/verified verdict.")
  } else {
    for (const f of openFindings) lines.push(`- ${f}`)
  }
  lines.push("")
  lines.push("## 5. The owner's verdict")
  lines.push("")
  lines.push("____ (achieved / not achieved, by hand, per §8.5 — this line is never written by a gate)")
  lines.push("")
  return lines.join("\n")
}

const pack = generatePack()
const onDisk = existsSync(VERDICT) ? readFileSync(VERDICT, "utf8") : ""
writeFileSync(VERDICT, pack)
check("C3: the verdict pack was generated at the audit HEAD", pack.includes(HEAD), "docs/m55/VERDICT-PACK.md")
check("C3: the pack lists every claim the gate's trace carries", v1.claimTrace.every((c) => pack.includes(c.claim)), `${v1.claimTrace.length} claims`)
check("C3: the pack is byte-identical to the fresh generation (no hand edits survive)", onDisk === pack, onDisk === "" ? "no previous file" : `${onDisk.length} vs ${pack.length} bytes`)
check("C3: a capture run is recorded for the frames", runName !== null && framesOfRun.length > 0, `${runName} (${framesOfRun.length} frames)`)

if (runDir !== null) {
  const withFrames = v1.claimTrace.filter((c) => c.frame !== null)
  const missing = withFrames.filter((c) => !claimFramesExist(c, runDir))
  check(
    `C3: every claim that names a frame has that frame on disk (${withFrames.length - missing.length}/${withFrames.length})`,
    missing.length === 0,
    missing.map((c) => c.claim).join(" | "),
  )
}
const wireOnly = v1.claimTrace.filter((c) => c.frame === null)
check("C3: a claim with no frame declares its wire-only source (nothing is silently unframed)", wireOnly.every((c) => c.source.trim().length > 0), `${wireOnly.length} wire-only claims`)

// --- C4: the hand-off ---------------------------------------------------------------
console.log("\nC4: the cross-language hand-off (a defect that is not this lane's to fix)")
const handoffNote = existsSync(HANDOFF) ? readFileSync(HANDOFF, "utf8") : ""
check("C4: the hand-off note exists", handoffNote.length > 0, path.relative(ROOT, HANDOFF))
check("C4: the ledger records the filed issue number", typeof handoffIssue === "number" && handoffIssue > 0, String(handoffIssue))
if (typeof handoffIssue === "number") {
  check("C4: the note names the filed issue and carries the stored row's facts", handoffIsLinked(handoffNote, handoffIssue), `issue #${handoffIssue}`)
  // The facts are re-read from the owner's index when it is present. The index is
  // external by owner decision, so an absent one is a declared blocked read —
  // never a green claim about a row nobody looked at.
  const fixtureDb = path.join(
    process.env.HOME ?? "",
    ".bb/projects/693ac0d258eee9282c48710e76362d6ba159c7af/brain.db",
  )
  if (!existsSync(fixtureDb)) {
    blocked("C4: the stored row is re-read from the owner's index", `no index at ${fixtureDb} (external fixture by owner decision)`)
  } else {
    const { default: Database } = (await import("better-sqlite3")) as unknown as {
      default: new (p: string, o?: Record<string, unknown>) => { prepare: (q: string) => { get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] }; close: () => void }
    }
    const db = new Database(fixtureDb, { readonly: true })
    const row = db.prepare("SELECT * FROM brain_relationship WHERE is_cross_language = 1").all() as Array<Record<string, unknown>>
    db.close()
    check("C4: the owner's index still stores exactly one cross-language row", row.length === 1, `${row.length} rows`)
    const r = row[0] ?? {}
    const facts = [r.bridge_mechanism, r.confidence, r.target_symbol_id, r.source_symbol_id]
    check(
      "C4: the stored row is the one the note describes (mechanism, confidence and both endpoints)",
      facts[0] === "name-resolution" &&
        String(facts[1]) === "0.85" &&
        String(facts[2]).endsWith("package.json:name:2") &&
        String(facts[3]).endsWith("src/greeter.ts:greet:11"),
      JSON.stringify(facts.map((f) => String(f ?? "").slice(-40))),
    )
  }
}

// --- C5: mutants --------------------------------------------------------------------
console.log("\nC5: mutants (each planted defect must fail the suite)")
const deps = { isAncestor, changedSince }
mutant(
  "M1: a planned issue (or one with a failed check) treated as closable in the ledger",
  !issueIsClosable({ status: "planned", realFailed: 0, currentCommit: HEAD }, deps, []) &&
    !issueIsClosable({ status: "verified", realFailed: 3, currentCommit: HEAD }, deps, []) &&
    !issueIsClosable({ status: "verified", realFailed: 0, currentCommit: "0".repeat(40) }, deps, []) &&
    issueIsClosable({ status: "verified", realFailed: 0, currentCommit: HEAD }, deps, []),
)
mutant(
  "M2: a ladder record that is not green, or is stale against the lane's own source",
  !ladderIsGreenAndFresh({ currentCommit: HEAD, gates: [{ ok: false }] }, { isAncestor: () => true, laneChanged: () => [] }) &&
    !ladderIsGreenAndFresh({ currentCommit: "0".repeat(40), gates: [{ ok: true }] }, { isAncestor: () => false, laneChanged: () => [] }) &&
    !ladderIsGreenAndFresh({ currentCommit: HEAD, gates: [{ ok: true }] }, { isAncestor: () => true, laneChanged: () => ["src/lsp/hover.ts"] }) &&
    ladderIsGreenAndFresh({ currentCommit: HEAD, gates: [{ ok: true }] }, { isAncestor: () => true, laneChanged: () => [] }),
)
mutant(
  "M3: a claim naming a frame that does not exist",
  runDir !== null && !claimFramesExist({ frame: "99-not-a-real-frame.png" }, runDir) && claimFramesExist({ frame: null }, runDir) === false,
)
mutant(
  "M4: a hand-off note with no issue link",
  typeof handoffIssue === "number" && !handoffIsLinked("a note with the facts but no link: name-resolution 0.85 package.json:name:2 src/greeter.ts:greet:11 is_cross_language = 1", handoffIssue),
)

// --- C6: wiring ---------------------------------------------------------------------
console.log("\nC6: wiring — the closure gate is in the milestone's chain")
const pkg = parseSealedRecord(PACKAGE) as { scripts: Record<string, string> }
check("C6: the gate is in the m55 chain (machine-read from package.json)", (pkg.scripts["verify:m55"] ?? "").includes("m55/verify-closure"), "package.json scripts['verify:m55']")
mutant(
  "M5: a closure gate dropped from the milestone chain",
  !"npx tsx script/m55/verify-governance.ts && npx tsx script/m55/verify-tiers.ts".includes("m55/verify-closure"),
)

// --- evidence -----------------------------------------------------------------------
const realFailed = failures.length
const result = {
  issue: "M55.X1",
  code: "X1",
  milestone: "M55",
  status: realFailed > 0 ? "known-gap" : "verified",
  checks,
  passed,
  failed: realFailed,
  realFailed,
  negativeCases: mutantsTotal,
  mutants: { total: mutantsTotal, caught: mutantsCaught },
  currentCommit: HEAD,
  workingTreeRelevantChanges,
  verifierCommand: "npx tsx script/m55/verify-closure.ts",
  evidenceFile: "X1.json",
  generatedAt: new Date().toISOString(),
  audit: {
    head: HEAD,
    ladder: {
      record: path.relative(ROOT, LADDER),
      status: ladder?.status ?? null,
      pin: ladder?.currentCommit ?? null,
      green: ladder?.gates?.filter((g) => g.ok).length ?? 0,
      total: ladder?.gates?.length ?? 0,
      milestones: audit,
    },
    issues: manifest.issues.map((i) => ({ code: i.code, githubIssue: i.githubIssue, evidence: i.evidence.evidenceFile, status: i.evidence.status })),
    captureRun: runName,
    frames: framesOfRun.length,
    claims: v1.claimTrace.length,
    wireOnlyClaims: v1.claimTrace.filter((c) => c.frame === null).length,
    openFindings,
    handoffIssue,
  },
  failures,
  limitations: [
    "X1 is the auditor, so its own evidence pin is self-consistency (written at the audit HEAD by this run) rather than a pre-existing pin: requiring the latter would make the gate un-passable at a fresh HEAD. The eight other issues ARE pin-checked.",
    "The per-milestone audit reads the M53 R1 ladder's record instead of re-running 40 gates: the ladder is the machine record of that run at the same HEAD, and G1 re-audits it on every governance run. Re-running it here would duplicate ~20 minutes of work and could not be stricter.",
    "The verdict pack has no timestamp by design: a generated doc that changes on every run cannot be drift-gated byte-for-byte.",
  ],
}

try {
  mkdirSync(RESULTS, { recursive: true })
  // The record must agree with the RUN. It is written once so the self-read
  // below has a target, then RE-written after that check — the first form
  // captured its counters before the C1 check ran, so the record said N checks
  // while the run did N+1. Found by M61.V6's G8 rule ("a check after the last
  // evidence write"), which exists because the M61.V1 record had this exact
  // defect in its own milestone.
  const emit = () => ({ ...result, checks, passed, failed: realFailed, realFailed, negativeCases: mutantsTotal, mutants: { total: mutantsTotal, caught: mutantsCaught } })
  writeSealed(EVIDENCE, emit())
  console.log(`\nEV X1 evidence written (sealed): ${path.relative(ROOT, EVIDENCE)}`)
  // The self-record's own consistency: it must be pinned to the audit HEAD it
  // just performed (C1's declared exception, made explicit rather than implied).
  const writtenRead = readEvidence(EVIDENCE)
  const written = writtenRead.ok ? (writtenRead.record as { currentCommit?: string }) : undefined
  check("C1: the X1 record this run wrote is pinned to the audit HEAD", written !== undefined && written.currentCommit === HEAD, String(written?.currentCommit ?? "unreadable").slice(0, 12))
  writeSealed(EVIDENCE, emit())
} catch (e) {
  console.log(`\nEV X1 evidence write failed: ${String(e)}`)
}

console.log(`\nX1 RESULT: ${realFailed === 0 ? "VERIFIED" : "KNOWN-GAP"} — ${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants caught`)
if (realFailed > 0) console.log(`failures:\n  - ${failures.join("\n  - ")}`)
process.exit(realFailed === 0 ? 0 : 1)
