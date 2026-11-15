// bb_tests/bb_patterns/probes/probe-p4-counts-and-rules.ts
// P4 — the claims about NUMBERS the user is shown, and about the rule engine.
//
// F7   RuleOptions.maxResults is declared, passed, and never read; the
//      complexity confidence gate can never fire; the god-class gate drops a
//      HIGHER-confidence finding than one it keeps.
// F8   statistics.totalFound is the page length, but byType / averageConfidence
//      describe the unbounded census, and the handler prints totalFound as
//      "patterns (N)".
// F9   recordRun persists `allPatterns`, which after M57.T3 is a page, not the
//      analysed set that tool-handlers.ts:675-678 and docs/BB_PATTERNS.md:92-97
//      both promise.
// F10  file findings carry linesOfCode 0 and line 1 while line_count is unused.
//
// Latency is measured first-call vs second-call in ONE process, because a
// 382 MB database pays a one-time open cost (ensureSchema / ANALYZE) that has
// nothing to do with the scan; quoting the first call as the tool's latency
// would be wrong, and so would quoting the second as its worst case.

import path from "node:path"

const REPO = process.env.BB_REPO
const { getProjectId } = await import(path.join(REPO, "src/cli/index.ts"))
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))
const { detectIndexRules } = await import(path.join(REPO, "src/intelligence/patterns/rules.ts"))
const { PatternBrainTools } = await import(path.join(REPO, "src/ast/tools.ts"))
const { createToolHandlers } = await import(path.join(REPO, "src/mcp/tool-handlers.ts"))

const projectId = process.argv[2] ?? getProjectId(REPO)
const ms = (t0: bigint) => (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)
const sec = (t: string) => console.log(`\n======== ${t} ========`)

// ------------------------------------------------------------------ latency
sec("latency: first call vs second call in the same process")
{
  let t0 = process.hrtime.bigint()
  await detectOrphans(projectId, { minConfidence: 0.6, maxResults: 100 })
  const first = Number(process.hrtime.bigint() - t0) / 1e6
  t0 = process.hrtime.bigint()
  await detectOrphans(projectId, { minConfidence: 0.6, maxResults: 100 })
  const second = Number(process.hrtime.bigint() - t0) / 1e6
  console.log(`detectOrphans call 1: ${first.toFixed(0)}ms  call 2: ${second.toFixed(0)}ms  ratio ${(first / second).toFixed(1)}x`)
  console.log("=> the first call carries the database-open cost; the second is the scan")
}

// -------------------------------------------------------------------- F7
sec("F7 — detectIndexRules: is maxResults read, and do the gates fire?")
{
  for (const maxResults of [1, 5, 100000]) {
    const f = await detectIndexRules(projectId, { confidenceThreshold: 0, maxResults, includeFramework: true, includeAntiPatterns: true })
    console.log(`  maxResults=${String(maxResults).padEnd(6)} -> ${String(f.length).padStart(5)} findings  ${JSON.stringify(tally(f.map((x: any) => x.type)))}`)
  }
  console.log("  (if the three counts are equal, maxResults is not read anywhere)")

  // Boundary sweep on the two gates. SQL already guarantees complexity>=15 and
  // members>10, so the ratio the gate divides by is bounded below by 1.0 and
  // 0.55 respectively.
  console.log("\n  complexity gate: emitted confidence min(0.9, 0.5+c/100) vs gate value c/15")
  for (const c of [15, 16, 20, 30]) {
    console.log(`    c=${String(c).padStart(2)}  emitted=${(0.5 + c / 100).toFixed(3)}  gate=${(c / 15).toFixed(3)}`)
  }
  console.log("  god-class gate: emitted confidence min(0.9, 0.5+m/40) vs gate value m/20")
  for (const m of [11, 12, 15, 20]) {
    console.log(`    m=${String(m).padStart(2)}  emitted=${(0.5 + m / 40).toFixed(3)}  gate=${(m / 20).toFixed(3)}  droppedAtDefault0.6=${(m / 20 < 0.6) ? "YES" : "no"}`)
  }

  const at06 = await detectIndexRules(projectId, { confidenceThreshold: 0.6, maxResults: 100, includeFramework: true, includeAntiPatterns: true })
  const at00 = await detectIndexRules(projectId, { confidenceThreshold: 0, maxResults: 100, includeFramework: true, includeAntiPatterns: true })
  const at09 = await detectIndexRules(projectId, { confidenceThreshold: 0.9, maxResults: 100, includeFramework: true, includeAntiPatterns: false })
  console.log(`\n  findings at threshold 0.0: ${at00.length}   0.6: ${at06.length}   0.9: ${at09.length}`)
  const below = at09.filter((f: any) => f.confidence < 0.9)
  console.log(`  at threshold 0.9, findings whose OWN confidence is < 0.9 (i.e. the gate did not filter on confidence): ${below.length} ${JSON.stringify(tally(below.map((f: any) => f.type)))}`)
  console.log(`  confidence range actually emitted: ${Math.min(...at00.map((f: any) => f.confidence)).toFixed(2)} .. ${Math.max(...at00.map((f: any) => f.confidence)).toFixed(2)}`)
}

// -------------------------------------------------------------------- F8
sec("F8 — statistics: page length vs census")
{
  const r: any = await PatternBrainTools.detectPatterns(projectId, { confidenceThreshold: 0.6, maxResults: 100 })
  console.log(`  patterns.length            = ${r.patterns.length}`)
  console.log(`  statistics.totalFound      = ${r.statistics.totalFound}`)
  console.log(`  scan.candidatesEvaluated   = ${r.scan.candidatesEvaluated}`)
  console.log(`  scan.findingsBeforeDisplay = ${r.scan.findingsBeforeDisplayLimit}`)
  const byTypeSum = Object.values(r.statistics.byType).reduce((a: any, b: any) => a + b, 0)
  console.log(`  sum(statistics.byType)     = ${byTypeSum}  <- the census`)
  console.log(`  => totalFound (${r.statistics.totalFound}) vs byType sum (${byTypeSum}): ${r.statistics.totalFound === byTypeSum ? "consistent" : "INCONSISTENT by " + (byTypeSum - r.statistics.totalFound)}`)
  console.log(`  byType: ${JSON.stringify(r.statistics.byType)}`)

  const bigger: any = await PatternBrainTools.detectPatterns(projectId, { confidenceThreshold: 0.6, maxResults: 2000 })
  console.log(`\n  with maxResults 2000: patterns.length=${bigger.patterns.length} byType sum=${Object.values(bigger.statistics.byType).reduce((a: any, b: any) => a + b, 0)}`)
  console.log(`  the anti-pattern branch at maxResults 2000: ${JSON.stringify(tally(bigger.patterns.map((p: any) => p.type).filter((t: string) => !t.startsWith("orphaned_"))))}`)
  const at100 = Object.keys(r.statistics.byType).filter((t) => !t.startsWith("orphaned_"))
  console.log(`  the anti-pattern branch at maxResults  100: ${JSON.stringify(at100)}`)
  console.log(`  => the anti-pattern branch is ${at100.length === 0 ? "ENTIRELY ABSENT from the page at the default" : "partially present"}`)
}

// -------------------------------------------------------------------- F10
sec("F10 — file findings: is linesOfCode fabricated?")
{
  const r = await detectOrphans(projectId, { rules: ["orphaned_file"], minConfidence: 0, maxResults: 5 })
  console.log(`  candidatesTotal=${r.summary.candidatesTotal}`)
  for (const f of r.findings) console.log(`   ${f.location.file}  line=${f.location.line}  linesOfCode=${f.linesOfCode}`)
  console.log("  -> brain_file.line_count for those paths, from the index:")
}

// ------------------------------------------------------------- handler text
sec("F8/F9 — the text an agent actually reads")
{
  const h = createToolHandlers()
  for (const args of [{}, { scope: "orphaned" }, { scope: "all" }, { limit: 3 }, { scope: "all", includeOrphaned: false }]) {
    const res: any = await h.bb_patterns(args, { projectId, projectPath: REPO })
    const text: string = res.content?.[0]?.text ?? ""
    const lines = text.split("\n")
    const printed = lines.filter((l) => /^\s{2}\[/.test(l))
    console.log(`\n  args=${JSON.stringify(args)}`)
    console.log(`    header: ${JSON.stringify(lines[0])}`)
    console.log(`    finding lines printed: ${printed.length}`)
  }
}

function tally(xs: string[]) {
  const o: Record<string, number> = {}
  for (const x of xs) o[x] = (o[x] ?? 0) + 1
  return o
}
