// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the versioned `bb/impact` LSP transport: validates the
//   request, resolves the symbol SERVER-SIDE through the canonical calculator,
//   and carries the `ImpactResult` to the client without owning any rendering.
// WHICH TOOL IT SERVES — the editor twin of bb_impact (mutability read,
//   requiresIndex true, modes: impact). The MCP tool and this wire call the same
//   `computeImpact`, so both doors answer the same question identically.
// WHY IT IS SHAPED THIS WAY — the wire contract is the client's machine
//   interface, so every failure mode is a declared `bb/impact:`-prefixed error:
//   a version mismatch is rejected loudly, an unindexed workspace is a named
//   error, and an unknown/ambiguous symbol is never an empty set that would
//   render as "no impact". Rendering lives in the ONE renderer core
//   (`graph-core.renderImpact`); this module only carries data.
// WHERE ITS EVIDENCE LIVES — validation/m44/** (resolution over the real
//   server), validation/m26/** (impact mode), validation/tools/bb_impact/**;
//   gates: script/m44/verify-impact-resolution.ts, script/m26/verify-impact-mode.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/lsp/impact.ts (the calculator and
//   IMPACT_BUDGET), src/lsp/server.ts (the registration), docs/GRAPH_ENGINE.md.
// CONTRACTS IT MUST NOT BREAK — schema version pinning, the `bb/impact:` error
//   prefix, server-side symbol resolution, declared errors instead of empty
//   sets, and read-only operation.
// ─────────────────────────────────────────────────────────────────────────────

import { computeImpact, IMPACT_BUDGET, type ImpactResult } from "./impact"
import type { CoreDatabase } from "../brain/database"

export const IMPACT_REQUEST_METHOD = "bb/impact"
export const IMPACT_SCHEMA_VERSION = 1

/** Declared impact-request failure. The `bb/impact:` prefix is the machine
 *  contract: clients match on it to distinguish declared errors from bugs. */
export class ImpactRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImpactRequestError"
  }
}

export interface ImpactRequestParams {
  schemaVersion?: unknown
  symbol?: unknown
  /** The hover's defining-file identity. Same-name members (every real repo's
   *  constructors) resolve through it; optional — a bare unique name works
   *  exactly as before. */
  file?: unknown
}

export interface ImpactRequestDeps {
  /** Impact computation (injection seam for the mutation suite). */
  compute: typeof computeImpact
}

/** The declared budget the client may rely on (mirrors the calculator; the
 *  single source stays in impact.ts — this is the wire-level copy for
 *  capability docs). */
export const IMPACT_REQUEST_BUDGET = IMPACT_BUDGET

/** Validate params and compute the impact set. Every failure mode is a
 *  thrown ImpactRequestError with the `bb/impact:` prefix — loud, declared,
 *  machine-parseable; a client can render the reason verbatim. */
export async function handleImpactRequest(
  db: CoreDatabase | null,
  projectId: string,
  params: ImpactRequestParams | null | undefined,
  deps: ImpactRequestDeps = { compute: computeImpact },
): Promise<ImpactResult> {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new ImpactRequestError("bb/impact: params must be an object carrying schemaVersion and symbol")
  }
  if (params.schemaVersion !== IMPACT_SCHEMA_VERSION) {
    throw new ImpactRequestError(
      `bb/impact: schema version mismatch — request carries ${JSON.stringify(params.schemaVersion) ?? "nothing"}, server implements ${IMPACT_SCHEMA_VERSION} (upgrade the client)` +
        ` or pin bbLsp.impactSchemaVersion)`,
    )
  }
  if (typeof params.symbol !== "string" || params.symbol.length === 0) {
    throw new ImpactRequestError("bb/impact: params.symbol (non-empty string) is required")
  }

  // null db = the index could not be opened at all: the same declared
  // not-indexed error, never an internal crash.
  if (db === null) {
    throw new ImpactRequestError(
      "bb/impact: workspace is not indexed — run `bb index` first (declared error: an unindexed workspace has no impact to serve)",
    )
  }

  // Symbol resolution is SERVER-SIDE (project-scoped, name → stored symbol).
  // computeImpact throws a declared error when the root cannot be resolved —
  // an unknown symbol has no impact set, and an empty set would lie.
  // The hover's file identity (optional) disambiguates same-name members.
  try {
    return await deps.compute(
      db as Parameters<typeof computeImpact>[0],
      projectId,
      params.symbol,
      {},
      typeof params.file === "string" && params.file.length > 0 ? params.file : undefined,
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("bb/impact:")) throw error
    // Wrap computeImpact's own declared errors with the wire prefix so the
    // client's machine contract holds regardless of which layer fired.
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("not found") || message.includes("unknown symbol") || message.includes("cannot be resolved")) {
      throw new ImpactRequestError(
        `bb/impact: symbol "${params.symbol}" is not in the index — hover a symbol that was indexed (re-run \`bb index\` if it should be)`,
      )
    }
    throw new ImpactRequestError(`bb/impact: ${message}`)
  }
}
