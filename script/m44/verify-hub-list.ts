// script/m44/verify-hub-list.ts — M44.U2 owner gate (issue #689).
//
// This gate OWNS validation/m44/results/U2.json. Read the header of
// script/m44/hub-list-derivation.ts for why it exists: U2's record was a derived
// record with no owner, re-pinned by hand, whose pin froze and made M44's
// governance report `U2:stale-commit` with no mechanical way to clear it.
//
// U2's acceptance IS the m26 webview harness's DOM suite (AH1–AH6 over the real
// renderer core). This gate therefore:
//   1. reads the harness record through the TRUSTED read path (sealed),
//   2. derives U2 from it under the six declared laws (hub-list-derivation.ts),
//   3. proves the derivation CAN FAIL — in-memory defective sources per law, and
//      a source-level mutant of the library (a green-blind derivation),
//   4. seals U2.json naming its source and the source record's content hash.
//
// Run: npx tsx script/m44/verify-hub-list.ts
// Evidence: validation/m44/results/U2.json (sealed)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readEvidence, writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import { deriveU2, type DerivedSource, type U2Declaration } from "./hub-list-derivation.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DECLARATION_FILE = join(ROOT, "script/m44/u2-declaration.json")
const OUT = join(ROOT, "validation/m44/results/U2.json")

let checks = 0
let passed = 0
const failures: string[] = []

function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

async function main(): Promise<void> {
  const currentCommit = gitHead()

  // --- L1: the declaration is the single owner of what U2 claims ----------------
  const declaration: U2Declaration = JSON.parse(readFileSync(DECLARATION_FILE, "utf8")) as U2Declaration
  const sourceRel = declaration.source.record

  // --- the source through the trusted read -------------------------------------
  const read = readEvidence<DerivedSource>(join(ROOT, sourceRel))
  const source: DerivedSource | null = read.ok ? read.record : null
  const sourceHash: string | null = read.ok ? read.seal.contentSha256 : null

  console.log(`R1: the source record (${sourceRel}) through the trusted read`)
  check("R1: the harness record is a trusted sealed read", read.ok, read.ok ? "" : `kind=${read.kind}: ${read.reason}`)
  check("R1: the declaration names the harness verifier", declaration.source.verifierCommand === "npx tsx script/m26/verify-webview-harness.ts")

  // --- the derivation ----------------------------------------------------------
  console.log("\nR2: the derivation")
  const derived = deriveU2(declaration, source ?? {}, sourceHash)
  check("R2: the derivation is clean (every law holds)", derived.errors.length === 0, derived.errors.join(", "))

  // --- the can-fail proof: each law refuses its defective source ----------------
  console.log("\nR3: the can-fail proof — every law refuses a defective input")
  const good = source ?? {}
  const cases: Array<{ law: string; decl: U2Declaration; src: DerivedSource; hash: string | null }> = [
    { law: "L1(", decl: { ...declaration, deliverable: {} }, src: good, hash: sourceHash },
    { law: "L2(", decl: declaration, src: { ...good, status: "known-gap" }, hash: sourceHash },
    { law: "L2(", decl: declaration, src: { ...good, failed: 3 }, hash: sourceHash },
    { law: "L3(", decl: declaration, src: { ...good, verifierCommand: "npx tsx script/other.ts" }, hash: sourceHash },
    { law: "L4(", decl: declaration, src: { ...good, passed: 999, checks: 41 }, hash: sourceHash },
    { law: "L5(", decl: declaration, src: { ...good, currentCommit: "frozen" }, hash: sourceHash },
    { law: "L6(", decl: declaration, src: good, hash: null },
  ]
  for (const c of cases) {
    const r = deriveU2(c.decl, c.src, c.hash)
    check(`R3: ${c.law.slice(0, 2)} refuses its defective input`, r.errors.some((e) => e.startsWith(c.law)), r.errors.join(", ") || "no error — the law is blind")
  }

  // --- the mutant: the green-check must be load-bearing -------------------------
  console.log("\nR4: mutant — a green-blind derivation is caught")
  const libPath = join(dirname(fileURLToPath(import.meta.url)), "hub-list-derivation.ts")
  const libSrc = readFileSync(libPath, "utf8")
  const anchor = 'if (source?.status !== "verified") errors.push(`L2(source is not verified: ${String(source?.status)})`)'
  check("R4: the mutant anchor exists", libSrc.includes(anchor))
  const mutantPath = join(dirname(fileURLToPath(import.meta.url)), ".mutant-u2-green-blind.ts")
  writeFileSync(mutantPath, libSrc.replace(anchor, "// green-blind mutant: the source status is ignored"))
  try {
    const mutant = (await import(mutantPath)) as { deriveU2: typeof deriveU2 }
    const blind = mutant.deriveU2(declaration, { ...good, status: "known-gap" }, sourceHash)
    check(
      "R4: the mutant accepts a red source — the negative catches it (the law is load-bearing)",
      !blind.errors.some((e) => e.startsWith("L2(source is not verified")),
      blind.errors.join(", "),
    )
  } finally {
    rmSync(mutantPath, { force: true })
  }

  // --- seal the derivation ------------------------------------------------------
  const failed = checks - passed
  const record: Record<string, unknown> = {
    ...derived.record,
    // The library is pure (no clock); the gate stamps and seals.
    generatedAt: new Date().toISOString(),
    gateCommit: currentCommit,
    // The §8.4 fingerprint. `derived.record` spreads the SOURCE record's fields
    // (this record is a derivation of U4's, per `derivedFrom`), and a
    // derivation must not inherit a fingerprint computed over a different
    // coverage — so the fields are stamped here, from THIS gate's declared
    // coverage, AFTER the spread.
    ...fingerprintFields(["m44.U2"], ROOT),
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeSealed(OUT, record)
  const status = failed === 0 && derived.errors.length === 0 ? "verified" : "known-gap"
  console.log(`\nU2: ${status.toUpperCase()} (${passed}/${checks} passed, source ${sourceRel} @ ${String(source?.currentCommit ?? "?").slice(0, 8)})`)
  console.log(`Evidence (sealed): ${OUT}`)
  process.exit(status === "verified" ? 0 : 1)
}

void main()
