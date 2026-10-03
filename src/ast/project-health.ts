

import { BrainDatabase } from "../brain/database"
import { BrainSymbolTable, BrainFileTable, BrainProjectHealthTable } from "../brain/brain.sql"
import type { ProjectID } from "../project/schema"
import { eq, sql, and, desc } from "drizzle-orm"
import * as Log from "../tool/brain-log"

const log = Log.create({ service: "project-health" })

/**
 * Row shapes of the three projections below, declared next to the query that
 * produces them.
 *
 * WHY THIS EXISTS. `BrainDatabase.getInstance()` returns `Promise<any>`
 * (src/brain/database.ts), so a drizzle chain typed through it carries no element
 * type at all: every `.reduce`/`.find`/`.filter`/`.map` callback parameter was
 * implicitly `any` (the 10 errors `@ts-nocheck` was hiding here), and nothing
 * downstream of a query was ever type-checked — `totalLines` could have been a
 * string and `l.lines / totalLines` would have compiled.
 *
 * These are not invented types: each field mirrors the `sql<number>` or column
 * reference in the matching `.select({...})` two lines below, and the `|| 0`
 * guards already in this file remain correct, because `sum()` over an empty
 * group really does come back null at runtime even though the projection is
 * declared `number`. The annotation buys the thing that was missing: every use
 * of a result is now verified.
 */
type SymbolCountRow = {
  /** Nullable in the schema, hence the `s.type === "function"` probes below. */
  type: string | null
  count: number
  avgComplexity: number
}

type LangCountRow = {
  language: string | null
  count: number
  lines: number
}

type ComplexFunctionRow = {
  name: string
  complexity: number
  file: string
}

export async function computeAndStoreProjectHealth(projectId: ProjectID): Promise<void> {
  const db = await BrainDatabase.getInstance(projectId)

  // Get symbol counts by type
  const symbolCounts: SymbolCountRow[] = await db
    .select({
      type: BrainSymbolTable.symbol_type,
      count: sql<number>`count(*)`,
      avgComplexity: sql<number>`avg(${BrainSymbolTable.complexity})`,
    })
    .from(BrainSymbolTable)
    .where(eq(BrainSymbolTable.project_id, projectId))
    .groupBy(BrainSymbolTable.symbol_type)

  // Get file counts by language
  const langCounts: LangCountRow[] = await db
    .select({
      language: BrainFileTable.language,
      count: sql<number>`count(*)`,
      lines: sql<number>`sum(${BrainFileTable.line_count})`,
    })
    .from(BrainFileTable)
    .where(eq(BrainFileTable.project_id, projectId))
    .groupBy(BrainFileTable.language)

  // Get high complexity functions (complexity > 10)
  const complexFunctions: ComplexFunctionRow[] = await db
    .select({
      name: BrainSymbolTable.name,
      complexity: BrainSymbolTable.complexity,
      file: BrainFileTable.relative_path,
    })
    .from(BrainSymbolTable)
    .innerJoin(BrainFileTable, eq(BrainSymbolTable.file_id, BrainFileTable.id))
    .where(
      and(
        eq(BrainSymbolTable.project_id, projectId),
        eq(BrainSymbolTable.symbol_type, "function"),
        sql`${BrainSymbolTable.complexity} > 10`,
      ),
    )
    .orderBy(desc(BrainSymbolTable.complexity))
    .limit(20)

  // Calculate scores
  const totalSymbols = symbolCounts.reduce((acc, s) => acc + (s.count || 0), 0)
  const totalLines = langCounts.reduce((acc, l) => acc + (l.lines || 0), 0)
  const avgComplexity = symbolCounts.find((s) => s.type === "function")?.avgComplexity || 1

  // Complexity score: lower is better (inverse scale)
  // If avg complexity is 1-5, score is 80-100
  // If avg complexity is 5-15, score is 40-80
  // If avg complexity is 15+, score is 0-40
  const complexityScore = Math.max(0, Math.min(100, 100 - avgComplexity * 5))

  // Maintainability: based on function count vs total symbols ratio
  const functionCount = symbolCounts.find((s) => s.type === "function")?.count || 0
  const classCount = symbolCounts.find((s) => s.type === "class")?.count || 0
  const ratio = classCount > 0 ? functionCount / classCount : functionCount / 10
  const maintainabilityScore = Math.max(0, Math.min(100, 100 - Math.abs(ratio - 5) * 5))

  // Technical debt: high complexity functions count
  const highComplexityCount = complexFunctions.length
  const techDebtScore = Math.max(0, 100 - highComplexityCount * 5)

  // Code quality: combination of above
  const codeQualityScore = Math.round((complexityScore + maintainabilityScore + techDebtScore) / 3)

  // Language distribution
  const langDist = langCounts
    .filter((l) => l.language)
    .map((l) => ({
      language: l.language,
      files: l.count,
      lines: l.lines,
      percentage: totalLines > 0 ? Math.round((l.lines / totalLines) * 100) : 0,
    }))

  // Performance bottlenecks (high complexity functions)
  const bottlenecks = complexFunctions.map((f) => `${f.name} (complexity: ${f.complexity}) in ${f.file}`)

  // Check if exists
  const existing = await db
    .select()
    .from(BrainProjectHealthTable)
    .where(eq(BrainProjectHealthTable.project_id, projectId))
    .limit(1)

  const healthData = {
    project_id: projectId,
    complexity_score: Math.round(complexityScore),
    maintainability_score: Math.round(maintainabilityScore),
    technical_debt_score: Math.round(techDebtScore),
    code_quality_score: codeQualityScore,
    language_distribution: JSON.stringify(langDist),
    service_metrics: JSON.stringify([]),
    dependency_metrics: JSON.stringify({ total: totalSymbols, external: 0 }),
    circular_dependencies: JSON.stringify([]),
    contract_drift: JSON.stringify([]),
    performance_bottlenecks: JSON.stringify(bottlenecks),
    time_updated: Date.now(),
  }

  if (existing.length > 0) {
    await db.update(BrainProjectHealthTable).set(healthData).where(eq(BrainProjectHealthTable.project_id, projectId))
  } else {
    await db.insert(BrainProjectHealthTable).values({
      ...healthData,
      time_created: Date.now(),
    })
  }

  log.info("project health computed", {
    projectId,
    complexityScore: Math.round(complexityScore),
    maintainabilityScore: Math.round(maintainabilityScore),
    techDebtScore: Math.round(techDebtScore),
    codeQualityScore,
    languages: langDist.length,
    bottlenecks: bottlenecks.length,
  })
}
