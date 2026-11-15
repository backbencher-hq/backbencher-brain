// Phase A history-payload probe: measures what `{history:true}` returns after a
// recorded run — the run page and the FINDINGS array, which is loaded whole
// regardless of `limit`. The point is payload size and whether the answer declares
// any bound.
//
// Usage: BB_DATA_DIR=<scratch> npx tsx history-payload.mts <projectDir> <out.json>

import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"

const dir = process.argv[2]
const outPath = process.argv[3]
if (!dir || !outPath) { console.error("usage: history-payload.mts <projectDir> <out.json>"); process.exit(2) }
const projectId = getProjectId(dir)
const handler = createToolHandlers().bb_patterns

const cases: any[] = []
for (const args of [{ history: true, limit: 2 }, { history: true, limit: 100 }]) {
  const t0 = performance.now()
  const res: any = await handler(args as any, { projectId, projectPath: dir } as any)
  const ms = Math.round((performance.now() - t0) * 100) / 100
  const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {}
  cases.push({
    args,
    ms,
    chars: text.length,
    isError: res?.isError === true,
    runs: parsed?.runs?.length ?? null,
    runFindingCounts: parsed?.runs?.map((r: any) => r.findingCount) ?? null,
    findingsReturned: parsed?.findings?.length ?? null,
    hasTruncationDeclaration: /truncat|limit|totalCount/i.test(text.slice(0, 400)) && !text.trim().startsWith("{"),
    jsonKeys: parsed ? Object.keys(parsed) : null,
  })
}
const report = { projectId, projectDir: dir, cases, generatedAt: new Date().toISOString() }
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
