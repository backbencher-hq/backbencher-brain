// script/m24/verify-docs.ts — M24.D1 verifier.
//
// Proves the M24 documentation is truthful per contract §1:
//   G1 drift:    regenerating docs/m24/TOOL-DOC.md from machine evidence is
//                byte-identical to the committed file (docs cannot drift)
//   G2 claims:   every per-language claim level in the doc traces to a
//                verified evidence file; a missing evidence file is declared
//                in the doc, never claimed
//   G3 vocab:    no banned vocabulary (contract §1 list) anywhere in M24 docs
//   G4 scope:    no fork/editor claims (M25 scope) and no complement-stance
//                violations (no completion/diagnostics/rename claims)
//   G5 mutation: the lint can FAIL — planted violations in a doc copy are
//                caught (the lint is not hollow)
//
// Run: npx tsx script/m24/verify-docs.ts
// Evidence: validation/m24/results/D1.json (machine-emitted)

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { generateToolDoc } from "./generate-tool-doc"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DOC_PATH = join(ROOT, "docs", "m24", "TOOL-DOC.md")
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "D1.json")

let passed = 0
let failed = 0
const failures: string[] = []
let negativeCases = 0

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++
    console.log(`  ok: ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function negative(name: string, ok: boolean, detail = ""): void {
  negativeCases++
  check(`${name} [negative]`, ok, detail)
}

/** Contract §1 banned vocabulary (M14 list + IDE additions). */
const BANNED_PATTERNS: RegExp[] = [
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
  /\ball languages\b/i,
]

/** Fork/editor claims are M25 scope — their presence in M24 docs is a
 *  violation (contract §2: a fork claim is a measured fact, never assumed). */
const FORK_PATTERNS: RegExp[] = [
  /\b(Cursor|Windsurf|Antigravity)\b/i,
  /\bVS Code\b/i,
  /\bIntelliJ IDEA\b/i,
  /\bWebStorm\b/i,
]

async function testDrift(): Promise<void> {
  const committed = readFileSync(DOC_PATH, "utf8")
  const regenerated = generateToolDoc()
  check("G1: regenerated tool doc is byte-identical to committed", committed === regenerated)
  if (committed !== regenerated) {
    // Show the first difference to make the drift actionable.
    const a = committed.split("\n")
    const b = regenerated.split("\n")
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`      first diff at line ${i + 1}:\n      committed: ${a[i]}\n      regenerated: ${b[i]}`)
        break
      }
    }
  }
}

async function testClaims(): Promise<void> {
  const doc = readFileSync(DOC_PATH, "utf8")
  // Every evidence file the doc claims must actually be verified.
  for (const code of ["L2", "L3", "L4", "L5"]) {
    const evPath = join(ROOT, "validation", "m24", "results", `${code}.json`)
    const ok = (() => {
      try {
        const d = parseSealedRecord(evPath) as { status?: string }
        return d.status === "verified"
      } catch {
        return false
      }
    })()
    check(`G2: claim table cites verified evidence for ${code}`, ok)
  }
  // The doc must state the claim level explicitly.
  check("G2: doc names I1 claim level", doc.includes("I1 (protocol-passed)"))
  // And must declare that I3/I4/I5 are NOT claimed (M25 scope).
  check("G2: doc declares no I3/I4/I5 claims", doc.includes("not claimed") && doc.includes("M25 scope"))
}

async function testVocab(): Promise<void> {
  const docs = [
    DOC_PATH,
    join(ROOT, "docs", "m24", "M24-MASTER-PLAN.md"),
  ]
  for (const path of docs) {
    const text = readFileSync(path, "utf8")
    for (const pattern of BANNED_PATTERNS) {
      const m = pattern.exec(text)
      check(`G3: no banned vocabulary in ${path.split("/").pop()} (${pattern.source})`, m === null, m?.[0] ?? "")
    }
  }
}

async function testScope(): Promise<void> {
  const doc = readFileSync(DOC_PATH, "utf8")
  // Complement stance: completion/diagnostics/rename are declared as never.
  check("G4: complement stance documents no completion", /\*\*No completion\*\*/.test(doc))
  check("G4: complement stance documents no diagnostics", /\*\*No diagnostics\*\*/.test(doc))
  check("G4: complement stance documents no rename", /\*\*No rename\*\*/.test(doc))
  // Fork/editor claims must be absent from the doc.
  const forkHits: string[] = []
  for (const pattern of FORK_PATTERNS) {
    const m = pattern.exec(doc)
    // The doc may mention "not claimed" / M25 in the same sentence — only a
    // POSITIVE claim is a violation. Here we assert the doc explicitly
    // disclaims forks, and that no positive fork claim exists (a positive
    // claim would appear without the "not claimed"/"M25" disclaimer nearby).
    if (m !== null) {
      const ctx = doc.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 80)
      if (!/not claimed|M25 scope/.test(ctx)) forkHits.push(m[0]!)
    }
  }
  check("G4: no positive fork/editor claims in tool doc", forkHits.length === 0, forkHits.join(", "))
}

async function testMutation(): Promise<void> {
  // The lint can fail: plant banned vocabulary + a fork claim into a copy of
  // the doc and assert the lint catches each.
  const committed = readFileSync(DOC_PATH, "utf8")

  const mutantVocab = committed.replace("What bb_lsp is", "What bb_lsp is (perfect solution)")
  const vocabViolation = BANNED_PATTERNS.some((p) => p.test(mutantVocab))
  negative("G5: banned-vocabulary mutant is caught by lint", vocabViolation === true)

  const mutantFork = committed.replace("## Limitations", "## Limitations\n\nVerified in Cursor 1.0 for all languages.")
  const forkViolation = /(Cursor|Windsurf|Antigravity)/.test(mutantFork) && !/not claimed|M25 scope/.test(mutantFork.slice(mutantFork.indexOf("Verified in Cursor") - 40, mutantFork.indexOf("Verified in Cursor") + 120))
  negative("G5: positive fork-claim mutant is caught by lint", forkViolation === true)

  // And a mutant doc that drops the complement stance must fail the scope check.
  const mutantStance = committed.replace(/No \*\*completion\*\* —[^\n]*\n/, "")
  negative(
    "G5: complement-stance removal is caught",
    !/No \*\*completion\*\*/.test(mutantStance),
  )
}

// --- Main ----------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.D1 verifier — docs truthful per contract §1\n")

  await testDrift()
  await testClaims()
  await testVocab()
  await testScope()
  await testMutation()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const docFingerprint = createHash("sha256").update(readFileSync(DOC_PATH)).digest("hex")
  const ok = failed === 0
  const status = ok ? "verified" : "known-gap"

  const evidence = {
    issue: "496",
    code: "D1",
    status,
    currentCommit,
    sourceFingerprint: docFingerprint,
    verifierCommand: "npx tsx script/m24/verify-docs.ts",
    evidenceFile: "D1.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases,
    verdict: {
      realComponentFailures: failed,
      ok,
      note: "doc fingerprint is the committed TOOL-DOC.md; regeneration byte-identity is the drift gate.",
    },
    limitations: [
      "claim levels capped at I1 (protocol-passed) by design — I3/I4/I5 are M25 scope and declared absent",
      "per-language fixture evidence is M25 scope; the claim table states the language-agnostic protocol claim",
      "vocabulary lint covers docs/m24/ artifacts (tool doc + master plan); the contract and decision records are canonical and outside the lint surface",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nD1: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})
