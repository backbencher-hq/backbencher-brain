// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the declared, versioned graph transport: the `bb/graph`
// request contract (method, version, params, validation, the graph and grouped
// `usages` responses) over the one traversal engine, in both directions.
// WHICH TOOL IT SERVES — the editor graph panel, hover and the hub, i.e. the
// LSP twin of the bb_graph agent tool.
// WHERE ITS EVIDENCE LIVES — docs/m26/GRAPH-TRANSPORT.md, docs/m44, docs/GRAPH_ENGINE.md,
// docs/m28/MCP-SURFACE.md; gates npx tsx script/m28/verify-union.ts,
// npx tsx script/m28/verify-surface-parity.ts, script/m55/verify-live-surface.ts,
// script/m44/verify-usages-groups.ts.
// EDIT TOGETHER WHEN THIS CHANGES — src/lsp/graph_usages.ts (the grouping core),
// src/intelligence/graph/graph-engine.ts (the engine), src/lsp/identity.ts (the
// root resolver this door uses), src/mcp/tools/bb_graph/ (the agent door).
// CONTRACTS IT MUST NOT BREAK — a version mismatch is a loud declared error; every
// edge carries its stored rowId; a workspace without an index is a declared
// error, never an empty graph; failures reach the client with the `bb/graph:`
// prefix; the agent door and this door answer the same stored rows.
// ─────────────────────────────────────────────────────────────────────────────
//
// This component is the SINGLE owner of the graph request contract:
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
// The graph door reads the ONE identity resolver directly (the same
// module the impact door re-exports from) — one decision, one owner.
import { resolveMemberIdentity, memberFileMatches, IDENTITY_TRAVERSABLE_TYPES } from "./identity"
import type { GraphTraversalResult } from "../intelligence/contracts"
import { buildGroupedUsages, classifyFileLevel, type GroupedUsages } from "./graph_usages"
import { memberResolutionRecord } from "./identity"

export const GRAPH_REQUEST_METHOD = "bb/graph"
// The usages-mode RESPONSE is grouped per symbol
// (docs/m44/…). A v1 client would silently mis-render that payload, so the
// wire schema is bumped and old clients get the loud mismatch error — never
// a silent break. graph mode's payload is unchanged but shares the constant.
export const GRAPH_SCHEMA_VERSION = 2
// The hub's declared query profile. `mode: "usages"`
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
  /** "graph" (default) | "usages" (the hub's declared profile). */
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
    // The hover's server-resolved identity beats the engine's gravity pick —
    // the SAME post-traverse gate as bb/impact (the engine resolves member
    // names directly, which silently bypasses the owning-declaration fallback). A
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
      // A genuinely absent symbol is
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
    // Declare the resolution in the payload (the record's shape is owned by
    // the identity resolver).
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
  // The root's annotations ride along, author-labeled — the
  // human sees the agent's notes where the graph renders. Read from the same
  // store bb_annotations serves; empty array = no badge rendered.
  //
  // Scoped to the ROOT SYMBOL's own file plus name-level notes, the same rule
  // the hover applies: the index holds one symbol per (file, name, line), so
  // selecting on the name alone attached one file's note to every same-named
  // node in the graph. Both path spellings match, because the index stores the
  // relative path while an agent may have annotated with an absolute one.
  try {
    const root = result.root as { id?: string; name?: string; file?: string; filePath?: string } | null | undefined
    // The name predicate matches name OR qualified name — the same predicate the
    // hover uses and annotationReachability() measures, so a note written under a
    // qualified name is not stored-and-invisible here either. The graph node
    // carries `name` but not the qualified name, so it is read from the indexed
    // symbol row by the node's id — the same value the hover already holds.
    const rootQualified = (root?.id
      ? (db.prepare("SELECT qualified_name FROM brain_symbol WHERE id = ?").get(root.id) as { qualified_name: string | null } | undefined)?.qualified_name ?? null
      : null)
    const annRows = db.prepare(
      "SELECT author_class, tool_identity, body, time_updated FROM brain_annotation WHERE project_id = ? AND (symbol_name = ? OR symbol_name = ?) AND (symbol_path IS NULL OR symbol_path = ? OR symbol_path = ?) ORDER BY time_updated DESC, id",
    ).all(projectId, root?.name ?? "", rootQualified, root?.file ?? "", root?.filePath ?? "") as Array<{ author_class: string; tool_identity: string; body: string; time_updated: number }>
    ;(result as { annotations?: typeof annRows }).annotations = annRows
  } catch {
    ;(result as { annotations?: never[] }).annotations = []
  }

  // Usages mode serves the GROUPED shape. File-level
  // imports/exports rows (NULL source symbol, targeting the root) are read
  // directly and land in the declared file-level sections — the traversal's
  // symbol JOIN cannot carry them (no symbol endpoint), and dropping them
  // would hide how the module reaches the codebase.
  if (params.mode === GRAPH_MODE_USAGES) {
    const rootNode = (result as GraphTraversalResult).root
    // PART_OF IS A DEPENDENCY KIND AND THIS READER MUST SEE IT (2026-10-22, cpp lane).
    //
    // The cpp lane's R3 emission moves a QUOTED `#include "x.h"` from `imports` to `part_of`
    // (src/ast/types.ts:148-160 — a part shares the library's single scope, imports nothing, and
    // cannot be resolved as a separate module; an ANGLE include names another module's header and
    // stays `imports`). MEASURED before the emission: 51,874 include sites over the admitted
    // population = 39,665 QUOTED + 12,209 angle-bracket
    // (script/m14/cpp-four-types-census.ts, validation/m14/measurements/cpp-four-types-census.json).
    //
    // WITHOUT THIS CLAUSE, MOVING THOSE ROWS WOULD DROP THEM OUT OF THE ONE SURFACE THAT ANSWERS
    // "WHAT DOES THIS TRANSLATION UNIT DEPEND ON". A KIND THAT IS DISTINCT IN THE VOCABULARY IS NOT A
    // KIND THE READERS MAY IGNORE; the reader list is the SECOND place the vocabulary lives, and a
    // vocabulary extended in one place and not the other is the same two-copy defect the shape-agreement
    // scanner was built to find.
    const fileLevelRaw = db
      .prepare(
        "SELECT id AS rowId, relationship_type AS relationshipType, target_external AS moduleSpecifier, confidence " +
          "FROM brain_relationship WHERE project_id = ? AND source_symbol_id IS NULL AND target_symbol_id = ? " +
          "AND relationship_type IN ('imports', 'exports', 'part_of')",
      )
      .all(projectId, rootNode.id) as Array<{ rowId: string; relationshipType: string; moduleSpecifier: string | null; confidence: number }>
    const fileLevel = classifyFileLevel(fileLevelRaw)
    // The SAME section, read outward. The query
    // above answers "what imports this symbol" (rows targeting the root). A
    // file-level dependency — `#include "util.h"`, emitted by c as the
    // first-class `imports` kind and stored with the importing file in
    // source_external — has no symbol endpoint on EITHER side, so no symbol
    // JOIN and no root target can ever reach it: c's include list was
    // unanswerable in this surface no matter how the edge was typed. Read it
    // by IMPORTER instead: rows whose source is this file, whose type is the
    // first-class `imports` kind, and whose target is external (a specifier,
    // not a symbol). Exact path match on source_external — no basename
    // guessing, so a language whose imports rows name a module leaf is
    // untouched, and a row that cannot name its importer is NOT returned
    // here (it stays a declared external row).
    //
    // JAVASCRIPT IS NO LONGER ONE OF THOSE LANGUAGES, and the clause that said
    // so is corrected here rather than left to read as coverage it does not
    // have. Until the file-level wave `real-javascript-analyzer.ts` spelled a
    // module-scope actor with the module basename, so its rows could only match
    // a path by accident; they now carry the family sentinel `(file)` plus
    // `metadata.fileLevel`, the store rewrites `source_external` to the
    // project-relative path, and this query returns them — measured on the
    // pinned JS draw: 3 rows for `benchmarking/analyze-compiler-profile.js`
    // (`node:fs:fs`, `node:path:path`, `node:url:fileURLToPath`), 2 for
    // `clean_effects.bench.js`, and 924 `imports` rows addressable by path across
    // the 250-file sample. Typescript still names a module leaf.
    const fileDepsRaw = db
      .prepare(
        "SELECT id AS rowId, relationship_type AS relationshipType, target_external AS moduleSpecifier, confidence " +
          "FROM brain_relationship WHERE project_id = ? AND relationship_type IN ('imports', 'part_of') AND source_symbol_id IS NULL " +
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
