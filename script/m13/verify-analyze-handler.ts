// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the contract-parity gate for bb_analyze: the descriptor,
//   the validation layer and the handler must agree about modes, parameters,
//   defaults, mutability and aliases.
// WHICH TOOL IT SERVES — bb_analyze (read, requiresIndex, 11 modes).
// WHY IT IS SHAPED THIS WAY — the previous version asserted that a SUBSTRING of
//   src/mcp/tool-handlers.ts contained each mode name. When the per-tool split
//   moved the handler to src/mcp/tools/bb_analyze/handler.ts it went red for the
//   file move, not for a contract change (the substring was in a file that no
//   longer held the handler). This version reads the executable contract
//   (descriptor + validation table) and asks the HANDLER REGISTRY whether the
//   tool is answerable, which is the property the tool actually promises.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/an2.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/{descriptor,
//   handler}.ts, src/mcp/tool-validation.ts, src/mcp/tool-registry.ts.
// CONTRACTS IT MUST NOT BREAK — a green run must mean: descriptor schema,
//   validation behaviour and handler dispatch describe one contract.
// ─────────────────────────────────────────────────────────────────────────────

import { Harness } from "./harness"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments, PARAMETER_ALIASES } from "../../src/mcp/tool-validation"

const harness = new Harness({
  issue: "M13.52",
  code: "An2",
  tool: "bb_analyze",
  title: "bb_analyze: descriptor, validation layer and handler describe one contract",
  layers: ["unit"],
  decisions: { parity: "assert the executable contract, not a source substring" },
  limitations: ["Dispatch behaviour is exercised by An1 (verify-analyze-modes); this gate is the contract layer."],
})

const MODES = ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"]
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_analyze")

harness.check("bb_analyze is registered as a public tool", !!descriptor, descriptor ? "found" : "missing")
if (descriptor) {
  harness.check("mutability is read", descriptor.mutability === "read", descriptor.mutability)
  harness.check("requiresIndex is true", descriptor.requiresIndex === true, String(descriptor.requiresIndex))
  harness.check("modes are exactly the 11 the handler implements", descriptor.modes.length === 11 && MODES.every((mode) => descriptor.modes.includes(mode)), descriptor.modes.join(","))
  harness.check("freshnessModes cover every mode", (descriptor.freshnessModes ?? []).length === 11 && MODES.every((mode) => (descriptor.freshnessModes ?? []).includes(mode)), (descriptor.freshnessModes ?? []).join(","))
  const schema = descriptor.inputSchema
  harness.check("required is exactly [mode]", JSON.stringify(schema.required) === JSON.stringify(["mode"]), JSON.stringify(schema.required))
  const props = Object.keys(schema.properties ?? {}).sort()
  harness.check("parameters are exactly filePath, limit, mode, target", JSON.stringify(props) === JSON.stringify(["filePath", "limit", "mode", "target"]), props.join(","))
  const modeEnum = (schema.properties?.mode as any)?.enum ?? []
  harness.check("mode enum equals the registered modes", modeEnum.length === 11 && MODES.every((mode) => modeEnum.includes(mode)), modeEnum.join(","))
  harness.check("limit is declared as a number", (schema.properties?.limit as any)?.type === "number", String((schema.properties?.limit as any)?.type))
  const defaults: any = descriptor.documentation.defaults
  harness.check("descriptor defaults name the real per-mode defaults", typeof defaults?.limit === "string" && defaults.limit.includes("25") && defaults.limit.includes("50"), JSON.stringify(defaults))
  harness.check("validation layer accepts the aliases the descriptor documents", ["symbol", "symbolName", "query"].every((alias) => alias in (PARAMETER_ALIASES["bb_analyze"] ?? {})), JSON.stringify(PARAMETER_ALIASES["bb_analyze"]))
}

// Descriptor <- validation agreement, exercised rather than asserted from text.
const probe = (args: unknown): string => {
  try { validateToolArguments(descriptor!, args as Record<string, unknown>); return "accepted" } catch (e: any) { return e?.message ?? String(e) }
}
harness.check("validation requires mode", /missing required option: mode/.test(probe({})), probe({}))
harness.check("validation rejects an unknown option", /unknown or irrelevant options/.test(probe({ mode: "stats", verbose: 1 })), probe({ mode: "stats", verbose: 1 }))
harness.check("validation rejects an unknown mode", /mode must be one of/.test(probe({ mode: "coupling" })), probe({ mode: "coupling" }))
harness.check("validation forgives symbol= as target", probe({ mode: "callers", symbol: "mid" }) === "accepted", probe({ mode: "callers", symbol: "mid" }))
harness.check("validation rejects conflicting alias and canonical", !/accepted/.test(probe({ mode: "callers", target: "a", symbol: "b" })), probe({ mode: "callers", target: "a", symbol: "b" }))

// The handler registry must answer for this tool, and its entry must be this
// tool's own — a missing or borrowed handler is what this row exists for.
const handlers = await import("../../src/mcp/tool-handlers").then((m) => m.createToolHandlers())
harness.check("handler registry answers bb_analyze", typeof handlers["bb_analyze"] === "function", typeof handlers["bb_analyze"])
harness.negative("handler is not shared with another tool name", handlers["bb_analyze"] !== handlers["bb_graph"], "distinct function")

harness.emit()
