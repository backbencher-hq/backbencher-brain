// src/lsp/graph_request.ts — M26.W2: the declared, versioned graph transport
// (issue #510).
//
// The webview needs server data; undeclared custom channels are how honesty
// dies (issue evidence). This component is the SINGLE owner of the graph
// request contract:
//
//   method:         `bb/graph` (bb/ namespace = declared custom surface,
//                   same convention as bb/staleness)
//   schema:         versioned; a mismatched version is rejected LOUDLY with
//                   a machine-parseable `bb/graph:` error prefix — never
//                   silently coerced, never served anyway
//   traceability:   every edge in a response carries the brain_relationship
//                   row id (`rowId`); the response is gated on this at the
//                   boundary — an edge without a row id fails the request
//                   instead of shipping untraceable data
//   workspace:      honored only for indexed workspaces; otherwise a
//                   DECLARED error (never an empty result that would render
//                   as "no connections")
//
// Handler throws are wrapped by the server into JSON-RPC error responses
// with the message text intact (server.ts), so `bb/graph:` errors reach the
// client verbatim and the extension can surface them as declared errors.
//
// Schema v1 (documented in docs/m26/GRAPH-TRANSPORT.md):
//   request:  { schemaVersion: 1, symbol: string,
//               direction?: "callers"|"callees"|"both", maxDepth?: number,
//               relationshipTypes?: string[], includeCrossLanguage?: boolean }
//   response: GraphTraversalResult (all edges carry rowId; metadata
//             evidenceClass passes through when stored)

import { graphTraversal } from "../intelligence/graph/graph-engine"
import type { GraphTraversalResult } from "../intelligence/contracts"
import { buildGroupedUsages, classifyFileLevel, type GroupedUsages } from "./graph_usages"

export const GRAPH_REQUEST_METHOD = "bb/graph"
// M44.U1 (issue #688): the usages-mode RESPONSE became grouped per symbol
// (docs/m44/…). A v1 client would silently mis-render that payload, so the
// wire schema is bumped and old clients get the loud mismatch error — never
// a silent break. graph mode's payload is unchanged but shares the constant.
export const GRAPH_SCHEMA_VERSION = 2
// M42.H5 (issue #653): the hub's declared query profile. `mode: "usages"`
// pins the hub's bounds server-side — direction both, depth capped at the
// W5 impact cap — so every fork asks for the same declared profile and the
// panel cannot silently drift to an unbounded query. (docs/m42/HUB.md)
export const GRAPH_MODE_GRAPH = "graph"
export const GRAPH_MODE_USAGES = "usages"
export const HUB_USAGES_MAX_DEPTH = 5

/** Declared graph-request failure. The `bb/graph:` prefix is the machine
 *  contract: clients match on it to distinguish declared errors from bugs. */
export class GraphRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GraphRequestError"
  }
}

export interface GraphRequestParams {
  schemaVersion?: unknown
  symbol?: unknown
  direction?: unknown
  maxDepth?: unknown
  relationshipTypes?: unknown
  includeCrossLanguage?: unknown
  /** M42.H5: "graph" (default) | "usages" (the hub's declared profile). */
  mode?: unknown
}

/** Minimal db surface this module needs (structural, so tests can stub). */
export interface GraphRequestDb {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] }
}

/** An indexed workspace is one with at least one symbol row for the project.
 *  Unreadable db degrades to not-indexed — a declared error beats a hang. */
export function isIndexedWorkspace(db: GraphRequestDb, projectId: string): boolean {
  try {
    const row = db.prepare("SELECT 1 AS ok FROM brain_symbol WHERE project_id = ? LIMIT 1").get(projectId)
    return row !== undefined && row !== null
  } catch {
    return false
  }
}

export interface GraphRequestDeps {
  /** Traversal engine (injection seam for the mutation suite). */
  traverse: typeof graphTraversal
}

/** Validate params, resolve the traversal, and gate the response on
 *  traceability. Every failure mode is a thrown GraphRequestError with the
 *  `bb/graph:` prefix — loud, declared, machine-parseable. */
export async function handleGraphRequest(
  db: GraphRequestDb | null,
  projectId: string,
  params: GraphRequestParams | null | undefined,
  deps: GraphRequestDeps = { traverse: graphTraversal },
): Promise<GraphTraversalResult | GroupedUsages> {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new GraphRequestError("bb/graph: params must be an object carrying schemaVersion and symbol")
  }
  if (params.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    throw new GraphRequestError(
      `bb/graph: schema version mismatch — request carries ${JSON.stringify(params.schemaVersion) ?? "nothing"}, server implements ${GRAPH_SCHEMA_VERSION} (upgrade the client or pin bbLsp.graphSchemaVersion)`,
    )
  }
  if (typeof params.symbol !== "string" || params.symbol.length === 0) {
    throw new GraphRequestError("bb/graph: params.symbol (non-empty string) is required")
  }
  if (params.mode !== undefined && params.mode !== GRAPH_MODE_GRAPH && params.mode !== GRAPH_MODE_USAGES) {
    throw new GraphRequestError('bb/graph: params.mode must be "graph" or "usages"')
  }
  if (params.direction !== undefined && (params.direction !== "callers" && params.direction !== "callees" && params.direction !== "both")) {
    throw new GraphRequestError('bb/graph: params.direction must be "callers", "callees", or "both"')
  }
  // Usages mode pins the hub profile: direction both (the full usage set)
  // unless the caller overrides, depth capped at the W5 impact cap. The cap
  // is enforced below, never trusted to the caller.
  const effectiveDirection = (params.direction as "callers" | "callees" | "both" | undefined) ?? (params.mode === GRAPH_MODE_USAGES ? "both" : undefined)
  const requestedDepth = params.maxDepth === undefined && params.mode === GRAPH_MODE_USAGES ? HUB_USAGES_MAX_DEPTH : (params.maxDepth as number | undefined)
  if (
    params.maxDepth !== undefined &&
    (typeof params.maxDepth !== "number" || !Number.isInteger(params.maxDepth) || params.maxDepth < 1 || params.maxDepth > 10)
  ) {
    throw new GraphRequestError("bb/graph: params.maxDepth must be an integer in [1, 10]")
  }
  if (params.relationshipTypes !== undefined) {
    if (!Array.isArray(params.relationshipTypes) || params.relationshipTypes.some((t) => typeof t !== "string" || t.length === 0)) {
      throw new GraphRequestError("bb/graph: params.relationshipTypes must be an array of non-empty strings")
    }
  }
  if (params.includeCrossLanguage !== undefined && typeof params.includeCrossLanguage !== "boolean") {
    throw new GraphRequestError("bb/graph: params.includeCrossLanguage must be a boolean")
  }

  // null db = the index could not be opened at all: the same declared
  // not-indexed error, never an internal crash.
  if (db === null || !isIndexedWorkspace(db, projectId)) {
    throw new GraphRequestError("bb/graph: workspace is not indexed — run `bb index` first (declared error: an unindexed workspace has no graph to serve)")
  }

  const result = await deps.traverse(projectId, params.symbol as string, {
    direction: effectiveDirection,
    maxDepth: requestedDepth,
    relationshipTypes: params.relationshipTypes as string[] | undefined,
    includeCrossLanguage: params.includeCrossLanguage as boolean | undefined,
  })

  // Response-side traceability gate: trust construction, then verify. An
  // edge without a stored row id must fail the request, never ship.
  for (const edge of [...(result.callers ?? []), ...(result.callees ?? [])]) {
    if (typeof edge.rowId !== "string" || edge.rowId.length === 0) {
      throw new GraphRequestError(`bb/graph: internal consistency failure — edge ${edge.from} -> ${edge.to} has no brain_relationship row id (refusing to serve untraceable data)`)
    }
  }
  // M28.A2 (D-6): the root's annotations ride along, author-labeled — the
  // human sees the agent's notes where the graph renders. Read from the same
  // store bb_annotations serves; empty array = no badge rendered.
  try {
    const annRows = db.prepare("SELECT author_class, tool_identity, body, time_updated FROM brain_annotation WHERE project_id = ? AND symbol_name = ? ORDER BY time_updated DESC").all(projectId, (result.root as { name?: string }).name ?? "") as Array<{ author_class: string; tool_identity: string; body: string; time_updated: number }>
    ;(result as { annotations?: typeof annRows }).annotations = annRows
  } catch {
    ;(result as { annotations?: never[] }).annotations = []
  }

  // M44.U1 (issue #688): usages mode serves the GROUPED shape. File-level
  // imports/exports rows (NULL source symbol, targeting the root) are read
  // directly and land in the declared file-level sections — the traversal's
  // symbol JOIN cannot carry them (no symbol endpoint), and dropping them
  // would hide how the module reaches the codebase (§13.5).
  if (params.mode === GRAPH_MODE_USAGES) {
    const rootNode = (result as GraphTraversalResult).root
    const fileLevelRaw = db
      .prepare(
        "SELECT id AS rowId, relationship_type AS relationshipType, target_external AS moduleSpecifier, confidence " +
          "FROM brain_relationship WHERE project_id = ? AND source_symbol_id IS NULL AND target_symbol_id = ? " +
          "AND relationship_type IN ('imports', 'exports')",
      )
      .all(projectId, rootNode.id) as Array<{ rowId: string; relationshipType: string; moduleSpecifier: string | null; confidence: number }>
    const fileLevel = classifyFileLevel(fileLevelRaw)
    // M60/#910 (second direction): the SAME section, read outward. The query
    // above answers "what imports this symbol" (rows targeting the root). A
    // file-level dependency — `#include "util.h"`, emitted by c as the
    // first-class `imports` kind and stored with the importing file in
    // source_external — has no symbol endpoint on EITHER side, so no symbol
    // JOIN and no root target can ever reach it: c's include list was
    // unanswerable in this surface no matter how the edge was typed. Read it
    // by IMPORTER instead: rows whose source is this file, whose type is the
    // first-class `imports` kind, and whose target is external (a specifier,
    // not a symbol). Exact path match on source_external — no basename
    // guessing, so a language whose imports rows name a module leaf (ts/js)
    // is untouched, and a row that cannot name its importer is NOT returned
    // here (it stays a declared external row).
    const fileDepsRaw = db
      .prepare(
        "SELECT id AS rowId, relationship_type AS relationshipType, target_external AS moduleSpecifier, confidence " +
          "FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports' AND source_symbol_id IS NULL " +
          "AND target_symbol_id IS NULL AND source_external = ?",
      )
      .all(projectId, rootNode.file) as Array<{ rowId: string; relationshipType: string; moduleSpecifier: string | null; confidence: number }>
    const dependencies = classifyFileLevel(fileDepsRaw).imports
    return buildGroupedUsages(result as GraphTraversalResult, { ...fileLevel, dependencies })
  }
  return result
}
