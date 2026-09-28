import { statSync } from "node:fs"

export type ValidationLayer =
  | "source_discovery"
  | "parser_wasm"
  | "ast_extraction"
  | "persistence"
  | "relationships"
  | "intelligence"
  | "interface"
  | "lifecycle"

export interface ValidationFact {
  id: string
  layer: ValidationLayer
  kind: string
  file?: string
  line?: number
  sourceId?: string
  targetId?: string
  attributes?: Record<string, string | number | boolean | null>
  expectedState?: "resolved" | "unknown" | "unsupported"
  evidence: {
    authority: "source" | "compiler" | "language_service" | "ide_index" | "manual_audit"
    reference: string
  }
}

export interface ObservedFact {
  id: string
  layer: ValidationLayer
  kind: string
  file?: string
  line?: number
  sourceId?: string
  targetId?: string
  attributes?: Record<string, string | number | boolean | null>
  state: "resolved" | "inferred" | "unknown" | "unsupported"
}

export interface DifferentialMetrics {
  expected: number
  observedResolved: number
  truePositive: number
  falsePositive: number
  falseNegative: number
  unknown: number
  unsupported: number
  correctlyClassifiedUnknown: number
  correctlyClassifiedUnsupported: number
  precision: number | null
  recall: number | null
  falsePositiveRate: number | null
  falseNegativeRate: number | null
  unknownRate: number | null
}

export interface DifferentialResult {
  schemaVersion: 1
  passed: boolean
  metrics: DifferentialMetrics
  earliestFailingLayer: ValidationLayer | null
  truePositiveIds: string[]
  falsePositiveIds: string[]
  falseNegativeIds: string[]
  unknownIds: string[]
  unsupportedIds: string[]
  minimizedFailure: {
    expected: ValidationFact[]
    observed: ObservedFact[]
  } | null
}

export interface OperationMeasurement {
  name: string
  wallTimeMs: number
  userCpuMs: number
  systemCpuMs: number
  peakRssBytes: number
  rssDeltaBytes: number
  databaseBytes: number | null
  files: number | null
  symbols: number | null
  relationships: number | null
  filesPerSecond: number | null
  symbolsPerSecond: number | null
  relationshipsPerSecond: number | null
}

const LAYER_ORDER: ValidationLayer[] = [
  "source_discovery",
  "parser_wasm",
  "ast_extraction",
  "persistence",
  "relationships",
  "intelligence",
  "interface",
  "lifecycle",
]

function stableAttributes(attributes: Record<string, string | number | boolean | null> | undefined): string {
  if (!attributes) return ""
  return Object.keys(attributes).sort().map((key) => `${key}=${JSON.stringify(attributes[key])}`).join("|")
}

/** The comparison key deliberately excludes evidence and observed confidence state. */
export function factKey(fact: ValidationFact | ObservedFact): string {
  return [fact.layer, fact.kind, fact.file ?? "", fact.line ?? "", fact.sourceId ?? "", fact.targetId ?? "", stableAttributes(fact.attributes)].join("\u001f")
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

export function compareFacts(expected: ValidationFact[], observed: ObservedFact[]): DifferentialResult {
  const expectedKeys = expected.map(factKey)
  const observedKeys = observed.map(factKey)
  if (new Set(expectedKeys).size !== expectedKeys.length) throw new Error("expected facts contain duplicate comparison keys")
  if (new Set(observedKeys).size !== observedKeys.length) throw new Error("observed facts contain duplicate comparison keys")

  const resolvableExpected = expected.filter((fact) => (fact.expectedState ?? "resolved") === "resolved")
  const unknownExpected = expected.filter((fact) => fact.expectedState === "unknown")
  const unsupportedExpected = expected.filter((fact) => fact.expectedState === "unsupported")
  const expectedByKey = new Map(resolvableExpected.map((fact) => [factKey(fact), fact]))
  const nonResolvedExpectedKeys = new Set([...unknownExpected, ...unsupportedExpected].map(factKey))
  const resolved = observed.filter((fact) => fact.state === "resolved" || fact.state === "inferred")
  const resolvedByKey = new Map(resolved.map((fact) => [factKey(fact), fact]))
  const unknown = observed.filter((fact) => fact.state === "unknown")
  const unsupported = observed.filter((fact) => fact.state === "unsupported")

  const truePositives = resolved.filter((fact) => expectedByKey.has(factKey(fact)))
  const falsePositives = resolved.filter((fact) => !expectedByKey.has(factKey(fact)) || nonResolvedExpectedKeys.has(factKey(fact)))
  const falseNegatives = resolvableExpected.filter((fact) => !resolvedByKey.has(factKey(fact)))
  const correctlyClassifiedUnknown = unknownExpected.filter((fact) => unknown.some((item) => factKey(item) === factKey(fact)))
  const correctlyClassifiedUnsupported = unsupportedExpected.filter((fact) => unsupported.some((item) => factKey(item) === factKey(fact)))
  const missingClassifications = [
    ...unknownExpected.filter((fact) => !unknown.some((item) => factKey(item) === factKey(fact))),
    ...unsupportedExpected.filter((fact) => !unsupported.some((item) => factKey(item) === factKey(fact))),
  ]

  const failingLayers = [...falsePositives.map((fact) => fact.layer), ...falseNegatives.map((fact) => fact.layer), ...missingClassifications.map((fact) => fact.layer)]
  const earliestFailingLayer = LAYER_ORDER.find((layer) => failingLayers.includes(layer)) ?? null
  const firstExpectedFailure = earliestFailingLayer
    ? [...falseNegatives, ...missingClassifications].find((fact) => fact.layer === earliestFailingLayer)
    : undefined
  const firstObservedFailure = earliestFailingLayer
    ? falsePositives.find((fact) => fact.layer === earliestFailingLayer)
    : undefined

  const tp = truePositives.length
  const fp = falsePositives.length
  const fn = falseNegatives.length
  const unknownCount = unknown.length
  const unsupportedCount = unsupported.length
  const expectedCount = expected.length
  const classificationFailures = missingClassifications.length

  return {
    schemaVersion: 1,
    passed: fp === 0 && fn === 0 && classificationFailures === 0,
    metrics: {
      expected: expectedCount,
      observedResolved: resolved.length,
      truePositive: tp,
      falsePositive: fp,
      falseNegative: fn,
      unknown: unknownCount,
      unsupported: unsupportedCount,
      correctlyClassifiedUnknown: correctlyClassifiedUnknown.length,
      correctlyClassifiedUnsupported: correctlyClassifiedUnsupported.length,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
      falsePositiveRate: ratio(fp, tp + fp),
      falseNegativeRate: ratio(fn, tp + fn),
      unknownRate: ratio(unknownCount + unsupportedCount, expectedCount),
    },
    earliestFailingLayer,
    truePositiveIds: truePositives.map((fact) => fact.id).sort(),
    falsePositiveIds: falsePositives.map((fact) => fact.id).sort(),
    falseNegativeIds: falseNegatives.map((fact) => fact.id).sort(),
    unknownIds: unknown.map((fact) => fact.id).sort(),
    unsupportedIds: unsupported.map((fact) => fact.id).sort(),
    minimizedFailure: earliestFailingLayer
      ? {
          expected: firstExpectedFailure ? [firstExpectedFailure] : [],
          observed: firstObservedFailure ? [firstObservedFailure] : [],
        }
      : null,
  }
}

function throughput(count: number | null | undefined, wallTimeMs: number): number | null {
  if (count === null || count === undefined || wallTimeMs <= 0) return null
  return count / (wallTimeMs / 1000)
}

export async function measureOperation<T>(
  name: string,
  operation: () => Promise<T> | T,
  counts: { files?: number; symbols?: number; relationships?: number; databasePath?: string } = {},
): Promise<{ value: T; measurement: OperationMeasurement }> {
  const memoryBefore = process.memoryUsage().rss
  const usageBefore = process.resourceUsage()
  const started = process.hrtime.bigint()
  const value = await operation()
  const wallTimeMs = Number(process.hrtime.bigint() - started) / 1e6
  const usageAfter = process.resourceUsage()
  const memoryAfter = process.memoryUsage().rss
  const databaseBytes = counts.databasePath
    ? statSync(counts.databasePath, { throwIfNoEntry: false })?.size ?? null
    : null
  const files = counts.files ?? null
  const symbols = counts.symbols ?? null
  const relationships = counts.relationships ?? null

  return {
    value,
    measurement: {
      name,
      wallTimeMs,
      userCpuMs: (usageAfter.userCPUTime - usageBefore.userCPUTime) / 1000,
      systemCpuMs: (usageAfter.systemCPUTime - usageBefore.systemCPUTime) / 1000,
      peakRssBytes: usageAfter.maxRSS * 1024,
      rssDeltaBytes: memoryAfter - memoryBefore,
      databaseBytes,
      files,
      symbols,
      relationships,
      filesPerSecond: throughput(files, wallTimeMs),
      symbolsPerSecond: throughput(symbols, wallTimeMs),
      relationshipsPerSecond: throughput(relationships, wallTimeMs),
    },
  }
}
