#!/usr/bin/env bun
/**
 * VBA fixture-population census.
 *
 * WHY THIS EXISTS. This lane has no genuine corpus: the corpus root holds 2 files whose
 * extension the router sends to vba, both LaTeX document classes, and zero VBA sources
 * (measured in script/m14/spec/vba-completeness.json `_corpus_absence_2026_10_29`). So the
 * lane cannot publish a whole-population measurement, and it must not pretend a fixture
 * count is one. What it CAN publish, and this tool does, is a per-type count over the
 * lane's fixture population — measured through the SAME analyzer the product runs, not
 * read off expectation files — so the spec's `_implemented_measured` block carries a
 * measurement with a stated population, and so that when a genuine VBA corpus arrives the
 * sliced arm and the declaration are one command rather than a fresh investigation.
 *
 * THE POPULATION IS THE FIXTURES, AND THE ARTIFACT SAYS SO: `population.kind` is
 * "fixture", the root is validation/m14/fixtures/vba, and every per-type row is the
 * number of emitted edges over those 10 files. It is NOT the gate's admitted population
 * and must never be quoted as one.
 *
 * RUN:    bun script/m14/vba-fixture-census.ts
 * WRITES: validation/m14/measurements/vba-fixture-census.json
 *
 * The parser is the engine's own getParser("vba") — the live registry the product loads —
 * and the analyzer is instantiated exactly as the fixture runner does it. No expectation
 * file is read: the counts are the analyzer's output, so a per-type zero here is a real
 * zero and not an unasserted constraint.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const FIXTURES = resolve(ROOT, "validation/m14/fixtures/vba")
const OUT = resolve(ROOT, "validation/m14/measurements/vba-fixture-census.json")
const EXTENSIONS = [".bas", ".cls", ".frm", ".vba"]

const { getParser } = (await import("../../src/ast/engine")) as any
const analyzerModule: any = await import("../../src/ast/real-vba-analyzer")
const analyzer: any = new analyzerModule.RealVbaAnalyzer()
const parser: any = await getParser("vba")

const files: string[] = readdirSync(FIXTURES)
  .filter((file: string) => EXTENSIONS.some((extension) => file.toLowerCase().endsWith(extension)))
  .sort()

const byType: Record<string, { edges: number; files: number }> = {}
const perFixture: Record<string, Record<string, number>> = {}
let totalEdges = 0
let totalSymbols = 0

for (const file of files) {
  const content = readFileSync(resolve(FIXTURES, file), "utf8")
  const tree = parser.parse(content)
  const result = await analyzer.analyze(tree.rootNode, content, `fixtures/vba/${file}`)
  const counts: Record<string, number> = {}
  for (const relationship of result.relationships ?? []) {
    const type = String(relationship.type)
    counts[type] = (counts[type] ?? 0) + 1
    totalEdges += 1
  }
  for (const [type, count] of Object.entries(counts)) {
    const row = byType[type] ?? { edges: 0, files: 0 }
    row.edges += count
    row.files += 1
    byType[type] = row
  }
  perFixture[file] = counts
  totalSymbols += (result.symbols ?? []).length
}

const artifact = {
  language: "vba",
  instrument: "script/m14/vba-fixture-census.ts",
  measuredAt: new Date().toISOString(),
  population: {
    kind: "fixture",
    root: "validation/m14/fixtures/vba",
    files: files.length,
    extensions: EXTENSIONS,
    note:
      "FIXTURE POPULATION, NOT THE ADMITTED CORPUS POPULATION. The corpus holds zero genuine VBA " +
      "files (see script/m14/spec/vba-completeness.json _corpus_absence_2026_10_29), so this lane " +
      "has no whole-population measurement to publish. These counts are the analyzer's emitted " +
      "edges over the fixture files, through the live parser the product loads; they exist so the " +
      "spec's _implemented_measured rows carry a measurement with a stated population, and they " +
      "must never be quoted as corpus coverage.",
  },
  symbols: totalSymbols,
  relationships: { total: totalEdges, byType },
  perFixture,
}

writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")

console.log(`VBA FIXTURE CENSUS — ${files.length} fixture file(s), ${totalSymbols} symbols, ${totalEdges} relationships`)
console.log(`written: validation/m14/measurements/vba-fixture-census.json`)
console.log()
for (const type of Object.keys(byType).sort()) {
  const row = byType[type]
  console.log(`  ${type.padEnd(12)} edges ${String(row.edges).padStart(4)}   files ${row.files}`)
}
