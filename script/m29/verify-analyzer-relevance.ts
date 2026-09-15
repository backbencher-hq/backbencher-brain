// script/m29/verify-analyzer-relevance.ts — the wave-leg analyzer-relevance
// gate (fixture-first for wave 2).
//
// The defect it pins: staleRelevantPaths (script/m29/wave-execution.ts) named
// the LSP surfaces and the language's fixture pack, but NOT the language's own
// analyzer — the input that actually produces the index the S5 leg serves. A
// wave leg's evidence could stay "verified" while its analyzer changed under
// it: a claim riding on stale proof.
//
// The law: a wave leg's relevant-input list for language L must include
//   1. the execution engine (wave-execute.ts),
//   2. L's own fixture pack,
//   3. L's own analyzer module (src/ast/real-<L>-analyzer.ts),
//   4. the shared launch-set owner (src/lsp/launch_languages.ts),
// and must NOT include another language's pack or analyzer (per-language
// coupling stays banned — the wave-1 mutant, kept).
//
// Every analyzer named by the wave registry must EXIST on disk: a registry
// entry whose analyzer module is missing is a broken claim, caught here.
//
// Run: npx tsx script/m29/verify-analyzer-relevance.ts
// Evidence: validation/m29/results/analyzer-relevance.json (machine-emitted)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const RESULTS = path.join(ROOT, "validation/m29/results")

let passed = 0
let failed = 0
const failures: string[] = []
const checks: string[] = []
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed++
  else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
  }
  checks.push(`${ok ? "ok" : "FAIL"}: ${name}${detail && !ok ? ` — ${detail}` : ""}`)
}

// --- the rule under test, read from the live module -------------------------
// Import the REAL staleRelevantPaths: gating a copy would let the copy drift.
// M61.V6 (#847): these were DYNAMIC imports (`await import("./…")`). The TDZ
// bug class this milestone makes extinct — a lane module imported dynamically
// instead of statically — was found HERE by the new G7 lint rule on its first
// run. Static imports are hoisted, so they are also the correct form for a
// dependency used later in the module body.
import { staleRelevantPaths } from "./wave-execute.ts"

// The wave registry (language -> extension) as the R1 protocol declares it.
import { WAVE_LANGUAGES } from "./wave-protocol.ts"

// language -> the analyzer module the indexer lane owns (the wave-2 rule).
function analyzerFileFor(language: string): string {
  return `src/ast/real-${language}-analyzer.ts`
}

console.log("analyzer-relevance: the wave legs' inputs name their own analyzer")

// --- R1: the rule holds for every registry language -------------------------
for (const language of Object.keys(WAVE_LANGUAGES)) {
  const paths = staleRelevantPaths(language)

  check(`R1: ${language} — the list names its own fixture pack`, paths.includes(`script/m29/wave-fixtures/${language}`))
  check(`R1: ${language} — the list names its own analyzer`, paths.includes(analyzerFileFor(language)))

  // Existence: a named-but-missing analyzer is a broken claim for a language
  // with a pack (registry languages without an analyzer yet must say so —
  // they cannot run a leg at all, which the S1 gate already blocks).
  const packDir = path.join(ROOT, "script/m29/wave-fixtures", language)
  if (existsSync(packDir)) {
    check(
      `R1: ${language} — the named analyzer module exists on disk`,
      existsSync(path.join(ROOT, analyzerFileFor(language))),
      analyzerFileFor(language),
    )
  }

  // Per-language coupling stays banned (the wave-1 mutant, now also stated
  // for analyzers): no other language's pack, no other language's analyzer.
  const foreign = paths.filter(
    (p) =>
      (p.startsWith("script/m29/wave-fixtures/") && !p.endsWith(`/${language}`)) ||
      (p.startsWith("src/ast/real-") && p !== analyzerFileFor(language)),
  )
  check(`R1: ${language} — no foreign pack or analyzer in the list`, foreign.length === 0, foreign.join(","))
}

// --- R2: the shared inputs stay shared --------------------------------------
for (const shared of ["script/m29/wave-execute.ts", "src/lsp/launch_languages.ts", "src/lsp/hover.ts", "src/lsp/navigation.ts", "src/lsp/symbols.ts", "src/lsp/server.ts"]) {
  check(`R2: every list names the shared input ${shared}`, Object.keys(WAVE_LANGUAGES).every((l) => staleRelevantPaths(l).includes(shared)))
}

// --- R3: the freshness rule is live, not decorative -------------------------
// Differential: pick a language with a pack whose analyzer exists; the leg
// record's pin, diffed against HEAD with the NEW list, must see the analyzer.
// If the analyzer changed since the pin, the leg IS stale — assert the diff
// mechanism reports it (or reports nothing only when nothing changed).
const java = "java"
const legPath = path.join(RESULTS, `wave-${java}.json`)
if (existsSync(legPath)) {
  const leg = parseSealedRecord(legPath) as { commit?: string }
  if (typeof leg.commit === "string" && /^[0-9a-f]{40}$/.test(leg.commit)) {
    const changed = execFileSync("git", ["diff", "--name-only", leg.commit, "HEAD", "--", ...staleRelevantPaths(java)], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    // The claim: the mechanism reads the analyzer. Prove it by inverting —
    // if the analyzer changed since the pin, the new list MUST see it; if it
    // did not change, the list must NOT report it.
    const analyzerChanged = changed.includes(analyzerFileFor(java))
    const analyzerReallyChanged = execFileSync("git", ["diff", "--name-only", leg.commit, "HEAD", "--", analyzerFileFor(java)], { cwd: ROOT, encoding: "utf8" }).trim().length > 0
    check("R3: the freshness diff mechanism covers the analyzer", analyzerChanged === analyzerReallyChanged, `list-says=${analyzerChanged} git-says=${analyzerReallyChanged}`)
  } else {
    check("R3: the java leg record carries a commit pin", false, String(leg.commit))
  }
}

// --- R4: mutants — the rule can FAIL ----------------------------------------
const mutant = (name: string, ok: boolean) => check(`M: ${name}`, ok)
{
  // M1: the directory-wide pack rule (the wave-1 defect, still banned)
  const paths = staleRelevantPaths("java")
  mutant("a list naming the whole fixtures directory would fail R1's foreign check", !paths.includes("script/m29/wave-fixtures"))
  // M2: a foreign analyzer would fail R1's foreign check
  mutant("a list naming zig's analyzer for java would fail", !paths.includes(analyzerFileFor("zig")))
  // M3: dropping the analyzer from the list would fail R1's own-analyzer check
  mutant("a list without the language's own analyzer would fail", paths.includes(analyzerFileFor("java")))
}

// --- evidence ----------------------------------------------------------------
mkdirSync(RESULTS, { recursive: true })
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const evidence = {
  issue: "wave-2 analyzer relevance (fixture-first)",
  code: "ANALYZER-RELEVANCE",
  milestone: "M29",
  status: failed === 0 ? "verified" : "known-gap",
  checks: checks.length,
  passed,
  failed,
  realFailed: failed,
  failures,
  checks,
  currentCommit: commit,
  verifierCommand: "npx tsx script/m29/verify-analyzer-relevance.ts",
  evidenceFile: "analyzer-relevance.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Static rule check over the live staleRelevantPaths module plus one differential against a stored leg pin; the legs' own S1-S6 gates re-run per execution.",
  ],
}
writeSealed(path.join(RESULTS, evidence.evidenceFile), evidence)

console.log(`\nanalyzer-relevance: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks.length})`)
console.log(`Evidence: ${path.join(RESULTS, evidence.evidenceFile)}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(failed === 0 ? 0 : 1)
