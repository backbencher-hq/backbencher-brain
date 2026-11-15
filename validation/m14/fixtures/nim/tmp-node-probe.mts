/**
 * NIM — WHY THE `references` GUARD IS A SHAPE TEST, DEMONSTRATED (this session's scratch probe).
 *
 * The analyzer suppresses a `references` edge to `Self` only when the reference sits inside a
 * `concept_declaration` — the shape the grammar gives the construct
 * (`grammars/tree-sitter-nim/grammar.js:763`, whose `body` field holds the concept's signatures).
 * A name list would have been simpler and WRONG, because `Self` is also an ordinary identifier a
 * file may declare: `nim/tests/views/tviews1.nim:133`
 * `func init(Self: typedesc[Test], tokens: openArray[string]): Self = Self(tokens: tokens)`
 * declares a PARAMETER called `Self` and refers to it as the return type.
 *
 * This probe demonstrates the distinction behaviourally, through production `parseFile` — the
 * same entry point the lane ships — because that is the level the claim is about. A raw
 * tree-sitter walk would answer a question about the grammar rather than about the lane, and the
 * engine stages its grammar wasm inside a per-process temp dir, so a standalone walker cannot
 * even load it (an earlier version of this file tried and printed `wasm missing`; the attempt is
 * recorded here rather than deleted, because a probe that cannot run is a reading nobody took).
 *
 * Usage: npx tsx validation/m14/fixtures/nim/tmp-node-probe.mts
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CASES: [string, string, string][] = [
  ["nim/tests/concepts/conceptsv2_helper.nim", "Self", "`Self` INSIDE `ShadowConcept* = concept` -> suppressed"],
  ["nimony/lib/std/hashes.nim", "Self", "`Self` INSIDE `Hashable* = concept`      -> suppressed"],
  ["nim/tests/views/tviews1.nim", "Self", "`Self` is a DECLARED typedesc PARAMETER  -> KEPT"],
]
let bad = 0
for (const [rel, target, why] of CASES) {
  const file = `${CR}/${rel}`
  const repoRoot = `${CR}/${rel.split("/")[0]}`
  let r: any
  try { r = await parseFile(file, repoRoot, { projectRoot: repoRoot } as any) } catch (e: any) {
    console.log(`${rel}: PARSE FAILED ${e?.message ?? e}`)
    bad++
    continue
  }
  const n = ((r?.relationships ?? []) as any[]).filter(
    (x) => String(x?.type ?? "") === "references" && String(x?.target ?? "") === target,
  ).length
  console.log(`${rel.padEnd(46)} references -> ${target}: ${n}   ${why}`)
  if (why.includes("suppressed") && n !== 0) bad++
  if (why.includes("KEPT") && n === 0) bad++
}
console.log(bad === 0 ? "OK — shape test discriminates as documented" : `MISMATCH in ${bad} case(s)`)
process.exit(bad === 0 ? 0 : 1)
