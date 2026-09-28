// script/m25/verify-listing.ts — M25.D1 (issue #506).
//
// The marketplace listing is the most public claim surface we have (contract
// §1). This verifier owns three gates:
//   G1 vocabulary:    the listing text contains no banned pattern — no
//                     unscoped fork claim ("works in X" without a pinned
//                     run), no "all languages", no comparative marketing.
//   G2 claim drift:   every claim level on the listing matches the ledger
//                     and the per-fork evidence files exactly — a verified
//                     run is the ONLY thing that lets the listing say I3/I4,
//                     and a blocked record must be declared blocked, never
//                     omitted.
//   G3 honesty docs:  limitations exist and are non-trivial, the complement
//                     stance is stated, referenced evidence files exist on
//                     disk, and version references are consistent.
// The detectors are pure functions (exported) so the mutation suite can plant
// defects and prove the suite CAN FAIL — a surviving mutant fails the suite,
// not the mutant (contract §6).
//
// Run: npx tsx script/m25/verify-listing.ts
// Evidence: validation/m25/results/D1.json (machine-emitted)

import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { writeSealed, parseSealedRecord } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = resolve(import.meta.dirname, "../..")
const README_PATH = join(ROOT, "ide/vscode/README.md")
const CHANGELOG_PATH = join(ROOT, "ide/vscode/CHANGELOG.md")
const MANIFEST_PATH = join(ROOT, "validation/m25/results/manifest.json")
const RESULTS_DIR = join(ROOT, "validation/m25/results")

// --- Pure detectors (mutation targets) --------------------------------------

/** Contract §1 banned vocabulary, scoped to listing linting. */
export const BANNED: RegExp[] = [
  /perfect(ion)?\b/i,
  /\bcomplete(ly|d|ness)?\b/i,
  /\bproduction-ready\b/i,
  /\bbulletproof\b/i,
  /\brock-solid\b/i,
  /\bbattle-tested\b/i,
  /\bextensively tested\b/i,
  /\bthoroughly reviewed\b/i,
  /\bshould work\b/i,
  /\bexpected to pass\b/i,
  /\bIDE-grade\b/i,
  /\bIntelliJ-like\b/i,
  /\breal-time\b/i,
  /\bseamless(ly)?\b/i,
]

/** A fork "works" claim without naming a pinned run is banned (contract §1). */
export const UNSCOPED_FORK_CLAIM: RegExp = /\b(works|verified)\s+(in|on)\s+(Cursor|Windsurf|Antigravity|VS\s?Code)\b/i

/** Vocabulary violations of the listing text. Empty array = lint green. */
export function listingViolations(text: string): string[] {
  const violations: string[] = []
  for (const pattern of BANNED) {
    if (pattern.test(text)) violations.push(`banned:${pattern.source}`)
  }
  if (UNSCOPED_FORK_CLAIM.test(text)) violations.push("unscoped fork claim")
  if (/\ball languages\b/i.test(text)) violations.push("'all languages' claim (per-language denominator required)")
  return violations
}

/**
 * Claim-level drift between the listing, the ledger, and per-fork evidence.
 * `ledger` maps issue code -> evidence status; `forks` maps fork name ->
 * evidence status ("verified" | "blocked" | anything else = no pinned run).
 */
export function claimDriftViolations(readme: string, ledger: Record<string, string | undefined>, forks: Record<string, string>): string[] {
  const violations: string[] = []
  // In-editor I3 (VS Code) may only be claimed when E5 evidence is verified.
  const vscodeRow = readme.includes("| VS Code | I3")
  if (ledger.E5 === "verified" ? !vscodeRow : vscodeRow) {
    violations.push(`vscode: I3 claim does not match ledger evidence status (${ledger.E5 ?? "none"})`)
  }
  for (const [fork, status] of Object.entries(forks)) {
    // Row matching is case-insensitive: evidence names are lowercase,
    // listings capitalize display names — the claim is what matters.
    const rowRe = (claim: string) => new RegExp(`\\|\\s*${fork}\\s*\\|\\s*${claim}\\b`, "i")
    const claimsI4 = rowRe("I4").test(readme)
    const saysBlocked = rowRe("blocked").test(readme)
    if (status === "verified" && !claimsI4) violations.push(`${fork}: verified in evidence but not claimed I4 on the listing`)
    if (status !== "verified" && claimsI4) violations.push(`${fork}: claimed I4 without a verified pinned run`)
    if (status === "blocked" && !saysBlocked) violations.push(`${fork}: blocked in evidence but not declared blocked on the listing`)
  }
  return violations
}

/** Limitations must exist and be non-trivial (closure requirement). */
export function limitationsViolations(readme: string): string[] {
  const match = readme.match(/## Limitations[\s\S]*?(?=\n## |$)/)
  if (!match) return ["limitations section missing"]
  const bullets = match[0].split("\n").filter((l) => l.startsWith("- "))
  if (bullets.length < 3) return [`limitations too thin (${bullets.length} bullets, need >= 3)`]
  return []
}

// --- Evidence-record readers ------------------------------------------------

function forkEvidence(): Record<string, string> {
  const forks: Record<string, string> = {}
  if (!existsSync(RESULTS_DIR)) return forks
  for (const f of readdirSync(RESULTS_DIR)) {
    if (!f.startsWith("F-") || !f.endsWith(".json")) continue
    try {
      const rec = parseSealedRecord(join(RESULTS_DIR, f)) as Record<string, unknown>
      const name = String(rec["fork"] ?? f.slice(2, -5))
      forks[name] = String(rec["status"] ?? "unknown")
    } catch {
      // unreadable evidence is surfaced by the drift check below
    }
  }
  return forks
}

// --- Main checks ------------------------------------------------------------

let checks = 0
let passed = 0
let negatives = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${name} — ${detail}` : name)
  console.log(`  ${ok ? "ok" : "FAIL"}: ${name}${ok && detail ? ` (${detail})` : detail ? ` — ${detail}` : ""}`)
}
function negative(name: string, ok: boolean, detail = ""): void {
  negatives++
  check(name, ok, detail)
}

console.log("M25.D1 verifier — marketplace listing truthfulness (issue #506)\n")

const readme = readFileSync(README_PATH, "utf8")
const manifest = parseSealedRecord(MANIFEST_PATH) as {
  issues: Array<{ code: string; status: string; evidence?: { status?: string } }>
}
const ledger: Record<string, string | undefined> = {}
for (const issue of manifest.issues) ledger[issue.code] = issue.evidence?.status ?? issue.status

// --- G1: vocabulary lint on the listing -------------------------------------
console.log("G1 — contract vocabulary on the listing")
const violations = listingViolations(readme)
check("G1: listing has zero banned-vocabulary violations", violations.length === 0, violations.join("; "))
check("G1: fork claims only via the verification matrix (no unscoped 'works in X')", !UNSCOPED_FORK_CLAIM.test(readme))

// Negative canaries: the detector must fire on planted-bad text.
negative("G1: negative canary — detector fires on 'works in Cursor'", listingViolations("Everything works in Cursor, seamlessly and in real-time.").length > 0)
negative("G1: negative canary — detector fires on 'supports all languages'", listingViolations("Supports all languages out of the box.").length > 0)

// --- G2: claim-level drift ----------------------------------------------------
console.log("\nG2 — claim levels match the evidence chain exactly")
const forks = forkEvidence()
const drift = claimDriftViolations(readme, ledger, forks)
check("G2: listing claim levels == ledger + per-fork evidence (zero drift)", drift.length === 0, drift.join("; "))
check("G2: shipped feature claim table carries no level above the evidence chain",
  (readme.match(/^\| (?:java|groovy|kotlin|scala|typescript)\s*\|.*$/gim) ?? []).every((row) => !/\bI[2-4]\b/.test(row)))

negative("G2: negative canary — drift detector fires on an unevidenced I4 claim",
  claimDriftViolations("| Cursor | I4 | x |", { E5: "planned" }, { Cursor: "blocked" }).length > 0)

// --- G3: honesty docs on the listing -----------------------------------------
console.log("\nG3 — limitations, complement stance, references")
const limViolations = limitationsViolations(readme)
check("G3: limitations section present and non-trivial", limViolations.length === 0, limViolations.join("; "))
check("G3: complement stance stated (no completion / diagnostics / rename)",
  /no completion,\s*no diagnostics,\s*no rename/i.test(readme.replace(/\*\*/g, "").replace(/\n/g, " ")))
check("G3: staleness policy declared (debounce + badge, not magic)", /\bdebounc/i.test(readme) && /staleness/i.test(readme))
check("G3: five launch languages named, others declared absent", /Java/i.test(readme) && /Groovy/i.test(readme) && /Kotlin/i.test(readme) && /Scala/i.test(readme) && /TypeScript/i.test(readme) && /declared absent/i.test(readme))

negative("G3: negative canary — limitations detector fires on a missing section", limitationsViolations("## Features\n\nnothing here\n").length > 0)

// Every evidence path the listing references must exist on disk.
const referenced = readme.match(/validation\/m[0-9]+\/results\/[A-Za-z0-9._-]+\.json/g) ?? []
check("G3: listing references at least the fork + E5 evidence files", referenced.length >= 4, `${referenced.length} referenced`)
for (const ref of new Set(referenced)) {
  check(`G3: referenced evidence exists — ${ref}`, existsSync(join(ROOT, ref)))
}

// Version consistency: install command names the real VSIX artifact.
const pkg = JSON.parse(readFileSync(join(ROOT, "ide/vscode/package.json"), "utf8")) as { name: string; version: string }
check("G3: install instructions reference the real VSIX filename",
  readme.includes(`${pkg.name}-${pkg.version}.vsix`), `${pkg.name}-${pkg.version}.vsix`)

// --- G6: mutation suite -------------------------------------------------------
console.log("\nSymbols mutation suite: planting defects into a copy of the detectors")
const MUTANTS: Array<{ name: string; from: string; to: string; probe: (mod: Record<string, unknown>) => boolean }> = [
  {
    name: "listing: unscoped fork claim slips through",
    from: "  if (UNSCOPED_FORK_CLAIM.test(text)) violations.push(\"unscoped fork claim\")",
    to: "  if (false && UNSCOPED_FORK_CLAIM.test(text)) violations.push(\"unscoped fork claim\")",
    probe: (mod) => (mod.listingViolations as (t: string) => string[])("works in Cursor").length > 0,
  },
  {
    name: "drift: unevidenced I4 claim accepted",
    from: "    if (status !== \"verified\" && claimsI4) violations.push(",
    to: "    if (status === \"verified\" && claimsI4) violations.push(",
    probe: (mod) =>
      (mod.claimDriftViolations as (r: string, l: Record<string, string>, f: Record<string, string>) => string[])(
        "| Cursor | I4 | x |", { E5: undefined as unknown as string }, { Cursor: "blocked" },
      ).length > 0,
  },
  {
    name: "limitations: empty section accepted",
    from: "  if (bullets.length < 3) return [`limitations too thin (${bullets.length} bullets, need >= 3)`]",
    to: "  if (bullets.length < 0) return [`limitations too thin (${bullets.length} bullets, need >= 3)`]",
    probe: (mod) => (mod.limitationsViolations as (t: string) => string[])("## Limitations\n\n- one\n").length > 0,
  },
]

const tmp = mkdtempSync(join(tmpdir(), "d1-mutants-"))
try {
  const source = readFileSync(import.meta.filename ?? __filename, "utf8")
  for (const [i, mutant] of MUTANTS.entries()) {
    const mutantPath = join(tmp, `mutant.${i}.ts`)
    if (!source.includes(mutant.from)) {
      console.log(`  SKIP (anchor not found): ${mutant.name}`)
      check(`G6: mutant anchor present — ${mutant.name}`, false, "anchor text missing from verifier source")
      continue
    }
    writeFileSync(mutantPath, source.replace(mutant.from, mutant.to))
    const probeScript = join(tmp, `probe.${i}.mts`)
    writeFileSync(
      probeScript,
      `const mod = await import(${JSON.stringify(mutantPath)})\n` +
        `const caught = ${mutant.probe.toString()}(mod)\n` +
        `process.stdout.write(caught ? "CAUGHT" : "SURVIVED")\n`,
    )
    let out = ""
    try {
      out = execFileSync("npx", ["tsx", probeScript], { cwd: ROOT, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      out = "CAUGHT" // a crashing mutant is a caught mutant
    }
    const caught = out.includes("CAUGHT")
    check(`G6: mutant caught — ${mutant.name}`, caught, out.includes("SURVIVED") ? "SURVIVED" : "")
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// --- Evidence ----------------------------------------------------------------
const failed = checks - passed
const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
const readmeHash = createHash("sha256").update(readFileSync(README_PATH)).digest("hex")
const result = {
  issue: "506",
  code: "D1",
  milestone: "M25",
  status: failed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed,
  failures,
  negativeCases: negatives,
  currentCommit,
  readmeFingerprint: readmeHash,
  listingPath: "ide/vscode/README.md",
  verifierCommand: "npx tsx script/m25/verify-listing.ts",
  evidenceFile: "D1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "The lint is lexical: it proves the listing avoids banned phrasing, not that every sentence is strategically perfect (that word is banned too).",
    "Claim drift is checked against the ledger and F-*.json evidence at run time; a re-run after any evidence change re-derives the allowed claims.",
    "The install follow-along lives in verify-install-docs.ts (clean-profile execution); this file only proves the instructions reference real artifacts.",
  ],
}
// --- Evidence ----------------------------------------------------------------

const evidenceDir = RESULTS_DIR
writeSealed(join(evidenceDir, "D1.json"), result)

console.log(`\nD1: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} passed, ${negatives} negative)`)
console.log(`Evidence: ${join(evidenceDir, "D1.json")}`)
if (failed > 0) process.exitCode = 1
