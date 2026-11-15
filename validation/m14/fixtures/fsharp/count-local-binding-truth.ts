#!/usr/bin/env npx tsx
/**
 * COUNT N — how many truth rows does the oracle's local-binding rule re-spell, on the
 * differential's OWN sample? This closes step 1's assertion `MISSING − 10 == N`.
 *
 * Step 1 changed only the oracle, and the differential reported MISSING 10 → 93 with
 * `unexplained` unchanged at 69 and `analyzer-edges` unchanged at 3,136. The delta is 83. The
 * claim `MISSING − 10 == (truth rows re-spelled)` is only closed if 83 is counted INDEPENDENTLY,
 * from the oracle's own output, rather than read back off the differential's delta.
 *
 * The 60 paths are the ones the harness itself printed under `BB_F5_SHOW_FILES=1`, and this probe
 * refuses to report if the run it reads did not carry the same sample hash the differential
 * reported (`2143f8bdc90fe3f1`), so it cannot silently measure a different draw.
 *
 * Run: npx tsx validation/m14/fixtures/fsharp/count-local-binding-truth.ts <run-log>
 */

import { readFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../../src/ast/engine"
import { deriveFsharpEdges } from "../../../../script/m14/fsharp-truth-oracle"

const CR = "/home/ishaq2321/bb_tests/repositories"
const LANE_REPO = path.join(CR, "fsharp")
const EXPECTED_HASH = "2143f8bdc90fe3f1"
const LOG = process.argv[2] ?? "validation/m14/fixtures/fsharp/measurements/differential-step1-files.txt"

const log = readFileSync(LOG, "utf8")
const hashLine = log.split("\n").find((l) => l.includes("hash=")) ?? ""
if (!hashLine.includes(EXPECTED_HASH)) {
  console.error(`REFUSING: the run log does not carry hash=${EXPECTED_HASH}. It reads: ${hashLine.slice(0, 160)}`)
  process.exit(1)
}
const files = log
  .split("\n")
  .filter((l) => l.includes("[file]"))
  .map((l) => l.slice(l.indexOf("[file]") + "[file]".length).trim())
if (!files.length) {
  console.error("REFUSING: no [file] lines — was the harness run with BB_F5_SHOW_FILES=1?")
  process.exit(1)
}

let truthEdges = 0
let withSep = 0
let filesParsed = 0
const examples: string[] = []
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
  filesParsed++
  const truth = deriveFsharpEdges(tree.tree.rootNode, (result as any)?.symbols ?? [])
  tree.tree.delete?.()
  for (const t of truth) {
    truthEdges++
    if (String(t.target).includes("#")) {
      withSep++
      if (examples.length < 8) examples.push(`${t.label} ${t.from} -> ${t.target}   [${rel}]`)
    }
  }
}

console.log("=".repeat(80))
console.log("COUNT N — truth rows the oracle re-spells as `<callable>#<binding>`")
console.log("=".repeat(80))
console.log(`sample: ${files.length} files listed, ${filesParsed} parsed   (hash ${EXPECTED_HASH} verified in the log)`)
console.log(`oracle truth edges on this sample: ${truthEdges}`)
console.log(`of which carry BINDING_SEP ('#'): ${withSep}   <= N`)
if (examples.length) {
  console.log("examples:")
  for (const e of examples) console.log(`  ${e}`)
}
process.exit(0)
