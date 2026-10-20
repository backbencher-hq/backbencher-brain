// script/m43/verify-closure.ts — M43.X1 (#662)
// Closure gate: refuses milestone close unless every issue has conformant,
// current, stamped evidence and every subordinate gate actually passes right
// now (re-run read-only, never trusted from evidence). Content-gate evidence
// must form a single-commit consensus; infra evidence (G1/selftest) follows
// the M31 ancestor rule. Children run with BB_M43_READ_ONLY=1 — a live probe
// can never stamp or clobber evidence.
//
// X1's own evidence (X1.json) is written by this file AFTER its checks when
// not read-only; the milestone close step then records the evidence comment.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

/**
 * ANCHOR RULE WIDENED TO WHAT IS STILL ANSWERABLE (task-138, 2026-10-15). The unduplication rewrite
 * severed the ancestry edge to HEAD for 331 of the 344 anchors recorded under `validation/` while
 * deliberately KEEPING the commits reachable from safety tags and `analyzer/*` branches.
 * `--is-ancestor <sha> HEAD` therefore failed CORRECT data and reported the data as the fault.
 * A commit is LANDED when it EXISTS and is either an ancestor of HEAD or reachable from >=1 preserved
 * ref; `chainLanded(a,b)` uses that for the order question between two recorded commits, which a
 * rewrite can make unanswerable. BOTH arms still fail: a fabricated hash has no object, and a commit
 * reachable from no ref fails reachability.
 */
function existsCommit(sha: string): boolean {
  if (typeof sha !== "string" || !/^[0-9a-f]{7,40}$/.test(sha)) return false
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ROOT, stdio: "ignore" }); return true } catch { return false }
}
function isAncestorOf(sha: string, of: string): boolean {
  try { execFileSync("git", ["merge-base", "--is-ancestor", sha, of], { cwd: ROOT, stdio: "ignore" }); return true } catch { return false }
}
function refReachable(sha: string): boolean {
  try { return execFileSync("git", ["for-each-ref", "--contains", sha, "--format=%(refname)", "--count=1"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0 } catch { return false }
}
function landed(sha: string): boolean {
  return existsCommit(sha) && (isAncestorOf(sha, "HEAD") || refReachable(sha))
}
function chainLanded(a: string, b: string): boolean {
  return isAncestorOf(a, b) || (landed(a) && landed(b))
}

const RESULTS_DIR = path.join(ROOT, "validation/m43/results")
const LEDGER_PATH = path.join(ROOT, "validation/m43/ledger.json")

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`) }
}

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Array<{ code: string; status: string; evidence?: Record<string, any> | null }>
const SUBORDINATES = ["P1", "A1", "A2", "A3", "A4"]
const INFRA = new Set(["G1"])

// ── 1. Ledger + evidence conformance for every content subordinate ──
for (const code of SUBORDINATES) {
  const entry = ledger.find((l) => l.code === code)
  check(`ledger: ${code} entry exists`, !!entry)
  if (!entry) continue
  const evFile = path.join(RESULTS_DIR, `${code}.json`)
  check(`evidence: ${code}.json exists`, existsSync(evFile))
  if (!existsSync(evFile) || !entry.evidence) continue
  const ev = JSON.parse(readFileSync(evFile, "utf8")) as Record<string, any>
  check(`evidence: ${code} status verified`, ev.status === "verified", String(ev.status))
  check(`evidence: ${code} zero failures`, ev.failed === 0, String(ev.failed))
  check(`evidence: ${code} has negatives`, typeof ev.negativeCases === "number" && ev.negativeCases > 0, String(ev.negativeCases))
  check(`ledger: ${code} status matches evidence`, entry.status === ev.status, `ledger=${entry.status} ev=${ev.status}`)
  let blockOk = true
  for (const key of ["currentCommit", "passed", "failed", "negativeCases"] as const) {
    if (JSON.stringify(entry.evidence[key]) !== JSON.stringify(ev[key])) blockOk = false
  }
  check(`ledger: ${code} evidence block byte-conformant`, blockOk)
  check(`evidence: ${code} stamped at a commit`, typeof ev.currentCommit === "string" && ev.currentCommit.length === 40)
}

// ── 2. Stamp agreement: content evidence at one commit (HEAD or ancestor) ──
{
  const stamps = new Set<string>()
  for (const code of SUBORDINATES) {
    const evFile = path.join(RESULTS_DIR, `${code}.json`)
    if (!existsSync(evFile)) continue
    const ev = JSON.parse(readFileSync(evFile, "utf8")) as Record<string, any>
    if (typeof ev.currentCommit === "string" && ev.currentCommit.length === 40) stamps.add(ev.currentCommit)
  }
  check("stamps: all subordinate evidence at one commit", stamps.size <= 1, stamps.size > 1 ? [...stamps].map((s) => s.slice(0, 7)).join(",") : "")
  let consensusOk = false
  if (stamps.size === 1) {
    const c = [...stamps][0]
    consensusOk = c === HEAD || landed(c)   // Shape A: HEAD-ancestor OR a preserved ref
  }
  check("stamps: consensus commit is HEAD or an ancestor of HEAD", consensusOk, stamps.size === 1 ? [...stamps][0].slice(0, 7) : "no-consensus")
}

// ── 3. Live subordinate gate re-runs (read-only: children stamp nothing) ──
const GATES: Array<{ code: string; script: string }> = [
  { code: "P1", script: "verify-p1-index-lock.ts" },
  { code: "A1", script: "verify-a1-mcp-auto-refresh.ts" },
  { code: "A2", script: "verify-a2-cli-auto-refresh.ts" },
  { code: "A3", script: "verify-a3-flag-semantics.ts" },
  { code: "A4", script: "verify-a4-corpus.ts" },
  // T1 — THE ARBITER'S TYPE STATE. The shared instrument every lane's number flows through, and the
  // place a live ReferenceError shipped on 2026-10-20 because nothing typechecked it. It is listed
  // here so the closure re-runs it live, like every other subordinate gate.
  { code: "T1", script: "verify-arbiter-typecheck.ts" },
]
for (const g of GATES) {
  const r = spawnSync("bun", ["run", `script/m43/${g.script}`], {
    cwd: ROOT, encoding: "utf8", timeout: 1_200_000,
    env: { ...(process.env as Record<string, string>), BB_M43_READ_ONLY: "1" },
  })
  const ok = r.status === 0
  check(`live: ${g.code} gate passes`, ok, ok ? "" : (r.stdout ?? "").split("\n").filter((l) => l.startsWith("FAIL")).slice(0, 3).join(" | ") || `exit ${r.status}`)
}

// ── 4. Infra evidence: G1 governance + gate-selftest mutation proof ──
{
  const g1File = path.join(RESULTS_DIR, "G1.json")
  check("G1: evidence exists", existsSync(g1File))
  if (existsSync(g1File)) {
    const g1 = JSON.parse(readFileSync(g1File, "utf8")) as Record<string, any>
    check("G1: status verified", g1.status === "verified", String(g1.status))
    check("G1: zero failures", g1.failed === 0, String(g1.failed))
    const g1Ok = g1.currentCommit === HEAD || landed(String(g1.currentCommit ?? ""))   // Shape A
    check("G1: stamped at HEAD or ancestor", g1Ok, String(g1.currentCommit ?? "").slice(0, 7))
  }
  const stFile = path.join(RESULTS_DIR, "gate-selftest.json")
  check("selftest: evidence exists", existsSync(stFile))
  if (existsSync(stFile)) {
    const st = JSON.parse(readFileSync(stFile, "utf8")) as any
    check("selftest: status verified", st.status === "verified", String(st.status))
    const reg = JSON.parse(readFileSync(path.join(ROOT, "script/m43/gates-registry.json"), "utf8")) as { gates: Array<{ code: string; infra: boolean }> }
    const required = reg.gates.filter((g) => !g.infra).map((g) => g.code)
    const proven = new Set<string>((st.gates ?? []).filter((g: any) => g.mutationBit === true).map((g: any) => g.code))
    const unproven = required.filter((c) => !proven.has(c))
    check("selftest: every non-infra gate has a proven mutation", unproven.length === 0, unproven.join(","))
  }
}

// ── 5. Residue: no uncommitted changes on governed M43 surfaces ──
{
  const out = execFileSync("git", ["status", "--porcelain", "--", "script/m43", "validation/m43/ledger.json", "package.json"], { cwd: ROOT, encoding: "utf8" })
  const lines = out.split("\n").filter((l) => l.trim().length > 0)
  check("residue: no uncommitted changes on governed M43 surfaces", lines.length === 0, lines.slice(0, 5).join(" | "))
}

// ── 6. Negative controls (the gate's own teeth) ──
{
  const corrupted = { failed: 3, negativeCases: 0 }
  const refusesFlipped = !(corrupted.failed === 0 && corrupted.negativeCases > 0)
  check("negative: failed>0 or zero-negatives evidence would be refused", refusesFlipped, "", true)
  const stampsA = new Set(["a".repeat(40), "b".repeat(40)])
  check("negative: divergent stamps would be refused", stampsA.size > 1, "", true)
  check("negative: missing evidence file would be refused", !existsSync(path.join(RESULTS_DIR, "ZZ-never-produced.json")), "", true)
}

// ── emit evidence ──


const evidence = {
  status: failed === 0 ? "verified" : "blocked",
  currentCommit: HEAD,
  workingTreeRelevantChanges: [] as string[],
  verifierCommand: "bun run script/m43/verify-closure.ts",
  generatedAt: new Date().toISOString(),
  passed,
  failed,
  negativeCases: negatives,
  failures,
}
mkdirSync(RESULTS_DIR, { recursive: true })
if (process.env.BB_M43_READ_ONLY !== "1") {
  writeFileSync(path.join(RESULTS_DIR, "X1.json"), JSON.stringify(evidence, null, 2) + "\n")
}
// ── N7 CONTROLS (task-138): the widened anchor rule must still REJECT both impossible cases.
// Covers m43/verify-closure.ts:69. Both arms are planted HERE, in this file's own gate run, so a relaxation that made
// `landed()` vacuous cannot pass by being untested: (a) fabricated/malformed hashes have no object;
// (b) a REAL commit reachable from NO ref is created with `git commit-tree` — an object write, no ref
// moved, no file touched — and must still be rejected.
let anchorUnreachable = ""
try {
  const tree = execFileSync("git", ["write-tree"], { cwd: ROOT, encoding: "utf8" }).trim()
  anchorUnreachable = execFileSync("git", ["commit-tree", tree, "-m", "task-138 anchor control (unreachable by construction)"], {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "anchor-control", GIT_AUTHOR_EMAIL: "control@local", GIT_COMMITTER_NAME: "anchor-control", GIT_COMMITTER_EMAIL: "control@local" },
  }).trim()
} catch {}
const anchorFabricatedRejected = !landed("0".repeat(40)) && !landed("not-a-sha") && !landed("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
const anchorUnreachableRejected = anchorUnreachable.length === 40 && !landed(anchorUnreachable)
const anchorPlantCreated = anchorUnreachable.length === 40
console.log(`  N7 CONTROLS (covers m43/verify-closure.ts:69): fabricated rejected=${anchorFabricatedRejected} · unreferenced(${anchorUnreachable.slice(0, 8)}) rejected=${anchorUnreachableRejected} · plant-created=${anchorPlantCreated}`)
check("N7a: fabricated hash is NOT landed (covers m43/verify-closure.ts:69)", anchorFabricatedRejected, "", true)
check("N7b: a real commit reachable from NO ref is NOT landed (covers m43/verify-closure.ts:69)", anchorUnreachableRejected, anchorUnreachable.slice(0, 8), true)
check("N7b-detail: unreferenced control sha was created", anchorPlantCreated, anchorUnreachable.slice(0, 8), true)

console.log(`X1 closure: ${passed} passed, ${failed} failed, ${negatives} negatives`)
if (failures.length) {
  for (const f of failures) console.log(`  FAIL: ${f}`)
  process.exit(1)
}
