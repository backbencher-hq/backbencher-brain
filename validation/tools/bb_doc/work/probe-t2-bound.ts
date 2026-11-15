import path from "node:path"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const pid = getProjectId(REPO)
const h = createToolHandlers().bb_doc
const t0 = performance.now()
const r: any = await h({ mode: "project", format: "json", limit: 100, maxTokens: 16000 }, { projectPath: REPO, projectId: pid } as any)
const ms = Math.round(performance.now() - t0)
const j = JSON.parse(r.content[0].text)
const db: any = await BrainDatabase.getRawInstance(pid as any)
const totalSymbols = Number((db.prepare("SELECT count(*) c FROM brain_symbol WHERE project_id=?").get(pid) as any)?.c ?? 0)
const totalFiles = Number((db.prepare("SELECT count(*) c FROM brain_file WHERE project_id=?").get(pid) as any)?.c ?? 0)
const map = j.sections.find((s: any) => s.id === "documentation-map")
const inv = j.sections.find((s: any) => s.id === "inventory")
console.log(JSON.stringify({
  ms, indexSymbols: totalSymbols, indexFiles: totalFiles,
  mapFacts: map.facts.length, inventoryFacts: inv.facts.length,
  bytes: r.content[0].text.length, wireTokens: Math.ceil(r.content[0].text.length / 4),
  estimate: j.quality.budget.estimatedTokens, budgetPassed: j.quality.budget.passed,
  sections: j.sections.map((s: any) => `${s.id}:${s.facts.length}`),
  scopeUnknowns: (j.unknowns ?? []).filter((u: any) => /not examined|not selected|cap is/.test(u.statement)).map((u: any) => u.statement.slice(0, 200)),
}, null, 2))
