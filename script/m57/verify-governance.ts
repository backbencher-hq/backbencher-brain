// script/m57/verify-governance.ts — M57.G1
// Governance gate for the Test Truth milestone. Real predicates over real
// files; a gate that only "looks about right" is what M57 exists to end.
//
// Checks:
//  1. gates.json: milestone/issue numbers match the registered set; every
//     non-infra gate has a mutation; every script exists on disk.
//  2. Chain wiring: every M57 gate script appears in the npm "verify" chain
//     and in "verify:m57".
//  3. The PLAN states the milestone invariant and lists the six issues with
//     their numbers.
//  4. GitHub reality: the six issues exist and carry the M57 milestone
//     (best-effort when the network is down — recorded, not excused).
//  5. The classifier module is the ONLY definition: the shared vocabulary is
//     exported and the two converted detectors import it (mirror of T5 P4 at
//     the source level).

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

let pass = 0
let failed = 0
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ok ${name}`) } else { failed++; console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`) }
}

const gates = JSON.parse(readFileSync(path.join(ROOT, "script/m57/gates.json"), "utf8"))
const EXPECTED_ISSUES: Record<string, number> = { T1: 789, T2: 790, T3: 791, T4: 792, T5: 793, X1: 794 }

// 1. registry integrity -------------------------------------------------------
check("G1.1a: milestone is M57 / GitHub #57", gates.milestone === "M57" && gates.githubMilestone === 57)
check("G1.1b: issue numbers match the registered set", JSON.stringify(gates.issues) === JSON.stringify(EXPECTED_ISSUES), JSON.stringify(gates.issues))
const nonInfra = gates.gates.filter((g: any) => !g.infra)
check("G1.1c: every non-infra gate declares a mutation", nonInfra.every((g: any) => typeof g.mutation === "string" && g.mutation.length > 10), JSON.stringify(nonInfra.map((g: any) => g.code)))
for (const g of gates.gates) {
  check(`G1.1d: script exists for ${g.code}`, existsSync(path.join(ROOT, "script/m57", g.script)))
}

// 2. chain wiring --------------------------------------------------------------
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
const chain: string = pkg.scripts?.verify ?? ""
const m57chain: string = pkg.scripts?.["verify:m57"] ?? ""
for (const g of gates.gates) {
  check(`G1.2a: ${g.script} is in the npm verify chain`, chain.includes(`script/m57/${g.script}`))
  check(`G1.2b: ${g.script} is in verify:m57`, m57chain.includes(`script/m57/${g.script}`))
}

// 3. PLAN truth -----------------------------------------------------------------
const plan = readFileSync(path.join(ROOT, "docs/m57/PLAN.md"), "utf8")
check("G1.3a: the PLAN states the milestone invariant", plan.includes("A file that is not code is never a test file"))
check("G1.3b: the PLAN lists all six issue numbers", ["789", "790", "791", "792", "793", "794"].every((n) => plan.includes(n)))

// 4. GitHub reality (best-effort; recorded, never excused) ----------------------
try {
  const out = execFileSync("gh", ["issue", "list", "--milestone", "Test Truth — the indexer must know what a test is", "--state", "all", "--json", "number", "--limit", "20"], { cwd: ROOT, encoding: "utf8", timeout: 30000 })
  const nums = JSON.parse(out).map((i: any) => i.number)
  const missing = Object.values(EXPECTED_ISSUES).filter((n) => !nums.includes(n))
  check("G1.4: all six issues are registered under the M57 milestone on GitHub", missing.length === 0, `missing=${JSON.stringify(missing)}`)
} catch (e: any) {
  check("G1.4: all six issues registered on GitHub (network unavailable — recorded, gate still demands it at closure)", false, "gh unavailable")
}

// 5. one-definition source truth ------------------------------------------------
const cls = readFileSync(path.join(ROOT, "src/ast/test-classification.ts"), "utf8")
check("G1.5a: the canonical module exports the shared vocabulary", cls.includes("export const NON_CODE_TEST_LANGUAGES") && cls.includes("export function isTestFileCandidate"))
const aca = readFileSync(path.join(ROOT, "src/ast/api-coverage-analyzer.ts"), "utf8")
const bre = readFileSync(path.join(ROOT, "src/brain/brain-relationship-enrichment.ts"), "utf8")
const ti = readFileSync(path.join(ROOT, "src/intelligence/testing/test-intel.ts"), "utf8")
check("G1.5b: api-coverage-analyzer imports the ONE definition", aca.includes('from "./test-classification"'))
check("G1.5c: relationship-enrichment imports the ONE definition", bre.includes('from "../ast/test-classification"'))
check("G1.5d: test-intel imports the shared vocabulary", ti.includes('from "../../ast/test-classification"'))

console.log(`\nG1 governance: ${pass} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
