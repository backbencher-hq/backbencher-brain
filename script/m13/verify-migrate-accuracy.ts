// script/m13/verify-migrate-accuracy.ts — M13.48 (M1).
import { readFileSync } from "node:fs"
import path from "node:path"
import { Harness } from "./harness"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.48", code: "M1", tool: "bb_migrate",
  title: "bb_migrate: mapping accuracy + no fake translation",
  layers: ["unit"],
  decisions: { noFakeClaims: "no plan claims to generate/compile target source" },
  limitations: ["Contract-level verification; full engine test in M2."],
})

const enginePath = path.join(path.resolve("."), "src", "intelligence", "migration", "migration-engine.ts")
const engineSrc = readFileSync(enginePath, "utf8")
harness.check("migrate: engine file exists", engineSrc.length > 0, String(engineSrc.length))
harness.check("migrate: engine has no generateTargetCode", !engineSrc.includes("generateTargetCode"), "clean")
harness.negative("migrate: engine has no compileTarget claim", !engineSrc.includes("compileTarget"), "clean")
harness.negative("migrate: engine has no produce target source claim", !engineSrc.includes("produce target source"), "clean")

// Registry: verify contract
const registry = PUBLIC_TOOL_DESCRIPTORS.find(t => t.name === "bb_migrate")
harness.check("migrate: registry has bb_migrate", !!registry, "found")
if (registry) {
  harness.check("migrate: description doesn't claim code generation", !registry.description.includes("generate") && !registry.description.includes("compile"), registry.description.slice(0, 80))
  harness.check("migrate: modes = [plan]", JSON.stringify(registry.modes) === JSON.stringify(["plan"]), JSON.stringify(registry.modes))
  harness.check("migrate: format is separate property (text/json)", !!registry.inputSchema.properties?.format, "format present")
  harness.check("migrate: has required fields", !!registry.inputSchema.properties?.symbolNames || !!registry.inputSchema.properties?.symbolName, "ok")
}

harness.emit()
