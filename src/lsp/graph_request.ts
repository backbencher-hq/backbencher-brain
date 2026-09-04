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

export const GRAPH_REQUEST_METHOD = "bb/graph"
export const GRAPH_SCHEMA_VERSION = 1

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
): Promise<GraphTraversalResult> {
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
  if (params.direction !== undefined && (params.direction !== "callers" && params.direction !== "callees" && params.direction !== "both")) {
    throw new GraphRequestError('bb/graph: params.direction must be "callers", "callees", or "both"')
  }
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
    direction: params.direction as "callers" | "callees" | "both" | undefined,
    maxDepth: params.maxDepth as number | undefined,
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
  return result
}
