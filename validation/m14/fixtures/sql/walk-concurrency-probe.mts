/**
 * DOES THE POISON NEED CONCURRENCY? The pass-15 arbiter walk traps and hangs at
 * concurrency 8; the same files parse clean one at a time.
 *
 * WHAT IS MEASURED SO FAR, and why this file exists.
 *   `hang-isolate.mts` arm A (production `parseFile`, one file, one process):
 *     dark/backend/migrations/schema/09-user-data.sql      OK 31 sym 29 rel  867ms
 *     duckdb/benchmark/aoc24/queries/day02.sql             OK  1 sym  1 rel 1048ms
 *     duckdb/benchmark/aoc24/queries/day04.sql             OK  1 sym  7 rel ~1.2s
 *     dbeaver .../preferences/format_preview.sql           OK  1 sym  6 rel
 *   So NONE of the four files the walk named as `[BB-PARSE-ERR] memory access out of
 *   bounds` is a poison file in isolation. `wasm-growth.mts` then measured the walk's
 *   per-parse cost and found the tmpdir story is not it: +1 grammar copy per 200
 *   parseFile calls, 12.0 MiB, projecting +10 files / +118 MiB for the 1,962-file
 *   walk. Not a plausible cause of a wasm trap.
 *
 * WHAT IS LEFT, and it is a real difference rather than a guess: `resumableWalk` is
 * called with `concurrency: 8`, so EIGHT `parser.parse()` calls are in flight in one
 * process against ONE cached wasm parser, while `hang-isolate` runs them one at a time.
 * A wasm Parser is not documented as re-entrant, and the error is a memory trap rather
 * than a parse error, which is what a shared-instance race looks like from the outside.
 *
 * So the arms here are the SAME file list under different concurrency, in one process
 * each, and the number that decides it is how many traps each arm produces:
 *
 *   concurrency 1   — matches the isolated arm, which is known clean
 *   concurrency 8   — matches `resumableWalk`'s own setting
 *
 * A defect that only appears at 8 is not in this lane's analyzer: `parseFile` is called
 * once per file in both arms and the analyzer is identical. It is the shared parser
 * being shared. That is a §8 report, not an edit — `src/ast/engine.ts` and
 * `script/m14/resumable-walk.ts` are not this lane's files.
 *
 * The four named files are ALSO run through both arms on their own, so a file that is
 * poison by itself is separated from one that only poisons a concurrent walk even if
 * the population arms happen to agree.
 *
 * Run: npx tsx validation/m14/fixtures/sql/walk-concurrency-probe.mts [fileCount]
 */
import { readdirSync, statSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(process.argv[2] ?? 400)

/** The four files the pass-15 walk named. Their traps are the thing being explained. */
const NAMED = [
  "dark/backend/migrations/schema/09-user-data.sql",
  "dbeaver/plugins/org.jkiss.dbeaver.ui.editors.sql/src/org/jkiss/dbeaver/ui/editors/sql/preferences/format_preview.sql",
  "duckdb/benchmark/aoc24/queries/day02.sql",
  "duckdb/benchmark/aoc24/queries/day04.sql",
]

// Same admission rule the arbiter uses: git-tracked, <=512 KB, language-detected.
// Detection is left to `parseFile`'s own `detectLanguageFromPath`, and a file is only
// offered if its extension is `.sql`, so the population is the arbiter's minus the
// content-sniffing cases — stated rather than assumed equal.
const files: { abs: string; dir: string; rel: string }[] = []
for (const repo of readdirSync(CR).sort()) {
  if (files.length >= N) break
  const dir = `${CR}/${repo}`
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "*.sql"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (files.length >= N) break
    const abs = `${dir}/${rel}`
    try {
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    files.push({ abs, dir, rel: `${repo}/${rel}` })
  }
}

async function arm(label: string, concurrency: number, list: { abs: string; dir: string; rel: string }[]) {
  let ok = 0
  let traps = 0
  let degraded = 0
  let rels = 0
  let syms = 0
  const trapped: string[] = []
  const t0 = Date.now()
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= list.length) return
      const f = list[i]
      try {
        const r: any = await parseFile(f.abs, f.dir)
        ok++
        rels += r?.relationships?.length ?? 0
        syms += r?.symbols?.length ?? 0
        if (r?.degraded) degraded++
      } catch (e: any) {
        traps++
        if (trapped.length < 12) trapped.push(`${f.rel} :: ${String(e?.message ?? e).split("\n")[0].slice(0, 90)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const secs = (Date.now() - t0) / 1000
  console.log(
    `\n=== ${label} (concurrency ${concurrency}, ${list.length} files) ===\n` +
      `ok ${ok}  traps ${traps}  degraded ${degraded}  symbols ${syms}  relationships ${rels}  ${secs.toFixed(1)}s`,
  )
  for (const t of trapped) console.log(`  TRAP ${t}`)
  return { ok, traps, degraded, rels, syms, secs }
}

console.log(`corpus root: ${CR}`)
console.log(`population: ${files.length} git-tracked .sql files, <=512 KB, repos in name order`)
console.log(`named by the pass-15 walk as trapping: ${NAMED.length}`)

const namedFiles = NAMED.map((rel) => {
  const i = rel.indexOf("/")
  return { abs: `${CR}/${rel}`, dir: `${CR}/${rel.slice(0, i)}`, rel }
}).filter((f) => {
  try {
    return statSync(f.abs).isFile()
  } catch {
    return false
  }
})
console.log(`present on disk: ${namedFiles.length}`)

const named1 = await arm("NAMED files, alone", 1, namedFiles)
const named8 = await arm("NAMED files, concurrent", 8, namedFiles)
const pop1 = await arm("POPULATION, serial", 1, files)
const pop8 = await arm("POPULATION, concurrent", 8, files)

console.log(`\n--- the question, in one table ---`)
console.log(`arm                    files  traps`)
console.log(`named alone              ${String(namedFiles.length).padStart(5)}  ${String(named1.traps).padStart(5)}`)
console.log(`named concurrent         ${String(namedFiles.length).padStart(5)}  ${String(named8.traps).padStart(5)}`)
console.log(`population serial        ${String(files.length).padStart(5)}  ${String(pop1.traps).padStart(5)}`)
console.log(`population concurrent    ${String(files.length).padStart(5)}  ${String(pop8.traps).padStart(5)}`)

const verdict =
  pop8.traps > pop1.traps
    ? `CONCURRENCY-CORRELATED: ${pop8.traps} traps at 8 against ${pop1.traps} at 1 over the same ${files.length} files. Not this lane's analyzer — parseFile is called once per file in both arms.`
    : pop8.traps > 0
      ? `SAME AT BOTH CONCURRENCIES: ${pop8.traps} and ${pop1.traps} traps over the same ${files.length} files. So concurrency is not the variable; the input is, and the named files are the ones to look at.`
      : `NO TRAP REPRODUCED in either arm over ${files.length} files. The pass-15 trap is a property of that process's accumulated state, not of any single file or of concurrency alone.`
console.log(`\nVERDICT: ${verdict}`)
