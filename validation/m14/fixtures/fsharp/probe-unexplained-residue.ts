#!/usr/bin/env npx tsx
/**
 * NAME THE RESIDUE — which analyzer edge does the oracle's truth fail to explain after step 2?
 *
 * Step 2 moved `unexplained` 69 -> 70 while MISSING returned to exactly 10. The +1 is the finding
 * the staged plan was built to expose: the analyzer's rule and the oracle's rule disagree somewhere,
 * and the candidate is file-wide `localNames` (the analyzer) versus a body-scoped local set (the
 * oracle). This probe applies the differential's OWN unexplained predicate — including its
 * containment arm — to the analyzer's own output on the harness's own sample, and prints the edges
 * that survive it, tagged by whether they carry the new `localBinding` claim.
 *
 *   unexplained  truth.some(te => te.label === r.label && (normTarget(te.target) === normTarget(r.target)
 *                                                           || te.target.includes(normTarget(r.target))))
 *
 * Run: npx tsx validation/m14/fixtures/fsharp/probe-unexplained-residue.ts <run-log>
 */

import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { RealFsharpAnalyzer } from "../../../../src/ast/real-fsharp-analyzer"
import { normTarget } from "../../../../script/m14/differential"
import { deriveFsharpEdges } from "../../../../script/m14/fsharp-truth-oracle"

const CR = "/home/ishaq2321/bb_tests/repositories"
const LANE_REPO = path.join(CR, "fsharp")
const EXPECTED_HASH = "2143f8bdc90fe3f1"
const LOG = process.argv[2] ?? "validation/m14/fixtures/fsharp/measurements/differential-step2.txt"

const log = readFileSync(LOG, "utf8")
if (!(log.split("\n").find((l) => l.includes("hash=")) ?? "").includes(EXPECTED_HASH)) {
  console.error(`REFUSING: log does not carry hash=${EXPECTED_HASH}`)
  process.exit(1)
}
const files = (log.match(/\[file\] .*/g) ?? []).map((l) => l.slice("[file]".length).trim())
if (!files.length) {
  console.error("REFUSING: no [file] lines — run the harness with BB_F5_SHOW_FILES=1")
  process.exit(1)
}

interface Rel { label: string; target: string; from: string; localBinding: boolean; file: string }
const rels: Rel[] = []
const truth: { label: string; target: string; from: string }[] = []
for (const rel of files) {
  const abs = path.join(LANE_REPO, rel)
  let content: string
  try { content = readFileSync(abs, "utf8") } catch { continue }
  let tree: any
  let result: any
  try {
    tree = await ASTEngine.parseTree(abs, content)
    result = await ASTEngine.parseFile(abs, content)
  } catch { continue }
  for (const e of deriveFsharpEdges(tree.tree.rootNode, (result as any)?.symbols ?? [])) truth.push({ label: e.label, target: e.target, from: e.from })
  const a: any = new RealFsharpAnalyzer().analyze(tree.tree.rootNode, content, abs)
  tree.tree.delete?.()
  for (const r of a?.relationships ?? []) {
    rels.push({
      label: String(r.type ?? ""),
      target: String(r.target ?? ""),
      from: String(r.source ?? ""),
      localBinding: (r as any)?.metadata?.localBinding === true,
      file: rel,
    })
  }
}

const explained = (r: Rel): boolean =>
  truth.some(
    (te) =>
      te.label === r.label &&
      (normTarget(te.target) === normTarget(r.target) || te.target.includes(normTarget(r.target))),
  )

const unexplained = rels.filter((r) => !explained(r))
const lb = unexplained.filter((r) => r.localBinding)
const truthSep = truth.filter((t) => t.target.includes("#"))

console.log("=".repeat(84))
console.log("NAME THE RESIDUE — analyzer edges the oracle's truth does not explain")
console.log("=".repeat(84))
console.log(`sample: ${files.length} files   hash ${EXPECTED_HASH}`)
console.log(`analyzer edges (direct analyze()): ${rels.length}`)
console.log(`oracle truth edges: ${truth.length}   of which carry '#': ${truthSep.length}`)
console.log(`UNEXPLAINED (differential's predicate, containment arm included): ${unexplained.length}`)
console.log(`  of those carrying metadata.localBinding: ${lb.length}`)
console.log("")
const byKey = new Map<string, number>()
for (const r of unexplained) {
  const k = `${r.label}|${r.target}|${r.localBinding ? "localBinding" : "-"}`
  byKey.set(k, (byKey.get(k) ?? 0) + 1)
}
console.log("unexplained, by (label, target, binding-claim):")
for (const [k, v] of [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log("")
console.log("the new-claim edges the truth does NOT explain (the scope-vs-file-wide candidates):")
for (const r of lb.slice(0, 20)) console.log(`  ${r.label} ${r.from} -> ${r.target}   [${r.file}]`)
if (!lb.length) console.log("  (none — the residue is not in the new class)")
process.exit(0)
