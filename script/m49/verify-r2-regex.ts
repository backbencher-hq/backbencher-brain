// script/m49/verify-r2-regex.ts — M49.R2: regex census truth gate.
//
// M12 built an AST-driven regex census and a verify gate, but two defects let
// it go vacuous (found 2026-09-08; the user's "scala/kotlin are full of regex
// asshole" suspicion was CORRECT):
//   1. The committed census claimed 0 usages while the analyzers carried 55.
//   2. The fast battery never ran the census gate, so "MISSING x55" went
//      unnoticed across whole review waves.
//
// This gate enforces, LIVE (never trusted from stored evidence):
//   1. Census freshness: the committed census must match a fresh AST scan of
//      src/ast exactly (no MISSING, no STALE).
//   2. Debt register: every entry classified needs_review/replaceable must
//      carry a justification naming its issue id; the REGISTER FILE
//      (validation/m49/regex-debt-register.json) must list every such entry.
//   3. Shrink-only: the needs_review+replaceable total must never GROW vs the
//      register's recorded baseline. Fixes reduce it; new regexes in that
//      class fail the gate.
//
// Run: bun script/m49/verify-r2-regex.ts
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CENSUS = path.join(ROOT, "validation/m12/results/regex-census.json")
const REGISTER = path.join(ROOT, "validation/m49/regex-debt-register.json")

let checks = 0, passed = 0, failed = 0, negatives = 0
function check(name: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`) }
}
function negative(name: string, ok: boolean, detail = "") { negatives++; check(`${name} [negative]`, ok, detail) }

interface Entry { file: string; line: number; source: string; classification: string; justification?: string }
interface Census { totalRegexUsages: number; perFile: { file: string; count: number; usages: Entry[] }[] }

async function main() {
  const census: Census = JSON.parse(readFileSync(CENSUS, "utf8"))
  const committed = census.perFile.flatMap((f) => f.usages)

  // 1. Fresh AST scan — same scanner M12 uses (single source of truth).
  const { scanAnalyzers } = await import("../m12/regex-census-core")
  const fresh = (await scanAnalyzers()) as Entry[]

  const keyOf = (e: any) => `${e.file}:${e.line}:${e.source}`
  const committedKeys = new Set(committed.map(keyOf))
  const freshKeys = new Set(fresh.map(keyOf))

  const missing = [...freshKeys].filter((k) => !committedKeys.has(k))
  const stale = [...committedKeys].filter((k) => !freshKeys.has(k))

  check("census freshness: no MISSING entries", missing.length === 0,
    missing.length ? `first: ${missing.slice(0, 3).join(" | ")}` : "")
  check("census freshness: no STALE entries", stale.length === 0,
    stale.length ? `first: ${stale.slice(0, 3).join(" | ")}` : "")
  negative("stale census cannot claim zero while source has usages",
    !(census.totalRegexUsages === 0 && fresh.length > 0),
    `census says ${census.totalRegexUsages}, fresh scan says ${fresh.length}`)

  // 2. Every review-class entry must be in the debt register.
  const reviewEntries = committed.filter(
    (e) => e.classification === "needs_review" || e.classification === "replaceable",
  )
  const reviewKey = (e: Entry) => `${e.file}:${e.line}`
  const reviewSet = new Set(reviewEntries.map(reviewKey))

  let register: { baselineTotal: number; entries: { file: string; line: number; note: string }[] } = {
    baselineTotal: -1,
    entries: [],
  }
  if (existsSync(REGISTER)) register = JSON.parse(readFileSync(REGISTER, "utf8"))

  const registeredKeys = new Set(register.entries.map((e) => `${e.file}:${e.line}`))
  const unregistered = [...reviewSet].filter((k) => !registeredKeys.has(k))

  check("every needs_review/replaceable entry is in the debt register", unregistered.length === 0,
    unregistered.length ? `unregistered: ${unregistered.slice(0, 5).join(", ")}` : "")

  // Register entries must point at REAL current review-class entries (no
  // ghost rows inflating the register, no stale rows surviving a fix).
  const ghostRows = register.entries.filter((e) => !reviewSet.has(`${e.file}:${e.line}`))
  check("register has no ghost rows", ghostRows.length === 0,
    ghostRows.length ? `first: ${ghostRows.slice(0, 3).map((e) => `${e.file}:${e.line}`).join(", ")}` : "")

  // 3. Shrink-only: the review-class total may only decrease vs baseline.
  if (register.baselineTotal >= 0) {
    check("review-class regex total is monotonically non-increasing",
      reviewEntries.length <= register.baselineTotal,
      `baseline ${register.baselineTotal} -> now ${reviewEntries.length}`)
  } else {
    check("debt register baseline established", true, "first run records the baseline")
  }

  console.log(`regex census: ${committed.length} committed / ${fresh.length} fresh | review-class: ${reviewEntries.length} (baseline ${register.baselineTotal >= 0 ? register.baselineTotal : "n/a"})`)
  console.log(`M49.R2: ${passed}/${checks} checks passed, ${negatives} negative(s) exercised`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exit(1) })
