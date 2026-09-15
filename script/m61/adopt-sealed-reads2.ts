// script/m61/adopt-sealed-reads2.ts — M61.V1 adoption helper, pass 3.
//
// The first read-adoption pass (script/m61/adopt-sealed-reads.ts) covered the
// parse sites its pattern recognised. A subsequent audit (the V1 acceptance
// item "all IDE-lane gates verify seals before trusting records") found
// remaining `JSON.parse(readFileSync(<expr>, "utf8"))` sites at genuine
// evidence-record reads. This pass converts exactly those — single-line
// patterns only — and skips declared non-evidence reads:
//
//   * package.json / extension manifests  (config, never a record)
//   * consent stores                      (declared out of D-1 scope)
//   * transient test-harness results.json (vscode-test output, not a record)
//   * wire payload bodies                 (no file read)
//
// Dry-run by default; pass --write to apply.

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "../..")
const WRITE = process.argv.includes("--write")

// Declared scope: the lane's gates that read evidence records per the audit.
const FILES = [
  "script/m24/verify-closure.ts",
  "script/m25/verify-closure.ts",
  "script/m25/verify-cross-platform.ts",
  "script/m25/verify-listing.ts",
  "script/m25/verify-governance.ts",
  "script/m26/verify-closure.ts",
  "script/m26/verify-graph-docs.ts",
  "script/m27/verify-closure.ts",
  "script/m28/verify-closure.ts",
  "script/m28/verify-mcp-surface.ts",
]

// Never convert a read whose path names one of these (declared non-records).
const EXCLUDE_SUBSTRINGS = ["package.json", "consent", "results.json", "tsconfig"]

const PATTERN = /JSON\.parse\(readFileSync\(([^;]+?), "utf8"\)\)/g

let total = 0
const report: string[] = []
for (const rel of FILES) {
  const abs = path.join(ROOT, rel)
  const src = readFileSync(abs, "utf8")
  let converted = 0
  let skipped = 0
  const out = src.replace(PATTERN, (match, expr: string) => {
    if (EXCLUDE_SUBSTRINGS.some((s) => expr.includes(s))) {
      skipped++
      return match
    }
    converted++
    return `parseSealedRecord(${expr.trim()})`
  })
  let next = out
  if (converted > 0 && !src.includes("parseSealedRecord,")) {
    // ensure the import exists (add to the existing evidence import when present)
    if (/from "\.\.\/lib\/evidence\.ts"/.test(next)) {
      next = next.replace(/import \{ writeSealed \} from "\.\.\/lib\/evidence\.ts"/, 'import { writeSealed, parseSealedRecord } from "../lib/evidence.ts"')
      next = next.replace(/import \{ parseSealedRecord \} from "\.\.\/lib\/evidence\.ts"/, 'import { parseSealedRecord } from "../lib/evidence.ts"')
    }
  }
  if (converted > 0) {
    total += converted
    if (WRITE) writeFileSync(abs, next)
  }
  report.push(`${rel}: converted=${converted} skipped=${skipped}${WRITE ? "" : " (dry)"}`)
}

console.log(report.join("\n"))
console.log(`\ntotal converted: ${total}${WRITE ? "" : " (dry run — pass --write)"}`)
