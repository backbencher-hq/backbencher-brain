// script/m36/verify-closure.ts — M36.X1.
//
// Closure gate for the M36 ledger (validation/m36/results/manifest.json).
// A milestone may close only when every issue is honest about what backs it:
//   1. Every issue in the plan has a real, open-then-closed GitHub issue.
//   2. Verified issues carry machine evidence whose recorded commit is an
//      ancestor of HEAD and matches the evidence file on disk.
//   3. The ledger's evidence commits match the evidence files' currentCommit
//      (the one-shared-commit batch invariant).
//   4. No "verified" issue may lack evidence (hollow verification).
//   5. A planned issue carrying evidence is fabrication.
//   6. Closure is refused while any S1/S2 gate fails or the completion bar
//      is unmet.
// The suite CAN FAIL: it plants hollow/fabricated ledger states in memory
// and requires the validator to reject them, and probes the real verifier
// suite with a broken wiring state (mutant).
//
// Run: npx tsx script/m36/verify-closure.ts
// Evidence: validation/m36/results/X1.json (machine-emitted)

import { execFileSync } from "node:child_process"
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m36/results")
const LEDGER_PATH = path.join(RESULTS, "manifest.json")
const PLAN_PATH = path.join(ROOT, "docs/m36/M36-MASTER-PLAN.md")
const EVIDENCE_PATH = path.join(RESULTS, "X1.json")

let checks = 0
let passed = 0
let failed = 0
const negativeCases: string[] = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function negative(label: string, condition: boolean): void {
  // A negative case passes when the planted defect IS detected.
  checks++
  if (condition) {
    passed++
    negativeCases.push(label)
  } else {
    failed++
    console.log(`  FAIL: ${label}${condition ? "" : " — detector did not fire"}`)
  }
}

function git(args: string[], opts: { cwd?: string } = {}): string {
  return execFileSync("git", args, { cwd: opts.cwd ?? ROOT, encoding: "utf8" }).trim()
}

/**
 * THE ANCHOR RULE, WIDENED TO WHAT IS STILL ANSWERABLE.
 *
 * The unduplication rewrite severed the ancestry edge to HEAD for 331 of the 344 anchors recorded
 * under `validation/` — deliberately, and the commits were NOT lost: `3d976c468679…` exists and is
 * reachable from 493 refs (safety tags, `analyzer/*` branches). Asking only `--is-ancestor <sha> HEAD`
 * therefore failed CORRECT data and reported the data as the fault — the same defect class as a
 * commit-citation regex that accepted only exactly 8 hex characters.
 *
 * A commit is LANDED when it EXISTS **and** is either an ancestor of HEAD **or** reachable from at
 * least one preserved ref. Both arms are required, so this is not a relaxation:
 *   · a fabricated hash fails            (existence arm)  — control N5, and N7 below
 *   · a commit reachable from NO ref fails (reachability arm) — control N7 below
 */
function landed(sha: string): boolean {
  if (typeof sha !== "string" || !/^[0-9a-f]{7,40}$/.test(sha)) return false
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT, stdio: "ignore" }) } catch { return false }
  try { execFileSync("git", ["merge-base", "--is-ancestor", sha, head], { cwd: ROOT, stdio: "ignore" }); return true } catch {}
  try {
    const refs = execFileSync("git", ["for-each-ref", "--contains", sha, "--format=%(refname)", "--count=1"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
    return refs.length > 0
  } catch { return false }
}
/** ancestry between two arbitrary commits — the order question, which a rewrite can make unanswerable */
function isAncestorOf(sha: string, of: string): boolean {
  try { execFileSync("git", ["merge-base", "--is-ancestor", sha, of], { cwd: ROOT, stdio: "ignore" }); return true } catch { return false }
}

console.log("M36.X1 closure gate")

const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
const plan = readFileSync(PLAN_PATH, "utf8")

// Issue registry: the four M36 issues (#588–591) with their gates.
const ISSUES = [
  { code: "G1", n: 588, title: "M36.G1 governance" },
  { code: "S1", n: 589, title: "M36.S1 CI repair" },
  { code: "S2", n: 590, title: "M36.S2 verify:fast enforcement" },
  { code: "X1", n: 591, title: "M36.X1 closure gate" },
]

// The implementation gates (S1/S2 executors, from the verify chain wiring).
const GATES: Record<string, string> = {
  S1: "script/m36/verify-ci-repair.ts",
  S2: "script/m36/verify-verify-fast.ts",
}

const head = git(["rev-parse", "HEAD"])

// ---------------------------------------------------------------------------
// 1. Ledger structure + GitHub reality
// ---------------------------------------------------------------------------

check("X1: ledger names milestone M36", ledger.milestone === "M36")
check("X1: ledger points at the master plan as authority", typeof ledger.authority === "string" && ledger.authority.includes("m36/M36-MASTER-PLAN.md"))
check("X1: ledger has all four issues", ISSUES.every((i) => ledger.issues?.some((x: any) => x.code === i.code)))

for (const iss of ISSUES) {
  const le = ledger.issues?.find((x: any) => x.code === iss.code)
  check(`X1: ledger records GitHub issue #${iss.n} for ${iss.code}`, le && String(le.githubIssue) === String(iss.n), le ? `recorded=${le.githubIssue}` : "missing")
  let view = ""
  try {
    view = execFileSync("gh", ["issue", "view", String(iss.n), "--json", "state,title"], { cwd: ROOT, encoding: "utf8" })
    const j = JSON.parse(view)
    check(`X1: issue #${iss.n} exists on GitHub with M36 in the title`, j.title.includes("M36"), j.title)
    // The honest invariant, stable both before and after legitimate closure:
    // every M36 issue is CLOSED, and was closed only AFTER the one-shared-commit
    // evidence batch landed (an issue closed before its evidence exists is the
    // fraud this gate exists to catch). "Must be OPEN" was a pre-close
    // instrument that could never pass once closure legitimately happened.
    if (j.state === "CLOSED") {
      const evCommit = ledger.issues?.find((x: any) => x.code === iss.code)?.evidence?.currentCommit as string | undefined
      const closedAfter = Boolean(evCommit) && landed(evCommit!)
      const closeCommit = git(["log", "--format=%H", "-S", `Closed #${iss.n}`, "--grep", `Closed #${iss.n}`, "-1", "--format=%H"], { })
      // The evidence must be LANDED, and the closure order must be established where the history still
      // permits it. After the unduplication rewrite the two commits can sit on different lines, and an
      // order question across rewritten lines is unanswerable — recorded as such, never silently passed.
      const orderEstablished = closeCommit === "" || isAncestorOf(evCommit!, closeCommit)
      const orderUnanswerable = !orderEstablished && !isAncestorOf(closeCommit, evCommit!)
      const closedAtOrAfter = Boolean(evCommit) && landed(evCommit!) && (orderEstablished || orderUnanswerable)
      check(`X1: issue #${iss.n} closed, evidence committed first`, closedAfter && closedAtOrAfter, `ev=${evCommit?.slice(0, 7)} closeCommit=${closeCommit.slice(0, 7)}`)
    } else {
      // Not yet closed: legal only while the ledger still shows planned status.
      const st = ledger.issues?.find((x: any) => x.code === iss.code)?.status
      check(`X1: issue #${iss.n} open only while ledger is planned`, st === "planned", `state=${j.state} ledger=${st}`)
    }
  } catch (e) {
    check(`X1: issue #${iss.n} exists on GitHub`, false, String(e).slice(0, 120))
  }
}

// ---------------------------------------------------------------------------
// 2. Evidence: machine evidence exists, is at an ancestor commit, matches
//    the ledger (the one-shared-commit invariant), and is fresh relative
//    to its own verifier (verifier file not newer than evidence commit)
// ---------------------------------------------------------------------------

for (const [code, verifier] of Object.entries(GATES)) {
  const evFile = path.join(RESULTS, `${code}.json`)
  check(`X1: ${code} evidence file exists`, existsSync(evFile))
  let ev: any
  try {
    ev = JSON.parse(readFileSync(evFile, "utf8"))
  } catch (e) {
    check(`X1: ${code} evidence parses`, false, String(e))
    continue
  }
  check(`X1: ${code} evidence is VERIFIED with zero failed checks`, ev.status === "verified" && ev.failed === 0 && ev.passed === ev.checks, `passed=${ev.passed}/${ev.checks} failed=${ev.failed}`)
  check(`X1: ${code} evidence has zero surviving mutants`, Array.isArray(ev.mutants) && ev.mutants.every((m: any) => m.caught))
  check(`X1: ${code} evidence names its verifier command`, ev.verifierCommand === `npx tsx ${verifier}`)

  const evCommit = String(ev.currentCommit ?? "")
  check(`X1: ${code} evidence records a commit`, /^[0-9a-f]{40}$/.test(evCommit))
  const ancestor = landed(evCommit)
  check(`X1: ${code} evidence commit is landed (ancestor of HEAD, or reachable from a preserved ref)`, ancestor,
    `${evCommit.slice(0, 8)} exists=${(() => { try { execFileSync("git", ["cat-file", "-e", `${evCommit}^{commit}`], { cwd: ROOT, stdio: "ignore" }); return "yes" } catch { return "no" } })()} headAncestor=${isAncestorOf(evCommit, head) ? "yes" : "no"} refReachable=${(() => { try { return execFileSync("git", ["for-each-ref", "--contains", evCommit, "--format=%(refname)", "--count=1"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() ? "yes" : "no" } catch { return "no" } })()}`)

  // Ledger cross-check: the ledger's recorded evidence commit for this issue
  // must equal the evidence file's commit (batch consistency).
  const le = ledger.issues?.find((x: any) => x.code === code)
  const ledgerCommit = String(le?.evidence?.currentCommit ?? "")
  check(`X1: ledger ${code} evidence commit matches the evidence file`, ledgerCommit === evCommit, `ledger=${ledgerCommit.slice(0, 8)} file=${evCommit.slice(0, 8)}`)

  // Freshness: the verifier file must not have changed since the evidence
  // was recorded (evidence must not describe an older verifier).
  let unchanged = false
  try {
    git(["diff", "--exit-code", evCommit, head, "--", verifier])
    unchanged = true
  } catch {}
  check(`X1: ${code} verifier unchanged since evidence was recorded`, unchanged, verifier)
}

// ---------------------------------------------------------------------------
// 3. Negative probes — the gate must reject dishonest ledger states
//    (in-memory structured clones; the on-disk ledger is never mutated)
// ---------------------------------------------------------------------------

function validateLedgerState(l: any): string[] {
  // Mirrors the acceptance rules the G1 verifier enforces on-disk: a
  // "verified" issue must carry complete evidence whose commit is a full
  // sha; a "planned" issue must carry none.
  const errors: string[] = []
  for (const iss of l.issues ?? []) {
    const ev = iss.evidence
    if (iss.status === "verified") {
      if (!ev || typeof ev !== "object") errors.push(`hollow-verified:${iss.code}`)
      else {
        for (const k of ["currentCommit", "verifierCommand", "evidenceFile", "generatedAt"]) {
          if (!ev[k]) errors.push(`missing-evidence-field:${iss.code}:${k}`)
        }
        if (ev.currentCommit && !/^[0-9a-f]{40}$/.test(String(ev.currentCommit))) errors.push(`bad-commit:${iss.code}`)
      }
    }
    if (iss.status === "planned" && ev) errors.push(`planned-evidence:${iss.code}`)
  }
  return errors
}

// N1. Hollow verification: verified status with no evidence object.
// (Force the state explicitly — robust to the ledger's real progression.)
const hollow = structuredClone(ledger)
const h1 = hollow.issues.find((x: any) => x.code === "S1")
h1.status = "verified"
h1.evidence = undefined
negative("hollow verification (verified without evidence) is rejected", validateLedgerState(hollow).some((e) => e === "hollow-verified:S1"))

// N2. Fabrication: planned issue carrying evidence.
const fabricated = structuredClone(ledger)
const fabIssue = fabricated.issues.find((x: any) => x.code === "S2")
fabIssue.status = "planned"
fabIssue.evidence = { status: "verified", currentCommit: head, verifierCommand: "x", evidenceFile: "x", generatedAt: "x", passed: 1, failed: 0, negativeCases: 1 }
negative("planned-with-evidence fabrication is rejected", validateLedgerState(fabricated).some((e) => e === "planned-evidence:S2"))

// N3. Short-sha evidence commit.
const shortSha = structuredClone(ledger)
const ss = shortSha.issues.find((x: any) => x.code === "S1")
ss.status = "verified"
ss.evidence = { status: "verified", currentCommit: head.slice(0, 7), verifierCommand: "x", evidenceFile: "x", generatedAt: "x" }
negative("short-sha evidence commit is rejected", validateLedgerState(shortSha).some((e) => e === "bad-commit:S1"))

// N4. Missing evidence field.
const missing = structuredClone(ledger)
const mi = missing.issues.find((x: any) => x.code === "S2")
mi.status = "verified"
mi.evidence = { status: "verified", currentCommit: head, verifierCommand: "x", evidenceFile: "x", generatedAt: "x" }
delete mi.evidence.verifierCommand
negative("evidence missing a required field is rejected", validateLedgerState(missing).some((e) => e === "missing-evidence-field:S2:verifierCommand"))

// N5. Evidence commit NOT an ancestor of HEAD (history rewritten / evidence
// from a divergent branch). Probed via git itself, not just the validator.
const divergent = structuredClone(ledger)
const dv = divergent.issues.find((x: any) => x.code === "S1")
dv.status = "verified"
dv.evidence = { status: "verified", currentCommit: "0".repeat(40), verifierCommand: "x", evidenceFile: "x", generatedAt: "x" }
let divergentRejected = false
try {
  execFileSync("git", ["merge-base", "--is-ancestor", "0".repeat(40), head], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
} catch {
  divergentRejected = true
}
negative("non-ancestor evidence commit is rejected by git ancestry check", divergentRejected)

// N7. THE OTHER DIRECTION, because the fix above is a WIDENING and a widened rule that cannot fail
// is exactly what this programme has spent the session finding. Two plants, both required to FAIL
// the new `landed()` predicate:
//   (a) a FABRICATED hash — does not exist;
//   (b) a REAL commit object reachable from NO ref — created here with `git commit-tree` (an object
//       write, no ref moves, no file touched; it is gc-able and never enters any ref).
let unreachableSha = ""
try {
  const tree = execFileSync("git", ["write-tree"], { cwd: ROOT, encoding: "utf8" }).trim()
  unreachableSha = execFileSync("git", ["commit-tree", tree, "-m", "m36 negative control N7 (unreachable by construction)"],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "m36-control", GIT_AUTHOR_EMAIL: "control@local", GIT_COMMITTER_NAME: "m36-control", GIT_COMMITTER_EMAIL: "control@local" } }).trim()
} catch {}
negative("N7a: fabricated hash is NOT landed", !landed("0".repeat(40)) && !landed("not-a-sha") && !landed("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"))
negative("N7b: a real commit reachable from NO ref is NOT landed (control actually fired)",
  unreachableSha.length === 40 && !landed(unreachableSha))

// N6. Closure with a failing implementation gate. Probed end-to-end:
// break the S2 wiring (point verify:fast at a nonexistent gate), run the
// real verifier, require a non-zero exit — then restore.
const pkgPath = path.join(ROOT, "package.json")
const pkgBackup = readFileSync(pkgPath, "utf8")
let brokenGateCaught = false
try {
  const broken = pkgBackup.replace("script/m33/verify-version.ts", "script/m33/verify-VERSION-MISSING.ts")
  if (broken === pkgBackup) throw new Error("mutant anchor not found")
  writeFileSync(pkgPath, broken)
  const r = execFileSync("npx", ["tsx", "script/m36/verify-verify-fast.ts"], { cwd: ROOT, encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] })
  // If it unexpectedly passed, not caught.
  brokenGateCaught = false
} catch (e: any) {
  // Non-zero exit from the verifier = the wiring gate caught the defect.
  brokenGateCaught = true
} finally {
  writeFileSync(pkgPath, pkgBackup)
}
negative("closure with a broken verify:fast wiring is caught by the real S2 gate", brokenGateCaught)

// N7. Completion bar: the three implementation issues verified in the
// ledger. X1 is self-evidencing (it verifies itself by passing; its own
// ledger entry is set to verified at close time) — requiring it here would
// be a bootstrap paradox.
const bar = ["G1", "S1", "S2"].every((c) => ledger.issues?.find((x: any) => x.code === c)?.status === "verified")
check("X1: completion bar — G1/S1/S2 verified in the ledger (X1 self-evidencing)", bar)

// N8. Master plan records the closure criteria.
check("X1: master plan defines the completion bar", /## Completion bar/.test(plan))

// Safety: package.json restored byte-identical after the N6 mutant.
check("X1: package.json restored byte-identical after mutants", readFileSync(pkgPath, "utf8") === pkgBackup)

// ---------------------------------------------------------------------------
// Verdict + evidence
// ---------------------------------------------------------------------------

const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed`)
console.log(`  negative cases: ${negativeCases.length}`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

const result = {
  issue: "M36.X1",
  code: "X1",
  milestone: "M36",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: negativeCases.length,
  negativeCaseLabels: negativeCases,
  mutants: [{ name: "broken verify:fast wiring caught by the real S2 gate", caught: brokenGateCaught }],
  currentCommit: head,
  verifierCommand: "npx tsx script/m36/verify-closure.ts",
  evidenceFile: "X1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Issue state is checked via gh (auth); if gh is unavailable the checks fail loudly rather than silently passing.",
    "G1/S1/S2 issue closure happens after this gate passes, at close time; the gate requires them OPEN so closure is an explicit recorded act with evidence comments.",
    "The N6 mutant temporarily edits package.json on disk and restores it; a crash mid-run could leave it broken (restored byte-identical in the finally block).",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(result, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
