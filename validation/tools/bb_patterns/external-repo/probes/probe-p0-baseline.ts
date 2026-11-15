// bb_tests/bb_patterns/probes/probe-p0-baseline.mjs
// P0 — establish what bb_patterns ACTUALLY returns on a real index, before any
// judgement about it. Every later probe is a diff against these numbers.
//
// Nothing here is an assertion yet. This file exists so the review starts from
// measurement rather than from reading code, and so the "it was already fine"
// reply has a number to point at.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const { getProjectId } = await import(path.join(REPO, "src/cli/index.ts"))
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))
const { PatternBrainTools } = await import(path.join(REPO, "src/ast/tools.ts"))
const { createToolHandlers } = await import(path.join(REPO, "src/mcp/tool-handlers.ts"))

const projectId = process.argv[2] ?? getProjectId(REPO)
console.log(`projectId=${projectId} root=${REPO}\n`)

const section = (t) => console.log(`\n======== ${t} ========`)

// ---------------------------------------------------------------- engine
section("detectOrphans — defaults as the MCP handler calls them")
{
  const t0 = process.hrtime.bigint()
  const report = await detectOrphans(projectId, { minConfidence: 0.6, maxResults: 100 })
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`ms=${ms.toFixed(0)}`)
  console.log("summary:", JSON.stringify(report.summary, null, 1))
  console.log("byRule on page:", JSON.stringify(report.summary.byRule))
  const types = {}
  const exts = {}
  for (const f of report.findings) {
    types[f.rule] = (types[f.rule] ?? 0) + 1
    const e = path.extname(f.location.file) || "(none)"
    exts[e] = (exts[e] ?? 0) + 1
  }
  console.log("page rule mix:", JSON.stringify(types))
  console.log("page extension mix:", JSON.stringify(exts))
  console.log("page top-level dirs:", JSON.stringify(tally(report.findings.map((f) => f.location.file.split("/")[0]))))
  console.log("page under src/:", report.findings.filter((f) => f.location.file.startsWith("src/")).length)
  console.log("first 8 page rows:")
  for (const f of report.findings.slice(0, 8)) console.log(`   ${f.rule} ${f.location.symbol ?? ""} ${f.location.file}:${f.location.line} ${f.confidence}`)
}

section("detectOrphans — the census, WITHOUT materializing 28k finding objects")
{
  // minConfidence 0 + a big maxResults is the M50.A2 hot path and is exactly
  // what made this probe exceed 15 minutes: maxResults IS the page size, so a
  // huge value rebuilds every evidence/limitations array for nobody.
  // summary.candidatesTotal is the census and is computed from sort keys only.
  const report = await detectOrphans(projectId, { minConfidence: 0, maxResults: 100 })
  console.log("census:", JSON.stringify(report.summary.candidatesByRule), "total=", report.summary.candidatesTotal)
  console.log("scannedSymbols:", report.summary.scannedSymbols, "scannedFiles:", report.summary.scannedFiles)
  const files = report.findings.filter((f) => f.rule === "orphaned_file")
  console.log(`orphaned_file findings on the 100-row page at minConfidence 0: ${files.length}`)
}

section("orphaned_file only — is the rule reachable at all?")
{
  const report = await detectOrphans(projectId, { rules: ["orphaned_file"], minConfidence: 0, maxResults: 25 })
  console.log("candidatesTotal:", report.summary.candidatesTotal)
  for (const f of report.findings.slice(0, 15)) {
    console.log(`   ${f.rule} ${f.location.file} line=${f.location.line} loc=${f.linesOfCode} conf=${f.confidence}`)
  }
  console.log(`  ...${Math.max(0, report.findings.length - 15)} more`)
}

section("detectPatterns scope=all — what the default call produces")
{
  const t0 = process.hrtime.bigint()
  const result = await PatternBrainTools.detectPatterns(projectId, { confidenceThreshold: 0.6, maxResults: 100 })
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`ms=${ms.toFixed(0)}`)
  console.log("statistics:", JSON.stringify(result.statistics, null, 1))
  console.log("scan:", JSON.stringify(result.scan))
  console.log("page rule mix:", JSON.stringify(tally(result.patterns.map((p) => p.type))))
  console.log("page top-level dirs:", JSON.stringify(tally(result.patterns.map((p) => p.location.file.split("/")[0]))))
}

section("rules.ts alone, unbounded — the anti-pattern census the page cannot show")
{
  const { detectIndexRules } = await import(path.join(REPO, "src/intelligence/patterns/rules.ts"))
  for (const threshold of [0.0, 0.6, 0.9]) {
    const findings = await detectIndexRules(projectId, { confidenceThreshold: threshold, maxResults: 100, includeFramework: true, includeAntiPatterns: true })
    console.log(`threshold=${threshold} -> ${findings.length} findings ${JSON.stringify(tally(findings.map((f) => f.type)))}`)
  }
}

// ---------------------------------------------------------------- handler
section("MCP handler bb_patterns — the text an agent actually reads")
{
  const handlers = createToolHandlers()
  for (const args of [{}, { scope: "orphaned" }, { scope: "all" }, { scope: "orphaned", limit: 5 }, { scope: "orphaned", confidenceThreshold: 0.5 }]) {
    const res = await handlers.bb_patterns(args, { projectId, projectPath: REPO })
    const text = res.content?.[0]?.text ?? ""
    const lines = text.split("\n")
    console.log(`\n--- args=${JSON.stringify(args)} isError=${!!res.isError}`)
    console.log("  header:", JSON.stringify(lines[0]))
    const findingLines = lines.filter((l) => /^\s{2}\[/.test(l))
    console.log(`  finding lines printed: ${findingLines.length}`)
    console.log("  sample:", JSON.stringify(findingLines.slice(0, 3)))
  }
}

function tally(xs) {
  const out = {}
  for (const x of xs) out[x] = (out[x] ?? 0) + 1
  return out
}
