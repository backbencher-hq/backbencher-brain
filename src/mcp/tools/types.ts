// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the public tool contract types: JSON schema shape, documentation, descriptor, mutability.
// WHICH TOOL IT SERVES — all sixteen public tools (the registry and every descriptor import them).
// WHERE ITS EVIDENCE LIVES — src/mcp/tool-registry.ts re-exports these types; docs/data/public-tools.json is generated from the registry.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tool-registry.ts, src/mcp/tools/<tool>/descriptor.ts.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolMutability } from "../../contracts/tool-contracts"

export type JsonSchemaProperty = {
  type: "string" | "number" | "boolean" | "array" | "object"
  description?: string
  enum?: readonly string[]
  items?: JsonSchemaProperty
  /**
   * The value used when the caller omits this property.
   *
   * Declared so it can be stated in the SCHEMA rather than only in prose inside the
   * description. A default that exists only as the word "(default)" in a sentence is
   * something a caller has to read and interpret, while a schema `default` is a fact a
   * client, a test or a generated page can read directly. bb_visualize's `view` states
   * it both ways on purpose: the machine-readable field for tools, the prose for people
   * reading the parameter list.
   *
   * It is documentation, not behaviour: validateProperty never reads it, because an
   * omitted property is defaulted by the tool itself and an explicit one is checked
   * against `enum`. Adding it must not change what any call validates as.
   */
  default?: string | number | boolean
  /**
   * The inclusive numeric bound this property accepts.
   *
   * Declared for the same reason as `default`: a bound stated only as prose in the
   * description is something a caller must interpret, while schema `minimum` and
   * `maximum` are facts a client, a test, or a generated page can read directly.
   * They are documentation, not validation — `validateProperty` does not read them,
   * and the handler enforces the bound; the schema states it so the contract is
   * readable before the first refused call.
   */
  minimum?: number
  maximum?: number
}

export interface ToolInputSchema {
  type: "object"
  properties: Readonly<Record<string, JsonSchemaProperty>>
  required?: readonly string[]
}

export interface ToolDocumentation {
  category: "search" | "analysis" | "operations" | "lifecycle" | "graph" | "annotations"
  summary: string
  defaults: Readonly<Record<string, string | number | boolean>>
  examples: readonly Readonly<Record<string, unknown>>[]
}

export interface ToolDescriptor {
  name: string
  description: string
  inputSchema: ToolInputSchema
  mutability: ToolMutability
  requiresIndex: boolean
  modes: readonly string[]
  /** Modes on the roadmap but NOT executable. Never advertised as available. */
  plannedModes?: readonly string[]
  /**
   * Modes whose JSON envelope must carry the registered staleness
   * block ({ fresh, stale, missing, staleRatio, mode, remediation }).
   * Enforced by script/m35/verify-envelope-contract.ts against the real
   * handlers: a registered mode that omits the block fails the gate.
   */
  freshnessModes?: readonly string[]
  /**
   * Modes that do NOT need an index — the per-mode refinement of
   * `requiresIndex`, the same way `freshnessModes` refines a tool's freshness
   * surface.
   *
   * The tool-level boolean was the whole story, and for bb_edit it was a
   * refusal with no work behind it: the MCP server blocked EVERY bb_edit call
   * on a project with no index (`src/mcp/server.ts`), including `write` — which
   * resolves no symbol, plans from the request and the disk, and reindexes the
   * file it wrote. So an agent could not create the first file of a new project
   * with the tool that exists to create files; measured, all five modes came
   * back "No index found" and the engine below them would have answered four of
   * them correctly.
   *
   * A mode listed here is exempt from the server's index gate. A mode NOT listed
   * is refused with the reindex remediation when the project has no index, and
   * the refusal names which modes are still available — a caller blocked from
   * `update` should learn that `write` works, not just that it cannot proceed.
   *
   * Deliberately narrow: the requirement is relaxed only where the code path
   * provably never reads the index. Enforced like every other per-mode field —
   * `validateToolDescriptors` rejects duplicates, modes that are not executable,
   * and the declaration on a tool that does not require an index at all.
   */
  indexFreeModes?: readonly string[]
  aliases: readonly string[]
  deprecated: boolean
  replacement?: {
    tool: string
    mode?: string
  }
  documentation: ToolDocumentation
}
