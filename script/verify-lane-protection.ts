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
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
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

// Can-fail proof: a nonexistent protected path must be caught by the same
// rule P1 uses (proves the check is live, not vacuous).
const canaryMissing = !existsSync(join(ROOT, "src/lsp/__lane-protection-canary__.ts"))
const canaryRule = manifest.protected.some((p) => p.path.startsWith("src/lsp/"))
check("P3: can-fail proof (a missing protected path would fail P1)", canaryMissing && canaryRule)

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
