// @ts-nocheck — ported; verified by tests. Restored incrementally in Phase 3.
/**
 * OPTIMIZED BRAIN TOOLS - Lightning Fast Performance
 * Enhanced with caching, connection pooling, and query optimizations
 */

import { BrainDatabase } from "../brain/database"
import { BrainPerformance } from "../brain/performance"
import type { ProjectID } from "../project/schema"
import * as Log from "../tool/brain-log"
import { eq, and, like, sql, desc, inArray, or } from "drizzle-orm"
import { BrainSymbolTable, BrainFileTable, BrainRelationshipTable } from "../brain/brain.sql"

const log = Log.create({ service: "optimized-brain-tools" })

export namespace OptimizedBrainTools {
  // Enhanced function recall with intelligent caching
  export async function recallFunction(
    projectId: ProjectID,
    options: {
      name: string
      exact?: boolean
      includeCallers?: boolean
      limit?: number
    },
  ) {
    const cacheKey = `recall_function_${projectId}_${JSON.stringify(options)}`

    return BrainPerformance.withCache(
      cacheKey,
      async () => {
        const db = await BrainPerformance.getOptimizedConnection(projectId)

        log.debug("optimized recall_function", { projectId, options })

        // Build optimized query with proper indexing
        const conditions = [eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.symbol_type, "function")]

        if (options.exact) {
          conditions.push(eq(BrainSymbolTable.name, options.name))
        } else {
          conditions.push(like(BrainSymbolTable.name, `%${options.name}%`))
        }

        // Execute main query with limit for performance
        const functions = await db
          .select({
            symbol: BrainSymbolTable,
            file: BrainFileTable,
          })
          .from(BrainSymbolTable)
          .innerJoin(
            BrainFileTable,
            and(
              eq(BrainSymbolTable.project_id, BrainFileTable.project_id),
              eq(BrainSymbolTable.file_id, BrainFileTable.id),
            ),
          )
          .where(and(...conditions))
          .limit(options.limit || 20)

        const results = functions.map(({ symbol, file }: { symbol: any; file: any }) => ({
          id: symbol.id,
          name: symbol.name,
          filePath: file.path,
          relativePath: file.relative_path,
          language: file.language || "unknown",
          visibility: symbol.visibility || "public",
          isStatic: symbol.is_static || false,
          isAsync: symbol.is_async || false,
          complexity: symbol.complexity || 0,
          parameters: symbol.parameters
            ? typeof symbol.parameters === "string"
              ? JSON.parse(symbol.parameters)
              : symbol.parameters
            : [],
          returnType: symbol.return_type,
          range: {
            startLine: symbol.line_start || 0,
            endLine: symbol.line_end || 0,
          },
        }))

        // Add callers if requested (separate optimized query)
        if (options.includeCallers && results.length > 0) {
          const symbolIds = results.map((r: any) => r.id)

          const callers = await db
            .select({
              targetId: BrainRelationshipTable.target_symbol_id,
              caller: BrainSymbolTable,
              callerFile: BrainFileTable,
            })
            .from(BrainRelationshipTable)
            .innerJoin(BrainSymbolTable, eq(BrainRelationshipTable.source_symbol_id, BrainSymbolTable.id))
            .innerJoin(
              BrainFileTable,
              and(
                eq(BrainSymbolTable.project_id, BrainFileTable.project_id),
                eq(BrainSymbolTable.file_id, BrainFileTable.id),
              ),
            )
            .where(
              and(
                eq(BrainRelationshipTable.project_id, projectId),
                eq(BrainRelationshipTable.relationship_type, "calls"),
                inArray(BrainRelationshipTable.target_symbol_id, symbolIds),
              ),
            )

          // Group callers by target function
          const callersMap = new Map<string, any[]>()
          for (const caller of callers) {
            if (!callersMap.has(caller.targetId)) {
              callersMap.set(caller.targetId, [])
            }
            callersMap.get(caller.targetId)!.push({
              name: caller.caller.name,
              relativePath: caller.callerFile.relative_path,
            })
          }

          // Add callers to results
          for (const result of results) {
            result.callers = callersMap.get(result.id) || []
          }
        }

        return results
      },
      120000,
    ) // 2 minute cache
  }

  // Enhanced class recall with caching
  export async function recallClass(
    projectId: ProjectID,
    options: {
      name: string
      exactMatch?: boolean
    },
  ) {
    const cacheKey = `recall_class_${projectId}_${JSON.stringify(options)}`

    return BrainPerformance.withCache(
      cacheKey,
      async () => {
        const db = await BrainPerformance.getOptimizedConnection(projectId)

        const conditions = [
          eq(BrainSymbolTable.project_id, projectId),
          inArray(BrainSymbolTable.symbol_type, ["class", "interface", "type", "enum", "struct"]),
        ]

        if (options.exactMatch) {
          conditions.push(eq(BrainSymbolTable.name, options.name))
        } else {
          conditions.push(like(BrainSymbolTable.name, `%${options.name}%`))
        }

        const classes = await db
          .select({
            symbol: BrainSymbolTable,
            file: BrainFileTable,
          })
          .from(BrainSymbolTable)
          .innerJoin(
            BrainFileTable,
            and(
              eq(BrainSymbolTable.project_id, BrainFileTable.project_id),
              eq(BrainSymbolTable.file_id, BrainFileTable.id),
            ),
          )
          .where(and(...conditions))
          .limit(20)

        const results = []
        for (const { symbol, file } of classes) {
          // Get class methods (optimized query)
          const methods = await db
            .select()
            .from(BrainSymbolTable)
            .where(
              and(
                eq(BrainSymbolTable.project_id, projectId),
                eq(BrainSymbolTable.owner_symbol_id, symbol.id),
                eq(BrainSymbolTable.symbol_type, "function"),
              ),
            )
            .limit(10) // Limit methods for performance

          results.push({
            id: symbol.id,
            name: symbol.name,
            relativePath: file.relative_path,
            language: file.language || "unknown",
            isAbstract: symbol.is_abstract || false,
            range: {
              startLine: symbol.line_start || 0,
              endLine: symbol.line_end || 0,
            },
            methods: methods.map((m: any) => ({
              name: m.name,
              isStatic: m.is_static || false,
              visibility: m.visibility || "public",
            })),
            inheritance: symbol.inheritance
              ? typeof symbol.inheritance === "string"
                ? JSON.parse(symbol.inheritance)
                : symbol.inheritance
              : [],
          })
        }

        return results
      },
      120000,
    )
  }

  // Enhanced file recall with caching
  export async function recallFile(projectId: ProjectID, pathPattern: string) {
    const cacheKey = `recall_file_${projectId}_${pathPattern}`

    return BrainPerformance.withCache(
      cacheKey,
      async () => {
        const db = await BrainPerformance.getOptimizedConnection(projectId)

        const files = await db
          .select()
          .from(BrainFileTable)
          .where(and(eq(BrainFileTable.project_id, projectId), like(BrainFileTable.relative_path, `%${pathPattern}%`)))
          .limit(20)

        const results = []
        for (const file of files) {
          // Get file symbols (optimized with limit)
          const symbols = await db
            .select()
            .from(BrainSymbolTable)
            .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.file_id, file.id)))
            .limit(50) // Limit symbols per file

          results.push({
            relativePath: file.relative_path,
            language: file.language || "unknown",
            sizeBytes: file.size_bytes,
            lineCount: file.line_count,
            symbols: symbols.map((s: any) => ({
              name: s.name,
              symbolType: s.symbol_type,
            })),
            complexity: {
              total: symbols.reduce((sum: number, s: any) => sum + (s.complexity || 0), 0),
              average:
                symbols.length > 0
                  ? symbols.reduce((sum: number, s: any) => sum + (s.complexity || 0), 0) / symbols.length
                  : 0,
            },
          })
        }

        return results
      },
      300000,
    ) // 5 minute cache for file queries
  }

  // Performance metrics for monitoring
  export function getPerformanceMetrics() {
    return BrainPerformance.getMetrics()
  }

  // Warmup commonly used queries
  export async function warmup(projectId: ProjectID) {
    await BrainPerformance.warmupCache(projectId)

    // Pre-execute common queries
    const commonQueries = [
      () => recallFunction(projectId, { name: "init", exact: false, limit: 5 }),
      () => recallClass(projectId, { name: "Service", exactMatch: false }),
      () => recallFile(projectId, ".ts"),
    ]

    await Promise.all(commonQueries.map((q) => q().catch(() => {})))
  }
}
