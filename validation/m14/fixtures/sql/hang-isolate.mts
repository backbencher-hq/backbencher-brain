/**
 * ISOLATES ONE FILE: does `parseFile` return, trap, or hang, and is that the ANALYZER
 * or the GRAMMAR?
 *
 * WHY THIS EXISTS. The pass-15 `--fresh` arbiter walk printed a correct table
 * (`emitted 7/10 ruled-sound 3 FALSIFIED 0`, 1962/1962 files) and THEN exited 1 with
 *
 *   [BB-PARSE-ERR] sql | duckdb/benchmark/aoc24/queries/day02.sql | memory access out of bounds
 *   [BB-HANG] parser stuck 120s on duckdb/benchmark/aoc24/queries/day02.sql — exiting
 *
 * The round brief requires exit 0. So the file has to be attributed to the ANALYZER or
 * to the GRAMMAR, and the two have different owners: `src/ast/real-sql-analyzer.ts` is
 * this lane's, the wasm is shared. A wasm trap is not something a TypeScript string
 * helper can raise on its own, but a tree-sitter node accessor CAN trap when a walk
 * indexes past the end of a node's child list, so "it is a grammar fault" is not
 * something to assume. This probe measures it instead:
 *
 *   1. `parseFile` alone            — the production entry, whatever it does.
 *   2. the raw wasm parse, no analyzer — the same grammar with THIS lane's code removed.
 *
 * If (1) traps and (2) does not, the defect is in this lane's analyzer. If both trap,
 * it is in the grammar or in the pool-worker stage that owns the timeout.
 *
 * Run: npx tsx validation/m14/fixtures/sql/hang-isolate.mts <file> [--analyzer <path>]
 */

import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync, renameSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const target = process.argv[2]
if (!target) {
  console.error("usage: hang-isolate.mts <file> [--analyzer <path-to-analyzer.ts>]")
  process.exit(2)
}
const analyzerFlag = process.argv.indexOf("--analyzer")
const overrideAnalyzer = analyzerFlag >= 0 ? process.argv[analyzerFlag + 1] : null

const ANALYZER = "src/ast/real-sql-analyzer.ts"
const REPO = path.resolve(".")

function stage(label: string, fn: () => void) {
  const t0 = Date.now()
  console.log(`\n=== ${label} ===`)
  try {
    fn()
    console.log(`RESULT ${label}: returned in ${Date.now() - t0}ms`)
  } catch (e: any) {
    console.log(`RESULT ${label}: THREW after ${Date.now() - t0}ms`)
    console.log(`  ${String(e?.message ?? e).split("\n")[0]}`)
  }
}

console.log(`file: ${target}`)
console.log(`bytes: ${readFileSync(target).length}`)

stage("A: parseFile at HEAD (production entry, analyzer AS COMMITTED)", () => {
  // Spawned so a wasm trap or a hang is attributable to this arm alone.
  const out = execFileSync(
    "npx",
    [
      "tsx",
      "-e",
      `import { parseFile } from "./src/ast/pool-worker";
       const t = Date.now();
       const r: any = await parseFile(${JSON.stringify(target)}, ${JSON.stringify(path.dirname(target))});
       console.log("OK symbols=" + (r?.symbols?.length ?? 0) + " rels=" + (r?.relationships?.length ?? 0) + " ms=" + (Date.now()-t));`,
    ],
    { cwd: REPO, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] },
  )
  console.log(String(out).trim())
})

if (overrideAnalyzer) {
  // Swap in a caller-supplied analyzer so the BEFORE arm of a change can be attributed
  // without mutating the worktree. md5-verified both ways: a BEFORE arm run against a
  // silently-unmodified HEAD is a BEFORE arm that measures the change.
  const stash = path.join("/tmp/opencode", `hang-isolate.${process.pid}.stash.ts`)
  copyFileSync(ANALYZER, stash)
  const md5 = (p: string) => execFileSync("md5sum", [p], { encoding: "utf8" }).split(" ")[0]
  const before = md5(ANALYZER)
  console.log(`\nswapping in ${overrideAnalyzer} (HEAD md5 ${before})`)
  copyFileSync(overrideAnalyzer, ANALYZER)
  console.log(`swapped md5 ${md5(ANALYZER)}`)
  try {
    stage(`B: parseFile with ${path.basename(overrideAnalyzer)}`, () => {
      const out = execFileSync(
        "npx",
        [
          "tsx",
          "-e",
          `import { parseFile } from "./src/ast/pool-worker";
           const t = Date.now();
           const r: any = await parseFile(${JSON.stringify(target)}, ${JSON.stringify(path.dirname(target))});
           console.log("OK symbols=" + (r?.symbols?.length ?? 0) + " rels=" + (r?.relationships?.length ?? 0) + " ms=" + (Date.now()-t));`,
        ],
        { cwd: REPO, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] },
      )
      console.log(String(out).trim())
    })
  } finally {
    copyFileSync(stash, ANALYZER)
    const restored = md5(ANALYZER)
    console.log(`\nrestored analyzer md5 ${restored} (HEAD was ${before}) ${restored === before ? "IDENTICAL" : "MISMATCH"}`)
    if (existsSync(stash)) unlinkSync(stash)
  }
}