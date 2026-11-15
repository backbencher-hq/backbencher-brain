/**
 * WHY DOES THE ARBITER READ LOWER THAN THE CENSUS ON THE SAME FILES?
 *
 * THE OBSERVATION. Two instruments, one corpus, one entry point, two answers:
 *
 *   instrument                          calls   uses   contains  refs   imports  overrides  instantiates   total
 *   `ontology-census.mts`, 4 shards     3,892   9,098  11,959    5,993  52       22         21            31,037
 *   `ontology-coverage-gate.ts`, 8 shards (this lane's sharded arbiter run)
 *                                      3,763   8,046  11,111    5,688  42       15         21            30,686
 *                                                                                       difference: -351 edges
 *
 * Both admit 1,955 files by the same rule and both call production `parseFile`. A difference
 * between them is therefore not a disagreement about the language — it is one instrument's
 * process shape losing edges, and WHICH one is right is a measurement, not a preference.
 *
 * THE TWO SHAPES, and the only thing that differs between them:
 *
 *   the census walks a shard per PROCESS and exits;
 *   the arbiter walks the whole corpus with `await Promise.all(Array.from({length: 8}, worker))`
 *   inside ONE process — 8 concurrent workers over 1,955 files.
 *
 * Pass 3 already measured that the fault this lane has is a property of SUSTAINED wasm state
 * over a long walk, not of any file and not of concurrency alone: all 25
 * `duckdb/benchmark/aoc24/queries/day*.sql` parse solo in 0.7–7.6 s with no fault, and across 4
 * rounds of 8-way CONTENDED parsing of exactly those files there were 0 faults and 0 hangs
 * (`measurements/pass3-fault-contended-r1.json`). So the arbiter's shape is the one this lane has
 * already shown to degrade — and a degradation that returns a SHAPE LIKE SUCCESS is invisible in
 * its own output, which is exactly how pass 2's `parseFailures: 0` was printed by runs in which
 * files had contributed nothing.
 *
 * So this script does not argue from the totals. It records PER FILE, in both shapes, and reports
 * the files whose edge count moved. A total with no file list cannot be acted on; a file list can.
 *
 * WHAT IT RECORDS per file: the relationship count, the per-type counts, whether `parseFile`
 * THREW (the arbiter catches and `continue`s, so a throw is a silent zero there and a counted row
 * here), and the two fallback markers `pool-worker` can return while looking like success —
 * `fallback: true` (the language-agnostic REGEX extractor) and
 * `metadata.analysisVersion === "2.0-basic-fallback"` (the engine's 120 s timeout load policy).
 *
 * The one-process shape is killed by `engine.ts`'s `process.exit(1)` on a parser hang, so rows are
 * APPENDED as they complete and a `--resume` run picks up only the files still missing. A killed
 * process therefore costs a rerun, not the run.
 *
 * USAGE:
 *   npx tsx validation/m14/fixtures/sql/arbiter-vs-shard.mts shape --shape one-process --rows A.jsonl
 *   npx tsx validation/m14/fixtures/sql/arbiter-vs-shard.mts shape --shape shard --shards 8 --shard 0 --rows B.jsonl
 *   npx tsx validation/m14/fixtures/sql/arbiter-vs-shard.mts diff --a A.jsonl --b B.jsonl --out C.json
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const MODE = argv[0]

// ---------------------------------------------------------------- admitted files, the arbiter's rule
function admitted(): string[] {
  const out: string[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      const st = statSync(dir)
      if (!st.isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try { const st = statSync(abs); if (st.size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
      if (detectLanguageFromPath(abs, text) !== "sql") continue
      out.push(abs)
    }
  }
  // Contiguous order, sorted, because `contiguous` is the only partition whose slices are
  // reproducible from the file list alone — a directory walk's order depends on the filesystem.
  out.sort()
  return out
}

type Row = { file: string; rel: string; n: number; byType: Record<string, number>; threw: string | null; regexFallback: boolean; basicFallback: boolean; ms: number }

if (MODE === "shape") {
  const SHAPE = argOf("--shape") ?? "one-process"
  const SHARDS = Number(argOf("--shards") ?? 1)
  const SHARD = Number(argOf("--shard") ?? 0)
  const ROWS = argOf("--rows")!
  const RESUME = argv.includes("--resume")
  const files = admitted()
  // The shard shape takes a CONTIGUOUS slice — the partition `run-sharded-census.sh` uses, so the
  // baseline this diffs against is the same partition and not merely a similar one.
  const slice = SHAPE === "shard" ? files.filter((_, i) => i % SHARDS === SHARD) : files
  const done = new Set<string>()
  if (RESUME && existsSync(ROWS)) for (const l of readFileSync(ROWS, "utf8").split("\n")) { if (!l.trim()) continue; try { done.add(JSON.parse(l).file) } catch {} }
  else writeFileSync(ROWS, "")
  const todo = slice.filter((f) => !done.has(f))
  console.log(`shape=${SHAPE} shard=${SHARD}/${SHARDS} admitted=${files.length} slice=${slice.length} todo=${todo.length} already=${done.size}`)

  let idx = 0
  let ok = 0
  const worker = async () => {
    while (true) {
      const i = idx++
      if (i >= todo.length) return
      const abs = todo[i]
      const dir = path.dirname(abs)
      const rel = path.relative(CR, abs)
      const t0 = Date.now()
      let row: Row
      try {
        const r: any = await parseFile(abs, dir)
        const byType: Record<string, number> = {}
        let n = 0
        for (const x of r?.relationships ?? []) { const t = String(x.type ?? x.relationshipType ?? "").toLowerCase(); byType[t] = (byType[t] ?? 0) + 1; n++ }
        row = {
          file: abs, rel, n, byType, threw: null,
          regexFallback: r?.fallback === true,
          basicFallback: r?.metadata?.analysisVersion === "2.0-basic-fallback",
          ms: Date.now() - t0,
        }
      } catch (e: any) {
        row = { file: abs, rel, n: 0, byType: {}, threw: String(e?.message ?? e).slice(0, 200), regexFallback: false, basicFallback: false, ms: Date.now() - t0 }
      }
      appendFileSync(ROWS, JSON.stringify(row) + "\n")
      ok++
    }
  }
  // The arbiter's shape is exactly this: 8 workers, one process, the whole corpus.
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  console.log(`shape=${SHAPE} shard=${SHARD} wrote ${ok} rows (${done.size + ok} total in ${ROWS})`)
}

if (MODE === "diff") {
  const A = argOf("--a")!
  const B = argOf("--b")!
  const OUT = argOf("--out")
  const read = (p: string) => {
    const m = new Map<string, Row>()
    for (const l of readFileSync(p, "utf8").split("\n")) { if (!l.trim()) continue; const r = JSON.parse(l) as Row; if (!m.has(r.file)) m.set(r.file, r) }
    return m
  }
  const a = read(A), b = read(B)
  const files = [...new Set([...a.keys(), ...b.keys()])].sort()
  const rows: any[] = []
  for (const f of files) {
    const ra = a.get(f), rb = b.get(f)
    if (!ra || !rb) { rows.push({ rel: path.relative(CR, f), inA: !!ra, inB: !!rb, nA: ra?.n ?? null, nB: rb?.n ?? null, delta: null, cause: ra || rb ? "present in only one shape" : "absent from both" }); continue }
    const delta = ra.n - rb.n
    if (delta !== 0) {
      const byType: Record<string, number> = {}
      for (const t of ALL_TYPES) { const d = (ra.byType[t] ?? 0) - (rb.byType[t] ?? 0); if (d !== 0) byType[t] = d }
      rows.push({ rel: path.relative(CR, f), nA: ra.n, nB: rb.n, delta, byType, threwA: ra.threw, threwB: rb.threw, regexFallbackA: ra.regexFallback, regexFallbackB: rb.regexFallback, basicFallbackA: ra.basicFallback, basicFallbackB: rb.basicFallback })
    }
  }
  const sum = (m: Map<string, Row>, t: Type) => [...m.values()].reduce((s, r) => s + (r.byType[t] ?? 0), 0)
  const perTypeA: Record<string, number> = {}, perTypeB: Record<string, number> = {}
  for (const t of ALL_TYPES) { perTypeA[t] = sum(a, t); perTypeB[t] = sum(b, t) }
  const report = {
    instrument: "validation/m14/fixtures/sql/arbiter-vs-shard.mts",
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    shapes: { A: "one-process, 8 concurrent workers, whole corpus (the arbiter's shape)", B: "8 contiguous shards, one process each (the census's shape)" },
    corpusRoot: CR,
    filesInA: a.size, filesInB: b.size, filesInBoth: files.filter((f) => a.has(f) && b.has(f)).length,
    totalEdgesA: [...a.values()].reduce((s, r) => s + r.n, 0),
    totalEdgesB: [...b.values()].reduce((s, r) => s + r.n, 0),
    perTypeA, perTypeB,
    perTypeDelta: Object.fromEntries(ALL_TYPES.map((t) => [t, perTypeA[t] - perTypeB[t]])),
    threwA: [...a.values()].filter((r) => r.threw).length,
    threwB: [...b.values()].filter((r) => r.threw).length,
    regexFallbackA: [...a.values()].filter((r) => r.regexFallback).length,
    regexFallbackB: [...b.values()].filter((r) => r.regexFallback).length,
    basicFallbackA: [...a.values()].filter((r) => r.basicFallback).length,
    basicFallbackB: [...b.values()].filter((r) => r.basicFallback).length,
    filesDiffering: rows.length,
    rows: rows.sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0)),
  }
  const j = JSON.stringify(report, null, 2) + "\n"
  if (OUT) { writeFileSync(OUT, j); console.log(`artifact: ${OUT}`) } else console.log(j)
}
