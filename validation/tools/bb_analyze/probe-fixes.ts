import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../src/mcp/tool-handlers"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const DIR = path.join(ROOT, "validation/tools/bb_analyze/work/behaviour")
const d = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_analyze")!
const h = createToolHandlers()["bb_analyze"]
const call = async (a: any) => { const r = await h(validateToolArguments(d, a), { projectPath: DIR, projectId: getProjectId(DIR) }); return JSON.parse(r.content.map((c: any) => c.text).join("\n")) }
const cx: any = await call({ mode: "complexity", target: "src" })
console.log("complexity:", JSON.stringify({ symbolCount: cx.symbolCount, breakdownLength: cx.breakdown.length, breakdownReturned: cx.breakdownReturned, breakdownTruncated: cx.breakdownTruncated }))
const ti: any = await call({ mode: "test_impact", target: "hub" })
console.log("test_impact.summary:", JSON.stringify(ti.summary))
console.log("test_impact.truncationReason:", JSON.stringify(ti.truncationReason))
