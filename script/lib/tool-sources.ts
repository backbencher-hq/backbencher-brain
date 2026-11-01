// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the canonical accessor for the public tool surface's SOURCE
//   text after the registry and handlers were split into one module per tool.
//   Gates that used to read `src/mcp/tool-handlers.ts` / `tool-registry.ts` as one
//   file read through here, so a split or a new module is a one-line change rather
//   than a broken gate.
// WHO USES IT — script/m28/verify-mcp-tools.ts, script/m28/verify-union.ts,
//   script/m28/verify-surface-parity.ts, and any future surface gate.
// WHERE ITS EVIDENCE LIVES — the gates it serves; this file has no behaviour of
//   its own beyond reading the tree.
// EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/<tool>/{descriptor,handler}.ts,
//   src/mcp/tool-registry.ts, src/mcp/tool-handlers.ts.
// CONTRACTS IT MUST NOT BREAK — it reads the REAL files by relative path; it never
//   synthesizes or caches a stale copy.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

export const TOOL_NAMES = [
  "bb_search", "bb_ask", "bb_analyze", "bb_health", "bb_patterns", "bb_security",
  "bb_visualize", "bb_migrate", "bb_doc", "bb_edit", "bb_index", "bb_graph",
  "bb_impact", "bb_cross_language", "bb_annotate", "bb_annotations",
] as const

export function readToolSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

export function toolModuleSourceOf(tool: string): string {
  return readToolSource(`src/mcp/tools/${tool}/handler.ts`)
}

export function toolSourceFiles(): string[] {
  return [
    "src/mcp/tool-handlers.ts",
    "src/mcp/tool-registry.ts",
    "src/mcp/tools/shared.ts",
    "src/mcp/tools/types.ts",
    ...TOOL_NAMES.flatMap((tool) => [`src/mcp/tools/${tool}/descriptor.ts`, `src/mcp/tools/${tool}/handler.ts`]),
  ]
}

/** Every tool-source file, labelled, as one searchable text. */
export function combinedToolSource(): string {
  return toolSourceFiles().map((rel) => `// ── ${rel}\n${readToolSource(rel)}`).join("\n")
}
