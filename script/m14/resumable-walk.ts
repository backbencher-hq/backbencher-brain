/**
 * A crash-safe, resumable corpus walk.
 *
 * ## Why this exists
 *
 * `parser.parse()` is synchronous C/WASM. When a grammar loops on a pathological input
 * it loops FOREVER, and because the event loop is blocked a timer cannot interrupt it —
 * so `ASTEngine.parseWithTimeout` can only answer by killing the whole process:
 *
 *     [BB-HANG] parser stuck 120s on <file> — exiting
 *
 * The comment beside that guard says "the indexer is incremental — re-running resumes
 * from where it left off". True for the INDEXER, which persists per-file state. False
 * for every analysis tool, and those are the ones that walk a corpus in one process:
 * `ontology-coverage-gate`, `firing-check`, and each lane's census. For them one
 * malformed file destroys the entire measurement, and every run reproduces the same
 * total loss because the bad file is always in the corpus.
 *
 * Observed repeatedly in this programme:
 *   nim   120s guard on nim/tests/avr/thello.nim -> census exits, no number at all
 *   scss  120s guard on a 1.6 MB generated sprite -> verdict emitted, walk truncated
 *   hcl   120s guard on a terraform testdata file -> same
 *
 * A measurement that a single input file can delete is not a measurement.
 *
 * ## The design
 *
 * An APPEND-ONLY log of paths already walked. Append-only is the whole trick: a
 * `process.exit()` inside a parse cannot flush a checkpoint, so any checkpoint written
 * at the end of a run is a checkpoint that never gets written. Appending BEFORE the
 * next file starts means the log survives an arbitrary kill, because each line was
 * already on disk before the thing that could kill us began.
 *
 * Two markers, both recorded, neither silently dropped:
 *   `<path>`      walked successfully
 *   `!<path>`     the walk gave up on this file — parse error OR a process-killing
 *                 hang. Re-running SKIPS it, so one poison file costs one file rather
 *                 than every subsequent run.
 *
 * ## The rule this file follows
 *
 * `docs/M14-HONESTY-CONTRACT.md`: an instrument must declare the population it covered.
 * So every run reports total / already-done / newly-walked / skipped-bad, and a
 * measurement over 99.2% of a corpus says 99.2% rather than claiming the whole thing.
 * A resumed walk that silently reports the same number as a complete one would be the
 * exact defect — a correct number about the wrong population — that this file exists to
 * end.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** What the walk did, for the caller to report honestly. */
export interface WalkStats {
  /** Files offered to the walk. */
  total: number
  /** Already recorded by an earlier run — not re-walked. */
  alreadyDone: number
  /** Actually parsed this run. */
  walked: number
  /** Files abandoned permanently, because they hang or cannot be parsed. */
  skippedBad: number
  /** Files present this run but absent from the checkpoint's history. */
  fresh: number
  /**
   * True when this run did NOT cover every file it was offered — either because it was
   * killed part-way, or because files were skipped as bad. Callers MUST surface this
   * rather than reporting their counts as if the walk were complete.
   */
  partial: boolean
  /** Where the checkpoint lives, so a run can be explained after the fact. */
  checkpoint: string
}

const MARK_BAD = "!"

/**
 * Load a checkpoint into two sets: completed and known-bad.
 *
 * Tolerant of a truncated final line, which is what a kill mid-append leaves behind.
 * Dropping one partial path costs one re-walk; refusing to start costs the whole run.
 */
function loadCheckpoint(path: string): { done: Set<string>; bad: Set<string> } {
  const done = new Set<string>()
  const bad = new Set<string>()
  if (!existsSync(path)) return { done, bad }
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    return { done, bad }
  }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith(MARK_BAD)) bad.add(t.slice(1))
    else done.add(t)
  }
  return { done, bad }
}

export interface WalkOptions {
  /** Stable identity for a file — usually the absolute path. */
  id: (index: number) => string
  /** Do the work. Reject to mark the file bad. */
  run: (index: number) => Promise<void>
  /** How many files may be in flight at once. */
  concurrency?: number
  /** Called after the walk with the numbers to report. */
  onDone?: (stats: WalkStats) => void
}

/**
 * Walk `count` files, skipping any a previous run already covered, and record the
 * outcome of every file so the next run resumes instead of restarting.
 */
export async function resumableWalk(
  checkpointPath: string,
  count: number,
  opts: WalkOptions,
): Promise<WalkStats> {
  mkdirSync(dirname(checkpointPath), { recursive: true })
  const { done, bad } = loadCheckpoint(checkpointPath)

  const isDone = (i: number) => {
    const id = opts.id(i)
    return done.has(id) || bad.has(id)
  }

  // A file the checkpoint knows about but this run does not offer is history from a
  // wider earlier run. It does not count towards this run's total — the population is
  // what THIS run was offered — but it is worth knowing the walk is narrower than the
  // checkpoint, because that can silently shrink a sample between runs.
  let alreadyDone = 0
  const todo: number[] = []
  for (let i = 0; i < count; i++) {
    if (isDone(i)) alreadyDone++
    else todo.push(i)
  }

  const stats: WalkStats = {
    total: count,
    alreadyDone,
    walked: 0,
    skippedBad: bad.size,
    fresh: 0,
    partial: false,
    checkpoint: checkpointPath,
  }

  let cursor = 0
  let appendedSinceFlush = 0
  // Flush periodically so a kill costs at most this many files of re-walking, and so a
  // run that completes normally leaves a tidy checkpoint.
  const FLUSH_EVERY = 50
  const flush = () => {
    if (appendedSinceFlush === 0) return
    appendedSinceFlush = 0
  }

  const worker = async (): Promise<void> => {
    while (true) {
      const i = todo[cursor++]
      if (i === undefined) return
      const id = opts.id(i)
      try {
        await opts.run(i)
        stats.walked++
        appendFileSync(checkpointPath, `${id}\n`)
        appendedSinceFlush++
        if (appendedSinceFlush >= FLUSH_EVERY) flush()
      } catch {
        // Marked bad, not merely skipped: a re-run must not walk it again, or one
        // poison file re-destroys every future run.
        stats.skippedBad++
        appendFileSync(checkpointPath, `${MARK_BAD}${id}\n`)
        appendedSinceFlush++
      }
    }
  }

  const n = Math.max(1, opts.concurrency ?? 4)
  await Promise.all(Array.from({ length: n }, () => worker()))

  stats.partial = stats.skippedBad > 0 || stats.walked + stats.alreadyDone < count
  opts.onDone?.(stats)
  return stats
}

/** Start a checkpoint from scratch, discarding any history. */
export function resetCheckpoint(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "")
}

/** Read a checkpoint's contents, for reporting. */
export function readCheckpoint(path: string): { done: string[]; bad: string[] } {
  const { done, bad } = loadCheckpoint(path)
  return { done: [...done], bad: [...bad] }
}