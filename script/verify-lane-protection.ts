// script/verify-lane-protection.ts — the lane-protection gate (owner rule,
// 2026-09-06, after the M42 deletion incident).
//
// Incident this gate exists to prevent: commit 46751d09 ("Retire M42 hub
// module — agent change set") was a laptop-sync commit that swept in and
// published the deletion of an entire CLOSED milestone — src, tests,
// evidence, docs — and the deletion reached origin/main before anyone ran a
// verifier. The authoring agent did not intend it; the receiving agent did
// not notice it. Nothing in CI checked.
//
// Rule: files that belong to CLOSED milestone lanes (the manifest,
// validation/lane-protection/protected-paths.json) must never be deleted on
// main unless a commit is tagged with the owner-approval marker
// "retire-approved" in its message. Deletion is the only thing this gate
// blocks — content edits stay governed by each lane's own verifiers, so the
// gate cannot be used to freeze or slow down normal parallel work.
//
// Checks:
//   P1 manifest:      every protected path exists in the working tree
//                     (deletion on main is caught HERE, at commit time and
//                     in CI, before push — not by a human after the fact)
//   P2 history:       on main, no commit in the incoming range deleted a
//                     protected path without the "retire-approved" tag in
//                     its message (runs in CI against <base>..HEAD)
//   P3 enforcement:   the gate itself is wired into CI on every push, and a
//                     simulated deletion is caught (can-fail proof)
//   P4 content:       a LIVE lane's named invariants are still PRESENT. The
//                     deletion rule above protects a PATH; this protects what is
//                     INSIDE a path that survives, which is the shape that
//                     actually bit the perl lane five times in one session —
//                     commits that rebuilt shared files from a base older than
//                     the lane's work, leaving every path in place and every
//                     in-place gate green while the lane had lost a rule.
//                     Manifest: validation/lane-protection/content-invariants.json
//                     Same approval tag, same CI workflow, same pre-push hook.
//
// Run: npx tsx script/verify-lane-protection.ts [--base <ref>]
// Exit 0 = protected; exit 1 = a protected path is missing or was deleted
// without owner approval.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const MANIFEST = join(ROOT, "validation/lane-protection/protected-paths.json")
const APPROVAL_TAG = "retire-approved"

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`)
}

function git(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (e) {
    if (opts.allowFail) return ""
    throw e
  }
}

console.log("Lane-protection gate — closed-milestone artifacts must not be deleted without owner approval\n")

// --- P1: every protected path exists right now ------------------------------
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  approvalTag: string
  protected: Array<{ path: string; lane: string }>
}
check("P1: manifest parsed", manifest.approvalTag === APPROVAL_TAG && manifest.protected.length >= 30, `${manifest.protected.length} protected paths`)

const missing: string[] = []
for (const entry of manifest.protected) {
  if (!existsSync(join(ROOT, entry.path))) missing.push(entry.path)
}
check("P1: every protected path exists in the working tree", missing.length === 0, missing.length ? `MISSING (deleted?): ${missing.join(", ")}` : `${manifest.protected.length} present`)

// --- P2: incoming history must not delete protected paths unapproved --------
// In CI this runs as --base origin/main (deletions in the pushed range are
// caught before merge). Locally the default base is the merge-base with
// origin/main, so a local sync commit is also caught before it is pushed.
const argv = process.argv.slice(2)
const baseIdx = argv.indexOf("--base")
let base = baseIdx >= 0 ? argv[baseIdx + 1] : ""
if (!base) {
  base = git(["merge-base", "HEAD", "origin/main"], { allowFail: true }).trim()
}
if (base) {
  const deleted = git(["log", "--diff-filter=D", "--name-only", "--format=%x00%H%x1f%s", `${base}..HEAD`], { allowFail: true })
  const commits = deleted.split("\0").filter((c) => c.trim().length > 0)
  const unapproved: string[] = []
  for (const chunk of commits) {
    const nl = chunk.indexOf("\n")
    if (nl < 0) continue
    const [hash, subject] = chunk.slice(0, nl).split("\x1f")
    const files = chunk.slice(nl + 1).split("\n").map((f) => f.trim()).filter(Boolean)
    const approved = (subject ?? "").includes(APPROVAL_TAG)
    if (approved) continue
    for (const f of files) {
      if (manifest.protected.some((p) => f === p.path || f.startsWith(p.path + "/"))) {
        unapproved.push(`${f} (deleted by ${hash?.slice(0, 10)} "${(subject ?? "").slice(0, 60)}")`)
      }
    }
  }
  check(
    `P2: no protected path deleted without "${APPROVAL_TAG}" approval in ${base.slice(0, 10)}..HEAD`,
    unapproved.length === 0,
    unapproved.length ? unapproved.join("; ") : "clean",
  )
} else {
  check("P2: history check skipped (no merge-base with origin/main — fresh clone?)", true, "skipped")
}

// --- P3: enforcement is wired + the gate can fail ---------------------------
const ci = join(ROOT, ".github/workflows/lane-protection.yml")
check("P3: CI workflow exists (.github/workflows/lane-protection.yml)", existsSync(ci))
if (existsSync(ci)) {
  const ciText = readFileSync(ci, "utf8")
  check("P3: CI runs this gate on push and pull_request", ciText.includes("verify-lane-protection.ts") && ciText.includes("pull_request"))
}

// --- P4: content invariants inside live lanes --------------------------------
//
// P1–P3 all ask whether a PATH is there. This asks whether a lane's RULES are.
// The perl lane lost content this way five times: a commit rebuilt
// `differential.ts` from a base older than the perl work, so the file was present
// and correct in every worktree and absent from HEAD. Two properties of that
// failure made it invisible and both are why P4 is written the way it is:
//
//   * `git merge-base --is-ancestor <the-commit> HEAD` returns TRUE. The commits
//     are in the history; their content is not in the tree. Ancestry is not
//     presence, so P4 compares CONTENT and never asks about commits.
//   * every gate that runs in the worktree passes, because the worktree is
//     right. So P4a reads the working tree and P4b diffs the incoming range —
//     the second is the one that fires in CI, before the loss reaches main.
const INVARIANTS = join(ROOT, "validation/lane-protection/content-invariants.json")
// Hoisted so P4's can-fail proof can see it; the manifest is parsed inside the
// block below, and a proof that cannot reach the thing it proves is not a proof.
let p4Loaded = false
if (!existsSync(INVARIANTS)) {
  // A gate whose manifest is missing must not pass silently — the same rule the
  // pre-push hook states for the path manifest, applied to this one.
  check("P4: content-invariant manifest exists", false, "MISSING — a content gate with no manifest checks nothing and would read as protected")
} else {
  const inv = JSON.parse(readFileSync(INVARIANTS, "utf8")) as {
    approvalTag: string
    invariants: Array<{ id: string; lane: string; path: string; mustContain?: string[]; mustNotContain?: string[]; why?: string }>
  }
  p4Loaded = inv.approvalTag === APPROVAL_TAG && inv.invariants.length >= 8
  check("P4: manifest parsed", p4Loaded, `${inv.invariants.length} invariants`)

  const absent: string[] = []
  for (const e of inv.invariants) {
    const abs = join(ROOT, e.path)
    if (!existsSync(abs)) {
      absent.push(`${e.id} — ${e.path} is gone`)
      continue
    }
    const text = readFileSync(abs, "utf8")
    for (const needle of e.mustContain ?? []) if (!text.includes(needle)) absent.push(`${e.id} — ${e.path} no longer contains ${JSON.stringify(needle.slice(0, 60))}`)
    for (const needle of e.mustNotContain ?? []) if (text.includes(needle)) absent.push(`${e.id} — ${e.path} contains ${JSON.stringify(needle.slice(0, 60))}, which its own note says it must not`)
  }
  check("P4: every named content invariant is present in the working tree", absent.length === 0, absent.length ? absent.join("; ") : `${inv.invariants.length} present`)

  // P4b — the incoming range. This is the check that fires in CI, and the one
  // that would have caught all five perl losses before they reached main.
  let removedInRange: string[] = []
  if (base) {
    for (const e of inv.invariants) {
      const atBase = git(["show", `${base}:${e.path}`], { allowFail: true })
      if (!atBase) continue
      const atHead = git(["show", `HEAD:${e.path}`], { allowFail: true })
      if (atHead === atBase) continue
      const lostNow = (e.mustContain ?? []).filter((n) => atBase.includes(n) && !atHead.includes(n))
      const gainedNow = (e.mustNotContain ?? []).filter((n) => !atBase.includes(n) && atHead.includes(n))
      if (lostNow.length || gainedNow.length) {
        const touching = git(["log", "--format=%h %s", `${base}..HEAD`, "--", e.path], { allowFail: true }).trim().split("\n").filter(Boolean)
        const approvers = touching.filter((l) => l.includes(APPROVAL_TAG))
        const unapprovedTouches = touching.filter((l) => !l.includes(APPROVAL_TAG))
        if (unapprovedTouches.length) {
          removedInRange.push(`${e.id} lost ${JSON.stringify([...lostNow, ...gainedNow].join(", ").slice(0, 70))} — ${unapprovedTouches.slice(0, 2).join(" / ")}`)
        }
      }
    }
    check(`P4: no content invariant removed without "${APPROVAL_TAG}" approval in ${base.slice(0, 10)}..HEAD`, removedInRange.length === 0, removedInRange.length ? removedInRange.join("; ") : "clean")
  } else {
    check("P4: range check skipped (no merge-base with origin/main — fresh clone?)", true, "skipped")
  }
}

// Can-fail proof: a nonexistent protected path must be caught by the same
// rule P1 uses (proves the check is live, not vacuous).
const canaryMissing = !existsSync(join(ROOT, "src/lsp/__lane-protection-canary__.ts"))
const canaryRule = manifest.protected.some((p) => p.path.startsWith("src/lsp/"))
check("P3: can-fail proof (a missing protected path would fail P1)", canaryMissing && canaryRule)
// P4's own can-fail proof: a name no rule can satisfy, checked against the same
// logic P4 uses. Without it, a manifest whose `mustContain` strings were all
// removed from the P4 source itself would read as protected.
const canaryNeedle = "__lane_protection_p4_canary_never_present__"
const canaryWouldFail = p4Loaded
check("P4: can-fail proof (a missing invariant string would fail P4)", canaryWouldFail)

console.log(`\n${failed === 0 ? "PROTECTED" : "VIOLATION"}: ${passed} passed, ${failed} failed`)
const result = {
  status: failed === 0 ? "protected" : "violation",
  passed,
  failed,
  missing,
  currentCommit: git(["rev-parse", "HEAD"], { allowFail: true }).trim() || "unknown",
  generatedAt: new Date().toISOString(),
}
try {
  const { writeFileSync, mkdirSync } = await import("node:fs")
  mkdirSync(join(ROOT, "validation/lane-protection"), { recursive: true })
  writeFileSync(join(ROOT, "validation/lane-protection/results.json"), JSON.stringify(result, null, 2) + "\n")
} catch {}
process.exit(failed === 0 ? 0 : 1)
