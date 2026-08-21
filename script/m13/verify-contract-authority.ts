// verify-contract-authority.ts — M13.01 (B1) drift test.
//
// Proves the executable registry is the single contract authority and that no
// drift exists between:
//   - the registry (src/mcp/tool-registry.ts)
//   - the derived contract (deriveToolContracts())
//   - the generated artifact (docs/data/public-tools.json)
//   - the runtime (asserted separately by verify-contracts.ts via live MCP listTools)
//
// Also proves aspirational modes are honest: they live only in `plannedModes`
// and never in executable `modes`, and that the two hand-maintained contract
// arrays (CURRENT_MCP_TOOL_CONTRACTS / TARGET_TOOL_CONTRACTS) are gone.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deriveToolContracts, TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ARTIFACT_PATH = resolve(root, "docs/data/public-tools.json")
const CONTRACTS_PATH = resolve(root, "src/contracts/tool-contracts.ts")
const EVIDENCE_PATH = resolve(root, "validation/m13/results/b1.json")

// Modes that were previously advertised as executable by TARGET_TOOL_CONTRACTS
// but the runtime cannot execute. They must now be planned-only.
const ASPIRATIONAL_MODES: Record<string, string[]> = {
  bb_ask: ["explain", "feature"],
  bb_patterns: ["quality", "architecture"],
  bb_security: ["flow", "summary", "hotspots"],
}

const checks: Array<{ name: string; pass: boolean; detail?: string }> = []
function check(name: string, pass: boolean, detail = ""): void {
  checks.push({ name, pass, detail })
  console.log(`  ${pass ? "ok" : "FAIL"}: ${name}${detail ? ` ${detail}` : ""}`)
}

const contracts = deriveToolContracts()

// 1. Single source: derived contract names equal registry names, in order.
check(
  "derived contract is single-source (names match registry in order)",
  JSON.stringify(contracts.map((c) => c.name)) === JSON.stringify(TOOL_DESCRIPTORS.map((d) => d.name)),
)

// 2. plannedModes disjoint from executable modes for every tool.
let overlap = false
for (const c of contracts) {
  const modeSet = new Set(c.modes)
  const bad = c.plannedModes.filter((m) => modeSet.has(m))
  if (bad.length) {
    overlap = true
    console.log(`    ${c.name} overlap: ${bad.join(",")}`)
  }
}
check("no tool has plannedModes that overlap executable modes", !overlap)

// 3. Aspirational modes are planned-only, never executable.
let aspirationalLeak = false
for (const [tool, modes] of Object.entries(ASPIRATIONAL_MODES)) {
  const c = contracts.find((x) => x.name === tool)
  for (const mode of modes) {
    const executable = c?.modes.includes(mode)
    const planned = c?.plannedModes.includes(mode)
    if (executable || !planned) {
      aspirationalLeak = true
      console.log(`    ${tool}.${mode}: executable=${executable} planned=${planned}`)
    }
  }
}
check("aspirational modes are planned-only, never executable", !aspirationalLeak)

// 4. Generated artifact matches the registry (modes, plannedModes, mutability).
let artifactDrift = false
let artifactDriftDetail = ""
try {
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { tools: Array<{ name: string; modes?: string[]; plannedModes?: string[]; mutability?: string }> }
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
check("generated artifact (docs/data/public-tools.json) matches registry", !artifactDrift, artifactDriftDetail)

// 5. The two hand-maintained contract arrays are gone from source (no `export const`
//    declaration may remain; a comment naming the removal is acceptable).
const contractsSource = readFileSync(CONTRACTS_PATH, "utf8")
check("CURRENT_MCP_TOOL_CONTRACTS export removed from tool-contracts.ts", !/export\s+const\s+CURRENT_MCP_TOOL_CONTRACTS\b/.test(contractsSource))
check("TARGET_TOOL_CONTRACTS export removed from tool-contracts.ts", !/export\s+const\s+TARGET_TOOL_CONTRACTS\b/.test(contractsSource))
check("no hand-maintained tool-contract array remains", !/\] as const satisfies readonly (CurrentToolContract|TargetToolContract)/.test(contractsSource))

// 6. Mutability is a single value everywhere (registry === derived === artifact).
const artifactMut = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { tools: Array<{ name: string; mutability?: string }> }
let mutDrift = false
for (const c of contracts) {
  const a = artifactMut.tools.find((t) => t.name === c.name)
  if (a?.mutability !== c.mutability) { mutDrift = true; break }
}
check("mutability is a single value (registry === derived === artifact)", !mutDrift)

// 7. Every tool with planned modes also documents them (bb_ask/bb_patterns/bb_security).
check(
  "exactly three tools declare planned modes (bb_ask, bb_patterns, bb_security)",
  JSON.stringify(contracts.filter((c) => c.plannedModes.length).map((c) => c.name).sort()) ===
    JSON.stringify(["bb_ask", "bb_patterns", "bb_security"]),
)

const passed = checks.filter((c) => c.pass).length
const allPass = passed === checks.length

const evidence = {
  schemaVersion: 1,
  milestone: "M13",
  issue: "M13.01",
  code: "B1",
  tool: "baseline",
  title: "Contract authority: single executable-registry source of truth",
  verifiedState: allPass ? "verified" : "known-gap",
  generatedAt: new Date().toISOString(),
  decisions: {
    authority: "src/mcp/tool-registry.ts (TOOL_DESCRIPTORS / deriveToolContracts())",
    bb_health_mutability: "read (refresh/force are documented, opt-in index mutations; 'index' in TARGET was the drift)",
    bb_visualize_modes: "project,file,module,symbol,feature (scope) + text,json,html (format); TARGET omitted module/text/json/html and was stale",
    plannedModes: {
      bb_ask: ["explain", "feature"],
      bb_patterns: ["quality", "architecture"],
      bb_security: ["flow", "summary", "hotspots"],
    },
  },
  checks,
  summary: { total: checks.length, passed, failed: checks.length - passed },
  limitations: [
    "Proves registry/derived/artifact agreement and planned-mode honesty; runtime agreement is asserted by verify-contracts.ts via live MCP listTools.",
    "plannedModes marks roadmap items, not implemented capabilities; each still requires its own implementation issue before it may move into modes.",
  ],
}

mkdirSync(dirname(EVIDENCE_PATH), { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")

console.log(`\nCONTRACT AUTHORITY: ${allPass ? "PASS" : `${checks.length - passed} FAILURES`}`)
process.exit(allPass ? 0 : 1)
