// One explicit detail:"deep" feature call on T2 — the opt-in semantic path whose
// cost is declared in the descriptor and docs (not a default call).
import path from "node:path"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const pid = getProjectId(REPO)
const h = createToolHandlers().bb_doc
await h({ mode: "api" }, { projectPath: REPO, projectId: pid } as any).catch(() => {})
const t = performance.now()
const r: any = await h({ mode: "feature", target: "documentation generation", detail: "deep", format: "json" }, { projectPath: REPO, projectId: pid } as any)
const ms = Math.round(performance.now() - t)
const j = JSON.parse(r.content[0].text)
console.log(JSON.stringify({ ms, bytes: r.content[0].text.length, isError: r.isError, budget: j.quality.budget, unknowns: j.unknowns.length, ok: true }))
