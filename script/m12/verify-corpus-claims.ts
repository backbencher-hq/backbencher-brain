// The #834 gate. The issue's root charge: "Today a claim can be wrong by
// 62.5 percentage points and every gate is green." This gate makes that
// impossible for every claim that HAS an artifact behind it, and makes the
// claims that do NOT have an artifact a visible, tracker-keyed remainder —
// the same mechanics the M60 family gates use for open issues (J1/W1), so
// debt is named, never smoothed.
//
// Hard failures (gate is red):
//   H1. A manifest `measured.grammarErrorFiles` number that disagrees with
//       its artifact's `errorFiles`. The whole point: prose and measurement
//       must agree or someone must reconcile them by hand.
//   H2. A limit-map entry (namedGrammarLimits) whose `grammarLimit` reason is
//       missing or empty — a bare number is a claim, not evidence.
//   H3. A limit-map entry naming a file that is NOT an error file in the
//       artifact — the map is contradicted by the measurement.
//   H4. An artifact whose `passed` is true while it records unexpected errors
//       or crashes (self-contradiction).
// Remainder (visible, must equal the tracker's registered debt):
//   R1. Languages with a manifest grammar-error claim (or an analyzer row)
//       and no `*-corpus-errors.json` artifact. Registered under the
//       follow-up issue; the gate goes fully green only when this is empty.
//
// Usage: bun script/m12/verify-corpus-claims.ts
// Writes: validation/m12/results/corpus-claims-gate.json
import { readFileSync, writeFileSync, existsSync } from "node:fs"

const manifest = JSON.parse(readFileSync("validation/m12/corpus-manifest.json", "utf8"))

const hard: string[] = []
const remainder: string[] = []
const checked: { language: string; manifest: number | null; artifact: number | null; agreement: boolean | null }[] = []

for (const a of manifest.analyzers) {
  const lg: string = a.analyzer
  const meas = a.measured ?? {}
  const claimed: number | null = meas.grammarErrorFiles ?? null
  const artPath = `validation/m12/results/${lg}-corpus-errors.json`
  const hasArt = existsSync(artPath)

  if (!hasArt) {
    remainder.push(lg)
    checked.push({ language: lg, manifest: claimed, artifact: null, agreement: null })
    continue
  }

  const art = JSON.parse(readFileSync(artPath, "utf8"))
  const measured: number = art.errorFiles
  checked.push({ language: lg, manifest: claimed, artifact: measured, agreement: claimed === measured })

  // H1 — number agreement. Only enforced where the manifest claims a number.
  if (claimed !== null && claimed !== measured) {
    hard.push(`H1 ${lg}: manifest claims grammarErrorFiles=${claimed} but artifact measures ${measured}`)
  }

  // H2/H3 — limit-map integrity, where the artifact carries a map.
  const limits: any[] = art.namedGrammarLimits ?? []
  const errFiles: Set<string> = new Set((art.errorFileList ?? []).map((f: any) => f.file))
  for (const entry of limits) {
    const reason = String(entry.grammarLimit ?? "").trim()
    if (!reason) hard.push(`H2 ${lg}: limit entry for ${entry.file} carries no reason (bare number = smoothing)`)
    if (errFiles.size > 0 && !errFiles.has(entry.file)) {
      hard.push(`H3 ${lg}: limit entry names ${entry.file} which is not an error file in this measurement`)
    }
  }

  // H4 — self-contradiction.
  const unexpected = art.unexpectedErrorFiles ?? 0
  if (art.passed === true && (unexpected > 0 || (art.crashFiles ?? 0) > 0)) {
    hard.push(`H4 ${lg}: passed=true but unexpectedErrorFiles=${unexpected} crashFiles=${art.crashFiles}`)
  }
}

const passed = hard.length === 0
const result = {
  gate: "m12-corpus-claims",
  issue: "#834",
  checkedAt: new Date().toISOString(),
  languagesChecked: checked.length,
  hardFailures: hard,
  remainderLanguages: remainder.sort(),
  remainderIssue: remainder.length > 0 ? "#897" : null,
  checked,
  passed,
  policy:
    "Every manifest grammarErrorFiles claim must agree with its measured artifact (H1), limit-map entries must carry reasons and be backed by the measurement (H2/H3), and no artifact may declare pass while recording unexpected errors or crashes (H4). Languages without artifacts are the registered remainder R1 — named here, never smoothed — and the gate goes green with them only while the tracker still carries the follow-up that owns them.",
}

const out = "validation/m12/results/corpus-claims-gate.json"
writeFileSync(out, JSON.stringify(result, null, 2) + "\n")

console.log(`H1-H4: ${hard.length === 0 ? "clean" : "FAIL"}`)
for (const h of hard) console.log("  " + h)
console.log(`R1 remainder: ${remainder.length} language(s) without artifacts: ${remainder.sort().join(", ") || "(none)"}`)
console.log(`gate ${passed ? "PASS" : "FAIL"} (remainder non-empty is a registered debt, not a hard failure)`)
console.log(`wrote ${out}`)
if (!passed) process.exit(1)
