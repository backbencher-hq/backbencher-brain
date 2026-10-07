/**
 * A crash-safe, resumable corpus walk — with an HONEST checkpoint.
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
 * ## What the first version of this file got wrong
 *
 * It recorded ONLY the success path:
 *
 *     await opts.run(i)
 *     appendFileSync(checkpointPath, `${id}\n`)
 *
 * That produced a checkpoint in which a file that was **never measured** is
 * indistinguishable from one that was. Concretely, `parseFile` does not reject when a
 * parse crashes — it catches the error, writes `[BB-PARSE-ERR]`, and returns
 * `extractFallback(...)`, i.e. REGEX extraction marked `fallback: true`. So a WASM trap
 * (`memory access out of bounds`) inside the analyzer produced a *successful* `run(i)`,
 * a plain `done` line, and — the part that makes this a measurement defect and not a
 * cosmetic one — its regex-derived edges were folded into the coverage table as
 * evidence that the ANALYZER emits that relationship.
 *
 * Measured on the dart corridor (2026-10-07): 33,692 admitted files, a trap named
 * `dart-sdk/tests/corelib/map_values3_test.dart`, and that exact path sitting in the
 * checkpoint as an ordinary done line. The population was reported as walked; the
 * analyzer had never seen the file.
 *
 * ## The design, now
 *
 * An APPEND-ONLY log, with the ATTEMPT recorded BEFORE the parse and the OUTCOME
 * recorded after. Append-only is the whole trick: a `process.exit()` inside a parse
 * cannot flush anything, so a marker written after the parse is a marker that may never
 * be written. Writing `>id` first means the log survives an arbitrary kill, and the
 * difference between the two writes tells the next run what happened:
 *
 *     `>id`   an attempt STARTED (written before the parse) — survives a hard kill
 *     `id`    finished, AND the real analyzer measured it
 *     `~id`   finished, but only the REGEX FALLBACK measured it (a crash was swallowed
 *             upstream) — a real outcome, not a success
 *     `!id`   abandoned: it has now killed this walk `maxAttempts` times, or it threw
 *
 * A file with `>` and no outcome is the file the process died on — the first version
 * could never name it. That is what makes a killed run resumable on EVIDENCE rather than
 * on luck, and it is why the file that kills the walk is now retried once before it is
 * called poison, instead of being retried forever (the old behaviour: a hard kill wrote
 * nothing, so the same file was re-walked, and re-killed, on every run).
 *
 * ## The rule this file follows
 *
 * `docs/M14-HONESTY-CONTRACT.md`: an instrument must declare the population it covered.
 * So every run reports total / already-done / walked / degraded / skipped-bad /
 * unfinished, and `partial` is TRUE whenever any file was degraded, any file was
 * abandoned, or the run covered less than it was offered. A resumed walk that silently
 * reports the same number as a complete one — or counts a regex fallback as the analyzer
 * firing — is the exact defect this file exists to end.
 *
 * A legacy checkpoint (one written before this format) has no header line, its `done`
 * lines are exactly the ambiguous kind described above, and it is therefore reported as
 * `untrustedHistory: true` rather than being silently trusted or silently discarded.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** What a single file's walk reported. Throwing means "abandon this file". */
export interface WalkOutcome {
  /**
   * The work completed, but NOT through the production path — e.g. `parseFile` returned
   * `fallback: true` because a crash was caught upstream and regex extraction stood in
   * for the analyzer. Recorded as `~id`: an outcome, never a success.
   */
  degraded?: boolean
  /** Free text, recorded beside the marker so a degraded file explains itself. */
  reason?: string
}

/** What the walk did, for the caller to report honestly. */
export interface WalkStats {
  /** Files offered to the walk. */
  total: number
  /**
   * Files an EARLIER run measured with the real analyzer, and this run therefore skipped.
   * Measured successes only — an abandoned or degraded file is in its own bucket, so the
   * buckets partition the population: `walked + degraded + alreadyDone + alreadyDegraded
   * + skippedBad === total` for a run that was not killed.
   */
  alreadyDone: number
  /** Offered files an earlier run recorded as degraded, and that have used their retries. */
  alreadyDegraded: number
  /** Actually measured by the real analyzer this run. */
  walked: number
  /** Finished, but only via a fallback path — see `WalkOutcome.degraded`. */
  degraded: number
  /**
   * Files abandoned: their parse threw, or they killed the walk `maxAttempts` times.
   * Counts the ones an earlier run abandoned AND the ones abandoned by this run, so it
   * is the population's abandoned total rather than a per-run delta.
   */
  skippedBad: number
  /** Files present this run but absent from the checkpoint's history entirely. */
  fresh: number
  /**
   * Files this run re-attempted that a previous run had left unfinished or degraded.
   * A non-zero value says the corpus contains something that kills or degrades a walk.
   */
  retried: number
  /**
   * Files that were in-flight (a `>` with no outcome) when the checkpoint was loaded —
   * i.e. the files the previous run died on. The first version of this walker could not
   * report this at all.
   */
  unfinishedFromPreviousRun: number
  /**
   * The checkpoint had NO format header, so it was written by the version that could not
   * tell a real parse from a swallowed crash. Its `done` lines were honoured (a forced
   * re-walk of every lane's corpus is not this file's call to make) but the population's
   * success/failure distinction is NOT verifiable from it.
   */
  untrustedHistory: boolean
  /**
   * True when this run did NOT cover every file it was offered at full fidelity — the
   * run was killed part-way, files were skipped as bad, or files were degraded. Callers
   * MUST surface this rather than reporting their counts as if the walk were complete.
   */
  partial: boolean
  /** Process RSS when the walk started and finished, in MB. */
  rssMbStart: number
  rssMbEnd: number
  /**
   * RSS growth per 1,000 files walked, in MB. Reported so "this instrument does not
   * retain memory per file" is a number on every run rather than a claim in a comment.
   */
  rssMbPerKFile: number
  /** Where the checkpoint lives, so a run can be explained after the fact. */
  checkpoint: string
}

/** Marker grammar. `>` attempt, `~` degraded, `!` abandoned, bare = measured. */
const MARK_ATTEMPT = ">"
const MARK_DEGRADED = "~"
const MARK_BAD = "!"
/** Format header. Its ABSENCE is the only thing that makes a checkpoint untrusted. */
const HEADER = "#bb-walk v2"

/**
 * How many times a file may be attempted before the walk calls it abandoned.
 *
 * Two: one attempt on whatever run first meets it, one retry in a FRESH process. The
 * retry matters because a WASM trap is frequently a symptom of accumulated state rather
 * than a property of the input — the same file parses cleanly in a new process — and
 * calling it poison on the first crash would blacklist a file the analyzer can read.
 */
const MAX_ATTEMPTS = 2

const rssMb = (): number => Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10

interface Checkpoint {
  /** Paths whose real analyzer measurement succeeded. */
  done: Set<string>
  /** Paths abandoned: proven to kill or throw. */
  bad: Set<string>
  /** Paths whose only outcome was a fallback measurement. */
  degraded: Set<string>
  /** Paths started but never finished — the files a previous run died on. */
  unfinished: Set<string>
  /** How many times each path was started. */
  attempts: Map<string, number>
  /** True when the file carried no format header. */
  untrustedHistory: boolean
  /** Every path the checkpoint mentions, for the `fresh` count. */
  known: Set<string>
}

/**
 * Load a checkpoint.
 *
 * Tolerant of a truncated final line, which is what a kill mid-append leaves behind.
 * Dropping one partial path costs one re-walk; refusing to start costs the whole run.
 */
function loadCheckpoint(path: string): Checkpoint {
  const cp: Checkpoint = {
    done: new Set(),
    bad: new Set(),
    degraded: new Set(),
    unfinished: new Set(),
    attempts: new Map(),
    untrustedHistory: true,
    known: new Set(),
  }
  if (!existsSync(path)) {
    cp.untrustedHistory = false // nothing to distrust: there is no history
    return cp
  }
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    cp.untrustedHistory = false
    return cp
  }

  // `bare` lines are only interpretable once the header is known, so collect first and
  // classify after: without a header a bare line is an unverifiable success.
  const bare: string[] = []
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith("#")) {
      if (t === HEADER) cp.untrustedHistory = false
      continue
    }
    const mark = t[0]
    if (mark === MARK_ATTEMPT || mark === MARK_DEGRADED || mark === MARK_BAD) {
      // The id is the FIRST tab-separated field: `appendMarker` writes the reason after a
      // tab, and a reader that took the whole rest of the line as the id would key every
      // reasoned marker under a name that never matches the caller's `id()` — measured
      // here as a degraded file whose attempt count never accumulated, so it was retried
      // on every run forever, and as an abandoned file that was not recognised as
      // abandoned at all. The tab is the delimiter precisely so this cannot be ambiguous.
      const id = t.slice(1).split("\t")[0]
      cp.known.add(id)
      if (mark === MARK_ATTEMPT) {
        cp.attempts.set(id, (cp.attempts.get(id) ?? 0) + 1)
      } else if (mark === MARK_BAD) {
        cp.bad.add(id)
        cp.unfinished.delete(id)
      } else {
        cp.degraded.add(id)
        cp.unfinished.delete(id)
      }
      continue
    }
    bare.push(t.split("\t")[0])
  }
  for (const id of bare) {
    cp.known.add(id)
    cp.done.add(id)
    cp.unfinished.delete(id)
  }
  // `unfinished` = started, with no terminal outcome of any kind.
  if (!cp.untrustedHistory) {
    for (const id of cp.attempts.keys()) {
      if (!cp.done.has(id) && !cp.bad.has(id) && !cp.degraded.has(id)) cp.unfinished.add(id)
    }
  }
  return cp
}

export interface WalkOptions {
  /** Stable identity for a file — usually the absolute path. */
  id: (index: number) => string
  /** Do the work. Resolve `{ degraded: true }` for a fallback measurement; reject to abandon. */
  run: (index: number) => Promise<void | WalkOutcome>
  /** How many files may be in flight at once. */
  concurrency?: number
  /** Attempts allowed before a file is called abandoned. Default 2. */
  maxAttempts?: number
  /** Called after the walk with the numbers to report. */
  onDone?: (stats: WalkStats) => void
}

/** A one-line record of what happened to a path, appended to the checkpoint. */
function appendMarker(checkpoint: string, marker: string, id: string, reason?: string): void {
  const suffix = reason ? `\t${reason.replace(/[\r\n\t]+/g, " ").slice(0, 200)}` : ""
  appendFileSync(checkpoint, `${marker}${id}${suffix}\n`)
}

/**
 * Walk `count` files, skipping any a previous run settled, and record the outcome of
 * every file so the next run resumes instead of restarting.
 */
export async function resumableWalk(
  checkpointPath: string,
  count: number,
  opts: WalkOptions,
): Promise<WalkStats> {
  mkdirSync(dirname(checkpointPath), { recursive: true })
  const rssMbStart = rssMb()
  const cp = loadCheckpoint(checkpointPath)
  if (!existsSync(checkpointPath)) writeFileSync(checkpointPath, `${HEADER}\n`)

  const maxAttempts = Math.max(1, opts.maxAttempts ?? MAX_ATTEMPTS)
  const seen = new Set<string>()
  const todo: number[] = []
  // The buckets PARTITION what this run was offered, so every file is accounted for in
  // exactly one of them and the numbers can be added up and checked against `total`.
  let alreadyDone = 0
  let alreadyDegraded = 0
  let skippedBad = 0
  let fresh = 0
  let retried = 0

  for (let i = 0; i < count; i++) {
    const id = opts.id(i)
    if (seen.has(id)) continue
    seen.add(id)
    if (!cp.known.has(id)) fresh++

    if (cp.done.has(id)) { alreadyDone++; continue }
    if (cp.bad.has(id)) { skippedBad++; continue }
    // Settled-degraded: it has already used its retries. Retrying it on every run would
    // never converge, and never saying so would hide it in the success column.
    if (cp.degraded.has(id) && (cp.attempts.get(id) ?? 0) >= maxAttempts) {
      alreadyDegraded++
      continue
    }
    // A file with no outcome at all that has already been attempted `maxAttempts` times
    // killed the process each time. That is evidence, and it is now written down — this is
    // the branch that turns "the walk dies on an unnamed file, forever" into a named,
    // counted, permanently-skipped file.
    if (cp.unfinished.has(id) && (cp.attempts.get(id) ?? 0) >= maxAttempts) {
      appendMarker(checkpointPath, MARK_BAD, id, `killed the walk ${maxAttempts} times`)
      skippedBad++
      continue
    }
    if (cp.attempts.has(id)) retried++
    todo.push(i)
  }

  const stats: WalkStats = {
    total: count,
    alreadyDone,
    alreadyDegraded,
    walked: 0,
    degraded: 0,
    skippedBad,
    fresh,
    retried,
    unfinishedFromPreviousRun: cp.unfinished.size,
    untrustedHistory: cp.untrustedHistory,
    partial: false,
    rssMbStart,
    rssMbEnd: rssMbStart,
    rssMbPerKFile: 0,
    checkpoint: checkpointPath,
  }

  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const i = todo[cursor++]
      if (i === undefined) return
      const id = opts.id(i)
      // Attempt BEFORE the parse: this is the only marker that survives a hard kill, and
      // without it the file the process dies on can never be identified.
      appendMarker(checkpointPath, MARK_ATTEMPT, id)
      try {
        const outcome = await opts.run(i)
        if (outcome && outcome.degraded) {
          // Not a success. Recorded as its own outcome so a caller cannot count a regex
          // fallback as the analyzer firing.
          stats.degraded++
          cp.attempts.set(id, (cp.attempts.get(id) ?? 0) + 1)
          appendMarker(checkpointPath, MARK_DEGRADED, id, outcome.reason)
        } else {
          stats.walked++
          cp.attempts.set(id, (cp.attempts.get(id) ?? 0) + 1)
          appendMarker(checkpointPath, "", id)
        }
      } catch (e) {
        // Abandoned, not merely skipped: a re-run must not walk it again, or one poison
        // file re-destroys every future run.
        stats.skippedBad++
        const reason = e instanceof Error ? e.message : String(e)
        appendMarker(checkpointPath, MARK_BAD, id, reason)
      }
    }
  }

  const n = Math.max(1, opts.concurrency ?? 4)
  await Promise.all(Array.from({ length: n }, () => worker()))

  stats.rssMbEnd = rssMb()
  const measured = stats.walked + stats.degraded
  stats.rssMbPerKFile = measured > 0 ? Math.round(((stats.rssMbEnd - stats.rssMbStart) / (measured / 1000)) * 10) / 10 : 0
  // A walk is partial if anything about it is short of "every offered file, measured by
  // the real analyzer". A degraded or abandoned file is short of that even when the run
  // reached the last file, because it is in the population and the analyzer did not read
  // it — that is the distinction the first version of this file could not express.
  const accounted = measured + stats.alreadyDone + stats.alreadyDegraded + stats.skippedBad
  stats.partial = stats.skippedBad > 0 || stats.degraded > 0 || stats.alreadyDegraded > 0 || accounted < count
  opts.onDone?.(stats)
  return stats
}

/** Start a checkpoint from scratch, discarding any history. */
export function resetCheckpoint(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${HEADER}\n`)
}

/** Read a checkpoint's contents, for reporting. */
export function readCheckpoint(path: string): {
  done: string[]
  bad: string[]
  degraded: string[]
  unfinished: string[]
  untrustedHistory: boolean
} {
  const cp = loadCheckpoint(path)
  return {
    done: [...cp.done],
    bad: [...cp.bad],
    degraded: [...cp.degraded],
    unfinished: [...cp.unfinished],
    untrustedHistory: cp.untrustedHistory,
  }
}
