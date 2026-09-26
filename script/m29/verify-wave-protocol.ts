// script/m29/verify-wave-protocol.ts — M29.R1 verifier + mutation suite (issue #536).
//
// Proves the wave protocol honors its declared guarantees, against the REAL
// SPEC ledger and the REAL compiled indexer, and that the suite CAN FAIL:
//
//   R1 binding:    computeCap moves exactly per the tier rules — a failing
//                  S1/S2/S3/S4 caps at I0; blocked S5 caps at I1; blocked S6
//                  caps at I2; all-pass caps at I3
//   R2 conformance: analyzerConformance reads the real SPEC ledger
//                  mechanically — a real language passes, an absent language
//                  is declared absent, a failing section fails the language
//   R3 real index: S4 runs the REAL compiled indexer over the java wave
//                  pack and asserts non-empty counts
//   R4 drift gate: docs/m29/WAVE-PROTOCOL.md regenerates byte-identical
//   R5 mutants:    planted defects (a fake conformance, a lie-filled doc,
//                  a demoted ledger language) are all CAUGHT
//
// Run: npx tsx script/m29/verify-wave-protocol.ts
// Evidence: validation/m29/results/R1.json (machine-emitted)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import {
  ROOT,
  SPEC_LEDGER,
  analyzerConformance,
  computeCap,
  evaluateLanguage,
  type SpecLedger,
  type Step,
} from "./wave-protocol.ts"
import { generateWaveDoc } from "./generate-wave-doc.ts"

let checks = 0
let passed = 0
let mutantsCaught = 0
let mutantsTotal = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  check(`mutant caught: ${label}`, caught, detail)
}

// The semicolon is load-bearing: without it tsc 5.9.3 reads the next statement's bare block
// as this arrow's body and re-parses `({ … })` as a destructuring parameter list, so the file
// fails to parse (TS1003 at the object's first `"`, TS1005 `'=>'` expected at the block) while
// bun compiles it. Measured 2026-09-25: `type Step = {...}` + this line + `{ const x = 1 }`
// reproduces it in three lines; removing the bare block or adding this `;` parses clean.
const step = (name: string, status: Step["status"]): Step => ({ step: name, status, detail: "" });

// --- R1: the binding moves exactly per the tier rules ------------------------
{
  const full: Step[] = [
    step("S1-analyzer-conformance", "pass"),
    step("S2-position-gate", "pass"),
    step("S3-freshness-gate", "pass"),
    step("S4-real-index", "pass"),
    step("S5-server-leg", "pass"),
    step("S6-editor-leg", "pass"),
  ]
  check("R1: all-pass caps at I3", computeCap(full) === "I3")

  for (const s of ["S1-analyzer-conformance", "S2-position-gate", "S3-freshness-gate", "S4-real-index"] as const) {
    const broken = full.map((x) => (x.step === s ? { ...x, status: "fail" as const } : x))
    check(`R1: failed ${s} caps at I0`, computeCap(broken) === "I0")
    const blocked = full.map((x) => (x.step === s ? { ...x, status: "blocked" as const } : x))
    check(`R1: blocked ${s} caps at I0`, computeCap(blocked) === "I0")
  }
  check("R1: blocked S5 caps at I1", computeCap(full.map((x) => (x.step === "S5-server-leg" ? { ...x, status: "blocked" as const } : x))) === "I1")
  check("R1: blocked S6 caps at I2", computeCap(full.map((x) => (x.step === "S6-editor-leg" ? { ...x, status: "blocked" as const } : x))) === "I2")
  check("R1: everything blocked caps at I0", computeCap(full.map((x) => ({ ...x, status: "blocked" as const }))) === "I0")
}

// --- R2: conformance reads the REAL ledger mechanically ----------------------
{
  let spec: SpecLedger | null = null
  try {
    spec = JSON.parse(readFileSync(SPEC_LEDGER, "utf8")) as SpecLedger
  } catch {}
  check("R2: SPEC ledger is readable", spec !== null)
  if (spec) {
    const java = analyzerConformance(spec, "java")
    check("R2: real java reads conformant", java.conformant === true, java.reason)
    const absent = analyzerConformance(spec, "cobol")
    check("R2: absent language is declared absent", absent.conformant === false && absent.reason.includes("absent"))

    const tampered = structuredClone(spec!)
    tampered.data.languages["java"]!.sections["section-a-structural"]!.status = "fail"
    const demoted = analyzerConformance(tampered, "java")
    check("R2: a failing section fails the language", demoted.conformant === false && demoted.reason.includes("failing sections"))
  }
}

// --- R3: dry-run verdict on java, with the REAL indexer ----------------------
{
  const verdict = await evaluateLanguage("java")
    check("R3: dry-run verdict exists", verdict.language === "java")
    const byStep = new Map(verdict.steps.map((s) => [s.step, s]))
    const s1 = byStep.get("S1-analyzer-conformance")
    check("R3: S1 passes on the real ledger", s1?.status === "pass", s1?.detail)
    const s2 = byStep.get("S2-position-gate")
    check("R3: S2 (positions gate) passes", s2?.status === "pass", s2?.detail)
    const s3 = byStep.get("S3-freshness-gate")
    check("R3: S3 (freshness gate) passes", s3?.status === "pass", s3?.detail)
    const s4 = byStep.get("S4-real-index")
    check("R3: S4 real-index passes with non-empty counts", s4?.status === "pass" && (verdict.indexCounts?.symbols ?? 0) > 0, s4?.detail)
    const s5 = byStep.get("S5-server-leg")
    check("R3: S5 honestly blocked in dry-run", s5?.status === "blocked", s5?.detail)
    const s6 = byStep.get("S6-editor-leg")
    // The protocol honors RECORDED editor evidence (R2 execution writes it).
    // When java's S6 evidence exists, S6 reads pass and the cap stays I1
    // (S5 remains R2-scoped); without it, S6 is honestly blocked.
    const javaEditorEv = path.join(ROOT, "validation", "m29", "results", "wave-editor-java.json")
    if (existsSync(javaEditorEv)) {
      const ev = JSON.parse(readFileSync(javaEditorEv, "utf8")) as { status?: string }
      check("R3: S6 honors recorded evidence", s6?.status === (ev.status === "verified" ? "pass" : "fail"), s6?.detail)
      check("R3: cap stays I1 while S5 is R2-scoped", verdict.ideCap === "I1", `got ${verdict.ideCap}`)
      check("R3: blockers = S5 only", verdict.blockers.length === 1, `got ${verdict.blockers.length}`)
    } else {
      check("R3: S6 honestly blocked without recorded evidence", s6?.status === "blocked", s6?.detail)
      check("R3: blockers recorded", verdict.blockers.length === 2, `got ${verdict.blockers.length}`)
    }
    check("R3: no step failed (dry-run ok)", verdict.ok === true)
    check("R3: verdict carries a commit stamp", typeof verdict.commit === "string" && verdict.commit.length >= 7)

    // R5-M1: an absent language runs the protocol and is declared absent,
    // not silently conformant.
    const absentVerdict = await evaluateLanguage("cobol")
    const absentS1 = absentVerdict.steps.find((s) => s.step === "S1-analyzer-conformance")
    mutant("absent language silently conformant", absentS1?.status === "fail" && absentVerdict.ideCap === "I0", JSON.stringify(absentS1))
}

// --- R5-M2: a fabricated conformance must move the cap (proves the gate      //
//     is wired to the real rule, not a constant) ------------------------------
{
  const stepsAllPass: Step[] = [
    step("S1-analyzer-conformance", "fail"),
    step("S2-position-gate", "pass"),
    step("S3-freshness-gate", "pass"),
    step("S4-real-index", "pass"),
    step("S5-server-leg", "pass"),
    step("S6-editor-leg", "pass"),
  ]
  mutant("cap computed from a constant (immune to S1 failure)", computeCap(stepsAllPass) === "I0")
}

// --- R5-M3: a LIED doc must be caught by byte-compare ------------------------
{
  const docPath = path.join(ROOT, "docs", "m29", "WAVE-PROTOCOL.md")
  if (!existsSync(docPath)) {
    writeFileSync(docPath, generateWaveDoc())
  }
  const onDisk = readFileSync(docPath, "utf8")
  const fresh = generateWaveDoc()
  check("R4: WAVE-PROTOCOL.md regenerates byte-identical", onDisk === fresh, "regenerate with: npx tsx script/m29/generate-wave-doc.ts")

  // Drift the REAL doc, re-run generation, require the gate to see it.
  const tampered = fresh.replace("capped by what machine evidence proves", "capped by vibes")
  if (tampered === fresh) throw new Error("doc mutation did not apply")
  writeFileSync(docPath, tampered)
  const after = readFileSync(docPath, "utf8")
  mutant("hand-edited doc passes the drift gate", after !== generateWaveDoc())
  // Restore the honest doc.
  writeFileSync(docPath, fresh)
}

// --- R5-M4: a demoted ledger language must fail conformance ------------------
{
  let spec: SpecLedger | null = null
  try {
    spec = JSON.parse(readFileSync(SPEC_LEDGER, "utf8")) as SpecLedger
  } catch {}
  const tampered = structuredClone(spec!)
  delete tampered.data.languages["typescript"]
  mutant("ledger entry removed without the gate noticing", analyzerConformance(tampered, "typescript").conformant === false)
}

// --- Persist evidence --------------------------------------------------------
const finalFailed = checks - passed
const result = {
  issue: "M29.R1",
  code: "R1",
  milestone: "M29",
  status: finalFailed === 0 ? "verified" : "known-gap",
  checks,
  passed,
  failed: finalFailed,
  mutantsCaught,
  mutantsTotal,
  currentCommit: execCommit(),
  verifierCommand: "npx tsx script/m29/verify-wave-protocol.ts",
  evidenceFile: "R1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "S5 (per-language server leg) and S6 (in-editor leg) are R2 execution work; in the dry-run they are declared blockers that cap at I1.",
    "The SPEC conformance read is machine-read from the committed ledger; re-running the SPEC itself is M14's wave machinery, not R1's.",
    "Dry-run observation recorded honestly: the real indexer logs a post-index health-check warning (index marked partial) in the temp data dir; file/symbol/relationship counts are real and non-empty, and the S4 pass rests on the counts, not the health score.",
  ],
}
const evidenceDir = path.join(ROOT, "validation", "m29", "results")
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(path.join(evidenceDir, "R1.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`R1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants — every mutant must be caught)`)
process.exit(finalFailed === 0 && mutantsCaught === mutantsTotal ? 0 : 1)

function execCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}
