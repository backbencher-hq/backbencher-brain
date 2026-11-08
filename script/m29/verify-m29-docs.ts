// script/m29/verify-m29-docs.ts — M29.D1 verifier + drift/mutation suite
// (issue #542).
//
// "Docs are claims; both artifacts are generated, drift-gated." Proves the
// two published artifacts (WAVE-PROTOCOL.md, PRECISION-LEDGER.md) are
// generated truth — and that the suite CAN FAIL:
//
//   D1 regeneration:  byte-identical regeneration for both artifacts
//                     (WAVE-PROTOCOL via generate-wave-doc.ts, PRECISION-
//                     LEDGER via buildLedger) — a hand edit to either fails
//   D2 vocabulary:    the banned-vocabulary lint (same patterns as the
//                     governance gate) over both artifacts + the listing —
//                     an "always/100%/all languages" claim fails
//   D3 claim match:   every claim level in the MD equals the machine ledger
//                     JSON; the listing's table matches the ledger's claims
//   D4 cross-refs:    evidence paths named by the docs exist on disk
//   M1-M3:            mutants — hand-edited protocol step, an "always"
//                     vocabulary violation, a published claim mutated upward —
//                     each caught (and each records a detail on escape)
//
// Run: npx tsx script/m29/verify-m29-docs.ts
// Evidence: validation/m29/results/D1-verify.json (machine-emitted)

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { buildLedger } from "./generate-precision-ledger.ts"
import { generateWaveDoc } from "./generate-wave-doc.ts"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const WAVE_DOC = path.join(ROOT, "docs/m29/WAVE-PROTOCOL.md")
const LEDGER_MD = path.join(ROOT, "docs/m29/PRECISION-LEDGER.md")
const LEDGER_JSON = path.join(ROOT, "validation/m29/results/PRECISION-LEDGER.json")
const README = path.join(ROOT, "ide/vscode/README.md")

let passed = 0
let failed = 0
const details: string[] = []
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok && detail) details.push(`${name}: ${detail}`)
}
const mutants = { caught: 0, total: 0 }
function negative(name: string, caught: boolean, detail?: string): void {
  mutants.total++
  if (caught)
    mutants.caught++
  if (caught) passed++
  else failed++
  console.log(`  ${caught ? "CAUGHT" : "ESCAPED"}: ${name}${detail ? ` — ${detail}` : ""}`)
  if (!caught && detail) details.push(`${name}: ${detail}`)
}
function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

// The banned-vocabulary patterns (same list the governance gate enforces).
const BANNED_PATTERNS: RegExp[] = [
  /\balways\b/i,
  /\bnever fails\b/i,
  /\b100%\b/,
  /\ball languages\b/i,
  /\bcomplete coverage\b/i,
  /\bworks in (cursor|windsurf|antigravity|vs code)\b/i,
]

console.log("M29.D1 verifier — generated docs drift + honesty (issue #542)\n")

// ---------------------------------------------------------------------------
// D1: byte-identical regeneration for BOTH artifacts
// ---------------------------------------------------------------------------
const waveFresh = generateWaveDoc()
const ledgerFresh = buildLedger()
let waveDisk = ""
let ledgerDisk = ""
let ledgerJsonDisk = ""
try { waveDisk = readFileSync(WAVE_DOC, "utf8") } catch {}
try { ledgerDisk = readFileSync(LEDGER_MD, "utf8") } catch {}
try { ledgerJsonDisk = readFileSync(LEDGER_JSON, "utf8") } catch {}
check("D1: WAVE-PROTOCOL.md regenerates byte-identically", waveDisk === waveFresh, waveDisk === waveFresh ? undefined : "hand edit or protocol change without regeneration — regenerate with generate-wave-doc.ts")
check("D1: PRECISION-LEDGER.md regenerates byte-identically", ledgerDisk === ledgerFresh.md, ledgerDisk === ledgerFresh.md ? undefined : "hand edit or evidence change — regenerate with --write")
check("D1: PRECISION-LEDGER.json regenerates byte-identically", ledgerJsonDisk === ledgerFresh.json, ledgerJsonDisk === ledgerFresh.json ? undefined : "hand edit — regenerate with --write")

// ---------------------------------------------------------------------------
// D2: vocabulary lint over both artifacts + the listing
// ---------------------------------------------------------------------------
for (const [name, text] of [["WAVE-PROTOCOL.md", waveDisk], ["PRECISION-LEDGER.md", ledgerDisk], ["listing README", readFileSync(README, "utf8")]] as Array<[string, string]>) {
  const violations = BANNED_PATTERNS.map((p) => p.exec(text)?.[0]).filter(Boolean)
  check(`D2: no banned vocabulary in ${name}`, violations.length === 0, violations.join("; "))
}

// ---------------------------------------------------------------------------
// D3: claim levels in docs match the machine ledger
// ---------------------------------------------------------------------------
const machine = JSON.parse(ledgerFresh.json) as { languages: Array<{ language: string; claim: string }> }
let claimChecks = 0
let claimAgree = 0
const drift: string[] = []
for (const row of machine.languages) {
  const re = new RegExp(`\\| ${row.language} \\| (I[0-3]) \\|`)
  const mdClaim = re.exec(ledgerDisk)?.[1]
  claimChecks++
  if (mdClaim === row.claim) claimAgree++
  else drift.push(`${row.language}: md=${mdClaim} machine=${row.claim}`)
}
check("D3: every claim level in the published MD equals the machine ledger", claimChecks > 0 && claimAgree === claimChecks, drift.join("; ") || `${claimAgree}/${claimChecks}`)
// The listing's shipped table stays at its conservative floor (I1) — it must
// never claim ABOVE the ledger's computed levels.
{
  const readme = readFileSync(README, "utf8")
  const listingRows = readme.match(/^\| (?:java|groovy|kotlin|scala|typescript|javascript|python)\s*\|.*$/gim) ?? []
  const overClaim = listingRows.filter((r) => /\bI[2-4]\b/.test(r))
  const ledgerClaims: Record<string, string> = {}
  for (const row of machine.languages) ledgerClaims[row.language] = row.claim
  const above = listingRows.filter((r) => {
    const lang = /^\| (\w+)/.exec(r)?.[1]?.toLowerCase()
    const claim = /\b(I[0-3])\b/.exec(r)?.[1]
    return lang && claim && ledgerClaims[lang] && claim > ledgerClaims[lang]!
  })
  check("D3: listing table carries no claim above the machine ledger", overClaim.length === 0 && above.length === 0, [...overClaim, ...above].join("; ") || `${listingRows.length} rows checked`)
}

// ---------------------------------------------------------------------------
// D4: evidence paths named by the docs exist
// ---------------------------------------------------------------------------
const paths = [...ledgerDisk.matchAll(/validation\/m[0-9]+\/results\/[A-Za-z0-9._-]+\.json/g)].map((m) => m[0])
check("D4: every evidence path named by the ledger exists", paths.length >= 7 && paths.every((p) => existsSync(path.join(ROOT, p))), `${paths.length} paths`)
check("D4: the wave doc names the runner command", waveDisk.includes("npx tsx script/m29/wave-protocol.ts --language"))

// ---------------------------------------------------------------------------
// M1-M3: mutation proofs
// ---------------------------------------------------------------------------
// M1: a hand-edited protocol doc (tampered step wording) fails regeneration.
const tamperedWave = waveDisk.replace("S6 `S6-editor-leg`", "S6 `S6-editor-leg-TAMPERED`")
negative("M1: hand-edited wave doc fails regeneration", tamperedWave !== waveDisk && tamperedWave !== waveFresh)
// M2: an "always" claim in the ledger fails the vocabulary lint.
negative("M2: banned vocabulary in a doc is caught", BANNED_PATTERNS.some((p) => p.test("This server always works in Cursor.")))
// M3: mutating a PUBLISHED claim upward is caught by the D3 match. The needle
// is derived from today's ledger, never hardcoded: this mutant used to assume
// "groovy has NO machine claim (not wave-onboarded)" — true only while the
// ledger published wave 1 — so wave-2 aggregation gave groovy a claim, killed
// the premise and the mutant ESCAPED a red gate. The premise is now
// data-derived: take a row whose claim is the LOWEST currently published (an I0
// row, which exists while any approved language lacks a verified S5 leg), find
// its real published MD row, mutate the claim upward to I2, and re-run the same
// D3 extraction the claim-match check uses — the mutation MUST be detected, and
// the detail is recorded when it is not (§8.3: an escape must never be silent).
const m3Candidate = machine.languages.find((r) => r.claim === "I0")
const m3ForgedClaim = "I2"
const m3Detail = m3Candidate
  ? `mutated ${m3Candidate.language}'s published claim ${m3Candidate.claim} -> ${m3ForgedClaim} (row derived from the ledger, not hardcoded)`
  : "no I0 row in the machine ledger — re-derive this mutant rather than leaving it unable to fail"
negative(
  "M3: mutating a published ledger claim upward is caught by the D3 claim match",
  (() => {
    if (!m3Candidate) return false
    const re = new RegExp(`\\| ${m3Candidate.language} \\| (I[0-3]) \\|`)
    const realClaim = re.exec(ledgerDisk)?.[1]
    if (realClaim !== m3Candidate.claim) return false
    const mutated = ledgerDisk.replace(re, `| ${m3Candidate.language} | ${m3ForgedClaim} |`)
    const mutatedClaim = re.exec(mutated)?.[1]
    // The D3 loop compares every published claim to the machine ledger; the
    // mutation must make the two disagree, and it must be a real change.
    return mutated !== ledgerDisk && mutatedClaim === m3ForgedClaim && mutatedClaim !== m3Candidate.claim
  })(),
  m3Detail,
)

// ---------------------------------------------------------------------------
// Emit evidence + verdict
// ---------------------------------------------------------------------------
const result = {
  status: failed === 0 ? "verified" : "known-gap",
  passed,
  failed,
  negatives: { planned: 3 },
  verdict: { realComponentFailures: failed, mutantsCaught: mutants.caught, mutantsTotal: mutants.total, ok: mutants.caught === mutants.total },
  currentCommit: gitCommit(),
  verifierCommand: "npx tsx script/m29/verify-m29-docs.ts",
  ...fingerprintFields(["m29.D1-verify"], ROOT),
  evidenceFile: "D1-verify.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "The listing's shipped claim table is intentionally at the conservative I1 floor (M25's drift gate owns it); D1 checks it never rises above the machine ledger, not that it equals it.",
    "Vocabulary lint is pattern-based; novel overclaim phrasings are caught by review and the owner spot-check, not by this lint.",
    "The wave doc's registry list is generated from WAVE_LANGUAGES; adding a language to the registry regenerates the doc (drift gate enforces regeneration).",
  ],
  details: details.slice(0, 10),
}
writeSealed(path.join(ROOT, "validation/m29/results/D1-verify.json"), result)
console.log(`D1: ${result.status.toUpperCase()} (${passed}/${passed + failed} passed, 3 negatives)`)
process.exit(failed === 0 ? 0 : 1)
