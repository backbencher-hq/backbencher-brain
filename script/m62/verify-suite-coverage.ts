#!/usr/bin/env tsx
// script/m62/verify-suite-coverage.ts — every gate in script/m62 must be either
// RUN BY THE SUITE or DELIBERATELY LEFT OUT, with a reason on record.
//
// FOUND 2026-10-10 immediately after adding two red gates. verify-suite.mts lists
// its legs EXPLICITLY, which is the right design — a suite that globs a directory
// picks up half-finished probes and scratch scripts as if they were gates. But the
// consequence is that a gate written into script/m62 and never added to the list is
// INVISIBLE: it does not fail the suite, it does not appear in the blocked column,
// and nothing says it exists.
//
// That is the same failure as a gate that reads nothing, one level up. A gate that
// is never run cannot fail, and a gate that cannot fail is indistinguishable from a
// gate that passes. Two red gates were sitting in the tree reporting exit 1 to
// whoever typed their name, while the suite said "18 green, 0 red".
//
// The honest states are three, not two:
//   (a) IN THE SUITE   — it runs, and its verdict counts.
//   (b) BLOCKED        — it runs, exits non-zero, and the allowlist names WHY it
//                        cannot pass here (an environment block, honestly stated).
//   (c) UNRESOLVED     — it runs, exits non-zero, and the failure is an open
//                        QUESTION rather than an environment block. It must be named
//                        as such, because "blocked" means "cannot run here" and
//                        laundering a question into that column is precisely how a
//                        wrong measurement survives.
//
// What this gate forbids is the fourth state: present in script/m62, running red,
// and mentioned nowhere.
//
// It also forbids the opposite error — a leg listed in the suite that does not exist
// or has been renamed, which would read as green while verifying nothing.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()
const SUITE = path.join(ROOT, "script/m62/verify-suite.mts")
const suiteSrc = readFileSync(SUITE, "utf8")

// A gate counts as RUN if EITHER the suite runs it OR `npm run verify` reaches it.
// The first version of this gate only knew about verify-suite.mts and therefore
// reported six long-standing m62 gates (verify-closure, verify-docs, verify-address,
// verify-arrival, verify-consumers, verify-governance) as unaccounted-for, when they
// are wired into the main chain. A gate that cries wolf about healthy gates gets its
// findings ignored, so the run-set has to be complete before it can be trusted.
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>
}
const verifyChain = Object.values(pkg.scripts ?? {}).join("\n")
const chainGates = new Set([...verifyChain.matchAll(/script\/m62\/[\w.-]+\.(?:ts|mts)/g)].map((m) => m[0]))

// Legs the suite runs, and the allowlist of honest blocks.
const listedLegs = [...suiteSrc.matchAll(/script:\s*"([^"]+)"/g)].map((m) => m[1]!)
const allowBlock = suiteSrc.match(/ALLOW[^=]*=\s*(?:new Set\()?\[([\s\S]*?)\]/)?.[1] ?? ""
const allowedBlocks = new Set(
  [...allowBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]!),
)

// Gates that live in script/m62 and are meant to be run by the suite. A file named
// verify-* in that directory IS a gate; anything else (harnesses, scanners, shared
// libraries) is not, and is not this gate's business.
const { walkSourceFiles } = await import("./path_encoding_scan.ts")
const m62Gates = walkSourceFiles(path.join(ROOT, "script/m62"))
  .map((f) => path.relative(ROOT, f))
  // verify-suite.mts is the RUNNER, not a gate — excluding it stops this gate from
  // demanding that the suite list itself.
  .filter((f) => /verify-.*\.(ts|mts)$/.test(f) && !f.endsWith("verify-suite.mts"))
  .sort()

check(
  "the suite file was readable (an empty leg list means the parse failed, not that the suite is empty)",
  listedLegs.length >= 15 && existsSync(SUITE),
  `${listedLegs.length} leg(s) parsed from verify-suite.mts`,
)

// Every gate in script/m62 must be accounted for.
const unaccounted: string[] = []
const resolvedDeliberately: string[] = []
const runSomewhere = (g: string): "suite" | "verify-chain" | null =>
  listedLegs.includes(g) ? "suite" : chainGates.has(g) ? "verify-chain" : null

for (const g of m62Gates) {
  if (runSomewhere(g) !== null) continue
  if (allowedBlocks.has(g)) continue
  // A gate that names its own unresolved questions in its header is declaring itself
  // category (c). That is not a loophole — it is the declaration being present at
  // all — but it has to be a real declaration, so require the specific phrase.
  const src = readFileSync(path.join(ROOT, g), "utf8")
  const declaresUnresolved =
    /stays? red on purpose|this gate stays red|deliberately red|not on the (?:suite|blocked) allowlist/i.test(src)
  if (declaresUnresolved) resolvedDeliberately.push(g)
  else unaccounted.push(g)
}

check(
  "every gate in script/m62 is either IN THE SUITE or declares itself unresolved in its own header",
  unaccounted.length === 0,
  unaccounted.length === 0
    ? `${m62Gates.length} gate(s) in script/m62: ` +
      `${m62Gates.filter((g) => runSomewhere(g) === "suite").length} run by verify:suite, ` +
      `${m62Gates.filter((g) => runSomewhere(g) === "verify-chain").length} reached by \`npm run verify\`, ` +
      `${allowedBlocks.size} on the honest-block allowlist, ${resolvedDeliberately.length} declaring unresolved questions` +
      (resolvedDeliberately.length > 0 ? ` (${resolvedDeliberately.join(", ")})` : "")
    : `*** ${unaccounted.length} gate(s) exist in script/m62, are not run by the suite, are not on the blocked allowlist, ` +
      `and do not declare an unresolved question: ${unaccounted.join(", ")}. A gate that is never run cannot fail, and a ` +
      `gate that cannot fail is indistinguishable from a gate that passes. ***`,
)

// The opposite error: a listed leg whose file is gone.
const missing: string[] = []
for (const leg of listedLegs) {
  if (leg.startsWith("npm ") || leg.includes(" ")) continue // shell legs, not file paths
  if (!existsSync(path.join(ROOT, leg))) missing.push(leg)
}
check(
  "every file leg the suite runs actually exists (a renamed leg reads as green while verifying nothing)",
  missing.length === 0,
  missing.length === 0
    ? `${listedLegs.length} legs checked, none missing`
    : `*** ${missing.length} leg(s) reference a file that does not exist: ${missing.join(", ")} ***`,
)

if (unaccounted.length > 0) {
  console.log(
    `\n  For each unaccounted gate, pick ONE and make it true:\n` +
      `    - add it to verify-suite.mts so its verdict counts;\n` +
      `    - add it to the honest-block allowlist WITH the environment reason it cannot pass here;\n` +
      `    - or, if it is red on an open QUESTION rather than an environment block, say so in its own\n` +
      `      header. "Blocked" means "cannot run here"; a question is not an environment block, and\n` +
      `      filing it there is how a wrong measurement survives.`,
  )
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nSUITE COVERAGE: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)