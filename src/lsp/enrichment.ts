// src/lsp/enrichment.ts — M42.H3 (issue #651): enrichment reads.
//
// The SINGLE owner of enrichment on the LSP surface. Enrichment (role,
// pattern, layerFlow, criticality, frequency, flags) is COMPUTED BY THE
// INDEX at build time (src/brain/brain-relationship-enrichment.ts, the M40
// lane's pass) and stored in brain_relationship.metadata. This module only
// READS and DISPLAYS what the index stored — no inference at read time,
// no invented fields (contract §12.3: enrichment is labeled as enrichment,
// inference origin shown, never at parser-fact tier).
//
// Presence law: an enrichment record is recognized by the `inferredAt`
// marker the enrichment pass always writes. A row without `inferredAt` is
// UN-ENRICHED — absence is declared (null), never fabricated, never
// upgraded. Analyzer-written rows that store only `evidenceClass` in
// metadata are not enrichment records either.
//
// Staleness law: enrichment is computed over the row as it existed at
// `inferredAt`. If the relationship row changed afterwards
// (inferredAt < row.time_updated), the enrichment is STALE — it renders
// labeled stale, never fresh (a stale enrichment presented fresh is a
// caught defect).

export interface Enrichment {
  role?: "producer" | "consumer" | "decorator" | "configurator" | "inheritor" | "implementor"
  pattern?: "factory_consumer" | "observer" | "adapter" | "di_injection" | "override" | "delegate" | "event_handler" | "callback"
  layerFlow?: string
  criticality?: "high" | "medium" | "low"
  frequency?: string
  isTestCode?: boolean
  isGeneratedCode?: boolean
  isFrameworkContract?: boolean
  isDependencyInjection?: boolean
  inferredAt?: number
}

const ENRICHMENT_KEYS = new Set([
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

/**
 * Parse stored relationship metadata into an Enrichment when the record IS
 * an enrichment record (carries the `inferredAt` marker the index pass
 * writes). Null = declared absence — never an empty object, never a guess.
 * Malformed JSON degrades to null (absence, declared).
 */
export function parseEnrichment(metadata: string | null | undefined): Enrichment | null {
  if (typeof metadata !== "string" || metadata.length === 0) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(metadata) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  // The enrichment pass ALWAYS writes inferredAt. No marker = not an
  // enrichment record (analyzer-written metadata: evidenceClass etc.).
  if (typeof parsed["inferredAt"] !== "number") return null
  const out: Enrichment = { inferredAt: parsed["inferredAt"] }
  for (const key of ENRICHMENT_KEYS) {
    if (key === "inferredAt") continue
    const v = parsed[key]
    if (v === undefined || v === null) continue
    if (key === "role" || key === "pattern" || key === "criticality") {
      if (typeof v === "string") (out as Record<string, unknown>)[key] = v
    } else if (key === "layerFlow" || key === "frequency") {
      if (typeof v === "string") (out as Record<string, unknown>)[key] = v
    } else if (typeof v === "boolean") {
      ;(out as Record<string, unknown>)[key] = v
    }
  }
  return out
}

/** Staleness law: enrichment computed before the row last changed is stale. */
export function enrichmentIsStale(enrichment: Enrichment, rowTimeUpdated: number | null): boolean {
  if (typeof enrichment.inferredAt !== "number") return false
  if (typeof rowTimeUpdated !== "number" || rowTimeUpdated <= 0) return false
  return enrichment.inferredAt < rowTimeUpdated
}

/** Human display of the frequency marker ("one_of_3" -> "1 of 3"). */
export function describeFrequency(frequency: string): string {
  const m = /^one_of_(\d+)$/.exec(frequency)
  if (m) {
    const n = Number(m[1])
    return n === 0 ? "no referring rows" : n === 1 ? "1 referring row" : `${n} referring rows`
  }
  return frequency
}

/**
 * Compact, field-labeled display of the enrichment fields present.
 * The output is an annotation string — it names its own fields so it can
 * never be mistaken for a parser-fact tier label (§12.3).
 */
export function describeEnrichment(e: Enrichment): string {
  const parts: string[] = []
  if (e.role) parts.push(`role ${e.role}`)
  if (e.pattern) parts.push(`pattern ${e.pattern}`)
  if (e.layerFlow) parts.push(`layer ${e.layerFlow}`)
  if (e.frequency) parts.push(describeFrequency(e.frequency))
  if (e.criticality) parts.push(`${e.criticality} criticality`)
  const flags: string[] = []
  if (e.isTestCode) flags.push("test code")
  if (e.isGeneratedCode) flags.push("generated")
  if (e.isFrameworkContract) flags.push("framework contract")
  if (e.isDependencyInjection) flags.push("dependency injection")
  if (flags.length > 0) parts.push(flags.join("+"))
  return parts.join(" · ")
}

/** True when the record carries at least one displayable field. Absence is
 *  declared for null AND undefined — a row that was never enriched, or a
 *  caller that omitted the field, must never crash the render path. */
export function hasDisplayableEnrichment(e: Enrichment | null | undefined): boolean {
  if (!e) return false
  return describeEnrichment(e).length > 0
}
