// verify-contract-authority.ts — M13.01 (B1) drift test.
//
// Proves the executable registry is the single contract authority and that no
// drift exists between the registry, the derived contract (deriveToolContracts()),
// and the generated artifact (docs/data/public-tools.json). Runtime agreement is
// asserted separately by verify-contracts.ts via live MCP listTools.

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deriveToolContracts, TOOL_DESCRIPTORS, validateToolDescriptors, type ToolDescriptor } from "../../src/mcp/tool-registry"
import { Harness } from "./harness"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ARTIFACT_PATH = resolve(root, "docs/data/public-tools.json")
const CONTRACTS_PATH = resolve(root, "src/contracts/tool-contracts.ts")

// Modes that were previously advertised as executable by TARGET_TOOL_CONTRACTS
// but the runtime cannot execute. They must now be planned-only.
const ASPIRATIONAL_MODES: Record<string, string[]> = {
  bb_ask: ["explain", "feature"],
  bb_patterns: ["quality", "architecture"],
  bb_security: ["flow", "summary", "hotspots"],
}

const harness = new Harness({
  issue: "M13.01",
  code: "B1",
  tool: "baseline",
  title: "Contract authority: single executable-registry source of truth",
  layers: ["unit"],
  decisions: {
    authority: "src/mcp/tool-registry.ts (TOOL_DESCRIPTORS / deriveToolContracts())",
    bb_health_mutability: "read (refresh/force are documented, opt-in index mutations; 'index' in TARGET was the drift)",
    bb_visualize_modes: "project,file,module,symbol,feature (scope) + text,json,html (format); TARGET omitted module/text/json/html and was stale",
    plannedModes: ASPIRATIONAL_MODES,
  },
  limitations: [
    "Proves registry/derived/artifact agreement and planned-mode honesty; runtime agreement is asserted by verify-contracts.ts via live MCP listTools.",
    "plannedModes marks roadmap items, not implemented capabilities; each still requires its own implementation issue before it may move into modes.",
  ],
})

const contracts = deriveToolContracts()

harness.check(
  "derived contract is single-source (names match registry in order)",
  JSON.stringify(contracts.map((c) => c.name)) === JSON.stringify(TOOL_DESCRIPTORS.map((d) => d.name)),
)

let overlap = false
for (const c of contracts) {
  const modeSet = new Set(c.modes)
  if (c.plannedModes.some((m) => modeSet.has(m))) overlap = true
}
harness.check("no tool has plannedModes that overlap executable modes", !overlap)

let aspirationalLeak = false
for (const [tool, modes] of Object.entries(ASPIRATIONAL_MODES)) {
  const c = contracts.find((x) => x.name === tool)
  for (const mode of modes) {
    if (c?.modes.includes(mode) || !c?.plannedModes.includes(mode)) aspirationalLeak = true
  }
}
harness.check("aspirational modes are planned-only, never executable", !aspirationalLeak)

let artifactDrift = false
let artifactDriftDetail = ""
try {
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as {
    tools: Array<{ name: string; modes?: string[]; plannedModes?: string[]; mutability?: string }>
  }
  for (const c of contracts) {
    const a = artifact.tools.find((t) => t.name === c.name)
    if (!a) { artifactDrift = true; artifactDriftDetail = `missing ${c.name} in artifact`; break }
    const modesMatch = JSON.stringify([...c.modes].sort()) === JSON.stringify([...(a.modes ?? [])].sort())
    const plannedMatch = JSON.stringify([...c.plannedModes].sort()) === JSON.stringify([...(a.plannedModes ?? [])].sort())
    const mutMatch = a.mutability === c.mutability
    if (!modesMatch || !plannedMatch || !mutMatch) {
      artifactDrift = true
      artifactDriftDetail = `${c.name} modes=${modesMatch} planned=${plannedMatch} mutability=${mutMatch}`
      break
    }
  }
} catch (error) {
  artifactDrift = true
  artifactDriftDetail = error instanceof Error ? error.message : String(error)
}
harness.check("generated artifact (docs/data/public-tools.json) matches registry", !artifactDrift, artifactDriftDetail)

const contractsSource = readFileSync(CONTRACTS_PATH, "utf8")
harness.check("CURRENT_MCP_TOOL_CONTRACTS export removed from tool-contracts.ts", !/export\s+const\s+CURRENT_MCP_TOOL_CONTRACTS\b/.test(contractsSource))
harness.check("TARGET_TOOL_CONTRACTS export removed from tool-contracts.ts", !/export\s+const\s+TARGET_TOOL_CONTRACTS\b/.test(contractsSource))
harness.check("no hand-maintained tool-contract array remains", !/\] as const satisfies readonly (CurrentToolContract|TargetToolContract)/.test(contractsSource))

const artifactMut = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { tools: Array<{ name: string; mutability?: string }> }
let mutDrift = false
for (const c of contracts) {
  if (artifactMut.tools.find((t) => t.name === c.name)?.mutability !== c.mutability) mutDrift = true
}
harness.check("mutability is a single value (registry === derived === artifact)", !mutDrift)

harness.check(
  "exactly three tools declare planned modes (bb_ask, bb_patterns, bb_security)",
  JSON.stringify(contracts.filter((c) => c.plannedModes.length).map((c) => c.name).sort()) ===
    JSON.stringify(["bb_ask", "bb_patterns", "bb_security"]),
)

// Negative cases: the registry validator must ENFORCE planned-mode honesty, not just assert it.
const base = TOOL_DESCRIPTORS[0]!
harness.rejects(
  "registry validator rejects planned/executable mode overlap",
  () => validateToolDescriptors([{ ...base, name: "overlap-tool", modes: ["answer", "explain"], plannedModes: ["explain"] } as ToolDescriptor]),
  "planned modes overlap executable modes",
)
harness.rejects(
  "registry validator rejects duplicate planned modes",
  () => validateToolDescriptors([{ ...base, name: "dup-tool", plannedModes: ["a", "a"] } as ToolDescriptor]),
  "duplicate planned modes",
)

harness.emit()
