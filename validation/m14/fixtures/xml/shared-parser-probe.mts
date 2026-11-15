/**
 * SHARED-PARSER PROBE — is `parseFile`'s run-to-run symbol variance caused by CONCURRENT
 * `getParser` calls sharing one `web-tree-sitter` Parser instance?
 *
 * ## Why this probe exists
 *
 * `worker-determinism-probe.mts` measured that production symbol and edge counts on a
 * fixed 600-file draw are not reproducible, and that varying the WORKER COUNT is not the
 * variable — the same worker count produced two different totals in consecutive runs.
 * Something else is concurrent inside a single process. `src/ast/engine.ts` (supervisor-
 * owned, lane brief §8) hands every caller the SAME cached Parser per language:
 *
 *     if (parsers.has(language)) { parserUsage.set(language, Date.now()); …; return parsers.get(language)! }
 *
 * and deletes it out from under in-flight work in two places — `cleanupParsers()` at
 * `MAX_CONCURRENT_PARSERS`, and the `currentCount >= 500` recreate. `web-tree-sitter`'s
 * `parser.parse()` is async, so N callers holding one Parser do interleave inside the WASM
 * instance. That is a hypothesis about SHARED MACHINERY, so it is measured here rather than
 * asserted, and this lane does not edit the file either way.
 *
 * ## What it measures
 *
 * One fixed set of corpus files, parsed REPEATEDLY under two schedules, in one process:
 *
 *   sequential  rounds of 1 parse at a time
 *   concurrent  the same total number of parses, 8 in flight at once
 *
 * Per round it records the file's symbol count. The question is not whether concurrent
 * parsing is FASTER — it is whether it returns FEWER SYMBOLS for the same bytes. A file
 * whose count differs between the two schedules is a file the concurrent schedule lost
 * symbols from, and the count of such files is the size of the defect the census is
 * measuring without knowing.
 *
 * ## What a null result means
 *
 * If the two schedules agree exactly, the shared-Parser hypothesis is FALSIFIED for this
 * grammar and the variance has another source, which is a result worth having: it moves
 * the search away from `engine.ts` and onto the census's own process. This probe is built
 * to be able to say "no", and reports that.
 *
 * READ-ONLY. Writes nothing except the JSON passed with `--out`.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const FILES = Number(process.env.BB_XML_FILES ?? 48)
const ROUNDS = Number(process.env.BB_XML_ROUNDS ?? 6)
const CONCURRENCY = Number(process.env.BB_XML_CONCURRENCY ?? 8)
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined

// The draw: every repo's first admitted file, up to `FILES`, sorted — a fixed set that
// spans vocabularies (DTD, RNG, XSD, XSLT, SVG, Spring, DocBook) rather than 48 files of
// whichever repository sorts first.
const rows: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  const admitted: string[] = []
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    admitted.push(rel)
  }
  admitted.sort()
  if (admitted.length > 0) {
    // up to 4 per repo, so the set spans vocabularies without one repo dominating
    for (const rel of admitted.slice(0, 4)) rows.push({ repo: e, dir, rel, abs: path.join(dir, rel) })
    if (rows.length >= FILES) break
  }
}
const files = rows.slice(0, FILES)
console.log(`shared-parser probe — xml`)
console.log(`  ${files.length} files · ${ROUNDS} rounds · concurrency ${CONCURRENCY}`)

const countsFor = async (f: (typeof files)[number]): Promise<number> => {
  const r: any = await parseFile(f.abs, f.dir)
  return (r.symbols ?? []).length
}

/**
 * The lost-parse RESULT, captured rather than inferred.
 *
 * A whole-file loss is the worst shape this defect can take, because the only question a
 * consumer asks about a missing file is whether the parse FAILED — and if the failure is
 * silent, `symbols: []` with no `errors` and no `fallback` flag reads exactly like a file
 * that genuinely contains no symbols. So the losing result object is recorded in full: its
 * `success`, `errors.length`, `fallback`, and whether the engine logged anything.
 */
const captured: any[] = []
const countsForCapturing = async (f: (typeof files)[number], expect: number): Promise<number> => {
  const r: any = await parseFile(f.abs, f.dir)
  const n = (r.symbols ?? []).length
  if (expect > 0 && n === 0 && captured.length < 5) {
    captured.push({
      file: `${f.repo}/${f.rel}`,
      expectedSymbols: expect,
      success: r?.success,
      fallback: r?.fallback,
      errorsCount: (r?.errors ?? []).length,
      errorSample: (r?.errors ?? []).slice(0, 2).map((e: any) => String(e?.message ?? e).slice(0, 200)),
      importsCount: (r?.imports ?? []).length,
      relationshipsCount: (r?.relationships ?? []).length,
      sizeBytes: r?.sizeBytes,
      fileHash: r?.fileHash,
    })
  }
  return n
}

const sequential: number[][] = []
for (let round = 0; round < ROUNDS; round++) {
  const row: number[] = []
  for (const f of files) row.push(await countsFor(f))
  sequential.push(row)
}
const baseline = files.map((_, i) => seqMinOf(sequential, i))
function seqMinOf(rows: number[][], i: number): number {
  let m = Number.MAX_SAFE_INTEGER
  for (const r of rows) if (r[i] < m) m = r[i]
  return m
}

const concurrent: number[][] = []
for (let round = 0; round < ROUNDS; round++) {
  const row = new Array<number>(files.length).fill(-1)
  let cursor = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const i = cursor++
      if (i >= files.length) return
      row[i] = await countsForCapturing(files[i], baseline[i])
    }
  }))
  concurrent.push(row)
}

const seqMin = new Array(files.length).fill(Number.MAX_SAFE_INTEGER)
const seqMax = new Array(files.length).fill(0)
for (const row of sequential) for (let i = 0; i < files.length; i++) { if (row[i] < seqMin[i]) seqMin[i] = row[i]; if (row[i] > seqMax[i]) seqMax[i] = row[i] }
const conMin = new Array(files.length).fill(Number.MAX_SAFE_INTEGER)
const conMax = new Array(files.length).fill(0)
for (const row of concurrent) for (let i = 0; i < files.length; i++) { if (row[i] < conMin[i]) conMin[i] = row[i]; if (row[i] > conMax[i]) conMax[i] = row[i] }

let unstableWithinSequential = 0
let unstableWithinConcurrent = 0
const differing: { file: string; seq: [number, number]; con: [number, number] }[] = []
let seqTotal = 0
let conTotal = 0
for (let i = 0; i < files.length; i++) {
  if (seqMin[i] !== seqMax[i]) unstableWithinSequential++
  if (conMin[i] !== conMax[i]) unstableWithinConcurrent++
  if (seqMin[i] !== conMin[i] || seqMax[i] !== conMax[i]) {
    differing.push({ file: `${files[i].repo}/${files[i].rel}`, seq: [seqMin[i], seqMax[i]], con: [conMin[i], conMax[i]] })
  }
  for (const row of sequential) seqTotal += row[i]
  for (const row of concurrent) conTotal += row[i]
}

const out = {
  generatedBy: "validation/m14/fixtures/xml/shared-parser-probe.mts",
  corpusRoot: CR,
  files: files.map((f) => `${f.repo}/${f.rel}`),
  rounds: ROUNDS,
  concurrency: CONCURRENCY,
  sequential,
  concurrent,
  perFileSequential: { min: seqMin, max: seqMax },
  perFileConcurrent: { min: conMin, max: conMax },
  unstableWithinSequential,
  unstableWithinConcurrent,
  filesDifferingBetweenSchedules: differing.length,
  differing,
  totalSymbolsSequential: seqTotal,
  totalSymbolsConcurrent: conTotal,
  capturedLostResults: captured,
}
console.log(`  symbols over all rounds — sequential ${seqTotal} · concurrent ${conTotal} · delta ${conTotal - seqTotal}`)
console.log(`  files unstable WITHIN sequential: ${unstableWithinSequential} · WITHIN concurrent: ${unstableWithinConcurrent}`)
console.log(`  files whose count differs BETWEEN schedules: ${differing.length} of ${files.length}`)
for (const d of differing.slice(0, 20)) console.log(`    ${d.file}  seq[${d.seq[0]}..${d.seq[1]}]  con[${d.con[0]}..${d.con[1]}]`)
for (const c of captured) console.log(`    LOST ${c.file}: success=${c.success} fallback=${c.fallback} errors=${c.errorsCount} rels=${c.relationshipsCount} size=${c.sizeBytes} hash=${c.fileHash}${c.errorSample.length ? ` err="${c.errorSample[0]}"` : ""}`)
if (differing.length === 0) console.log(`  -> shared-Parser hypothesis FALSIFIED on this draw: both schedules agree on every file.`)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`  wrote ${OUT}`) }