// ─────────────────────────────────────────────────────────────────────────────
// Embedding SPACE lifecycle — the read-side answer to "the configured model
// space is nearly empty, which space should a query be compared in?".
//
// Defect this module exists for (triage ISSUE-09 / PLAN P2-3): after a provider
// change, an index can hold thousands of vectors from the PREVIOUS space (or
// from the local word-vector fallback) and almost none from the CONFIGURED
// model. `semanticVectorSearch` used to embed the query with the configured
// provider and then hard-filter stored rows to that model, so it compared
// against a near-empty space and printed a keyword fallback that never named
// the populated space it could have used. The index recorded the degradation
// only as row labels; no surface said "backfill pending".
//
// This module is PURE except for two read-only DB readers, so the decision can
// be gated with fixture numbers and cannot mutate an index (a read tool must
// not write — see semantic-search.ts).
//
// Rules:
//  · NEVER compare across vector spaces. A fallback is a DECLARED choice of a
//    DIFFERENT space whose query vector is produced by that space's own model.
//  · The configured space wins whenever it clears MIN_CONFIGURED_SPACE_COVERAGE.
//  · Below that floor the read path may fall back to the most populated dense
//    space (which must be one the query can be embedded into — in practice the
//    local word-vector model), and must THEN declare it.
//  · If no dense space is populated, there is no vector answer: declare the
//    pending backfill instead of presenting lexical matches as semantic.
//  · `tfidf-v1` rows are sparse token lists, not dense vectors: never a
//    fallback candidate and never counted as dense coverage.
// ─────────────────────────────────────────────────────────────────────────────

/** Sparse/incompatible model labels that must never be fed to dense cosine. */
const NON_DENSE_MODELS = new Set(["tfidf-v1"])

/**
 * The configured model space must cover at least this share of symbols before a
 * vector answer is allowed to be presented as "the configured space". Below it
 * the read path declares a fallback (and the health surface declares a pending
 * backfill). 5% is the plan-level floor: a project with <5% configured-space
 * coverage can never return an undeclared keyword answer.
 */
export const MIN_CONFIGURED_SPACE_COVERAGE = 0.05

/** One stored vector space, aggregated by `embedding_model`. */
export interface EmbeddingSpaceRow {
  model: string
  dimension: number
  /** Distinct symbols holding a vector in this space. */
  entities: number
}

export interface EmbeddingSpacePlanInput {
  /** Model selected by the effective embedding config, or null when unconfigured. */
  configuredModel: string | null
  /** Canonical label of the offline model the read path can always embed with. */
  localModel: string
  /** Indexable symbols in the project (the coverage denominator). */
  symbolCount: number
  /** Stored spaces, most populated first (the reader's SQL order is preserved). */
  spaces: EmbeddingSpaceRow[]
  minConfiguredCoverage?: number
}

export interface EmbeddingSpacePlan {
  configuredModel: string | null
  configuredSpace: EmbeddingSpaceRow | null
  configuredCoverage: number
  symbolCount: number
  spaces: EmbeddingSpaceRow[]
  /** Most populated dense space (does not exclude the configured one). */
  mostPopulated: EmbeddingSpaceRow | null
  /**
   * The model whose space a query in this project should be compared in:
   * the configured model when it is covered, else the populated local space,
   * else null (no dense answer possible).
   */
  compareModel: string | null
  /** True when compareModel is a DIFFERENT space than the configured one. */
  fallbackDeclared: boolean
  /** Machine-readable reason for the declared fallback. */
  fallbackReason: string | null
  /** The configured space is under-covered and wants a backfill run. */
  pendingBackfill: boolean
  /** Human sentence naming the pending state (for provenance/health). */
  pendingDetail: string | null
}

function denseSpaces(spaces: EmbeddingSpaceRow[]): EmbeddingSpaceRow[] {
  return spaces
    .filter((space) => !NON_DENSE_MODELS.has(space.model) && space.entities > 0)
    .slice()
    .sort((a, b) => (b.entities !== a.entities ? b.entities - a.entities : a.model < b.model ? -1 : a.model > b.model ? 1 : b.dimension - a.dimension))
}

/**
 * Resolve which vector space the read path should compare in.
 *
 * Pure: same inputs → same plan. The caller owns obtaining the numbers (from a
 * read-only DB handle) and performing the declared fallback embedding.
 */
export function planEmbeddingSpaces(input: EmbeddingSpacePlanInput): EmbeddingSpacePlan {
  const minCoverage = input.minConfiguredCoverage ?? MIN_CONFIGURED_SPACE_COVERAGE
  const symbolCount = Math.max(0, Math.floor(input.symbolCount))
  const dense = denseSpaces(input.spaces)
  const configuredSpace =
    input.configuredModel !== null
      ? dense.find((space) => space.model === input.configuredModel) ?? null
      : null
  const configuredEntities = configuredSpace?.entities ?? 0
  const configuredCoverage = symbolCount > 0 ? configuredEntities / symbolCount : 0
  const mostPopulated = dense[0] ?? null
  const localSpace = dense.find((space) => space.model === input.localModel) ?? null
  const localCoverage = localSpace && symbolCount > 0 ? localSpace.entities / symbolCount : 0
  // TWO QUESTIONS, TWO ANSWERS — they were one boolean and that is why doctor and
  // health disagreed. Measured on 0.1.8: configured coverage was 20.7% with 44,250
  // symbols still missing, and health reported NO pending backfill because 20.7%
  // clears the 5% floor — while doctor promised its reader that "bb health reports
  // BACKFILL PENDING until complete". The floor answers "may a vector answer be
  // presented as the configured space?", NOT "is the backfill finished?".
  //
  //   configuredSpaceUsable  -> read path: is the configured space dense enough to
  //                             compare in, or must a fallback be declared?
  //   pendingBackfill        -> honesty: are there symbols WITHOUT the configured
  //                             model that a reconcile pass would still fill?
  const pendingBackfill = input.configuredModel !== null && symbolCount > 0 && configuredEntities < symbolCount
  const configuredSpaceUsable = input.configuredModel !== null && symbolCount > 0 && configuredCoverage >= minCoverage

  let compareModel: string | null
  if (input.configuredModel === null) {
    // No remote provider configured: the engine embeds locally and the local
    // space is the configured one in practice. No fallback is declared.
    compareModel = mostPopulated?.model ?? null
  } else if (configuredSpaceUsable) {
    compareModel = input.configuredModel
  } else {
    // The configured space is under-covered. Fall back ONLY to a space this
    // process can produce a query vector for: the local model. Any other stored
    // remote space is not embeddable without its own provider, so it is named in
    // the pending detail but never silently compared.
    compareModel = localSpace && localCoverage >= minCoverage ? input.localModel : null
  }

  const fallbackDeclared =
    compareModel !== null && input.configuredModel !== null && compareModel !== input.configuredModel
  const fallbackReason = fallbackDeclared
    ? "configured-model-space-under-covered"
    : !configuredSpaceUsable && compareModel === null
      ? "configured-model-space-under-covered"
      : null

  const configuredLabel = input.configuredModel ?? "none"
  const pct = symbolCount > 0 ? Math.round((configuredCoverage * 1000) / 10) : 0
  const pendingDetail = pendingBackfill
    ? `Configured embedding space ${configuredLabel} covers ${configuredEntities}/${symbolCount} symbols (${pct}%) — backfill pending. ` +
      `Stored spaces: ${input.spaces.map((space) => `${space.model}:${space.entities}`).join(", ") || "none"}.`
    : null

  return {
    configuredModel: input.configuredModel,
    configuredSpace,
    configuredCoverage,
    symbolCount,
    spaces: input.spaces,
    mostPopulated,
    compareModel,
    fallbackDeclared,
    fallbackReason,
    pendingBackfill,
    pendingDetail,
  }
}

/**
 * Read the stored vector spaces through a READ-ONLY handle.
 *
 * A model can theoretically hold rows at more than one dimension (a corrupt
 * mixed index); the dominant (most-populated) width is reported so coverage is
 * described by the space a reader can actually use, and the raw rows remain
 * visible through `spaces` when a caller wants to count them separately.
 */
export function readEmbeddingSpaces(raw: any, projectId: string): EmbeddingSpaceRow[] {
  try {
    const rows = raw
      .prepare(
        "SELECT embedding_model AS model, vector_dimension AS dimension, COUNT(DISTINCT entity_id) AS entities " +
          "FROM brain_semantic_embedding WHERE project_id = ? GROUP BY embedding_model, vector_dimension",
      )
      .all(projectId) as Array<{ model: string; dimension: number; entities: number }>
    const byModel = new Map<string, EmbeddingSpaceRow>()
    for (const row of rows) {
      const model = String(row.model ?? "")
      if (!model) continue
      const candidate: EmbeddingSpaceRow = {
        model,
        dimension: Number(row.dimension ?? 0),
        entities: Number(row.entities ?? 0),
      }
      const existing = byModel.get(model)
      if (!existing || candidate.entities > existing.entities) byModel.set(model, candidate)
    }
    return [...byModel.values()].sort((a, b) => (b.entities !== a.entities ? b.entities - a.entities : a.model < b.model ? -1 : 1))
  } catch {
    return []
  }
}

/**
 * The model the effective embedding config selects, or null when no remote
 * provider is configured. Imported lazily so this module stays side-effect free
 * when only the pure planner is used.
 */
export async function resolveConfiguredEmbeddingModel(): Promise<string | null> {
  try {
    const { getEmbeddingConfig } = await import("./openai-embed")
    const cfg = await getEmbeddingConfig()
    return cfg?.model ?? null
  } catch {
    return null
  }
}
