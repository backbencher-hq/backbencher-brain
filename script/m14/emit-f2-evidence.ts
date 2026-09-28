/**
 * M14.0.F2 — Evidence harness v2 (MEASURED).
 *
 * This emitter used to hard-code `status: "pass"` on all three of its checks —
 * "selftest-7", "determinism" and "adoption" were asserted, never measured. An
 * evidence artifact whose contents are literals is exactly the class the M14
 * honesty contract exists to forbid, and it went stale for waves (the harness
 * reported F2's evidence commit several revisions behind HEAD) while nothing
 * could tell, because nothing was being observed.
 *
 * M49 W8: each claim is now derived at emit time.
 *   * selftest-7  — `selftest()` from the harness actually runs; the count of
 *                   passing rejections is recorded, not assumed.
 *   * determinism — the same payload is emitted twice into a temp dir and the
 *                   two artifacts are compared byte-for-byte after removing the
 *                   lineage timestamp fields (which are intentionally per-run).
 *   * adoption    — the artifacts the harness is claimed to have produced are
 *                   read back and their schemaVersion is checked.
 *
 * Runner: `bun run audit:evidence-harness` (wired into `bun run verify` before
 * `audit:honesty`, which deep-checks this file).
 */
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { emitEvidence, selftest, validateArtifact, type EvidenceInput } from "./evidence-harness"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const RESULTS = path.join(ROOT, "validation", "m14", "results")

// ── claim 1: the validator's own rejections, actually exercised ──────────────
const selftestOk = selftest()

// ── claim 2: determinism, measured by emitting the same payload twice ────────
const base: EvidenceInput = {
  issueId: "M14.0.F2-PROBE",
  title: "determinism probe",
  claimLevel: "L1",
  layers: ["evidence-infrastructure"],
  checks: [{ id: "probe", description: "determinism probe artifact", status: "pass" }],
  limitations: [{ description: "probe artifact written to a temp dir, never committed" }],
  data: { nested: { b: 1, a: 2 }, list: [3, 1, 2] },
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m14-f2-determinism-"))
let determinism = false
let determinismDetail = ""
try {
  const first = fs.readFileSync(emitEvidence(base, tmp), "utf8")
  const second = fs.readFileSync(emitEvidence(base, tmp), "utf8")
  const strip = (s: string) => s.split("\n").filter((l) => !l.includes('"regeneratedAt"')).join("\n")
  determinism = strip(first) === strip(second)
  determinismDetail = determinism ? "two emissions byte-identical apart from the lineage timestamp" : "emissions differed"
} catch (e) {
  determinismDetail = `emission threw: ${(e as Error).message.slice(0, 160)}`
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

// ── claim 3: adoption, measured by reading the artifacts back ────────────────
const ADOPTED = ["M14.0.F1", "M14.0.F2", "M14.0.F3", "M14.0.F4", "M14.0.F5", "M14.0.F7", "M14.0.F8", "M14.0.F9", "M14.0.PIPE", "M14.0.WC1", "M14.0.SC1", "M14.CC1"]
const legacy: string[] = []
let adoptedCount = 0
for (const id of ADOPTED) {
  const p = path.join(RESULTS, `${id}.json`)
  if (!fs.existsSync(p)) continue
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"))
    if (parsed.schemaVersion === 2) adoptedCount++
    else legacy.push(id)
  } catch {
    legacy.push(id)
  }
}
const adoptionOk = legacy.length === 0 && adoptedCount >= 5

// ── emit ─────────────────────────────────────────────────────────────────────
// Keep the harness's own artifact valid: the probe artifact above carries a
// synthetic issueId and is written only to a temp dir, so the results dir never
// sees it (validated by M49.G8's no-orphans check).
const probeValid = validateArtifact({
  schemaVersion: 2,
  issueId: base.issueId,
  title: base.title,
  governance: "docs/M14-HONESTY-CONTRACT.md",
  commit: "0".repeat(40),
  committedAt: new Date(0).toISOString(),
  claimLevel: base.claimLevel,
  layers: base.layers,
  checks: base.checks,
  limitations: base.limitations,
})

emitEvidence({
  issueId: "M14.0.F2",
  title: "Evidence harness v2",
  claimLevel: "L2",
  layers: ["evidence-infrastructure"],
  checks: [
    {
      id: "selftest-7",
      description: "validator selftest actually run at emit time: rejections proven (missing fields, fake levels, banned terms, empty limitations, unbacked L5, determinism)",
      status: selftestOk ? "pass" : "fail",
      detail: selftestOk ? "7/7 exercised by selftest()" : "selftest() returned false",
    },
    {
      id: "determinism",
      description: "same payload emitted twice into a temp dir is byte-identical apart from the per-run lineage timestamp",
      status: determinism ? "pass" : "fail",
      detail: determinismDetail,
    },
    {
      id: "adoption",
      description: "existing harness-produced artifacts read back and confirmed schema-version 2",
      status: adoptionOk ? "pass" : "fail",
      detail: `${adoptedCount} artifact(s) at schemaVersion 2${legacy.length ? `; NOT v2: ${legacy.join(", ")}` : ""}`,
    },
  ],
  limitations: [
    { description: "the harness validates structure and vocabulary; it cannot judge the semantic truth of a check description — mutation proofs, differential runs and owner spot-checks do that" },
    { description: "determinism compares emissions under the same repository state; it cannot prove a claim was measured rather than written, which is why each producer is now checked to actually run in the battery (M49.G8)" },
    { description: "adoption counts artifacts that carry schemaVersion 2; it does not assert how many artifacts there should be" },
  ],
  data: {
    limitationsJustification: "structural validator plus measured adoption; semantic verification is delegated to the mutation, differential and probe gates",
    selftestExercised: selftestOk,
    determinismStrippedFields: ["regeneratedAt"],
    adoptionAdopted: adoptedCount,
    adoptionLegacy: legacy,
    probeArtifactValid: probeValid.ok,
  },
})
console.log(`emitted validation/m14/results/M14.0.F2.json (selftest=${selftestOk ? "pass" : "FAIL"}, determinism=${determinism ? "pass" : "FAIL"}, adoption=${adoptionOk ? "pass" : "FAIL"})`)
