// @ts-nocheck — pre-existing null union type issues
/**
 * Brain Relationship Enrichment — Reasoning Layer
 *
 * Post-processing pass that enriches raw syntactic relationships with
 * architectural understanding. No schema changes — stores everything
 * in the existing `metadata` JSON column on brain_relationship.
 *
 * Dimensions computed:
 *   role        — producer, consumer, decorator, configurator, inheritor
 *   pattern     — factory_consumer, observer, adapter, di_injection, override, delegate
 *   layerFlow   — ui→service, service→db, same-layer, etc.
 *   criticality — high, medium, low (based on in-degree + gravity)
 *   frequency   — "1_of_N" (this is 1 of N total callers of the target)
 *   isTestCode        — caller or callee is in a test file
 *   isFrameworkContract — extends + overrides (mandatory, not optional)
 *   isGeneratedCode   — file path matches generated code patterns
 *   isDependencyInjection — target is interface, source instantiates
 *
 * Phase 1: SQL-driven (layer, criticality, frequency, test, generated, framework)
 * Phase 2: Pattern inference (factory, observer, adapter, DI, override, delegate)
 */

import type { ProjectID } from "../project/schema"
import { BrainDatabase } from "./database"
// M57.T5 (#793): isTestCode metadata must use the ONE test-file definition.
import { isTestFileCandidate } from "../ast/test-classification"

// ─── Enrichment Types ──────────────────────────────────────────────────────

export interface RelationshipEnrichment {
  role?: "producer" | "consumer" | "decorator" | "configurator" | "inheritor" | "implementor"
  pattern?: "factory_consumer" | "observer" | "adapter" | "di_injection" | "override" | "delegate" | "event_handler" | "callback"
  layerFlow?: string // e.g. "ui→service", "service→db", "same-layer"
  criticality?: "high" | "medium" | "low"
  frequency?: string // e.g. "1_of_3"
  isTestCode?: boolean
  isFrameworkContract?: boolean
  isGeneratedCode?: boolean
  isDependencyInjection?: boolean
  inferredAt?: number // timestamp when enrichment was computed
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export async function enrichRelationships(
  projectId: ProjectID,
  onProgress?: (step: string, pct: number) => void,
  // M40.A2: scoped mode — enrich only relationships whose SOURCE symbol is in
  // the given id set (bounded incremental pass). In-degree counts stay GLOBAL
  // so criticality/frequency of affected targets match full-run values.
  opts: { sourceSymbolIds?: string[] } = {},
): Promise<{
  enriched: number
  patternsFound: number
  durationMs: number
}> {
  const startTime = Date.now()
  const rawDb = await BrainDatabase.getRawInstance(projectId)
  const now = Date.now()

  const report = (step: string, pct: number) => {
    if (onProgress) onProgress(step, pct)
  }

  report("reading", 0)

  // Get total count for progress tracking
  const countRow = rawDb.prepare(`
    SELECT COUNT(*) as c FROM brain_relationship WHERE project_id = ?
  `).get(projectId) as any
  const totalRels = countRow?.c ?? 0

  if (totalRels === 0) {
    report("done", 100)
    return { enriched: 0, patternsFound: 0, durationMs: Date.now() - startTime }
  }

  // Read ALL relationships + joined symbol data in one query.
  // For 467K rows this is ~50MB — fits comfortably in memory.
  // Use streaming/batching: read in chunks, enrich, write back.
  const BATCH = 20000

  // Pre-compute in-degree for criticality + frequency (single pass)
  report("counting", 0)
  const inDegreeMap = new Map<string, number>()
  const inDegreeRows = rawDb.prepare(`
    SELECT target_symbol_id, COUNT(*) as c
    FROM brain_relationship
    WHERE project_id = ? AND target_symbol_id IS NOT NULL AND target_symbol_id != ''
    GROUP BY target_symbol_id
  `).all(projectId) as any[]
  for (const r of inDegreeRows) {
    inDegreeMap.set(r.target_symbol_id, r.c)
  }

  report("enriching", 5)

  // M40.A2: scoped mode (sourceSymbolIds) enriches only relationships whose
  // SOURCE symbol is in the set — bounded by touched-symbol count, not project
  // size. In-degree counts stay GLOBAL (computed above over all rows) so
  // criticality/frequency match what a full run would compute.
  const scopeIds = opts.sourceSymbolIds

  // Shared per-batch processor: full and scoped modes use the identical
  // enrichment logic — only the row selection differs.
  const updateStmt = rawDb.prepare(`
    UPDATE brain_relationship SET metadata = ? WHERE id = ? AND project_id = ?
  `)
  // #865 acceptance item 1: the enrichment must PRESERVE keys it does not own
  // (evidenceClass, phpSpecific, scalaSpecific, syntheticSource, …). The pass
  // used to build a fresh object and write it wholesale, destroying every
  // analyzer-written key on every row it could see — exactly the keys M59's
  // contracts treat as the durable record of the analyzer's evidence. The
  // merge is enrichment-owned-key-wins for the ten dimensions this pass
  // computes (a re-run must refresh its OWN values, including unsetting flags
  // that no longer apply), and analyzer-owned-key-survives for everything
  // else. `inferredAt` is always overwritten: it is the marker that the
  // enrichment READ path (src/lsp/enrichment.ts) uses to recognise an
  // enrichment record, and #865 item 2 requires that a merged row stays an
  // enrichment record rather than resurrecting an analyzer-only row as one.
  const ENRICHMENT_OWNED_KEYS = new Set([
    "role",
    "pattern",
    "layerFlow",
    "criticality",
    "frequency",
    "isTestCode",
    "isGeneratedCode",
    "isFrameworkContract",
    "isDependencyInjection",
    "inferredAt",
  ])
  let rowsWithoutParseableMetadata = 0
  type ComputedEnrichment = {
    layerFlow: string
    criticality: string
    frequency: string
    isTestCode: boolean
    isGeneratedCode: boolean
    isFrameworkContract: boolean
    isDI: boolean
    pattern: RelationshipEnrichment["pattern"]
    role: RelationshipEnrichment["role"]
  }
  const mergeMetadata = (row: any, computed: ComputedEnrichment): any => {
    let existing: Record<string, unknown> = {}
    if (typeof row.metadata === "string" && row.metadata.length > 0) {
      try {
        const parsed = JSON.parse(row.metadata)
        if (parsed !== null && typeof parsed === "object") existing = parsed
        else rowsWithoutParseableMetadata++
      } catch {
        // Unparseable pre-existing metadata cannot be merged without losing
        // either side's shape; count it and let the enrichment overwrite.
        rowsWithoutParseableMetadata++
      }
    }
    const meta: any = { ...existing }
    for (const k of Object.keys(meta)) if (ENRICHMENT_OWNED_KEYS.has(k)) delete meta[k]
    meta.layerFlow = computed.layerFlow
    meta.criticality = computed.criticality
    meta.frequency = computed.frequency
    if (computed.isTestCode) meta.isTestCode = true
    if (computed.isGeneratedCode) meta.isGeneratedCode = true
    if (computed.isFrameworkContract) meta.isFrameworkContract = true
    if (computed.isDI) meta.isDependencyInjection = true
    if (computed.pattern) meta.pattern = computed.pattern
    if (computed.role) meta.role = computed.role
    meta.inferredAt = now
    return meta
  }
  let enriched = 0
  let patternsFound = 0
  const processBatch = (batch: any[]) => {
    if (batch.length === 0) return false
    const tx = rawDb.transaction((rows: any[]) => {
      for (const row of rows) {
        const layerFlow = `${row.source_layer || "core"}→${row.target_layer || "core"}`
        const inDeg = inDegreeMap.get(row.target_symbol_id) ?? 0
        const criticality = inDeg >= 50 ? "high" : inDeg >= 10 ? "medium" : "low"
        const freq = inDegreeMap.get(row.target_symbol_id) ?? 0
        const frequency = `one_of_${freq}`

        const sourceFile = (row.source_file || "")
        const isTestCode = isTestFileCandidate(sourceFile)
        const isGeneratedCode = sourceFile.includes("/generated/") || sourceFile.includes("/build/generated/") ||
          sourceFile.includes(".pb.") || sourceFile.includes(".g.dart") || sourceFile.includes(".g.cs") ||
          sourceFile.includes("/gen/")
        const isFrameworkContract = row.relationship_type === "extends" || row.relationship_type === "overrides" || row.relationship_type === "implements"
        const isDI = row.relationship_type === "instantiates" &&
          (row.target_type === "interface" || row.target_type === "trait" || row.target_type === "protocol" || row.target_type === "abstract")

        const pattern = inferPattern({
          relationship_type: row.relationship_type,
          source_name: row.source_name || "",
          source_type: row.source_type || "",
          target_name: row.target_name || "",
          target_type: row.target_type || "",
          source_file: row.source_file || "",
        })
        const role = inferRole(row.relationship_type, row.source_type || "", row.target_type || "", pattern)

        const meta = mergeMetadata(row, {
          layerFlow,
          criticality,
          frequency,
          isTestCode,
          isGeneratedCode,
          isFrameworkContract,
          isDI,
          pattern,
          role,
        })

        updateStmt.run(JSON.stringify(meta), row.id, projectId)
        if (pattern) patternsFound++
        enriched++
      }
    })

    try { tx(batch) } catch {}
    return true
  }

  if (scopeIds?.length) {
    // Scoped: iterate id-chunks of the touched symbol set. Cost scales with
    // |scopeIds|, never with total relationship count.
    const CHUNK = 500
    for (let i = 0; i < scopeIds.length; i += CHUNK) {
      const chunk = scopeIds.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => "?").join(",")
      const batch = rawDb.prepare(`
      SELECT r.id, r.relationship_type, r.source_symbol_id, r.target_symbol_id, r.metadata,
             s.layer as source_layer, s.symbol_type as source_type, s.name as source_name,
             t.layer as target_layer, t.symbol_type as target_type, t.name as target_name,
             sf.relative_path as source_file
      FROM brain_relationship r
      JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id
      LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id AND t.project_id = r.project_id
      LEFT JOIN brain_file sf ON sf.id = s.file_id
      WHERE r.project_id = ? AND r.source_symbol_id IN (${placeholders})
    `).all(projectId, ...chunk) as any[]
      processBatch(batch)
    }
  } else {
    // Full mode: original offset window over all relationships.
    let offset = 0
    while (true) {
      const batch = rawDb.prepare(`
      SELECT r.id, r.relationship_type, r.source_symbol_id, r.target_symbol_id, r.metadata,
             s.layer as source_layer, s.symbol_type as source_type, s.name as source_name,
             t.layer as target_layer, t.symbol_type as target_type, t.name as target_name,
             sf.relative_path as source_file
      FROM brain_relationship r
      JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id
      LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id AND t.project_id = r.project_id
      LEFT JOIN brain_file sf ON sf.id = s.file_id
      WHERE r.project_id = ?
      LIMIT ${BATCH} OFFSET ${offset}
    `).all(projectId) as any[]
      if (batch.length === 0) break
      processBatch(batch)
      offset += BATCH
      const pct = Math.min(95, 5 + Math.round((offset / totalRels) * 90))
      report("enriching", pct)
    }
  }

  report("done", 100)

  return {
    enriched,
    patternsFound,
    durationMs: Date.now() - startTime,
  }
}

// ─── Pattern Inference (used by enrichRelationships above) ─────────────────

function inferPattern(row: {
  relationship_type: string
  source_name: string
  source_type: string
  target_name: string
  target_type: string
  source_file: string
}): RelationshipEnrichment["pattern"] | null {
  const rt = row.relationship_type
  const sn = (row.source_name || "").toLowerCase()
  const tn = (row.target_name || "").toLowerCase()
  const st = (row.source_type || "").toLowerCase()
  const tt = (row.target_type || "").toLowerCase()

  // Factory consumer: calls a method on a class whose name contains "Factory" or "Builder"
  if (rt === "calls" && (tn.includes("factory") || tn.includes("builder") || tn.includes("create") || tn.includes("build") || tn.includes("new"))) {
    return "factory_consumer"
  }

  // Observer / Event handler: calls a method with "on", "handle", "listen", "notify", "emit", "fire"
  if (rt === "calls" && /^(on|handle|listen|notify|emit|fire|addListener|removeListener|subscribe|unsubscribe)/i.test(tn)) {
    return "observer"
  }

  // Callback: source has "callback" or "handler" in name, or target ends with "Callback"
  if (rt === "calls" && (sn.includes("callback") || sn.includes("handler") || tn.endsWith("callback"))) {
    return "callback"
  }

  // Event handler: source file is an event handler or target is an event type
  if (rt === "calls" && (sn.includes("event") || tn.includes("event"))) {
    return "event_handler"
  }

  // Adapter / Wrapper: target type is interface/trait and source "implements" it, or source name contains "Adapter"/"Wrapper"
  if (rt === "implements" && (tt === "interface" || tt === "trait" || tt === "protocol")) {
    return "adapter"
  }
  if ((sn.includes("adapter") || sn.includes("wrapper") || sn.includes("decorator")) && rt === "calls") {
    return "adapter"
  }

  // DI injection: source instantiates an interface/trait/abstract class
  if (rt === "instantiates" && (tt === "interface" || tt === "trait" || tt === "abstract" || tt === "protocol")) {
    return "di_injection"
  }

  // Override: relationship is "overrides"
  if (rt === "overrides") {
    return "override"
  }

  // Delegate: source delegates to target (calls a method and passes its own name or similar)
  if (rt === "calls" && (sn.includes("delegate") || tn.includes("delegate") || tn.includes("proxy"))) {
    return "delegate"
  }

  // Default: no pattern detected
  return null
}

function inferRole(
  relationshipType: string,
  sourceType: string,
  targetType: string,
  pattern: string | undefined,
): RelationshipEnrichment["role"] | undefined {
  const st = (sourceType || "").toLowerCase()
  const tt = (targetType || "").toLowerCase()

  if (relationshipType === "extends") return "inheritor"
  if (relationshipType === "implements") return "implementor"
  if (relationshipType === "overrides") return "inheritor"
  if (relationshipType === "instantiates") {
    if (tt === "interface" || tt === "trait" || tt === "protocol") return "configurator"
    return "producer"
  }
  if (relationshipType === "calls") {
    if (pattern === "observer" || pattern === "callback" || pattern === "event_handler") return "consumer"
    if (pattern === "adapter") return "decorator"
    if (pattern === "di_injection") return "configurator"
    return "consumer"
  }
  if (relationshipType === "uses" || relationshipType === "references" || relationshipType === "imports") {
    return "consumer"
  }

  return undefined
}

// ─── Query Helpers for Tools ───────────────────────────────────────────────

/**
 * Fetch enriched relationships for a symbol, including all computed dimensions.
 * Used by bb_analyze graph modes and bb_visualize.
 */
export function formatEnrichedRelationship(row: any): string {
  let meta: any = {}
  try { meta = row.rel_metadata ? JSON.parse(row.rel_metadata) : (row.metadata ? JSON.parse(row.metadata) : {}) } catch {}

  const parts: string[] = []

  // Role + Pattern
  if (meta.role || meta.pattern) {
    const labels: string[] = []
    if (meta.role) labels.push(meta.role)
    if (meta.pattern) labels.push(meta.pattern.replace(/_/g, " "))
    parts.push(`[${labels.join(" · ")}]`)
  }

  // Layer flow
  if (meta.layerFlow && meta.layerFlow !== "core→core") {
    parts.push(`(${meta.layerFlow})`)
  }

  // Criticality
  if (meta.criticality === "high") {
    parts.push(`🔴`)
  } else if (meta.criticality === "medium") {
    parts.push(`🟡`)
  }

  // Frequency
  if (meta.frequency && meta.frequency !== "one_of_0") {
    parts.push(`×${meta.frequency.replace("one_of_", "")}`)
  }

  // Flags (compact)
  const flags: string[] = []
  if (meta.isTestCode) flags.push("🧪")
  if (meta.isFrameworkContract) flags.push("📜")
  if (meta.isGeneratedCode) flags.push("🤖")
  if (meta.isDependencyInjection) flags.push("💉")
  if (flags.length > 0) parts.push(flags.join(""))

  return parts.length > 0 ? parts.join(" ") : ""
}

/**
 * Quick enrichment query for a single relationship — used in tool response formatting.
 */
export async function getEnrichedRelationships(
  projectId: ProjectID,
  options: {
    sourceSymbolId?: string
    targetSymbolId?: string
    relationshipType?: string
    maxResults?: number
    includeEnrichment?: boolean
  } = {},
): Promise<any[]> {
  const rawDb = await BrainDatabase.getRawInstance(projectId)

  const conditions: string[] = ["r.project_id = ?"]
  const params: any[] = [projectId]

  if (options.sourceSymbolId) {
    conditions.push("r.source_symbol_id = ?")
    params.push(options.sourceSymbolId)
  }
  if (options.targetSymbolId) {
    conditions.push("r.target_symbol_id = ?")
    params.push(options.targetSymbolId)
  }
  if (options.relationshipType) {
    conditions.push("r.relationship_type = ?")
    params.push(options.relationshipType)
  }

  const limit = options.maxResults || 100
  const where = conditions.join(" AND ")

  return rawDb.prepare(`
    SELECT r.id, r.relationship_type, r.metadata,
           s.name as source_name, s.symbol_type as source_type, s.layer as source_layer,
           t.name as target_name, t.symbol_type as target_type, t.layer as target_layer,
           sf.relative_path as source_file, sf.language as source_language,
           tf.relative_path as target_file, tf.language as target_language,
           r.is_cross_file, r.is_cross_language, r.bridge_mechanism
    FROM brain_relationship r
    JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id
    JOIN brain_file sf ON sf.id = s.file_id
    LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id AND t.project_id = r.project_id
    LEFT JOIN brain_file tf ON tf.id = t.file_id
    WHERE ${where}
    ORDER BY s.name, t.name
    LIMIT ${limit}
  `).all(...params) as any[]
}
