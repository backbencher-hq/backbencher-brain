// script/m61/verify-sealing.ts — M61.V1 verifier + mutation suite (issue #842).
//
// Proves the ONE evidence write/read path (script/lib/evidence.ts) honors its
// declared law, and that this suite CAN FAIL by planting source-level defects
// in a mutated copy of the library and running the same assertions against it.
//
//   R1  seal at write:    writeSealed emits a bbSeal envelope; the content
//                         sha256 recomputes independently; dirs are created
//   R2  round-trip:       readEvidence returns the exact record + seal
//   R3  tamper:           a byte-level edit after sealing is refused
//   R4  clobber/unparse/missing: the other refusal kinds, each with reason
//   R5  bypass:           a record written the OLD way (raw writeFileSync)
//                         is refused unsealed — the old path is dead
//   R6  wrong payload:    a seal over a different record is refused
//   R7  bad envelope:     wrong alg / malformed digest refused
//   R8  re-stamp law:     a re-run re-seals validly; changed content never
//                         re-validates under the old seal
//   R9  transition:       clean legacy accepted+flagged; tampered/unparseable
//                         stay hard refusals even in the window
//   R10 migration:        sealLegacyFile preserves every field, is idempotent,
//                         and the migrated file verifies
//   R11 atomic shape:     no temp files left at the target after write
//   R12 dogfood:          THIS verifier's own evidence file verifies through
//                         the trusted read (the first sealed record in the repo)
//   M1-M5 mutants:        suite catches a lax verify, a wrong-payload hash, a
//                         bypassing write, a legacy door that accepts tampered
//                         files, and a migration that drops fields
//
// Run: npx tsx script/m61/verify-sealing.ts
// Evidence: validation/m61/results/V1.json (machine-emitted, SEALED)

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

import {
  SEAL_KEY,
  readEvidence,
  readEvidenceAllowingLegacy,
  sealFor,
  sealLegacyFile,
  sealedContent,
  verifySeal,
  writeSealed,
  type EvidenceSeal,
} from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const RESULTS = path.join(ROOT, "validation/m61/results")

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

// --- fixture -----------------------------------------------------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), "m61-v1-"))
const target = path.join(tmp, "nested", "results", "V1.json")
const record = {
  issue: "M61.V1",
  status: "verified",
  passed: 3,
  failures: [] as string[],
  generatedAt: "2026-09-15T00:00:00.000Z",
}

try {
  // --- R1: seal at write ------------------------------------------------------
  const seal = writeSealed(target, record, new Date("2026-09-15T00:00:00.000Z"))
  check("R1: writeSealed returns a sha256 seal", seal.alg === "sha256" && /^[0-9a-f]{64}$/.test(seal.contentSha256))
  const onDisk = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>
  check("R1: the file carries the bbSeal envelope", typeof onDisk[SEAL_KEY] === "object")
  const expectedSha = createHash("sha256").update(sealedContent(record), "utf8").digest("hex")
  check("R1: the sealed sha256 recomputes independently from the record", expectedSha === seal.contentSha256, `${expectedSha} != ${seal.contentSha256}`)
  check("R1: the write creates parent directories", existsSync(target))

  // --- R2: round-trip ----------------------------------------------------------
  const back = readEvidence<typeof record>(target)
  check("R2: the trusted read accepts the sealed record", back.ok)
  if (back.ok) {
    const { [SEAL_KEY]: _dropped, ...readable } = back.record as Record<string, unknown>
    check("R2: the record round-trips exactly (sans the seal key)", JSON.stringify(readable) === JSON.stringify(record))
    check("R2: the read returns the seal", back.seal.contentSha256 === seal.contentSha256)
  }

  // --- R3: tamper ---------------------------------------------------------------
  const tamperedPath = path.join(tmp, "tampered.json")
  const s2 = writeSealed(tamperedPath, record)
  const tampered = JSON.parse(readFileSync(tamperedPath, "utf8")) as Record<string, unknown>
  tampered.status = "VERIFIED-BUT-LIES"
  writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`)
  const tRead = readEvidence(tamperedPath)
  check("R3: an edited record is refused", !tRead.ok && tRead.kind === "tampered", tRead.ok ? "accepted!" : tRead.reason)

  // --- R4: clobber / unparseable / missing -------------------------------------
  const clobberedPath = path.join(tmp, "clobbered.json")
  writeSealed(clobberedPath, record)
  writeFileSync(clobberedPath, `${JSON.stringify({ someone: "else wrote me" }, null, 2)}\n`)
  const cRead = readEvidence(clobberedPath)
  check("R4: a clobbered record is refused unsealed", !cRead.ok && cRead.kind === "unsealed", cRead.ok ? "accepted!" : cRead.reason)

  const unparseablePath = path.join(tmp, "unparseable.json")
  writeSealed(unparseablePath, record)
  writeFileSync(unparseablePath, "{ not json")
  const uRead = readEvidence(unparseablePath)
  check("R4: an unparseable record is refused", !uRead.ok && uRead.kind === "unparseable", uRead.ok ? "accepted!" : uRead.reason)

  const mRead = readEvidence(path.join(tmp, "missing.json"))
  check("R4: a missing record is refused", !mRead.ok && mRead.kind === "missing", mRead.ok ? "accepted!" : mRead.reason)

  // --- R5: the old write path is dead -------------------------------------------
  const legacyRawPath = path.join(tmp, "legacy-raw.json")
  writeFileSync(legacyRawPath, `${JSON.stringify({ status: "verified", note: "written the pre-M61 way" }, null, 2)}\n`)
  const lRead = readEvidence(legacyRawPath)
  check("R5: a record written the old way is refused unsealed by the trusted read", !lRead.ok && lRead.kind === "unsealed", lRead.ok ? "accepted!" : lRead.reason)

  // --- R6: wrong payload ----------------------------------------------------------
  const wrongPath = path.join(tmp, "wrong-payload.json")
  const wrongRecord = { ...record, status: "different" }
  const wrongSeal = sealFor(wrongRecord)
  writeFileSync(wrongPath, `${JSON.stringify({ ...record, [SEAL_KEY]: wrongSeal }, null, 2)}\n`)
  const wRead = readEvidence(wrongPath)
  check("R6: a seal over a different record is refused", !wRead.ok && wRead.kind === "tampered", wRead.ok ? "accepted!" : wRead.reason)

  // --- R7: bad envelope -----------------------------------------------------------
  const badAlgPath = path.join(tmp, "bad-alg.json")
  writeFileSync(badAlgPath, `${JSON.stringify({ ...record, [SEAL_KEY]: { alg: "md5", sealedAt: seal.sealedAt, contentSha256: seal.contentSha256 } }, null, 2)}\n`)
  const bRead = readEvidence(badAlgPath)
  check("R7: a wrong-alg envelope is refused", !bRead.ok && bRead.kind === "bad-seal", bRead.ok ? "accepted!" : bRead.reason)

  const badLenPath = path.join(tmp, "bad-len.json")
  writeFileSync(badLenPath, `${JSON.stringify({ ...record, [SEAL_KEY]: { alg: "sha256", sealedAt: seal.sealedAt, contentSha256: seal.contentSha256.slice(0, 63) } }, null, 2)}\n`)
  const blRead = readEvidence(badLenPath)
  check("R7: a malformed digest is refused", !blRead.ok && blRead.kind === "bad-seal", blRead.ok ? "accepted!" : blRead.reason)

  // --- R8: the re-stamp law ---------------------------------------------------------
  const resealed = writeSealed(target, record, new Date("2026-09-15T01:00:00.000Z"))
  check("R8: a legitimate re-run re-seals validly", resealed.contentSha256 === seal.contentSha256 && resealed.sealedAt !== seal.sealedAt)
  const changed = { ...record, passed: 999 }
  const changedSeal = sealFor(changed, new Date("2026-09-15T02:00:00.000Z"))
  check("R8: changed content never re-validates under the old sha", changedSeal.contentSha256 !== seal.contentSha256)

  // --- R9: the transition window ------------------------------------------------------
  const wRead2 = readEvidenceAllowingLegacy(legacyRawPath)
  check("R9: a clean legacy record is accepted and flagged in the window", wRead2.ok && wRead2.legacy === true, wRead2.ok ? `legacy=${(wRead2 as { legacy?: boolean }).legacy}` : wRead2.reason)
  const tamperedWindow = readEvidenceAllowingLegacy(tamperedPath)
  check("R9: a tampered record stays a hard refusal in the window", !tamperedWindow.ok && tamperedWindow.kind === "tampered", tamperedWindow.ok ? "accepted!" : tamperedWindow.reason)
  const unparseableWindow = readEvidenceAllowingLegacy(unparseablePath)
  check("R9: an unparseable record stays a hard refusal in the window", !unparseableWindow.ok && unparseableWindow.kind === "unparseable", unparseableWindow.ok ? "accepted!" : unparseableWindow.reason)
  const sealedWindow = readEvidenceAllowingLegacy(target)
  check("R9: a sealed record reads without the legacy flag", sealedWindow.ok && sealedWindow.legacy === undefined, sealedWindow.ok ? `legacy=${sealedWindow.legacy}` : sealedWindow.reason)

  // --- R10: migration -------------------------------------------------------------------
  const migratePath = path.join(tmp, "migrate.json")
  const original = { issue: "M24.P1", status: "verified", checks: 42, generatedAt: "2026-08-22T10:00:00.000Z" }
  writeFileSync(migratePath, `${JSON.stringify(original, null, 2)}\n`)
  const migSeal = sealLegacyFile(migratePath)
  check("R10: the migration seals a legacy file", migSeal !== null)
  const migrated = JSON.parse(readFileSync(migratePath, "utf8")) as Record<string, unknown>
  const preserved = Object.keys(original).every((k) => JSON.stringify(migrated[k]) === JSON.stringify((original as Record<string, unknown>)[k]))
  check("R10: every original field is preserved", preserved)
  const mBack = readEvidence(migratePath)
  check("R10: the migrated file verifies through the trusted read", mBack.ok)
  const secondPass = sealLegacyFile(migratePath)
  check("R10: the migration is idempotent", secondPass === null)

  // --- R11: atomic shape ------------------------------------------------------------------
  const siblings = readdirSync(path.dirname(target)).filter((f) => f.includes(".tmp-"))
  check("R11: no temp files are left at the target after a write", siblings.length === 0, siblings.join(","))

  // --- M1-M5: the suite CAN FAIL (source-level mutants of the library) --------------------
  // Probe contract: probe(mod) === true means the planted defect MANIFESTED
  // (the corresponding R-check would fail against this library) — that is the
  // can-fail proof. A probe that stays false means the mutant was inert and
  // the suite could NOT have caught the defect class.
  const libSource = readFileSync(path.join(ROOT, "script/lib/evidence.ts"), "utf8")
  // Mutant copies are written BESIDE their source (script/lib/) so the copy's
  // own relative imports resolve. Writing them into script/m61/ broke every
  // mutant import the moment evidence.ts gained `import ... from "./lock.ts"`
  // — the failure that made this gate exit 1 while the m53 ladder (which does
  // not list the M61 gates) still showed green.
  const MUTANT_DIR = path.join(ROOT, "script/lib")
  for (const f of readdirSync(MUTANT_DIR)) {
    if (f.startsWith(".mutant-evidence-")) rmSync(path.join(MUTANT_DIR, f), { force: true })
  }
  const runMutant = async (name: string, from: string, to: string, probe: (mod: Record<string, unknown>) => boolean): Promise<void> => {
    if (!libSource.includes(from)) {
      check(`M: ${name} (mutation anchor exists)`, false, "anchor not found — the mutant is stale")
      return
    }
    const mutated = libSource.replace(from, to)
    const mutantPath = path.join(MUTANT_DIR, `.mutant-evidence-${name.replace(/[^a-z0-9]+/gi, "-")}.ts`)
    writeFileSync(mutantPath, mutated)
    try {
      const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
      check(`M: ${name}`, probe(mod) === true, "the mutant did NOT manifest the defect — the suite could not fail")
    } catch (e) {
      // A mutant that crashes the library at RUNTIME also breaks the R-checks
      // that gate on it — the defect class is still caught by the suite. A
      // mutant that cannot even LOAD (module resolution, syntax) is NOT a
      // can-fail proof — it silently disarms the check, so it fails here.
      const code = (e as NodeJS.ErrnoException).code ?? ""
      const cannotLoad = code.startsWith("ERR_MODULE") || code === "ERR_UNKNOWN_FILE_EXTENSION" || e instanceof SyntaxError
      if (cannotLoad) check(`M: ${name}`, false, `the mutant could not load (${code || (e as Error).name}) — the can-fail proof is disarmed`)
      else check(`M: ${name}`, true, `(mutant crashed at runtime — still caught: ${(e as Error).message})`)
    } finally {
      rmSync(mutantPath, { force: true })
    }
  }

  // M1: a lax verifier (skips the comparison) must let tampered content
  // through the trusted read — R3 would fail against this library.
  // M61.V6 / #847 — the unsealed-evidence-trust class, made extinct. Incident:
  // 690 evidence records were written as bare JSON, so a clobbered, half-written
  // or hand-edited record was believed by every downstream gate.
  await runMutant("lax-verify-accepts-tamper", "if (actual !== seal.contentSha256) {", "if (false) {", (mod) => {
    const p = path.join(tmp, "m1.json")
    ;(mod.writeSealed as typeof writeSealed)(p, record)
    const t = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
    t.status = "TAMPERED"
    writeFileSync(p, `${JSON.stringify(t, null, 2)}\n`)
    return (mod.readEvidence as typeof readEvidence)(p).ok === true
  })

  // M2: a hash computed over the WRONG payload — one that fails to strip the
  // seal key — must diverge from the independent recomputation (R1 fails).
  await runMutant("hash-includes-seal-key", "return JSON.stringify(rest)", "return JSON.stringify({ ...record, [SEAL_KEY]: { stale: true } })", (mod) => {
    const withOldSeal = { ...record, [SEAL_KEY]: { alg: "sha256", sealedAt: "stale", contentSha256: "a".repeat(64) } }
    const s = (mod.sealFor as typeof sealFor)(withOldSeal) as EvidenceSeal
    const expected = createHash("sha256").update(sealedContent(record), "utf8").digest("hex")
    return s.contentSha256 !== expected
  })

  // M3: a write that skips sealing breaks the round-trip — the library's own
  // trusted read refuses what its writer produced (R2 would fail).
  await runMutant("write-skips-seal", "const sealed: Record<string, unknown> = { ...record, [SEAL_KEY]: seal }", "const sealed: Record<string, unknown> = { ...record }", (mod) => {
    const p = path.join(tmp, "m3.json")
    ;(mod.writeSealed as typeof writeSealed)(p, record)
    return (mod.readEvidence as typeof readEvidence)(p).ok === false
  })

  // M4: the legacy door is defended IN DEPTH — the outer kind-gate (only
  // "unsealed" records enter the legacy path) and the inner seal-key guard
  // (a record carrying any bbSeal envelope never qualifies as legacy) are
  // independent. The can-fail proof plants BOTH defects (a double mutant)
  // and asserts a tampered record is accepted; M4b proves each single defect
  // alone is CONTAINED (a single mutant cannot manifest the defect).
  const legacyDoorOuter = "if (result.kind === \"unsealed\") {"
  const legacyDoorInner = "(parsed as Record<string, unknown>)[SEAL_KEY] === undefined"
  const legacyDoorDouble = libSource.replace(legacyDoorOuter, "if (result.kind !== \"missing\") {").replace(legacyDoorInner, "true")
  {
    const mutantPath = path.join(MUTANT_DIR, ".mutant-evidence-legacy-door-double.ts")
    writeFileSync(mutantPath, legacyDoorDouble)
    try {
      const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
      const p = path.join(tmp, "m4.json")
      ;(mod.writeSealed as typeof writeSealed)(p, record)
      const t = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
      t.status = "TAMPERED"
      writeFileSync(p, `${JSON.stringify(t, null, 2)}\n`)
      const accepted = ((mod.readEvidenceAllowingLegacy as typeof readEvidenceAllowingLegacy)(p) as { ok: boolean }).ok === true
      check("M: legacy-door-double-mutant accepts tamper (can-fail proof)", accepted, "the double mutant still refused — the suite could not fail")
    } finally {
      rmSync(mutantPath, { force: true })
    }
  }
  {
    const mutantPath = path.join(MUTANT_DIR, ".mutant-evidence-legacy-door-single.ts")
    writeFileSync(mutantPath, libSource.replace(legacyDoorOuter, "if (result.kind !== \"missing\") {"))
    try {
      const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
      const p = path.join(tmp, "m4b.json")
      ;(mod.writeSealed as typeof writeSealed)(p, record)
      const t = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
      t.status = "TAMPERED"
      writeFileSync(p, `${JSON.stringify(t, null, 2)}\n`)
      const refused = ((mod.readEvidenceAllowingLegacy as typeof readEvidenceAllowingLegacy)(p) as { ok: boolean }).ok === false
      check("M: legacy-door single mutant is contained (defense in depth)", refused, "a single widened door accepted tamper — the depth defense is gone")
    } finally {
      rmSync(mutantPath, { force: true })
    }
  }

  // M5: a migration that drops fields violates field preservation (R10).
  await runMutant("migration-drops-fields", "const sealed = { ...parsed, [SEAL_KEY]: seal }", "const sealed = { [SEAL_KEY]: seal }", (mod) => {
    const p = path.join(tmp, "m5.json")
    writeFileSync(p, `${JSON.stringify(original, null, 2)}\n`)
    ;(mod.sealLegacyFile as typeof sealLegacyFile)(p)
    const m = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>
    return !Object.keys(original).every((k) => JSON.stringify(m[k]) === JSON.stringify((original as Record<string, unknown>)[k]))
  })

  // --- R12: dogfood — this verifier's own evidence is sealed ------------------------------
  const evidencePath = path.join(RESULTS, "V1.json")
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const evidence = {
    issue: "M61.V1 evidence sealing (issue #842)",
    code: "V1",
    milestone: "M61",
    status: failed === 0 ? "verified" : "known-gap",
    checks: checks.length,
    passed,
    failed,
    realFailed: failed,
    failures,
    checks,
    currentCommit: commit,
    verifierCommand: "npx tsx script/m61/verify-sealing.ts",
    evidenceFile: "V1.json",
    generatedAt: new Date().toISOString(),
    limitations: [
      "Seals verify INTEGRITY (the record is exactly what its writer sealed), not freshness — freshness stays the M29 relevance rule's job.",
      "R11 asserts the declared temp+rename contract (no temp residue); a true crash-injection test would need a filesystem fault injector and is out of scope for V1.",
      "Mutants M1-M5 are source-level copies of the library imported from a mutated file; the real gate always imports the untouched script/lib/evidence.ts.",
    ],
  }
  // The record must agree with the RUN — so it is (re)written after every
  // check, including the two below. Found the hard way: the first form wrote
  // 32/32 and then ran two more checks, printing 34/34 while the record said
  // 32 — the record-disagrees-with-the-run class this very milestone exists to
  // kill (the M61.V2 record had the identical defect). `emit()` re-reads the
  // counters, so the last write is always the truth.
  const emit = () => ({ ...evidence, checks: checks.length, passed, failed, realFailed: failed, checksList: checks })
  writeSealed(evidencePath, emit())
  const selfRead = readEvidence(evidencePath)
  check("R12: this verifier's own evidence file verifies through the trusted read", selfRead.ok)
  const evidenceSeal = writeSealed(evidencePath, emit())
  check("R12: the emitted evidence carries a valid seal", typeof evidenceSeal.contentSha256 === "string" && evidenceSeal.contentSha256.length === 64)
  writeSealed(evidencePath, emit())

  console.log(`\nM61.V1: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks.length})`)
  console.log(`Evidence (sealed): ${evidencePath}`)
  if (failures.length > 0) {
    console.log("Failures:")
    for (const f of failures) console.log(`  - ${f}`)
  }
  process.exitCode = failed === 0 ? 0 : 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
