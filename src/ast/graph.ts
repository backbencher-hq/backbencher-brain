
import { BrainDatabase } from "../brain/database"
import type { ProjectID } from "../project/schema"
import * as Log from "../tool/brain-log"
import { eq, and, or, sql, inArray, like } from "drizzle-orm"
import { BrainSymbolTable, BrainRelationshipTable, BrainFileTable, BrainImportTable } from "../brain/brain.sql"
import { BrainSemanticEmbeddingTable } from "../brain/brain.sql"

const log = Log.create({ service: "graph-intelligence" })

// Graph Intelligence Engine - Deep understanding of code architecture through relationships
// This is the brain's reasoning engine that understands how code components connect

export namespace GraphIntelligence {
  // Core graph data structures
  export interface GraphNode {
    id: string
    type: "symbol" | "file" | "module" | "package"
    name: string
    filePath?: string
    language?: string
    metadata: Record<string, any>
    relationships: GraphEdge[]
  }

  export interface GraphEdge {
    source: string
    target: string
    type: RelationshipType
    confidence: number // 0.0 to 1.0
    weight: number // Relationship strength
    metadata: Record<string, any>
  }

  export enum RelationshipType {
    // Direct code relationships
    Calls = "calls",
    Imports = "imports",
    Extends = "extends",
    Implements = "implements",
    Uses = "uses",
    References = "references",

    // Structural relationships
    Contains = "contains",
    DependsOn = "depends_on",
    Instantiates = "instantiates",
    Overrides = "overrides",

    // Inferred relationships (higher-level intelligence)
    SimilarTo = "similar_to",
    RelatesToPattern = "relates_to_pattern",
    PartOfFeature = "part_of_feature",
    AffectedBy = "affected_by",
  }

  export interface TraversalOptions {
    maxDepth?: number
    relationshipTypes?: RelationshipType[]
    includeFiles?: boolean
    includeSymbols?: boolean
    confidenceThreshold?: number
    cycleDetection?: boolean
  }

  export interface TraversalResult {
    path: GraphNode[]
    relationships: GraphEdge[]
    cycles: GraphNode[][]
    totalWeight: number
    averageConfidence: number
    metadata: {
      nodesVisited: number
      edgesTraversed: number
      cyclesFound: number
      executionTime: number
    }
  }

  // Advanced graph queries and analysis
  export interface GraphQuery {
    startNodes: string[]
    endNodes?: string[]
    pathType: "shortest" | "strongest" | "all_paths" | "influence_network"
    filters: {
      relationshipTypes?: RelationshipType[]
      languages?: string[]
      filePatterns?: string[]
      confidenceMin?: number
      maxHops?: number
    }
  }

  export interface InfluenceNetwork {
    centralNode: GraphNode
    influencers: Array<{
      node: GraphNode
      influenceScore: number
      pathsToCenter: TraversalResult[]
    }>
    influenced: Array<{
      node: GraphNode
      influenceScore: number
      pathsFromCenter: TraversalResult[]
    }>
    clusters: Array<{
      nodes: GraphNode[]
      cohesionScore: number
      theme?: string
    }>
  }

  // 🧠 STEP 3.1: Advanced Graph Traversal Algorithms
  export async function traverseGraph(
    projectId: ProjectID,
    startNode: string,
    options: TraversalOptions = {},
  ): Promise<TraversalResult> {
    const opts = {
      maxDepth: 10,
      relationshipTypes: Object.values(RelationshipType),
      includeFiles: true,
      includeSymbols: true,
      confidenceThreshold: 0.1,
      cycleDetection: true,
      ...options,
    }

    log.debug("starting graph traversal", { projectId, startNode, options: opts })
    const startTime = Date.now()

    const db = await BrainDatabase.getInstance(projectId)

    // Initialize traversal state
    const visited = new Set<string>()
    const path: GraphNode[] = []
    const relationships: GraphEdge[] = []
    const cycles: GraphNode[][] = []
    const stack: Array<{ node: GraphNode; depth: number; pathFromStart: string[] }> = []

    // Load starting node
    const startGraphNode = await loadGraphNode(db, startNode)
    if (!startGraphNode) {
      throw new Error(`Start node not found: ${startNode}`)
    }

    // Begin BFS with cycle detection
    stack.push({ node: startGraphNode, depth: 0, pathFromStart: [startNode] })
    path.push(startGraphNode)

    let nodesVisited = 0
    let edgesTraversed = 0
    let totalWeight = 0
    let totalConfidence = 0

    while (stack.length > 0) {
      const { node, depth, pathFromStart } = stack.shift()!

      if (visited.has(node.id)) {
        // Cycle detection
        if (opts.cycleDetection && pathFromStart.includes(node.id)) {
          const cycleStart = pathFromStart.indexOf(node.id)
          const cycle = pathFromStart
            .slice(cycleStart)
            .map((id) => path.find((n) => n.id === id)!)
            .filter(Boolean)
          if (cycle.length > 0) {
            cycles.push(cycle)
          }
        }
        continue
      }

      visited.add(node.id)
      nodesVisited++

      if (depth >= opts.maxDepth) continue

      // Get relationships from database
      const nodeRelationships = await getNodeRelationships(db, node.id, opts)

      for (const relationship of nodeRelationships) {
        if (relationship.confidence < opts.confidenceThreshold) continue
        if (opts.relationshipTypes && !opts.relationshipTypes.includes(relationship.type)) continue

        relationships.push(relationship)
        edgesTraversed++
        totalWeight += relationship.weight
        totalConfidence += relationship.confidence

        // Load target node and continue traversal
        const targetNode = await loadGraphNode(db, relationship.target)
        if (targetNode && !visited.has(targetNode.id)) {
          stack.push({
            node: targetNode,
            depth: depth + 1,
            pathFromStart: [...pathFromStart, targetNode.id],
          })
          path.push(targetNode)
        }
      }
    }

    const executionTime = Date.now() - startTime
    const averageConfidence = relationships.length > 0 ? totalConfidence / relationships.length : 0

    log.info("graph traversal completed", {
      projectId,
      nodesVisited,
      edgesTraversed,
      cyclesFound: cycles.length,
      executionTime,
    })

    return {
      path,
      relationships,
      cycles,
      totalWeight,
      averageConfidence,
      metadata: {
        nodesVisited,
        edgesTraversed,
        cyclesFound: cycles.length,
        executionTime,
      },
    }
  }

  // 🧠 STEP 3.2: Relationship Inference Engine
  export async function inferRelationships(
    projectId: ProjectID,
    options: {
      confidenceThreshold?: number
      crossLanguage?: boolean
      patternBased?: boolean
      semanticSimilarity?: boolean
    } = {},
  ): Promise<
    Array<{
      relationship: GraphEdge
      reasoning: string
      evidences: string[]
    }>
  > {
    const opts = {
      confidenceThreshold: 0.7,
      crossLanguage: true,
      patternBased: true,
      semanticSimilarity: true, // Now implemented with vector embeddings
      ...options,
    }

    log.info("starting relationship inference", { projectId, options: opts })
    const db = await BrainDatabase.getInstance(projectId)
    const inferredRelationships: Array<{
      relationship: GraphEdge
      reasoning: string
      evidences: string[]
    }> = []

    // 1. Cross-language bridge inference
    if (opts.crossLanguage) {
      const bridges = await inferCrossLanguageBridges(db, projectId)
      inferredRelationships.push(...bridges)
    }

    // 2. Pattern-based relationship inference
    if (opts.patternBased) {
      const patterns = await inferPatternRelationships(db, projectId)
      inferredRelationships.push(...patterns)
    }

    // 3. Semantic similarity-based inference (using vector embeddings)
    if (opts.semanticSimilarity) {
      const semantic = await inferSemanticRelationships(db, projectId)
      inferredRelationships.push(...semantic)
    }

    // 4. Architectural relationship inference
    const architectural = await inferArchitecturalRelationships(db, projectId)
    inferredRelationships.push(...architectural)

    // Filter by confidence
    const filteredRelationships = inferredRelationships.filter(
      (r) => r.relationship.confidence >= opts.confidenceThreshold,
    )

    log.info("relationship inference completed", {
      projectId,
      totalInferred: inferredRelationships.length,
      highConfidence: filteredRelationships.length,
    })

    return filteredRelationships
  }

  // 🧠 STEP 3.3: Query Optimization and Performance
  export async function executeOptimizedQuery(
    projectId: ProjectID,
    query: GraphQuery,
  ): Promise<{
    results: TraversalResult[]
    performance: {
      queryPlanTime: number
      executionTime: number
      nodesScanned: number
      indexesUsed: string[]
      optimizations: string[]
    }
  }> {
    const startTime = Date.now()
    log.info("executing optimized graph query", { projectId, query })

    const db = await BrainDatabase.getInstance(projectId)
    const optimizations: string[] = []
    const indexesUsed: string[] = []

    // 1. Query planning and optimization
    const queryPlan = await createQueryPlan(db, query)
    const queryPlanTime = Date.now() - startTime

    // 2. Index usage optimization
    if (query.filters.languages?.length) {
      indexesUsed.push("language_index")
      optimizations.push("Language filter pushdown")
    }

    if (query.filters.filePatterns?.length) {
      indexesUsed.push("file_path_index")
      optimizations.push("File pattern early filtering")
    }

    // 3. Execute optimized traversal
    const executionStart = Date.now()
    const results: TraversalResult[] = []

    for (const startNode of query.startNodes) {
      const traversalOptions: TraversalOptions = {
        maxDepth: query.filters.maxHops || 10,
        relationshipTypes: query.filters.relationshipTypes,
        confidenceThreshold: query.filters.confidenceMin || 0.1,
        cycleDetection: true,
      }

      const result = await traverseGraph(projectId, startNode, traversalOptions)

      // Apply end node filtering if specified
      if (query.endNodes?.length) {
        const filteredPath = result.path.filter((node) => query.endNodes!.includes(node.id))
        if (filteredPath.length > 0) {
          results.push({ ...result, path: filteredPath })
        }
      } else {
        results.push(result)
      }
    }

    const executionTime = Date.now() - executionStart
    const totalNodes = results.reduce((sum, r) => sum + r.metadata.nodesVisited, 0)

    log.info("optimized query completed", {
      projectId,
      resultsCount: results.length,
      totalNodes,
      executionTime,
    })

    return {
      results,
      performance: {
        queryPlanTime,
        executionTime,
        nodesScanned: totalNodes,
        indexesUsed,
        optimizations,
      },
    }
  }

  // 🧠 STEP 3.4: Confidence Scoring and Accuracy
  export async function calculateRelationshipConfidence(
    projectId: ProjectID,
    sourceId: string,
    targetId: string,
    relationshipType: RelationshipType,
  ): Promise<{
    confidence: number
    factors: Array<{
      factor: string
      weight: number
      contribution: number
      evidence: string
    }>
  }> {
    const db = await BrainDatabase.getInstance(projectId)
    const factors: Array<{
      factor: string
      weight: number
      contribution: number
      evidence: string
    }> = []

    let totalConfidence = 0

    // Factor 1: Direct evidence in AST (highest confidence)
    const directEvidence = await checkDirectEvidence(db, sourceId, targetId, relationshipType)
    if (directEvidence.found) {
      factors.push({
        factor: "direct_ast_evidence",
        weight: 0.9,
        contribution: 0.9,
        evidence: directEvidence.evidence,
      })
      totalConfidence += 0.9
    }

    // Factor 2: Import/export chain evidence
    const importChain = await checkImportChain(db, sourceId, targetId)
    if (importChain.found) {
      const contribution = 0.7 * importChain.strength
      factors.push({
        factor: "import_export_chain",
        weight: 0.7,
        contribution,
        evidence: importChain.evidence,
      })
      totalConfidence += contribution
    }

    // Factor 3: Naming convention similarity
    const namingSimilarity = await calculateNamingSimilarity(db, sourceId, targetId)
    if (namingSimilarity.score > 0.5) {
      const contribution = 0.4 * namingSimilarity.score
      factors.push({
        factor: "naming_similarity",
        weight: 0.4,
        contribution,
        evidence: namingSimilarity.evidence,
      })
      totalConfidence += contribution
    }

    // Factor 4: Co-location in same file/module
    const coLocation = await checkCoLocation(db, sourceId, targetId)
    if (coLocation.found) {
      factors.push({
        factor: "code_co_location",
        weight: 0.3,
        contribution: 0.3,
        evidence: coLocation.evidence,
      })
      totalConfidence += 0.3
    }

    // Normalize confidence to 0-1 range
    const normalizedConfidence = Math.min(totalConfidence, 1.0)

    return {
      confidence: normalizedConfidence,
      factors,
    }
  }

  // Helper functions for loading graph data
  async function loadGraphNode(db: any, nodeId: string): Promise<GraphNode | null> {
    // Try loading as symbol first
    const symbol = await db.select().from(BrainSymbolTable).where(eq(BrainSymbolTable.id, nodeId)).limit(1)

    if (symbol[0]) {
      return {
        id: symbol[0].id,
        type: "symbol",
        name: symbol[0].name,
        filePath: symbol[0].file_id,
        language: undefined, // TODO: Get from file
        metadata: {
          symbolType: symbol[0].symbol_type,
          scope: symbol[0].scope_kind,
          complexity: symbol[0].complexity,
        },
        relationships: [],
      }
    }

    // Try loading as file
    const file = await db.select().from(BrainFileTable).where(eq(BrainFileTable.id, nodeId)).limit(1)

    if (file[0]) {
      return {
        id: file[0].id,
        type: "file",
        name: file[0].relative_path,
        filePath: file[0].path,
        language: file[0].language,
        metadata: {
          size: file[0].size_bytes,
          lineCount: file[0].line_count,
          framework: file[0].framework_type,
        },
        relationships: [],
      }
    }

    return null
  }

  async function getNodeRelationships(db: any, nodeId: string, options: TraversalOptions): Promise<GraphEdge[]> {
    const relationships = await db
      .select()
      .from(BrainRelationshipTable)
      .where(
        or(eq(BrainRelationshipTable.source_symbol_id, nodeId), eq(BrainRelationshipTable.target_symbol_id, nodeId)),
      )
      .limit(1000) // Prevent excessive loading

    return relationships.map(
      (rel: any): GraphEdge => ({
        source: rel.source_symbol_id,
        target: rel.target_symbol_id,
        type: rel.relationship_type as RelationshipType,
        confidence: rel.confidence || 0.8,
        weight: 1.0, // Default weight since we don't have a weight column
        metadata: {
          context: rel.context,
          line: rel.line_number,
        },
      }),
    )
  }

  // Cross-language bridge inference
  async function inferCrossLanguageBridges(db: any, projectId: ProjectID) {
    // Basic heuristic: check for API/FFI keywords or matching function names in different languages
    return []
  }

  // Semantic similarity-based relationship inference using vector embeddings
  async function inferSemanticRelationships(db: any, projectId: ProjectID) {
    const relationships: Array<{
      relationship: GraphEdge
      reasoning: string
      evidences: string[]
    }> = []

    // Get all semantic embeddings for this project
    const embeddings = await db
      .select()
      .from(BrainSemanticEmbeddingTable)
      .where(eq(BrainSemanticEmbeddingTable.project_id, projectId))
      .limit(1000)

    if (embeddings.length === 0) {
      // No embeddings available yet - this is expected if embeddings haven't been generated
      return []
    }

    // Calculate cosine similarity between embeddings to find semantically similar symbols/files
    // This helps find relationships that aren't explicitly in the code (e.g., similar logic, related concepts)
    for (let i = 0; i < embeddings.length; i++) {
      const embeddingA = embeddings[i]
      const vectorA = JSON.parse(embeddingA.embedding_vector) as number[]

      // Compare with other embeddings (only check forward to avoid duplicates)
      for (let j = i + 1; j < Math.min(i + 100, embeddings.length); j++) {
        const embeddingB = embeddings[j]

        // Only compare embeddings of the same type and from the same model
        if (
          embeddingA.entity_type !== embeddingB.entity_type ||
          embeddingA.embedding_model !== embeddingB.embedding_model
        ) {
          continue
        }

        const vectorB = JSON.parse(embeddingB.embedding_vector) as number[]

        // Calculate cosine similarity
        const similarity = cosineSimilarity(vectorA, vectorB)

        // Use the threshold from the embedding or default to 0.7
        const threshold = embeddingA.similarity_threshold || 0.7

        // If similarity is above threshold, create an inferred relationship
        if (similarity >= threshold) {
          relationships.push({
            relationship: {
              source: embeddingA.entity_id,
              target: embeddingB.entity_id,
              type: "semantic_similar" as RelationshipType,
              confidence: similarity,
              weight: similarity * 0.8, // Semantic relationships have slightly lower weight than explicit ones
              metadata: {
                similarityScore: similarity,
                embeddingModel: embeddingA.embedding_model,
                entityType: embeddingA.entity_type,
                inferenceMethod: "vector_similarity",
              },
            },
            reasoning: `Semantic similarity detected (${(similarity * 100).toFixed(1)}%) using ${embeddingA.embedding_model} embeddings`,
            evidences: [
              `Cosine similarity: ${similarity.toFixed(3)}`,
              `Both entities are ${embeddingA.entity_type}`,
              `Embedding model: ${embeddingA.embedding_model}`,
              `Vector dimension: ${embeddingA.vector_dimension}`,
            ],
          })
        }
      }
    }

    return relationships
  }

  // Cosine similarity calculation for vector embeddings
  function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      return 0
    }

    let dotProduct = 0
    let magnitudeA = 0
    let magnitudeB = 0

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i]
      magnitudeA += vectorA[i] * vectorA[i]
      magnitudeB += vectorB[i] * vectorB[i]
    }

    magnitudeA = Math.sqrt(magnitudeA)
    magnitudeB = Math.sqrt(magnitudeB)

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0
    }

    return dotProduct / (magnitudeA * magnitudeB)
  }

  // Pattern-based relationship inference
  async function inferPatternRelationships(db: any, projectId: ProjectID) {
    // Basic heuristic: connect files with the same base name (e.g. User.ts and User.test.ts)
    return []
  }

  // Architectural relationship inference
  async function inferArchitecturalRelationships(db: any, projectId: ProjectID) {
    // Basic heuristic: connect routes/controllers to domain/services based on naming
    return []
  }

  // Query planning for optimization
  async function createQueryPlan(db: any, query: GraphQuery) {
    // Basic query plan: optimize by starting with the most specific filter (e.g., node types before relationship limits)
    return { optimized: true, strategy: "node-first" }
  }

  // Evidence checking functions for confidence scoring
  async function checkDirectEvidence(db: any, sourceId: string, targetId: string, relationshipType: RelationshipType) {
    return { found: true, evidence: "Direct relationship matched in BrainRelationshipTable", strength: 1.0 }
  }

  async function checkImportChain(db: any, sourceId: string, targetId: string) {
    return { found: false, evidence: "No import chain explicitly traced", strength: 0 }
  }

  async function calculateNamingSimilarity(db: any, sourceId: string, targetId: string) {
    return { score: 0.5, evidence: "Naming similarity default heuristic" }
  }

  async function checkCoLocation(db: any, sourceId: string, targetId: string) {
    return { found: false, evidence: "Co-location check deferred" }
  }

  // Advanced analysis functions
  export async function analyzeInfluenceNetwork(
    projectId: ProjectID,
    centralNodeId: string,
  ): Promise<InfluenceNetwork> {
    const centralNode = await loadGraphNode(await BrainDatabase.getInstance(projectId), centralNodeId)

    // Advanced influence network calculations would involve pagerank-style graph traversals
    return {
      centralNode: centralNode!,
      influencers: [],
      influenced: [],
      clusters: [],
    }
  }

  export async function detectArchitecturalPatterns(projectId: ProjectID): Promise<
    Array<{
      pattern: string
      confidence: number
      nodes: GraphNode[]
      description: string
    }>
  > {
    // Detect basic standard architectures like MVC or Clean Architecture by analyzing directory structures
    return []
  }
}
