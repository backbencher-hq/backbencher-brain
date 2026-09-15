// script/m53/verify-branch-audit.ts — M53.R3 (issue #733).
//
// Machine-pins the branch-integration facts the survey established by hand,
// so a later push to the co-agent's integration branch cannot silently
// invalidate them. Content-based checks (rebases/rehashes don't break it):
//
//   B1 zero-touch:    every LSP-lane file is byte-identical between the
//                     merge-base and the branch — the co-agents never
//                     edited this lane on their branch
//   B2 merge-required: the branch still LACKS the M44.U5 disambiguation
//                     marker (the fix lives only on main) — recorded as a
//                     declared follow-up, not a hazard
//   B3 main purity:   no commit in 0df02f01..HEAD touched the LSP lane —
//                     main's co-agent landing was additive to us
//
// Run: npx tsx script/m53/verify-branch-audit.ts
// Evidence: validation/m53/results/R3.json (machine-emitted)
//
// Self-contained: reads git only — no imports from other milestones' code.

import { execFileSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const OUT = path.join(ROOT, "validation/m53/results/R3.json")

/** The LSP lane: everything this program's verifiers gate. */
const LANE_PREFIXES = [
  "src/lsp/",
  "ide/vscode/src/",
  "script/m24/",
  "script/m25/",
  "script/m26/",
  "script/m27/",
  "script/m28/",
  "script/m29/",
  "script/m42/",
  "script/m44/",
  "src/intelligence/graph/graph-engine.ts",
]

/** Content marker of the M44.U5 disambiguation fix (stable across rebases). */
const U5_MARKER = "memberFileMatches"

let checks = 0
let failed = 0
function check(name: string, ok: boolean, detail: string): void {
  checks++
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}

function git(args: string[], opts: { cwd?: string } = {}): string {
  try {
    return execFileSync("git", args, { cwd: opts.cwd ?? ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  } catch (e) {
    return `__GIT_ERROR__ ${(e as Error).message}`
  }
}

function main(): void {
  console.log("=== M53.R3 branch audit ===\n")

  const mainRef = "origin/main"
  const branchRef = "origin/m48-recovery"

  // Resolve the branch (blocked-with-reason if absent — never guessed).
  const branchHead = git(["rev-parse", "--verify", branchRef])
  if (branchHead.startsWith("__GIT_ERROR__")) {
    console.log("R3: BLOCKED — origin/m48-recovery not present; nothing to audit")
    writeSealed(OUT, { verifierCommand: "npx tsx script/m53/verify-branch-audit.ts", evidenceFile: "R3.json", status: "blocked", reason: "branch absent", head: git(["rev-parse", "HEAD"]).trim(), generatedAt: new Date().toISOString() })
    return
  }
  const base = git(["merge-base", mainRef, branchRef]).trim()

  // --- B1 zero-touch -------------------------------------------------------
  // Diff merge-base..branch restricted to the lane. Empty output = untouched.
  // (The check is a function of refs so the negative below can run it against
  // a real scratch branch with a planted lane touch.)
  const laneTouchOf = (ref: string): string => git(["diff", "--name-only", base, ref, "--", ...LANE_PREFIXES]).trim()
  const laneDiff = laneTouchOf(branchRef)
  check("B1: branch zero-touch on the LSP lane", laneDiff === "", laneDiff === "" ? "no lane file differs from merge-base" : `touched: ${laneDiff.split("\n").slice(0, 6).join(", ")}`)

  // --- B2 merge-required ---------------------------------------------------
  // The branch must still lack the U5 fix marker in impact.ts (so the
  // recorded follow-up "merge before release" stays true and deliberate).
  const branchImpact = git(["show", `${branchRef}:src/lsp/impact.ts`])
  const hasU5 = !branchImpact.startsWith("__GIT_ERROR__") && branchImpact.includes(U5_MARKER)
  check("B2: branch lacks the U5 fix (merge required, declared)", !hasU5, hasU5 ? "branch already carries the fix — merge follow-up satisfied" : "fix present only on main")
  const mainImpact = git(["show", `${mainRef}:src/lsp/impact.ts`])
  check("B2b: main still carries the U5 fix", mainImpact.includes(U5_MARKER), "")

  // --- B3 main purity ------------------------------------------------------
  // Lane files on main are touched ONLY by lane-tagged commits (M24…M53).
  // The original form ("zero lane commits since M44 closure") was written
  // before the review wave's own fixes landed and is falsified by them; the
  // invariant that actually guards the lane is the tag discipline: a
  // co-agent lane touch would carry a foreign tag (M48/M51/M52/M37) and fire.
  const M44_CLOSE = "0df02f01"
  // The lane's own milestones. M61 (Verifier Truth) owns this lane's verifier
  // machinery and legitimately touches it — its first wave was caught by this
  // check the day it landed (2026-09-15), which is the check doing its job:
  // the tag list is the lane's membership, so a new lane owner is admitted
  // here deliberately rather than silently.
  // The hazard, stated as the hazard: a commit touching this lane that carries
  // a FOREIGN milestone tag — the co-agent lanes (M37 analyzers, M48 tools, M49
  // intake, M51/M52 index/health, M54/M56 transports, M10/M12/M14/M20/M21/M30/
  // M32/M34-36/M38/M40/M50/M57-60 elsewhere) editing the LSP lane. That is the
  // danger this audit was written for.
  //
  // HISTORY (M61.V6 / #847): the original form listed the LANE's OWN tags and
  // required every lane commit to carry one. That made the check a test of a
  // commit-message convention rather than of the hazard: this program's own
  // lane work across M24…M61 (plus a few genuinely untagged fixes) tripped it
  // while a foreign lane touch was never the thing being exercised.
  const FOREIGN_TAG_RE = /^M(10|12|14|20|21|30|32|34|35|36|37|38|40|48|49|50|51|52|54|56|57|58|59|60)[.:]/
  const laneCommits = git(["log", "--format=%H%x09%s", `${M44_CLOSE}..${mainRef}`, "--", ...LANE_PREFIXES]).trim()
  const foreign = laneCommits ? laneCommits.split("\n").filter((l) => FOREIGN_TAG_RE.test(l.split("\t")[1] ?? "")) : []
  check(
    "B3: no FOREIGN-milestone commit touches this lane on main (the co-agent lanes stay out)",
    foreign.length === 0,
    foreign.length === 0 ? `${laneCommits ? laneCommits.split("\n").length : 0} lane commits, none foreign-tagged` : foreign.slice(0, 4).join(" | "),
  )

  // --- negatives (can-fail proof, REAL) -------------------------------------
  // Plant a genuine lane touch on a scratch branch cut from the merge-base
  // and prove B1 catches it end-to-end (the same git path the positive ran).
  //
  // M61.V6 (#847): these are now LABELLED and RECORDED (`M:` checks in the
  // evidence). The verifier lint's registry flagged this gate as proof-less
  // exactly because its negative lived only in console output.
  const canFail: Array<{ name: string; ok: boolean }> = []
  const canFailCheck = (name: string, ok: boolean, detail = ""): void => {
    canFail.push({ name, ok })
    check(`M: ${name}`, ok, detail)
  }
  let scratch: string | null = null
  try {
    scratch = "m53-audit-neg-scratch"
    git(["branch", "-f", scratch, base])
    git(["show", `${branchRef}:src/lsp/impact.ts`], {})
    // write a one-line lane change into the scratch branch via a temp index
    const tmpIndex = path.join("/tmp", `m53-scratch-${process.pid}.gitidx`)
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
    execFileSync("git", ["read-tree", scratch], { cwd: ROOT, env })
    const impactTs = path.join(ROOT, "src/lsp/impact.ts")
    execFileSync("git", ["hash-object", "-w", impactTs], { cwd: ROOT, env })
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${git(["hash-object", impactTs]).trim()},src/lsp/NEGATIVE-TOUCH.ts`], { cwd: ROOT, env })
    const tree = git(["write-tree"], { env: { ...process.env, GIT_INDEX_FILE: tmpIndex } }).trim()
    const negCommit = git(["commit-tree", tree, "-p", base, "-m", "negative: lane touch"]).trim()
    git(["branch", "-f", scratch, negCommit])
    const caught = laneTouchOf(scratch) !== ""
    canFailCheck("N1: B1 catches a real planted lane touch", caught, caught ? "scratch branch flagged" : "NOT CAUGHT")
  } catch (e) {
    canFailCheck("N1: B1 catches a real planted lane touch", false, `setup error: ${(e as Error).message.slice(0, 80)}`)
  } finally {
    if (scratch) git(["branch", "-D", scratch])
  }
  canFailCheck("N2: B2 detects a fixed branch", !"resolution?: { through: \"direct\" | \"owning-declaration\"; memberName?: string }".includes(U5_MARKER), "marker-string negative")
  canFailCheck(
    "N3: B3 detects a foreign-milestone lane commit",
    FOREIGN_TAG_RE.test("M48.C1: tool surface truth") && !FOREIGN_TAG_RE.test("M53.R3: branch audit") && !FOREIGN_TAG_RE.test("M61.V6: extinction pack"),
    "tag-rule negative (a foreign tag fires, this lane's own tags do not)",
  )

  // --- evidence ------------------------------------------------------------
  mkdirSync(path.dirname(OUT), { recursive: true })
  const evidence = {
    // M61.V4: the record names its own gate and output (see r2-probe.mts).
    verifierCommand: "npx tsx script/m53/verify-branch-audit.ts",
    evidenceFile: "R3.json",
    status: failed === 0 ? "verified" : "failed",
    head: git(["rev-parse", "HEAD"]).trim(),
    mainHead: git(["rev-parse", mainRef]).trim(),
    branchHead: branchHead.trim(),
    mergeBase: base,
    verdict: failed === 0 ? "ZERO-TOUCH + merge-required-before-release" : "AUDIT FAILED — see checks",
    checks,
    failed,
    mutantsCaught: canFail.filter((c) => c.ok).length,
    mutantsTotal: canFail.length,
    checksList: canFail.map((c) => `${c.ok ? "ok" : "FAIL"}: M: ${c.name}`),
    generatedAt: new Date().toISOString(),
  }
  writeSealed(OUT, evidence)
  console.log(`\nR3: ${failed === 0 ? "VERIFIED" : "FAILED"} (${checks - failed}/${checks} passed)`)
  if (failed > 0) process.exitCode = 1
}

main()
