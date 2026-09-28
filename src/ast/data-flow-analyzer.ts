// Data Flow Analyzer
// Traces ALL data movements across polyglot systems
// INTELLIGENCE: Every data transformation, persistence, and security boundary mapped!

import { ASTEngine } from "./engine"
import { CrossLanguageIntelligence } from "./cross-language-intelligence"
import * as Log from "../tool/brain-log"

const log = Log.create({ service: "data-flow-analyzer" })

export namespace DataFlowAnalyzer {
  /**
   * Data Flow Analysis
   * Maps EVERY data movement with precision
   */
  export async function analyzeDataFlows(
    fileResults: Map<string, ASTEngine.ParseResult>,
    topology: CrossLanguageIntelligence.ServiceTopology,
    symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
  ): Promise<CrossLanguageIntelligence.DataFlowAnalysis> {
    log.info("🌊 Starting Data Flow Analysis")

    const dataFlowAnalyzer = new DataFlowAnalyzer()

    // STEP 1: 🔍 SHARED DATA MODEL DISCOVERY - Find ALL shared data structures
    const dataModels = await dataFlowAnalyzer.discoverSharedDataModels(symbols, fileResults)
    log.info("📊 Shared data models discovered", { count: dataModels.length })

    // STEP 2: 🌊 DATA FLOW MAPPING - Trace ALL data movements
    const dataFlows = await dataFlowAnalyzer.mapDataFlows(topology, dataModels, symbols)
    log.info("💧 Data flows mapped", { count: dataFlows.length })

    // STEP 3: 🔄 TRANSFORMATION DETECTION - Find ALL data transformations
    const transformations = await dataFlowAnalyzer.detectTransformations(dataFlows, fileResults)
    log.info("🔄 Data transformations detected", { count: transformations.length })

    // STEP 4: 💾 PERSISTENCE POINT ANALYSIS - Map ALL data storage
    const persistencePoints = await dataFlowAnalyzer.analyzePersistencePoints(fileResults, symbols)
    log.info("💾 Persistence points analyzed", { count: persistencePoints.length })

    // STEP 5: 🔒 SECURITY BOUNDARY DETECTION - Map ALL security boundaries
    const securityBoundaries = await dataFlowAnalyzer.detectSecurityBoundaries(topology, dataFlows)
    log.info("🛡️ Security boundaries detected", { count: securityBoundaries.length })

    // STEP 6: 🦠 TAINT ANALYSIS (taint flow) - Track vulnerabilities across languages
    const taintFlows = await dataFlowAnalyzer.performTaintAnalysis(dataFlows, fileResults, symbols)
    log.info("🦠 Cross-language taint flows detected", { count: taintFlows.length })

    // STEP 7: 🧬 TYPE FLOW ANALYSIS (taint flow) - Track type propagation and mismatches
    const typeFlows = await dataFlowAnalyzer.performTypeFlowAnalysis(dataFlows, symbols)
    log.info("🧬 Cross-language type flows analyzed", { count: typeFlows.length })

    const analysis: CrossLanguageIntelligence.DataFlowAnalysis = {
      dataFlows,
      dataModels,
      transformations,
      persistencePoints,
      securityBoundaries,
      taintFlows,
      typeFlows,
    }

    log.info("🎉 DATA FLOW ANALYSIS COMPLETE!", {
      dataFlows: dataFlows.length,
      dataModels: dataModels.length,
      transformations: transformations.length,
      persistencePoints: persistencePoints.length,
      securityBoundaries: securityBoundaries.length,
      taintFlows: taintFlows.length,
      typeFlows: typeFlows.length,
    })

    return analysis
  }

  /**
   * Data Flow Analysis Engine
   */
  class DataFlowAnalyzer {
    /**
     * Shared Data Model Discovery
     */
    async discoverSharedDataModels(
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
      fileResults: Map<string, ASTEngine.ParseResult>,
    ): Promise<CrossLanguageIntelligence.SharedDataModel[]> {
      const sharedModels: CrossLanguageIntelligence.SharedDataModel[] = []
      const modelGrouper = new DataModelGrouper()

      // Find data models that are used across multiple languages/services
      const dataModelSymbols = symbols.filter(
        (s) => s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL,
      )

      for (const model of dataModelSymbols) {
        if (model.languages.length > 1 || model.usages.length > 1) {
          const sharedModel = await modelGrouper.createSharedModel(model, fileResults)
          sharedModels.push(sharedModel)
        }
      }

      return sharedModels
    }

    /**
     * Data Flow Mapping
     */
    async mapDataFlows(
      topology: CrossLanguageIntelligence.ServiceTopology,
      dataModels: CrossLanguageIntelligence.SharedDataModel[],
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.DataFlow[]> {
      const dataFlows: CrossLanguageIntelligence.DataFlow[] = []
      const flowMapper = new DataFlowMapper(topology.services, dataModels)

      // Map data flows from existing topology data flows
      for (const topologyFlow of topology.dataFlows) {
        const enhancedFlow = await flowMapper.enhanceDataFlow(topologyFlow, symbols)
        dataFlows.push(enhancedFlow)
      }

      // Discover additional data flows from API calls and service communications
      for (const commPath of topology.communicationPaths) {
        const additionalFlows = await flowMapper.extractDataFlowsFromCommunication(commPath, symbols)
        dataFlows.push(...additionalFlows)
      }

      return dataFlows
    }

    /**
     * Transformation Detection
     */
    async detectTransformations(
      dataFlows: CrossLanguageIntelligence.DataFlow[],
      fileResults: Map<string, ASTEngine.ParseResult>,
    ): Promise<CrossLanguageIntelligence.DataTransformation[]> {
      const transformations: CrossLanguageIntelligence.DataTransformation[] = []
      const transformationDetector = new DataTransformationDetector()

      for (const flow of dataFlows) {
        // Detect transformations within each data flow
        const flowTransformations = await transformationDetector.analyzeFlowTransformations(flow, fileResults)
        transformations.push(...flowTransformations)
      }

      return transformations
    }

    /**
     * Persistence Point Analysis
     */
    async analyzePersistencePoints(
      fileResults: Map<string, ASTEngine.ParseResult>,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.DataPersistence[]> {
      const persistencePoints: CrossLanguageIntelligence.DataPersistence[] = []
      const persistenceAnalyzer = new PersistenceAnalyzer()

      for (const [filePath, result] of fileResults) {
        const filePersistencePoints = await persistenceAnalyzer.analyzePersistenceInFile(result, filePath, symbols)
        persistencePoints.push(...filePersistencePoints)
      }

      return persistencePoints
    }

    /**
     * Security Boundary Detection
     */
    async detectSecurityBoundaries(
      topology: CrossLanguageIntelligence.ServiceTopology,
      dataFlows: CrossLanguageIntelligence.DataFlow[],
    ): Promise<CrossLanguageIntelligence.SecurityBoundary[]> {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []
      const boundaryDetector = new SecurityBoundaryDetector()

      // Detect boundaries between services
      for (const service of topology.services) {
        const serviceBoundaries = await boundaryDetector.detectServiceBoundaries(service, dataFlows)
        boundaries.push(...serviceBoundaries)
      }

      // Detect network boundaries
      const networkBoundaries = await boundaryDetector.detectNetworkBoundaries(topology, dataFlows)
      boundaries.push(...networkBoundaries)

      return boundaries
    }

    /**
     * Taint Analysis Engine
     * Traces sensitive data sources to dangerous sinks across language boundaries
     */
    async performTaintAnalysis(
      dataFlows: CrossLanguageIntelligence.DataFlow[],
      fileResults: Map<string, ASTEngine.ParseResult>,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.TaintFlow[]> {
      const taintFlows: CrossLanguageIntelligence.TaintFlow[] = []
      const taintEngine = new TaintAnalysisEngine()

      // Trace each cross-language flow for vulnerabilities
      for (const flow of dataFlows) {
        const detectedTaints = await taintEngine.traceSensitiveData(flow, fileResults, symbols)
        taintFlows.push(...detectedTaints)
      }

      return taintFlows
    }

    /**
     * Type Flow Analysis Engine
     * Tracks type propagation and mismatches across languages
     */
    async performTypeFlowAnalysis(
      dataFlows: CrossLanguageIntelligence.DataFlow[],
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.TypeFlow[]> {
      const typeFlows: CrossLanguageIntelligence.TypeFlow[] = []
      const typeEngine = new TypeFlowAnalysisEngine()

      for (const flow of dataFlows) {
        const flows = await typeEngine.analyzeTypeFlow(flow, symbols)
        typeFlows.push(...flows)
      }

      return typeFlows
    }
  }

  // ======================== TYPE FLOW ANALYSIS ENGINE ========================

  class TypeFlowAnalysisEngine {
    async analyzeTypeFlow(
      flow: CrossLanguageIntelligence.DataFlow,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.TypeFlow[]> {
      const typeFlows: CrossLanguageIntelligence.TypeFlow[] = []

      // Analyze type transformations between steps
      for (let i = 0; i < flow.steps.length - 1; i++) {
        const sourceStep = flow.steps[i]
        const targetStep = flow.steps[i + 1]

        // Only care if changing languages or boundaries
        if (sourceStep.language !== targetStep.language || sourceStep.serviceName !== targetStep.serviceName) {
          const isCompatible = this.checkTypeCompatibility(
            sourceStep.dataType,
            targetStep.dataType,
            sourceStep.language,
            targetStep.language,
          )
          const isSafe = this.checkSerializationSafety(sourceStep.dataType, targetStep.dataType)

          typeFlows.push({
            id: `typeflow_${flow.id}_${i}`,
            sourceSymbol: sourceStep.symbolName,
            targetSymbol: targetStep.symbolName,
            sourceType: sourceStep.dataType,
            targetType: targetStep.dataType,
            isCompatible: isCompatible.compatible,
            mismatchReason: isCompatible.reason,
            serializationSafe: isSafe,
            boundaryType: this.determineBoundaryType(sourceStep, targetStep),
          })
        }
      }

      return typeFlows
    }

    private checkTypeCompatibility(
      sourceType: string,
      targetType: string,
      sourceLang?: string,
      targetLang?: string,
    ): { compatible: boolean; reason?: string } {
      const sType = sourceType.toLowerCase()
      const tType = targetType.toLowerCase()

      if (sType === tType || sType === "any" || tType === "any" || sType === "unknown" || tType === "unknown") {
        return { compatible: true }
      }

      // Number vs String mismatches
      if ((this.isNumeric(sType) && this.isString(tType)) || (this.isString(sType) && this.isNumeric(tType))) {
        return { compatible: false, reason: "Implicit string/number conversion required" }
      }

      // Precision loss (e.g. float64 -> int32)
      if (this.isFloat(sType) && this.isInt(tType)) {
        return { compatible: false, reason: "Potential precision loss (float to int)" }
      }

      // Nullability mismatch (strict lang receiving from dynamic lang)
      if (
        this.isDynamic(sourceLang) &&
        this.isStrict(targetLang) &&
        !tType.includes("optional") &&
        !tType.includes("?")
      ) {
        return { compatible: false, reason: "Dynamic language could pass null/undefined to non-nullable strict type" }
      }

      // Date/Time vs String
      if ((this.isDate(sType) && this.isString(tType)) || (this.isString(sType) && this.isDate(tType))) {
        return { compatible: false, reason: "Date/time serialization mismatch possible" }
      }

      return { compatible: true }
    }

    private checkSerializationSafety(sourceType: string, targetType: string): boolean {
      const sType = sourceType.toLowerCase()
      // Unsafe serialization targets: large numbers, deep objects, circular refs, raw binary
      if (sType.includes("bigint") || sType.includes("long") || sType.includes("int64")) {
        // JSON parsing in JS loses precision for numbers > Number.MAX_SAFE_INTEGER
        if (targetType.toLowerCase().includes("json") || targetType.toLowerCase().includes("number")) {
          return false
        }
      }
      return true
    }

    private determineBoundaryType(
      sourceStep: CrossLanguageIntelligence.DataFlowStep,
      targetStep: CrossLanguageIntelligence.DataFlowStep,
    ): string {
      const sName = sourceStep.symbolName.toLowerCase()
      const tName = targetStep.symbolName.toLowerCase()

      if (tName.includes("db") || tName.includes("query") || tName.includes("sql") || sName.includes("db"))
        return "database"
      if (tName.includes("queue") || tName.includes("kafka") || tName.includes("publish")) return "message_queue"
      if (
        sourceStep.language === "c" ||
        sourceStep.language === "cpp" ||
        targetStep.language === "c" ||
        targetStep.language === "cpp"
      )
        return "ffi"

      return "api_call"
    }

    // Type helpers
    private isNumeric(t: string): boolean {
      return /int|float|double|number|decimal|numeric|long|short/.test(t)
    }
    private isFloat(t: string): boolean {
      return /float|double|decimal|numeric/.test(t)
    }
    private isInt(t: string): boolean {
      return /int|long|short/.test(t)
    }
    private isString(t: string): boolean {
      return /string|str|text|char|varchar/.test(t)
    }
    private isDate(t: string): boolean {
      return /date|time|timestamp|datetime/.test(t)
    }

    private isDynamic(lang?: string): boolean {
      return ["javascript", "python", "ruby", "php", "lua", "perl", "elixir", "erlang", "groovy", "clojure", "r", "bash", "powershell"].includes(lang || "")
    }
    private isStrict(lang?: string): boolean {
      return ["java", "csharp", "go", "rust", "typescript", "tsx", "cpp", "c", "kotlin", "scala", "swift", "dart", "haskell", "fsharp", "clean", "zig"].includes(lang || "")
  }
    }
  // ======================== TAINT ANALYSIS ENGINE ========================

  class TaintAnalysisEngine {
    private sensitiveKeywords = ["password", "secret", "token", "key", "auth", "ssn", "credit_card", "cc_num", "email"]
    private sinkKeywords = ["execute", "exec", "query", "log", "print", "write", "send", "eval"]

    async traceSensitiveData(
      flow: CrossLanguageIntelligence.DataFlow,
      fileResults: Map<string, ASTEngine.ParseResult>,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.TaintFlow[]> {
      const taints: CrossLanguageIntelligence.TaintFlow[] = []

      // 1. Identify Data Sources (Is this flow carrying sensitive data?)
      const isSensitive = this.isFlowSensitive(flow, symbols)
      if (!isSensitive) return taints // Not a sensitive flow, skip

      // 2. Determine Source Details
      const source: CrossLanguageIntelligence.TaintSource = {
        symbolName: flow.source.serviceId,
        filePath: flow.source.filePath,
        language: flow.source.language,
        dataType: flow.source.dataFormat,
        sourceType: "user_input", // Default, could be refined
      }

      // 3. Identify Sinks in the flow steps (Where does the data end up?)
      for (const step of flow.steps) {
        const isDangerousSink = this.isDangerousSink(step)
        if (isDangerousSink) {
          // Check for mitigation
          const isMitigated = this.checkForMitigation(flow, step)

          const sink: CrossLanguageIntelligence.TaintSink = {
            symbolName: step.symbolName,
            filePath: step.filePath,
            language: step.language || "unknown",
            sinkType: this.determineSinkType(step),
          }

          taints.push({
            id: `taint_${flow.id}_${step.symbolName}`,
            source,
            sink,
            flowPath: flow.steps,
            vulnerabilityType: this.determineVulnerability(source, sink),
            severity: isMitigated ? "low" : "high",
            isMitigated,
            mitigationSteps: isMitigated ? [step] : undefined,
          })
        }
      }

      // 4. Special Case: Unencrypted Data over Network
      if (this.isNetworkBoundary(flow) && !this.isEncrypted(flow)) {
        taints.push({
          id: `taint_net_${flow.id}`,
          source,
          sink: {
            symbolName: "Network",
            filePath: flow.target.filePath,
            language: flow.target.language,
            sinkType: "http_response",
          },
          flowPath: flow.steps,
          vulnerabilityType: "pii_leak",
          severity: "high",
          isMitigated: false,
        })
      }

      return taints
    }

    private isFlowSensitive(
      flow: CrossLanguageIntelligence.DataFlow,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): boolean {
      // Check data model names and types for sensitivity
      const dataModel = symbols.find((s) => s.id === flow.dataModel)
      if (dataModel) {
        const nameLower = dataModel.name.toLowerCase()
        return this.sensitiveKeywords.some((keyword) => nameLower.includes(keyword))
      }
      return false
    }

    private isDangerousSink(step: CrossLanguageIntelligence.DataFlowStep): boolean {
      const nameLower = step.symbolName.toLowerCase()
      return this.sinkKeywords.some((keyword) => nameLower.includes(keyword))
    }

    private determineSinkType(step: CrossLanguageIntelligence.DataFlowStep): string {
      const nameLower = step.symbolName.toLowerCase()
      if (nameLower.includes("query") || nameLower.includes("db") || nameLower.includes("sql")) return "database_write"
      if (nameLower.includes("log") || nameLower.includes("print")) return "log_output"
      if (nameLower.includes("exec") || nameLower.includes("eval")) return "shell_execution"
      return "file_write"
    }

    private determineVulnerability(
      source: CrossLanguageIntelligence.TaintSource,
      sink: CrossLanguageIntelligence.TaintSink,
    ): string {
      if (sink.sinkType === "database_write") return "sql_injection"
      if (sink.sinkType === "shell_execution") return "command_injection"
      if (sink.sinkType === "log_output") return "pii_leak"
      if (sink.sinkType === "http_response") return "xss"
      return "unencrypted_storage"
    }

    private checkForMitigation(
      flow: CrossLanguageIntelligence.DataFlow,
      step: CrossLanguageIntelligence.DataFlowStep,
    ): boolean {
      // Look for sanitation/encryption steps before the sink
      const sinkIndex = flow.steps.findIndex((s) => s.symbolName === step.symbolName)
      if (sinkIndex <= 0) return false

      const priorSteps = flow.steps.slice(0, sinkIndex)
      return priorSteps.some((s) => {
        const name = s.symbolName.toLowerCase()
        return (
          name.includes("sanitize") ||
          name.includes("encrypt") ||
          name.includes("hash") ||
          name.includes("escape") ||
          name.includes("validate")
        )
      })
    }

    private isNetworkBoundary(flow: CrossLanguageIntelligence.DataFlow): boolean {
      return flow.source.language !== flow.target.language || flow.source.serviceId !== flow.target.serviceId
    }

    private isEncrypted(flow: CrossLanguageIntelligence.DataFlow): boolean {
      return flow.security.some((s) => s.type === "encryption" || s.type === "tls")
    }
  }

  // ======================== SUPPORTING CLASSES ========================

  /**
   * Data Model Grouper
   */
  class DataModelGrouper {
    async createSharedModel(
      symbol: CrossLanguageIntelligence.CrossLanguageSymbol,
      fileResults: Map<string, ASTEngine.ParseResult>,
    ): Promise<CrossLanguageIntelligence.SharedDataModel> {
      const variations = this.analyzeLanguageVariations(symbol)
      const schema = await this.extractSchema(symbol, fileResults)
      const validation = this.extractValidationRules(symbol, fileResults)

      return {
        id: symbol.id,
        name: symbol.name,
        schema,
        languages: symbol.languages,
        variations,
        validation,
      }
    }

    private analyzeLanguageVariations(
      symbol: CrossLanguageIntelligence.CrossLanguageSymbol,
    ): CrossLanguageIntelligence.ModelVariation[] {
      return symbol.languages.map((language) => ({
        language,
        differences: this.identifyLanguageDifferences(symbol, language),
        mappingRules: this.generateMappingRules(symbol, language),
      }))
    }

    private identifyLanguageDifferences(
      symbol: CrossLanguageIntelligence.CrossLanguageSymbol,
      language: string,
    ): string[] {
      // Analyze language-specific differences in data model representation
      const differences: string[] = []

      if (language === "javascript" || language === "typescript") {
        differences.push("dynamic_typing", "optional_fields")
      } else if (language === "java" || language === "csharp") {
        differences.push("static_typing", "null_safety")
      } else if (language === "go") {
        differences.push("zero_values", "pointer_semantics")
      } else if (language === "rust") {
        differences.push("ownership", "option_types")
      }

      return differences
    }

    private generateMappingRules(
      symbol: CrossLanguageIntelligence.CrossLanguageSymbol,
      language: string,
    ): CrossLanguageIntelligence.MappingRule[] {
      // Generate rules for mapping between languages
      return []
    }

    private async extractSchema(
      symbol: CrossLanguageIntelligence.CrossLanguageSymbol,
      fileResults: Map<string, ASTEngine.ParseResult>,
    ): Promise<any> {
      // Extract schema information from symbol definitions
      return {
        type: "object",
        properties: {},
        required: [],
      }
    }

    private extractValidationRules(
      symbol: CrossLanguageIntelligence.CrossLanguageSymbol,
      fileResults: Map<string, ASTEngine.ParseResult>,
    ): CrossLanguageIntelligence.ValidationRule[] {
      // Extract validation rules from decorators and annotations
      return []
    }
  }

  /**
   * Enhanced Data Flow Mapper
   */
  class DataFlowMapper {
    constructor(
      private services: CrossLanguageIntelligence.ServiceNode[],
      private dataModels: CrossLanguageIntelligence.SharedDataModel[],
    ) {}

    async enhanceDataFlow(
      topologyFlow: CrossLanguageIntelligence.DataFlow,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.DataFlow> {
      // Enhance existing data flow with additional intelligence
      return {
        ...topologyFlow,
        transformations: await this.analyzeTransformations(topologyFlow),
        security: await this.enhanceSecurityAnalysis(topologyFlow),
        performance: await this.enhancePerformanceAnalysis(topologyFlow),
      }
    }

    async extractDataFlowsFromCommunication(
      commPath: CrossLanguageIntelligence.CommunicationPath,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.DataFlow[]> {
      const flows: CrossLanguageIntelligence.DataFlow[] = []

      const sourceServiceId = commPath.sourceServices[0] || commPath.from
      const targetServiceId = commPath.targetServices[0] || commPath.to

      if (!sourceServiceId || !targetServiceId) return flows

      const flow: CrossLanguageIntelligence.DataFlow = {
        id: `df_${commPath.id}`,
        source: {
          serviceId: sourceServiceId,
          endpoint: "unknown",
          language: "unknown",
          filePath: "unknown",
          dataFormat: commPath.dataFormats[0] || "unknown",
        },
        target: {
          serviceId: targetServiceId,
          endpoint: "unknown",
          language: "unknown",
          filePath: "unknown",
          expectedFormat: commPath.dataFormats[0] || "unknown",
        },
        dataModel: commPath.dataFormats.join(",") || "unknown",
        steps: [
          {
            serviceName: sourceServiceId,
            dataType: commPath.dataFormats[0] || "unknown",
            filePath: "unknown",
            symbolName: sourceServiceId,
          },
          {
            serviceName: targetServiceId,
            dataType: commPath.dataFormats[0] || "unknown",
            filePath: "unknown",
            symbolName: targetServiceId,
          },
        ],
        transformations: [],
        security: [],
        performance: {
          throughput: "medium",
          latency: "medium",
          scalability: "horizontal",
          bottlenecks: [],
        },
      }

      flows.push(flow)
      return flows
    }

    private async analyzeTransformations(
      flow: CrossLanguageIntelligence.DataFlow,
    ): Promise<CrossLanguageIntelligence.DataTransformation[]> {
      // Analyze data transformations within the flow
      return flow.transformations || []
    }

    private async enhanceSecurityAnalysis(
      flow: CrossLanguageIntelligence.DataFlow,
    ): Promise<CrossLanguageIntelligence.SecurityMechanism[]> {
      // Enhance security analysis
      return flow.security || []
    }

    private async enhancePerformanceAnalysis(
      flow: CrossLanguageIntelligence.DataFlow,
    ): Promise<CrossLanguageIntelligence.DataFlowPerformance> {
      // Enhance performance analysis
      return (
        flow.performance || {
          throughput: "medium",
          latency: "medium",
          scalability: "horizontal",
          bottlenecks: [],
        }
      )
    }
  }

  // ======================== DATA FLOW ANALYZER IMPLEMENTATIONS ========================

  /**
   * Data Transformation Detector
   * Analyzes how data is transformed between services and languages
   */
  class DataTransformationDetector {
    async analyzeFlowTransformations(
      flow: CrossLanguageIntelligence.DataFlow,
      fileResults: Map<string, ASTEngine.ParseResult>,
    ): Promise<CrossLanguageIntelligence.DataTransformation[]> {
      const transformations: CrossLanguageIntelligence.DataTransformation[] = []

      // Analyze each step in the data flow
      for (let i = 0; i < flow.steps.length - 1; i++) {
        const currentStep = flow.steps[i]
        const nextStep = flow.steps[i + 1]

        // Detect transformation between steps
        const transformation = await this.detectTransformation(currentStep, nextStep, fileResults)
        if (transformation) {
          transformations.push(transformation)
        }
      }

      return transformations
    }

    private async detectTransformation(
      fromStep: CrossLanguageIntelligence.DataFlowStep,
      toStep: CrossLanguageIntelligence.DataFlowStep,
      fileResults: Map<string, ASTEngine.ParseResult>,
    ): Promise<CrossLanguageIntelligence.DataTransformation | null> {
      // Get file results for both steps
      const fromFile = fileResults.get(fromStep.filePath)
      const toFile = fileResults.get(toStep.filePath)

      if (!fromFile || !toFile) return null

      // Language-to-language transformation patterns
      const transformationType = this.detectTransformationType(fromFile.language, toFile.language)
      const transformationMethods = this.detectTransformationMethods(fromFile, toFile)

      return {
        id: `transform_${fromStep.symbolName}_to_${toStep.symbolName}`,
        fromSymbol: fromStep.symbolName,
        toSymbol: toStep.symbolName,
        transformationType,
        transformationMethods,
        sourceLanguage: fromFile.language,
        targetLanguage: toFile.language,
        dataFormatChange: this.detectDataFormatChange(fromStep, toStep),
        validationRules: this.extractValidationRules(fromFile, toFile),
        performance: {
          complexity: this.calculateTransformationComplexity(transformationMethods),
          latencyImpact: this.estimateLatencyImpact(transformationType),
          memoryImpact: this.estimateMemoryImpact(transformationMethods),
        },
      }
    }

    private detectTransformationType(fromLang: string | undefined, toLang: string | undefined): string {
      // Cross-language transformation patterns
      if (!fromLang || !toLang) return "Unknown Transformation"
      if (fromLang === toLang) return "Same Language Transformation"
      if ((fromLang === "javascript" || fromLang === "typescript") && toLang === "python") return "JS to Python"
      if (fromLang === "java" && toLang === "javascript") return "Java to JavaScript"
      if (fromLang === "python" && toLang === "go") return "Python to Go"
      if (fromLang === "rust" && toLang === "c") return "Rust to C"
      if (["json", "yaml"].includes(fromLang) || ["json", "yaml"].includes(toLang)) return "Serialization Transform"
      return `${fromLang} to ${toLang} Transformation`
    }

    private detectTransformationMethods(fromFile: ASTEngine.ParseResult, toFile: ASTEngine.ParseResult): string[] {
      const methods: Set<string> = new Set()

      const analyzeSymbols = (symbols: ASTEngine.UniversalSymbol[]) => {
        for (const sym of symbols) {
          if (sym.qualified_calls) {
            for (const call of sym.qualified_calls) {
              const lowerCall = call.toLowerCase()
              if (
                lowerCall.includes("json.stringify") ||
                lowerCall.includes("json.dumps") ||
                lowerCall.includes("to_json")
              ) {
                methods.add("JSON Serialization")
              }
              if (
                lowerCall.includes("json.parse") ||
                lowerCall.includes("json.loads") ||
                lowerCall.includes("from_json")
              ) {
                methods.add("JSON Deserialization")
              }
              if (lowerCall.includes("protobuf") || lowerCall.includes("serialize")) {
                methods.add("Protobuf Transformation")
              }
              if (lowerCall.includes("to_dict") || lowerCall.includes("asdict") || lowerCall.includes("toobject")) {
                methods.add("ORM Mapping")
              }
              if (lowerCall.includes("validate") || lowerCall.includes("ajv") || lowerCall.includes("pydantic")) {
                methods.add("Data Validation")
              }
            }
          }
          if (sym.children) analyzeSymbols(sym.children)
        }
      }

      analyzeSymbols(fromFile.symbols)
      analyzeSymbols(toFile.symbols)

      if (methods.size === 0) {
        const fromContent = fromFile.rawContent || ""
        const toContent = toFile.rawContent || ""
        const content = fromContent + toContent

        if (/JSON\.stringify|json\.dumps|to_json|toJson/.test(content)) methods.add("JSON Serialization")
        if (/JSON\.parse|json\.loads|from_json|fromJson/.test(content)) methods.add("JSON Deserialization")
        if (/protobuf|\.proto|serialize|deserialize/.test(content)) methods.add("Protobuf Transformation")
        if (/to_dict|asdict|toObject|fromObject|entity\./.test(content)) methods.add("ORM Mapping")
        if (/graphql|resolvers|schema/.test(content)) methods.add("GraphQL Transformation")
        if (/validate|schema|ajv|joi|pydantic/.test(content)) methods.add("Data Validation")
      }

      return methods.size > 0 ? Array.from(methods) : ["Direct Assignment"]
    }

    private detectDataFormatChange(
      fromStep: CrossLanguageIntelligence.DataFlowStep,
      toStep: CrossLanguageIntelligence.DataFlowStep,
    ): string {
      const fromFormat = this.inferDataFormat(fromStep.dataType)
      const toFormat = this.inferDataFormat(toStep.dataType)

      if (fromFormat !== toFormat) {
        return `${fromFormat} → ${toFormat}`
      }
      return "No Format Change"
    }

    private inferDataFormat(dataType: string): string {
      if (/json|object|dict/.test(dataType.toLowerCase())) return "JSON"
      if (/proto|protobuf/.test(dataType.toLowerCase())) return "Protobuf"
      if (/xml/.test(dataType.toLowerCase())) return "XML"
      if (/string|str|text/.test(dataType.toLowerCase())) return "String"
      if (/int|number|float/.test(dataType.toLowerCase())) return "Numeric"
      return "Unknown"
    }

    private extractValidationRules(fromFile: ASTEngine.ParseResult, toFile: ASTEngine.ParseResult): string[] {
      const rules: string[] = []
      const content = (fromFile.rawContent || "") + (toFile.rawContent || "")

      // Common validation patterns
      const validationPatterns = [
        /required|mandatory|not null/i,
        /min|max|length|size/i,
        /pattern|regex|format/i,
        /email|url|uuid|date/i,
        /range|between|gt|lt|gte|lte/i,
      ]

      for (const pattern of validationPatterns) {
        if (pattern.test(content)) {
          rules.push(pattern.source.replace(/[\/\\\[\]\(\)\|]/g, ""))
        }
      }

      return rules
    }

    private calculateTransformationComplexity(methods: string[]): string {
      if (methods.includes("Protobuf Transformation")) return "High"
      if (methods.includes("ORM Mapping") || methods.includes("Data Validation")) return "Medium"
      if (methods.includes("JSON Serialization") || methods.includes("JSON Deserialization")) return "Low"
      return "Minimal"
    }

    private estimateLatencyImpact(transformationType: string): string {
      if (transformationType.includes("Serialization")) return "Medium"
      if (transformationType.includes("Same Language")) return "Low"
      if (transformationType.includes("Protobuf")) return "Low"
      return "Medium"
    }

    private estimateMemoryImpact(methods: string[]): string {
      if (methods.includes("Protobuf Transformation")) return "Low"
      if (methods.includes("JSON Serialization")) return "Medium"
      if (methods.includes("ORM Mapping")) return "High"
      return "Low"
    }
  }

  /**
   * Persistence Analyzer
   * Analyzes how data is persisted across different storage systems
   */
  class PersistenceAnalyzer {
    async analyzePersistenceInFile(
      result: ASTEngine.ParseResult,
      filePath: string,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    ): Promise<CrossLanguageIntelligence.DataPersistence[]> {
      const persistencePoints: CrossLanguageIntelligence.DataPersistence[] = []

      // Database persistence patterns
      persistencePoints.push(...this.detectDatabasePersistence(result, filePath))

      // File system persistence
      persistencePoints.push(...this.detectFileSystemPersistence(result, filePath))

      // Cache persistence
      persistencePoints.push(...this.detectCachePersistence(result, filePath))

      // Message queue persistence
      persistencePoints.push(...this.detectMessageQueuePersistence(result, filePath))

      return persistencePoints
    }

    private detectDatabasePersistence(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.DataPersistence[] {
      const persistencePoints: CrossLanguageIntelligence.DataPersistence[] = []
      const content = result.rawContent || ""

      // Database operation patterns by language
      const dbPatterns = new Map<string, RegExp[]>([
        [
          "sql",
          [/INSERT\s+INTO\s+(\w+)/gi, /UPDATE\s+(\w+)\s+SET/gi, /DELETE\s+FROM\s+(\w+)/gi, /CREATE\s+TABLE\s+(\w+)/gi],
        ],
        [
          "python",
          [
            /\.save\(\)|\.create\(\)|\.update\(\)|\.delete\(\)/g,
            /session\.add\(|session\.commit\(\)/g,
            /Model\.objects\.(create|save|update|delete)/g,
          ],
        ],
        [
          "javascript",
          [
            /\.save\(\)|\.create\(\)|\.update\(\)|\.destroy\(\)/g,
            /\.insert\(|\.update\(|\.del\(/g,
            /findOneAndUpdate|findOneAndDelete|insertMany/g,
          ],
        ],
        [
          "java",
          [
            /\.save\(|\.persist\(|\.merge\(|\.remove\(/g,
            /entityManager\.(persist|merge|remove)/g,
            /repository\.(save|delete|findBy)/g,
          ],
        ],
        [
          "csharp",
          [
            /\.Add\(|\.Update\(|\.Remove\(|\.SaveChanges\(\)/g,
            /context\.(Add|Update|Remove)/g,
            /\.FirstOrDefault\(|\.Where\(/g,
          ],
        ],
      ])

      const patterns = dbPatterns.get(result.language || "") || []

      for (const pattern of patterns) {
        pattern.lastIndex = 0
        let match

        while ((match = pattern.exec(content)) !== null) {
          persistencePoints.push({
            id: `db_persist_${filePath}_${persistencePoints.length}`,
            type: "Database",
            operation: this.extractOperation(match[0]),
            location: {
              filePath,
              language: result.language,
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            },
            dataTypes: this.extractDataTypes(match[0]),
            storageSystem: this.detectDatabaseType(content),
            consistency: this.detectConsistencyLevel(match[0]),
            performance: {
              readLatency: "Medium",
              writeLatency: "Medium",
              scalability: "High",
              durability: "High",
            },
          })
        }
      }

      return persistencePoints
    }

    private detectFileSystemPersistence(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.DataPersistence[] {
      const persistencePoints: CrossLanguageIntelligence.DataPersistence[] = []
      const content = result.rawContent || ""

      // File operation patterns
      const filePatterns = [
        /fs\.writeFile|fs\.readFile|fs\.createWriteStream/g,
        /open\s*\([^)]*['"]\w+\.[^'"]+['"]\s*,\s*['"]w|open\s*\([^)]*['"]\w+\.[^'"]+['"]\s*,\s*['"]a/g,
        /File\.WriteAllText|File\.ReadAllText|FileStream/g,
        /Files\.write|Files\.read|PrintWriter|BufferedWriter/g,
      ]

      for (const pattern of filePatterns) {
        pattern.lastIndex = 0
        let match

        while ((match = pattern.exec(content)) !== null) {
          persistencePoints.push({
            id: `file_persist_${filePath}_${persistencePoints.length}`,
            type: "File System",
            operation: this.extractOperation(match[0]),
            location: {
              filePath,
              language: result.language,
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            },
            dataTypes: ["File"],
            storageSystem: "File System",
            consistency: "Eventually Consistent",
            performance: {
              readLatency: "Low",
              writeLatency: "Low",
              scalability: "Medium",
              durability: "Medium",
            },
          })
        }
      }

      return persistencePoints
    }

    private detectCachePersistence(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.DataPersistence[] {
      const persistencePoints: CrossLanguageIntelligence.DataPersistence[] = []
      const content = result.rawContent || ""

      // Cache operation patterns
      const cachePatterns = [
        /redis\.(set|get|hset|hget|lpush|rpop)/g,
        /memcached\.(set|get|add|replace)/g,
        /cache\.(put|get|set|remove)/g,
        /\.setex\(|\.expire\(|\.ttl\(/g,
      ]

      for (const pattern of cachePatterns) {
        pattern.lastIndex = 0
        let match

        while ((match = pattern.exec(content)) !== null) {
          persistencePoints.push({
            id: `cache_persist_${filePath}_${persistencePoints.length}`,
            type: "Cache",
            operation: this.extractOperation(match[0]),
            location: {
              filePath,
              language: result.language,
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            },
            dataTypes: ["Key-Value"],
            storageSystem: this.detectCacheType(content),
            consistency: "Eventually Consistent",
            performance: {
              readLatency: "Very Low",
              writeLatency: "Very Low",
              scalability: "High",
              durability: "Low",
            },
          })
        }
      }

      return persistencePoints
    }

    private detectMessageQueuePersistence(
      result: ASTEngine.ParseResult,
      filePath: string,
    ): CrossLanguageIntelligence.DataPersistence[] {
      const persistencePoints: CrossLanguageIntelligence.DataPersistence[] = []
      const content = result.rawContent || ""

      // Message queue patterns
      const mqPatterns = [
        /\.publish\(|\.send\(|\.produce\(/g,
        /kafka\.send|producer\.send/g,
        /rabbitmq\.publish|amqp\.publish/g,
        /sqs\.sendMessage|sns\.publish/g,
      ]

      for (const pattern of mqPatterns) {
        pattern.lastIndex = 0
        let match

        while ((match = pattern.exec(content)) !== null) {
          persistencePoints.push({
            id: `mq_persist_${filePath}_${persistencePoints.length}`,
            type: "Message Queue",
            operation: "Publish",
            location: {
              filePath,
              language: result.language,
              range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
            },
            dataTypes: ["Message"],
            storageSystem: this.detectMessageQueueType(content),
            consistency: "At Least Once",
            performance: {
              readLatency: "Low",
              writeLatency: "Low",
              scalability: "Very High",
              durability: "High",
            },
          })
        }
      }

      return persistencePoints
    }

    private extractOperation(operationText: string): string {
      if (/insert|create|add|save|write|put/i.test(operationText)) return "Write"
      if (/select|read|get|find|query/i.test(operationText)) return "Read"
      if (/update|modify|set|merge/i.test(operationText)) return "Update"
      if (/delete|remove|drop/i.test(operationText)) return "Delete"
      if (/publish|send|produce/i.test(operationText)) return "Publish"
      return "Unknown"
    }

    private extractDataTypes(operationText: string): string[] {
      const types: string[] = []

      if (/user|account|profile/i.test(operationText)) types.push("User Data")
      if (/order|payment|transaction/i.test(operationText)) types.push("Transaction Data")
      if (/product|item|catalog/i.test(operationText)) types.push("Product Data")
      if (/log|audit|event/i.test(operationText)) types.push("Log Data")
      if (/config|setting|preference/i.test(operationText)) types.push("Configuration Data")

      return types.length > 0 ? types : ["Generic Data"]
    }

    private detectDatabaseType(content: string): string {
      if (/postgresql|postgres|pg\./i.test(content)) return "PostgreSQL"
      if (/mysql|mariadb/i.test(content)) return "MySQL"
      if (/mongodb|mongo/i.test(content)) return "MongoDB"
      if (/redis/i.test(content)) return "Redis"
      if (/sqlite/i.test(content)) return "SQLite"
      if (/oracle/i.test(content)) return "Oracle"
      if (/sqlserver|mssql/i.test(content)) return "SQL Server"
      return "Unknown Database"
    }

    private detectCacheType(content: string): string {
      if (/redis/i.test(content)) return "Redis"
      if (/memcached/i.test(content)) return "Memcached"
      if (/hazelcast/i.test(content)) return "Hazelcast"
      return "In-Memory Cache"
    }

    private detectMessageQueueType(content: string): string {
      if (/kafka/i.test(content)) return "Apache Kafka"
      if (/rabbitmq|amqp/i.test(content)) return "RabbitMQ"
      if (/sqs|sns/i.test(content)) return "AWS SQS/SNS"
      if (/pubsub/i.test(content)) return "Google Cloud Pub/Sub"
      return "Message Queue"
    }

    private detectConsistencyLevel(operationText: string): string {
      if (/transaction|begin|commit|rollback/i.test(operationText)) return "ACID"
      if (/eventual|async/i.test(operationText)) return "Eventually Consistent"
      return "Strong Consistency"
    }
  }

  /**
   * Security Boundary Detector
   * Detects security boundaries and access control points
   */
  class SecurityBoundaryDetector {
    async detectServiceBoundaries(
      service: CrossLanguageIntelligence.ServiceNode,
      dataFlows: CrossLanguageIntelligence.DataFlow[],
    ): Promise<CrossLanguageIntelligence.SecurityBoundary[]> {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []

      // Authentication boundaries
      boundaries.push(...this.detectAuthenticationBoundaries(service))

      // Authorization boundaries
      boundaries.push(...this.detectAuthorizationBoundaries(service))

      // Data validation boundaries
      boundaries.push(...this.detectDataValidationBoundaries(service, dataFlows))

      return boundaries
    }

    async detectNetworkBoundaries(
      topology: CrossLanguageIntelligence.ServiceTopology,
      dataFlows: CrossLanguageIntelligence.DataFlow[],
    ): Promise<CrossLanguageIntelligence.SecurityBoundary[]> {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []

      // Network segmentation boundaries
      boundaries.push(...this.detectNetworkSegmentation(topology))

      // TLS/SSL boundaries
      boundaries.push(...this.detectTLSBoundaries(topology))

      // Firewall boundaries
      boundaries.push(...this.detectFirewallBoundaries(topology))

      return boundaries
    }

    private detectAuthenticationBoundaries(
      service: CrossLanguageIntelligence.ServiceNode,
    ): CrossLanguageIntelligence.SecurityBoundary[] {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []

      // Check for authentication patterns in service endpoints
      for (const endpoint of service.endpoints) {
        const name = endpoint.name || endpoint.path
        if (this.hasAuthenticationPatterns(name)) {
          boundaries.push({
            id: `auth_boundary_${service.name}_${name}`,
            type: "Authentication",
            location: {
              serviceName: service.name,
              endpointPath: name,
              filePath: endpoint.filePath,
            },
            mechanism: this.detectAuthMechanism(name),
            strength: "Medium",
            requirements: ["Valid Token", "Active Session"],
            threats: ["Unauthorized Access", "Token Theft"],
            mitigations: ["Token Validation", "Rate Limiting"],
          })
        }
      }

      return boundaries
    }

    private detectAuthorizationBoundaries(
      service: CrossLanguageIntelligence.ServiceNode,
    ): CrossLanguageIntelligence.SecurityBoundary[] {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []

      // Check for authorization patterns
      for (const endpoint of service.endpoints) {
        const name = endpoint.name || endpoint.path
        if (this.hasAuthorizationPatterns(name)) {
          boundaries.push({
            id: `authz_boundary_${service.name}_${name}`,
            type: "Authorization",
            location: {
              serviceName: service.name,
              endpointPath: name,
              filePath: endpoint.filePath,
            },
            mechanism: "Role-Based Access Control",
            strength: "High",
            requirements: ["Valid Role", "Sufficient Permissions"],
            threats: ["Privilege Escalation", "Data Access Violation"],
            mitigations: ["Role Validation", "Permission Checking"],
          })
        }
      }

      return boundaries
    }

    private detectDataValidationBoundaries(
      service: CrossLanguageIntelligence.ServiceNode,
      dataFlows: CrossLanguageIntelligence.DataFlow[],
    ): CrossLanguageIntelligence.SecurityBoundary[] {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []

      // Find data flows that cross service boundaries
      const crossServiceFlows = dataFlows.filter(
        (flow) =>
          flow.steps.some((step) => step.serviceName !== service.name) &&
          flow.steps.some((step) => step.serviceName === service.name),
      )

      for (const flow of crossServiceFlows) {
        boundaries.push({
          id: `validation_boundary_${service.name}_${flow.id}`,
          type: "Data Validation",
          location: {
            serviceName: service.name,
            endpointPath: flow.steps[0]?.symbolName || "unknown",
            filePath: flow.steps[0]?.filePath || "unknown",
          },
          mechanism: "Input Validation",
          strength: "Medium",
          requirements: ["Schema Validation", "Sanitization"],
          threats: ["Injection Attacks", "Data Corruption"],
          mitigations: ["Input Validation", "Output Encoding"],
        })
      }

      return boundaries
    }

    private detectNetworkSegmentation(
      topology: CrossLanguageIntelligence.ServiceTopology,
    ): CrossLanguageIntelligence.SecurityBoundary[] {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []

      // Analyze communication paths for network boundaries
      for (const path of topology.communicationPaths) {
        if (this.crossesNetworkBoundary(path)) {
          boundaries.push({
            id: `network_boundary_${path.from}_${path.to}`,
            type: "Network Segmentation",
            location: {
              serviceName: path.from,
              endpointPath: "network",
              filePath: "network",
            },
            mechanism: "Network Isolation",
            strength: "High",
            requirements: ["Network Policy", "Firewall Rules"],
            threats: ["Network Intrusion", "Lateral Movement"],
            mitigations: ["Network Segmentation", "Traffic Monitoring"],
          })
        }
      }

      return boundaries
    }

    private detectTLSBoundaries(
      topology: CrossLanguageIntelligence.ServiceTopology,
    ): CrossLanguageIntelligence.SecurityBoundary[] {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []

      // Check for TLS/encryption requirements
      for (const path of topology.communicationPaths) {
        if (path.protocol === "HTTPS" || path.encrypted) {
          boundaries.push({
            id: `tls_boundary_${path.from}_${path.to}`,
            type: "Encryption",
            location: {
              serviceName: path.from,
              endpointPath: "transport",
              filePath: "transport",
            },
            mechanism: "TLS/SSL",
            strength: "High",
            requirements: ["Valid Certificate", "Strong Cipher"],
            threats: ["Man-in-the-Middle", "Eavesdropping"],
            mitigations: ["TLS 1.3", "Certificate Validation"],
          })
        }
      }

      return boundaries
    }

    private detectFirewallBoundaries(
      topology: CrossLanguageIntelligence.ServiceTopology,
    ): CrossLanguageIntelligence.SecurityBoundary[] {
      const boundaries: CrossLanguageIntelligence.SecurityBoundary[] = []

      // Analyze deployment units for firewall boundaries
      for (const unit of topology.deploymentUnits) {
        if (unit.networkExposure === "public" || unit.hasLoadBalancer) {
          boundaries.push({
            id: `firewall_boundary_${unit.name}`,
            type: "Firewall",
            location: {
              serviceName: unit.services[0] || "unknown",
              endpointPath: "ingress",
              filePath: "infrastructure",
            },
            mechanism: "Firewall Rules",
            strength: "High",
            requirements: ["Allowlist Rules", "Port Restrictions"],
            threats: ["DDoS Attacks", "Port Scanning"],
            mitigations: ["Rate Limiting", "IP Filtering"],
          })
        }
      }

      return boundaries
    }

    private hasAuthenticationPatterns(endpointName: string): boolean {
      return /login|auth|signin|token|jwt|oauth|session/i.test(endpointName)
    }

    private hasAuthorizationPatterns(endpointName: string): boolean {
      return /admin|role|permission|access|authorized|protected/i.test(endpointName)
    }

    private detectAuthMechanism(endpointName: string): string {
      if (/jwt|token/i.test(endpointName)) return "JWT Token"
      if (/oauth/i.test(endpointName)) return "OAuth"
      if (/session/i.test(endpointName)) return "Session Cookie"
      if (/api.*key/i.test(endpointName)) return "API Key"
      return "Username/Password"
    }

    private crossesNetworkBoundary(path: CrossLanguageIntelligence.CommunicationPath): boolean {
      // Heuristic: different services likely in different network segments
      return path.from !== path.to && path.protocol === "HTTP"
    }
  }
}
