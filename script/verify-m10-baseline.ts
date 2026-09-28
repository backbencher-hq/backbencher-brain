import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PUBLIC_TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const baseline = JSON.parse(readFileSync(resolve(root, "docs/data/m10-baseline.json"), "utf8")) as any
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string; scripts: Record<string, string> }
const toolsSource = readFileSync(resolve(root, "src/ast/tools.ts"), "utf8")
const cliSource = readFileSync(resolve(root, "src/cli/index.ts"), "utf8")
const indexSource = readFileSync(resolve(root, "src/index.ts"), "utf8")
const handlersSource = readFileSync(resolve(root, "src/mcp/tool-handlers.ts"), "utf8")
const securityAdapterSource = readFileSync(resolve(root, "src/security/cross-language-security.ts"), "utf8")
const migrationAdapterSource = readFileSync(resolve(root, "src/ast/cross-language-migration-assistant.ts"), "utf8")
const governance = readFileSync(resolve(root, "docs/M10-EVIDENCE-GOVERNANCE.md"), "utf8")
const ledger = readFileSync(resolve(root, "docs/M10-DISPOSITION-LEDGER.md"), "utf8")
let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}`) }
}
function same(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

check("baseline schema is version 1", baseline.schemaVersion === 1)
check("baseline is M10 issue 116", baseline.milestone === "M10" && baseline.issue === 116)
check("package version matches baseline", packageJson.version === baseline.packageVersion)
// M35.E1 repair: derive from the baseline's own tool list — a hardcoded count
// rotted when M22 legitimately added bb_index and the gate could not notice.
check("runtime tool count matches baseline", PUBLIC_TOOL_DESCRIPTORS.length === baseline.runtimeMcp.toolNames.length)
check("runtime names match baseline", same(PUBLIC_TOOL_DESCRIPTORS.map((tool) => tool.name), baseline.runtimeMcp.toolNames))
for (const descriptor of PUBLIC_TOOL_DESCRIPTORS) {
  const expected = baseline.runtimeMcp.descriptors[descriptor.name]
  check(`${descriptor.name} has a baseline entry`, Boolean(expected))
  if (!expected) continue
  check(`${descriptor.name} mutability is frozen`, descriptor.mutability === expected.mutability)
  check(`${descriptor.name} index requirement is frozen`, descriptor.requiresIndex === expected.requiresIndex)
  check(`${descriptor.name} modes are frozen`, same([...descriptor.modes], expected.modes))
  check(`${descriptor.name} required fields are frozen`, same([...(descriptor.inputSchema.required ?? [])], expected.required))
  check(`${descriptor.name} properties are frozen`, same(Object.keys(descriptor.inputSchema.properties), expected.properties))
  check(`${descriptor.name} defaults are frozen`, same(descriptor.documentation.defaults, expected.defaults))
}
check("all baseline descriptors are present", Object.keys(baseline.runtimeMcp.descriptors).length === PUBLIC_TOOL_DESCRIPTORS.length)
for (const command of baseline.cli.commands) check(`CLI command ${command} remains present`, command === "--version" || (command === "tool" ? cliSource.includes('.command("tool")') : cliSource.includes(`.command("${command}")`)))
for (const [command, contract] of Object.entries(baseline.cli.contracts) as Array<[string, { required: string[]; options: string[] }]>) {
  const blockStart = command === "--version" ? -1 : cliSource.indexOf(`.command("${command}")`)
  const block = blockStart >= 0 ? cliSource.slice(blockStart, cliSource.indexOf("\n  .command", blockStart + 1) === -1 ? cliSource.length : cliSource.indexOf("\n  .command", blockStart + 1)) : command === "--version" ? cliSource : ""
  for (const option of contract.options) check(`CLI ${command} option ${option} remains present`, option === "no-wait" ? block.includes("--no-wait") : block.includes(`--${option}`) || block.includes(`<${option}>`))
  for (const required of contract.required) check(`CLI ${command} required ${required} remains present`, block.includes(`<${required}>`) || block.includes(`argument("<${required}>"`))
}
for (const name of baseline.libraryExports) {
  const exportPatterns: Record<string, string[]> = {
    BrainSchema: ["export * as BrainSchema"],
    ProjectSchema: ["export * as ProjectSchema"],
    CoreStorage: ["export * as CoreStorage"],
    checkFileFreshness: ["export { checkFileFreshness"],
    checkResultsFreshness: ["checkResultsFreshness"],
    hashFileContent: ["hashFileContent"],
    BACKBENCHER_BRAIN_VERSION: ["export { BACKBENCHER_BRAIN_VERSION"],
    TOOL_DESCRIPTORS: ["export {\n  TOOL_DESCRIPTORS"],
    serializeToolMetadata: ["serializeToolMetadata"],
    toMcpToolList: ["toMcpToolList"],
    validateToolDescriptors: ["validateToolDescriptors"],
    ToolDescriptor: ["export type { ToolDescriptor"],
    ToolDocumentation: ["ToolDocumentation"],
    ToolInputSchema: ["ToolInputSchema"],
  }
  check(`library export ${name} remains declared`, (exportPatterns[name] ?? [`export { ${name}`]).some((pattern) => indexSource.includes(pattern)))
}
for (const name of baseline.runtimeMcp.toolNames) check(`handler ${name} remains present`, handlersSource.includes(`${name}: async`))
// M10.06 removed dead legacy namespaces. Detection is structurally precise:
// only namespace-declaration tokens in shipped source paths qualify as
// evidence-of-presence. Comments documenting removal are intentionally
// ignored.
const REMOVED_NAMESPACES: Array<[string, RegExp]> = [
  ["AdvancedBrainTools", /\bexport\s+namespace\s+AdvancedBrainTools\b/],
  ["TestIntelligenceBrainTools", /\bexport\s+namespace\s+TestIntelligenceBrainTools\b/],
  ["revolutionaryArchitectureIntelligence", /\bexport\s+async\s+function\s+revolutionaryArchitectureIntelligence\b|\bexport\s+function\s+revolutionaryArchitectureIntelligence\b/],
]
const REMOVED_BRAIN_METHODS = [
  "quickAnswer", "recallFunction", "recallClass", "recallFile", "getStats",
  "getCouplingHeatmap", "getFileDeps", "findProblems", "traceFunctionCalls",
  "getFunctionCallers", "getFunctionCallees", "analyzeComplexity", "analyzeImpact",
  "detectPatterns", "sentinel", "quickAnswer",
]
const REMOVED_PATTERN_METHODS = ["findOrphanedCode"]
const REMOVED_SCHEMA_MARKERS = ["sentinel_runs", "sentinel_findings"]
const REMOVED_CLAIM_MARKERS = ["WORLD'S FIRST", "No other tool in the world", "BREAKTHROUGH"]
const SOURCES = [toolsSource, cliSource, handlersSource].join("\n")

// Strip line-comments from tools.ts so comment references don't trigger checks.
const strTools = toolsSource.replace(/^\s*\/\/.*$/gm, "")

for (const [ns, re] of REMOVED_NAMESPACES) {
  check(`M10.06 removed namespace ${ns}`, !re.test(SOURCES) && !re.test(cliSource) && !re.test(handlersSource))
}
for (const m of new Set(REMOVED_BRAIN_METHODS)) {
  // Check that `BrainTools.<name>` is not called and that there is no live
  // `export async function <name>(` inside the legacy BrainTools namespace.
  const callRe = new RegExp(`\\bBrainTools\\.${m}\\(`)
  const exportRe = new RegExp(`export\\s+async\\s+function\\s+${m}\\(`)
  check(`M10.06 removed BrainTools.${m}`, !callRe.test(SOURCES) && !(exportRe.test(strTools) && strTools.includes(`BrainTools.${m}`)))
}
for (const m of REMOVED_PATTERN_METHODS) {
  const callRe = new RegExp(`\\bPatternBrainTools\\.${m}\\(`)
  const exportRe = new RegExp(`export\\s+async\\s+function\\s+${m}\\(`)
  check(`M10.06 removed PatternBrainTools.${m}`, !callRe.test(SOURCES) && !exportRe.test(strTools))
}
for (const m of REMOVED_SCHEMA_MARKERS) {
  check(`M10.06 removed schema marker ${m}`, !SOURCES.includes(m))
}
for (const claim of REMOVED_CLAIM_MARKERS) {
  check(`M10.06 removed claim ${claim}`, !SOURCES.includes(claim))
}

// Legacy persistence markers (obsolete tables + claim strings) must be absent
// from shipped source paths (src/). Only the ledger/disposition docs keep
// them historically.
const DISPOSITIONS = readFileSync(resolve(root, "docs/M10-DISPOSITION-LEDGER.md"), "utf8")
function hasActiveReference(marker: string): boolean {
  // Only match the legacy non-brain_ table names. The canonical
  // brain_symbol/brain_file tables exist in active handlers/engines and are
  // separately verified as the active path.
  if (marker === "FROM symbols" || marker === "FROM files") {
    return /\bFROM\s+(symbols|files)\b/.test(SOURCES)
  }
  if (marker === "symbol_relationships") {
    return SOURCES.includes("symbol_relationships")
  }
  return SOURCES.includes(marker)
}
for (const marker of baseline.legacyInventory.obsoletePersistenceMarkers) {
  const activeRemoved = !hasActiveReference(marker)
  const documentedOnly = DISPOSITIONS.includes(marker)
  check(`M10.06 obsolete marker absent from shipped source: ${marker}`, activeRemoved && documentedOnly)
}
for (const claim of baseline.legacyInventory.claimsToReview) {
  const normalized = claim.replace("’", "'")
  const activeRemoved = !SOURCES.includes(claim) && !SOURCES.includes(normalized)
  check(`M10.06 superiority claim absent from shipped source: ${claim}`, activeRemoved)
}
for (const command of baseline.verification.requiredCommands) check(`required command ${command}`, command === "npm run verify" ? packageJson.scripts.verify.includes("verify-m10-baseline.ts") : command === "npm run docs:verify" ? typeof packageJson.scripts["docs:verify"] === "string" : true)
check("baseline verifier is in aggregate verify", packageJson.scripts.verify.includes("verify-m10-baseline.ts"))
check("baseline verifier is in quality gate", readFileSync(resolve(root, "script/verify-quality-gate.ts"), "utf8").includes("verify-m10-baseline.ts"))
check("governance document exists and defines evidence", governance.includes("Evidence Taxonomy") && governance.includes("Non-Negotiable Closure Standard"))
check("disposition ledger exists and defines decisions", ledger.includes("initial, evidence-backed hypothesis") && ledger.includes("Sentinel"))

console.log(failures === 0 ? "M10 BASELINE: PASS" : `M10 BASELINE: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
