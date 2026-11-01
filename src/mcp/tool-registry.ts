// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the canonical public MCP tool registry: assembles the sixteen descriptors and derives the executable contract.
// WHICH TOOL IT SERVES — all sixteen public tools (the MCP server, CLI, unit tests and docs generator all read this file).
// WHERE ITS EVIDENCE LIVES — docs/data/public-tools.json, docs/tools/*.md, website/src/data/tools.generated.ts, gates script/verify-public-surface.ts and script/verify-tool-registry.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/<tool>/descriptor.ts, src/mcp/tools/types.ts, script/verify-tool-docs.ts.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolMutability } from "../contracts/tool-contracts"
import type { ToolDescriptor, ToolInputSchema, ToolDocumentation, JsonSchemaProperty } from "./tools/types"
export type { ToolDescriptor, ToolInputSchema, ToolDocumentation, JsonSchemaProperty } from "./tools/types"

import { descriptor as bb_search } from "./tools/bb_search/descriptor"
import { descriptor as bb_ask } from "./tools/bb_ask/descriptor"
import { descriptor as bb_health } from "./tools/bb_health/descriptor"
import { descriptor as bb_patterns } from "./tools/bb_patterns/descriptor"
import { descriptor as bb_security } from "./tools/bb_security/descriptor"
import { descriptor as bb_visualize } from "./tools/bb_visualize/descriptor"
import { descriptor as bb_migrate } from "./tools/bb_migrate/descriptor"
import { descriptor as bb_analyze } from "./tools/bb_analyze/descriptor"
import { descriptor as bb_doc } from "./tools/bb_doc/descriptor"
import { descriptor as bb_edit } from "./tools/bb_edit/descriptor"
import { descriptor as bb_index } from "./tools/bb_index/descriptor"
import { descriptor as bb_graph } from "./tools/bb_graph/descriptor"
import { descriptor as bb_impact } from "./tools/bb_impact/descriptor"
import { descriptor as bb_cross_language } from "./tools/bb_cross_language/descriptor"
import { descriptor as bb_annotate } from "./tools/bb_annotate/descriptor"
import { descriptor as bb_annotations } from "./tools/bb_annotations/descriptor"

const descriptors = [
  bb_search,
  bb_ask,
  bb_health,
  bb_patterns,
  bb_security,
  bb_visualize,
  bb_migrate,
  bb_analyze,
  bb_doc,
  bb_edit,
  bb_index,
  bb_graph,
  bb_impact,
  bb_cross_language,
  bb_annotate,
  bb_annotations,
] as const satisfies readonly ToolDescriptor[]


export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = descriptors


export const PUBLIC_TOOL_DESCRIPTORS: readonly ToolDescriptor[] = descriptors


export function validateToolDescriptors(items: readonly ToolDescriptor[]): void {
  const names = new Set<string>()
  for (const item of items) {
    if (!item.name || names.has(item.name)) throw new Error(`duplicate or empty tool name: ${item.name || "<empty>"}`)
    names.add(item.name)
    if (item.inputSchema.type !== "object") throw new Error(`${item.name}: input schema must be an object`)
    const properties = item.inputSchema.properties ?? {}
    for (const required of item.inputSchema.required ?? []) {
      if (!(required in properties)) throw new Error(`${item.name}: required field ${required} is not declared`)
    }
    if (new Set(item.modes).size !== item.modes.length) throw new Error(`${item.name}: duplicate modes`)
    if (item.plannedModes) {
      if (new Set(item.plannedModes).size !== item.plannedModes.length) throw new Error(`${item.name}: duplicate planned modes`)
      const modeSet = new Set(item.modes)
      const overlap = item.plannedModes.filter((mode) => modeSet.has(mode))
      if (overlap.length) throw new Error(`${item.name}: planned modes overlap executable modes: ${overlap.join(", ")}`)
    }
    if (item.freshnessModes) {
      if (new Set(item.freshnessModes).size !== item.freshnessModes.length) throw new Error(`${item.name}: duplicate freshness modes`)
      const modeSet = new Set(item.modes)
      const unknown = item.freshnessModes.filter((mode) => !modeSet.has(mode))
      if (unknown.length) throw new Error(`${item.name}: freshness modes not in executable modes: ${unknown.join(", ")}`)
    }
    if (item.indexFreeModes) {
      if (new Set(item.indexFreeModes).size !== item.indexFreeModes.length) throw new Error(`${item.name}: duplicate index-free modes`)
      const modeSet = new Set(item.modes)
      const unknown = item.indexFreeModes.filter((mode) => !modeSet.has(mode))
      if (unknown.length) throw new Error(`${item.name}: index-free modes not in executable modes: ${unknown.join(", ")}`)
      // A tool that needs no index at all needs no exemption list: every mode is
      // already free, and a subset would read as if the others needed one.
      if (!item.requiresIndex) throw new Error(`${item.name}: indexFreeModes is meaningless when requiresIndex is false`)
    }
    if (new Set(item.aliases).size !== item.aliases.length) throw new Error(`${item.name}: duplicate aliases`)
    if (item.deprecated && !item.replacement) throw new Error(`${item.name}: deprecated tools require a replacement`)
  }
}

validateToolDescriptors(TOOL_DESCRIPTORS)

/**
 * The public tool contract, DERIVED from the executable registry. This is the
 * single authority the M13 drift test and every consumer must use; there is no
 * hand-maintained parallel copy to drift out of sync.
 */
export interface DerivedToolContract {
  name: string
  mutability: ToolMutability
  requiresIndex: boolean
  /** M71.D6: see ToolDescriptor.indexFreeModes — modes the index gate exempts. */
  indexFreeModes: readonly string[]
  modes: readonly string[]
  plannedModes: readonly string[]
  required: readonly string[]
  properties: readonly string[]
  defaults: Readonly<Record<string, string | number | boolean>>
  output: "text"
  replacement: string
}

export function deriveToolContracts(items: readonly ToolDescriptor[] = TOOL_DESCRIPTORS): DerivedToolContract[] {
  return items.map((descriptor) => ({
    name: descriptor.name,
    mutability: descriptor.mutability,
    requiresIndex: descriptor.requiresIndex,
    indexFreeModes: descriptor.indexFreeModes ?? [],
    modes: descriptor.modes,
    plannedModes: descriptor.plannedModes ?? [],
    required: descriptor.inputSchema.required ?? [],
    properties: Object.keys(descriptor.inputSchema.properties ?? {}),
    defaults: descriptor.documentation.defaults,
    output: "text" as const,
    replacement: descriptor.name,
  }))
}

export function toMcpToolList(items: readonly ToolDescriptor[] = TOOL_DESCRIPTORS): Array<Pick<ToolDescriptor, "name" | "description" | "inputSchema">> {
  return items.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

export function serializeToolMetadata(items: readonly ToolDescriptor[] = TOOL_DESCRIPTORS): string {
  return JSON.stringify(items, null, 2)
}
