import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type { ProjectStats } from "../contracts"
import { makeProvenance } from "../evidence"

type AggregateRow = {
  files: number | null
  linesOfCode: number | null
  avgFileSize: number | null
  symbols: number | null
  avgComplexity: number | null
  relationships: number | null
  testFiles: number | null
  productionFiles: number | null
  symbolsWithComplexity: number | null
  callEdges: number | null
}

type LanguageRow = { language: string; files: number; linesOfCode: number; symbols: number }

const ENGINE = "project-stats@intelligence"
const ENGINE_VERSION = "m10.05"

/** The relationship types that represent a dependency between two program
 *  elements. `exports` and `contains` are index bookkeeping, not dependency
 *  edges, and counting them inflated the coupling figure by 1.20x on
 *  backbencher-brain/src and 1.29x on commander. Declared here so the two
 *  numbers in this report can never be confused for one another again. */
export const COUPLING_RELATIONSHIP_TYPES = ["calls", "instantiates", "references", "uses", "imports", "extends", "implements"] as const

/** A file with no recorded language is reported as "unknown" rather than
 *  dropped: an unclassified file is a fact about the project, and hiding it
 *  makes the breakdown look complete when it is not. */
const UNKNOWN = "unknown"

export async function getProjectStats(projectId: ProjectID): Promise<ProjectStats> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const placeholders = COUPLING_RELATIONSHIP_TYPES.map(() => "?").join(",")
  const row = raw
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM brain_file WHERE project_id = ?) AS files,
      (SELECT COALESCE(SUM(line_count), 0) FROM brain_file WHERE project_id = ?) AS linesOfCode,
      (SELECT COALESCE(AVG(size_bytes), 0) FROM brain_file WHERE project_id = ?) AS avgFileSize,
      (SELECT COUNT(*) FROM brain_symbol WHERE project_id = ?) AS symbols,
      (SELECT COALESCE(AVG(complexity), 0) FROM brain_symbol WHERE project_id = ?) AS avgComplexity,
      (SELECT COUNT(*) FROM brain_relationship WHERE project_id = ?) AS relationships,
      (SELECT COUNT(*) FROM brain_file WHERE project_id = ? AND COALESCE(is_test_file,0) = 1) AS testFiles,
      (SELECT COUNT(*) FROM brain_file WHERE project_id = ? AND COALESCE(is_test_file,0) = 0) AS productionFiles,
      (SELECT COUNT(*) FROM brain_symbol WHERE project_id = ? AND complexity IS NOT NULL) AS symbolsWithComplexity,
      (SELECT COUNT(*) FROM brain_relationship WHERE project_id = ? AND relationship_type IN (${placeholders})) AS callEdges
  `,
    )
    .get(projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId, projectId, ...COUPLING_RELATIONSHIP_TYPES) as AggregateRow

  // A per-language breakdown, because "what is this project written in?" is
  // the first question asked of a code index over a polyglot repository, and
  // the answer used to be unrepresentable — bb_analyze mode=stats on a
  // six-language corpus had no field for it. One grouped query, not N+1.
  const languages = (
    raw
      .prepare(
        `SELECT COALESCE(NULLIF(LOWER(f.language), ''), '${UNKNOWN}') AS language,
                COUNT(DISTINCT f.id) AS files,
                COALESCE(SUM(f.line_count), 0) AS linesOfCode,
                COUNT(s.id) AS symbols
         FROM brain_file f
         LEFT JOIN brain_symbol s ON s.file_id = f.id AND s.project_id = f.project_id
         WHERE f.project_id = ?
         GROUP BY language
         ORDER BY files DESC, language ASC`,
      )
      .all(projectId) as LanguageRow[]
  ).map((l) => ({ ...l, files: Number(l.files), linesOfCode: Number(l.linesOfCode), symbols: Number(l.symbols) }))

  return {
    files: Number(row.files ?? 0),
    linesOfCode: Number(row.linesOfCode ?? 0),
    avgFileSize: Number(row.avgFileSize ?? 0),
    // The unit the column is measured in. `size_bytes` is bytes; the field was
    // published as a bare "avgFileSize" with no unit anywhere in the payload.
    avgFileSizeUnit: "bytes",
    symbols: Number(row.symbols ?? 0),
    // How many symbols actually carry a complexity measurement. `avgComplexity`
    // is a SQLite AVG, which SKIPS nulls — so its denominator is this number,
    // not `symbols`, and the two differ the moment any symbol is unmeasured.
    symbolsWithComplexity: Number(row.symbolsWithComplexity ?? 0),
    avgComplexity: Number(row.avgComplexity ?? 0),
    relationships: Number(row.relationships ?? 0),
    callEdges: Number(row.callEdges ?? 0),
    couplingRelationshipTypes: [...COUPLING_RELATIONSHIP_TYPES],
    testFiles: Number(row.testFiles ?? 0),
    productionFiles: Number(row.productionFiles ?? 0),
    languages,
    projectId,
    provenance: makeProvenance({
      evidenceClass: "indexed",
      engine: ENGINE,
      engineVersion: ENGINE_VERSION,
      projectId,
      source: "brain_file+brain_symbol+brain_relationship",
      limitations: [
        "Aggregates are over indexed rows only; unindexed sources are not counted.",
        "linesOfCode sums brain_file.line_count, which is non-blank lines, not physical lines.",
        `avgComplexity is averaged over the ${Number(row.symbolsWithComplexity ?? 0)} symbols that carry a complexity measurement, not over all ${Number(row.symbols ?? 0)} symbols.`,
        "A test file is one brain_file.is_test_file=1, set by src/ast/test-classification.ts; a project whose tests are not recognisable counts as having none.",
      ],
    }),
  }
}
