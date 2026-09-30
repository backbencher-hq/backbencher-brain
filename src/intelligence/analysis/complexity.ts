import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import { normalizeScopePath } from "./dependencies"
import type { ComplexityMetric, ComplexityReport } from "../contracts"
import { makeProvenance } from "../evidence"

type SymRow = {
  id: string
  name: string
  symbolType: string
  complexity: number
  line: number
  lineEnd: number
  file: string
  fileId: string
}

const ENGINE = "complexity@intelligence"
const ENGINE_VERSION = "m10.04"

const metric = (value: number | null): ComplexityMetric => ({ value, available: value !== null })

/** Escape %, _ and backslash so a caller-supplied path is a PATH. The graph
 *  engine's `likeContains()` and testing/test-intel's `likePrefix()` are the
 *  same rule in two other places; this is the third. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => "\\" + c)
}

/** The relationship types that are actually coupling. `exports` and `contains`
 *  are index bookkeeping; counting them inflated the reported number by 1.20x
 *  on bb's own src (37,929 vs 31,732) and 2.24x on a small corpus, and the same
 *  row count is also reported as stats.relationships — one number, two names,
 *  two implied meanings, in the same tool. */
export const COUPLING_RELATIONSHIP_TYPES = ["calls", "instantiates", "references", "uses", "imports", "extends", "implements"] as const

const couplingClause = (): string => "relationship_type IN (" + COUPLING_RELATIONSHIP_TYPES.map(() => "?").join(",") + ")"

/**
 * Maintainability index, and the case where it is NOT computable.
 *
 * The formula is `171 - 5.2·ln(avgComplexity+1) - 16.2·ln(loc+1)`, a
 * Halstead-free variant. It is calibrated for a single unit: the `16.2·ln(loc+1)`
 * term drives the result negative for any scope above roughly 3·10⁴ non-blank
 * lines. The old code clamped that to 0 and reported `available: true`, so
 * backbencher-brain/src (165,567 lines) answered `maintainability: 0` — the
 * clamp, presented as a measurement of a real project.
 *
 * So a negative RAW value means the formula does not apply to this scope, and
 * the honest answer is `available: false`. A raw value of exactly 0 is a
 * genuine result and is reported as one.
 */
function maintainabilityIndex(cyclomaticAvg: number | null, loc: number | null): number | null {
  if (cyclomaticAvg === null || loc === null || loc <= 0) return null
  const raw = 171 - 5.2 * Math.log(cyclomaticAvg + 1) - 16.2 * Math.log(loc + 1)
  if (raw < 0) return null
  return Math.round(raw * 100) / 100
}

// Scope-correct complexity. Unavailable metrics are marked available:false and
// value:null rather than fabricated. depthOfInheritance is always unavailable
// until real hierarchy analysis exists (previously hardcoded to 1).
export async function analyzeComplexity(
  projectId: ProjectID,
  options: { scope?: "project" | "file" | "class" | "function"; target?: string; threshold?: number } = {},
): Promise<ComplexityReport> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const scope = options.scope ?? "project"
  const target = options.target ?? "entire project"

  const base =
    "SELECT s.id, s.name, s.symbol_type AS symbolType, COALESCE(s.complexity,0) AS complexity, " +
    "COALESCE(s.line_start,0) AS line, COALESCE(s.line_end,0) AS lineEnd, " +
    "f.relative_path AS file, f.id AS fileId " +
    "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ?"

  // M50.A2 residual: project scope used to fetch EVERY joined symbol row
  // (168,629 rows on the repo's own index) just to average a column and keep
  // the 20 biggest — measured at 1,265ms of a 1,188–1,203ms call. The
  // aggregates are computable in SQL and the breakdown only ever needs 20 rows,
  // so the fetch is bounded instead of materialized. Output is unchanged by
  // construction (same COUNT/SUM/AVG integer math, same top-20), proven by
  // script/m50/probe-complexity-phases.ts on the real index.
  if (scope === "project") {
    const agg = raw
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(complexity,0)),0) AS total FROM brain_symbol WHERE project_id = ?")
      .get(projectId) as { n: number; total: number }
    const symbolCount = Number(agg.n)
    const totalCyclomatic = Number(agg.total)
    // Deterministic order: complexity desc, then name/id so ties cannot shuffle
    // between runs (the old JS sort inherited the query's unspecified row order).
    const topRows = raw
      .prepare(
        base +
          " ORDER BY COALESCE(s.complexity,0) DESC, s.name ASC, s.id ASC LIMIT 20",
      )
      .all(projectId) as SymRow[]
    const locRow = raw.prepare("SELECT COALESCE(SUM(line_count),0) AS lc, COUNT(*) AS fc FROM brain_file WHERE project_id = ?").get(projectId) as { lc: number; fc: number }
    const loc = Number(locRow.lc)
    const filesInScope = Number(locRow.fc)
    const couplingRow = raw
      .prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND " + couplingClause())
      .get(projectId, ...COUPLING_RELATIONSHIP_TYPES) as { c: number }
    const couplingEdges = Number(couplingRow.c)
    const cyclomaticAvg = symbolCount > 0 ? Math.round((totalCyclomatic / symbolCount) * 100) / 100 : null
    const maintainability = maintainabilityIndex(cyclomaticAvg, symbolCount > 0 ? loc : null)
    return {
      target,
      scope,
      metrics: {
        cyclomaticAvg: metric(cyclomaticAvg),
        cyclomaticTotal: metric(symbolCount > 0 ? totalCyclomatic : null),
        linesOfCode: metric(loc),
        couplingEdges: metric(couplingEdges),
        maintainability: metric(maintainability),
        depthOfInheritance: metric(null), // not computed yet — never fabricated
      },
      breakdown: topRows.map((s) => ({ name: s.name, type: s.symbolType, complexity: s.complexity, file: s.file, line: s.line })),
      symbolCount,
      filesInScope,
      // Project-wide: the two counts are the same question here.
      filesMatchingScope: filesInScope,
      couplingRelationshipTypes: [...COUPLING_RELATIONSHIP_TYPES],
      provenance: makeProvenance({ evidenceClass: "indexed", engine: ENGINE, engineVersion: ENGINE_VERSION, projectId, source: "brain_symbol+brain_file+brain_relationship", limitations: ["depthOfInheritance unavailable; cyclomatics use indexed heuristics not dynamic dispatch."] }),
    }
  }

  let symbols: SymRow[]
  // "exact-file" | "directory-prefix" for a file-shaped scope; undefined for a
  // symbol or project scope, where the question does not arise.
  let scopeMatch: ComplexityReport["scopeMatch"]
  if (scope === "function") {
    if (!options.target) throw new Error("Function name required for function scope")
    symbols = raw.prepare(base + " AND s.name = ? LIMIT 50").all(projectId, options.target) as SymRow[]
  } else if (scope === "class") {
    if (!options.target) throw new Error("Class name required for class scope")
    symbols = raw.prepare(base + " AND s.name = ? AND s.symbol_type = 'class' LIMIT 50").all(projectId, options.target) as SymRow[]
  } else if (scope === "file") {
    if (!options.target) throw new Error("File path required for file scope")
    const wanted = options.target.replace(/\/+$/, "")
    // 1. an exact relative path — what a caller means, and unambiguous even
    //    when the path contains % or _.
    symbols = raw.prepare(base + " AND f.relative_path = ?").all(projectId, wanted) as SymRow[]
    // Which of the two file-shaped scopes this is. `scope` alone says "file"
    // for both, which reads as ONE file: measured on the atlas corpus,
    // `target: "src/wide"` reported `scope: "file"` with `filesInScope: 68`. A
    // reader who trusts the label concludes the metrics describe one file, and
    // `maintainability` — a per-unit index — is then read as a file's score
    // when it is a directory's.
    scopeMatch = "exact-file"
    // No `includes("/")` guard here. There was one, and it made every
    // TOP-LEVEL directory an invalid scope: a directory prefix needs no slash,
    // so `"ast"` never reached this branch and was refused as "no indexed file
    // matches" — on backbencher-brain/src, where 84 of 184 files live under
    // `ast/`, while `ast/real-nim-analyzer.ts` answered fine. The guard cannot
    // have been protecting anything, because a bare name that is not a path
    // matches no directory either and falls through to the same refusal below.
    // Measured on that corpus: `target: "ast"`, `"intelligence"` and `"mcp"`
    // were all refused; each holds 60-84 indexed files.
    if (symbols.length === 0) {
      // 2. a directory prefix, anchored at a separator so "src/util" cannot
      //    match "src/utilities", and ESCAPED so a % or _ is a character.
      symbols = raw
        .prepare(base + " AND f.relative_path LIKE ? ESCAPE '\\'")
        .all(projectId, escapeLike(wanted) + "/%") as SymRow[]
      scopeMatch = "directory-prefix"
    }
    if (symbols.length === 0) {
      // 3. REFUSE. The old code answered with `%target%` matched anywhere, so
      //    target "e" scoped 190 of 198 symbols across 90 files and target
      //    "hub" — a FUNCTION name — silently became a file filter, both still
      //    reported as scope:"file". A target that names no file and no
      //    directory is a mistake, and the honest answer says so.
      throw new Error(
        `complexity: no indexed file matches "${options.target}" — pass a project-relative file path (e.g. src/core/engine.ts) or a directory prefix (e.g. src/core). ` +
          `A symbol NAME is not a scope for this mode; use bb_analyze mode=callers target="${options.target}" instead.`,
      )
    }
  } else {
    // Unreachable while the project branch above returns early; kept so an
    // unknown scope string still answers with the full project set rather than
    // silently returning nothing.
    symbols = raw.prepare(base).all(projectId) as SymRow[]
  }

  const symbolCount = symbols.length
  // Two different questions, and the report used to answer only one of them.
  //
  //   filesMatchingScope — how many indexed FILES the scope names
  //   filesInScope       — how many of those hold a SYMBOL the metrics are over
  //
  // They differ whenever a file in scope has no indexed symbol, and they
  // differed silently: on backbencher-brain/src, `target: "ast"` reported
  // `filesInScope: 83` while the scope holds 84 files, and `linesOfCode` — the
  // sum over the symbol-bearing files — was one file short of the scope with
  // nothing saying so. A reader checking the count against the store finds a
  // discrepancy they cannot explain, which is worse than a larger number.
  let filesMatchingScope = 0
  if (scope === "file" && options.target) {
    const clean = normalizeScopePath(options.target)
    const exact = raw.prepare(base + " AND f.relative_path = ?").all(projectId, clean) as SymRow[]
    if (exact.length > 0) {
      filesMatchingScope = new Set(exact.map((r) => r.fileId)).size
    } else {
      filesMatchingScope = Number(
        (
          raw
            .prepare("SELECT COUNT(*) c FROM brain_file f WHERE f.project_id = ? AND f.relative_path LIKE ? ESCAPE '\\'")
            .get(projectId, escapeLike(clean) + "/%") as { c: number }
        ).c ?? 0,
      )
    }
  }
  let filesInScope = 0
  let totalCyclomatic = 0
  const breakdown: ComplexityReport["breakdown"] = []
  for (const sym of symbols) {
    totalCyclomatic += sym.complexity
    breakdown.push({ name: sym.name, type: sym.symbolType, complexity: sym.complexity, file: sym.file, line: sym.line })
  }
  breakdown.sort((a, b) => b.complexity - a.complexity)

  const cyclomaticAvg = symbolCount > 0 ? Math.round((totalCyclomatic / symbolCount) * 100) / 100 : null

  // Lines of code: scope-consistent. Function/class -> sum symbol spans.
  // File -> that file's line_count. (Project returned above.)
  let loc: number | null = null
  if (scope === "function" || scope === "class") {
    loc = symbols.reduce((sum, s) => sum + (s.lineEnd > s.line ? s.lineEnd - s.line : 0), 0)
  } else if (scope === "file" && symbols.length > 0) {
    // symbols[0] is whatever an unordered query returned first. Every other
    // metric in the same response is over ALL matched symbols, so a many-file
    // scope was scored against ONE file's line count: measured, target "src"
    // gave 163 symbols with linesOfCode 2, and maintainability was derived from
    // it — 149.57 on a 0-171 scale, i.e. "excellent" for a scope spanning 83
    // files.
    const fileIds = [...new Set(symbols.map((s) => s.fileId))]
    const row = raw
      .prepare("SELECT COALESCE(SUM(line_count),0) AS lc, COUNT(*) AS fc FROM brain_file WHERE id IN (" + fileIds.map(() => "?").join(",") + ")")
      .get(...fileIds) as { lc: number; fc: number } | undefined
    loc = row ? Number(row.lc) : null
    filesInScope = row ? Number(row.fc) : 0
  }

  // Coupling edges touching the scoped symbols. (Project counted above.)
  let couplingEdges: number | null = null
  if (symbols.length > 0) {
    // 2x ids placeholders: a broad target on a real repository produces tens
    // of thousands of them and SQLite refuses the statement outright, which
    // surfaced as `error: too many SQL variables` instead of an answer.
    const ids = symbols.map((s) => s.id)
    const placeholders = ids.map(() => "?").join(",")
    const row = raw.prepare(
      "SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND " + couplingClause() + " AND (" +
        "source_symbol_id IN (" + placeholders + ") OR target_symbol_id IN (" + placeholders + "))",
    ).get(projectId, ...COUPLING_RELATIONSHIP_TYPES, ...ids, ...ids) as { c: number }
    couplingEdges = Number(row.c)
  } else {
    // An empty scope has no coupling by construction, not by measurement.
    // 0/available:true is the one metric in the report claiming a measurement
    // nobody took — and it is the metric an agent uses to decide "this file
    // is decoupled".
    couplingEdges = null
  }

  // Maintainability index. See maintainabilityIndex: unavailable when the
  // scope has no LOC, and unavailable — not clamped to 0 — when the formula's
  // own domain does not cover the scope.
  const maintainability = symbolCount > 0 ? maintainabilityIndex(cyclomaticAvg, loc) : null

  return {
    target,
    scope,
    metrics: {
      cyclomaticAvg: metric(cyclomaticAvg),
      cyclomaticTotal: metric(symbolCount > 0 ? totalCyclomatic : null),
      linesOfCode: metric(loc),
      couplingEdges: metric(couplingEdges),
      maintainability: metric(maintainability),
      depthOfInheritance: metric(null), // not computed yet — never fabricated
    },
    breakdown: breakdown.slice(0, 20),
    symbolCount,
    filesInScope,
    filesMatchingScope,
    scopeMatch,
    couplingRelationshipTypes: [...COUPLING_RELATIONSHIP_TYPES],
    provenance: makeProvenance({ evidenceClass: "indexed", engine: ENGINE, engineVersion: ENGINE_VERSION, projectId, source: "brain_symbol+brain_file+brain_relationship", limitations: ["depthOfInheritance unavailable; cyclomatics use indexed heuristics not dynamic dispatch."] }),
  }
}
