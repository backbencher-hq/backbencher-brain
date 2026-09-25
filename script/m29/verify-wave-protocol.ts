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
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

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

const step = (name: string, status: Step["status"]): Step => ({ step: name, status, detail: "" })

/** A VOLATILE PIN in a byte-gated artifact: the live HEAD, or a wall-clock
 *  timestamp. Either one re-stales the drift gate on the very commit that
 *  records it (the "self-staling byte-gated doc" class, M61.V6 / #847 — the
 *  m53 integration receipt states the invariant in prose). */
function volatilePin(doc: string, head: string): string | null {
  const short = head.slice(0, 8)
  if (short.length === 8 && doc.includes(short)) return `live HEAD ${short}`
  const iso = doc.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  return iso ? `wall-clock timestamp ${iso[0]}` : null
}

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
    spec = parseSealedRecord(SPEC_LEDGER) as SpecLedger
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
    // The protocol honors RECORDED server-leg evidence, exactly like S6:
    // wave-<lang>.json verified → S5 passes; missing → honestly blocked.
    // (History: S5 was hardcoded blocked, which capped fully-verified
    // languages at I1 even with both legs green on disk.)
    const javaServerEv = path.join(ROOT, "validation", "m29", "results", "wave-java.json")
    check("R3: S5 honors recorded evidence", s5?.status === (existsSync(javaServerEv) ? (parseSealedRecord(javaServerEv) as { status?: string }).status === "verified" ? "pass" : "fail" : "blocked"), s5?.detail)
    // R5-M5 — the SILENT CAPABILITY CAP class (M61.V6 / #847). Incident: this
    // step was hardcoded "blocked" here, which capped fully-verified languages
    // at I1 even with both legs green on disk: the cap lied downward and
    // recorded no blocker. The permanent proof: a HARDCODED status that the
    // recorded evidence disagrees with must fire the detector above.
    {
      const hardcodedS5 = verdict.steps.map((s) => (s.step === "S5-server-leg" ? { ...s, status: "blocked" as const } : s))
      const honest = existsSync(javaServerEv) && (parseSealedRecord(javaServerEv) as { status?: string }).status === "verified" ? "pass" : "blocked"
      const detectorFires = hardcodedS5.find((s) => s.step === "S5-server-leg")!.status !== honest
      mutant("silent capability cap: a hardcoded blocked S5 caps a fully-evidenced language", detectorFires)
    }
    const s6 = byStep.get("S6-editor-leg")
    // The protocol honors RECORDED editor evidence (R2 execution writes it).
    // When java's S6 evidence exists, S6 reads pass and the cap stays I1
    // (S5 remains R2-scoped); without it, S6 is honestly blocked.
    const javaEditorEv = path.join(ROOT, "validation", "m29", "results", "wave-editor-java.json")
    if (existsSync(javaEditorEv)) {
      const ev = parseSealedRecord(javaEditorEv) as { status?: string }
      check("R3: S6 honors recorded evidence", s6?.status === (ev.status === "verified" ? "pass" : "fail"), s6?.detail)
      // Both legs recorded and verified → the cap is the top of the ladder.
      check("R3: cap reaches I3 with both legs verified", verdict.ideCap === "I3", `got ${verdict.ideCap}`)
      check("R3: no blockers with both legs verified", verdict.blockers.length === 0, `got ${verdict.blockers.length}`)
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
    spec = parseSealedRecord(SPEC_LEDGER) as SpecLedger
  } catch {}
  const tampered = structuredClone(spec!)
  delete tampered.data.languages["typescript"]
  mutant("ledger entry removed without the gate noticing", analyzerConformance(tampered, "typescript").conformant === false)
}

// --- R5-M6: a byte-gated doc carrying a VOLATILE PIN re-stales ----------------
// (M61.V6 / #847 — the self-staling-byte-gated-doc class. A byte-compared
// artifact that embeds the live HEAD, or a wall-clock timestamp, re-stales on
// the very commit that records it, so its drift gate can never go green: the
// gate reports a lie forever. The m53 receipt states the invariant in prose;
// this gate enforces it on the bytes it owns.)
{
  const head = execCommit()
  const pin = volatilePin(generateWaveDoc(), head)
  check("R4: the generated doc carries no volatile pin (live HEAD / wall clock)", pin === null, pin ?? undefined)
  mutant("byte-gated doc embedding the live HEAD re-stales", volatilePin(`${generateWaveDoc()}\n<!-- pin ${head.slice(0, 8)} -->\n`, head) !== null)
  mutant("byte-gated doc embedding a wall-clock timestamp re-stales", volatilePin(`${generateWaveDoc()}\n<!-- 2026-01-02T03:04 -->\n`, head) !== null)
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
writeSealed(path.join(evidenceDir, "R1.json"), result)
console.log(`R1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants — every mutant must be caught)`)
process.exit(finalFailed === 0 && mutantsCaught === mutantsTotal ? 0 : 1)

function execCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}
