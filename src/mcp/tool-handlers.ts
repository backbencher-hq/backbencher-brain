// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the assembler that binds each registered public tool name to its handler module.
// WHICH TOOL IT SERVES — all sixteen public tools (this file dispatches; it implements none of them).
// WHERE ITS EVIDENCE LIVES — validation/tools/<tool>/**, gates script/verify-mcp.ts, script/verify-tool-registry.ts, script/m15/verify-registry-handlers.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/<tool>/handler.ts, src/mcp/tool-registry.ts.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "./tools/shared"
import { TOOL_DESCRIPTORS } from "./tool-registry"
import { handler as bb_search_handler } from "./tools/bb_search/handler"
import { handler as bb_ask_handler } from "./tools/bb_ask/handler"
import { handler as bb_analyze_handler } from "./tools/bb_analyze/handler"
import { handler as bb_health_handler } from "./tools/bb_health/handler"
import { handler as bb_patterns_handler } from "./tools/bb_patterns/handler"
import { handler as bb_security_handler } from "./tools/bb_security/handler"
import { handler as bb_visualize_handler } from "./tools/bb_visualize/handler"
import { handler as bb_migrate_handler } from "./tools/bb_migrate/handler"
import { handler as bb_doc_handler } from "./tools/bb_doc/handler"
import { handler as bb_edit_handler } from "./tools/bb_edit/handler"
import { handler as bb_index_handler } from "./tools/bb_index/handler"
import { handler as bb_graph_handler } from "./tools/bb_graph/handler"
import { handler as bb_impact_handler } from "./tools/bb_impact/handler"
import { handler as bb_cross_language_handler } from "./tools/bb_cross_language/handler"
import { handler as bb_annotate_handler } from "./tools/bb_annotate/handler"
import { handler as bb_annotations_handler } from "./tools/bb_annotations/handler"

export * from "./tools/shared"

const handlers: Record<string, ToolHandler> = {
  bb_search: bb_search_handler,
  bb_ask: bb_ask_handler,
  bb_analyze: bb_analyze_handler,
  bb_health: bb_health_handler,
  bb_patterns: bb_patterns_handler,
  bb_security: bb_security_handler,
  bb_visualize: bb_visualize_handler,
  bb_migrate: bb_migrate_handler,
  bb_doc: bb_doc_handler,
  bb_edit: bb_edit_handler,
  bb_index: bb_index_handler,
  bb_graph: bb_graph_handler,
  bb_impact: bb_impact_handler,
  bb_cross_language: bb_cross_language_handler,
  bb_annotate: bb_annotate_handler,
  bb_annotations: bb_annotations_handler,
}


export function createToolHandlers(): Readonly<Record<string, ToolHandler>> {
  const registeredNames = new Set(TOOL_DESCRIPTORS.map((descriptor) => descriptor.name))
  for (const name of registeredNames) if (!handlers[name]) throw new Error(`missing handler for registered tool: ${name}`)
  for (const name of Object.keys(handlers)) if (!registeredNames.has(name)) throw new Error(`handler has no registered tool: ${name}`)
  return handlers
}
