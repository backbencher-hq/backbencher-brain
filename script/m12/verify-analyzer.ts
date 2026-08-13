// M12 per-analyzer differential verification harness.
//
// Verifies a single analyzer against independent ground truth:
//   1. Parses every fixture under validation/m12/fixtures/<lang>/ with the
//      real analyzer (pool-worker parseFile → ASTEngine).
//   2. Converts observed symbols and relationships into ObservedFact[].
//   3. Compares against validation/m12/ground-truth/<lang>.json
//      (ValidationFact[]) using the M11 differential harness (compareFacts).
//   4. Reports precision/recall/fp/fn/unknown per layer and writes
//      validation/m12/results/<lang>-differential.json.
//
// Usage: bun script/m12/verify-analyzer.ts <lang>
// Example: bun script/m12/verify-analyzer.ts java
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, basename, resolve } from "node:path"
import {
  compareFacts,
  factKey,
  measureOperation,
  type ObservedFact,
  type ValidationFact,
} from "../m11/differential-harness"

function factKeyForObserved(fact: ObservedFact): string {
  return factKey(fact as any)
}
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const lang = process.argv[2]
if (!lang) {
  console.error("usage: bun script/m12/verify-analyzer.ts <lang>")
  process.exit(1)
}

const FIXTURE_DIR = join(ROOT, "validation/m12/fixtures", lang)
const TRUTH_FILE = join(ROOT, "validation/m12/ground-truth", `${lang}.json`)
const OUT_FILE = join(ROOT, "validation/m12/results", `${lang}-differential.json`)

if (!statSync(FIXTURE_DIR, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`no fixture dir: ${FIXTURE_DIR}`)
  process.exit(1)
}
if (!statSync(TRUTH_FILE, { throwIfNoEntry: false })?.isFile()) {
  console.error(`no ground truth: ${TRUTH_FILE}`)
  process.exit(1)
}

const truthDoc = JSON.parse(readFileSync(TRUTH_FILE, "utf8")) as {
  schemaVersion: number
  truthSource: string
  source: string
  facts: ValidationFact[]
}
const expected = truthDoc.facts

function symbolFacts(symbols: any[], fileBase: string): ObservedFact[] {
  const facts: ObservedFact[] = []
  for (const s of symbols) {
    const name = s.name ?? ""
    if (!name) continue
    const line = s.range?.startLine ?? s.startLine ?? 0
    facts.push({
      id: `symbol:${fileBase}:${line}:${s.kind}:${name}`,
      layer: "ast_extraction",
      kind: "symbol",
      file: fileBase,
      line,
      attributes: { name, symbolKind: String(s.kind ?? "") },
      state: "resolved",
    })
  }
  return facts
}

// Relationship identity contract: layer|kind|file|sourceId|targetId|attributes.
// `attributes` carries ONLY the relationship type (plus an optional confidence
// label) so the differential key is stable across producers. Source/target
// values are the raw emitted identity (symbol name or external name); the
// per-analyzer issue is responsible for resolving them to canonical symbols.
function relationshipFacts(relationships: any[], fileBase: string): ObservedFact[] {
  const facts: ObservedFact[] = []
  for (const r of relationships) {
    const type = r.type ?? r.relationshipType ?? ""
    if (!type) continue
    const source = r.source ?? r.sourceId ?? r.fromSymbol ?? r.from ?? ""
    const target = r.target ?? r.targetId ?? r.toSymbol ?? r.to ?? ""
    if (!source || !target) continue
    facts.push({
      id: `rel:${fileBase}:${type}:${source}:${target}`,
      layer: "relationships",
      kind: "relationship",
      file: fileBase,
      sourceId: typeof source === "string" ? source : undefined,
      targetId: typeof target === "string" ? target : undefined,
      attributes: { type },
      state: "resolved",
    })
  }
  return facts
}

async function main() {
  const fixtureFiles = readdirSync(FIXTURE_DIR)
    .filter((f) => !f.startsWith(".") && statSync(join(FIXTURE_DIR, f)).isFile())
    .sort()

  const observed: ObservedFact[] = []
  let errors = 0
  const perFile: Record<string, { symbols: number; relationships: number }> = {}

  const { value: parseResult, measurement } = await measureOperation(
    `verify-analyzer:${lang}`,
    async () => {
      for (const f of fixtureFiles) {
        const abs = resolve(FIXTURE_DIR, f)
        try {
          const p = await parseFile(abs, ROOT)
          const syms = p.symbols ?? []
          const rels = p.relationships ?? []
          perFile[f] = { symbols: syms.length, relationships: rels.length }
          observed.push(...symbolFacts(syms, f), ...relationshipFacts(rels, f))
        } catch (e: any) {
          errors++
          console.error(`ERR ${f}: ${e?.message?.slice(0, 150)}`)
        }
      }
      return observed
    },
  )

  // NOTE (honesty): observed facts are compared as the analyzer emits them.
  // The production indexer resolves relationship *sources* in-file and
  // relationship *targets* by global leaf-name lookup (parallel-indexer.ts
  // storeResults → resolveTargetStmt); it performs NO cross-file override
  // target resolution and no hierarchy walking. The analyzer's per-file
  // override emission (first hierarchy parent when no in-file symbol declares
  // the method) is therefore compared verbatim — any cross-file override
  // limitation is a real, visible FP/FN in the differential, not a
  // post-processed artifact.

  // Dedupe observed facts: overloads and repeated field accesses produce
  // multiple edges with the same identity (file:type:source:target). The
  // differential contract compares identities, so duplicates collapse.
  const deduped = [...new Map(observed.map((fact) => [factKeyForObserved(fact), fact])).values()]
  observed.length = 0
  observed.push(...deduped)

  const result = compareFacts(expected, observed)

  const document = {
    schemaVersion: 1,
    kind: `per_analyzer_differential:${lang}`,
    truthSource: truthDoc.truthSource,
    truthReference: truthDoc.source,
    fixtureDir: `validation/m12/fixtures/${lang}`,
    fixtures: fixtureFiles,
    perFile,
    passing: result,
    intentionalFailure: null,
    measurements: [measurement],
    note: `M12 per-analyzer differential for ${lang}. Precision/recall/fp/fn/unknown computed against independent ground truth. Identity contract: symbol facts keyed by file:line:kind:name; relationship facts keyed by file:type:sourceId:targetId with attributes={type} only (no line, no extra fields) so the comparison measures extraction correctness, not naming noise.`,
  }
  writeFileSync(OUT_FILE, JSON.stringify(document, null, 2) + "\n")

  const m = result.metrics
  console.log(`=== ${lang} (${fixtureFiles.length} fixtures) ===`)
  console.log(`expected=${m.expected} observedResolved=${m.observedResolved} TP=${m.truePositive} FP=${m.falsePositive} FN=${m.falseNegative} unknown=${m.unknown} unsupported=${m.unsupported}`)
  console.log(`precision=${m.precision?.toFixed(3) ?? "n/a"} recall=${m.recall?.toFixed(3) ?? "n/a"} fpRate=${m.falsePositiveRate?.toFixed(3) ?? "n/a"} fnRate=${m.falseNegativeRate?.toFixed(3) ?? "n/a"} unknownRate=${m.unknownRate?.toFixed(3) ?? "n/a"}`)
  console.log(`earliestFailingLayer=${result.earliestFailingLayer ?? "none"} parseErrors=${errors}`)
  if (result.earliestFailingLayer) {
    console.log("--- false negatives ---")
    for (const id of result.falseNegativeIds.slice(0, 15)) console.log(`  FN ${id}`)
    console.log("--- false positives ---")
    for (const id of result.falsePositiveIds.slice(0, 15)) console.log(`  FP ${id}`)
  }
  console.log(`wrote ${OUT_FILE}`)

  if (!result.passed || errors > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(`verify-analyzer ${lang} failed:`, e)
  process.exit(1)
})
