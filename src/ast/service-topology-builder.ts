// Service Topology Builder
// Builds complete service architecture map across ALL languages
// TRACING: Every microservice, API, database, message queue, cache - EVERYTHING!

import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { CrossLanguageIntelligence } from "./cross-language-intelligence"
import * as Log from "../tool/brain-log"

const log = Log.create({ service: "service-topology" })

export namespace ServiceTopologyBuilder {

  /**
   * SERVICE TOPOLOGY MAPPING
   * Builds complete architecture map with precision
   */
  export async function buildServiceTopology(
    fileResults: Map<string, ASTEngine.ParseResult>,
    symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
    relationships: CrossLanguageIntelligence.CrossLanguageRelationship[]
  ): Promise<CrossLanguageIntelligence.ServiceTopology> {

    log.info("🏗️ Starting Service Topology Construction")

    const topologyBuilder = new ServiceTopologyBuilder()

    // STEP 1: 🎯 SERVICE DISCOVERY - Identify ALL services
    const services = await topologyBuilder.discoverServices(fileResults, symbols)
    log.info("🏢 Services discovered", { count: services.length })

    // STEP 2: 🔗 DEPENDENCY MAPPING - Map service dependencies
    const dependencies = await topologyBuilder.mapServiceDependencies(services, relationships)
    log.info("🔗 Service dependencies mapped", { count: dependencies.length })

    // STEP 3: 📡 COMMUNICATION PATH MAPPING - Map communication channels
    const communicationPaths = await topologyBuilder.mapCommunicationPaths(services, relationships)
    log.info("📡 Communication paths mapped", { count: communicationPaths.length })

    // STEP 4: 🌊 DATA FLOW MAPPING - Map data flows between services
    const dataFlows = await topologyBuilder.mapDataFlows(services, symbols, relationships)
    log.info("🌊 Data flows mapped", { count: dataFlows.length })

    // STEP 5: 🚀 DEPLOYMENT UNIT DISCOVERY - Identify deployment units
    const deploymentUnits = await topologyBuilder.discoverDeploymentUnits(fileResults, services)
    log.info("🚀 Deployment units discovered", { count: deploymentUnits.length })

    const topology: CrossLanguageIntelligence.ServiceTopology = {
      services,
      dependencies,
      communicationPaths,
      dataFlows,
      deploymentUnits
    }

    log.info("🎉 SERVICE TOPOLOGY CONSTRUCTION COMPLETE!", {
      services: services.length,
      dependencies: dependencies.length,
      communicationPaths: communicationPaths.length,
      dataFlows: dataFlows.length,
      deploymentUnits: deploymentUnits.length
    })

    return topology
  }

  /**
   * Service Topology Builder Engine
   */
  class ServiceTopologyBuilder {

    /**
     * SERVICE DISCOVERY
     * Discovers ALL services across ALL languages and frameworks
     */
    async discoverServices(
      fileResults: Map<string, ASTEngine.ParseResult>,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[]
    ): Promise<CrossLanguageIntelligence.ServiceNode[]> {

      const services: CrossLanguageIntelligence.ServiceNode[] = []
      const serviceDetector = new ServiceDetector()

      // Group files by potential services
      const serviceGroups = await serviceDetector.groupFilesByService(fileResults)

      for (const [serviceName, serviceFiles] of serviceGroups) {
        const serviceLanguages = Array.from(new Set(serviceFiles.map(f => f.language)))
        const primaryLanguage = this.determinePrimaryLanguage(serviceLanguages, serviceFiles)

        // Detect service type and framework
        const serviceType = await serviceDetector.detectServiceType(serviceFiles, symbols)
        const framework = await serviceDetector.detectFramework(serviceFiles, primaryLanguage)

        // Extract endpoints for this service
        const endpoints = this.extractServiceEndpoints(symbols, serviceFiles)

        // Analyze service metadata
        const metadata = await this.analyzeServiceMetadata(serviceFiles, framework)

        const service: CrossLanguageIntelligence.ServiceNode = {
          id: `service_${serviceName}`,
          name: serviceName,
          language: primaryLanguage,
          type: serviceType,
          endpoints,
          dependencies: [], // Will be populated in dependency mapping
          filePaths: serviceFiles.map(f => f.filePath),
          framework,
          metadata
        }

        services.push(service)
      }

      return services
    }

    /**
     * SERVICE DEPENDENCY MAPPING
     * Maps ALL dependencies between services
     */
    async mapServiceDependencies(
      services: CrossLanguageIntelligence.ServiceNode[],
      relationships: CrossLanguageIntelligence.CrossLanguageRelationship[]
    ): Promise<CrossLanguageIntelligence.ServiceDependency[]> {

      const dependencies: CrossLanguageIntelligence.ServiceDependency[] = []
      const dependencyMapper = new ServiceDependencyMapper(services)

      for (const relationship of relationships) {
        const sourceService = dependencyMapper.findServiceByFile(relationship.source.filePath)
        const targetService = dependencyMapper.findServiceByFile(relationship.target.filePath)

        if (sourceService && targetService && sourceService.id !== targetService.id) {
          const dependency = await dependencyMapper.createDependency(
            sourceService, targetService, relationship
          )
          dependencies.push(dependency)
        }
      }

      // Update service dependencies
      for (const service of services) {
        service.dependencies = dependencies
          .filter(dep => dep.sourceServiceId === service.id)
          .map(dep => dep.targetServiceId)
      }

      return dependencies
    }

    /**
     * COMMUNICATION PATH MAPPING
     * Maps ALL communication channels between services
     */
    async mapCommunicationPaths(
      services: CrossLanguageIntelligence.ServiceNode[],
      relationships: CrossLanguageIntelligence.CrossLanguageRelationship[]
    ): Promise<CrossLanguageIntelligence.CommunicationPath[]> {

      const communicationPaths: CrossLanguageIntelligence.CommunicationPath[] = []
      const pathMapper = new CommunicationPathMapper(services)

      // Group relationships by communication mechanism
      const pathGroups = new Map<string, CrossLanguageIntelligence.CrossLanguageRelationship[]>()

      for (const relationship of relationships) {
        const mechanism = relationship.metadata.communicationMechanism
        if (!pathGroups.has(mechanism)) {
          pathGroups.set(mechanism, [])
        }
        pathGroups.get(mechanism)!.push(relationship)
      }

      // Create communication paths for each mechanism
      for (const [mechanism, relationshipGroup] of pathGroups) {
        const path = await pathMapper.createCommunicationPath(mechanism, relationshipGroup)
        communicationPaths.push(path)
      }

      return communicationPaths
    }

    /**
     * DATA FLOW MAPPING
     * Maps ALL data flows between services
     */
    async mapDataFlows(
      services: CrossLanguageIntelligence.ServiceNode[],
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
      relationships: CrossLanguageIntelligence.CrossLanguageRelationship[]
    ): Promise<CrossLanguageIntelligence.DataFlow[]> {

      const dataFlows: CrossLanguageIntelligence.DataFlow[] = []
      const dataFlowMapper = new DataFlowMapper(services, symbols)

      // Filter relationships that involve data transfer
      const dataTransferRelationships = relationships.filter(r =>
        r.type === CrossLanguageIntelligence.CrossLanguageRelationType.DataTransfer ||
        r.type === CrossLanguageIntelligence.CrossLanguageRelationType.APICall ||
        r.type === CrossLanguageIntelligence.CrossLanguageRelationType.MessageQueue
      )

      for (const relationship of dataTransferRelationships) {
        const dataFlow = await dataFlowMapper.createDataFlow(relationship)
        if (dataFlow) {
          dataFlows.push(dataFlow)
        }
      }

      return dataFlows
    }

    /**
     * DEPLOYMENT UNIT DISCOVERY
     * Discovers ALL deployment units (Docker, Kubernetes, etc.)
     */
    async discoverDeploymentUnits(
      fileResults: Map<string, ASTEngine.ParseResult>,
      services: CrossLanguageIntelligence.ServiceNode[]
    ): Promise<CrossLanguageIntelligence.DeploymentUnit[]> {

      const deploymentUnits: CrossLanguageIntelligence.DeploymentUnit[] = []
      const deploymentDetector = new DeploymentUnitDetector()

      // Look for deployment configuration files
      for (const [filePath, result] of fileResults) {
        const deploymentUnit = await deploymentDetector.detectDeploymentUnit(filePath, result, services)
        if (deploymentUnit) {
          deploymentUnits.push(deploymentUnit)
        }
      }

      return deploymentUnits
    }

    // ======================== HELPER METHODS ========================

    private determinePrimaryLanguage(
      languages: string[],
      serviceFiles: Array<{ filePath: string; language: string; result: ASTEngine.ParseResult }>
    ): string {
      // Count lines of code per language
      const languageLines = new Map<string, number>()

      for (const file of serviceFiles) {
        const lines = languageLines.get(file.language) || 0
        languageLines.set(file.language, lines + file.result.metadata.linesOfCode)
      }

      // Return language with most lines of code
      let maxLines = 0
      let primaryLanguage = languages[0]

      for (const [language, lines] of languageLines) {
        if (lines > maxLines) {
          maxLines = lines
          primaryLanguage = language
        }
      }

      return primaryLanguage
    }

    private extractServiceEndpoints(
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[],
      serviceFiles: Array<{ filePath: string; language: string; result: ASTEngine.ParseResult }>
    ): CrossLanguageIntelligence.ServiceEndpoint[] {

      const endpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []
      const serviceFilePaths = new Set(serviceFiles.map(f => f.filePath))

      // Find API endpoints that belong to this service
      for (const symbol of symbols) {
        if (symbol.type === CrossLanguageIntelligence.CrossLanguageSymbolType.API_ENDPOINT) {
          const belongsToService = symbol.definitions.some(def =>
            serviceFilePaths.has(def.filePath)
          )

          if (belongsToService) {
            const definition = symbol.definitions[0]
            endpoints.push({
              path: this.extractPathFromEndpointName(symbol.name),
              method: this.extractMethodFromEndpointName(symbol.name),
              inputSchema: undefined, // TODO: Extract from symbol metadata
              outputSchema: undefined, // TODO: Extract from symbol metadata
              language: definition.language,
              filePath: definition.filePath,
              security: [] // TODO: Extract security requirements
            })
          }
        }
      }

      return endpoints
    }

    private async analyzeServiceMetadata(
      serviceFiles: Array<{ filePath: string; language: string; result: ASTEngine.ParseResult }>,
      framework: string
    ): Promise<CrossLanguageIntelligence.ServiceMetadata> {

      // Analyze service configuration for metadata
      const metadata: CrossLanguageIntelligence.ServiceMetadata = {
        protocol: "HTTP", // Default
        authentication: [],
        monitoring: [],
        scalability: {
          horizontal: true,
          stateless: true,
          cacheability: "medium",
          bottlenecks: []
        }
      }

      // Framework-specific metadata analysis
      switch (framework) {
        case "Express":
        case "Fastify":
        case "Next.js":
          metadata.protocol = "HTTP"
          break
        case "gRPC":
          metadata.protocol = "gRPC"
          break
        case "GraphQL":
          metadata.protocol = "HTTP"
          break
      }

      return metadata
    }

    private extractPathFromEndpointName(endpointName: string): string {
      // Extract path from "GET /api/users" -> "/api/users"
      const match = endpointName.match(/\w+\s+(.+)/)
      return match ? match[1] : endpointName
    }

    private extractMethodFromEndpointName(endpointName: string): string {
      // Extract method from "GET /api/users" -> "GET"
      const match = endpointName.match(/^(\w+)\s/)
      return match ? match[1] : "GET"
    }
  }

  // ======================== SPECIALIZED DETECTOR CLASSES ========================

  /**
   * Service Detection Engine
   */
  class ServiceDetector {

    async groupFilesByService(
      fileResults: Map<string, ASTEngine.ParseResult>
    ): Promise<Map<string, Array<{ filePath: string; language: string; result: ASTEngine.ParseResult }>>> {

      const serviceGroups = new Map<string, Array<{ filePath: string; language: string; result: ASTEngine.ParseResult }>>()

      for (const [filePath, result] of fileResults) {
        const serviceName = this.detectServiceName(filePath, result)

        if (!serviceGroups.has(serviceName)) {
          serviceGroups.set(serviceName, [])
        }

        serviceGroups.get(serviceName)!.push({
          filePath,
          language: result.language || "unknown",
          result
        })
      }

      return serviceGroups
    }

    private detectServiceName(filePath: string, result: ASTEngine.ParseResult): string {
      // Detect service name from file path and content

      // Check for microservice patterns in path
      if (filePath.includes('services/')) {
        const match = filePath.match(/services\/([^\/]+)/)
        if (match) return match[1]
      }

      // Check for package.json service name
      if (filePath.endsWith('package.json')) {
        // TODO: Parse package.json to get service name
      }

      // Check for Docker service name
      if (filePath.includes('docker-compose')) {
        // TODO: Parse docker-compose to get service name
      }

      // Default to directory name
      const pathParts = filePath.split('/')
      return pathParts[pathParts.length - 2] || 'default-service'
    }

    async detectServiceType(
      serviceFiles: Array<{ filePath: string; language: string; result: ASTEngine.ParseResult }>,
      symbols: CrossLanguageIntelligence.CrossLanguageSymbol[]
    ): Promise<CrossLanguageIntelligence.ServiceNode["type"]> {

      // Check for database-related files
      if (serviceFiles.some(f => f.filePath.includes('database') || f.filePath.includes('db'))) {
        return "database"
      }

      // Check for message broker patterns
      if (serviceFiles.some(f =>
        f.filePath.includes('kafka') ||
        f.filePath.includes('rabbitmq') ||
        f.filePath.includes('queue')
      )) {
        return "message_broker"
      }

      // Check for cache patterns
      if (serviceFiles.some(f => f.filePath.includes('redis') || f.filePath.includes('cache'))) {
        return "cache"
      }

      // Check for API gateway patterns
      if (serviceFiles.some(f => f.filePath.includes('gateway') || f.filePath.includes('proxy'))) {
        return "gateway"
      }

      // Check for web service patterns (has HTTP endpoints)
      const hasEndpoints = symbols.some(s =>
        s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.API_ENDPOINT &&
        s.definitions.some(def => serviceFiles.some(f => f.filePath === def.filePath))
      )

      if (hasEndpoints) {
        // Determine if it's a full web service or microservice
        const endpointCount = symbols.filter(s =>
          s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.API_ENDPOINT
        ).length

        return endpointCount > 10 ? "web_service" : "microservice"
      }

      return "microservice" // Default
    }

    async detectFramework(
      serviceFiles: Array<{ filePath: string; language: string; result: ASTEngine.ParseResult }>,
      primaryLanguage: string
    ): Promise<string> {

      // Language and file-based framework detection
      for (const file of serviceFiles) {
        const framework = file.result.metadata.framework
        if (framework) return framework

        // Check for framework-specific files
        if (file.filePath.includes('package.json')) {
          // TODO: Parse package.json dependencies to detect framework
        }
      }

      // Default frameworks by language
      const defaultFrameworks: Record<string, string> = {
        javascript: "Express",
        typescript: "Express",
        python: "Flask",
        java: "Spring",
        go: "Gin",
        rust: "Actix",
        csharp: "ASP.NET Core",
        php: "Laravel",
        ruby: "Rails",
        kotlin: "Spring Boot",
        scala: "Akka HTTP",
        swift: "Vapor",
        dart: "Shelf",
        elixir: "Phoenix"
      }

      return defaultFrameworks[primaryLanguage] || "Unknown"
    }
  }

  /**
   * Service Dependency Mapper
   */
  class ServiceDependencyMapper {
    private serviceFileMap = new Map<string, CrossLanguageIntelligence.ServiceNode>()

    constructor(services: CrossLanguageIntelligence.ServiceNode[]) {
      // Build file -> service mapping
      for (const service of services) {
        for (const filePath of service.filePaths) {
          this.serviceFileMap.set(filePath, service)
        }
      }
    }

    findServiceByFile(filePath: string): CrossLanguageIntelligence.ServiceNode | undefined {
      return this.serviceFileMap.get(filePath)
    }

    async createDependency(
      sourceService: CrossLanguageIntelligence.ServiceNode,
      targetService: CrossLanguageIntelligence.ServiceNode,
      relationship: CrossLanguageIntelligence.CrossLanguageRelationship
    ): Promise<CrossLanguageIntelligence.ServiceDependency> {

      return {
        sourceServiceId: sourceService.id,
        targetServiceId: targetService.id,
        dependencyType: this.mapRelationshipTypeToDependencyType(relationship.type),
        strength: relationship.strength,
        metadata: {
          communicationMechanism: relationship.metadata.communicationMechanism,
          dataFormat: relationship.metadata.dataFormat,
          criticality: relationship.metadata.criticality,
          securityRequirements: relationship.metadata.securityImplications
        }
      }
    }

    private mapRelationshipTypeToDependencyType(relType: CrossLanguageIntelligence.CrossLanguageRelationType): string {
      switch (relType) {
        case CrossLanguageIntelligence.CrossLanguageRelationType.APICall:
          return "api_dependency"
        case CrossLanguageIntelligence.CrossLanguageRelationType.DatabaseAccess:
          return "data_dependency"
        case CrossLanguageIntelligence.CrossLanguageRelationType.MessageQueue:
          return "messaging_dependency"
        default:
          return "generic_dependency"
      }
    }
  }

  /**
   * Communication Path Mapper
   */
  class CommunicationPathMapper {
    constructor(private services: CrossLanguageIntelligence.ServiceNode[]) {}

    async createCommunicationPath(
      mechanism: string,
      relationships: CrossLanguageIntelligence.CrossLanguageRelationship[]
    ): Promise<CrossLanguageIntelligence.CommunicationPath> {

      const sourceServices = new Set<string>()
      const targetServices = new Set<string>()
      const protocols: string[] = []
      const dataFormats: string[] = []

      // Analyze relationships to build communication path
      for (const rel of relationships) {
        const sourceService = this.findServiceByFile(rel.source.filePath)
        const targetService = this.findServiceByFile(rel.target.filePath)

        if (sourceService) sourceServices.add(sourceService.id)
        if (targetService) targetServices.add(targetService.id)

        protocols.push(rel.metadata.communicationMechanism)
        dataFormats.push(rel.metadata.dataFormat)
      }

      return {
        id: `comm_path_${mechanism}_${Date.now()}`,
        name: `${mechanism} Communication Path`,
        mechanism,
        sourceServices: Array.from(sourceServices),
        targetServices: Array.from(targetServices),
        protocols: Array.from(new Set(protocols)),
        dataFormats: Array.from(new Set(dataFormats)),
        reliability: this.calculateReliability(mechanism),
        performance: this.analyzePerformance(mechanism, relationships),
        security: this.analyzeSecurity(relationships)
      }
    }

    private findServiceByFile(filePath: string): CrossLanguageIntelligence.ServiceNode | undefined {
      return this.services.find(service =>
        service.filePaths.some(path => path === filePath || filePath.includes(service.name))
      )
    }

    private calculateReliability(mechanism: string): "high" | "medium" | "low" {
      const reliabilityMap: Record<string, "high" | "medium" | "low"> = {
        "HTTP": "high",
        "gRPC": "high",
        "WebSocket": "medium",
        "Message Queue": "high",
        "Database": "high",
        "File": "low"
      }
      return reliabilityMap[mechanism] || "medium"
    }

    private analyzePerformance(
      mechanism: string,
      relationships: CrossLanguageIntelligence.CrossLanguageRelationship[]
    ): CommunicationPerformance {
      return {
        latency: mechanism === "gRPC" ? "low" : "medium",
        throughput: relationships.length > 10 ? "high" : "medium",
        overhead: mechanism === "HTTP" ? "medium" : "low",
        bottlenecks: this.identifyBottlenecks(mechanism)
      }
    }

    private analyzeSecurity(
      relationships: CrossLanguageIntelligence.CrossLanguageRelationship[]
    ): CommunicationSecurity {
      const securityMechanisms = new Set<string>()
      const vulnerabilities: string[] = []

      for (const rel of relationships) {
        rel.metadata.securityImplications.forEach(sec => securityMechanisms.add(sec))
        if (rel.metadata.communicationMechanism === "HTTP" && !rel.metadata.securityImplications.includes("tls")) {
          vulnerabilities.push("unencrypted_http")
        }
      }

      return {
        encryption: securityMechanisms.has("tls") || securityMechanisms.has("encryption"),
        authentication: securityMechanisms.has("authentication") || securityMechanisms.has("jwt"),
        authorization: securityMechanisms.has("authorization"),
        vulnerabilities
      }
    }

    private identifyBottlenecks(mechanism: string): string[] {
      const bottleneckMap: Record<string, string[]> = {
        "HTTP": ["connection_pooling", "serialization"],
        "gRPC": ["serialization", "connection_management"],
        "Database": ["query_optimization", "connection_pooling"],
        "Message Queue": ["message_serialization", "queue_depth"]
      }
      return bottleneckMap[mechanism] || []
    }
  }

  /**
   * Data Flow Mapper
   */
  class DataFlowMapper {
    constructor(
      private services: CrossLanguageIntelligence.ServiceNode[],
      private symbols: CrossLanguageIntelligence.CrossLanguageSymbol[]
    ) {}

    async createDataFlow(
      relationship: CrossLanguageIntelligence.CrossLanguageRelationship
    ): Promise<CrossLanguageIntelligence.DataFlow | null> {

      // Only create data flows for certain relationship types
      if (![
        CrossLanguageIntelligence.CrossLanguageRelationType.APICall,
        CrossLanguageIntelligence.CrossLanguageRelationType.DataTransfer,
        CrossLanguageIntelligence.CrossLanguageRelationType.MessageQueue
      ].includes(relationship.type)) {
        return null
      }

      const sourceService = this.findServiceByFile(relationship.source.filePath)
      const targetService = this.findServiceByFile(relationship.target.filePath)

      if (!sourceService || !targetService) return null

      const dataModel = this.identifyDataModel(relationship)
      const transformations = this.analyzeTransformations(relationship)

      return {
        id: `data_flow_${sourceService.id}_${targetService.id}_${Date.now()}`,
        source: {
          serviceId: sourceService.id,
          endpoint: this.extractEndpoint(relationship.source),
          language: relationship.source.language,
          filePath: relationship.source.filePath,
          dataFormat: relationship.metadata.dataFormat
        },
        target: {
          serviceId: targetService.id,
          endpoint: this.extractEndpoint(relationship.target),
          language: relationship.target.language,
          filePath: relationship.target.filePath,
          expectedFormat: relationship.metadata.dataFormat
        },
        steps: [],
        dataModel: dataModel?.id || "unknown",
        transformations,
        security: this.analyzeDataFlowSecurity(relationship),
        performance: this.analyzeDataFlowPerformance(relationship)
      }
    }

    private findServiceByFile(filePath: string): CrossLanguageIntelligence.ServiceNode | undefined {
      return this.services.find(service =>
        service.filePaths.some(path => path === filePath || filePath.includes(service.name))
      )
    }

    private identifyDataModel(
      relationship: CrossLanguageIntelligence.CrossLanguageRelationship
    ): CrossLanguageIntelligence.CrossLanguageSymbol | undefined {
      // Look for data model symbols that might be related to this relationship
      return this.symbols.find(s =>
        s.type === CrossLanguageIntelligence.CrossLanguageSymbolType.DATA_MODEL &&
        (s.definitions.some(def => def.filePath === relationship.source.filePath) ||
         s.definitions.some(def => def.filePath === relationship.target.filePath))
      )
    }

    private extractEndpoint(reference: CrossLanguageIntelligence.SymbolReference): string | undefined {
      // Try to extract endpoint information from the reference
      if (reference.context.accessPattern === "call" && reference.symbolKind === ASTEngine.SymbolKind.Function) {
        return `${reference.filePath}:${reference.range.startLine}`
      }
      return undefined
    }

    private analyzeTransformations(
      relationship: CrossLanguageIntelligence.CrossLanguageRelationship
    ): CrossLanguageIntelligence.DataTransformation[] {
      const transformations: CrossLanguageIntelligence.DataTransformation[] = []

      // If languages are different, there's likely a transformation
      if (relationship.source.language !== relationship.target.language) {
        transformations.push({
          from: relationship.source.language,
          to: relationship.target.language,
          transformerLocation: relationship.source,
          lossless: this.isLosslessTransformation(relationship.source.language, relationship.target.language),
          performance: {
            latencyOverhead: "medium",
            memoryUsage: "medium",
            cpuIntensive: false
          }
        })
      }

      return transformations
    }

    private isLosslessTransformation(fromLang: string, toLang: string): boolean {
      // Define language compatibility for lossless transformations
      const compatiblePairs = [
        ["javascript", "typescript"],
        ["java", "kotlin"],
        ["c", "cpp"]
      ]

      return compatiblePairs.some(([lang1, lang2]) =>
        (fromLang === lang1 && toLang === lang2) || (fromLang === lang2 && toLang === lang1)
      )
    }

    private analyzeDataFlowSecurity(
      relationship: CrossLanguageIntelligence.CrossLanguageRelationship
    ): CrossLanguageIntelligence.SecurityMechanism[] {
      return relationship.metadata.securityImplications.map(sec => ({
        type: sec,
        enabled: true,
        strength: "medium"
      }))
    }

    private analyzeDataFlowPerformance(
      relationship: CrossLanguageIntelligence.CrossLanguageRelationship
    ): CrossLanguageIntelligence.DataFlowPerformance {
      return {
        throughput: relationship.metadata.frequency === "high" ? "high" : "medium",
        latency: relationship.metadata.criticality === "critical" ? "low" : "medium",
        scalability: "horizontal",
        bottlenecks: []
      }
    }
  }

  /**
   * Deployment Unit Detector
   */
  class DeploymentUnitDetector {
    async detectDeploymentUnit(
      filePath: string,
      result: ASTEngine.ParseResult,
      services: CrossLanguageIntelligence.ServiceNode[]
    ): Promise<CrossLanguageIntelligence.DeploymentUnit | null> {

      const deploymentType = this.identifyDeploymentType(filePath)
      if (!deploymentType) return null

      const relatedServices = this.findRelatedServices(filePath, services)

      return {
        id: `deployment_${deploymentType}_${Date.now()}`,
        name: this.extractDeploymentName(filePath),
        type: deploymentType,
        filePath,
        services: relatedServices.map(s => s.id),
        environment: this.detectEnvironment(result),
        resources: this.analyzeResources(result),
        dependencies: this.analyzeDependencies(result),
        scaling: this.analyzeScaling(result, deploymentType)
      }
    }

    private identifyDeploymentType(filePath: string): string | null {
      if (filePath.includes('Dockerfile')) return 'docker'
      if (filePath.includes('docker-compose')) return 'docker-compose'
      if (filePath.includes('kubernetes') || filePath.includes('k8s')) return 'kubernetes'
      if (filePath.includes('terraform')) return 'terraform'
      if (filePath.includes('ansible')) return 'ansible'
      if (filePath.includes('helm')) return 'helm'
      return null
    }

    private extractDeploymentName(filePath: string): string {
      const pathParts = filePath.split('/')
      return pathParts[pathParts.length - 1].replace(/\.(yaml|yml|json|tf)$/, '')
    }

    private findRelatedServices(
      filePath: string,
      services: CrossLanguageIntelligence.ServiceNode[]
    ): CrossLanguageIntelligence.ServiceNode[] {
      // Find services that are in the same directory or subdirectories
      const deploymentDir = filePath.substring(0, filePath.lastIndexOf('/'))

      return services.filter(service =>
        service.filePaths.some(servicePath => servicePath.startsWith(deploymentDir))
      )
    }

    private detectEnvironment(result: ASTEngine.ParseResult): string {
      // Look for environment indicators in the deployment configuration
      const content = result.rawContent?.toLowerCase() || ""

      if (content.includes('production') || content.includes('prod')) return 'production'
      if (content.includes('staging') || content.includes('stage')) return 'staging'
      if (content.includes('development') || content.includes('dev')) return 'development'
      if (content.includes('test')) return 'test'

      return 'unknown'
    }

    private analyzeResources(result: ASTEngine.ParseResult): DeploymentResources {
      // Parse resource specifications from deployment files
      return {
        cpu: "medium",
        memory: "medium",
        storage: "medium",
        network: "standard"
      }
    }

    private analyzeDependencies(result: ASTEngine.ParseResult): string[] {
      // Extract dependencies from deployment configuration
      return []
    }

    private analyzeScaling(result: ASTEngine.ParseResult, deploymentType: string): DeploymentScaling {
      return {
        horizontal: deploymentType === 'kubernetes' || deploymentType === 'docker-compose',
        vertical: true,
        autoScaling: deploymentType === 'kubernetes',
        minReplicas: 1,
        maxReplicas: deploymentType === 'kubernetes' ? 10 : 3
      }
    }
  }

  // ======================== SUPPORTING TYPE DEFINITIONS ========================

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
}