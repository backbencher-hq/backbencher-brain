// File-mode directory target citing 30 files, all made stale: the inline
// auto-refresh must decline on its 25-file budget and say so.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { TOOL_DESCRIPTORS } from "../../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const root = mkdtempSync(path.join(REPO, "validation/tools/bb_doc/work", "budget-"))
mkdirSync(path.join(root, "many"))
for (let i = 0; i < 30; i++) writeFileSync(path.join(root, "many", `f${i}.ts`), `/** Doc ${i}. */\nexport function fn${i}(x: number): number { return x + ${i} }\n`)
const pid = getProjectId(root)
await indexProjectParallel(pid, root, {})
for (let i = 0; i < 30; i++) writeFileSync(path.join(root, "many", `f${i}.ts`), `/** Doc ${i} edited. */\nexport function fn${i}(x: number): number { return x + ${i} + 1 }\n`)
const descriptor = TOOL_DESCRIPTORS.find((d) => d.name === "bb_doc")!
const handler = createToolHandlers().bb_doc
const ctx = { projectPath: root, projectId: pid } as any
const validated = validateToolArguments(descriptor, { mode: "file", target: "many", format: "json", limit: 100 }) as Record<string, unknown>
const r: any = await handler(validated, ctx)
const j = JSON.parse(r.content[0].text)
console.log(JSON.stringify({
  autoRefresh: j.autoRefresh ?? "(absent)",
  staleQuality: j.quality.references.stale,
  emittedCitations: (j.citations ?? []).length,
  emittedStale: (j.citations ?? []).filter((c: any) => c.freshness === "stale").length,
  envelope: j.freshness,
}, null, 2))
rmSync(path.join(path.dirname(BrainDatabase.getDbPath(pid))), { recursive: true, force: true })
rmSync(root, { recursive: true, force: true })
