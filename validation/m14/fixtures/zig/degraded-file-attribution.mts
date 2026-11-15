/**
 * Attributes ONE EDGE of the full-population arbiter/census difference.
 *
 * Pass 16 §C: the supervisor's ontology gate, run over the FULL 3,834-file corpus,
 * printed `exports 24,113` where this lane's 8-shard census over the same
 * population printed `24,114`, and agreed to the digit on the other six types.
 * The gate's run degraded exactly one file and its stderr names the file. This
 * probe parses THAT file alone through production `parseFile` and prints what it
 * contributes, which is what makes the difference attributable rather than
 * assumed.
 *
 * The file is named by a default and overridable by argv, so the probe reruns on
 * a corpus where the rotation picked a different file — pass 14 measured that the
 * flagged set rotates per run, and a probe that hard-codes one run's file would
 * read as a claim about the corpus when it is a claim about one run.
 *
 * It asserts nothing. The attribution is a measurement and the numbers it prints
 * are the whole claim.
 */
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REL = "zig/test/cases/compile_errors/bitCast_with_different_sizes_inside_an_expression.zig"
const abs = process.argv[2] ?? `${CR}/${REL}`

const r: any = await parseFile(abs, CR)
const byType: Record<string, number> = {}
for (const x of r.relationships ?? []) {
  const t = String(x.type ?? "")
  byType[t] = (byType[t] ?? 0) + 1
}
console.log("file:", abs)
console.log("fallback:", r.fallback, "symbols:", (r.symbols ?? []).length, "relationships:", (r.relationships ?? []).length)
console.log("byType:", JSON.stringify(byType))
