/**
 * COLLECT — the raw parse pass behind the ambiguity measurement.
 *
 * ## Why this file exists
 *
 * The ambiguity question needs two populations that a single `parseFile` call
 * cannot give at once: the published DECLARATIONS (what a target string could
 * bind to) and the emitted EDGES (what actually names one). Both come from the
 * same call, so one pass over the sample produces both — but the ANALYSIS of
 * them changes every time a hypothesis changes, and re-parsing 600 files per
 * hypothesis costs minutes per idea.
 *
 * So the parse pass writes an append-only NDJSON of exactly what production
 * `parseFile` returned, and the analysis reads that. The NDJSON is the evidence;
 * an analysis that disagrees with it can be re-derived from it.
 *
 * ## Why the production entry point, not `analyze()`
 *
 * `parseFile` from `src/ast/pool-worker.ts` is the entry the indexer uses.
 * `analyze()` in `src/ast/engine.ts` is a per-file unit that skips the pool
 * worker, the byte limits, the timeouts, the truncation and the enhancement
 * stages — a different function over the same grammar, so counts from it are
 * counts of something else.
 *
 * ## The sample is named by its own contents
 *
 * The NDJSON filename carries a digest of the file list it was drawn from. A
 * record left over from an earlier, differently-strided sample therefore cannot
 * be read as this sample's evidence — the earlier run's rows land in a
 * different file instead of being filtered out at analysis time, where a stale
 * row would silently inflate a count.
 *
 * ## Poison-file safety
 *
 * `parser.parse()` is synchronous C/WASM: a grammar that loops on one input
 * blocks the event loop, so a timer cannot interrupt it and
 * `ASTEngine.parseWithTimeout` can only answer by killing the process. One bad
 * file therefore destroys a whole measurement. `resumable-walk.ts` exists for
 * that: it appends each path to a checkpoint BEFORE the next file starts, so an
 * arbitrary kill costs one file rather than the run. `collect` is written to be
 * re-invoked until it reports `walked + alreadyDone === total`.
 *
 * ## No regex
 *
 * `.dart` below is a file EXTENSION test, not a scan of a file's contents, and
 * everything after this point reads parsed structures only. No regular
 * expression appears in this file and none may be added: a pattern over source
 * text matches comments and string literals and breaks on the next grammar
 * version.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { resumableWalk } from "../../../../script/m14/resumable-walk"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const HERE = (import.meta as any).dirname ?? "."
const MEAS = path.resolve(HERE, "../../measurements")

/** How many files the sample draws from the population. */
const SAMPLE_N = Number(process.env.BB_DART_SAMPLE ?? 600)

/** `.dart` is a file EXTENSION, so this is a suffix test on a path, not a text scan. */
function isDart(p: string): boolean {
  return p.endsWith(".dart")
}

/** Every `.dart` file under the corpus root, as absolute paths. */
export function dartPopulation(root = CORPUS_ROOT): string[] {
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules" || e === "build" || e === ".dart_tool") continue
      const full = path.join(dir, e)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (st.isFile() && isDart(e)) out.push(full)
    }
  }
  // Byte order, so the list is a function of the corpus and nothing else — a
  // locale-sensitive sort would make the sample depend on the machine.
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return out
}

/**
 * The sample: every `stride`-th file of the byte-sorted population, from index 0.
 *
 * Deterministic and stated, which is what makes a before/after pair comparable:
 * both runs read this same list. A stride over a sorted population is not a
 * uniform sample of FILES — it is closer to a uniform sample of PATH PREFIXES,
 * so a repository holding many files under one prefix is represented in
 * proportion to its file count. That is the intended weighting for "what does
 * this corpus look like", and the per-repository composition is reported with
 * every result rather than assumed.
 */
export function dartSample(root = CORPUS_ROOT, n = SAMPLE_N): string[] {
  const pop = dartPopulation(root)
  const stride = Math.max(1, Math.floor(pop.length / n))
  const out: string[] = []
  for (let i = 0; i < pop.length && out.length < n; i += stride) out.push(pop[i])
  return out
}

/** One record per file: exactly the fields the analysis reads, nothing derived. */
export interface RawFile {
  f: string
  symbols: { name: string; kind: string; q: string; line: number }[]
  rels: { t: string; s: string; g: string; line: number; c: number }[]
  fallback?: boolean
}

function toRecord(file: string, r: any): RawFile {
  const symbols: RawFile["symbols"] = []
  for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
    symbols.push({
      name: String(s?.name ?? ""),
      kind: String(s?.kind ?? ""),
      q: String(s?.qualifiedName ?? ""),
      line: Number(s?.startLine ?? s?.start_line ?? 0),
    })
  }
  const rels: RawFile["rels"] = []
  for (const x of Array.isArray(r?.relationships) ? r.relationships : []) {
    rels.push({
      t: String(x?.type ?? ""),
      s: String(x?.source ?? x?.from ?? ""),
      g: String(x?.target ?? x?.to ?? ""),
      line: Number(x?.line_number ?? x?.line ?? 0),
      c: Number(x?.confidence ?? 0),
    })
  }
  const rec: RawFile = { f: file, symbols, rels }
  if (r?.fallback === true) rec.fallback = true
  return rec
}

/**
 * The project root a file is parsed under.
 *
 * `parseFile` takes one and the indexer supplies the repository root. The Dart
 * corpus repos are independent packages, so the root is the enclosing git
 * repository rather than the corpus directory — otherwise every file in the
 * corpus resolves its relative path against one shared root and cross-file
 * naming is measured against a project that does not exist.
 */
export function projectRootFor(file: string): string {
  let dir = path.dirname(file)
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir
    const up = path.dirname(dir)
    if (up === dir) return path.dirname(file)
    dir = up
  }
}

/** The raw file and checkpoint paths for one sample, named by the list's digest. */
export function samplePaths(sample: string[]) {
  const digest = createHash("sha256").update(sample.join("\n")).digest("hex").slice(0, 12)
  return {
    list: path.join(MEAS, `dart-${sample.length}-${digest}.txt`),
    raw: path.join(MEAS, `dart-${sample.length}-${digest}.raw.ndjson`),
    ckpt: path.join(MEAS, `dart-${sample.length}-${digest}.collect.ckpt`),
  }
}

export function readRaw(raw: string): RawFile[] {
  if (!existsSync(raw)) return []
  const out: RawFile[] = []
  for (const line of readFileSync(raw, "utf-8").split("\n")) {
    if (line.length === 0) continue
    try {
      out.push(JSON.parse(line) as RawFile)
    } catch {
      // A torn final line is what an arbitrary kill leaves behind. It is dropped
      // and reported by the collector rather than parsed as a partial record.
    }
  }
  return out
}

/**
 * The collect pass, run only when this file is the ENTRY POINT.
 *
 * It used to run on import. Every analysis in this directory imports the
 * `readRaw`/`samplePaths` helpers from here, so each one silently started a
 * 600-file parse before it read a byte — invisible in the output, because a
 * completed checkpoint makes the pass a no-op that prints "walked 0, already
 * 600", and expensive the moment the checkpoint is incomplete. An analysis must
 * never be able to start a corpus walk as a side effect of being loaded.
 */
async function main(): Promise<void> {
  mkdirSync(MEAS, { recursive: true })
  const sample = dartSample()
  const paths = samplePaths(sample)
  if (!existsSync(paths.list)) writeFileSync(paths.list, sample.join("\n") + "\n")
  if (!existsSync(paths.raw)) writeFileSync(paths.raw, "")

  const stats = await resumableWalk(paths.ckpt, sample.length, {
    id: (i) => sample[i],
    concurrency: 6,
    run: async (i) => {
      const r = await parseFile(sample[i], projectRootFor(sample[i]))
      appendFileSync(paths.raw, JSON.stringify(toRecord(sample[i], r)) + "\n")
    },
  })

  const onDisk = readRaw(paths.raw).length
  const done = stats.walked + stats.alreadyDone
  console.log(`collect dart — sample ${sample.length} of population ${dartPopulation().length}`)
  console.log(`  raw     ${paths.raw}`)
  console.log(`  walked ${stats.walked}, already ${stats.alreadyDone}, abandoned ${stats.skippedBad}, records ${onDisk}`)
  if (done < stats.total) {
    console.log(`  INCOMPLETE — ${stats.total - done} file(s) remain; re-run to resume.`)
    process.exitCode = 1
  }
}

// Run the pass only when this file is the process entry point.
//
// It used to run on import. Every analysis in this directory imports the
// `readRaw` / `samplePaths` helpers from here, so each one silently started a
// 600-file parse before reading a byte — invisible in the output, because a
// completed checkpoint makes the pass a no-op printing "walked 0, already 600",
// and expensive the moment the checkpoint is incomplete. An analysis must never
// be able to start a corpus walk as a side effect of being loaded.
//
// This module's own path is compared against the process entry point.
// `import.meta.main` is NOT usable: tsx reports it `true` for every module it
// loads, so that spelling ran the walk on import — the exact bug being fixed.
const RAN_DIRECTLY =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (RAN_DIRECTLY) {
  main()
}