// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
// Dynamic Relationship Detection Engine
// Advanced runtime behavior analysis and cross-file relationship resolution

import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"
import { TypeInference } from "./type-inference"
import { FrameworkIntelligence } from "./framework-intelligence"
import type { Node } from "web-tree-sitter"

export namespace DynamicRelationships {

  export interface DynamicRelationship extends UniversalRelationship {
    isRuntimeDetermined: boolean
    conditionalExecution?: boolean
    callFrequency?: "low" | "medium" | "high" | "critical"
    executionContext?: string[]
    dependencyChain?: string[]
  }

  export interface CallGraph {
    nodes: Map<string, CallGraphNode>
    edges: Map<string, CallGraphEdge[]>
    entryPoints: string[]
    cycles: string[][]
    criticalPaths: string[][]
  }

  export interface CallGraphNode {
    id: string
    name: string
    kind: SymbolKind
    filePath: string
    complexity: number
    isPublic: boolean
    isAsync: boolean
    frameworks: string[]
  }

  export interface CallGraphEdge {
    from: string
    to: string
    type: "direct" | "indirect" | "conditional" | "async"
    confidence: number
    weight: number
    executionFrequency?: number
  }

  export interface ImpactAnalysis {
    symbol: string
    directDependents: string[]
    indirectDependents: string[]
    impactRadius: number
    breakingChangeRisk: "low" | "medium" | "high" | "critical"
    refactoringComplexity: number
    testCoverage?: number
  }

  export class DynamicAnalyzer {
    private callGraph: CallGraph
    private typeEngine: TypeInference.TypeInferenceEngine
    private frameworkDetector: FrameworkIntelligence.FrameworkDetector

    constructor() {
      this.callGraph = {
        nodes: new Map(),
        edges: new Map(),
        entryPoints: [],
        cycles: [],
        criticalPaths: []
      }
      this.typeEngine = new TypeInference.TypeInferenceEngine()
      this.frameworkDetector = new FrameworkIntelligence.FrameworkDetector()
    }

    public analyzeProject(
      fileResults: Map<string, ParseResult>
    ): {
      callGraph: CallGraph
      dynamicRelationships: DynamicRelationship[]
      impactAnalysis: Map<string, ImpactAnalysis>
      orphanedSymbols: string[]
      architecturalComplexity: number
    } {
      // Build comprehensive call graph
      this.buildCallGraph(fileResults)

      // Resolve cross-file relationships
      const dynamicRelationships = this.resolveCrossFileRelationships(fileResults)

      // Analyze impact for each symbol
      const impactAnalysis = this.generateImpactAnalysis()

      // Find orphaned symbols
      const orphanedSymbols = this.findOrphanedSymbols()

      // Calculate architectural complexity
      const architecturalComplexity = this.calculateArchitecturalComplexity()

      return {
        callGraph: this.callGraph,
        dynamicRelationships,
        impactAnalysis,
        orphanedSymbols,
        architecturalComplexity
      }
    }

    private buildCallGraph(fileResults: Map<string, ParseResult>) {
      // Step 1: Create nodes for all symbols
      for (const [filePath, result] of fileResults) {
        for (const symbol of result.symbols) {
          const nodeId = `${filePath}::${symbol.name}`

          this.callGraph.nodes.set(nodeId, {
            id: nodeId,
            name: symbol.name,
            kind: symbol.kind,
            filePath,
            complexity: symbol.metadata?.cyclomaticComplexity || 1,
            isPublic: symbol.visibility === "public",
            isAsync: symbol.isAsync || false,
            frameworks: result.metadata?.detectedFrameworks || []
          })

          // Initialize edges array
          if (!this.callGraph.edges.has(nodeId)) {
            this.callGraph.edges.set(nodeId, [])
          }
        }
      }

      // Step 2: Create edges from relationships
      for (const [filePath, result] of fileResults) {
        for (const relationship of result.relationships) {
          const source = relationship.source || relationship.fromSymbol || relationship.from || "unknown"
          const target = relationship.target || relationship.toSymbol || relationship.to || "unknown"
          this.addCallGraphEdge(
            `${filePath}::${source}`,
            this.resolveTargetSymbol(target, fileResults),
            relationship
          )
        }
      }

      // Step 3: Detect entry points
      this.detectEntryPoints(fileResults)

      // Step 4: Find cycles and critical paths
      this.detectCycles()
      this.findCriticalPaths()
    }

    private resolveTargetSymbol(target: string, fileResults: Map<string, ParseResult>): string {
      // Try to resolve target symbol across files
      for (const [filePath, result] of fileResults) {
        // Direct match
        const directMatch = result.symbols.find(s => s.name === target)
        if (directMatch) {
          return `${filePath}::${target}`
        }

        // Import resolution
        for (const imp of result.imports) {
          if ((imp.items || []).includes(target)) {
            // Try to resolve from imported module
            const resolvedPath = this.resolveImportPath(imp.module || "", filePath)
            if (resolvedPath && fileResults.has(resolvedPath)) {
              return `${resolvedPath}::${target}`
            }
          }
        }
      }

      // Return unresolved target with unknown file
      return `unknown::${target}`
    }

    private resolveImportPath(modulePath: string, currentFilePath: string): string | null {
      // Simple resolution logic - in real implementation, would use more sophisticated module resolution
      if (modulePath.startsWith("./") || modulePath.startsWith("../")) {
        // Relative import - resolve relative to current file
        const basePath = currentFilePath.substring(0, currentFilePath.lastIndexOf("/"))
        return this.resolvePath(`${basePath}/${modulePath}`)
      }

      // Node modules or absolute imports would need package resolution
      return null
    }

    private resolvePath(path: string): string {
      // Normalize path (remove .., ., etc.)
      const parts = path.split("/")
      const resolved: string[] = []

      for (const part of parts) {
        if (part === "..") {
          resolved.pop()
        } else if (part !== "." && part !== "") {
          resolved.push(part)
        }
      }

      return resolved.join("/")
    }

    private addCallGraphEdge(fromId: string, toId: string, relationship: UniversalRelationship) {
      if (!this.callGraph.edges.has(fromId)) {
        this.callGraph.edges.set(fromId, [])
      }

      const edges = this.callGraph.edges.get(fromId)!

      const edgeType = this.determineEdgeType(relationship)
      const weight = this.calculateEdgeWeight(relationship, edgeType)

      edges.push({
        from: fromId,
        to: toId,
        type: edgeType,
        confidence: relationship.confidence || 0.5,
        weight
      })
    }

    private determineEdgeType(relationship: UniversalRelationship): "direct" | "indirect" | "conditional" | "async" {
      if (relationship.metadata?.isAsync) return "async"
      if (relationship.metadata?.conditional) return "conditional"
      if (relationship.type === RelationshipType.Calls) return "direct"
      return "indirect"
    }

    private calculateEdgeWeight(relationship: UniversalRelationship, edgeType: string): number {
      let weight = relationship.confidence || 0.5

      // Adjust weight based on relationship type
      switch (relationship.type) {
        case RelationshipType.Calls:
          weight *= 1.0
          break
        case RelationshipType.Uses:
          weight *= 0.8
          break
        case RelationshipType.References:
          weight *= 0.6
          break
        default:
          weight *= 0.5
      }

      // Adjust weight based on edge type
      switch (edgeType) {
        case "direct":
          weight *= 1.0
          break
        case "async":
          weight *= 0.9
          break
        case "conditional":
          weight *= 0.7
          break
        case "indirect":
          weight *= 0.5
          break
      }

      return weight
    }

    private detectEntryPoints(fileResults: Map<string, ParseResult>) {
      for (const [filePath, result] of fileResults) {
        for (const symbol of result.symbols) {
          const nodeId = `${filePath}::${symbol.name}`

          // Main functions
          if (symbol.name === "main" || symbol.name === "index") {
            this.callGraph.entryPoints.push(nodeId)
          }

          // Exported functions
          if (symbol.visibility === "public" && (result.exports || []).some(exp => exp.name === symbol.name)) {
            this.callGraph.entryPoints.push(nodeId)
          }

          // Framework entry points
          if (this.isFrameworkEntryPoint(symbol, result.metadata?.detectedFrameworks || [])) {
            this.callGraph.entryPoints.push(nodeId)
          }
        }
      }
    }

    private isFrameworkEntryPoint(symbol: UniversalSymbol, frameworks: string[]): boolean {
      // React components
      if (frameworks.includes("react") &&
          (symbol.name.endsWith("Component") || /^[A-Z]/.test(symbol.name))) {
        return true
      }

      // API endpoints
      if (frameworks.includes("express") || frameworks.includes("fastapi")) {
        const hasRouteDecorator = symbol.decorators?.some(d =>
          d.includes("@app.") || d.includes("@router.") || d.includes("@get") || d.includes("@post")
        )
        if (hasRouteDecorator) return true
      }

      return false
    }

    private detectCycles() {
      const visited = new Set<string>()
      const recursionStack = new Set<string>()
      const cycles: string[][] = []

      const dfs = (nodeId: string, path: string[]): void => {
        if (recursionStack.has(nodeId)) {
          // Found a cycle
          const cycleStart = path.indexOf(nodeId)
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart))
          }
          return
        }

        if (visited.has(nodeId)) return

        visited.add(nodeId)
        recursionStack.add(nodeId)
        path.push(nodeId)

        const edges = this.callGraph.edges.get(nodeId) || []
        for (const edge of edges) {
          dfs(edge.to, [...path])
        }

        recursionStack.delete(nodeId)
      }

      for (const nodeId of this.callGraph.nodes.keys()) {
        if (!visited.has(nodeId)) {
          dfs(nodeId, [])
        }
      }

      this.callGraph.cycles = cycles
    }

    private findCriticalPaths() {
      const criticalPaths: string[][] = []

      // Find paths from entry points to high-complexity nodes
      for (const entryPoint of this.callGraph.entryPoints) {
        const paths = this.findPathsToComplexNodes(entryPoint)
        criticalPaths.push(...paths)
      }

      // Sort by path complexity (sum of node complexities)
      criticalPaths.sort((a, b) => {
        const complexityA = a.reduce((sum, nodeId) => {
          const node = this.callGraph.nodes.get(nodeId)
          return sum + (node?.complexity || 0)
        }, 0)
        const complexityB = b.reduce((sum, nodeId) => {
          const node = this.callGraph.nodes.get(nodeId)
          return sum + (node?.complexity || 0)
        }, 0)
        return complexityB - complexityA
      })

      this.callGraph.criticalPaths = criticalPaths.slice(0, 10) // Keep top 10
    }

    private findPathsToComplexNodes(startNodeId: string): string[][] {
      const paths: string[][] = []
      const visited = new Set<string>()

      const dfs = (nodeId: string, path: string[], depth: number): void => {
        if (depth > 20 || visited.has(nodeId)) return // Prevent infinite recursion

        visited.add(nodeId)
        path.push(nodeId)

        const node = this.callGraph.nodes.get(nodeId)
        if (node && node.complexity > 5) {
          paths.push([...path])
        }

        const edges = this.callGraph.edges.get(nodeId) || []
        for (const edge of edges) {
          dfs(edge.to, [...path], depth + 1)
        }

        visited.delete(nodeId)
      }

      dfs(startNodeId, [], 0)
      return paths
    }

    private resolveCrossFileRelationships(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      const dynamicRelationships: DynamicRelationship[] = []

      // Strategy 1: Import/Export Resolution
      dynamicRelationships.push(...this.resolveImportExportRelationships(fileResults))

      // Strategy 2: Type-based Resolution
      dynamicRelationships.push(...this.resolveTypeBasedRelationships(fileResults))

      // Strategy 3: Framework Convention Resolution
      dynamicRelationships.push(...this.resolveFrameworkConventions(fileResults))

      // Strategy 4: Pattern-based Resolution
      dynamicRelationships.push(...this.resolvePatternBasedRelationships(fileResults))

      // Strategy 5: Runtime Analysis Simulation
      dynamicRelationships.push(...this.simulateRuntimeRelationships(fileResults))

      return dynamicRelationships
    }

    private resolveImportExportRelationships(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      const relationships: DynamicRelationship[] = []

      for (const [filePath, result] of fileResults) {
        for (const imp of result.imports) {
          const targetFilePath = this.resolveImportPath(imp.module || "", filePath)
          if (targetFilePath && fileResults.has(targetFilePath)) {
            const targetResult = fileResults.get(targetFilePath)!

            for (const importedItem of imp.items || []) {
              const targetSymbol = targetResult.symbols.find(s => s.name === importedItem)
              if (targetSymbol) {
                relationships.push({
                  source: `${filePath}::import`,
                  target: `${targetFilePath}::${importedItem}`,
                  type: RelationshipType.Imports,
                  confidence: 0.95,
                  isRuntimeDetermined: false,
                  metadata: {
                    crossFile: true,
                    importType: imp.isDefault ? "default" : "named",
                    moduleResolution: "static"
                  }
                })
              }
            }
          }
        }
      }

      return relationships
    }

    private resolveTypeBasedRelationships(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      const relationships: DynamicRelationship[] = []

      // Use type inference engine to resolve type-based relationships
      const filePaths = Array.from(fileResults.keys())
      const globalTypes = this.typeEngine.resolveTypesAcrossFiles(filePaths)

      for (const [filePath, result] of fileResults) {
        for (const symbol of result.symbols) {
          const typeInfo = symbol.metadata?.inferredType as TypeInference.TypeInfo
          if (typeInfo && typeInfo.superTypes) {
            for (const superType of typeInfo.superTypes) {
              const targetSymbol = this.findSymbolByType(superType.name, fileResults)
              if (targetSymbol) {
                relationships.push({
                  source: `${filePath}::${symbol.name}`,
                  target: targetSymbol,
                  type: RelationshipType.Extends,
                  confidence: typeInfo.confidence,
                  isRuntimeDetermined: false,
                  metadata: {
                    typeInferred: true,
                    typeKind: superType.kind
                  }
                })
              }
            }
          }
        }
      }

      return relationships
    }

    private resolveFrameworkConventions(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      const relationships: DynamicRelationship[] = []

      for (const [filePath, result] of fileResults) {
        const frameworks = result.metadata?.detectedFrameworks || []

        for (const framework of frameworks) {
          switch (framework) {
            case "react":
              relationships.push(...this.resolveReactConventions(filePath, result, fileResults))
              break
            case "django":
              relationships.push(...this.resolveDjangoConventions(filePath, result, fileResults))
              break
            case "rails":
              relationships.push(...this.resolveRailsConventions(filePath, result, fileResults))
              break
            case "spring":
              relationships.push(...this.resolveSpringConventions(filePath, result, fileResults))
              break
          }
        }
      }

      return relationships
    }

    private resolveReactConventions(
      filePath: string,
      result: ParseResult,
      fileResults: Map<string, ParseResult>
    ): DynamicRelationship[] {
      const relationships: DynamicRelationship[] = []

      // React component imports (JSX usage)
      for (const symbol of result.symbols) {
        if (symbol.kind === SymbolKind.Function && /^[A-Z]/.test(symbol.name)) {
          // This might be a React component used in JSX
          const usages = this.findJSXUsages(symbol.name, fileResults)
          for (const usage of usages) {
            relationships.push({
              source: usage,
              target: `${filePath}::${symbol.name}`,
              type: RelationshipType.Uses,
              confidence: 0.8,
              isRuntimeDetermined: true,
              conditionalExecution: true,
              metadata: {
                framework: "react",
                usageType: "jsx-component"
              }
            })
          }
        }
      }

      return relationships
    }

    private resolveDjangoConventions(
      filePath: string,
      result: ParseResult,
      fileResults: Map<string, ParseResult>
    ): DynamicRelationship[] {
      // Django model relationships, URL patterns, etc.
      return []
    }

    private resolveRailsConventions(
      filePath: string,
      result: ParseResult,
      fileResults: Map<string, ParseResult>
    ): DynamicRelationship[] {
      // Rails conventions: controller actions, model associations, etc.
      return []
    }

    private resolveSpringConventions(
      filePath: string,
      result: ParseResult,
      fileResults: Map<string, ParseResult>
    ): DynamicRelationship[] {
      // Spring dependency injection, component scanning, etc.
      return []
    }

    private resolvePatternBasedRelationships(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      const relationships: DynamicRelationship[] = []

      // Observer pattern detection
      relationships.push(...this.detectObserverPattern(fileResults))

      // Factory pattern detection
      relationships.push(...this.detectFactoryPattern(fileResults))

      // Strategy pattern detection
      relationships.push(...this.detectStrategyPattern(fileResults))

      return relationships
    }

    private simulateRuntimeRelationships(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      const relationships: DynamicRelationship[] = []

      // Simulate dynamic method calls, reflection, etc.
      for (const [filePath, result] of fileResults) {
        for (const symbol of result.symbols) {
          if (symbol.qualified_calls) {
            for (const call of symbol.qualified_calls) {
              const targetSymbol = this.findSymbolByName(call, fileResults)
              if (targetSymbol) {
                relationships.push({
                  source: `${filePath}::${symbol.name}`,
                  target: targetSymbol,
                  type: RelationshipType.Calls,
                  confidence: 0.7,
                  isRuntimeDetermined: true,
                  callFrequency: this.estimateCallFrequency(call, symbol),
                  metadata: {
                    dynamicCall: true,
                    callPattern: this.analyzeCallPattern(call)
                  }
                })
              }
            }
          }
        }
      }

      return relationships
    }

    // Helper methods
    private findSymbolByType(typeName: string, fileResults: Map<string, ParseResult>): string | null {
      for (const [filePath, result] of fileResults) {
        const symbol = result.symbols.find(s => s.name === typeName)
        if (symbol) {
          return `${filePath}::${symbol.name}`
        }
      }
      return null
    }

    private findSymbolByName(symbolName: string, fileResults: Map<string, ParseResult>): string | null {
      // Split qualified name (e.g., "service.createUser" -> "service", "createUser")
      const parts = symbolName.split(".")
      const methodName = parts.pop()!
      const objectName = parts.join(".")

      for (const [filePath, result] of fileResults) {
        // Look for direct match
        let symbol = result.symbols.find(s => s.name === methodName)
        if (symbol) {
          return `${filePath}::${symbol.name}`
        }

        // Look for method within class/object
        if (objectName) {
          const parentSymbol = result.symbols.find(s => s.name === objectName)
          if (parentSymbol) {
            symbol = result.symbols.find(s => s.ownerName === objectName && s.name === methodName)
            if (symbol) {
              return `${filePath}::${symbol.name}`
            }
          }
        }
      }

      return null
    }

    private findJSXUsages(componentName: string, fileResults: Map<string, ParseResult>): string[] {
      const usages: string[] = []
      // In a real implementation, would parse JSX and find component usages
      return usages
    }

    private detectObserverPattern(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      // Pattern detection logic for observer pattern
      return []
    }

    private detectFactoryPattern(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      // Pattern detection logic for factory pattern
      return []
    }

    private detectStrategyPattern(fileResults: Map<string, ParseResult>): DynamicRelationship[] {
      // Pattern detection logic for strategy pattern
      return []
    }

    private estimateCallFrequency(call: string, symbol: UniversalSymbol): "low" | "medium" | "high" | "critical" {
      // Heuristic-based call frequency estimation
      if (symbol.name === "main" || symbol.name.includes("init")) return "critical"
      if (call.includes("log") || call.includes("debug")) return "high"
      if (call.includes("validate") || call.includes("check")) return "medium"
      return "low"
    }

    private analyzeCallPattern(call: string): string {
      if (call.includes(".")) return "method_call"
      if (call.includes("(")) return "function_call"
      if (call.includes("new ")) return "constructor_call"
      return "unknown"
    }

    private generateImpactAnalysis(): Map<string, ImpactAnalysis> {
      const analysis = new Map<string, ImpactAnalysis>()

      for (const [nodeId, node] of this.callGraph.nodes) {
        const directDependents = this.getDirectDependents(nodeId)
        const indirectDependents = this.getIndirectDependents(nodeId, new Set())
        const impactRadius = directDependents.length + indirectDependents.length

        analysis.set(nodeId, {
          symbol: node.name,
          directDependents,
          indirectDependents,
          impactRadius,
          breakingChangeRisk: this.assessBreakingChangeRisk(impactRadius, node),
          refactoringComplexity: this.calculateRefactoringComplexity(nodeId)
        })
      }

      return analysis
    }

    private getDirectDependents(nodeId: string): string[] {
      const dependents: string[] = []

      for (const [fromId, edges] of this.callGraph.edges) {
        for (const edge of edges) {
          if (edge.to === nodeId) {
            dependents.push(fromId)
          }
        }
      }

      return dependents
    }

    private getIndirectDependents(nodeId: string, visited: Set<string>): string[] {
      if (visited.has(nodeId)) return []
      visited.add(nodeId)

      const indirectDependents: string[] = []
      const directDependents = this.getDirectDependents(nodeId)

      for (const dependent of directDependents) {
        indirectDependents.push(...this.getIndirectDependents(dependent, new Set(visited)))
      }

      return Array.from(new Set(indirectDependents))
    }

    private assessBreakingChangeRisk(impactRadius: number, node: CallGraphNode): "low" | "medium" | "high" | "critical" {
      if (impactRadius > 20 || node.isPublic) return "critical"
      if (impactRadius > 10) return "high"
      if (impactRadius > 5) return "medium"
      return "low"
    }

    private calculateRefactoringComplexity(nodeId: string): number {
      const node = this.callGraph.nodes.get(nodeId)!
      const edges = this.callGraph.edges.get(nodeId) || []

      return node.complexity + edges.length * 0.5
    }

    private findOrphanedSymbols(): string[] {
      const orphaned: string[] = []

      for (const [nodeId, node] of this.callGraph.nodes) {
        if (node.isPublic) continue // Public symbols might be used externally

        const hasIncomingEdges = Array.from(this.callGraph.edges.values())
          .some(edges => edges.some(edge => edge.to === nodeId))

        if (!hasIncomingEdges) {
          orphaned.push(nodeId)
        }
      }

      return orphaned
    }

    private calculateArchitecturalComplexity(): number {
      const nodeCount = this.callGraph.nodes.size
      const edgeCount = Array.from(this.callGraph.edges.values())
        .reduce((sum, edges) => sum + edges.length, 0)

      const cyclomaticComplexity = Array.from(this.callGraph.nodes.values())
        .reduce((sum, node) => sum + node.complexity, 0)

      const cycleCount = this.callGraph.cycles.length

      // Normalized complexity score (0-100)
      return Math.min(100,
        (edgeCount / nodeCount) * 10 +
        (cyclomaticComplexity / nodeCount) +
        cycleCount * 2
      )
    }
  }

  // Integration function to enhance project analysis
  export function enhanceWithDynamicAnalysis(
    fileResults: Map<string, ParseResult>
  ): {
    enhancedResults: Map<string, ParseResult>
    projectAnalysis: {
      callGraph: CallGraph
      dynamicRelationships: DynamicRelationship[]
      impactAnalysis: Map<string, ImpactAnalysis>
      orphanedSymbols: string[]
      architecturalComplexity: number
    }
  } {
    const analyzer = new DynamicAnalyzer()
    const projectAnalysis = analyzer.analyzeProject(fileResults)

    // Enhance each file result with cross-file relationships
    const enhancedResults = new Map<string, ParseResult>()

    for (const [filePath, result] of fileResults) {
      const fileRelationships = projectAnalysis.dynamicRelationships.filter(rel =>
        (rel.source || "").startsWith(`${filePath}::`) || (rel.target || "").startsWith(`${filePath}::`)
      )

      enhancedResults.set(filePath, {
        ...result,
        relationships: [...result.relationships, ...fileRelationships],
        metadata: {
          ...result.metadata,
          crossFileRelationshipCount: fileRelationships.length,
          architecturalScore: projectAnalysis.architecturalComplexity,
          hasOrphanedSymbols: projectAnalysis.orphanedSymbols.some(s => s.startsWith(`${filePath}::`))
        }
      })
    }

    return {
      enhancedResults,
      projectAnalysis
    }
  }
}