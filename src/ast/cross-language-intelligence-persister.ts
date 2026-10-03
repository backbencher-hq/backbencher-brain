

import { BrainDatabase } from "../brain/database"
import type { ProjectID } from "../project/schema"
import * as Log from "../tool/brain-log"
import { CrossLanguageIntelligence } from "./cross-language-intelligence"
import { BrainSymbolTable, BrainRelationshipTable, BrainFileTable, BrainProjectHealthTable } from "../brain/brain.sql"
import { eq, and } from "drizzle-orm"
import { randomUUID } from "crypto"
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"

const log = Log.create({ service: "cross-language-persister" })

export namespace CrossLanguageIntelligencePersister {
  /**
   * Persist complete polyglot analysis to brain database
   * This bridges the gap between cross-language analysis and brain storage
   */
  export async function persistToDatabase(
    projectId: ProjectID,
    analysis: CrossLanguageIntelligence.PolyglotProjectAnalysis,
    fileMap: Map<string, string>, // filePath -> fileId mapping
  ): Promise<PersistenceResult> {
    log.info("💾 Starting Cross-Language Intelligence Persistence", {
      projectId,
      symbols: analysis.crossLanguageSymbols.length,
      relationships: analysis.crossLanguageRelationships.length,
      services: analysis.serviceTopology.services.length,
    })

    const startTime = Date.now()
    const db = await BrainDatabase.getInstance(projectId)

    const result: PersistenceResult = {
      symbolsCreated: 0,
      symbolsUpdated: 0,
      relationshipsCreated: 0,
      relationshipsUpdated: 0,
      servicesCreated: 0,
      dataFlowsCreated: 0,
      errors: [],
    }

    try {
      // PHASE 1: Persist Cross-Language Symbols
      log.info("📊 Phase 1: Persisting cross-language symbols")
      await persistCrossLanguageSymbols(db, projectId, analysis.crossLanguageSymbols, fileMap, result)

      // PHASE 2: Persist Cross-Language Relationships
      log.info("🔗 Phase 2: Persisting cross-language relationships")
      await persistCrossLanguageRelationships(db, projectId, analysis.crossLanguageRelationships, fileMap, result)

      // PHASE 3: Persist Service Topology
      log.info("🏗️ Phase 3: Persisting service topology")
      await persistServiceTopology(db, projectId, analysis.serviceTopology, result)

      // PHASE 4: Persist Data Flow Analysis
      log.info("🌊 Phase 4: Persisting data flow analysis")
      await persistDataFlowAnalysis(db, projectId, analysis.dataFlowAnalysis, result)

      // PHASE 5: Persist API Coverage
      log.info("📋 Phase 5: Persisting API coverage data")
      await persistAPICoverage(db, projectId, analysis.apiCoverage, result)

      // PHASE 6: Persist Security Analysis
      log.info("🔒 Phase 6: Persisting security analysis")
      await persistSecurityAnalysis(db, projectId, analysis.securityAnalysis, result)

      // PHASE 7: Persist Performance Analysis
      log.info("⚡ Phase 7: Persisting performance analysis")
      await persistPerformanceAnalysis(db, projectId, analysis.performanceAnalysis, result)

      // PHASE 8: Persist Project Health
      log.info("🏥 Phase 8: Persisting project health metrics")
      await persistProjectHealth(db, projectId, analysis, result)

      const duration = Date.now() - startTime
      log.info("🎉 Cross-Language Intelligence Persistence COMPLETE!", {
        duration: `${duration}ms`,
        symbolsCreated: result.symbolsCreated,
        relationshipsCreated: result.relationshipsCreated,
        servicesCreated: result.servicesCreated,
        errors: result.errors.length,
      })
    } catch (error) {
      log.error("Failed to persist cross-language intelligence", { error })
      result.errors.push({
        phase: "persistence",
        message: error instanceof Error ? error.message : String(error),
      })
    }

    return result
  }

  /**
   * PHASE 1: Persist Cross-Language Symbols
   * Creates or updates symbols with cross-language metadata
   */
  async function persistCrossLanguageSymbols(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    fileMap: Map<string, string>,
    result: PersistenceResult,
  ): Promise<void> {
    for (const symbol of symbols) {
      try {
        // Create symbol entries for each definition location
        for (const definition of symbol.definitions) {
          const fileId = fileMap.get(definition.filePath)
          if (!fileId) {
            log.warn("File not found for symbol", { symbol: symbol.name, file: definition.filePath })
            continue
          }

          const symbolId = `cross_lang_${symbol.type}_${symbol.name}_${definition.filePath}_${definition.range?.startLine || 0}`

          // Check if symbol already exists
          const existingResults = await db
            .select()
            .from(BrainSymbolTable)
            .where(
              and(
                eq(BrainSymbolTable.project_id, projectId),
                eq(BrainSymbolTable.file_id, fileId),
                eq(BrainSymbolTable.name, symbol.name),
                eq(BrainSymbolTable.line_start, definition.range?.startLine || 0),
              ),
            )
            .limit(1)

          const existing = existingResults[0]

          if (existing) {
            // Update existing symbol with cross-language metadata
            await db
              .update(BrainSymbolTable)
              .set({
                qualified_name: symbol.id,
                symbol_type: mapCrossLanguageTypeToSymbolKind(symbol.type),
                annotations: JSON.stringify([...definition.context.annotations, "cross_language"]),
                complexity: symbol.metadata.performanceProfile.latencyImpact === "high" ? 10 : 5,
                time_updated: Date.now(),
              })
              .where(eq(BrainSymbolTable.id, existing.id))

            result.symbolsUpdated++
          } else {
            // Create new symbol
            await db.insert(BrainSymbolTable).values({
              id: symbolId,
              project_id: projectId,
              file_id: fileId,
              name: symbol.name,
              qualified_name: symbol.id,
              symbol_type: mapCrossLanguageTypeToSymbolKind(symbol.type),
              line_start: definition.range?.startLine || 0,
              line_end: definition.range?.endLine || 0,
              byte_start: definition.range?.startIndex ?? null,
              byte_end: definition.range?.endIndex ?? null,
              return_type: null,
              parameters: null,
              docstring: `Cross-language symbol: ${symbol.type}`,
              visibility: definition.context.accessPattern === "public" ? "public" : "private",
              is_async: false,
              is_static: false,
              is_abstract: false,
              is_override: false,
              is_getter: false,
              is_setter: false,
              complexity: symbol.metadata.performanceProfile.latencyImpact === "high" ? 10 : 5,
              owner_symbol_id: null,
              scope_kind: "global",
              annotations: JSON.stringify([...definition.context.annotations, "cross_language"]),
              generic_parameters: null,
              qualified_calls: null,
              time_created: Date.now(),
              time_updated: Date.now(),
            })

            result.symbolsCreated++
          }
        }
      } catch (error) {
        log.error("Failed to persist symbol", { symbol: symbol.name, error })
        result.errors.push({
          phase: "symbol_persistence",
          message: `Symbol: ${symbol.name} - ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }

  /**
   * PHASE 2: Persist Cross-Language Relationships
   * Creates relationships with cross-language metadata
   */
  async function persistCrossLanguageRelationships(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    relationships: CrossLanguageIntelligence.CrossLanguageRelationship[],
    fileMap: Map<string, string>,
    result: PersistenceResult,
  ): Promise<void> {
    for (const relationship of relationships) {
      try {
        const relationshipId = relationship.id || `cross_lang_rel_${randomUUID()}`

        // Determine if this is truly cross-language
        const isCrossLanguage = relationship.source.language !== relationship.target.language

        // Find source and target symbols in database
        const sourceFileId = fileMap.get(relationship.source.filePath)
        const targetFileId = fileMap.get(relationship.target.filePath)

        if (!sourceFileId || !targetFileId) {
          log.warn("File not found for relationship", {
            source: relationship.source.filePath,
            target: relationship.target.filePath,
          })
          continue
        }

        // Try to find existing symbols
        const sourceSymbol = await findSymbolByLocation(db, projectId, sourceFileId, relationship.source.range)
        const targetSymbol = await findSymbolByLocation(db, projectId, targetFileId, relationship.target.range)

        // Check if relationship already exists
        const existingResults =
          sourceSymbol && targetSymbol
            ? await db
                .select()
                .from(BrainRelationshipTable)
                .where(
                  and(
                    eq(BrainRelationshipTable.project_id, projectId),
                    eq(BrainRelationshipTable.source_symbol_id, sourceSymbol.id),
                    eq(BrainRelationshipTable.target_symbol_id, targetSymbol.id),
                    eq(BrainRelationshipTable.relationship_type, mapRelationshipType(relationship.type)),
                  ),
                )
                .limit(1)
            : []

        const existing = existingResults[0]

        if (existing) {
          // Update existing relationship with cross-language metadata
          await db
            .update(BrainRelationshipTable)
            .set({
              is_cross_language: isCrossLanguage,
              bridge_mechanism: relationship.metadata.communicationMechanism,
              confidence: relationship.strength,
              metadata: JSON.stringify({
                ...relationship.metadata,
                crossLanguageData: {
                  sourceLanguage: relationship.source.language,
                  targetLanguage: relationship.target.language,
                  dataFormat: relationship.metadata.dataFormat,
                  securityImplications: relationship.metadata.securityImplications,
                },
              }),
              time_updated: Date.now(),
            })
            .where(eq(BrainRelationshipTable.id, existing.id))

          result.relationshipsUpdated++
        } else {
          // Create new relationship
          await db.insert(BrainRelationshipTable).values({
            id: relationshipId,
            project_id: projectId,
            source_symbol_id: sourceSymbol?.id || `cross_lang_source_${randomUUID()}`,
            target_symbol_id: targetSymbol?.id || null,
            target_external: targetSymbol ? null : `${relationship.target.language}:${relationship.target.filePath}`,
            relationship_type: mapRelationshipType(relationship.type),
            confidence: relationship.strength,
            context: `Cross-language: ${relationship.metadata.communicationMechanism}`,
            // M59/#821: never 0. `range?.startLine || 0` wrote 0 — the value
            // readers treat as "unknown" — whenever the source symbol had no
            // range, which is indistinguishable from a real line 0 to every
            // downstream consumer. Unknown is NULL.
            line_number:
              relationship.source.range && relationship.source.range.startLine > 0
                ? relationship.source.range.startLine
                : null,
            is_cross_language: isCrossLanguage,
            bridge_mechanism: relationship.metadata.communicationMechanism,
            metadata: JSON.stringify({
              ...relationship.metadata,
              crossLanguageData: {
                sourceLanguage: relationship.source.language,
                targetLanguage: relationship.target.language,
                dataFormat: relationship.metadata.dataFormat,
                securityImplications: relationship.metadata.securityImplications,
              },
            }),
            time_created: Date.now(),
            time_updated: Date.now(),
          })

          result.relationshipsCreated++
        }
      } catch (error) {
        log.error("Failed to persist relationship", { relationship: relationship.id, error })
        result.errors.push({
          phase: "relationship_persistence",
          message: `Relationship: ${relationship.id} - ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }

  /**
   * PHASE 3: Persist Service Topology
   * Creates service-level architecture metadata
   */
  async function persistServiceTopology(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    topology: CrossLanguageIntelligence.ServiceTopology,
    result: PersistenceResult,
  ): Promise<void> {
    // Store services as special symbols
    for (const service of topology.services) {
      try {
        const serviceId = service.id

        // Find the primary file for this service
        const primaryFile = service.filePaths[0]
        const fileId = await findOrCreateFileId(db, projectId, primaryFile)

        // Create or update service symbol
        const existingResults = await db
          .select()
          .from(BrainSymbolTable)
          .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.qualified_name, serviceId)))
          .limit(1)

        const existing = existingResults[0]

        if (existing) {
          await db
            .update(BrainSymbolTable)
            .set({
              annotations: JSON.stringify(["service", "cross_language"]),
              complexity: service.endpoints.length,
              time_updated: Date.now(),
            })
            .where(eq(BrainSymbolTable.id, existing.id))
        } else {
          await db.insert(BrainSymbolTable).values({
            id: serviceId,
            project_id: projectId,
            file_id: fileId,
            name: service.name,
            qualified_name: serviceId,
            symbol_type: "service",
            line_start: 0,
            line_end: 0,
            byte_start: null,
            byte_end: null,
            return_type: null,
            parameters: JSON.stringify(
              service.endpoints.map((e) => ({
                name: e.path,
                type: e.method,
              })),
            ),
            docstring: `${service.type} service with ${service.endpoints.length} endpoints`,
            visibility: "public",
            is_async: false,
            is_static: false,
            is_abstract: false,
            is_override: false,
            is_getter: false,
            is_setter: false,
            complexity: service.endpoints.length,
            owner_symbol_id: null,
            scope_kind: "global",
            annotations: JSON.stringify(["service", "cross_language", service.type, service.framework]),
              generic_parameters: null,
              qualified_calls: JSON.stringify(service.dependencies),
            time_created: Date.now(),
            time_updated: Date.now(),
          })

          result.servicesCreated++
        }
      } catch (error) {
        log.error("Failed to persist service", { service: service.name, error })
        result.errors.push({
          phase: "service_persistence",
          message: `Service: ${service.name} - ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }

  /**
   * PHASE 4: Persist Data Flow Analysis
   * Creates data flow tracking metadata
   */
  async function persistDataFlowAnalysis(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    dataFlow: CrossLanguageIntelligence.DataFlowAnalysis,
    result: PersistenceResult,
  ): Promise<void> {
    // Store data flows as special relationships
    for (const flow of dataFlow.dataFlows) {
      try {
        const flowId = flow.id

        // Create relationship for data flow
        await db.insert(BrainRelationshipTable).values({
          id: flowId,
          project_id: projectId,
          source_symbol_id: `dataflow_source_${flow.source.serviceId}`,
          target_symbol_id: null,
          target_external: `dataflow_target_${flow.target.serviceId}`,
          relationship_type: "data_flow",
          confidence: 0.9,
          context: `Data flow: ${flow.source.dataFormat} -> ${flow.target.expectedFormat}`,
          // M59/#821: a synthesised cross-service data flow has no source line
          // at all. NULL is the honest value; 0 claimed a line that does not
          // exist and made "unknown" indistinguishable from "line 0".
          line_number: null,
          is_cross_language: flow.source.language !== flow.target.language,
          bridge_mechanism: "data_transfer",
          metadata: JSON.stringify({
            sourceService: flow.source.serviceId,
            targetService: flow.target.serviceId,
            dataModel: flow.dataModel,
            transformations: flow.transformations,
            security: flow.security,
            performance: flow.performance,
          }),
          time_created: Date.now(),
          time_updated: Date.now(),
        })

        result.dataFlowsCreated++
      } catch (error) {
        log.error("Failed to persist data flow", { flow: flow.id, error })
        result.errors.push({
          phase: "dataflow_persistence",
          message: `Data flow: ${flow.id} - ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
  }

  /**
   * PHASE 5: Persist API Coverage
   * Creates API documentation and testing coverage metadata
   */
  async function persistAPICoverage(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    apiCoverage: CrossLanguageIntelligence.APICoverageAnalysis,
    result: PersistenceResult,
  ): Promise<void> {
    // Store as metadata in a special symbol
    try {
      const coverageId = `api_coverage_${projectId}`

      await db
        .insert(BrainSymbolTable)
        .values({
          id: coverageId,
          project_id: projectId,
          file_id: "root",
          name: "API_Coverage",
          qualified_name: coverageId,
          symbol_type: "metadata",
          line_start: 0,
            line_end: 0,
            byte_start: null,
            byte_end: null,
          return_type: null,
          parameters: null,
          docstring: `API Coverage Analysis for project ${projectId}`,
          visibility: "public",
          is_async: false,
          is_static: false,
          is_abstract: false,
          is_override: false,
          is_getter: false,
          is_setter: false,
          complexity: apiCoverage.totalEndpoints,
          owner_symbol_id: null,
          scope_kind: "global",
          annotations: JSON.stringify(["metadata", "api_coverage"]),
          generic_parameters: null,
          qualified_calls: null,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: BrainSymbolTable.id,
          set: {
            complexity: apiCoverage.totalEndpoints,
            time_updated: Date.now(),
          },
        })
    } catch (error) {
      log.error("Failed to persist API coverage", { error })
      result.errors.push({
        phase: "api_coverage_persistence",
        message: `API Coverage - ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /**
   * PHASE 6: Persist Security Analysis
   * Creates security vulnerability metadata
   */
  async function persistSecurityAnalysis(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    security: CrossLanguageIntelligence.CrossLanguageSecurityAnalysis,
    result: PersistenceResult,
  ): Promise<void> {
    // Store as metadata
    try {
      const securityId = `security_analysis_${projectId}`

      await db
        .insert(BrainSymbolTable)
        .values({
          id: securityId,
          project_id: projectId,
          file_id: "root",
          name: "Security_Analysis",
          qualified_name: securityId,
          symbol_type: "metadata",
          line_start: 0,
            line_end: 0,
            byte_start: null,
            byte_end: null,
          return_type: null,
          parameters: null,
          docstring: `Security Analysis: ${security.threats.length} threats, ${security.vulnerabilities.length} vulnerabilities`,
          visibility: "public",
          is_async: false,
          is_static: false,
          is_abstract: false,
          is_override: false,
          is_getter: false,
          is_setter: false,
          complexity: security.threats.length + security.vulnerabilities.length,
          owner_symbol_id: null,
          scope_kind: "global",
          annotations: JSON.stringify(["metadata", "security", `score:${security.securityScore}`]),
          generic_parameters: null,
          qualified_calls: null,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: BrainSymbolTable.id,
          set: {
            docstring: `Security Analysis: ${security.threats.length} threats, ${security.vulnerabilities.length} vulnerabilities`,
            complexity: security.threats.length + security.vulnerabilities.length,
            time_updated: Date.now(),
          },
        })
    } catch (error) {
      log.error("Failed to persist security analysis", { error })
      result.errors.push({
        phase: "security_persistence",
        message: `Security Analysis - ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /**
   * PHASE 7: Persist Performance Analysis
   * Creates performance issue metadata
   */
  async function persistPerformanceAnalysis(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    performance: CrossLanguageIntelligence.CrossLanguagePerformanceAnalysis,
    result: PersistenceResult,
  ): Promise<void> {
    // Store as metadata
    try {
      const performanceId = `performance_analysis_${projectId}`

      await db
        .insert(BrainSymbolTable)
        .values({
          id: performanceId,
          project_id: projectId,
          file_id: "root",
          name: "Performance_Analysis",
          qualified_name: performanceId,
          symbol_type: "metadata",
          line_start: 0,
            line_end: 0,
            byte_start: null,
            byte_end: null,
          return_type: null,
          parameters: null,
          docstring: `Performance Analysis: Score ${performance.overallScore}/100, ${performance.bottlenecks.length} bottlenecks`,
          visibility: "public",
          is_async: false,
          is_static: false,
          is_abstract: false,
          is_override: false,
          is_getter: false,
          is_setter: false,
          complexity: performance.bottlenecks.length,
          owner_symbol_id: null,
          scope_kind: "global",
          annotations: JSON.stringify(["metadata", "performance", `score:${performance.overallScore}`]),
          generic_parameters: null,
          qualified_calls: null,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: BrainSymbolTable.id,
          set: {
            docstring: `Performance Analysis: Score ${performance.overallScore}/100, ${performance.bottlenecks.length} bottlenecks`,
            complexity: performance.bottlenecks.length,
            time_updated: Date.now(),
          },
        })
    } catch (error) {
      log.error("Failed to persist performance analysis", { error })
      result.errors.push({
        phase: "performance_persistence",
        message: `Performance Analysis - ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  /**
   * PHASE 8: Persist Project Health
   * Populates the BrainProjectHealthTable used by security and health tools
   */
  async function persistProjectHealth(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    analysis: CrossLanguageIntelligence.PolyglotProjectAnalysis,
    result: PersistenceResult,
  ): Promise<void> {
    try {
      const { projectMetrics, securityAnalysis, performanceAnalysis, serviceTopology } = analysis

      const contractDrift = serviceTopology.services.flatMap((s) =>
        s.endpoints.filter((e) => e.security?.length === 0).map((e) => `${s.name}: Unsecured endpoint ${e.path}`),
      )

      const healthData = {
        project_id: projectId,
        complexity_score: projectMetrics.complexityScore,
        maintainability_score: projectMetrics.maintainabilityScore,
        technical_debt_score: projectMetrics.technicalDebtScore,
        code_quality_score: projectMetrics.codeQualityScore,
        language_distribution: JSON.stringify(projectMetrics.languageDistribution),
        service_metrics: JSON.stringify(projectMetrics.serviceMetrics),
        dependency_metrics: JSON.stringify(projectMetrics.dependencyMetrics),
        circular_dependencies: JSON.stringify([]), // Not currently gathered in metrics natively
        contract_drift: JSON.stringify(contractDrift),
        performance_bottlenecks: JSON.stringify(performanceAnalysis.bottlenecks.map((b) => b.impact)),
        time_created: Date.now(),
        time_updated: Date.now(),
      }

      // We'll just do an insert ... on conflict update manually by checking if it exists
      const existingResults = await db
        .select()
        .from(BrainProjectHealthTable)
        .where(eq(BrainProjectHealthTable.project_id, projectId))
        .limit(1)

      if (existingResults[0]) {
        await db
          .update(BrainProjectHealthTable)
          .set({
            ...healthData,
            time_created: existingResults[0].time_created, // Keep original time_created
          })
          .where(eq(BrainProjectHealthTable.project_id, projectId))
      } else {
        await db.insert(BrainProjectHealthTable).values(healthData)
      }
    } catch (error) {
      log.error("Failed to persist project health metrics", { error })
      result.errors.push({
        phase: "health_persistence",
        message: `Project Health - ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  // ======================== UTILITY FUNCTIONS ========================

  /**
   * Find symbol by file location
   */
  async function findSymbolByLocation(
    db: BunSQLiteDatabase,
    projectId: ProjectID,
    fileId: string,
    range?: { startLine?: number; startColumn?: number; endLine?: number; endColumn?: number },
  ): Promise<{ id: string } | undefined> {
    if (!range?.startLine) return undefined

    const results = await db
      .select()
      .from(BrainSymbolTable)
      .where(
        and(
          eq(BrainSymbolTable.project_id, projectId),
          eq(BrainSymbolTable.file_id, fileId),
          eq(BrainSymbolTable.line_start, range.startLine),
        ),
      )
      .limit(1)

    return results[0]
  }

  /**
   * Find or create file ID
   */
  async function findOrCreateFileId(db: BunSQLiteDatabase, projectId: ProjectID, filePath: string): Promise<string> {
    const results = await db
      .select()
      .from(BrainFileTable)
      .where(and(eq(BrainFileTable.project_id, projectId), eq(BrainFileTable.path, filePath)))
      .limit(1)

    if (results[0]) return results[0].id

    // Create placeholder file entry
    const fileId = `cross_lang_file_${randomUUID()}`
    await db.insert(BrainFileTable).values({
      id: fileId,
      project_id: projectId,
      path: filePath,
      relative_path: filePath,
      file_hash: "",
      size_bytes: 0,
      line_count: 0,
      language: null,
      last_modified: Date.now(),
      indexed_at: new Date().toISOString(),
      layer: null,
      is_test_file: false,
      is_config_file: false,
      is_documentation: false,
      framework_type: null,
      time_created: Date.now(),
      time_updated: Date.now(),
    })

    return fileId
  }

  /**
   * Map CrossLanguageSymbolType to SymbolKind
   */
  function mapCrossLanguageTypeToSymbolKind(type: CrossLanguageIntelligence.CrossLanguageSymbolType): string {
    switch (type) {
      case CrossLanguageIntelligence.CrossLanguageSymbolType.API_ENDPOINT:
        return "function"
      case CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL:
        return "class"
      case CrossLanguageIntelligence.CrossLanguageSymbolType.SERVICE:
        return "service"
      case CrossLanguageIntelligence.CrossLanguageSymbolType.DATABASE_ENTITY:
        return "class"
      case CrossLanguageIntelligence.CrossLanguageSymbolType.MESSAGE_TYPE:
        return "type"
      case CrossLanguageIntelligence.CrossLanguageSymbolType.CONFIGURATION:
        return "variable"
      case CrossLanguageIntelligence.CrossLanguageSymbolType.SHARED_LIBRARY:
        return "module"
      default:
        return "unknown"
    }
  }

  /**
   * Map CrossLanguageRelationType to relationship_type string
   */
  function mapRelationshipType(type: CrossLanguageIntelligence.CrossLanguageRelationType): string {
    return type.toString()
  }

  // ======================== TYPES ========================

  export interface PersistenceResult {
    symbolsCreated: number
    symbolsUpdated: number
    relationshipsCreated: number
    relationshipsUpdated: number
    servicesCreated: number
    dataFlowsCreated: number
    errors: Array<{ phase: string; message: string }>
  }
}
