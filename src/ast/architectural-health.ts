import { APIContractValidator } from "./api-contract-validator"
import { CrossLanguageIntelligence } from "./cross-language-intelligence"
import { ASTEngine } from "./engine"

export class ArchitecturalHealthMonitor {
  /**
   * Circular Dependency Detection
   * Uses Tarjan's strongly connected components algorithm to find all cycles
   */
  public detectCircularDependencies(relationships: CrossLanguageIntelligence.CrossLanguageRelationship[]): string[][] {
    const adjList = new Map<string, string[]>()
    const nodes = new Set<string>()

    for (const rel of relationships) {
      if (!rel.source?.filePath || !rel.target?.filePath) continue

      const sourceFile = rel.source.filePath
      const targetFile = rel.target.filePath

      // We only care about cross-file circular dependencies
      if (sourceFile === targetFile) continue

      nodes.add(sourceFile)
      nodes.add(targetFile)

      if (!adjList.has(sourceFile)) adjList.set(sourceFile, [])
      adjList.get(sourceFile)!.push(targetFile)
    }

    // Tarjan's SCC
    let index = 0
    const indices = new Map<string, number>()
    const lowlink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    const cycles: string[][] = []

    const strongconnect = (v: string) => {
      indices.set(v, index)
      lowlink.set(v, index)
      index++
      stack.push(v)
      onStack.add(v)

      const neighbors = adjList.get(v) || []
      for (const w of neighbors) {
        if (!indices.has(w)) {
          strongconnect(w)
          lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!))
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!))
        }
      }

      if (lowlink.get(v) === indices.get(v)) {
        const scc: string[] = []
        let w: string
        do {
          w = stack.pop()!
          onStack.delete(w)
          scc.push(w)
        } while (w !== v)

        if (scc.length > 1) {
          cycles.push(scc)
        }
      }
    }

    for (const v of nodes) {
      if (!indices.has(v)) {
        strongconnect(v)
      }
    }

    return cycles
  }

  /**
   * Real-time service coupling metrics (Instability / Abstractness)
   */
  public calculateServiceCoupling(
    topology: CrossLanguageIntelligence.ServiceTopology,
  ): Record<string, { instability: number; abstractness: number; distance: number }> {
    const metrics: Record<string, { instability: number; abstractness: number; distance: number }> = {}

    for (const service of topology.services) {
      // Afferent coupling (Ca): number of other services that depend on this service
      let afferent = 0
      // Efferent coupling (Ce): number of other services this service depends on
      let efferent = service.dependencies.length

      for (const other of topology.services) {
        if (other.id !== service.id && other.dependencies.includes(service.id)) {
          afferent++
        }
      }

      // Instability I = Ce / (Ca + Ce)
      const instability = afferent + efferent === 0 ? 0 : efferent / (afferent + efferent)

      // Calculate abstractness (number of abstract entities / total entities)
      // Since we don't strictly have 'abstract classes' easily quantified per service here,
      // we use interfaces/endpoints ratio as a proxy for API abstractness
      const abstractness =
        service.endpoints.length > 0
          ? Math.min(1, service.endpoints.length / (service.endpoints.length + service.dependencies.length + 1))
          : 0

      // Distance from the Main Sequence D = |A + I - 1|
      const distance = Math.abs(abstractness + instability - 1)

      metrics[service.id] = { instability, abstractness, distance }
    }

    return metrics
  }

  /**
   * API contract drift detection
   */
  public detectContractDrift(
    topology: CrossLanguageIntelligence.ServiceTopology,
    relationships: CrossLanguageIntelligence.CrossLanguageRelationship[],
    symbols: CrossLanguageIntelligence.CrossLanguageSymbol[]
  ): { driftDetected: boolean; drifts: string[], breakingChanges: string[] } {
    
    // GOD-MODE CONTRACT VALIDATOR
    const contracts = APIContractValidator.extractContracts(topology, relationships, symbols);
    const report = APIContractValidator.validateContracts(contracts.endpoints, contracts.callers);
    
    const breakingChanges = report.breakingChanges.map(b => 
      `[${b.severity.toUpperCase()}] ${b.type} in ${b.callerInfo.file} calling ${b.endpointInfo.file}: ${b.description}`
    );
    
    const drifts = report.drifts.map(d => 
      `[DRIFT] ${d.type} in ${d.callerInfo.file}: ${d.description}`
    );

    return { 
      driftDetected: drifts.length > 0 || breakingChanges.length > 0, 
      drifts,
      breakingChanges
    };
  }

  /**
   * Performance bottleneck prediction
   */
  public predictPerformanceBottlenecks(
    topology: CrossLanguageIntelligence.ServiceTopology,
    dataFlows: CrossLanguageIntelligence.DataFlowAnalysis,
  ): string[] {
    const bottlenecks: string[] = []

    // Check communication paths for high latency overhead
    for (const comm of topology.communicationPaths) {
      if (comm.performance.overhead === "high" || comm.performance.latency === "high") {
        bottlenecks.push(
          `High latency/overhead in path between ${comm.sourceServices.join(",")} and ${comm.targetServices.join(",")}`,
        )
      }
    }

    // Identify hub services (services with very high afferent coupling)
    for (const service of topology.services) {
      const incomingConnections = topology.communicationPaths.filter((p) =>
        p.targetServices.includes(service.id),
      ).length
      if (incomingConnections > 5) {
        bottlenecks.push(
          `Service Hub Bottleneck: ${service.name} is a target for ${incomingConnections} communication paths`,
        )
      }
    }

    return bottlenecks
  }

  /**
   * Security vulnerability surface area
   */
  public calculateSecuritySurfaceArea(
    securityAnalysis: CrossLanguageIntelligence.CrossLanguageSecurityAnalysis,
    topology: CrossLanguageIntelligence.ServiceTopology,
  ): number {
    let score = 100

    // Deduct for threats based on severity
    for (const threat of securityAnalysis.threats) {
      if (threat.severity === "critical") score -= 20
      else if (threat.severity === "high") score -= 10
      else if (threat.severity === "medium") score -= 5
      else score -= 2
    }

    // Deduct for unsecured external endpoints
    for (const service of topology.services) {
      const isPublic = service.type === "gateway" || service.type === "web_service"
      if (isPublic) {
        for (const endpoint of service.endpoints) {
          if (!endpoint.security || endpoint.security.length === 0) {
            score -= 15 // Severe penalty for unsecured public endpoints
          }
        }
      }
    }

    return Math.max(0, score)
  }
}
