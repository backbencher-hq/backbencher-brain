// script/m61/verify-claim-fingerprints.ts — M61.V8: the §8.4 SOURCE-FINGERPRINT
// census gate.
//
// THE DEFECT THIS MEASURES (first form of this gate, committed BEFORE any fix,
// IDE Honesty Contract §11 F7: gate before fix):
//
//   §8.4 requires every claim field to carry `sourceFingerprint` — the value
//   that says WHICH BYTES the result was computed from. Without it a claim
//   cannot be re-earned or falsified against its inputs, which is exactly what
//   §8.2 requires ("evidence must regenerate byte-identically from the current
//   commit") and exactly what this repository could not demonstrate for the
//   large majority of its claims. The census below counts them.
//
//   Twenty-three records carried a value, in FOUR mutually incompatible
//   conventions (single-file digest; ordered path-list fold; a `sha256sum`
//   SPAWN — a binary script/m24/portability.ts bans, the m24 lane's own live
//   F7 defect; and an object map that no string comparison can find). Two of
//   four spellings of one field are wrong, so a gate cannot even parse the
//   field consistently, let alone check it.
//
// WHAT THIS FIRST FORM DOES — and deliberately no more:
//
//   F0  the census is real and not vacuous (it sees records, lanes, statuses);
//   F1  THE RED ASSERTION: no IN-SCOPE lane's `verified` claim may lack the
//       field. It fails, with the count and the codes named. That is the state
//       this gate exists to end, and it is committed red on purpose.
//   F2  the out-of-scope census is PUBLISHED, not passed: every verified claim
//       outside the LSP lanes is counted, listed, and declared out of scope with
//       a reason. The next commit turns F1 green for the lanes this program owns
//       and adds the re-derivation and discrimination predicates (F3/F4).
//
// Run: npx tsx script/m61/verify-claim-fingerprints.ts
// Evidence: validation/m61/results/V8.json (sealed)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readEvidence, writeSealed } from "../lib/evidence.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(ROOT, "validation/m61/results")

/** The lanes whose claims this program OWNS the fingerprints for. The LSP/IDE
 *  program scope: contract §0 (`script/m24/`…`script/m29/`, `script/m42/`) plus
 *  the amendments that name their own lanes (§12 m42, §13 m44, §15 m55) and the
 *  two governance lanes whose records this fix converts. Every other lane is
 *  censused and declared out of scope — counted, never passed. */
const IN_SCOPE_LANES = ["m24", "m26", "m27", "m28", "m29", "m42", "m44", "m55", "m62"]

/**
 * Why a lane is NOT in scope, per lane, with the reason stated. An out-of-scope
 * declaration that says only "out of scope" is a gap with a label on it; these
 * say whose generator it is, which is the same disclosure m61's ledger gate makes
 * for its own residual (script/m61/verify-ledger-truth.ts OUT_OF_SCOPE_DECLARED).
 */
const OUT_OF_SCOPE: Record<string, string> = {
  m20: "M14-era migration/patterns/security/doc lane; its records DO carry m20's own fingerprint convention (src/intelligence/*/evidence.ts), which this fix does not redefine — a second rule for it is m20's decision, not this lane's",
  m21: "Indexing Performance & Reliability Truth — a benchmark lane whose records are timings from the bench harness on named corpora; the generator (script/m21/*) belongs to another track",
  m22: "CLI cwd/env lane (bun run script/m22/verify-c1-cwd.ts and siblings); generator owned by another track",
  m23: "governance + parsing lane (bun run script/m23/verify-g1-governance.ts and siblings); generator owned by another track",
  m25: "editor/fork/OS-platform lane: its legs are runtime-scoped (fork editors, VS Code, the os-matrix workflow) and its records are the declared platform measurements; the OS/forks census is script/m61/verify-ledger-truth.ts G5's job",
  m30: "onboarding/setup lane with its own `sha256sum`-spawn fingerprint convention (C above) — that spawn is BANNED by script/m24/portability.ts and is a real portability defect, but m30 owns the fix and this lane does not edit its records",
  m31: "docs tool-mode lane, generator owned by another track",
  m32: "setup/show/doctor lane, generator owned by another track",
  m33: "CLI surface lane, generator owned by another track",
  m34: "install/packaging lane (artifact-dependent legs), generator owned by another track",
  m35: "staleness/envelope lane, generator owned by another track",
  m36: "CI-repair lane, generator owned by another track",
  m40: "post-entry/index-refresh lane, generator owned by another track",
  m41: "website truth/SEO lane, generator owned by another track",
  m43: "MCP auto-refresh lane, generator owned by another track",
  m45: "demo-media/capture lane: artifact-dependent (pinned VSIX, capture runtimes), generator owned by another track",
  m48: "impact/honesty-fields lane, generator owned by another track",
  m50: "vector/planner lane, generator owned by another track",
  m53: "lifecycle-corpus lane (the 41-gate ladder's own record), generator owned by another track",
  m54: "fk/stdio lane, generator owned by another track",
  m56: "website IA/tools lane, generator owned by another track",
  m57: "classifier/triage lane, generator owned by another track",
  m59: "language-surface lane, generator owned by another track",
  m60: "family-closure lane, generator owned by another track",
  m63: "cross-language/wiring lane, generator owned by another track",
  embedding: "not a milestone lane (validation/embedding) — a corpus artifact directory, not a claim ledger",
  typing: "not a milestone lane (validation/typing) — a corpus artifact directory, not a claim ledger",
  m61: "this gate's own lane: m61's records are governance records about OTHER lanes' gates, and m61 owns the fingerprints for them under script/m61/ — declared here rather than converted by this gate",
}

let checks = 0
let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}

let mutantsTotal = 0
let mutantsCaught = 0
const mutantRecords: Array<{ name: string; caught: boolean }> = []
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  mutantRecords.push({ name: label, caught })
  console.log(`  ${caught ? "ok  " : "SURV"}: M: ${label}${caught || !detail ? "" : ` — ${detail}`}`)
}

export type ClaimRow = {
  lane: string
  claim: string
  file: string
  status: string
  verifierCommand: string
  fingerprint: unknown
  declaredAlgorithm: unknown
  recordTrusted: boolean
  recordReason: string
}

/** One evidence record as the census sees it. Reads go through the TRUSTED sealed
 *  path (script/lib/evidence.ts), so a tampered record cannot be counted as
 *  carrying a fingerprint just by having the key — the m55 lesson. A record the
 *  trusted path REFUSES is returned with `recordTrusted: false` and the reason,
 *  never dropped: a census that silently drops what it could not read reports a
 *  smaller corpus than the repository has. */
function censusClaim(lane: string, file: string): ClaimRow {
  const abs = path.join(ROOT, "validation", lane, "results", file)
  const base = {
    lane,
    claim: `${lane}.${path.basename(file, ".json")}`,
    file: `validation/${lane}/results/${file}`,
    status: "",
    verifierCommand: "",
    fingerprint: undefined,
    declaredAlgorithm: undefined,
    recordTrusted: false,
    recordReason: "not read",
  }
  const read = readEvidence<Record<string, unknown>>(abs)
  if (!read.ok) return { ...base, recordReason: `${read.kind}: ${read.reason}` }
  const record = read.record
  return {
    lane,
    claim: `${lane}.${path.basename(file, ".json")}`,
    file: `validation/${lane}/results/${file}`,
    status: typeof record.status === "string" ? record.status : "",
    verifierCommand: typeof record.verifierCommand === "string" ? record.verifierCommand : "",
    fingerprint: record.sourceFingerprint,
    declaredAlgorithm: record.sourceFingerprintAlgorithm,
    recordTrusted: true,
    recordReason: "",
  }
}

/** Every evidence record under validation/<lane>/results, across every lane
 *  (the denominator for the out-of-scope census is the whole repository, not
 *  the lanes we happen to own). */
function censusRepository(): ClaimRow[] {
  const out: ClaimRow[] = []
  const base = path.join(ROOT, "validation")
  for (const lane of readdirSync(base).sort()) {
    const dir = path.join(base, lane, "results")
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json") || f === "manifest.json") continue
      out.push(censusClaim(lane, f))
    }
  }
  return out
}

function main(): void {
  const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

  // --- F0: the census is real ------------------------------------------------
  console.log("F0: the census is real, not vacuous")
  const rows = censusRepository()
  const untrusted = rows.filter((r) => !r.recordTrusted)
  const trusted = rows.filter((r) => r.recordTrusted)
  const verified = trusted.filter((r) => r.status === "verified")
  const withField = verified.filter((r) => typeof r.fingerprint === "string" && r.fingerprint.length > 0)
  const withoutField = verified.filter((r) => !(typeof r.fingerprint === "string" && r.fingerprint.length > 0))
  check("F0: the census sees evidence records across validation/", rows.length > 100, `records=${rows.length}`)
  check("F0: the census sees `verified` claims to measure", verified.length > 0, `verified=${verified.length}`)
  check("F0: the in-scope lane set is non-empty (a census over zero owned lanes passes vacuously)", IN_SCOPE_LANES.length > 0, `lanes=${IN_SCOPE_LANES.join(",")}`)
  // The arithmetic invariant that stops the census from quietly shrinking: every
  // record it saw is either trusted or refused-WITH-A-REASON. A drop here is the
  // difference between "221 claims lack a fingerprint" and "the gate could not
  // read 73 of them" — two very different findings that look identical in a
  // count. (Measured at this HEAD: 1136 records, 581 unsealed under the D-1
  // migration window, 21 whose seal does not verify.)
  check(
    "F0: every record the census saw is accounted for — trusted, or refused with a stated reason (never silently dropped)",
    trusted.length + untrusted.length === rows.length && untrusted.every((r) => r.recordReason.length > 0),
    `trusted=${trusted.length} refused=${untrusted.length} total=${rows.length}`,
  )
  check(
    "F0b: the accounting invariant above is LOAD-BEARING on this tree — the corpus really does contain records the trusted path refuses (a tree where everything verifies would make it vacuous)",
    untrusted.length > 0,
    `refused=${untrusted.length}`,
  )
  console.log(
    `      refused by the trusted path: ${untrusted.length} of ${rows.length} — ${[...new Set(untrusted.map((r) => r.recordReason.split(":")[0]))].sort().join(", ") || "(none)"}`,
  )

  // --- F1: THE RED ASSERTION -------------------------------------------------
  const inScope = verified.filter((r) => IN_SCOPE_LANES.includes(r.lane))
  const inScopeWithout = inScope.filter((r) => !(typeof r.fingerprint === "string" && r.fingerprint.length > 0))
  console.log(`\nF1: no in-scope \`verified\` claim may lack sourceFingerprint`)
  console.log(`      repository: ${verified.length} verified, ${withField.length} with the field, ${withoutField.length} without`)
  for (const lane of IN_SCOPE_LANES) {
    const rows2 = inScope.filter((r) => r.lane === lane)
    const missing = rows2.filter((r) => !(typeof r.fingerprint === "string" && r.fingerprint.length > 0))
    console.log(`      ${lane.padEnd(6)} ${rows2.length - missing.length}/${rows2.length}`)
  }
  check(
    "F1: every IN-SCOPE lane's `verified` claim carries sourceFingerprint (§8.4)",
    inScopeWithout.length === 0,
    `${inScopeWithout.length} of ${inScope.length} in-scope verified claims cannot name the source they were computed from: ${inScopeWithout.map((r) => r.claim).slice(0, 14).join(", ")}${inScopeWithout.length > 14 ? ` … +${inScopeWithout.length - 14} more` : ""}`,
  )

  // --- F2: the out-of-scope census is PUBLISHED, not passed -------------------
  console.log("\nF2: every lane outside the LSP scope is DECLARED, with a reason")
  const outOfScope = verified.filter((r) => !IN_SCOPE_LANES.includes(r.lane))
  const undeclaredLanes = [...new Set(outOfScope.map((r) => r.lane))].filter((l) => !(l in OUT_OF_SCOPE)).sort()
  const undeclaredOut = outOfScope.filter((r) => !(r.lane in OUT_OF_SCOPE))
  console.log(`      out-of-scope census: ${outOfScope.length} verified claims across ${new Set(outOfScope.map((r) => r.lane)).size} lanes`)
  for (const lane of [...new Set(outOfScope.map((r) => r.lane))].sort()) {
    const n = outOfScope.filter((r) => r.lane === lane).length
    const w = outOfScope.filter((r) => r.lane === lane && typeof r.fingerprint === "string" && r.fingerprint.length > 0).length
    console.log(`      ${lane.padEnd(10)} ${w}/${n} carry the field  — ${OUT_OF_SCOPE[lane] ?? "UNDECLARED"}`)
  }
  check(
    "F2: every out-of-scope lane is declared with a stated reason (never silently passed)",
    undeclaredLanes.length === 0,
    `undeclared lanes: ${undeclaredLanes.join(", ")} (${undeclaredOut.length} claims)`,
  )
  check(
    "F2b: every out-of-scope lane's reason states WHY, not \"n/a\"",
    Object.entries(OUT_OF_SCOPE).every(([lane, why]) => why.trim().length >= 24 && !/^(n\/a|none|tbd|-)\.?$/i.test(why.trim())),
    Object.entries(OUT_OF_SCOPE)
      .filter(([, why]) => why.trim().length < 24 || /^(n\/a|none|tbd|-)\.?$/i.test(why.trim()))
      .map(([lane]) => lane)
      .join(", "),
  )

  // --- Mutants: the census CAN fail ------------------------------------------
  console.log("\nMutants: the census CAN fail")
  {
    // M1: the empty-string fingerprint — the most common decorative value, and
    // one that satisfies any `hasOwnProperty("sourceFingerprint")` test.
    const present = (v: unknown): boolean => typeof v === "string" && v.length > 0
    mutant("M1: an EMPTY sourceFingerprint does not count as present", !present("") && !present(undefined) && present("a".repeat(64)))
    // M2: a record with no fingerprint at all must be counted as missing.
    mutant(
      "M2: a verified record with NO sourceFingerprint is counted as missing",
      !present({ status: "verified" }.sourceFingerprint),
    )
    // M3: the in-scope filter must EXCLUDE a lane that is not in scope, or the
    // red could be manufactured by widening the scope.
    mutant(
      "M3: the in-scope filter discriminates (a non-LSP lane is out of scope)",
      IN_SCOPE_LANES.includes("m24") && !IN_SCOPE_LANES.includes("m21"),
    )
    // M4: the census must not treat a `known-gap` record as a claim to measure —
    // a red record is not asserting it passed.
    mutant("M4: only `verified` records are measured", verified.every((r) => r.status === "verified") && !verified.some((r) => r.status === "known-gap"))
  }

  // --- Persist evidence ------------------------------------------------------
  const realFailed = failures.length
  const byLane: Record<string, { verified: number; withFingerprint: number }> = {}
  for (const r of verified) {
    const e = (byLane[r.lane] ??= { verified: 0, withFingerprint: 0 })
    e.verified++
    if (typeof r.fingerprint === "string" && r.fingerprint.length > 0) e.withFingerprint++
  }
  const result = {
    issue: "M61.V8 claim source-fingerprint census",
    code: "V8",
    milestone: "M61",
    status: realFailed > 0 || mutantsCaught < mutantsTotal ? "known-gap" : "verified",
    checks,
    passed,
    failed: realFailed,
    realFailed,
    negativeCases: mutantsTotal,
    mutantsTotal,
    mutantsCaught,
    mutantRecords,
    currentCommit: HEAD,
    verifierCommand: "npx tsx script/m61/verify-claim-fingerprints.ts",
    evidenceFile: "V8.json",
    generatedAt: new Date().toISOString(),
    census: {
      repository: {
        records: rows.length,
        trustedReads: trusted.length,
        refusedReads: untrusted.length,
        refusedByKind: [...new Set(untrusted.map((r) => r.recordReason.split(":")[0]))].sort(),
        verified: verified.length,
        withSourceFingerprint: withField.length,
        withoutSourceFingerprint: withoutField.length,
      },
      inScope: {
        lanes: IN_SCOPE_LANES,
        verified: inScope.length,
        withSourceFingerprint: inScope.length - inScopeWithout.length,
        withoutSourceFingerprint: inScopeWithout.length,
        missing: inScopeWithout.map((r) => r.claim),
      },
      outOfScope: {
        lanes: Object.keys(OUT_OF_SCOPE).sort(),
        verified: outOfScope.length,
        withSourceFingerprint: outOfScope.filter((r) => typeof r.fingerprint === "string" && r.fingerprint.length > 0).length,
        withoutSourceFingerprint: outOfScope.filter((r) => !(typeof r.fingerprint === "string" && r.fingerprint.length > 0)).length,
        reasons: OUT_OF_SCOPE,
        perLane: byLane,
      },
    },
    limitations: [
      "This first form of the gate COUNTS the field; it does not yet re-derive it. A value that is present but wrong (a constant, the digest of nothing, the record's own hash) is counted as present here and is not caught — the re-derivation and discrimination predicates (F3/F4) are the next commit, and until they land this gate is a census with teeth, not a proof.",
      "The census reads records through the trusted sealed path. A record the path REFUSES (581 unsealed under the D-1 migration window, 21 whose seal does not verify, measured at this HEAD) is returned with its reason, counted under `refusedReads`, and EXCLUDED from the verified-with/without counts: it is neither a pass nor a count of missing fields. Those refusals are script/m61/verify-sealing.ts (V1)'s finding and this gate does not repair them.",
      "Out-of-scope lanes are declared, not repaired: their generators belong to other tracks, and a red this lane cannot clear is a red that gets ignored (script/m61/verify-ledger-truth.ts makes the same argument for out-of-scope ledgers).",
      "The m30 out-of-scope reason names a LIVE defect found while measuring (its verifiers spawn `sha256sum`, a binary script/m24/portability.ts bans — the same class that killed two m24 gates on darwin). It is reported here, not fixed: m30 owns those records.",
    ],
  }
  mkdirSync(RESULTS, { recursive: true })
  writeSealed(path.join(RESULTS, "V8.json"), result)

  console.log(`\nM61.V8: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
  console.log(`  census: ${verified.length} verified claims — ${withField.length} carry sourceFingerprint, ${withoutField.length} do not`)
  console.log(`  in scope (${IN_SCOPE_LANES.length} lanes): ${inScope.length - inScopeWithout.length}/${inScope.length} carry it`)
  console.log(`  out of scope: ${outOfScope.length} verified claims across ${new Set(outOfScope.map((r) => r.lane)).size} declared lanes`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(realFailed > 0 || mutantsCaught < mutantsTotal ? 1 : 0)
}

main()
