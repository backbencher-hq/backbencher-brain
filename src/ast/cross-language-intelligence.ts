

import type { Node } from "web-tree-sitter"
import type { ProjectID } from "../project/schema"
import { ASTEngine } from "./engine"
import { CrossLanguageSymbolDiscovery } from "./cross-language-symbol-discovery"
import { CrossLanguageRelationshipMapper } from "./cross-language-relationship-mapper"
import { ServiceTopologyBuilder } from "./service-topology-builder"
import { DataFlowAnalyzer } from "./data-flow-analyzer"
import { APICoverageAnalyzer } from "./api-coverage-analyzer"
import { CrossLanguageIntelligencePersister } from "./cross-language-intelligence-persister"
import { ArchitecturalHealthMonitor } from "./architectural-health"
import { BrainDatabase } from "../brain/database"
import * as Log from "../tool/brain-log"

const log = Log.create({ service: "cross-language-intelligence" })

/**
 * Defensively parse a stored taint flow_path into an array of symbol IDs.
 * New writers store JSON arrays; legacy rows may hold '|||'-delimited strings.
 */
function parseFlowPath(raw: unknown): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw.map(String)
  const s = String(raw)
  if (!s) return []
  if (s.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return s.split("|||").filter(Boolean)
}

export namespace CrossLanguageIntelligence {
  // ======================== CORE TYPES ========================

  /**
   * Cross-language relationship types - TRACING
   */
  export enum CrossLanguageRelationType {
    // === API & SERVICE COMMUNICATION ===
    APICall = "api_call", // REST/GraphQL/gRPC calls between services
    ServiceDependency = "service_dependency", // Microservice dependencies
    DatabaseAccess = "database_access", // Database operations across languages
    MessageQueue = "message_queue", // Pub/Sub, Kafka, RabbitMQ communication

    // === DATA FLOW ===
    DataTransfer = "data_transfer", // Data structures passed between languages
    SchemaContract = "schema_contract", // Shared schemas (JSON Schema, Protobuf)
    ConfigurationShare = "configuration_share", // Shared configuration files

    // === BUILD & DEPLOYMENT ===
    BuildDependency = "build_dependency", // Build system dependencies
    DeploymentRelation = "deployment_relation", // Docker, Kubernetes relationships
    DeploymentRelationship = "deployment_relation", // Legacy alias

    // === CODE GENERATION ===
    CodeGeneration = "code_generation", // Generated code relationships
    TemplateBinding = "template_binding", // Template engines across languages

    // === FOREIGN FUNCTION INTERFACE ===
    FFIBinding = "ffi_binding", // C FFI, JNI, Node.js addons
    NativeInterop = "native_interop", // Native library bindings

    // === KOTLIN MULTIPLATFORM ===
    KMPExpectActual = "kmp_expect_actual", // Kotlin expect/actual actualization

    // === PROTOCOL COMMUNICATION ===
    ProtocolBuffer = "protocol_buffer", // Protobuf definitions
    ProtocolRelationship = "protocol_buffer", // Legacy alias
    GraphQLSchema = "graphql_schema", // GraphQL schema sharing
    OpenAPISpec = "openapi_spec", // OpenAPI/Swagger specifications
  }

  /**
   * Cross-language symbol that exists across multiple languages
   */
  export interface CrossLanguageSymbol {
    id: string
    name: string
    type: CrossLanguageSymbolType
    languages: string[] // Languages that define/use this symbol
    definitions: SymbolReference[] // Where it's defined
    usages: SymbolReference[] // Where it's used
    contracts: ContractDefinition[] // API/Schema contracts
    metadata: CrossLanguageMetadata
  }

  export enum CrossLanguageSymbolType {
    API_ENDPOINT = "api_endpoint",
    DATA_MODEL = "data_model",
    SERVICE = "service",
    DATABASE_ENTITY = "database_entity",
    MESSAGE_TYPE = "message_type",
    CONFIGURATION = "configuration",
    SHARED_LIBRARY = "shared_library",
  }

  export interface SymbolReference {
    filePath: string
    language: string
    range: ASTEngine.UniversalSymbol["range"]
    symbolKind: ASTEngine.SymbolKind
    confidence: number // 0.0 to 1.0
    context: ReferenceContext
    symbolId?: string // Link back to the exact AST symbol
  }

  export interface ReferenceContext {
    isDefinition: boolean
    isUsage: boolean
    accessPattern: string // "read", "write", "call", "extend"
    framework?: string // Framework context
    annotations: string[] // Decorators, attributes, etc.
  }

  export interface ContractDefinition {
    type: "openapi" | "graphql" | "protobuf" | "json_schema" | "database_schema" | string
    definition?: any
    schema?: any
    version?: string
    language?: string
    filePath?: string
    [key: string]: any
  }

  export interface CrossLanguageMetadata {
    communicationProtocols: string[] // HTTP, gRPC, WebSocket, etc.
    dataFormats: string[] // JSON, XML, Protobuf, etc.
    securityMechanisms: string[] // JWT, OAuth, API Keys, etc.
    performanceProfile: PerformanceProfile
    architecturalPatterns: string[] // Microservices, Event-driven, etc.
    [key: string]: any
  }

  export interface PerformanceProfile {
    latencyImpact: "low" | "medium" | "high" | "very_high" | string
    throughputImpact: "low" | "medium" | "high" | "very_high" | string
    scalabilityFactors: string[]
  }

  /**
   * Complete polyglot project analysis result
   */
  export interface PolyglotProjectAnalysis {
    crossLanguageSymbols: CrossLanguageSymbol[]
    crossLanguageRelationships: CrossLanguageRelationship[]
    serviceTopology: ServiceTopology
    dataFlowAnalysis: DataFlowAnalysis
    apiCoverage: APICoverageAnalysis
    securityAnalysis: CrossLanguageSecurityAnalysis
    performanceAnalysis: CrossLanguagePerformanceAnalysis
    architecturalInsights: ArchitecturalInsight[]
    complianceReport: ComplianceReport
    projectMetrics: ProjectMetrics
    apiContractValidation?: import("./api-contract-validator").APIContractValidator.ValidationReport
  }

  export interface CrossLanguageRelationship {
    id: string
    type: CrossLanguageRelationType
    source: SymbolReference
    target: SymbolReference
    strength: number // 0.0 to 1.0 relationship strength
    bidirectional: boolean
    metadata: RelationshipMetadata
  }

  export interface RelationshipMetadata {
    communicationMechanism: string // HTTP, gRPC, Database, File, etc.
    dataFormat: string // JSON, XML, Binary, etc.
    frequency: "high" | "medium" | "low" | string // How often this relationship is used
    criticality: "critical" | "important" | "optional" | string
    securityImplications: string[]
  }

  // ======================== SERVICE TOPOLOGY ========================

  export interface ServiceTopology {
    services: ServiceNode[]
    dependencies: ServiceDependency[]
    communicationPaths: CommunicationPath[]
    dataFlows: DataFlow[]
    deploymentUnits: DeploymentUnit[]
  }

  export interface ServiceNode {
    id: string
    name: string
    language: string
    type: "web_service" | "microservice" | "database" | "message_broker" | "cache" | "gateway"
    endpoints: ServiceEndpoint[]
    dependencies: string[] // Service IDs this depends on
    filePaths: string[] // Files that make up this service
    framework: string
    metadata: ServiceMetadata
  }

  export interface ServiceEndpoint {
    name?: string
    path: string
    method: string // GET, POST, etc. or RPC method name
    inputSchema?: any
    outputSchema?: any
    language: string
    filePath: string
    security: SecurityRequirement[]
  }

  export interface ServiceMetadata {
    port?: number
    protocol: string // HTTP, gRPC, TCP, etc.
    authentication: string[] // JWT, OAuth, etc.
    monitoring: string[] // Metrics, logging mechanisms
    scalability: ScalabilityInfo
  }

  export interface ScalabilityInfo {
    horizontal: boolean // Can scale horizontally
    stateless: boolean // Is stateless
    cacheability: "high" | "medium" | "low" | "none"
    bottlenecks: string[]
  }

  // ======================== DATA FLOW ANALYSIS ========================

  export interface DataFlowAnalysis {
    dataFlows: DataFlow[]
    dataModels: SharedDataModel[]
    transformations: DataTransformation[]
    persistencePoints: DataPersistence[]
    securityBoundaries: SecurityBoundary[]
    taintFlows?: TaintFlow[]
    typeFlows?: TypeFlow[]
  }

  export interface TypeFlow {
    id: string
    sourceSymbol: string
    targetSymbol: string
    sourceType: string
    targetType: string
    isCompatible: boolean
    mismatchReason?: string
    serializationSafe: boolean
    boundaryType: "api_call" | "message_queue" | "database" | "ffi" | string
  }

  export interface TaintFlow {
    id: string
    source: TaintSource
    sink: TaintSink
    flowPath: DataFlowStep[]
    vulnerabilityType:
      | "sql_injection"
      | "xss"
      | "command_injection"
      | "path_traversal"
      | "pii_leak"
      | "unencrypted_storage"
      | string
    severity: "low" | "medium" | "high" | "critical"
    isMitigated: boolean
    mitigationSteps?: DataFlowStep[]
  }

  export interface TaintSource {
    symbolName: string
    filePath: string
    language: string
    dataType: string
    sourceType: "user_input" | "database" | "api_response" | "file_read" | "env_var" | string
  }

  export interface TaintSink {
    symbolName: string
    filePath: string
    language: string
    sinkType: "database_write" | "http_response" | "log_output" | "shell_execution" | "file_write" | string
  }

  export interface DataFlow {
    id: string
    source: DataSource
    target: DataTarget
    steps: DataFlowStep[]
    dataModel: string // Reference to SharedDataModel
    transformations: DataTransformation[]
    security: SecurityMechanism[]
    performance: DataFlowPerformance
  }

  export interface DataFlowStep {
    filePath: string
    serviceName: string
    symbolName: string
    dataType: string
    language?: string
    metadata?: Record<string, any>
  }

  export interface DataSource {
    serviceId: string
    endpoint?: string
    language: string
    filePath: string
    dataFormat: string
  }

  export interface DataTarget {
    serviceId: string
    endpoint?: string
    language: string
    filePath: string
    expectedFormat: string
  }

  export interface SharedDataModel {
    id: string
    name: string
    schema: any // JSON Schema, Protobuf, etc.
    languages: string[] // Languages that use this model
    variations: ModelVariation[] // Language-specific variations
    validation: ValidationRule[]
  }

  export interface ModelVariation {
    language: string
    differences: string[] // How this language's version differs
    mappingRules: MappingRule[]
  }

  export interface DataTransformation {
    id?: string
    from?: string // Source format
    to?: string // Target format
    fromSymbol?: string
    toSymbol?: string
    transformationType?: string
    transformationMethods?: string[]
    sourceLanguage?: string
    targetLanguage?: string
    dataFormatChange?: string
    validationRules?: string[]
    transformerLocation?: SymbolReference
    lossless?: boolean // Is transformation lossless?
    performance: TransformationPerformance
  }

  // ======================== API COVERAGE ANALYSIS ========================

  export interface APICoverageAnalysis {
    totalEndpoints: number
    documentedEndpoints: number
    testedEndpoints: number
    securedEndpoints: number
    monitoredEndpoints: number
    versionedEndpoints: number
    coverage: APICoverage
    gaps: APIGap[]
  }

  export interface APICoverage {
    documentation: number // Percentage
    testing: number
    security: number
    monitoring: number
    versioning: number
    overall: number
  }

  export interface APIGap {
    type: "documentation" | "testing" | "security" | "monitoring" | "versioning"
    endpoints: ServiceEndpoint[]
    severity: "high" | "medium" | "low"
    recommendations: string[]
  }

  // ======================== MAIN ANALYSIS ENGINE ========================

  /**
   * Perform comprehensive cross-language analysis
   * This is the polyglot brain function - traces EVERYTHING!
   */

  /**
   * BRIDGE: Loads the polyglot intelligence directly from the SQLite brain database
   * to power advanced tools like migration and architecture visualization without needing full re-parsing.
   */
  export async function analyzePolyglotProjectFromDB(projectId: ProjectID): Promise<PolyglotProjectAnalysis> {
    log.info("🚀 Reconstructing Polyglot Intelligence from Brain Database", { projectId })

    // Dynamic import to avoid circular dependencies
    const { BrainDatabase } = await import("../brain/database")
    const { BrainSymbolTable, BrainRelationshipTable, BrainFileTable, BrainTaintFlowTable } = await import(
      "../brain/brain.sql"
    )
    const { eq, sql } = await import("drizzle-orm")

    const db = await BrainDatabase.getInstance(projectId)

    // 1. Fetch all symbols + file info
    const dbSymbols = await db
      .select({
        id: BrainSymbolTable.id,
        name: BrainSymbolTable.name,
        type: BrainSymbolTable.symbol_type,
        file: BrainFileTable.relative_path,
        language: BrainFileTable.language,
        line: BrainSymbolTable.line_start,
      })
      .from(BrainSymbolTable)
      .leftJoin(BrainFileTable, eq(BrainSymbolTable.file_id, BrainFileTable.id))
      .where(eq(BrainSymbolTable.project_id, projectId))

    // 2. Fetch all relationships
    const dbRels = await db
      .select({
        id: BrainRelationshipTable.id,
        source_id: BrainRelationshipTable.source_symbol_id,
        target_id: BrainRelationshipTable.target_symbol_id,
        type: BrainRelationshipTable.relationship_type,
      })
      .from(BrainRelationshipTable)
      .where(eq(BrainRelationshipTable.project_id, projectId))

    // 3. Fetch all taints
    const dbTaints = await db
      .select({
        id: BrainTaintFlowTable.id,
        source_id: BrainTaintFlowTable.source_symbol_id,
        sink_id: BrainTaintFlowTable.sink_symbol_id,
        source_type: BrainTaintFlowTable.source_type,
        sink_type: BrainTaintFlowTable.sink_type,
        vulnerability_type: BrainTaintFlowTable.vulnerability_type,
        severity: BrainTaintFlowTable.severity,
        is_mitigated: BrainTaintFlowTable.is_mitigated,
        // Read flow_path as raw text — the column is declared json mode but
        // legacy rows (and older writers) may hold '|||'-delimited strings
        // that JSON.parse would reject. Parsed defensively in the map below.
        flow_path: sql<string>`${BrainTaintFlowTable.flow_path}`,
      })
      .from(BrainTaintFlowTable)
      .where(eq(BrainTaintFlowTable.project_id, projectId))

    // Row shapes of the three projections above, declared because
    // `BrainDatabase.getInstance()` is `Promise<any>` and therefore carries no
    // element type: the `.map`/`.filter` callbacks below were all implicitly
    // `any`, and `symbolById` inferred as a map of `{}`, so every `src?.file` /
    // `sourceSym?.name` read through it failed. With the rows named, the Map is
    // `Map<string, SymbolRow>` and each field access is checked. The shapes
    // mirror the `.select({...})` projections exactly.
    type SymbolRow = {
      id: string
      name: string
      type: string
      /** relative_path comes from a LEFT JOIN, so it is null for an orphan symbol. */
      file: string | null
      language: string | null
      line: number
    }
    type RelRow = {
      id: string
      type: string
      source_id: string | null
      target_id: string | null
    }
    type TaintRow = {
      id: string
      source_id: string | null
      sink_id: string | null
      source_type: string
      sink_type: string
      vulnerability_type: string
      severity: string
      /**
       * The column is `integer({ mode: "boolean" })` (src/brain/brain.sql.ts), so
       * drizzle already hands back a real boolean. Declaring it `number` — the
       * obvious guess from the storage class — is what made
       * `t.is_mitigated || false` look like it produced `number | false` and
       * stopped matching `TaintFlow.isMitigated: boolean`. The declared type now
       * matches the value that has always been there.
       */
      is_mitigated: boolean
      /**
       * Read as raw text on purpose — the column is json mode but legacy rows
       * hold '|||'-delimited strings, so the parsed array below has to cope with
       * a non-array. See the defensive parse in the map.
       */
      flow_path: string
    }
    const symbols = dbSymbols as SymbolRow[]
    const rels = dbRels as RelRow[]
    const taints = dbTaints as TaintRow[]

    // Build lookup map: O(1) instead of O(N) find() per relationship
    const symbolById = new Map<string, SymbolRow>(symbols.map((s) => [s.id, s]))

    // 4. Reconstruct CrossLanguageSymbols
    const crossLanguageSymbols = symbols.map(
      (s) =>
        ({
          id: s.id,
          name: s.name,
          type: s.type as any,
          languages: s.language ? [s.language] : ["unknown"],
          definitions: [
            {
              language: s.language || "unknown",
              filePath: s.file || "unknown",
              range: { startLine: s.line || 0, endLine: s.line || 0, startColumn: 0, endColumn: 0 },
              symbolKind: s.type as any,
              confidence: 1.0,
              context: { isDefinition: true },
            },
          ],
          usages: [],
          contracts: [],
          metadata: {},
        }) as any,
    )

    // 5. Reconstruct CrossLanguageRelationships
    const crossLanguageRelationships = rels.map(
      (r) => {
        const src = r.source_id ? symbolById.get(r.source_id) : undefined
        const tgt = r.target_id ? symbolById.get(r.target_id) : undefined
        return {
          id: r.id,
          type: r.type as any,
          source: {
            symbolId: r.source_id,
            filePath: src?.file || "unknown",
            language: "unknown",
            range: { startLine: 0, endLine: 0, startColumn: 0, endColumn: 0 },
            symbolKind: "unknown" as any,
            confidence: 1.0,
            context: { isDefinition: false },
          },
          target: {
            symbolId: r.target_id,
            filePath: tgt?.file || "unknown",
            language: "unknown",
            range: { startLine: 0, endLine: 0, startColumn: 0, endColumn: 0 },
            symbolKind: "unknown" as any,
            confidence: 1.0,
            context: { isDefinition: false },
          },
          strength: 0.8,
          bidirectional: false,
          metadata: {},
        } as any
      },
    )

    // 6. Reconstruct TaintFlows
    //
    // NOT `TaintFlow[]`, and the difference is a real defect this directive was
    // hiding rather than a stylistic choice. `parseFlowPath` returns the stored
    // path SEGMENTS as `string[]` — it has to, because the column holds either a
    // json-mode array or a legacy '|||'-joined string, and there is no structure
    // in either to build a DataFlowStep from. `TaintFlow.flowPath` however
    // declares `DataFlowStep[]`, so every reconstructed flow carries strings
    // where the interface promises objects, and a consumer reading
    // `flowPath[0].filePath` would silently get undefined.
    //
    // Reshaping the segments into DataFlowStep objects here would invent
    // structure the indexer never recorded, so the value is left exactly as it is
    // and the real shape is named instead. `Omit` keeps every OTHER field
    // checked against `TaintFlow`, so only the one known-wrong field is
    // exempt. Nothing reads this field today (`flowPath` appears only at this
    // write and in the unrelated data-flow-analyzer writer), which is why it is
    // latent rather than live — the fix belongs in either the stored format or
    // `TaintFlow.flowPath`'s declared type, both outside this change.
    type ReconstructedTaintFlow = Omit<TaintFlow, "flowPath"> & { flowPath: string[] }
    const reconstructedTaintFlows: ReconstructedTaintFlow[] = taints
      .filter((t) => t.source_id && t.sink_id && t.source_type !== "unresolved" && t.sink_type !== "unresolved")
      .map((t) => {
        const sourceSym = t.source_id ? symbolById.get(t.source_id) : undefined
        const sinkSym = t.sink_id ? symbolById.get(t.sink_id) : undefined

        return {
          id: t.id,
          source: {
            symbolName: sourceSym?.name || "unknown",
            filePath: sourceSym?.file || "unknown",
            language: sourceSym?.language || "unknown",
            dataType: "unknown",
            sourceType: t.source_type,
          },
          sink: {
            symbolName: sinkSym?.name || "unknown",
            filePath: sinkSym?.file || "unknown",
            language: sinkSym?.language || "unknown",
            sinkType: t.sink_type,
          },
          vulnerabilityType: t.vulnerability_type,
          // The stored value passes through unchanged, on purpose. The column is
          // free text (`text().notNull()`, commented "critical"/"high"/
          // "medium"/"low") and this function exists to report what the indexer
          // actually recorded — normalising an out-of-band value to a default
          // here would quietly rewrite a security finding. Asserted to the
          // declared union rather than to `any`, so the pass-through is visible
          // and a caller reading this line knows the value is unchecked.
          severity: (t.severity || "high") as TaintFlow["severity"],
          isMitigated: t.is_mitigated || false,
          flowPath: parseFlowPath(t.flow_path),
        }
      })

    log.info("📊 Reconstructed polyglot intelligence", {
      symbols: crossLanguageSymbols.length,
      relationships: crossLanguageRelationships.length,
      taints: reconstructedTaintFlows.length,
    })

    return {
      crossLanguageSymbols,
      crossLanguageRelationships,
      serviceTopology: { services: [], dependencies: [], communicationPaths: [], dataFlows: [], deploymentUnits: [] },
      dataFlowAnalysis: { flows: [], boundaries: [], bottlenecks: [], taintFlows: reconstructedTaintFlows } as any,
      apiCoverage: { endpoints: [], coveredEndpoints: [], coveragePercentage: 0 } as any,
      securityAnalysis: { vulnerabilities: [], riskScore: 100 } as any,
      performanceAnalysis: { hotspots: [], averageLatency: 0 } as any,
      architecturalInsights: [],
      complianceReport: { isCompliant: true, violations: [] } as any,
      projectMetrics: { totalCrossLanguageInteractions: dbRels.length, polyglotScore: 80 } as any,
    }
  }

  export async function analyzePolyglotProject(
    fileResults: Map<string, ASTEngine.ParseResult>,
    projectId?: ProjectID,
  ): Promise<PolyglotProjectAnalysis> {
    log.info("🚀 Starting Cross-Language Intelligence Analysis", {
      totalFiles: fileResults.size,
      languages: Array.from(new Set(Array.from(fileResults.values()).map((r) => r.language))),
    })

    // PHASE 1: 🔍 SYMBOL DISCOVERY - Find all cross-language symbols
    const crossLanguageSymbols = await discoverCrossLanguageSymbols(fileResults)
    log.info("📊 Cross-language symbols discovered", { count: crossLanguageSymbols.length })

    // PHASE 2: 🌐 RELATIONSHIP MAPPING - Map ALL relationships
    const crossLanguageRelationships = await mapCrossLanguageRelationships(fileResults, crossLanguageSymbols)
    log.info("🔗 Cross-language relationships mapped", { count: crossLanguageRelationships.length })

    // PHASE 3: 🏗️ SERVICE TOPOLOGY - Build service architecture map
    const serviceTopology = await buildServiceTopology(fileResults, crossLanguageSymbols, crossLanguageRelationships)
    log.info("🏛️ Service topology analyzed", { services: serviceTopology.services.length })

    // PHASE 4: 🌊 DATA FLOW ANALYSIS - Trace all data movements
    const dataFlowAnalysis = await analyzeDataFlows(fileResults, serviceTopology, crossLanguageSymbols)
    log.info("💧 Data flow analysis completed", { flows: dataFlowAnalysis.dataFlows.length })

    // PHASE 5: 📋 API COVERAGE - Comprehensive API analysis
    const apiCoverage = await analyzeAPICoverage(serviceTopology, fileResults)
    log.info("📊 API coverage analyzed", { coverage: apiCoverage.coverage.overall })

    // PHASE 5.5: 🤝 API CONTRACT VALIDATION - Cross-language God-Mode Check
    const { APIContractValidator } = await import("./api-contract-validator")
    const { endpoints, callers } = APIContractValidator.extractContracts(
      serviceTopology,
      crossLanguageRelationships,
      crossLanguageSymbols,
    )
    const apiContractValidation = APIContractValidator.validateContracts(endpoints, callers)
    log.info("🤝 API contract validation completed", {
      valid: apiContractValidation.validContracts,
      broken: apiContractValidation.breakingChanges.length,
    })

    // PHASE 6: 🔒 SECURITY ANALYSIS - Cross-language security assessment
    const securityAnalysis = await performCrossLanguageSecurityAnalysis(fileResults, serviceTopology, dataFlowAnalysis)
    log.info("🛡️ Security analysis completed", { threats: securityAnalysis.threats.length })

    // PHASE 7: ⚡ PERFORMANCE ANALYSIS - System performance assessment
    const performanceAnalysis = await analyzeCrossLanguagePerformance(
      serviceTopology,
      dataFlowAnalysis,
      crossLanguageRelationships,
    )
    log.info("🚀 Performance analysis completed", { score: performanceAnalysis.overallScore })

    // PHASE 8: 🧠 ARCHITECTURAL INSIGHTS - Generate intelligent insights
    const architecturalInsights = await generateArchitecturalInsights(
      serviceTopology,
      dataFlowAnalysis,
      securityAnalysis,
      performanceAnalysis,
    )
    log.info("💡 Architectural insights generated", { insights: architecturalInsights.length })

    // PHASE 9: ✅ COMPLIANCE REPORT - Generate compliance assessment
    const complianceReport = await generateComplianceReport(serviceTopology, securityAnalysis, apiCoverage)
    log.info("📋 Compliance report generated", { score: complianceReport.overallScore })

    // PHASE 10: 📈 PROJECT METRICS - Calculate comprehensive metrics
    const projectMetrics = calculateProjectMetrics(
      fileResults,
      crossLanguageSymbols,
      crossLanguageRelationships,
      serviceTopology,
      securityAnalysis,
      dataFlowAnalysis,
      apiCoverage,
    )
    log.info("📊 Project metrics calculated", { complexity: projectMetrics.complexityScore })

    const result: PolyglotProjectAnalysis = {
      crossLanguageSymbols,
      crossLanguageRelationships,
      serviceTopology,
      dataFlowAnalysis,
      apiCoverage,
      securityAnalysis,
      performanceAnalysis,
      architecturalInsights,
      complianceReport,
      projectMetrics,
      apiContractValidation,
    }

    log.info("🎉 Cross-Language Analysis COMPLETE!", {
      totalSymbols: crossLanguageSymbols.length,
      totalRelationships: crossLanguageRelationships.length,
      services: serviceTopology.services.length,
      overallComplexity: projectMetrics.complexityScore,
    })

    // PHASE 11: 💾 PERSIST TO BRAIN DATABASE - Save all intelligence to queryable database
    if (projectId) {
      try {
        log.info("💾 Persisting cross-language intelligence to Brain Database", { projectId })

        // Build fileMap: filePath → fileId mapping from actual database
        const db = await BrainDatabase.getInstance(projectId)
        const fileMap = new Map<string, string>()

        // Get or create file IDs for all analyzed files
        for (const [filePath] of fileResults) {
          const fileId = await findOrCreateFileId(db, projectId, filePath)
          fileMap.set(filePath, fileId)
        }

        const persistResult = await CrossLanguageIntelligencePersister.persistToDatabase(projectId, result, fileMap)

        log.info("✅ Cross-language intelligence persisted successfully!", {
          symbolsCreated: persistResult.symbolsCreated,
          symbolsUpdated: persistResult.symbolsUpdated,
          relationshipsCreated: persistResult.relationshipsCreated,
          relationshipsUpdated: persistResult.relationshipsUpdated,
          servicesCreated: persistResult.servicesCreated,
          dataFlowsCreated: persistResult.dataFlowsCreated,
          errors: persistResult.errors.length,
        })
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        log.error("❌ Failed to persist cross-language intelligence", {
          error: err.message,
          stack: err.stack,
        })
        // Don't fail the entire analysis if persistence fails
      }
    } else {
      log.warn("⚠️ No projectId provided - skipping Brain Database persistence")
    }

    return result
  }

  // ======================== IMPLEMENTATION STUBS ========================
  // These will be implemented in separate files for maintainability

  async function discoverCrossLanguageSymbols(
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<CrossLanguageSymbol[]> {
    // Use our symbol discovery implementation
    return CrossLanguageSymbolDiscovery.discoverCrossLanguageSymbols(fileResults)
  }

  async function mapCrossLanguageRelationships(
    fileResults: Map<string, ASTEngine.ParseResult>,
    symbols: CrossLanguageSymbol[],
  ): Promise<CrossLanguageRelationship[]> {
    // Use our insane relationship mapping implementation
    return CrossLanguageRelationshipMapper.mapCrossLanguageRelationships(fileResults, symbols)
  }

  async function buildServiceTopology(
    fileResults: Map<string, ASTEngine.ParseResult>,
    symbols: CrossLanguageSymbol[],
    relationships: CrossLanguageRelationship[],
  ): Promise<ServiceTopology> {
    // Use our ultimate service topology builder
    return ServiceTopologyBuilder.buildServiceTopology(fileResults, symbols, relationships)
  }

  async function analyzeDataFlows(
    fileResults: Map<string, ASTEngine.ParseResult>,
    topology: ServiceTopology,
    symbols: CrossLanguageSymbol[],
  ): Promise<DataFlowAnalysis> {
    // Use our data flow analyzer
    return DataFlowAnalyzer.analyzeDataFlows(fileResults, topology, symbols)
  }

  async function analyzeAPICoverage(
    topology: ServiceTopology,
    fileResults: Map<string, ASTEngine.ParseResult>,
  ): Promise<APICoverageAnalysis> {
    // Use our ultimate API coverage analyzer
    return APICoverageAnalyzer.analyzeAPICoverage(topology, fileResults)
  }

  /**
   * Find or create a file ID in the brain database
   */
  async function findOrCreateFileId(db: any, projectId: ProjectID, filePath: string): Promise<string> {
    const { randomUUID } = await import("crypto")
    const { eq, and } = await import("drizzle-orm")
    const { BrainFileTable } = await import("../brain/brain.sql")

    // Try to find existing file
    const results = await db
      .select({ id: BrainFileTable.id })
      .from(BrainFileTable)
      .where(and(eq(BrainFileTable.project_id, projectId), eq(BrainFileTable.path, filePath)))
      .limit(1)

    if (results[0]) return results[0].id

    // Create new file entry
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
      content: null,
      system: null,
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

  // ======================== STUB IMPLEMENTATIONS ========================
  // These provide basic functionality until full implementation

  async function performCrossLanguageSecurityAnalysis(
    fileResults: Map<string, ASTEngine.ParseResult>,
    topology: ServiceTopology,
    dataFlow: DataFlowAnalysis,
  ): Promise<CrossLanguageSecurityAnalysis> {
    const threats: SecurityThreat[] = []
    const vulnerabilities: SecurityVulnerability[] = []
    const mitigations: SecurityMitigation[] = []

    // Basic security analysis
    for (const service of topology.services) {
      // Check for unsecured endpoints
      for (const endpoint of service.endpoints) {
        if (!endpoint.security || endpoint.security.length === 0) {
          threats.push({
            id: `unsecured_endpoint_${service.id}_${endpoint.path}`,
            name: "Unsecured API Endpoint",
            type: "authentication",
            severity: "high",
            affectedComponents: [service.id],
            likelihood: 0.8,
            impact: 0.7,
            description: `Endpoint ${endpoint.path} lacks security mechanisms`,
          })
        }
      }
    }

    return {
      threats,
      vulnerabilities,
      mitigations,
      compliance: [],
      securityScore: Math.max(0, 100 - threats.length * 10),
    }
  }

  async function analyzeCrossLanguagePerformance(
    topology: ServiceTopology,
    dataFlow: DataFlowAnalysis,
    relationships: CrossLanguageRelationship[],
  ): Promise<CrossLanguagePerformanceAnalysis> {
    const bottlenecks: PerformanceBottleneck[] = []
    const optimizations: PerformanceOptimization[] = []

    // Analyze service performance
    for (const service of topology.services) {
      if (service.endpoints.length > 20) {
        bottlenecks.push({
          id: `high_endpoint_count_${service.id}`,
          component: service.id,
          type: "network",
          severity: "medium",
          impact: "High endpoint count may impact performance",
          recommendations: ["Consider endpoint consolidation", "Implement caching"],
        })
      }
    }

    return {
      overallScore: Math.max(0, 100 - bottlenecks.length * 15),
      bottlenecks,
      optimizations,
      scalabilityAnalysis: {
        horizontalScaling: { feasible: true, maxScale: 10, limitingFactors: [], cost: "medium" },
        verticalScaling: { feasible: true, maxScale: 5, limitingFactors: [], cost: "low" },
        bottlenecks: [],
        recommendations: [],
      },
      resourceUtilization: {
        cpu: { average: 60, peak: 80, efficiency: "medium", recommendations: [] },
        memory: { average: 70, peak: 85, efficiency: "medium", recommendations: [] },
        storage: { average: 50, peak: 70, efficiency: "high", recommendations: [] },
        network: { average: 40, peak: 60, efficiency: "high", recommendations: [] },
      },
    }
  }

  async function generateArchitecturalInsights(
    topology: ServiceTopology,
    dataFlow: DataFlowAnalysis,
    security: CrossLanguageSecurityAnalysis,
    performance: CrossLanguagePerformanceAnalysis,
  ): Promise<ArchitecturalInsight[]> {
    const insights: ArchitecturalInsight[] = []

    // Microservices architecture insights
    if (topology.services.length > 10) {
      insights.push({
        id: "microservices_complexity",
        category: "architecture",
        title: "High Microservices Complexity",
        description: "Large number of microservices may increase operational complexity",
        severity: "warning",
        affectedComponents: topology.services.map((s) => s.id),
        recommendations: [
          "Consider service consolidation where appropriate",
          "Implement service mesh for better management",
          "Ensure proper monitoring and observability",
        ],
        priority: "medium",
      })
    }

    // Security insights
    if (security.securityScore < 70) {
      insights.push({
        id: "security_concerns",
        category: "security",
        title: "Security Score Below Recommended Threshold",
        description: "Multiple security issues detected across services",
        severity: `warning`,
        affectedComponents: [],
        recommendations: [
          "Implement authentication for all endpoints",
          "Add authorization checks",
          "Enable HTTPS/TLS encryption",
        ],
        priority: "high",
      })
    }

    return insights
  }

  async function generateComplianceReport(
    topology: ServiceTopology,
    security: CrossLanguageSecurityAnalysis,
    apiCoverage: APICoverageAnalysis,
  ): Promise<ComplianceReport> {
    const standards: ComplianceStandard[] = [
      {
        name: "API Security",
        version: "1.0",
        applicable: true,
        score: apiCoverage.coverage.security,
        requirements: [],
      },
    ]

    return {
      overallScore: Math.round((apiCoverage.coverage.overall + security.securityScore) / 2),
      standards,
      violations: [],
      recommendations: [],
    }
  }

  function calculateProjectMetrics(
    fileResults: Map<string, ASTEngine.ParseResult>,
    symbols: CrossLanguageSymbol[],
    relationships: CrossLanguageRelationship[],
    topology: ServiceTopology,
    securityAnalysis: CrossLanguageSecurityAnalysis,
    dataFlowAnalysis: DataFlowAnalysis,
    apiCoverage: APICoverageAnalysis,
  ): ProjectMetrics {
    const healthMonitor = new ArchitecturalHealthMonitor()

    // Circular Dependency Detection
    const cycles = healthMonitor.detectCircularDependencies(relationships)

    // Service Coupling (Instability / Abstractness)
    const couplingMetrics = healthMonitor.calculateServiceCoupling(topology)

    // API Contract Drift
    const drift = healthMonitor.detectContractDrift(topology, relationships, symbols)

    // Performance Bottlenecks
    const bottlenecks = healthMonitor.predictPerformanceBottlenecks(topology, dataFlowAnalysis)

    // Security Surface Area Score
    const securityScore = healthMonitor.calculateSecuritySurfaceArea(securityAnalysis, topology)

    const languages = Array.from(new Set(Array.from(fileResults.values()).map((r) => r.language || "unknown")))
    const languageDistribution: LanguageMetric[] = languages.map((lang) => {
      const langFiles = Array.from(fileResults.values()).filter((r) => r.language === lang)
      return {
        language: lang,
        fileCount: langFiles.length,
        lineCount: langFiles.reduce((sum, f) => sum + (f.metadata?.linesOfCode || 0), 0),
        complexityAverage: langFiles.reduce((sum, f) => sum + (f.metadata?.complexity || 1), 0) / langFiles.length,
        testCoverage: apiCoverage.coverage.testing, // Using global API test coverage as a proxy for now
        codeQuality: 75 + (drift.driftDetected ? -10 : 0),
      }
    })

    const totalLines = languageDistribution.reduce((sum, l) => sum + l.lineCount, 0)
    const avgComplexity =
      languageDistribution.reduce((sum, l) => sum + l.complexityAverage, 0) / (languages.length || 1)

    return {
      complexityScore: Math.min(100, Math.floor(avgComplexity * 5 + relationships.length * 0.1)),
      maintainabilityScore: Math.max(0, 100 - cycles.length * 5 - bottlenecks.length * 2),
      technicalDebtScore: Math.min(100, cycles.length * 10 + drift.drifts.length * 5),
      codeQualityScore: securityScore,
      languageDistribution,
      serviceMetrics: topology.services.map((s) => {
        const coupling = couplingMetrics[s.id] || { instability: 0, abstractness: 0, distance: 0 }
        return {
          serviceId: s.id,
          endpointCount: s.endpoints.length,
          dependencyCount: s.dependencies.length,
          complexity: Math.min(100, s.endpoints.length * 5 + s.dependencies.length * 10),
          maintainability: Math.max(0, 100 - coupling.distance * 100), // High distance = low maintainability
          performance: bottlenecks.some((b) => b.includes(s.name)) ? 40 : 90,
        }
      }),
      dependencyMetrics: {
        totalDependencies: relationships.length,
        circularDependencies: cycles.length, // Natively detected!
        outdatedDependencies: 0, // Would need package.json analysis
        securityVulnerabilities: securityAnalysis.threats.length, // Natively detected!
        licenseIssues: 0,
      },
    }
  }

  // ======================== COMPREHENSIVE TYPE DEFINITIONS ========================

  export interface ServiceDependency {
    sourceServiceId: string
    targetServiceId: string
    dependencyType: string // "api_dependency", "data_dependency", etc.
    strength: number // 0.0 to 1.0
    metadata: {
      communicationMechanism: string
      dataFormat: string
      criticality: string
      securityRequirements: string[]
    }
  }

  export interface CommunicationPath {
    id: string
    name: string
    mechanism: string // HTTP, gRPC, Message Queue, etc.
    sourceServices: string[] // Service IDs
    targetServices: string[] // Service IDs
    protocols: string[] // Communication protocols used
    protocol?: string
    from?: string
    to?: string
    encrypted?: boolean
    dataFormats: string[] // Data formats exchanged
    reliability: "high" | "medium" | "low"
    performance: CommunicationPerformance
    security: CommunicationSecurity
  }

  export interface CommunicationPerformance {
    latency: "low" | "medium" | "high"
    throughput: "low" | "medium" | "high"
    overhead: "low" | "medium" | "high"
    bottlenecks: string[]
  }

  export interface CommunicationSecurity {
    encryption: boolean
    authentication: boolean
    authorization: boolean
    vulnerabilities: string[]
  }

  export interface DeploymentUnit {
    id: string
    name: string
    type: string // docker, kubernetes, terraform, etc.
    filePath: string
    services: string[] // Service IDs deployed by this unit
    environment: string // production, staging, development
    resources: DeploymentResources
    dependencies: string[] // External dependencies
    scaling: DeploymentScaling
    networkExposure?: "public" | "internal" | "private" | string
    hasLoadBalancer?: boolean
  }

  export interface DeploymentResources {
    cpu: "low" | "medium" | "high"
    memory: "low" | "medium" | "high"
    storage: "low" | "medium" | "high"
    network: "standard" | "high_bandwidth" | "low_latency"
  }

  export interface DeploymentScaling {
    horizontal: boolean
    vertical: boolean
    autoScaling: boolean
    minReplicas: number
    maxReplicas: number
  }

  export interface SecurityRequirement {
    type: string // "jwt", "oauth", "api_key", etc.
    mandatory: boolean
    implementation?: string
  }

  export interface SecurityMechanism {
    type: string
    enabled: boolean
    strength: "low" | "medium" | "high"
  }

  export interface DataFlowPerformance {
    throughput: "low" | "medium" | "high"
    latency: "low" | "medium" | "high"
    scalability: string
    bottlenecks: string[]
  }

  export interface ValidationRule {
    field: string
    type: string // "required", "type_check", "format", etc.
    constraint: any
    message: string
  }

  export interface MappingRule {
    sourceField: string
    targetField: string
    transformation?: string // Transformation function/expression
    defaultValue?: any
  }

  export interface TransformationPerformance {
    latencyOverhead?: "low" | "medium" | "high"
    memoryUsage?: "low" | "medium" | "high"
    cpuIntensive?: boolean
    complexity?: string
    latencyImpact?: string
    memoryImpact?: string
  }

  export interface DataPersistence {
    id: string
    type: "database" | "file" | "cache" | "message_queue" | string
    operation?: string
    location:
      | string
      | {
          filePath: string
          language?: string
          range?: ASTEngine.UniversalSymbol["range"]
        }
    dataTypes?: string[]
    storageSystem?: string
    dataModels?: string[] // IDs of data models persisted here
    consistency: "strong" | "eventual" | "weak" | string
    durability?: "permanent" | "temporary" | "volatile"
    backup?: boolean
    encryption?: boolean
    performance?: Record<string, any>
  }

  export interface SecurityBoundary {
    id: string
    name?: string
    type?: "service" | "network" | "data" | "process" | "Firewall" | string
    location?: {
      serviceName?: string
      endpointPath?: string
      filePath?: string
    }
    mechanism?: string
    strength?: "low" | "medium" | "high" | "High" | string
    requirements?: string[]
    components?: string[] // IDs of components within this boundary
    securityLevel?: "public" | "internal" | "restricted" | "confidential"
    accessControls?: string[] // Access control mechanisms
    threats?: string[] // Potential security threats
    mitigations?: string[] // Security mitigations in place
  }

  export interface CrossLanguageSecurityAnalysis {
    threats: SecurityThreat[]
    vulnerabilities: SecurityVulnerability[]
    mitigations: SecurityMitigation[]
    compliance: ComplianceStatus[]
    securityScore: number // 0-100
  }

  export interface SecurityThreat {
    id: string
    name: string
    type: string // "injection", "broken_auth", etc.
    severity: "low" | "medium" | "high" | "critical"
    affectedComponents: string[]
    likelihood: number // 0.0 to 1.0
    impact: number // 0.0 to 1.0
    description: string
  }

  export interface SecurityVulnerability {
    id: string
    cve?: string // CVE identifier if available
    component: string
    description: string
    severity: "low" | "medium" | "high" | "critical"
    fixAvailable: boolean
    patchVersion?: string
  }

  export interface SecurityMitigation {
    id: string
    name: string
    type: string
    effectiveness: number // 0.0 to 1.0
    implemented: boolean
    threats: string[] // Threat IDs this mitigation addresses
  }

  export interface ComplianceStatus {
    standard: string // "GDPR", "SOX", "HIPAA", etc.
    compliant: boolean
    gaps: string[]
    recommendations: string[]
  }

  export interface CrossLanguagePerformanceAnalysis {
    overallScore: number // 0-100
    bottlenecks: PerformanceBottleneck[]
    optimizations: PerformanceOptimization[]
    scalabilityAnalysis: ScalabilityAnalysis
    resourceUtilization: ResourceUtilization
  }

  export interface PerformanceBottleneck {
    id: string
    component: string
    type: "cpu" | "memory" | "io" | "network" | "database"
    severity: "low" | "medium" | "high" | "critical"
    impact: string
    recommendations: string[]
  }

  export interface PerformanceOptimization {
    id: string
    name: string
    component: string
    type: string
    expectedImprovement: number // Percentage improvement
    effort: "low" | "medium" | "high"
    priority: "low" | "medium" | "high"
  }

  export interface ScalabilityAnalysis {
    horizontalScaling: ScalingAssessment
    verticalScaling: ScalingAssessment
    bottlenecks: string[]
    recommendations: string[]
  }

  export interface ScalingAssessment {
    feasible: boolean
    maxScale: number // Maximum scale factor
    limitingFactors: string[]
    cost: "low" | "medium" | "high"
  }

  export interface ResourceUtilization {
    cpu: UtilizationMetric
    memory: UtilizationMetric
    storage: UtilizationMetric
    network: UtilizationMetric
  }

  export interface UtilizationMetric {
    average: number // Percentage
    peak: number // Percentage
    efficiency: "low" | "medium" | "high"
    recommendations: string[]
  }

  export interface ArchitecturalInsight {
    id: string
    category: string // "design_pattern", "anti_pattern", "optimization"
    title: string
    description: string
    severity: "info" | "warning" | "error"
    affectedComponents: string[]
    recommendations: string[]
    priority: "low" | "medium" | "high"
  }

  export interface ComplianceReport {
    overallScore: number // 0-100
    standards: ComplianceStandard[]
    violations: ComplianceViolation[]
    recommendations: ComplianceRecommendation[]
  }

  export interface ComplianceStandard {
    name: string
    version: string
    applicable: boolean
    score: number // 0-100
    requirements: ComplianceRequirement[]
  }

  export interface ComplianceRequirement {
    id: string
    description: string
    met: boolean
    evidence: string[]
    gaps: string[]
  }

  export interface ComplianceViolation {
    id: string
    standard: string
    requirement: string
    severity: "low" | "medium" | "high" | "critical"
    component: string
    description: string
    remediation: string[]
  }

  export interface ComplianceRecommendation {
    id: string
    category: string
    description: string
    priority: "low" | "medium" | "high"
    effort: "low" | "medium" | "high"
    impact: "low" | "medium" | "high"
  }

  export interface ProjectMetrics {
    complexityScore: number // 0-100
    maintainabilityScore: number // 0-100
    technicalDebtScore: number // 0-100
    codeQualityScore: number // 0-100
    languageDistribution: LanguageMetric[]
    serviceMetrics: ServiceMetric[]
    dependencyMetrics: DependencyMetric
  }

  export interface LanguageMetric {
    language: string
    fileCount: number
    lineCount: number
    complexityAverage: number
    testCoverage: number
    codeQuality: number
  }

  export interface ServiceMetric {
    serviceId: string
    endpointCount: number
    dependencyCount: number
    complexity: number
    maintainability: number
    performance: number
  }

  export interface DependencyMetric {
    totalDependencies: number
    circularDependencies: number
    outdatedDependencies: number
    securityVulnerabilities: number
    licenseIssues: number
  }
}
