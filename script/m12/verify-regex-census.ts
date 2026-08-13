// M12 regex census regression gate.
//
// Machine-checks the committed census (validation/m12/results/regex-census.json)
// against the actual analyzer source:
//   1. Re-runs the AST-driven scan and verifies every regex usage in source is
//      present in the census (no hidden/new regex without a census entry).
//   2. Verifies every census entry is classified and located (no unclassified
//      entries, no missing line/file).
//   3. In --strict mode, fails on any entry classified `needs_review` or
//      `replaceable` without a justification — the state every per-analyzer
//      issue must converge to before closing.
//
// Run: bun script/m12/verify-regex-census.ts [--strict]
import { readFileSync } from "node:fs"
import { join, basename } from "node:path"

const CENSUS = "validation/m12/results/regex-census.json"
const ANALYZER_DIR = "src/ast"
const strict = process.argv.includes("--strict")

interface CensusEntry {
  file: string
  line: number
  column: number
  source: string
  operation: string
  receiver: string
  receiverCategory: string
  classification: string
  justification: string
}

async function main() {
  const census = JSON.parse(readFileSync(CENSUS, "utf8")) as {
    totalRegexUsages: number
    perFile: { file: string; count: number; usages: CensusEntry[] }[]
  }
  const entries = census.perFile.flatMap((f) => f.usages)

  // 1. Re-scan source with the same AST-driven method.
  const { scanAnalyzers } = await import("./regex-census-core")
  const fresh = await scanAnalyzers()

  // Index census entries by file:line (regex source as tiebreak).
  const censusKeys = new Set(entries.map((e) => `${e.file}:${e.line}:${e.source}`))
  const sourceKeys = new Set(fresh.map((e: any) => `${e.file}:${e.line}:${e.source}`))

  const missingFromCensus = [...sourceKeys].filter((k) => !censusKeys.has(k))
  const staleInCensus = [...censusKeys].filter((k) => !sourceKeys.has(k))
  const unclassified = entries.filter((e) => !e.classification || e.classification === "" || e.classification === "unclassified")
  const mislocated = entries.filter((e) => !e.file || !e.line)
  const unjustified = strict
    ? entries.filter((e) => (e.classification === "replaceable" || e.classification === "needs_review") && !e.justification?.trim())
    : []

  const ok =
    missingFromCensus.length === 0 &&
    staleInCensus.length === 0 &&
    unclassified.length === 0 &&
    mislocated.length === 0 &&
    unjustified.length === 0

  console.log(`census entries: ${entries.length} | fresh scan: ${fresh.length}`)
  console.log(`missing from census: ${missingFromCensus.length}`)
  console.log(`stale in census: ${staleInCensus.length}`)
  console.log(`unclassified: ${unclassified.length}`)
  console.log(`mislocated: ${mislocated.length}`)
  if (strict) console.log(`unjustified (strict): ${unjustified.length}`)

  for (const k of missingFromCensus.slice(0, 15)) console.log(`MISSING ${k}`)
  for (const k of staleInCensus.slice(0, 15)) console.log(`STALE ${k}`)
  for (const e of unclassified.slice(0, 15)) console.log(`UNCLASSIFIED ${e.file}:${e.line} ${e.source.slice(0, 50)}`)
  for (const e of unjustified.slice(0, 15)) console.log(`UNJUSTIFIED ${e.file}:${e.line} [${e.classification}] ${e.source.slice(0, 50)}`)

  if (!ok) {
    console.error(`regex census gate ${strict ? "(strict) " : ""}FAILED`)
    process.exitCode = 1
  } else {
    console.log(`regex census gate ${strict ? "(strict) " : ""}PASSED`)
  }
}

main().catch((e) => {
  console.error("verify-regex-census failed:", e)
  process.exit(1)
})
