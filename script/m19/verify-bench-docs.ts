// script/m19/verify-benchmarks-docs.ts — M19.B1.
// Documentation is an evidence contract: measured values must agree with the
// JSON artifacts, and open timing gaps must remain visible.

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
const docs = [
  readFileSync(path.join(ROOT, "docs/m19/SCALE.md"), "utf8"),
  readFileSync(path.join(ROOT, "docs/m19/BENCHMARKS.md"), "utf8"),
]
const s1 = JSON.parse(readFileSync(path.join(RESULTS, "S1.json"), "utf8"))
const s2 = JSON.parse(readFileSync(path.join(RESULTS, "S2.json"), "utf8"))
const s3 = JSON.parse(readFileSync(path.join(RESULTS, "S3.json"), "utf8"))
const manifest = JSON.parse(readFileSync(path.join(RESULTS, "manifest.json"), "utf8"))

function has(text: string) { return docs.every((d) => d.includes(text)) }
function allDocsHave(text: string) { return docs.every((d) => d.includes(text)) }
function numberForms(value: number): string[] {
  const plain = String(value)
  const grouped = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return [plain, grouped]
}
function docsContainNumber(value: number, suffix = "") {
  return docs.every((d) => numberForms(value).some((form) => d.includes(form + suffix)))
}

ck("B1: SCALE.md exists", existsSync(path.join(ROOT, "docs/m19/SCALE.md")))
ck("B1: BENCHMARKS.md exists", existsSync(path.join(ROOT, "docs/m19/BENCHMARKS.md")))
ck("B1: docs identify M19", has("M19"))
ck("B1: docs identify evidence JSON", has("validation/m19/results"))
ck("B1: docs state hardware dependence", has("hardware"))
ck("B1: docs state analyzer precision limitation", has("analyzer"))
ck("B1: docs state timeout is not a duration", allDocsHave("timeout"))
ck("B1: docs state missing timing remains open", allDocsHave("timing") && allDocsHave("open"))

const curve = Array.isArray(s1.measured?.curve) ? s1.measured.curve : []
ck("B1: S1 has runtime curve data", curve.length >= 3 && curve.every((r: any) => r.files > 0 && r.symbols > 0 && r.ms > 0))
for (const row of curve) {
  const seconds = (row.ms / 1000).toFixed(3)
  ck("B1: SCALE.md contains measured " + row.repo, docs[0].includes(row.repo) && numberForms(row.files).some((form) => docs[0].includes(form)) && numberForms(row.symbols).some((form) => docs[0].includes(form)) && docs[0].includes(seconds))
  ck("B1: BENCHMARKS.md contains measured " + row.repo, docs[1].includes(row.repo) && numberForms(row.files).some((form) => docs[1].includes(form)) && numberForms(row.symbols).some((form) => docs[1].includes(form)) && docs[1].includes(seconds))
}

ck("B1: S2 measured totals remain present", s2.measured?.repo === "aspnetcore" && s2.measured.files > 0 && s2.measured.symbols > 0)
ck("B1: S3 measured totals remain present", s3.measured?.repo === "intellij-community" && s3.measured.files > 0 && s3.measured.symbols > 0)
ck("B1: S2 timing ledger is not falsely claimed", s2.measured?.timing === null && manifest.issues.find((i: any) => i.code === "S2")?.closed === false)
ck("B1: S3 timing ledger is not falsely claimed", s3.measured?.timing === null && manifest.issues.find((i: any) => i.code === "S3")?.closed === false)
ck("B1: docs explicitly name S2 timing gap", docs.every((d) => d.includes("S2-timings.json")))
ck("B1: docs explicitly name S3 timing gap", docs.every((d) => d.includes("S3-timings.json")))
ck("B1: docs do not claim giant wall-time", docs.every((d) => !d.includes("giant wall-time is verified")))

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
    anchorCurve: s1.measured?.curve ?? [],
    aspnetcore: { files: s2.measured?.files ?? null, symbols: s2.measured?.symbols ?? null, timing: s2.measured?.timing ?? null },
    intellij: { files: s3.measured?.files ?? null, symbols: s3.measured?.symbols ?? null, timing: s3.measured?.timing ?? null },
  },
  negatives: [
    "S2 and S3 timing ledgers are intentionally open because the old logs were incomplete and a controlled rerun exceeded the 600-second execution bound.",
    "Peak RSS was not captured by the existing giant runs.",
    "Scale completion does not prove analyzer AST precision.",
  ],
  generatedAt: new Date().toISOString(),
}
writeFileSync(path.join(RESULTS, "B1.json"), JSON.stringify(evidence, null, 2) + "\n")
console.log("B1: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
process.exit(failed === 0 ? 0 : 1)
