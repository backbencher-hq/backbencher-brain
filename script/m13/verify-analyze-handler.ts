// script/m13/verify-analyze-handler.ts — M13.52 (An2).
import { readFileSync } from "node:fs"
import path from "node:path"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.52", code: "An2", tool: "bb_analyze",
  title: "bb_analyze: handler <-> engine parity for all 11 modes",
  layers: ["unit"],
  decisions: { handlerParity: "every registered mode has a handler dispatch path" },
  limitations: ["Static dispatch verification; dynamic coverage in An3."],
})

const handlerSrc = readFileSync(path.join(path.resolve("."), "src", "mcp", "tool-handlers.ts"), "utf8")
const anSection = handlerSrc.slice(handlerSrc.indexOf("bb_analyze:"), handlerSrc.indexOf("bb_visualize:"))

const MODES = ["callers","callees","trace","dependencies","stats","complexity","impact","test_mapping","test_gaps","test_impact","test_quality"]
for (const mode of MODES) {
  harness.check("handler: mode "+mode+" has dispatch path", anSection.includes('"'+mode+'"'), "ok")
}

harness.check("handler: imports analysis engine functions", handlerSrc.includes("analyzeComplexity") || handlerSrc.includes("analyzeImpact") || handlerSrc.includes("getProjectStats"), "engine imports found")
harness.negative("handler: has mode validation logic", anSection.includes('mode') && (anSection.includes('valid') || anSection.includes('switch') || anSection.includes('case')), "has dispatch logic")

// All modes reachable from registry
const registry = (await import("../../src/mcp/tool-registry")).PUBLIC_TOOL_DESCRIPTORS
const analyze = registry.find((t: any) => t.name === "bb_analyze")
harness.check("registry: all 11 modes registered", (analyze?.modes?.length || 0) >= 11, String(analyze?.modes?.length))

harness.emit()
