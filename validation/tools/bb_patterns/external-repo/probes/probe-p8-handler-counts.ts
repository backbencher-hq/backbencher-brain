// bb_tests/bb_patterns/probes/probe-p8-handler-counts.ts
// P8 — the numbers a user is shown, through the real handler.
//
// F8: tools.ts:182 sets statistics.totalFound = displayedPatterns.length while
//     byType / averageConfidence describe the unbounded census, and
//     tool-handlers.ts:692 prints totalFound as "patterns (N)". With the
//     default limit:20 the handler fetches 100, prints 20, and reports the 100.
// F9: tool-handlers.ts:665 `allPatterns` is `min(census, max(limit,100))` after
//     M57.T3 bounded the page inside detectPatterns, so recordRun persists a
//     page. The comment at :675-678 and docs/BB_PATTERNS.md:92-97 both promise
//     the full analysed set.
// F2: at the default confidenceThreshold 0.6 the orphan-file rule contributes
//     zero candidates, so a rule the docs describe cannot appear at all.
//
// Every number here is printed by the tool, not recomputed, so the point is
// what the CALLER sees.

import path from "node:path"

const REPO = process.env.BB_REPO
const { getProjectId } = await import(path.join(REPO, "src/cli/index.ts"))
const { createToolHandlers } = await import(path.join(REPO, "src/mcp/tool-handlers.ts"))

const projectId = process.argv[2] ?? getProjectId(REPO)
const handlers = createToolHandlers()

const cases: Array<[string, Record<string, unknown>]> = [
  // removed: the default scope=all path costs 330s on this index (see F12), which is
  // itself the finding; probing it eight times is not worth 45 minutes.
  ["default limit=5 {limit:5}", { limit: 5 }],
  ["orphaned {scope:'orphaned'}", { scope: "orphaned" }],

  ["orphaned thr=0.5 {scope:'orphaned',confidenceThreshold:0.5}", { scope: "orphaned", confidenceThreshold: 0.5 }],
  ["orphaned includeTests {scope:'orphaned',includeTests:true}", { scope: "orphaned", includeTests: true }],


]

for (const [label, args] of cases) {
  const t0 = process.hrtime.bigint()
  const res: any = await handlers.bb_patterns(args, { projectId, projectPath: REPO })
  const ms = (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)
  const text: string = res.content?.[0]?.text ?? ""
  const lines = text.split("\n")
  // Two different output shapes, one per scope. Matching only the first made
  // scope=orphaned look like it printed nothing at all, which is a defect in
  // this probe, not in the tool:
  //   scope=all      "  [info] orphaned_class @ file:line (60%)"
  //   scope=orphaned "  orphaned_class name - file:line (60%)"
  const printed = lines.filter((l) => /^ {2}(\[\w+\] )?[a-z]/.test(l))
  console.log(`\n${label}   (${ms}ms, isError=${!!res.isError})`)
  console.log(`   header: ${JSON.stringify(lines[0])}`)
  console.log(`   finding lines printed: ${printed.length}`)
  const kinds = printed.map((l) => (l.match(/\[(\w+)\] (\S+)/) ?? [])[2]).filter(Boolean)
  const byKind: Record<string, number> = {}
  for (const k of kinds) byKind[k] = (byKind[k] ?? 0) + 1
  console.log(`   printed kinds: ${JSON.stringify(byKind)}`)
  if (/truncated/i.test(text)) console.log(`   says "truncated": yes`)
  if (printed.length) console.log(`   first: ${JSON.stringify(printed[0])}`)
}
