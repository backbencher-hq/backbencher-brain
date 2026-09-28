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
// M55.T1: the graph door reads the ONE identity resolver directly (the same
// module the impact door re-exports from) — one decision, one owner.
import { resolveMemberIdentity, memberFileMatches, IDENTITY_TRAVERSABLE_TYPES } from "./identity"
import type { GraphTraversalResult } from "../intelligence/contracts"
import { buildGroupedUsages, classifyFileLevel, type GroupedUsages } from "./graph_usages"
import { memberResolutionRecord } from "./identity"

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
  /** X1 closure: the hover's defining-file identity. Same-name members
   *  (every real repo's constructors) resolve through it; optional — a bare
   *  unique name works exactly as before. */
  file?: unknown
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
  /** Member resolution (injection seam; defaults to the ONE identity
   *  resolver, src/lsp/identity.ts). */
  resolveMember?: typeof resolveMemberIdentity
}

/** X1 closure: ONE member-fallback decision for BOTH doors. A member name
 *  the engine whitelist excludes (constructor, plain member) roots through
 *  its OWNING declaration — same rules as bb/impact (impact.ts owns the
 *  decision; this is the shared call), with the hover's file hint
 *  disambiguating same-name members. A genuinely unknown symbol still
 *  throws the engine's declared error. */
async function resolveTraversalRoot(
  deps: GraphRequestDeps,
  db: GraphRequestDb,
  projectId: string,
  params: GraphRequestParams,
): Promise<ReturnType<typeof graphTraversal>> {
  const file = typeof params.file === "string" && params.file.length > 0 ? params.file : undefined
  const opts = () => ({
    direction: (params.direction as "callers" | "callees" | "both" | undefined) ?? (params.mode === GRAPH_MODE_USAGES ? "both" : undefined),
    maxDepth: params.maxDepth as number | undefined,
    relationshipTypes: params.relationshipTypes as string[] | undefined,
    includeCrossLanguage: params.includeCrossLanguage as boolean | undefined,
  })
  try {
    const r = await deps.traverse(projectId, params.symbol as string, opts())
    // M53: the hover's server-resolved identity beats the engine's gravity
    // pick — the SAME post-traverse gate as bb/impact (M48.C1 made the engine
    // resolve member names directly, silently bypassing the U5 fallback). A
    // non-traversable root re-resolves through its owning declaration; a
    // hinted request whose root lands outside the hint is a silent relabel
    // and is refused (declared error, never a guessed root).
    const rootType = (r.root as unknown as { symbolType?: string } | undefined)?.symbolType ?? ""
    if (rootType && !IDENTITY_TRAVERSABLE_TYPES.includes(rootType)) {
      const owner = (deps.resolveMember ?? resolveMemberIdentity)(db, projectId, params.symbol as string, file)
      if (owner === null) {
        throw new GraphRequestError(
          `bb/graph: symbol '${params.symbol}' is not a traversable root (${rootType}) — no graph exists for it (declared error: the symbol was not found as a traversable root)`,
        )
      }
      const rr = await deps.traverse(projectId, owner.name, opts())
      ;(rr as { resolution?: unknown }).resolution = memberResolutionRecord(params.symbol as string, owner.name, file)
      return rr
    }
    if (file && typeof r.root?.file === "string" && r.root.file !== "" && !memberFileMatches(file, r.root.file)) {
      throw new GraphRequestError(
        `bb/graph: symbol '${params.symbol}' resolves to a member in '${r.root.file}' but the hover's identity is '${file}' — the hinted symbol was not found at that identity; refusing the silent relabel (declared error)`,
      )
    }
    return r
  } catch (error) {
    const owner = (deps.resolveMember ?? resolveMemberIdentity)(db, projectId, params.symbol as string, file)
    if (owner === null) {
      // M55.T1 (Truth Rule 2, declared-error half): a genuinely absent symbol is
      // THIS door's declared error, in this door's language. The engine's
      // "Symbol '<name>' not found" used to escape verbatim, which contradicted
      // the transport doc's own prefix contract ("every failure throws with the
      // `bb/graph:` prefix") — clients that match the prefix to tell a declared
      // error from a bug could not classify it. Only the not-found shape is
      // wrapped: any other engine failure is still thrown untouched, because
      // prefixing a real bug would mislabel it as expected behaviour.
      const detail = error instanceof Error ? error.message : String(error)
      if (/^Symbol '.+' not found$/.test(detail)) {
        throw new GraphRequestError(
          `bb/graph: symbol '${params.symbol}' not found — no graph exists (declared error; run \`bb index\` or check the name)`,
        )
      }
      throw error
    }
    const r = await deps.traverse(projectId, owner.name, opts())
    // Declare the resolution in the payload (M55.T1 Truth Rule 2; the
    // record's shape is owned by the identity resolver).
    ;(r as { resolution?: unknown }).resolution = memberResolutionRecord(params.symbol as string, owner.name, file)
    return r
  }
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

  const result = await resolveTraversalRoot(deps, db, projectId, params)

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
    const grouped = buildGroupedUsages(result as GraphTraversalResult, { ...fileLevel, dependencies })
    // X1 closure: carry the declared member resolution into the grouped
    // shape too (the resolver stamped it on the traversal result) — the hub
    // states what it rooted at, same rule as impact and the raw graph shape.
    const res = (result as { resolution?: unknown }).resolution
    if (res !== undefined) (grouped as { resolution?: unknown }).resolution = res
    return grouped
  }
  return result
}
