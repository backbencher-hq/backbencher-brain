// script/m50/refreeze-baseline.ts — M50.A5 (#768)
//
// `docs/data/m10-baseline.json` is the M10.01 frozen contract. It had rotted
// against the live registry (11 tools frozen vs 16 registered; bb_search's
// property list predated the M43 `refresh` option), which made two gates in the
// verify chain RED at HEAD — `verify-contract-diff.ts` (13 failures) and
// `verify-tool-registry.ts` (1 failure). A red gate that everyone ignores is
// worse than no gate: it hides the next real regression.
//
// This script RE-FREEZES only the mechanically-derived parts of the baseline
// from the live registry, and records why in `postBaselineRepairs`. Everything
// that is a human decision (schemaVersion, milestone/issue identity, library
// exports, legacy inventory, verification notes, CLI option contracts) is left
// byte-for-byte untouched.
//
// Usage:
//   npx tsx script/m50/refreeze-baseline.ts --check   # report drift, write nothing
//   npx tsx script/m50/refreeze-baseline.ts --write   # re-freeze (review the diff)

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const BASELINE = path.join(ROOT, "docs/data/m10-baseline.json")
const CLI = path.join(ROOT, "src/cli/index.ts")

const mode = process.argv.includes("--write") ? "write" : "check"
// --baseline <path> lets the A5 gate run this comparator against a deliberately
// degraded COPY (falsifiability: the drift test must be able to fail) without
// touching the frozen file.
const baselineArg = process.argv.indexOf("--baseline")
const BASELINE_PATH = baselineArg >= 0 && process.argv[baselineArg + 1] ? path.resolve(process.argv[baselineArg + 1]) : BASELINE
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as any
const cliSource = readFileSync(CLI, "utf8")

const descriptors: Record<string, unknown> = {}
for (const d of PUBLIC_TOOL_DESCRIPTORS) {
  descriptors[d.name] = {
    mutability: d.mutability,
    requiresIndex: d.requiresIndex,
    modes: [...d.modes],
    required: [...(d.inputSchema.required ?? [])],
    properties: Object.keys(d.inputSchema.properties),
    defaults: d.documentation.defaults,
  }
}

const cliCommands = (cliSource.match(/\.command\("([a-z-]+)"\)/g) ?? [])
  .map((m) => m.slice('.command("'.length, -2))
  .filter((c, i, all) => all.indexOf(c) === i)

const next = JSON.parse(JSON.stringify(baseline))
next.runtimeMcp.toolNames = PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name)
next.runtimeMcp.descriptors = descriptors
next.cli.commands = [...new Set([...cliCommands, "--version"])]
next.runtimeMcp.postBaselineRepairs = {
  ...(baseline.runtimeMcp.postBaselineRepairs ?? {}),
  "M50.A5 re-freeze (#768)":
    "re-froze toolNames/descriptors/commands from the live registry so verify-contract-diff + verify-m10-baseline compare against the real surface (M28 graph/impact/cross-language/annotate tools and the M43 bb_search `refresh` option were missing)",
}

const before = JSON.stringify(baseline, null, 2)
const after = JSON.stringify(next, null, 2)
const drifted = before !== after

console.log(`baseline re-freeze (${mode})`)
console.log(`  frozen tools: ${baseline.runtimeMcp.toolNames.length} -> ${next.runtimeMcp.toolNames.length}`)
console.log(`  frozen descriptors: ${Object.keys(baseline.runtimeMcp.descriptors).length} -> ${Object.keys(descriptors).length}`)
console.log(`  frozen CLI commands: ${baseline.cli.commands.length} -> ${next.cli.commands.length}`)
console.log(`  drift: ${drifted ? "YES" : "no"}`)

if (mode === "write") {
  if (!drifted) {
    console.log("nothing to write")
  } else {
    writeFileSync(BASELINE_PATH, after + "\n")
    console.log(`wrote ${BASELINE_PATH}`)
  }
} else if (drifted) {
  const beforeNames = baseline.runtimeMcp.toolNames as string[]
  const added = next.runtimeMcp.toolNames.filter((n: string) => !beforeNames.includes(n))
  if (added.length) console.log(`  tools missing from the frozen baseline: ${added.join(", ")}`)
  process.exit(1)
}
