import path from "node:path"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const root = path.join(REPO, "test/fixtures/polyglot")
const pid = getProjectId(root)
const h = createToolHandlers().bb_doc
const ctx = { projectPath: root, projectId: pid } as any
const sym = await h({ mode: "symbol", target: "total" } as any, ctx) as any
const proj = await h({ mode: "project", format: "json", limit: 5, maxTokens: 16000 } as any, ctx) as any
const stale = await h({ mode: "file", target: "ts-js/src/checkout.ts", refresh: false } as any, ctx) as any
console.log("===SYMBOL-MD===\n" + sym.content[0].text.replace(root, "<project>"))
console.log("===PROJECT-JSON===\n" + proj.content[0].text)
console.log("===STALE-MD-TAIL===\n" + String(stale.content[0].text).split("\n").slice(-6).join("\n"))
