/**
 * AMBIGUITY CENSUS — do the analyzer's RECOVERY PASSES fire on the corpus?
 *
 * ## WHY THIS EXISTS
 *
 * `script/m60/verify-sql-resync.ts` asserts that two recovery passes are reachable:
 *
 *   S1  the full-tree declaration SWEEP fires on at least one real corpus file
 *   S2  it recovers >= 50 declarations across them
 *
 * and both read **0** on its default population (ProxiCall, 438 files). Two
 * readings are possible and they are opposite findings:
 *
 *   (a) the pass is reachable and the gate's POPULATION is wrong, or
 *   (b) the pass is DEAD CODE on this corpus — a branch no corpus file satisfies,
 *       which is the exact defect class this workstream exists on (a `sources`
 *       grep finds the branch; only a walk over real files can fail it).
 *
 * The gate cannot tell them apart because it looks at ONE repository. This walks the
 * whole admitted corpus — the same 1,955 files, the same admission rule and the same
 * production `parseFile` entry point as `ontology-census.mts` — and reports how often
 * each recovery counter moves, so the two readings separate by number.
 *
 * ## WHAT IT REPORTS, per pass
 *
 *   filesWhereNonZero   the pass contributed on this corpus at all (reachability)
 *   declarationsTotal    symbols the pass ADDED that the main walk had not reached
 *   files               the files, so a reader can go and look
 *
 * `resyncDeclarations` and `sweepDeclarationsRecovered` are the analyzer's OWN counters
 * (`RealSqlAnalyzer`'s `metadata.ambiguity`), read through production `parseFile` rather
 * than re-implemented here, so this script cannot disagree with the product by
 * construction.
 *
 * ## RESOLVED, and how (reading (b) was wrong, and why the counter was the problem)
 *
 * Measured over the whole admitted corpus, reading (b) — dead code — is FALSIFIED. The sweep
 * carries **3,629 edges and 1,663 symbols** over 234 of the admitted files, by ablation
 * (`sweep-ablation.mts`, same entry point, `sweepDeclarations` replaced by a no-op on the
 * prototype). So the pass was load-bearing and always was; what read 0 was a counter naming
 * only one of its two jobs. This census now reports both: `sweep.declarationBranch` (the
 * counter that reads 0, kept and not hidden) and `sweep.nestedStatementReentry` (the job
 * `declaration-claim-trace.mts` attributes 630 of 665 first claims to). The gate's S1 was
 * rewritten to the second and S2 to the ablation, because a gate asserting the first was
 * asserting a number the analyzer does not produce.
 *
 * ## A SECOND NUMBER, because the first one is a lower bound
 *
 * A counter that reads 0 is only as good as the pass's own predicate. So this also
 * reports `filesWithErrorNodes` — files the tree says are damaged — next to the counter.
 * A pass whose predicate is "the tree is damaged" reading 0 while many files ARE damaged
 * is a predicate that does not fire; one reading 0 with few damaged files is a corpus
 * that is not damaged enough. The two are different defects with different fixes.
 *
 * ## USAGE
 *   npx tsx validation/m14/fixtures/sql/ambiguity-census.mts [--out FILE]
 *
 * No sharding: the whole admitted population is parsed in one process. An earlier version of
 * this header advertised `--shards N --shard I`, which the code never read — the arguments were
 * accepted and ignored, so a "sharded" run was silently the full population. The flag is gone
 * rather than implemented, because the population is small enough to walk whole and a partial
 * walk under this instrument's name would understate the reachability it exists to measure.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const LANG = "sql"
const SIZE_CAP = 512 * 1024
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

// Same admission rule as ontology-census.mts, stated here rather than imported so this
// script has no dependency on that one's CLI.
const admitted: { label: string; abs: string; text: string }[] = []
let reposScanned = 0
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    // The census's OWN admission test, reproduced rather than approximated: a directory that
    // is not a git work tree is not a repo, and a file's SIZE is read through `statSync`
    // (which follows a symlink) so a link to an oversized file is excluded rather than
    // admitted at its link length. An instrument whose population differs from the headline
    // instrument's is not comparable to it, and 1,960 against 1,955 is exactly that.
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ label: `${entry}/${rel}`, abs, text })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
console.log(`ambiguity census — production parseFile`)
console.log(`corpus root      ${CORPUS}`)
console.log(`repos scanned    ${reposScanned}`)
console.log(`admitted files   ${admitted.length}`)

const resync: { file: string; declarations: number; statements: number }[] = []
const sweep: { file: string; recovered: number }[] = []
/**
 * The sweep's OTHER job, counted separately because it is the one that fires.
 * `sweepDeclarationsRecovered` names a DECLARATION nested inside another DECLARATION; the
 * nested-`statement` re-entry hands those to `processStatement` first, so that branch only ever
 * sees repeats and reads 0 on every population measured. `sweepStatementsDispatched` counts the
 * re-entry itself. Reporting both is the point: a reader who finds one at 0 can see the other.
 */
const sweepDispatch: { file: string; statements: number }[] = []
let filesWithErrorNodes = 0
let degraded = 0
let errorNodeFiles: { file: string; errorNodes: number; unparseableRegions: number }[] = []
for (const f of admitted) {
  let r: any
  try { r = await parseFile(f.abs, LANG) } catch { degraded++; continue }
  if (r?.fallback === true) degraded++
  const amb = r?.metadata?.ambiguity ?? {}
  if ((amb.errorNodes ?? 0) > 0) {
    filesWithErrorNodes++
    if (errorNodeFiles.length < 40) errorNodeFiles.push({ file: f.label, errorNodes: amb.errorNodes, unparseableRegions: amb.unparseableRegions ?? 0 })
  }
  if ((amb.resyncDeclarations ?? 0) > 0) resync.push({ file: f.label, declarations: amb.resyncDeclarations, statements: amb.resyncStatements ?? 0 })
  if ((amb.sweepDeclarationsRecovered ?? 0) > 0) sweep.push({ file: f.label, recovered: amb.sweepDeclarationsRecovered })
  if ((amb.sweepStatementsDispatched ?? 0) > 0) sweepDispatch.push({ file: f.label, statements: amb.sweepStatementsDispatched })
}

const sum = (xs: { [k: string]: number }[]) => xs.reduce((a, x) => a + Object.values(x).reduce((p, q) => p + (typeof q === "number" ? q : 0), 0), 0)
console.log(`\ndegraded files   ${degraded}`)
console.log(`\nRECOVERY PASSES`)
console.log(`  files the TREE reports damaged (errorNodes > 0): ${filesWithErrorNodes} of ${admitted.length}`)
console.log(`  resync  (statement-slice re-parse)`)
console.log(`    files where it contributed : ${resync.length}`)
console.log(`    declarations it contributed: ${resync.reduce((a, x) => a + x.declarations, 0)}`)
for (const x of resync.slice(0, 20)) console.log(`      +${x.declarations} from ${x.statements} statements  ${x.file}`)
console.log(`  sweep   (full-tree declaration sweep)`)
console.log(`    DECLARATION branch, files where it contributed : ${sweep.length}`)
console.log(`    DECLARATION branch, declarations it contributed: ${sweep.reduce((a, x) => a + x.recovered, 0)}`)
for (const x of sweep.slice(0, 20)) console.log(`      +${x.recovered}  ${x.file}`)
console.log(`    nested-statement re-entry, files where it fired: ${sweepDispatch.length}`)
console.log(`    nested-statement re-entry, statements dispatched: ${sweepDispatch.reduce((a, x) => a + x.statements, 0)}`)
for (const x of sweepDispatch.slice(0, 20)) console.log(`      ${x.statements} statement(s)  ${x.file}`)

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/sql/ambiguity-census.mts",
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    corpusRoot: CORPUS, reposScanned, admittedFiles: admitted.length,
    sampling: "every admitted file, no subset",
    sizeCapBytes: SIZE_CAP,
    degradedFiles: degraded,
    filesWithErrorNodes,
    resync: { filesWhereNonZero: resync.length, declarationsTotal: resync.reduce((a, x) => a + x.declarations, 0), files: resync },
    sweep: {
      declarationBranch: { filesWhereNonZero: sweep.length, declarationsTotal: sweep.reduce((a, x) => a + x.recovered, 0), files: sweep },
      nestedStatementReentry: { filesWhereNonZero: sweepDispatch.length, statementsTotal: sweepDispatch.reduce((a, x) => a + x.statements, 0), files: sweepDispatch },
    },
    damagedFileExamples: errorNodeFiles,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
