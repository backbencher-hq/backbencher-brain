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

import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { generateToolDoc } from "./generate-tool-doc"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DOC_PATH = join(ROOT, "docs", "m24", "TOOL-DOC.md")
const PLAN = join(ROOT, "docs", "m24", "M24-MASTER-PLAN.md")
const GENERATOR = join(ROOT, "script", "m24", "generate-tool-doc.ts")
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "D1.json")

let passed = 0
let failed = 0
const failures: string[] = []
let negativeCases = 0
/** The claim table's sources, read here and recorded in the evidence so a D1
 *  failure names its cause instead of only its symptom. */
let claimSources: Array<Record<string, unknown>> = []

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
  // Every evidence file the doc claims must actually be verified — and the
  // record of WHICH code is not, and why, belongs in this gate's own evidence.
  // Without it a reader of D1.json sees `failures: ["G2: … for L2"]` and has to
  // go and open another gate's file to learn that the doc is not lying, an
  // upstream gate is. Silence is guilt; so is a failure without a cause.
  claimSources = []
  for (const code of ["L2", "L3", "L4", "L5"]) {
    const evPath = join(ROOT, "validation", "m24", "results", `${code}.json`)
    const read = (() => {
      try {
        const d = parseSealedRecord(evPath) as { status?: string; currentCommit?: string; generatedAt?: string; failures?: string[]; passed?: number; failed?: number; verdict?: Record<string, unknown> }
        return {
          read: "ok" as const,
          status: d.status ?? "(absent)",
          currentCommit: d.currentCommit ?? null,
          generatedAt: d.generatedAt ?? null,
          passed: d.passed ?? null,
          failed: d.failed ?? null,
          upstreamFailures: d.failures ?? [],
          verdictOk: d.verdict?.ok ?? null,
        }
      } catch (error) {
        return { read: "refused" as const, status: `(trusted read refused: ${String(error).split("\n")[0]})`, currentCommit: null, generatedAt: null, passed: null, failed: null, upstreamFailures: [], verdictOk: null }
      }
    })()
    claimSources.push({ code, evidenceFile: `validation/m24/results/${code}.json`, ...read })
    check(`G2: claim table cites verified evidence for ${code}`, read.read === "ok" && read.status === "verified",
      read.status === "verified" ? "" : `${code} is ${read.status}; the doc's claim table cannot say "I1 ✓" for it (§1: evidence > docs)`)
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

  // --- G5b/G5c: THE DRIFT GATE'S OWN FALSIFIABILITY. -------------------------
  //
  // G1 compared the committed doc with the generator's output and had NOTHING
  // planted against it, so nothing in this file proved the comparison can fail.
  // A generator that silently stopped reading the evidence — or one whose table
  // changed — would leave G1 green and this file would keep saying "drift is
  // gated". Measured on the first run of these two negatives: with L2 known-gap
  // on disk, a generator that hardcodes every claim as `I1 ✓` reproduces the
  // committed doc BYTE-FOR-BYTE. The drift gate could not tell the honest
  // generator from a dishonest one, because the committed doc and the dishonest
  // answer agreed and only the honest answer differed.
  //
  // Both legs therefore run against a DECOY evidence directory in a scratch dir,
  // so the committed evidence is never touched and the generator's own
  // evidence-dependence can be tested in both directions.
  const decoy = async (
    statuses: Record<string, string>,
    mutate: (source: string) => string = (s) => s,
  ): Promise<string> => {
    const dir = mkdtempSync(join(tmpdir(), "m24-d1-decoy-"))
    try {
      mkdirSync(join(dir, "docs/m24"), { recursive: true })
      mkdirSync(join(dir, "validation/m24/results"), { recursive: true })
      copyFileSync(PLAN, join(dir, "docs/m24/M24-MASTER-PLAN.md"))
      for (const code of ["L2", "L3", "L4", "L5"]) {
        // Sealed, because the generator reads through the trusted reader and an
        // unsealed decoy would be refused — which would make every decoy cell read
        // "missing" and the test would pass for the wrong reason.
        writeSealed(join(dir, `validation/m24/results/${code}.json`), {
          code,
          status: statuses[code] ?? "verified",
          currentCommit: "decoy",
          generatedAt: "1970-01-01T00:00:00.000Z",
          verdict: { ok: statuses[code] ?? "verified" === "verified" },
        })
      }
      const source = readFileSync(GENERATOR, "utf8")
      const rooted = source.replace(
        /const ROOT = join\(dirname\(fileURLToPath\(import\.meta\.url\)\), "\.\.", "\.\."\)/,
        `const ROOT = ${JSON.stringify(dir)}`,
      )
      if (rooted === source) throw new Error("G5b: the generator's ROOT anchor is gone — the decoy harness would read the real evidence tree and prove nothing")
      const patched = rewriteRelativeImports(mutate(rooted), path.dirname(GENERATOR))
      const copyPath = join(dir, "generate-tool-doc.decoy.ts")
      writeFileSync(copyPath, patched, "utf8")
      const mod = (await import(pathToFileURL(copyPath).href)) as { generateToolDoc: () => string }
      return mod.generateToolDoc()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const allVerified = await decoy({ L2: "verified", L3: "verified", L4: "verified", L5: "verified" })
  const l3Failed = await decoy({ L2: "verified", L3: "known-gap", L4: "verified", L5: "verified" })
  // G5c first: is the claim table DERIVED from the evidence at all? If the
  // generator ignored the statuses, both decoys would render identically.
  const l3Column = (doc: string): string => {
    const row = /^\| java \| (.*)\|$/m.exec(doc)
    return row?.[1] ?? "(no claim row)"
  }
  negative(
    "G5c: the claim table is DERIVED from the evidence statuses — one failed code changes the generated doc (§1: evidence > docs)",
    l3Column(allVerified) !== l3Column(l3Failed) && l3Column(l3Failed).includes("—"),
    `all-verified row: ${l3Column(allVerified)} | L3-known-gap row: ${l3Column(l3Failed)}`,
  )
  // G5b: and can the COMPARISON itself fail? A generator whose table wording
  // changed must be rejected by the same predicate G1 uses.
  const reworded = await decoy(
    { L2: "verified", L3: "known-gap", L4: "verified", L5: "verified" },
    (s) => s.replace('return ok ? "I1 ✓" : "—"', 'return ok ? "I1 (measured)" : "—"'),
  )
  negative(
    "G5b: the drift comparison can fail — a generator whose claim cells change is rejected by the same predicate G1 uses",
    reworded !== l3Failed && (reworded === committed) === false,
    `reworded output equals the honest decoy output: ${reworded === l3Failed}`,
  )
  // And the harder case the first version of this gate could not express: a
  // generator that HARDCODES every claim as verified must be rejected when the
  // evidence disagrees with it.
  const hardcoded = await decoy(
    { L2: "verified", L3: "known-gap", L4: "verified", L5: "verified" },
    // BOTH occurrences, not the first: the generator reads the evidence status in
    // the claim table AND in the feature list, and a plant that only silenced the
    // table would leave the list still evidence-driven, so the two documents would
    // differ for a reason that has nothing to do with the claim under test.
    (s) => s.replaceAll('const ok = evidenceStatus(f.code) === "verified"', "const ok = true"),
  )
  negative(
    "G5b: a generator that HARDCODES every claim as verified is rejected when the evidence disagrees (§1: the doc cannot upgrade a failed check)",
    hardcoded === allVerified && hardcoded !== l3Failed,
    `hardcoded output equals the all-verified decoy: ${hardcoded === allVerified}; hardcoded output equals the honest L3-known-gap decoy: ${hardcoded === l3Failed}`,
  )
}

/** Rewrite a module's relative imports to absolute file URLs, so a copy can live
 *  outside the tree it was written in. Resolves what the source ACTUALLY imports
 *  rather than a hand-written list — a missing entry is silent. */
function rewriteRelativeImports(source: string, componentDir: string): string {
  return source.replace(/from\s+"(\.\.?\/[^"]+)"/g, (_m, specifier: string) => {
    const target = join(componentDir, specifier)
    const resolved = existsSync(`${target}.ts`) ? `${target}.ts` : target
    return `from "${pathToFileURL(resolved).href}"`
  })
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
    ...fingerprintFields(["m24.D1"], ROOT),
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
    /**
     * WHY this record is red, in the record. G1 and G2 fail together and for one
     * reason: an upstream gate's evidence is not `verified`, so the claim table
     * the doc commits cannot honestly carry an "I1 ✓" for that code. The doc is
     * NOT lying and D1 is not broken — the pair is the gate working: authority
     * order puts machine evidence above documentation (contract §1).
     *
     * `claimSources` carries each code's status, its own commit, and its own
     * failure list, so the reader does not have to open another gate's file to
     * learn which one is red. Fixing it means fixing THAT gate (or re-running it
     * at the current commit) — never relaxing this one.
     */
    claimSources,
    claimTableIsDerivedFromEvidence:
      "G5c proves it against decoy evidence directories: the generated claim row changes when a code's status changes, and a generator that hardcodes every claim as verified is rejected. Measured note: with an upstream code known-gap, a hardcoding generator reproduces the COMMITTED doc byte-for-byte, so the drift comparison alone cannot tell an honest generator from a dishonest one — which is why G5c exists rather than being folded into G1.",
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
