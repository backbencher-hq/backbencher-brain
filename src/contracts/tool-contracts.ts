// src/contracts/tool-contracts.ts — M13.01 (B1) contract authority.
//
// The public TOOL contract is now DERIVED from the executable registry
// (src/mcp/tool-registry.ts -> deriveToolContracts()). The previous hand-maintained
// arrays here (CURRENT_MCP_TOOL_CONTRACTS and TARGET_TOOL_CONTRACTS) drifted from
// the runtime — they advertised aspirational modes (bb_ask explain/feature,
// bb_patterns quality/architecture, bb_security flow/summary/hotspots, bb_health
// index mutability) that the runtime cannot execute. Those aspirational modes now
// live in each descriptor's `plannedModes` field and are never advertised as
// executable.
//
// This file retains only the shared mutability type plus the separate CLI and
// library-export surfaces, which are not part of the ten-tool contract.

export type ToolMutability = "read" | "index" | "write"

// CLI subcommands are a separate surface from the ten MCP tools. Their frozen
// baseline lives in docs/data/m10-baseline.json (cli.contracts) and is enforced
// by script/verify-m10-baseline.ts against the live CLI source.
export const CURRENT_CLI_CONTRACTS = [
  { name: "index", required: ["dir"], options: ["force"] },
  { name: "search", required: ["query"], options: ["dir", "limit", "language"] },
  { name: "health", required: [], options: ["dir"] },
  { name: "mcp", required: [], options: ["dir"] },
  { name: "--version", required: [], options: [] },
] as const

// Library exports are a separate surface. Their frozen baseline lives in
// docs/data/m10-baseline.json (libraryExports) and is enforced by
// script/verify-m10-baseline.ts against src/index.ts.
export const CURRENT_LIBRARY_EXPORTS = [
  "BrainDatabase",
  "BrainSchema",
  "ProjectSchema",
  "ProjectID",
  "CoreStorage",
  "ASTEngine",
  "indexProjectParallel",
  "BrainTools",
  "SemanticEngine",
  "checkFileFreshness",
  "checkResultsFreshness",
  "hashFileContent",
  "getProjectId",
] as const
