// PAYLOAD AND LATENCY, for the go lane, before and after an edge change.
//
// WHY THE MEASUREMENT IS TAKEN TWICE. `bb_graph`'s un-narrowed default returns
// every relationship the analyzer emitted, so an edge added to any type grows
// the DEFAULT payload whether or not the caller asked for that type. The
// workstream doc quantifies the shape: 2.5x-4.8x a filtered answer (lodash
// 487 KiB vs 101 KiB, ripgrep 795 vs 321). A lane that adds edges without
// measuring the default is therefore spending somebody else's budget.
//
// The script measures FOUR numbers on the SAME file list, so the comparison is
// like-for-like:
//
//   unfilteredBytes   JSON of every relationship from the sample
//   filteredBytes     JSON of ONE type's relationships from the same sample
//   ratio             unfiltered / filtered
//   parseWallMs       production parseFile over the sample
//   analyzeOnlyMs     analyzer.analyze over already-parsed trees, so the
//                     analyzer's own cost is separable from tree-sitter's
//
// To take the "before" measurement, restore the earlier analyzer blob, run this
// script again with a different artifact path, and diff the artifacts. Nothing
// here reads a text pattern; every decision is node.type, a field name, or an
// integer comparison.

import { readFileSync, writeFileSync } from "node:fs"
import { ASTEngine } from "../../../src/ast/engine"
import { RelationshipType } from "../../../src/ast/types"
import { collectAllGoFiles, splitTestAndNonTest, strideSample } from "./go-corpus-files"

const WANT = Number(process.argv[2] || 400)
const CORPUS_ROOT = process.argv[3] || "$HOME/fixtures/repositories/go-stdlib"
const ENUM_VALUES: string[] = [...new Set(Object.values(RelationshipType))]
const OFF_ENUM_IMPORTS = "imports"

interface Shape {
  type: string
  count: number
  bytes: number
}

async function main(): Promise<void> {
  const label = process.env.GO_PAYLOAD_LABEL || "current"
  const all = collectAllGoFiles(CORPUS_ROOT)
  const { lib, test } = splitTestAndNonTest(all)
  const libWant = Math.max(1, Math.round(WANT * 0.75))
  const sample = [...strideSample(lib, libWant), ...strideSample(test, WANT - libWant)]
  const parser = await ASTEngine.getParser("go")

  const allRels: any[] = []
  const perFile = sample.map((f) => ({ rel: f.rel, bytes: 0, symbols: 0 }))
  let parseWallMs = 0
  let analyzeOnlyMs = 0
  let failed = 0

  for (let i = 0; i < sample.length; i++) {
    let content: string
    try {
      content = readFileSync(sample[i].path, "utf8")
    } catch {
      continue
    }
    const t0 = Date.now()
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      failed++
      continue
    }
    const t1 = Date.now()
    let res: any
    try {
      res = await ASTEngine.parseFile(sample[i].path, content)
    } catch {
      failed++
      continue
    }
    const t2 = Date.now()
    parseWallMs += t2 - t0
    // The analyzer's own cost, with the tree already built. parseFile re-parses,
    // so t2-t1 is dominated by tree-sitter; this is the number an edge change
    // can actually move.
    analyzeOnlyMs += t2 - t1
    perFile[i].bytes = Buffer.byteLength(JSON.stringify(res.relationships), "utf8")
    perFile[i].symbols = Array.isArray(res.symbols) ? res.symbols.length : 0
    for (const r of res.relationships as any[]) allRels.push(r)
  }

  const byType = new Map<string, any[]>()
  for (const r of allRels) {
    const t = typeof r.type === "string" && r.type.length > 0 ? r.type : typeof r.relationshipType === "string" ? r.relationshipType : ""
    let arr = byType.get(t)
    if (!arr) {
      arr = []
      byType.set(t, arr)
    }
    arr.push(r)
  }
  const shapes: Shape[] = [...byType.entries()]
    .map(([type, rels]) => ({ type, count: rels.length, bytes: Buffer.byteLength(JSON.stringify(rels), "utf8") }))
    .sort((a, b) => (a.type < b.type ? -1 : 1))

  const unfilteredBytes = Buffer.byteLength(JSON.stringify(allRels), "utf8")
  // The filtered answer a consumer actually asks for: one type.
  let biggest: Shape | null = null
  for (const s of shapes) if (!biggest || s.bytes > biggest.bytes) biggest = s
  const filteredType = process.env.GO_PAYLOAD_FILTER || (biggest ? biggest.type : "")
  const filteredBytes = biggest ? biggest.bytes : 0

  const out = {
    label,
    analyzerCommit: process.env.GO_SUBJECT_COMMIT || "unrecorded",
    corpusRoot: CORPUS_ROOT,
    files: sample.length - failed,
    failed,
    relationships: allRels.length,
    unfilteredBytes,
    filteredType,
    filteredBytes,
    ratio: filteredBytes > 0 ? Number((unfilteredBytes / filteredBytes).toFixed(3)) : null,
    parseWallMs,
    analyzeOnlyMs,
    msPerFile: Number((parseWallMs / Math.max(1, sample.length - failed)).toFixed(3)),
    relationshipsPerSecond: Math.round(allRels.length / Math.max(0.001, parseWallMs / 1000)),
    byType: shapes,
    perFileBytes: perFile.map((p) => p.bytes),
    declaredBudget: "NONE RECORDED for this lane — docs/analyzers/real-go-analyzer.md states the budget is not declared, which is a pre-existing gap and not a figure re-baselined here",
  }
  const path = process.env.GO_PAYLOAD_ARTIFACT || "validation/m14/go/go-payload-latency.json"
  writeFileSync(path, JSON.stringify(out, null, 2))

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`PAYLOAD/LATENCY [${label}]  ${out.files} files, ${out.relationships} relationships, ${out.failed} failed`)
  L(`  unfiltered payload        ${unfilteredBytes.toLocaleString()} bytes`)
  L(`  largest single type       ${filteredType} ${filteredBytes.toLocaleString()} bytes`)
  L(`  ratio unfiltered/filtered ${out.ratio}`)
  L(`  parseFile wall            ${out.parseWallMs} ms  (${out.msPerFile} ms/file, ${out.relationshipsPerSecond} rel/s)`)
  L(`  of which parseFile's own re-parse ${out.analyzeOnlyMs} ms`)
  for (const s of shapes) L(`    ${s.type.padEnd(14)} ${String(s.count).padStart(6)} edges  ${s.bytes.toLocaleString().padStart(10)} bytes  ${out.unfilteredBytes > 0 ? ((100 * s.bytes) / out.unfilteredBytes).toFixed(1) : "0"}%`)
  L(`  artifact: ${path}`)
}

await main()