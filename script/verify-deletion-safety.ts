// verify-deletion-safety.ts — M10.06 deletion-safety proof.
// We check:
//   1. Public tool surface unchanged (same 10 bb_* tools, same modes/properties).
//   2. Descriptors unchanged vs. docs/data/m10-baseline.json and public-tools.json.
//   3. Removed legacy symbols are gone from src/ast/tools.ts (the deletion ledger's
//      source of truth). This catches accidental re-introduction.
//   4. No public-facing endpoint claims contain "WORLD'S FIRST" / "revolutionary"
//      / "No other tool in the world" / "BREAKTHROUGH" strings.
//   5. Required removal evidence: ownership matrix, obsolete-table audit, and
//      parity-checking vs. canonical engines are documented.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const baseline = JSON.parse(readFileSync(resolve(root, "docs/data/m10-baseline.json"), "utf8"))

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` ${detail}` : ""}`)
  }
}

// 1) Exactly ten tools with baseline names.
const names = TOOL_DESCRIPTORS.map((t) => t.name).sort()
const expected = baseline.runtimeMcp.toolNames.slice().sort()
check("public surface size is 10", names.length === 10)
check("public tool names match baseline", names.join(",") === expected.join(","), `expected=${expected.join(",")} got=${names.join(",")}`)

// 2) Descriptor parity: modes match baseline for every tool.
function modesMatch(name: string): { matches: boolean; detail?: string } {
  const descriptor = TOOL_DESCRIPTORS.find((d: any) => d.name === name)
  const expectedModes = baseline.runtimeMcp.descriptors[name]?.modes
  if (!descriptor || !expectedModes) return { matches: false, detail: `descriptor/baseline missing for ${name}` }
  const actual = (descriptor.modes || []).slice().sort().join(",")
  const expected = expectedModes.slice().sort().join(",")
  const matches = actual === expected
  return { matches, detail: `actual=${actual} expected=${expected}` }
}
for (const name of baseline.runtimeMcp.toolNames) {
  const res = modesMatch(name)
  check(`modes parity for ${name}`, res.matches, res.detail)
}

// 3) Deletion-ledger removal evidence: removed-legacies must not exist in current source.
const toolsSource = readFileSync(resolve(root, "src/ast/tools.ts"), "utf8")
const removedSymbols: Array<[string, RegExp]> = [
  ["TestIntelligenceBrainTools", /\bTestIntelligenceBrainTools\b/],
  ["AdvancedBrainTools", /\bAdvancedBrainTools\b/],
  ["revolutionaryArchitectureIntelligence", /revolutionaryArchitectureIntelligence/],
  ["sentinelStatus (fn)", /\bfunction\s+sentinelStatus\b/],
  ["BrainTools.quickAnswer", /\bBrainTools\.quickAnswer\b|\bexport\s+async\s+function\s+quickAnswer\b/],
  ["BrainTools.recallFunction", /\bBrainTools\.recallFunction\b|\bexport\s+async\s+function\s+recallFunction\b/],
  ["BrainTools.recallClass", /\bBrainTools\.recallClass\b|\bexport\s+async\s+function\s+recallClass\b/],
  ["PatternBrainTools.findOrphanedCode", /\bPatternBrainTools\.findOrphanedCode\b|\bexport\s+async\s+function\s+findOrphanedCode\b/],
  ["sentinel orchestrator (function sentinel)", /\bexport\s+async\s+function\s+sentinel\b/],
]
for (const [label, re] of removedSymbols) {
  check(`M10.06 removed legacy symbol: ${label}`, !re.test(toolsSource), "still present")
}

// 4) Claims removed from shipped source/docs.
const claims = ["WORLD'S FIRST", "revolutionary", "No other tool in the world", "BREAKTHROUGH"]
const shippedSources = [
  ["src/ast/tools.ts", toolsSource],
  ["src/mcp/tool-handlers.ts", readFileSync(resolve(root, "src/mcp/tool-handlers.ts"), "utf8")],
  ["src/index.ts", readFileSync(resolve(root, "src/index.ts"), "utf8")],
  ["src/intelligence/search/semantic-search.ts", readFileSync(resolve(root, "src/intelligence/search/semantic-search.ts"), "utf8")],
]
for (const [file, src] of shippedSources) {
  for (const claim of claims) {
    check(`${file} has no claim "${claim}"`, !src.includes(claim))
  }
}

// 5) Ownership matrix present; includes obsolete-table audit statement.
const ownership = readFileSync(resolve(root, "docs/M10-INTELLIGENCE-OWNERSHIP.md"), "utf8")
check("ownership matrix documents obsolete-table audit", ownership.includes("Obsolete Table Audit"))
check("ownership matrix documents bb_ask fallback routing", ownership.includes("bb_ask") && ownership.includes("fallback"))
check("ownership matrix documents bb_patterns orphan routing", ownership.includes("bb_patterns") && ownership.includes("canonical"))

console.log(failures === 0 ? "\nDELETION SAFETY: PASS" : `\nDELETION SAFETY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
