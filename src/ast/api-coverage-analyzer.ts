// API Coverage Analyzer
// Analyzes ALL API endpoints across polyglot systems
// COVERAGE: Documentation, testing, security, monitoring - EVERYTHING tracked!

import { ASTEngine } from "./engine"
import { CrossLanguageIntelligence } from "./cross-language-intelligence"
// M57.T5 (#793): ONE test-file definition (test-classification.ts) — the private
// detector below matched raw substrings ("contest.ts" contains "test") and had
// no file-type gate, so JSON fixtures under a /spec/ dir counted as testers.
import { isTestFileCandidate } from "./test-classification"
import * as Log from "../tool/brain-log"

const log = Log.create({ service: "api-coverage-analyzer" })

export namespace APICoverageAnalyzer {

  /**
   * API Coverage Analysis
   * Analyzes EVERY aspect of API coverage with precision
   */
  export async function analyzeAPICoverage(
    topology: CrossLanguageIntelligence.ServiceTopology,
    fileResults: Map<string, ASTEngine.ParseResult>
  ): Promise<CrossLanguageIntelligence.APICoverageAnalysis> {

    log.info("📋 Starting API Coverage Analysis")

    const coverageAnalyzer = new APICoverageAnalyzer()

    // STEP 1: 📊 ENDPOINT INVENTORY - Count ALL endpoints
    const allEndpoints = coverageAnalyzer.gatherAllEndpoints(topology)
    log.info("🔗 All endpoints gathered", { total: allEndpoints.length })

    // STEP 2: 📚 DOCUMENTATION ANALYSIS - Check ALL documentation
    const documentationCoverage = await coverageAnalyzer.analyzeDocumentation(allEndpoints, fileResults)
    log.info("📖 Documentation analyzed", { documented: documentationCoverage.documentedCount })

    // STEP 3: 🧪 TESTING ANALYSIS - Check ALL tests
    const testingCoverage = await coverageAnalyzer.analyzeTesting(allEndpoints, fileResults)
    log.info("🧪 Testing analyzed", { tested: testingCoverage.testedCount })

    // STEP 4: 🔒 SECURITY ANALYSIS - Check ALL security measures
    const securityCoverage = await coverageAnalyzer.analyzeSecurity(allEndpoints, topology)
    log.info("🛡️ Security analyzed", { secured: securityCoverage.securedCount })

    // STEP 5: 📈 MONITORING ANALYSIS - Check ALL monitoring
    const monitoringCoverage = await coverageAnalyzer.analyzeMonitoring(allEndpoints, fileResults)
    log.info("📊 Monitoring analyzed", { monitored: monitoringCoverage.monitoredCount })

    // STEP 6: 🏷️ VERSIONING ANALYSIS - Check ALL versioning
    const versioningCoverage = await coverageAnalyzer.analyzeVersioning(allEndpoints, topology)
    log.info("🏷️ Versioning analyzed", { versioned: versioningCoverage.versionedCount })

    // STEP 7: 🔍 GAP ANALYSIS - Identify ALL gaps
    const gaps = await coverageAnalyzer.identifyGaps(allEndpoints, {
      documentation: documentationCoverage,
      testing: testingCoverage,
      security: securityCoverage,
      monitoring: monitoringCoverage,
      versioning: versioningCoverage
    })

    const analysis: CrossLanguageIntelligence.APICoverageAnalysis = {
      totalEndpoints: allEndpoints.length,
      documentedEndpoints: documentationCoverage.documentedCount,
      testedEndpoints: testingCoverage.testedCount,
      securedEndpoints: securityCoverage.securedCount,
      monitoredEndpoints: monitoringCoverage.monitoredCount,
      versionedEndpoints: versioningCoverage.versionedCount,
      coverage: {
        documentation: Math.round((documentationCoverage.documentedCount / allEndpoints.length) * 100),
        testing: Math.round((testingCoverage.testedCount / allEndpoints.length) * 100),
        security: Math.round((securityCoverage.securedCount / allEndpoints.length) * 100),
        monitoring: Math.round((monitoringCoverage.monitoredCount / allEndpoints.length) * 100),
        versioning: Math.round((versioningCoverage.versionedCount / allEndpoints.length) * 100),
        overall: 0 // Will be calculated below
      },
      gaps
    }

    // Calculate overall coverage
    analysis.coverage.overall = Math.round(
      (analysis.coverage.documentation + analysis.coverage.testing +
       analysis.coverage.security + analysis.coverage.monitoring +
       analysis.coverage.versioning) / 5
    )

    log.info("🎉 API COVERAGE ANALYSIS COMPLETE!", {
      totalEndpoints: analysis.totalEndpoints,
      overallCoverage: analysis.coverage.overall,
      gaps: gaps.length
    })

    return analysis
  }

  /**
   * API Coverage Analysis Engine
   */
  class APICoverageAnalyzer {

    /**
     * Gather ALL endpoints from topology
     */
    gatherAllEndpoints(topology: CrossLanguageIntelligence.ServiceTopology): CrossLanguageIntelligence.ServiceEndpoint[] {
      const allEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []

      for (const service of topology.services) {
        allEndpoints.push(...service.endpoints)
      }

      return allEndpoints
    }

    /**
     * Documentation Analysis
     */
    async analyzeDocumentation(
      endpoints: CrossLanguageIntelligence.ServiceEndpoint[],
      fileResults: Map<string, ASTEngine.ParseResult>
    ): Promise<DocumentationAnalysis> {

      const documentationChecker = new DocumentationChecker()
      let documentedCount = 0
      const documentedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []
      const undocumentedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []

      for (const endpoint of endpoints) {
        const isDocumented = await documentationChecker.checkEndpointDocumentation(endpoint, fileResults)

        if (isDocumented) {
          documentedCount++
          documentedEndpoints.push(endpoint)
        } else {
          undocumentedEndpoints.push(endpoint)
        }
      }

      return {
        documentedCount,
        documentedEndpoints,
        undocumentedEndpoints,
        documentationTypes: await documentationChecker.identifyDocumentationTypes(fileResults)
      }
    }

    /**
     * Testing Analysis
     */
    async analyzeTesting(
      endpoints: CrossLanguageIntelligence.ServiceEndpoint[],
      fileResults: Map<string, ASTEngine.ParseResult>
    ): Promise<TestingAnalysis> {

      const testChecker = new TestChecker()
      let testedCount = 0
      const testedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []
      const untestedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []

      for (const endpoint of endpoints) {
        const isTested = await testChecker.checkEndpointTesting(endpoint, fileResults)

        if (isTested) {
          testedCount++
          testedEndpoints.push(endpoint)
        } else {
          untestedEndpoints.push(endpoint)
        }
      }

      return {
        testedCount,
        testedEndpoints,
        untestedEndpoints,
        testTypes: await testChecker.identifyTestTypes(fileResults),
        testFrameworks: await testChecker.identifyTestFrameworks(fileResults)
      }
    }

    /**
     * Security Analysis
     */
    async analyzeSecurity(
      endpoints: CrossLanguageIntelligence.ServiceEndpoint[],
      topology: CrossLanguageIntelligence.ServiceTopology
    ): Promise<SecurityAnalysis> {

      const securityChecker = new SecurityChecker()
      let securedCount = 0
      const securedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []
      const unsecuredEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []

      for (const endpoint of endpoints) {
        const isSecured = securityChecker.checkEndpointSecurity(endpoint)

        if (isSecured) {
          securedCount++
          securedEndpoints.push(endpoint)
        } else {
          unsecuredEndpoints.push(endpoint)
        }
      }

      return {
        securedCount,
        securedEndpoints,
        unsecuredEndpoints,
        securityMechanisms: securityChecker.identifySecurityMechanisms(topology)
      }
    }

    /**
     * Monitoring Analysis
     */
    async analyzeMonitoring(
      endpoints: CrossLanguageIntelligence.ServiceEndpoint[],
      fileResults: Map<string, ASTEngine.ParseResult>
    ): Promise<MonitoringAnalysis> {

      const monitoringChecker = new MonitoringChecker()
      let monitoredCount = 0
      const monitoredEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []
      const unmonitoredEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []

      for (const endpoint of endpoints) {
        const isMonitored = await monitoringChecker.checkEndpointMonitoring(endpoint, fileResults)

        if (isMonitored) {
          monitoredCount++
          monitoredEndpoints.push(endpoint)
        } else {
          unmonitoredEndpoints.push(endpoint)
        }
      }

      return {
        monitoredCount,
        monitoredEndpoints,
        unmonitoredEndpoints,
        monitoringTools: await monitoringChecker.identifyMonitoringTools(fileResults)
      }
    }

    /**
     * Versioning Analysis
     */
    async analyzeVersioning(
      endpoints: CrossLanguageIntelligence.ServiceEndpoint[],
      topology: CrossLanguageIntelligence.ServiceTopology
    ): Promise<VersioningAnalysis> {

      const versioningChecker = new VersioningChecker()
      let versionedCount = 0
      const versionedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []
      const unversionedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[] = []

      for (const endpoint of endpoints) {
        const isVersioned = versioningChecker.checkEndpointVersioning(endpoint)

        if (isVersioned) {
          versionedCount++
          versionedEndpoints.push(endpoint)
        } else {
          unversionedEndpoints.push(endpoint)
        }
      }

      return {
        versionedCount,
        versionedEndpoints,
        unversionedEndpoints,
        versioningStrategies: versioningChecker.identifyVersioningStrategies(topology)
      }
    }

    /**
     * Gap Analysis
     */
    async identifyGaps(
      endpoints: CrossLanguageIntelligence.ServiceEndpoint[],
      coverageData: {
        documentation: DocumentationAnalysis
        testing: TestingAnalysis
        security: SecurityAnalysis
        monitoring: MonitoringAnalysis
        versioning: VersioningAnalysis
      }
    ): Promise<CrossLanguageIntelligence.APIGap[]> {

      const gaps: CrossLanguageIntelligence.APIGap[] = []

      // Documentation gaps
      if (coverageData.documentation.undocumentedEndpoints.length > 0) {
        gaps.push({
          type: "documentation",
          endpoints: coverageData.documentation.undocumentedEndpoints,
          severity: this.calculateGapSeverity("documentation", coverageData.documentation.undocumentedEndpoints.length, endpoints.length),
          recommendations: [
            "Add OpenAPI/Swagger documentation",
            "Include inline code documentation",
            "Create API usage examples",
            "Document error responses"
          ]
        })
      }

      // Testing gaps
      if (coverageData.testing.untestedEndpoints.length > 0) {
        gaps.push({
          type: "testing",
          endpoints: coverageData.testing.untestedEndpoints,
          severity: this.calculateGapSeverity("testing", coverageData.testing.untestedEndpoints.length, endpoints.length),
          recommendations: [
            "Add unit tests for endpoint handlers",
            "Create integration tests",
            "Implement contract testing",
            "Add performance tests"
          ]
        })
      }

      // Security gaps
      if (coverageData.security.unsecuredEndpoints.length > 0) {
        gaps.push({
          type: "security",
          endpoints: coverageData.security.unsecuredEndpoints,
          severity: "high", // Security gaps are always high severity
          recommendations: [
            "Implement authentication mechanisms",
            "Add authorization checks",
            "Enable HTTPS/TLS",
            "Add rate limiting",
            "Implement input validation"
          ]
        })
      }

      // Monitoring gaps
      if (coverageData.monitoring.unmonitoredEndpoints.length > 0) {
        gaps.push({
          type: "monitoring",
          endpoints: coverageData.monitoring.unmonitoredEndpoints,
          severity: this.calculateGapSeverity("monitoring", coverageData.monitoring.unmonitoredEndpoints.length, endpoints.length),
          recommendations: [
            "Add metrics collection",
            "Implement health checks",
            "Set up error tracking",
            "Add performance monitoring",
            "Create dashboards"
          ]
        })
      }

      // Versioning gaps
      if (coverageData.versioning.unversionedEndpoints.length > 0) {
        gaps.push({
          type: "versioning",
          endpoints: coverageData.versioning.unversionedEndpoints,
          severity: this.calculateGapSeverity("versioning", coverageData.versioning.unversionedEndpoints.length, endpoints.length),
          recommendations: [
            "Implement API versioning strategy",
            "Add version headers",
            "Create backward compatibility plan",
            "Document breaking changes"
          ]
        })
      }

      return gaps
    }

    private calculateGapSeverity(gapType: string, gapCount: number, totalCount: number): "high" | "medium" | "low" {
      const percentage = (gapCount / totalCount) * 100

      if (percentage > 70) return "high"
      if (percentage > 30) return "medium"
      return "low"
    }
  }

  // ======================== SUPPORTING CLASSES ========================

  class DocumentationChecker {
    async checkEndpointDocumentation(endpoint: CrossLanguageIntelligence.ServiceEndpoint, fileResults: Map<string, ASTEngine.ParseResult>): Promise<boolean> {
      // Check for OpenAPI, Swagger, JSDoc, docstrings, etc.
      const result = fileResults.get(endpoint.filePath)
      if (!result) return false

      // Look for documentation patterns
      const hasDocumentation = [
        // OpenAPI/Swagger annotations
        /@swagger|@openapi/i.test(result.rawContent || ""),
        // JSDoc comments
        /\/\*\*.*@api/i.test(result.rawContent || ""),
        // Python docstrings
        /""".*endpoint|'''.*endpoint/i.test(result.rawContent || ""),
        // Inline comments above endpoint
        /\/\/.*endpoint|#.*endpoint/i.test(result.rawContent || "")
      ].some(pattern => pattern)

      return hasDocumentation
    }

    async identifyDocumentationTypes(fileResults: Map<string, ASTEngine.ParseResult>): Promise<string[]> {
      const types = new Set<string>()

      for (const [_, result] of fileResults) {
        if (/@swagger|@openapi/i.test(result.rawContent || "")) types.add("OpenAPI/Swagger")
        if (/\/\*\*.*@api/i.test(result.rawContent || "")) types.add("JSDoc")
        if (/""".*API|'''.*API/i.test(result.rawContent || "")) types.add("Python Docstrings")
        if (/README\.md|\.md$/i.test(result.filePath)) types.add("Markdown Documentation")
      }

      return Array.from(types)
    }
  }

  class TestChecker {
    async checkEndpointTesting(endpoint: CrossLanguageIntelligence.ServiceEndpoint, fileResults: Map<string, ASTEngine.ParseResult>): Promise<boolean> {
      // Look for test files that reference this endpoint
      const endpointName = endpoint.path.replace(/[^\w]/g, '_')

      for (const [filePath, result] of fileResults) {
        if (isTestFileCandidate(filePath)) {
          if (result.rawContent?.includes(endpoint.path) ||
              result.rawContent?.includes(endpointName) ||
              result.symbols.some(s => s.name.toLowerCase().includes(endpointName.toLowerCase()))) {
            return true
          }
        }
      }

      return false
    }

    private isTestFile(filePath: string): boolean {
      // M57.T5: canonical predicate — kept as a thin delegate so the private
      // call sites in identifyTestTypes stay untouched.
      return isTestFileCandidate(filePath)
    }

    async identifyTestTypes(fileResults: Map<string, ASTEngine.ParseResult>): Promise<string[]> {
      const types = new Set<string>()

      for (const [filePath, result] of fileResults) {
        if (this.isTestFile(filePath)) {
          if (/jest|mocha|jasmine/i.test(result.rawContent || "")) types.add("Unit Tests")
          if (/supertest|request|http/i.test(result.rawContent || "")) types.add("Integration Tests")
          if (/cypress|selenium|puppeteer/i.test(result.rawContent || "")) types.add("E2E Tests")
          if (/benchmark|performance/i.test(result.rawContent || "")) types.add("Performance Tests")
        }
      }

      return Array.from(types)
    }

    async identifyTestFrameworks(fileResults: Map<string, ASTEngine.ParseResult>): Promise<string[]> {
      const frameworks = new Set<string>()

      for (const [_, result] of fileResults) {
        const content = result.rawContent || ""
        if (/jest/i.test(content)) frameworks.add("Jest")
        if (/mocha/i.test(content)) frameworks.add("Mocha")
        if (/pytest/i.test(content)) frameworks.add("PyTest")
        if (/junit/i.test(content)) frameworks.add("JUnit")
        if (/testng/i.test(content)) frameworks.add("TestNG")
        if (/rspec/i.test(content)) frameworks.add("RSpec")
      }

      return Array.from(frameworks)
    }
  }

  class SecurityChecker {
    checkEndpointSecurity(endpoint: CrossLanguageIntelligence.ServiceEndpoint): boolean {
      return endpoint.security && endpoint.security.length > 0
    }

    identifySecurityMechanisms(topology: CrossLanguageIntelligence.ServiceTopology): string[] {
      const mechanisms = new Set<string>()

      for (const service of topology.services) {
        service.metadata.authentication.forEach(auth => mechanisms.add(auth))

        for (const endpoint of service.endpoints) {
          endpoint.security.forEach(sec => {
            if (typeof sec === 'object' && 'type' in sec) {
              mechanisms.add(sec.type)
            }
          })
        }
      }

      return Array.from(mechanisms)
    }
  }

  class MonitoringChecker {
    async checkEndpointMonitoring(endpoint: CrossLanguageIntelligence.ServiceEndpoint, fileResults: Map<string, ASTEngine.ParseResult>): Promise<boolean> {
      const result = fileResults.get(endpoint.filePath)
      if (!result) return false

      // Look for monitoring patterns
      const hasMonitoring = [
        /metrics|prometheus|statsd/i.test(result.rawContent || ""),
        /logger|logging|log\./i.test(result.rawContent || ""),
        /trace|span|opentelemetry/i.test(result.rawContent || ""),
        /health.*check|\/health|\/metrics/i.test(result.rawContent || "")
      ].some(pattern => pattern)

      return hasMonitoring
    }

    async identifyMonitoringTools(fileResults: Map<string, ASTEngine.ParseResult>): Promise<string[]> {
      const tools = new Set<string>()

      for (const [_, result] of fileResults) {
        const content = result.rawContent || ""
        if (/prometheus/i.test(content)) tools.add("Prometheus")
        if (/grafana/i.test(content)) tools.add("Grafana")
        if (/newrelic/i.test(content)) tools.add("New Relic")
        if (/datadog/i.test(content)) tools.add("DataDog")
        if (/jaeger|zipkin/i.test(content)) tools.add("Distributed Tracing")
      }

      return Array.from(tools)
    }
  }

  class VersioningChecker {
    checkEndpointVersioning(endpoint: CrossLanguageIntelligence.ServiceEndpoint): boolean {
      // Check if endpoint path includes versioning
      return /\/v\d+\/|\/api\/v\d+/i.test(endpoint.path) ||
             endpoint.path.includes("version") ||
             endpoint.method.includes("v")
    }

    identifyVersioningStrategies(topology: CrossLanguageIntelligence.ServiceTopology): string[] {
      const strategies = new Set<string>()

      for (const service of topology.services) {
        for (const endpoint of service.endpoints) {
          if (/\/v\d+\//i.test(endpoint.path)) strategies.add("URL Path Versioning")
          // Additional versioning strategy detection logic
        }
      }

      return Array.from(strategies)
    }
  }

  // Supporting interfaces
  interface DocumentationAnalysis {
    documentedCount: number
    documentedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    undocumentedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    documentationTypes: string[]
  }

  interface TestingAnalysis {
    testedCount: number
    testedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    untestedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    testTypes: string[]
    testFrameworks: string[]
  }

  interface SecurityAnalysis {
    securedCount: number
    securedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    unsecuredEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    securityMechanisms: string[]
  }

  interface MonitoringAnalysis {
    monitoredCount: number
    monitoredEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    unmonitoredEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    monitoringTools: string[]
  }

  interface VersioningAnalysis {
    versionedCount: number
    versionedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    unversionedEndpoints: CrossLanguageIntelligence.ServiceEndpoint[]
    versioningStrategies: string[]
  }
}