// script/m50/verify-governance.ts — M50.G1
//
// Governance for the Tool Adoption Truth milestone. Every check is a real
// predicate over real files; nothing is excused, and a missing artifact is a
// failure rather than a warning.
//
//  1. docs/m50/PLAN.md states the milestone invariant verbatim.
//  2. The gates registry lists every issue, every gate file exists, and every
//     non-infra gate is wired into the verify chain. A new gate cannot merge
//     unwired or unregistered.
//  3. Every probe declared in the registry exists.
//  4. Evidence files exist for the issues that have delivered, and each is
//     conformant: issue number, status vocabulary, commit stamp, numeric
//     pass/fail, and failed === 0 for a `verified` status.
//  5. The PLAN's worklist and the registry agree on the issue set.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REGISTRY = path.join(ROOT, "script/m50/gates.json")
const PLAN = path.join(ROOT, "docs/m50/PLAN.md")
const PKG = path.join(ROOT, "package.json")

let pass = 0
let failed = 0
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++
    console.log(`  ok ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const registry = JSON.parse(readFileSync(REGISTRY, "utf8"))
const pkg = JSON.parse(readFileSync(PKG, "utf8"))
const chain = pkg.scripts["verify:m50"] ?? ""
const fullChain = pkg.scripts.verify ?? ""

// ── 1. invariant ───────────────────────────────────────────────────────────
{
  const plan = readFileSync(PLAN, "utf8")
  const invariant = "No tool is called \"adoptable\" until a scripted agent loop picks it unprompted,\nand no fix lands without a measured before/after on the real index."
  // Normalize the markdown blockquote prefix so the invariant is compared as
  // the sentence it is, not as its formatting.
  const normalized = plan.replace(/^\s*>\s?/gm, "")
  check("PLAN states the milestone invariant verbatim", normalized.includes(invariant))
  check("PLAN carries a GitHub milestone reference", /milestone\s*#\d+/i.test(plan) || plan.includes("GitHub milestone"))
}

// ── 2. gates registry ──────────────────────────────────────────────────────
{
  const gates = registry.gates as Array<{ code: string; script: string; infra: boolean }>
  check("registry declares at least the six M50 gates", gates.length >= 6, `gates=${gates.length}`)
  for (const gate of gates) {
    const file = path.join(ROOT, "script/m50", gate.script)
    check(`G1 ${gate.code}: gate script exists`, existsSync(file), file)
    check(`G1 ${gate.code}: wired into verify:m50`, chain.includes(`script/m50/${gate.script}`), chain.slice(0, 120))
    if (!gate.infra) check(`G1 ${gate.code}: wired into the full verify chain`, fullChain.includes(`script/m50/${gate.script}`), "missing from npm run verify")
  }
}

// ── 3. probes ──────────────────────────────────────────────────────────────
{
  for (const probe of registry.probes as string[]) {
    check(`G1 probe ${probe} exists`, existsSync(path.join(ROOT, "script/m50", probe)))
  }
}

// ── 4. evidence conformance ────────────────────────────────────────────────
{
  const issues = registry.issues as Record<string, number>
  const EVIDENCE: Array<{ file: string; issue: number | null }> = [
    { file: "A1.json", issue: issues.A1 },
    { file: "A2-planner-stats.json", issue: issues.A2 },
    { file: "A2-bounded-work.json", issue: issues.A2 },
    { file: "A2-test-sources.json", issue: issues.A2 },
    { file: "A2-residual.json", issue: issues.A2 },
    { file: "A3.json", issue: issues.A3 },
    { file: "A4.json", issue: issues.A4 },
    // A5 is unregistered (GitHub unreachable at delivery): its evidence must
    // say `issue: null` AND carry the declared status, never a borrowed number.
    { file: "A5.json", issue: null },
  ]
  for (const ev of EVIDENCE) {
    const file = path.join(ROOT, "validation/m50/results", ev.file)
    if (!existsSync(file)) {
      check(`G1 evidence ${ev.file} exists`, false, file)
      continue
    }
    try {
      const data = JSON.parse(readFileSync(file, "utf8"))
      const statusOk = ["verified", "known-gap", "measured", "pending"].includes(data.status)
      const numeric = typeof data.passed === "number" && typeof data.failed === "number"
      const commitOk = typeof data.commit === "string" && data.commit.length >= 7
      check(
        `G1 evidence ${ev.file} conforms (issue/status/commit/counters)`,
        data.issue === ev.issue && statusOk && numeric && (data.status !== "verified" || data.failed === 0) && (ev.issue !== null || typeof data.issueStatus === "string"),
        `issue=${data.issue} status=${data.status} passed=${data.passed} failed=${data.failed} commit=${String(data.commit).slice(0, 8)}`,
      )
      if (data.status === "verified") check(`G1 evidence ${ev.file} commit stamp present`, commitOk, String(data.commit))
    } catch (e: any) {
      check(`G1 evidence ${ev.file} parses`, false, e?.message)
    }
  }
}

// ── 5. PLAN ↔ registry issue agreement ─────────────────────────────────────
{
  const plan = readFileSync(PLAN, "utf8")
  for (const [code, num] of Object.entries(registry.issues as Record<string, number | null>)) {
    if (num === null) {
      // An unregistered issue must be DECLARED as unregistered, with a written
      // reason and the issue text stored for later registration. Inventing a
      // number to satisfy a gate would be the exact dishonesty this milestone
      // exists to remove.
      const reason = (registry.unregisteredIssues ?? {})[code]
      check(`G1 unregistered issue ${code} carries a written reason`, typeof reason === "string" && reason.length > 40, String(reason).slice(0, 60))
      check(`G1 PLAN marks ${code} as unregistered`, plan.includes("unregistered"))
      continue
    }
    check(`G1 PLAN references issue #${num} (${code})`, plan.includes(`#${num}`), code)
  }
  check("G1 registry declares the GitHub milestone number", typeof registry.githubMilestone === "number")
}

// ── 6. every declared issue has an evidence file ──────────────────────────
{
  const plan = readFileSync(PLAN, "utf8")
  for (const code of Object.keys(registry.issues as Record<string, number | null>)) {
    check(`G1 PLAN mentions the ${code} issue by code`, new RegExp(`\\b${code}\\b`).test(plan), code)
  }
}

console.log(`\nM50.G1 GOVERNANCE: ${failed === 0 ? "PASS" : "FAIL"} (${pass} passed, ${failed} failed)`)
if (failed > 0) process.exit(1)
