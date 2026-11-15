/**
 * DOES ANY bash-LANE FILE CONTAIN A REGEX LITERAL?
 *
 * ## Why this file exists
 *
 * The workstream's rule is "NO REGEX. Not one, in the analyzer, in a census script,
 * or in an oracle", and `script/m12/verify-regex-census.ts` is the gate that
 * decides it. That gate reported `totalRegexUsages: 26` across 7 files and FAILED —
 * but **none of the 26 is bash**, and the honest reading of the gate for this lane
 * needs a per-FILE answer the gate does not print.
 *
 * It also cannot be reused directly: `scanAnalyzers(dir)` scans a FIXED list of
 * analyzer filenames, so calling it on a validation probe returns 0 because the
 * file is not on the list, not because the file is clean. A first attempt at this
 * probe made exactly that mistake and then reported `28` regex usages for
 * `real-bash-analyzer.ts` — line numbers that were CSS's, from an unscanned
 * directory. An instrument that answers the wrong question confidently is worse
 * than no instrument, so this one reuses the gate's DETECTOR and supplies its own
 * file list.
 *
 * ## The instrument
 *
 * The gate's detector is a tree-sitter walk for `node.type === "regex"` over the
 * project's own TypeScript grammar. That is the whole definition of a regex
 * literal, decided by a parse tree rather than by a text pattern — which is the
 * point, since a text matcher cannot tell a regex from a division or a path in a
 * docstring. This file uses the same node type against the same parser and reads
 * the source with `content.slice(startIndex, endIndex)`.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-no-regex.mts
 */
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const { getParser } = await import("../../../../src/ast/engine")
const parser = await getParser("typescript")

// DISCOVERED, not listed. The previous version of this file carried a hardcoded
// array, and it was wrong in the way an instrument must never be wrong: it read as
// covering the lane and covered 16 of 21 files. `probe-bash-calls.mts`,
// `probe-bash-exports.mts`, `probe-bash-symbols.mts`, `probe-bash-tree.mts` and
// `probe-bash-tree3.mts` were never in it, so a regex in any of those five would
// have been reported as "0 regex literals across 0 of 16 files" — a green row
// about a population smaller than the lane's. The rule this lane keeps re-learning
// is that an instrument cannot see a class it was not pointed at, and a hand-kept
// list is a class the next file joins silently.
//
// The analyzer is named explicitly because it is not in the fixture directory;
// everything else is read off the filesystem, so a new lane file is covered the
// moment it is written.
const FIXTURE_DIR = path.join(ROOT, "validation/m14/fixtures/bash")
const FILES = [
  path.join(ROOT, "src/ast/real-bash-analyzer.ts"),
  ...readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".mts"))
    .sort()
    .map((f) => path.join(FIXTURE_DIR, f)),
]

let total = 0
let filesWithAny = 0
for (const full of FILES) {
  const rel = path.relative(ROOT, full)
  let content: string
  try {
    content = readFileSync(full, "utf8")
  } catch {
    console.log(`  skip  ${rel} (not present)`)
    continue
  }
  const tree = parser.parse(content)
  const hits: string[] = []
  const visit = (node: any, depth: number): void => {
    if (depth > 60) return
    if (node.type === "regex") {
      hits.push(`line ${node.startPosition.row + 1}: ${content.slice(node.startIndex, node.endIndex)}`)
    }
    for (const c of node.namedChildren ?? []) visit(c, depth + 1)
  }
  visit(tree.rootNode, 0)
  total += hits.length
  if (hits.length > 0) filesWithAny++
  console.log(`  ${String(hits.length).padStart(3)}  ${rel}`)
  for (const h of hits) console.log(`        ${h}`)
}
console.log(`\nbash lane: ${total} regex literals across ${filesWithAny} of ${FILES.length} files`)
console.log(total === 0 ? "PASS — no regex literal in any bash-lane file" : "FAIL — see the rows above")