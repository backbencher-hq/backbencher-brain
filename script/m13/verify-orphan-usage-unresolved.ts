// script/m13/verify-orphan-usage-unresolved.ts
//
// Reported on 0.1.8: "Orphan detection still false-positives. 4,570 candidates (up
// from 4,385), including jsOnEventFunc, jsRunFunc, jsEnvFunc; 32,806 usage rows
// refused (32,503 low-confidence) and 1,908 imports with 0 resolved. Dynamic JS
// registration remains invisible."
//
// THE ASYMMETRY THIS FIX IS BUILT ON: a false orphan is DANGEROUS — an agent told
// "this symbol is unreferenced" deletes live code — while a missed orphan merely
// leaves cleanup on the table. So a symbol that HAS usage rows the gate refused is
// not dead code; it is code whose usage this analyzer cannot resolve. It is now
// suppressed as `usageUnresolved` and counted, instead of being published as an
// orphan beside a disclosure nobody reads.
//
// This asserts the rule, its ORDERING (it must run before the candidate is
// published), and its reporting — the three ways this fix can silently stop
// working.

import { readFileSync } from "node:fs"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const src = readFileSync(path.resolve(import.meta.dirname, "../../src/intelligence/patterns/orphans.ts"), "utf8")

console.log("M13 orphan usage-unresolved suppression\n")

// ── the rule exists and reads the refused-evidence map ──────────────────────
check("the rule is present", /suppressed\.usageUnresolved\+\+/.test(src))
check("it keys on the symbol's REFUSED usage rows", /if \(rejectedFor\.has\(sym\.id\)\)/.test(src))

// ── ORDERING: it must run BEFORE the candidate is pushed ────────────────────
const ruleAt = src.indexOf("suppressed.usageUnresolved++")
const pushAt = src.indexOf("candidates.push({ conf: confidence")
check("both sites are present", ruleAt > 0 && pushAt > 0, `rule=${ruleAt} push=${pushAt}`)
check(
  "THE FIX: the rule runs BEFORE the candidate is published",
  ruleAt > 0 && pushAt > 0 && ruleAt < pushAt,
  "a rule after the push would still report the symbol",
)
check("the rule `continue`s, so the push is skipped for that symbol", /if \(rejectedFor\.has\(sym\.id\)\) \{ suppressed\.usageUnresolved\+\+; continue \}/.test(src))

// ── REPORTING: the count reaches the summary and the tool ───────────────────
check("the counter is initialised in the suppressed object", /usageUnresolved: 0,/.test(src))
check("the suppressed object is published as summary.suppressedByReason", /suppressedByReason: suppressed,/.test(src))

// ── the previously-refused volume is still disclosed, not lost ──────────────
check("refused usage volume is still reported (unverifiedUsageEdges)", /unverifiedUsageEdges:/.test(src))

console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "ORPHAN USAGE-UNRESOLVED: PASS" : `ORPHAN USAGE-UNRESOLVED: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
