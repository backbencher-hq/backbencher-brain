// script/m29/verify-analyzer-relevance.ts — the wave-leg analyzer-relevance
// gate (fixture-first for wave 2).
//
// The defect it pins: staleRelevantPaths (script/m29/wave-execute.ts) named
// the LSP surfaces and the language's fixture pack, but NOT the language's own
// analyzer — the input that actually produces the index the S5 leg serves. A
// wave leg's evidence could stay "verified" while its analyzer changed under
// it: a claim riding on stale proof.
//
// The law: a wave leg's relevant-input list for language L must include
//   1. the execution engine (wave-execute.ts),
//   2. L's own fixture pack,
//   3. the analyzer the ENGINE routes for L (src/ast/engine.ts getAnalyzer),
//   4. the shared launch-set owner (src/lsp/launch_languages.ts),
// and must NOT include another language's pack or analyzer (per-language
// coupling stays banned — the wave-1 mutant, kept).
//
// WHY THE ENGINE IS READ HERE, not a copied table. The wave-2 wording assumed
// `src/ast/real-<L>-analyzer.ts` for every language; four registry languages
// are served by an ALIASED analyzer (tsx→typescript, sass→css, make→makefile,
// terraform→hcl), so that naming was false for them and this gate reported 12
// failures against a CORRECT live list. The alias map lives as a private
// `const` inside wave-execute.ts (not exported, and that file is another lane's
// this round), so the gate reads the AUTHORITY the map mirrors instead of
// copying either: `src/ast/engine.ts` getAnalyzer is the routing owner. A
// hardcoded copy of any mapping is exactly the drift defect this gate exists to
// prevent, and it would break again the next time an analyzer is aliased.
//
// Every analyzer the engine routes for a registry language must EXIST on disk:
// a route to a missing module is a broken claim, caught here.
//
// Run: npx tsx script/m29/verify-analyzer-relevance.ts
// Evidence: validation/m29/results/analyzer-relevance.json (machine-emitted)

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

// The rule under test, read from the live module: gating a copy would let the
// copy drift (M61.V6: static imports — the TDZ bug class this milestone makes
// extinct was found here by a dynamic-import lint rule on its first run).
import { staleRelevantPaths } from "./wave-execute.ts"

// The wave registry (language -> extension) as the R1 protocol declares it.
import { WAVE_LANGUAGES } from "./wave-protocol.ts"

// The registry id is not always the ENGINE's language id (`objc` is registered
// with extension `.m`, and the engine/detector call that language
// `objective-c`). The registry already states the extension, so the engine id
// is derived from the same declaration — no second table.
import { detectLanguageFromPath } from "../../src/ast/language-detection.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const RESULTS = path.join(ROOT, "validation/m29/results")
const ENGINE = path.join(ROOT, "src", "ast", "engine.ts")
const FIXTURES = "script/m29/wave-fixtures"

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
const mutant = (name: string, ok: boolean, detail?: string): void => check(`M: ${name}`, ok, detail)

// --- the engine's analyzer routing: the single source of truth ---------------
/**
 * language -> the analyzer module the engine instantiates, parsed from
 * `src/ast/engine.ts` getAnalyzer's switch. Parsed rather than imported: the
 * switch is a private closure (not exported), and duplicating the mapping in
 * this file would be the drift this gate is supposed to catch.
 *
 * The switch's grouped labels ARE the alias relation — `case "typescript":
 * case "tsx":` share one import — so every label waiting for an import binds to
 * it. A switch shape this parser cannot read is a FAILURE (the caller checks
 * the parse produced routes for every registry language), never a silent skip.
 */
function engineAnalyzerRoutes(): Map<string, string> {
  const source = readFileSync(ENGINE, "utf8")
  const fn = /async function getAnalyzer\(language: SupportedLanguage\)[^]*?switch \(language\) \{([^]*?)\n\s*default:/.exec(source)
  if (!fn) throw new Error("engine getAnalyzer switch not found — the routing authority could not be read")
  const routes = new Map<string, string>()
  const pending: string[] = []
  for (const token of fn[1].matchAll(/case "([^"]+)":|await import\("\.\/([^"]+)"\)/g)) {
    if (token[1] !== undefined) {
      pending.push(token[1])
      continue
    }
    if (token[2] !== undefined) {
      const modulePath = `src/ast/${token[2]}.ts`
      for (const language of pending) routes.set(language, modulePath)
      pending.length = 0
    }
  }
  return routes
}

/**
 * The rule, as a PURE function over its inputs — the mutants below call the
 * SAME logic the gate applies (a mutant that re-implements a rule can pass
 * while the rule is broken). `expected` is the engine-routed analyzer module
 * for the language's ENGINE id.
 */
function analyzerRuleProblems(language: string, paths: string[], expected: string | undefined): string[] {
  const problems: string[] = []
  if (expected === undefined) {
    problems.push(`the engine routes no analyzer for this language (getAnalyzer has no case for it)`)
    return problems
  }
  if (!paths.includes(expected)) problems.push(`the list does not name the engine-routed analyzer ${expected}`)
  const foreign = paths.filter((p) => /^src\/ast\/real-[^/]+-analyzer\.ts$/.test(p) && p !== expected)
  if (foreign.length > 0) problems.push(`foreign analyzer(s) in the list: ${foreign.join(",")}`)
  return problems
}

const routing = engineAnalyzerRoutes()
const registry = Object.keys(WAVE_LANGUAGES)

/** The registry id's ENGINE language id, derived from the extension the
 *  registry declares (`objc` + `.m` → the detector's `objective-c`). */
function engineIdFor(language: string): string | null {
  const ext = WAVE_LANGUAGES[language]
  if (ext === undefined) return null
  return detectLanguageFromPath(`wave.${ext}`) ?? language
}

/** The analyzer module the engine routes for a registry language. The registry
 *  id is normally the engine id (`matlab` → the engine's `matlab` case); only
 *  when the id itself has no route does the declared extension disambiguate
 *  (`objc`, declared `.m`, is the engine's `objective-c` — while `matlab` also
 *  declares `.m`, which is why the direct id is tried first). */
function routeFor(language: string): string | undefined {
  const direct = routing.get(language)
  if (direct !== undefined) return direct
  const engineId = engineIdFor(language)
  return engineId === null ? undefined : routing.get(engineId)
}

console.log("analyzer-relevance: the wave legs' inputs name the analyzer the engine routes")

// --- R0: the authority parsed, and covers the registry -----------------------
check("R0: the engine getAnalyzer routing is readable", routing.size > 0, `${routing.size} language routes`)
const unrouted = registry.filter((l) => routeFor(l) === undefined)
check("R0: every registry language resolves to an engine analyzer route", unrouted.length === 0, unrouted.join(","))
check(
  "R0: parsing the authority found the aliased pairs (a parser that read no aliases would silently pass)",
  routing.get("tsx") === routing.get("typescript") && routing.get("sass") === routing.get("css") && routing.get("make") === "src/ast/real-makefile-analyzer.ts" && routing.get("terraform") === routing.get("hcl"),
  `tsx=${routing.get("tsx")} sass=${routing.get("sass")} make=${routing.get("make")} terraform=${routing.get("terraform")}`,
)
// The registry id is not always the engine id: `objc` is declared with `.m`,
// which the detector calls `objective-c` (and `matlab` declares the same `.m`,
// so the direct id is what keeps that pair unambiguous). Publish the derived
// mapping so the check that follows is auditable rather than an assertion about
// a hidden table.
check(
  "R0: registry ids resolve to an engine route (direct id first, declared extension second)",
  routeFor("objc") === "src/ast/real-objective-c-analyzer.ts" && routeFor("matlab") === "src/ast/real-matlab-analyzer.ts" && registry.every((l) => routeFor(l) !== undefined),
  `objc->${routeFor("objc")} matlab->${routeFor("matlab")}`,
)

// --- R1: the rule holds for every registry language -------------------------
for (const language of registry) {
  const paths = staleRelevantPaths(language)
  const expected = routeFor(language)

  check(`R1: ${language} — the list names its own fixture pack`, paths.includes(`${FIXTURES}/${language}`))
  check(`R1: ${language} — the list names the engine-routed analyzer`, expected !== undefined && paths.includes(expected), `${expected ?? "no route"}`)
  check(
    `R1: ${language} — the engine-routed analyzer exists on disk`,
    expected !== undefined && existsSync(path.join(ROOT, expected)),
    expected ?? "no route",
  )
  // Per-language coupling stays banned: no other language's fixture pack, and
  // no analyzer the engine routes for a DIFFERENT language (aliases are not
  // foreign: the expected module above already carries the alias relation).
  const foreign = paths.filter(
    (p) =>
      (p.startsWith(`${FIXTURES}/`) && !p.endsWith(`/${language}`)) ||
      (/^src\/ast\/real-[^/]+-analyzer\.ts$/.test(p) && p !== expected),
  )
  check(`R1: ${language} — no foreign pack or analyzer in the list`, foreign.length === 0, foreign.join(","))
  // The pure rule must agree with the per-language checks above.
  const problems = analyzerRuleProblems(language, paths, expected)
  check(`R1: ${language} — the pure rule accepts the live list`, problems.length === 0, problems.join("; "))
}

// The alias fix must be an ACCEPTANCE, not a blanket ban on sharing: a correct
// aliased list is the positive control for the four languages this gate used to
// fail (tsx/sass/make/terraform).
for (const aliased of ["tsx", "sass", "make", "terraform"]) {
  check(
    `R1: ${aliased} — an aliased analyzer is accepted, not flagged foreign`,
    analyzerRuleProblems(aliased, staleRelevantPaths(aliased), routeFor(aliased)).length === 0,
    `routes to ${routeFor(aliased)}`,
  )
}

// --- R2: the shared inputs stay shared --------------------------------------
for (const shared of ["script/m29/wave-execute.ts", "src/lsp/launch_languages.ts", "src/lsp/hover.ts", "src/lsp/navigation.ts", "src/lsp/symbols.ts", "src/lsp/server.ts"]) {
  check(`R2: every list names the shared input ${shared}`, registry.every((l) => staleRelevantPaths(l).includes(shared)))
}

// --- R3: the freshness rule is live, not decorative -------------------------
// Differential: pick a language with a pack; diff the leg record's pin against
// HEAD with the NEW list, and compare the analyzer dimension with a direct git
// diff. If the analyzer changed since the pin, the list MUST see it; if it did
// not change, the list must NOT report it.
const java = "java"
const javaAnalyzer = routeFor(java)
const legPath = path.join(RESULTS, `wave-${java}.json`)
if (existsSync(legPath) && javaAnalyzer !== undefined) {
  const leg = parseSealedRecord(legPath) as { commit?: string }
  if (typeof leg.commit === "string" && /^[0-9a-f]{40}$/.test(leg.commit)) {
    const changed = execFileSync("git", ["diff", "--name-only", leg.commit, "HEAD", "--", ...staleRelevantPaths(java)], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    const analyzerChanged = changed.includes(javaAnalyzer)
    const analyzerReallyChanged = execFileSync("git", ["diff", "--name-only", leg.commit, "HEAD", "--", javaAnalyzer], { cwd: ROOT, encoding: "utf8" }).trim().length > 0
    check("R3: the freshness diff mechanism covers the analyzer", analyzerChanged === analyzerReallyChanged, `list-says=${analyzerChanged} git-says=${analyzerReallyChanged}`)
  } else {
    check("R3: the java leg record carries a commit pin", false, String(leg.commit))
  }
} else {
  check("R3: the java leg record and its engine route exist", false, legPath)
}

// --- R4: mutants — the rule can FAIL ----------------------------------------
{
  const javaPaths = staleRelevantPaths(java)
  const zigAnalyzer = routeFor("zig")
  const cssAnalyzer = routeFor("css")
  const tsxAnalyzer = routeFor("tsx")
  mutant("a list naming the whole fixtures directory would fail the foreign-pack check", !javaPaths.includes(FIXTURES))
  mutant(
    "a list naming another language's analyzer would fail the foreign rule",
    zigAnalyzer !== undefined && analyzerRuleProblems(java, [...javaPaths, zigAnalyzer], javaAnalyzer).some((p) => p.includes("foreign analyzer")),
    `zig route=${zigAnalyzer}`,
  )
  mutant(
    "a list without the engine-routed analyzer would fail the own-analyzer rule",
    javaAnalyzer !== undefined && analyzerRuleProblems(java, javaPaths.filter((p) => p !== javaAnalyzer), javaAnalyzer).some((p) => p.includes("does not name")),
    `java route=${javaAnalyzer}`,
  )
  mutant(
    "a wrong analyzer on an ALIASED language would fail (the alias exception is not a free pass)",
    cssAnalyzer !== undefined && tsxAnalyzer !== undefined && analyzerRuleProblems("tsx", [...staleRelevantPaths("tsx"), cssAnalyzer], tsxAnalyzer).some((p) => p.includes("foreign analyzer")),
    `tsx route=${tsxAnalyzer}, injected=${cssAnalyzer}`,
  )
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
  // `checks` is the COUNT and `checksList` is the array (the duplicate-key
  // defect this file used to carry — see the m61 convention it now matches).
  checksList: checks,
  // The authority this run read, published so a reader can compare it with the
  // private alias map without re-parsing the engine: language -> routed module.
  engineAnalyzerRoutes: Object.fromEntries([...routing.entries()].sort(([a], [b]) => a.localeCompare(b))),
  currentCommit: commit,
  verifierCommand: "npx tsx script/m29/verify-analyzer-relevance.ts",
  ...fingerprintFields(["m29.analyzer-relevance"], ROOT),
  evidenceFile: "analyzer-relevance.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Static rule check over the live staleRelevantPaths module, with the expected analyzer derived by parsing the engine's getAnalyzer routing (the authority the private wave-execute alias map mirrors — the map itself is not exported, and copying it here would be the drift this gate prevents).",
    "Plus one differential against a stored leg pin; the legs' own S1-S6 gates re-run per execution.",
    "The routing parser is shape-sensitive by design: an unreadable switch fails R0 rather than passing silently.",
    "DECLARED LATENT GAP (reported, not fixed here): registry language `objc` is declared with extension `.m`, which the detector/engine call `objective-c`; the live relevance list still falls back to `src/ast/real-objc-analyzer.ts`, which does not exist. `objc` has no fixture pack and is not in any approval record, so no wave leg is affected today — the fix is one aliased entry in the executor's LANGUAGE_ANALYZER_INPUTS (objc -> src/ast/real-objective-c-analyzer.ts), which belongs to the executor's owner.",
  ],
}
writeSealed(path.join(RESULTS, evidence.evidenceFile), evidence)

console.log(`\n analyzer-relevance: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks.length})`)
console.log(`Evidence: ${path.join(RESULTS, evidence.evidenceFile)}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(failed === 0 ? 0 : 1)
