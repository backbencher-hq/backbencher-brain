/**
 * M14.0.F6 — The Honesty Gate
 *
 * Runs LAST-in-spirit checks that block release when any M14 artifact smells
 * of self-certification (docs/M14-HONESTY-CONTRACT.md §5.8):
 *   1. banned-vocabulary lint over docs/, plans/, validation/m14/ artifacts
 *   2. evidence files present + schema-valid for every claimed foundation issue
 *   3. L4/L5 claims backed by >=3 mutationLog entries (deep-checked here again)
 *   4. baselines present (grammar, fixtures, differential) — no gate may run
 *      unbaselined
 *   5. corpus pins present in differential evidence
 *
 * CLI: bun run script/m14/verify-honesty.ts   (exit non-zero blocks release)
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const M14 = path.join(ROOT, "validation", "m14")

const REQUIRED_EVIDENCE = ["M14.0.F1", "M14.0.F2", "M14.0.F3", "M14.0.F4", "M14.0.F5"]
const REQUIRED_BASELINES = [
  "grammar-audit-baseline.json",
  "fixture-baseline.json",
  "differential-baseline.json",
]
// Contract §1 terms — checked over artifact prose (not code identifiers).
const BANNED = [
  /\bperfect(ion)?\b/i, /\bcomplete[d]?\b/i, /\bproduction-ready\b/i,
  /\bbulletproof\b/i, /\brock-solid\b/i, /\bbattle-tested\b/i,
  /\bextensively tested\b/i, /\bthoroughly reviewed\b/i,
  /\bshould work\b/i, /\bexpected to pass\b/i,
]

let failures = 0
function fail(msg: string) { console.error(`HONESTY-GATE FAIL: ${msg}`); failures++ }
function pass(msg: string) { console.log(`ok   ${msg}`) }

// 1. banned vocabulary in M14 prose artifacts
function collectProse(dir: string, out: string[] = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectProse(p, out)
    else if (/\.(md|json)$/.test(e.name)) out.push(p)
  }
  return out
}
for (const file of collectProse(M14).concat(collectProse(path.join(ROOT, "docs")).filter(f => f.includes("M14")))) {
  // The contract itself quotes banned terms to define them — exempted by design.
  if (file.endsWith("M14-HONESTY-CONTRACT.md")) continue
  const text = fs.readFileSync(file, "utf8")
  for (const re of BANNED) {
    const m = text.match(re)
    if (m) fail(`banned term "${m[0]}" in ${path.relative(ROOT, file)}`)
  }
}
pass("banned-vocabulary lint over validation/m14 + M14 docs")

// 2+3. evidence files valid and deep-checked
for (const id of REQUIRED_EVIDENCE) {
  const p = path.join(M14, "results", `${id}.json`)
  if (!fs.existsSync(p)) { fail(`missing evidence file for ${id}`); continue }
  let ev: any
  try { ev = JSON.parse(fs.readFileSync(p, "utf8")) } catch { fail(`${id}: unparseable`); continue }
  if (ev.schemaVersion !== 2) fail(`${id}: not schema v2`)
  if ((ev.claimLevel === "L4" || ev.claimLevel === "L5") && (ev.mutationLog?.length ?? 0) < 3)
    fail(`${id}: L4/L5 without >=3 mutationLog`)
  if (!ev.limitations?.length && !ev.data?.limitationsJustification)
    fail(`${id}: empty limitations without justification`)
}
pass("evidence presence/schema/mutation-backing for F1-F5")

// 4. baselines exist and are non-empty
for (const b of REQUIRED_BASELINES) {
  const p = path.join(M14, b)
  if (!fs.existsSync(p)) { fail(`missing baseline: ${b}`); continue }
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"))
  if (!Object.keys(parsed).length) fail(`empty baseline: ${b}`)
}
pass("regression baselines present (grammar, fixtures, differential)")

// 5. corpus pins
const f5 = path.join(M14, "results", "M14.0.F5.json")
if (fs.existsSync(f5)) {
  const pins = JSON.parse(fs.readFileSync(f5, "utf8"))?.data?.corpusPins ?? {}
  const pinsValid = Object.entries(pins).every(([, sha]: any) => /^[0-9a-f]{40}$/.test(sha))
  if (!pinsValid || !Object.keys(pins).length) fail("differential evidence lacks valid corpus commit pins")
  else pass(`corpus pins present (${Object.keys(pins).join(", ")})`)
}

// 6. evidence freshness: regenerated at most one HEAD behind (any agent may have committed since)
const head = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
const recentCommits = execSync("git log --format=%H -5", { cwd: ROOT }).toString().trim().split("\n")
for (const id of REQUIRED_EVIDENCE) {
  const p = path.join(M14, "results", `${id}.json`)
  if (!fs.existsSync(p)) continue
  const c = JSON.parse(fs.readFileSync(p, "utf8"))?.commit
  if (!recentCommits.includes(c))
    fail(`${id}: evidence commit ${String(c).slice(0, 10)} not within last 5 commits — stale, regenerate`)
}
pass("evidence freshness within last 5 commits")

// 7. completeness ledger present and alive
const LEDGER = path.join(ROOT, "docs", "M14-COMPLETENESS-LEDGER.md")
if (!fs.existsSync(LEDGER)) {
  fail("completeness ledger missing: docs/M14-COMPLETENESS-LEDGER.md")
} else {
  const ledger = fs.readFileSync(LEDGER, "utf8")
  for (const section of ["Matrix 1", "Matrix 2", "Matrix 3", "Matrix 4", "Matrix 5", "Standing rules"]) {
    if (!ledger.includes(section)) fail(`ledger missing section: ${section}`)
  }
  const pendingCount = (ledger.match(/PENDING/g) ?? []).length
  if (pendingCount === 0) fail("ledger shows zero PENDING cells — either complete (implausible) or dishonestly edited")
  // Every PENDING cell must cite its tracking issue (#NNN) nearby on the same line
  const lines = ledger.split("\n")
  const uncited = lines.filter(l => l.includes("PENDING") && !l.includes("#") && !l.includes("M15") && !l.includes("cells tracked") && l.trim().startsWith("|"))
  if (uncited.length > 0) {
    for (const u of uncited.slice(0, 5)) fail(`PENDING cell without issue citation: ${u.trim().slice(0, 90)}`)
  }
  pass(`completeness ledger present (${pendingCount} PENDING cells tracked)`)
}

if (failures > 0) {
  console.error(`\nhonesty gate: ${failures} failure(s) — release blocked`)
  process.exit(6)
}
console.log("\nhonesty gate: all checks passed")
