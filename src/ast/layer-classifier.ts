import { BrainDatabase } from "../brain/database"
import type { ProjectID } from "../project/schema"
import * as Log from "../tool/brain-log"
import { BrainSymbolTable, BrainFileTable, BrainRelationshipTable } from "../brain/brain.sql"
import { eq, and, like, count } from "drizzle-orm"

const log = Log.create({ service: "layer-classifier" })

/**
 * 🏗️ Automatic Layer Classification System
 * Distinguishes UI vs Business vs Data layers automatically
 * Uses file path patterns, imports, and function signatures
 */

export enum CodeLayer {
  UI = "ui",                    // React components, Vue templates
  CONTROLLER = "controller",    // API handlers, routes
  SERVICE = "service",          // Business logic
  REPOSITORY = "repository",    // Data access
  MODEL = "model",              // Entities, DTOs
  UTILITY = "utility",          // Helpers, utils
  CONFIG = "config",            // Configuration files
  TEST = "test",                // Test files
  UNKNOWN = "unknown",
}

// Layer classification rules by pattern
const LAYER_PATTERNS: Record<CodeLayer, RegExp[]> = {
  [CodeLayer.UI]: [
    /\/components\//i,
    /\/pages\//i,
    /\/views\//i,
    /\.tsx$/i, // React components often .tsx
    /\.vue$/i,
    /\.svelte$/i,
    /Component/i,
  ],
  [CodeLayer.CONTROLLER]: [
    /\/controllers?\//i,
    /\/routes?\//i,
    /\/handlers?\//i,
    /\/api\//i,
    /controller/i,
    /handler/i,
    /router/i,
    /middleware/i,
  ],
  [CodeLayer.SERVICE]: [
    /\/services?\//i,
    /\/business\//i,
    /\/domain\//i,
    /Service/i,
    /Manager/i,
    /Worker/i,
  ],
  [CodeLayer.REPOSITORY]: [
    /\/repositories?\//i,
    /\/dao\//i,
    /\/data\//i,
    /Repository/i,
    /DataAccess/i,
    /Store/i,
  ],
  [CodeLayer.MODEL]: [
    /\/models?\//i,
    /\/entities\//i,
    /\/dto\//i,
    /\/types\//i,
    /model/i,
    /entity/i,
    /interface/i,
  ],
  [CodeLayer.UTILITY]: [
    /\/utils?\//i,
    /\/helpers?\//i,
    /\/lib\//i,
    /\/common\//i,
    /util/i,
    /helper/i,
  ],
  [CodeLayer.CONFIG]: [
    /\/config\//i,
    /\.config\./i,
    /\.env/i,
    /config/i,
    /settings/i,
  ],
  [CodeLayer.TEST]: [
    /\/test/i,
    /\.test\./i,
    /\.spec\./i,
    /__tests__/i,
  ],
  [CodeLayer.UNKNOWN]: [],
}

// Import-based layer indicators
const LAYER_IMPORTS: Record<CodeLayer, string[]> = {
  [CodeLayer.UI]: ["react", "vue", "angular", "svelte", "@vue", "@angular"],
  [CodeLayer.CONTROLLER]: ["express", "fastify", "koa", "@nestjs/core", "flask", "django"],
  [CodeLayer.SERVICE]: [],
  [CodeLayer.REPOSITORY]: ["prisma", "sequelize", "typeorm", "mongoose", "@prisma/client"],
  [CodeLayer.MODEL]: [],
  [CodeLayer.UTILITY]: ["lodash", "ramda", "underscore", "moment", "dayjs"],
  [CodeLayer.CONFIG]: ["dotenv", "config", "convict"],
  [CodeLayer.TEST]: ["jest", "mocha", "chai", "vitest", "@testing-library"],
  [CodeLayer.UNKNOWN]: [],
}

/**
 * Classify a file's layer based on path and imports
 */
export async function classifyFileLayer(
  filePath: string,
  imports?: string[]
): Promise<CodeLayer> {
  const normalizedPath = filePath.toLowerCase()
  
  // Check patterns first
  for (const [layer, patterns] of Object.entries(LAYER_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedPath)) {
        return layer as CodeLayer
      }
    }
  }
  
  // Check imports if available
  if (imports && imports.length > 0) {
    const importCounts: Record<CodeLayer, number> = {
      [CodeLayer.UI]: 0,
      [CodeLayer.CONTROLLER]: 0,
      [CodeLayer.SERVICE]: 0,
      [CodeLayer.REPOSITORY]: 0,
      [CodeLayer.MODEL]: 0,
      [CodeLayer.UTILITY]: 0,
      [CodeLayer.CONFIG]: 0,
      [CodeLayer.TEST]: 0,
      [CodeLayer.UNKNOWN]: 0,
    }
    
    for (const imp of imports) {
      const lowerImp = imp.toLowerCase()
      for (const [layer, indicators] of Object.entries(LAYER_IMPORTS)) {
        for (const indicator of indicators) {
          if (lowerImp.includes(indicator.toLowerCase())) {
            importCounts[layer as CodeLayer]++
          }
        }
      }
    }
    
    // Find layer with most imports
    let maxLayer = CodeLayer.UNKNOWN
    let maxCount = 0
    for (const [layer, count] of Object.entries(importCounts)) {
      if (count > maxCount) {
        maxCount = count
        maxLayer = layer as CodeLayer
      }
    }
    
    if (maxCount > 0) {
      return maxLayer
    }
  }
  
  return CodeLayer.UNKNOWN
}

/**
 * Classify all unclassified symbols in a project
 */
export async function classifyProjectLayers(projectId: ProjectID): Promise<{
  classified: number
  byLayer: Record<CodeLayer, number>
}> {
  const db = await BrainDatabase.getInstance(projectId)
  
  // Get all symbols without a layer
  const symbols = await db
    .select({
      symbol: BrainSymbolTable,
      file: BrainFileTable,
    })
    .from(BrainSymbolTable)
    .innerJoin(
      BrainFileTable,
      and(
        eq(BrainSymbolTable.project_id, BrainFileTable.project_id),
        eq(BrainSymbolTable.file_id, BrainFileTable.id)
      )
    )
    .where(
      and(
        eq(BrainSymbolTable.project_id, projectId),
        eq(BrainFileTable.layer, "core") // Default/unclassified
      )
    )
  
  const byLayer: Record<CodeLayer, number> = {
    [CodeLayer.UI]: 0,
    [CodeLayer.CONTROLLER]: 0,
    [CodeLayer.SERVICE]: 0,
    [CodeLayer.REPOSITORY]: 0,
    [CodeLayer.MODEL]: 0,
    [CodeLayer.UTILITY]: 0,
    [CodeLayer.CONFIG]: 0,
    [CodeLayer.TEST]: 0,
    [CodeLayer.UNKNOWN]: 0,
  }
  
  // Get imports for each file
  const fileImports = new Map<string, string[]>()
  
  // Process in batches
  const BATCH_SIZE = 100
  let classified = 0
  
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE)
    
    for (const row of batch) {
      const imports = fileImports.get(row.file.id) || []
      const layer = await classifyFileLayer(row.file.path, imports)
      
      // Update file layer
      await db
        .update(BrainFileTable)
        .set({ layer })
        .where(eq(BrainFileTable.id, row.file.id))
      
      // Update symbol layer
      await db
        .update(BrainSymbolTable)
        .set({ layer })
        .where(eq(BrainSymbolTable.id, row.symbol.id))
      
      byLayer[layer]++
      classified++
    }
    
    log.debug(`Classified ${classified}/${symbols.length} symbols`)
  }
  
  return { classified, byLayer }
}

/**
 * Detect layer violations
 * Example: UI layer calling DB directly
 */
export async function detectLayerViolations(
  projectId: ProjectID
): Promise<Array<{
  violation: string
  fromLayer: CodeLayer
  toLayer: CodeLayer
  symbol: string
  file: string
  severity: "high" | "medium" | "low"
}>> {
  const db = await BrainDatabase.getInstance(projectId)
  const violations: ReturnType<typeof detectLayerViolations> extends Promise<infer T> ? T : never = []
  
  // Query cross-layer relationships
  const relationships = await db
    .select({
      source: BrainSymbolTable,
      sourceFile: BrainFileTable,
      target: BrainSymbolTable,
      targetFile: BrainFileTable,
    })
    .from(BrainRelationshipTable)
    .innerJoin(
      BrainSymbolTable,
      and(
        eq(BrainRelationshipTable.source_symbol_id, BrainSymbolTable.id),
        eq(BrainSymbolTable.project_id, projectId)
      )
    )
    .innerJoin(
      BrainFileTable,
      eq(BrainSymbolTable.file_id, BrainFileTable.id)
    )
    .innerJoin(
      BrainSymbolTable,
      and(
        eq(BrainRelationshipTable.target_symbol_id, BrainSymbolTable.id),
        eq(BrainSymbolTable.project_id, projectId)
      )
    )
    .innerJoin(
      BrainFileTable,
      eq(BrainSymbolTable.file_id, BrainFileTable.id)
    )
    .where(
      and(
        eq(BrainRelationshipTable.project_id, projectId),
        eq(BrainRelationshipTable.relationship_type, "calls")
      )
    )
  
  for (const rel of relationships) {
    const fromLayer = rel.sourceFile.layer as CodeLayer
    const toLayer = rel.targetFile.layer as CodeLayer
    
    // Check for violations
    if (fromLayer === CodeLayer.UI && toLayer === CodeLayer.REPOSITORY) {
      violations.push({
        violation: "UI should not call Repository directly",
        fromLayer,
        toLayer,
        symbol: rel.source.name,
        file: rel.sourceFile.relative_path,
        severity: "high",
      })
    }
    
    if (fromLayer === CodeLayer.UI && toLayer === CodeLayer.MODEL) {
      violations.push({
        violation: "UI should not access Models directly",
        fromLayer,
        toLayer,
        symbol: rel.source.name,
        file: rel.sourceFile.relative_path,
        severity: "medium",
      })
    }
  }
  
  return violations
}

/**
 * Get layer statistics
 */
export async function getLayerStats(projectId: ProjectID): Promise<{
  total: number
  byLayer: Record<CodeLayer, number>
  violations: number
}> {
  const db = await BrainDatabase.getInstance(projectId)
  
  const counts = await db
    .select({
      layer: BrainFileTable.layer,
      count: count(),
    })
    .from(BrainFileTable)
    .where(eq(BrainFileTable.project_id, projectId))
    .groupBy(BrainFileTable.layer)
  
  const byLayer: Record<CodeLayer, number> = {
    [CodeLayer.UI]: 0,
    [CodeLayer.CONTROLLER]: 0,
    [CodeLayer.SERVICE]: 0,
    [CodeLayer.REPOSITORY]: 0,
    [CodeLayer.MODEL]: 0,
    [CodeLayer.UTILITY]: 0,
    [CodeLayer.CONFIG]: 0,
    [CodeLayer.TEST]: 0,
    [CodeLayer.UNKNOWN]: 0,
  }
  
  for (const row of counts) {
    if (row.layer) {
      byLayer[row.layer as CodeLayer] = Number(row.count)
    }
  }
  
  const total = Object.values(byLayer).reduce((a, b) => a + b, 0)
  const violations = (await detectLayerViolations(projectId)).length
  
  return { total, byLayer, violations }
}
