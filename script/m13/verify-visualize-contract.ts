// script/m13/verify-visualize-contract.ts — M13.44 (V1).
//
// Separate scope from output-format in the bb_visualize contract.
//
// The scope enum (project/file/module/symbol/feature) and the format enum
// (text/json/html) are distinct, documented fields. `modes` must contain
// ONLY scopes; format is a separate input property. The handler must route
// on both independently.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.44",
  code: "V1",
  tool: "bb_visualize",
  title: "bb_visualize: contract mode cleanup (scope vs format)",
  layers: ["unit"],
  decisions: {
    scopeEnum: "project, file, module, symbol, feature (exactly these in modes)",
    formatEnum: "text, json, html (separate `format` input property, NOT in modes)",
    noDrift: "registry.modes, inputSchema, docs, and handler all agree",
  },
  limitations: ["This verifies the contract boundary only; graph output fidelity is verified in later V issues."],
})

const root = path.resolve(import.meta.dir, "..", "..")

const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_visualize")
harness.check("viz: bb_visualize is in the registry", !!registry, "missing")

if (registry) {
  // modes = scopes only (no format values).
  harness.equals("viz: modes are exactly the five scopes", registry.modes, ["project", "file", "module", "symbol", "feature"])

  // The scope enum lives in inputSchema.properties.scope.enum.
  const schema = registry.inputSchema as any
  const scopeEnum = schema?.properties?.scope?.enum ?? []
  const formatEnum = schema?.properties?.format?.enum ?? []
  harness.equals("viz: scope enum is exactly the five scopes", scopeEnum, ["project", "file", "module", "symbol", "feature"])
  harness.equals("viz: format enum is exactly text/json/html", formatEnum, ["text", "json", "html"])

  // format must NOT be in modes.
  harness.negative("viz: format values are NOT in modes", !registry.modes.includes("text") && !registry.modes.includes("json") && !registry.modes.includes("html"), `modes=${JSON.stringify(registry.modes)}`)

  // scope must NOT be a format.
  harness.negative("viz: scope values are NOT in the format enum", !formatEnum.includes("project") && !formatEnum.includes("symbol") && !formatEnum.includes("file"), `formatEnum=${JSON.stringify(formatEnum)}`)

  // defaults must carry scope + format separately.
  const defaults = registry.documentation.defaults as any
  harness.check("viz: defaults carry scope", defaults.scope === "project", `scope=${defaults.scope}`)
  harness.check("viz: defaults carry format", defaults.format === "text", `format=${defaults.format}`)
}

// Handler: routes on scope and format independently.
const handlerSrc = readFileSync(path.join(root, "src", "mcp", "tool-handlers.ts"), "utf8")
const vizSection = handlerSrc.slice(handlerSrc.indexOf("bb_visualize:"), handlerSrc.indexOf("bb_migrate:"))
harness.check("viz: handler validates scope independently", vizSection.includes('["project", "file", "module", "symbol", "feature"].includes'), "scope routing missing")
harness.check("viz: handler validates format independently", vizSection.includes('["text", "json", "html"].includes'), "format routing missing")
harness.negative("viz: handler does not treat format as a mode", !vizSection.includes('scope = "text"') && !vizSection.includes('scope = "json"') && !vizSection.includes('scope = "html"'), "format treated as scope")

// Docs: bb_visualize.md modes line = scopes only.
const doc = readFileSync(path.join(root, "docs", "tools", "bb_visualize.md"), "utf8")
harness.check("viz: docs modes line = scopes only", doc.includes("- Modes: `project`, `file`, `module`, `symbol`, `feature`"), "mode line mismatch")
harness.check("viz: docs has separate format property", doc.includes('"format"'), "format property missing")
harness.negative("viz: docs does not list format values under Modes", !/- Modes:.*`text`/.test(doc), "format leaked into modes line")

// Generator verify mode.
const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("viz: generator verify mode passes (bb_visualize.md byte-fresh)", gen.status === 0, gen.status === 0 ? "" : (gen.stderr || gen.stdout || "").slice(0, 200))

harness.emit()