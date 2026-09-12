/**
 * M10.07 contract-diff verifier.
 *
 * Asserts that, after M10.03 consolidation and M10.06 deletion, the live
 * public contract remains identical to the M10.01 baseline AND that the
 * runtime actively rejects undocumented options on every public tool.
 *
 * Existing verifiers already cover most of this (verify-m10-baseline
 * freezes descriptors, modes, mutability, defaults, CLI commands, library
 * exports). This verifier adds three higher-order guarantees:
 *
 *   1. Docs and migration guidance align with registry truth (no stale
 *      "alias" claims and no `0.3.0`-era dead references).
 *   2. Undocumented-option rejection is enforced live for every public
 *      tool via the same `validateToolArguments` both MCP and CLI use.
 *   3. The registry/handlers/CLI-gateway triangle has no drift: every
 *      descriptor has exactly one handler and exactly one CLI dispatch path.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PUBLIC_TOOL_DESCRIPTORS, validateToolDescriptors } from "../src/mcp/tool-registry"
import { validateToolArguments } from "../src/mcp/tool-validation"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const baseline = JSON.parse(readFileSync(resolve(root, "docs/data/m10-baseline.json"), "utf8")) as any
const cliSource = readFileSync(resolve(root, "src/cli/index.ts"), "utf8")
const handlersSource = readFileSync(resolve(root, "src/mcp/tool-handlers.ts"), "utf8")
const registrySource = readFileSync(resolve(root, "src/mcp/tool-registry.ts"), "utf8")
const migrationGuide = readFileSync(resolve(root, "docs/MCP_TOOL_MIGRATION.md"), "utf8")
const toolRegistryDoc = readFileSync(resolve(root, "docs/TOOL-REGISTRY.md"), "utf8")

let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}

// 1. Registry self-validation (already runs on import) — call it explicitly
//    to prove the reachable registry is structurally sound.
let registryValid = true
try { validateToolDescriptors(PUBLIC_TOOL_DESCRIPTORS) } catch (e) {
  registryValid = false
  console.log(`  registry validation error: ${(e as Error).message}`)
}
check("PUBLIC_TOOL_DESCRIPTORS validate cleanly", registryValid)

// 2. Exactly the approved ten tools exist and have unique names.
// M35.E1 repair: derive the advertised count from the frozen baseline instead
// of a hardcoded literal — M22's bb_index addition rotted the hardcode and the
// gate silently failed for the whole repo until E1 needed this surface.
check("tool count matches baseline advertisement", PUBLIC_TOOL_DESCRIPTORS.length === baseline.runtimeMcp.toolNames.length)
const names = PUBLIC_TOOL_DESCRIPTORS.map((t) => t.name)
check("tool names are unique", new Set(names).size === names.length)
check("tool names match baseline order and content",
  JSON.stringify(names) === JSON.stringify(baseline.runtimeMcp.toolNames))

// 3. Registry/handlers/CLI gateway triangle: one-to-one.
// Every descriptor must have a dispatch entry in handlers (by `name: async`)
// and every handlers entry must be a registered descriptor.
const handlerMatches = handlersSource.match(/^  (bb_[a-z_]+): async /gm) ?? []
const handlerNames = handlerMatches.map((m) => m.trim().replace(/\s*:\s*async\s*$/, "")).sort()
check("handlers count matches descriptor count", handlerNames.length === PUBLIC_TOOL_DESCRIPTORS.length)
const sortedToolNames = [...names].sort()
check("handler set equals descriptor set",
  JSON.stringify(handlerNames) === JSON.stringify(sortedToolNames))

// CLI gateway must dispatch through the same handlers map.
check("CLI gateway resolves handlers via createToolHandlers()",
  cliSource.includes("createToolHandlers()") && cliSource.includes("handler(validated, {"))
check("CLI gateway uses the same validator",
  cliSource.includes("validateToolArguments(descriptor, args)"))

// 4. Undocumented-option rejection coverage. For every public tool, submit
//    an unknown option and assert the validator rejects it.
for (const descriptor of PUBLIC_TOOL_DESCRIPTORS) {
  let rejected = false
  try {
    validateToolArguments(descriptor, { __m10_undeclared_probe__: true })
    rejected = false
  } catch (e) {
    rejected = /unknown or irrelevant options/.test((e as Error).message)
  }
  check(`${descriptor.name} rejects undocumented options`, rejected)
}

// 5. Required-field enforcement is live (not just declared).
for (const descriptor of PUBLIC_TOOL_DESCRIPTORS) {
  const required = descriptor.inputSchema.required ?? []
  if (!required.length) continue
  let rejected = false
  try { validateToolArguments(descriptor, {}) } catch (e) {
    rejected = new RegExp(`missing required option: ${required[0]}`).test((e as Error).message)
  }
  check(`${descriptor.name} enforces required[0]=${required[0]}`, rejected)
}

// 6. Type validation: passing a wrong type for a declared property must throw.
for (const descriptor of PUBLIC_TOOL_DESCRIPTORS) {
  const props = descriptor.inputSchema.properties
  const propName = Object.keys(props)[0]
  if (!propName) continue
  const prop = props[propName]!
  let wrongType: unknown
  if (prop.type === "string") wrongType = 42
  else if (prop.type === "number") wrongType = "abc"
  else if (prop.type === "boolean") wrongType = "yes"
  else if (prop.type === "array") wrongType = 42
  else wrongType = "x"
  let rejected = false
  try { validateToolArguments(descriptor, { [propName]: wrongType }) } catch { rejected = true }
  check(`${descriptor.name}.${propName} rejects wrong type`, rejected)
}

// 7. Enum constraints enforced where declared (e.g. mode must come from an enum).
for (const descriptor of PUBLIC_TOOL_DESCRIPTORS) {
  const props = descriptor.inputSchema.properties
  for (const [propName, prop] of Object.entries(props)) {
    if (!prop?.enum?.length) continue
    let rejected = false
    try { validateToolArguments(descriptor, { [propName]: "__m10_bad_enum__" }) } catch { rejected = true }
    check(`${descriptor.name}.${propName} enforces enum`, rejected)
    break // one enum guard per tool is enough to prove the wiring
  }
}

// 8. Baseline descriptors stay frozen — no silent property additions/removals.
for (const descriptor of PUBLIC_TOOL_DESCRIPTORS) {
  const expected = baseline.runtimeMcp.descriptors[descriptor.name]
  if (!expected) { check(`${descriptor.name} baseline entry exists`, false); continue }
  const actualProps = Object.keys(descriptor.inputSchema.properties).sort()
  const expectedProps = [...expected.properties].sort()
  check(`${descriptor.name} properties match baseline exactly`,
    JSON.stringify(actualProps) === JSON.stringify(expectedProps))
  const actualDefaults = descriptor.documentation.defaults
  check(`${descriptor.name} defaults match baseline exactly`,
    JSON.stringify(actualDefaults) === JSON.stringify(expected.defaults))
}

// 9. Migration guidance is coherent: aliases must not be re-advertised.
//    `MCP_TOOL_MIGRATION.md` is the canonical reference; `TOOL-REGISTRY.md`
//    documents the registry/inventory. Both must agree that 0.3.0 has zero
//    aliases.
check("migration guide announces alias removal", /removed those\s*aliases/.test(migrationGuide))
check("registry doc says aliases are empty in 0.3.0",
  /empty in the `0\.3\.0` public surface/.test(toolRegistryDoc))
// Registry actually ships zero aliases today.
check("runtime registry has zero aliases",
  PUBLIC_TOOL_DESCRIPTORS.every((d) => d.aliases.length === 0))
// No descriptor is marked deprecated (aliases were removed outright, not
// deprecated-then-removed, per the migration guide).
check("no descriptor is marked deprecated",
  PUBLIC_TOOL_DESCRIPTORS.every((d) => !d.deprecated))

// 10. Registry self-documents valid shape: every descriptor declares modes,
//     a category, and at least one example.
// M50.A5 (#768): the category vocabulary was frozen at M10's four values and
// rotted when M28 added the graph/annotations families — the gate then failed
// for five real tools, which is how a gate stops being read. The list below is
// the DECLARED union (ToolDocumentation.category); a category outside it is
// still a failure, so the check keeps its teeth.
const DECLARED_CATEGORIES = ["search", "analysis", "operations", "lifecycle", "graph", "annotations"]
for (const d of PUBLIC_TOOL_DESCRIPTORS) {
  check(`${d.name} declares modes array`, Array.isArray(d.modes) && d.modes.length > 0)
  check(`${d.name} declares documentation category`,
    DECLARED_CATEGORIES.includes(d.documentation.category))
  check(`${d.name} declares at least one example`, d.documentation.examples.length >= 1)
}

// 11. CLI surface parity with baseline command list.
for (const cmd of baseline.cli.commands) {
  if (cmd === "--version") continue
  check(`CLI .command("${cmd}") declared`, cliSource.includes(`.command("${cmd}")`))
}
check("CLI exposes tool gateway", cliSource.includes('.command("tool")'))

if (failures > 0) {
  console.error(`\nCONTRACT DIFF: FAIL (${failures} failure${failures === 1 ? "" : "s"})`)
  process.exit(1)
}
console.log("\nCONTRACT DIFF: PASS")
