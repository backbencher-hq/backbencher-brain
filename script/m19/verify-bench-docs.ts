// script/m19/verify-bench-docs.ts — M19.B1.
// Documentation is an evidence contract: measured values must agree with the
// JSON artifacts, and partial results must retain their limitations.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"

let checks = 0
let passed = 0
let failed = 0
function ck(label: string, condition: boolean, detail?: string) {
  checks++
  if (condition) passed++
  else { failed++; console.log("  FAIL: " + label + (detail ? " - " + detail : "")) }
}

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m19/results")
const scalePath = path.join(ROOT, "docs/m19/SCALE.md")
const benchmarksPath = path.join(ROOT, "docs/m19/BENCHMARKS.md")
const scale = readFileSync(scalePath, "utf8")
const benchmarks = readFileSync(benchmarksPath, "utf8")
const docs = [scale, benchmarks]
const s1 = JSON.parse(readFileSync(path.join(RESULTS, "S1.json"), "utf8"))
const s2 = JSON.parse(readFileSync(path.join(RESULTS, "S2.json"), "utf8"))
const s3 = JSON.parse(readFileSync(path.join(RESULTS, "S3.json"), "utf8"))
const manifest = JSON.parse(readFileSync(path.join(RESULTS, "manifest.json"), "utf8"))

function allDocsHave(text: string): boolean { return docs.every((doc) => doc.includes(text)) }
function numberForms(value: number): string[] {
  const plain = String(value)
  return [plain, plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",")]
}
function hasNumber(doc: string, value: number): boolean {
  return numberForms(value).some((form) => doc.includes(form))
}
function bothHaveNumber(value: number): boolean {
  return docs.every((doc) => hasNumber(doc, value))
}

ck("B1: SCALE.md exists", existsSync(scalePath))
ck("B1: BENCHMARKS.md exists", existsSync(benchmarksPath))
ck("B1: docs identify M19", allDocsHave("M19"))
ck("B1: docs identify evidence JSON", allDocsHave("validation/m19/results"))
ck("B1: docs state hardware dependence", allDocsHave("hardware"))
ck("B1: docs state analyzer precision limitation", allDocsHave("analyzer"))
ck("B1: docs state timeout is not a duration", allDocsHave("timeout") && allDocsHave("not a measured"))
ck("B1: docs state partial results honestly", allDocsHave("partial") && allDocsHave("not claimed"))

const curve = Array.isArray(s1.measured?.curve) ? s1.measured.curve : []
ck("B1: S1 has runtime curve data", curve.length >= 3 && curve.every((r: any) => r.files > 0 && r.symbols > 0 && r.ms > 0))
for (const row of curve) {
  const seconds = (row.ms / 1000).toFixed(3)
  ck("B1: SCALE.md contains measured " + row.repo,
    scale.includes(row.repo) && hasNumber(scale, row.files) && hasNumber(scale, row.symbols) && scale.includes(seconds))
  ck("B1: BENCHMARKS.md contains measured " + row.repo,
    benchmarks.includes(row.repo) && hasNumber(benchmarks, row.files) && hasNumber(benchmarks, row.symbols) && benchmarks.includes(seconds))
}

const s2Timing = s2.measured?.timing
const s3Controls = s3.measured?.controls
ck("B1: S2 evidence is verified with measured totals", s2.verified === true && s2.failed === 0 && s2.measured?.files > 0 && s2.measured?.symbols > 0)
ck("B1: S2 timing and full-finalization limitations are documented", s2Timing !== null && scale.includes("deferred-finalization") && benchmarks.includes("full-finalization"))
ck("B1: S2 measured totals appear in both docs", bothHaveNumber(s2.measured.files) && bothHaveNumber(s2.measured.symbols))
ck("B1: S3 evidence is verified-partial, not falsely complete", s3.verified === true && s3.measured?.fullColdTimingComplete === false && s3.measured?.timing === null)
ck("B1: S3 controls and measured limitation are documented", !!s3Controls && scale.includes("1,216.877") && benchmarks.includes("1,216.877"))
ck("B1: S3 measured totals appear in both docs", bothHaveNumber(s3.measured.indexedFiles) && bothHaveNumber(s3.measured.symbols))
ck("B1: manifest records S2 and S3 as closed", manifest.issues.find((i: any) => i.code === "S2")?.closed === true && manifest.issues.find((i: any) => i.code === "S3")?.closed === true)
ck("B1: docs preserve S3 full-cold timing limitation", allDocsHave("full cold ten-slice") && allDocsHave("bounded verification window"))
ck("B1: docs do not claim universal giant performance", docs.every((doc) => !doc.includes("universal performance guarantee") || doc.includes("not a universal performance guarantee")))

if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true })
const evidence = {
  issue: "M19.B1",
  code: "B1",
  tool: "scale benchmark documentation",
  title: "benchmark docs truth — SCALE.md and BENCHMARKS.md",
  verified: failed === 0,
  checks,
  passed,
  failed,
  measured: {
    anchorCurve: curve,
    aspnetcore: { files: s2.measured?.files ?? null, symbols: s2.measured?.symbols ?? null, timingSlices: s2Timing?.slices?.length ?? 0 },
    paperclip: { files: s2.measured?.paperclip?.indexedFiles ?? null, symbols: s2.measured?.paperclip?.symbols ?? null, fullFinalization: s2.measured?.fullFinalizationMeasured === true },
    intellij: { files: s3.measured?.indexedFiles ?? null, symbols: s3.measured?.symbols ?? null, fullColdTimingComplete: s3.measured?.fullColdTimingComplete ?? null },
  },
  negatives: [
    "ASP.NET slice timings defer heavy post-processing; the Paperclip control proves full finalization separately.",
    "The intellij full cold ten-slice timing ledger is not claimed because the first fresh batch took 1,216.877 seconds.",
    "Scale completion does not prove analyzer AST precision.",
  ],
  generatedAt: new Date().toISOString(),
}
writeFileSync(path.join(RESULTS, "B1.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log("B1: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
process.exit(failed === 0 ? 0 : 1)
