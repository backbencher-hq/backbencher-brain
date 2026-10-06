/**
 * Live progress rendering for `bb index`.
 *
 * Why this exists
 * ---------------
 * The previous implementation wrote one `\r`-prefixed line per update. That is
 * correct ONLY on a real TTY. When stdout/stderr is a pipe, a file, or a CI log,
 * `\r` does not erase anything, so every throttled update appended to the same
 * physical line and the log filled with a single unreadable smear of repeated
 * `[progress]` fragments — the "endless lines" users reported.
 *
 * This module renders to the terminal when there is one, and degrades to sparse,
 * newline-delimited, timestamped progress lines when there is not. Non-TTY output
 * is additionally rate-limited by *percentage milestones* rather than by a fixed
 * interval, so a long run cannot produce unbounded log volume.
 *
 * It also owns the human-facing framing the product promises:
 *   - an elapsed clock that starts the moment indexing starts
 *   - live counts of what has been collected so far
 *   - a size-appropriate expectation ("a moment", "a few minutes", "grab a coffee")
 *   - a completion summary, and a support escalation hint when a run is slow
 */

// A file count below this is effectively instant; we say so rather than showing
// a spinner the user never needed to see.
const SMALL_PROJECT_FILES = 150
// Above this, indexing is long enough that the user needs to be told it is normal
// and that they are expected to wait rather than assume the process is hung.
const BIG_PROJECT_FILES = 4000
// A run slower than this (and not already reported as a failure) is the point
// where a user is most likely to suspect a hang. Nudge them to report it.
const SLOW_RUN_MS = 3 * 60 * 1000

export const SUPPORT_EMAIL = "support@backbencher.cc"

/**
 * Encouragement that tracks how close the run is to finishing.
 *
 * The single up-front expectation ("grab a coffee") is right when it is printed
 * and wrong for the following hour: it tells a user watching 4,000 of 8,000
 * files that this takes a while, which is precisely when they most need to be
 * told it is nearly done. Announced once per band, so it reads as progress
 * rather than nagging — and so it never overwrites the live bar's own line.
 *
 * Bands are keyed on completion percentage, not file counts, so the wording
 * tracks the run the user is actually watching.
 */
export function encouragementFor(pct: number, isBigProject: boolean): string | null {
  if (pct >= 100) return null
  if (pct >= 95) return "almost there — finishing up"
  if (pct >= 80) return "in the final stretch"
  if (pct >= 50) return "past the halfway mark"
  if (pct >= 25) return "a quarter of the way in"
  // Only the long-run projects get the "go away" line, and only at the start —
  // telling a small project to grab a coffee would be absurd.
  if (isBigProject && pct < 10) return null
  return null
}

/** How many files a file count represents, for choosing the big-project tone. */
export function isBigProject(totalFiles: number): boolean {
  return totalFiles >= BIG_PROJECT_FILES
}

export interface IndexProgressStats {
  processedFiles: number
  totalFiles: number
  skippedFiles?: number
  errorFiles?: number
  currentFile?: string
  filesPerSecond?: number
  elapsedSeconds?: number
  // Live tallies, when the indexer can supply them mid-run.
  symbols?: number
  relationships?: number
  embeddings?: number
}

export interface IndexProgressOptions {
  stream: NodeJS.WriteStream
  isTTY: boolean
  startedAt: number
  totalFiles: number
  /** Non-TTY logs get a milestone line at most this often. */
  nonTtyIntervalMs?: number
}

/** Human-readable duration. `null`/negative input yields "…". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "…"
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * What the user should expect up front, based on project size. Used as a single
 * reassuring line rather than repeated nagging.
 */
export function expectationFor(totalFiles: number): string {
  if (totalFiles <= 0) return "nothing to index — the index is already up to date"
  if (totalFiles < SMALL_PROJECT_FILES) return "this is a small project — a few minutes at most"
  if (totalFiles < BIG_PROJECT_FILES) return "this will take a few minutes"
  return "large project — this takes a while. Grab a coffee; bb keeps working in the background"
}

function countWithCommas(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "?"
  return n.toLocaleString()
}

/** Remaining-time estimate from observed throughput. "…" until it is knowable. */
export function estimateRemainingMs(stats: IndexProgressStats, startedAt: number): number | null {
  const { processedFiles, totalFiles } = stats
  if (!totalFiles || processedFiles <= 0) return null
  const elapsed = Date.now() - startedAt
  if (elapsed < 1000) return null // too little signal to be honest about
  const remaining = totalFiles - processedFiles
  if (remaining <= 0) return 0
  return (elapsed / processedFiles) * remaining
}

export class IndexProgressRenderer {
  private readonly stream: NodeJS.WriteStream
  private readonly isTTY: boolean
  private readonly startedAt: number
  private totalFiles: number
  private readonly nonTtyIntervalMs: number
  private lastRenderAt = 0
  private lastNonTtyBucket = -1
  private lastLineLength = 0
  private announcedExpectation = false
  private lastEncouragementBand = -1

  constructor(opts: IndexProgressOptions) {
    this.stream = opts.stream
    this.isTTY = opts.isTTY
    this.startedAt = opts.startedAt
    this.totalFiles = opts.totalFiles
    this.nonTtyIntervalMs = opts.nonTtyIntervalMs ?? 10_000
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt
  }

  /** One-time framing line once the file count is known. */
  begin(): void {
    if (this.announcedExpectation) return
    const expected = expectationFor(this.totalFiles)
    this.announcedExpectation = true
    this.stream.write(`\nIndexing ${countWithCommas(this.totalFiles)} files — ${expected}\n\n`)
  }

  /**
   * Render a progress update. Safe to call very frequently; throttling is
   * internal and differs between TTY and non-TTY.
   */
  update(stats: IndexProgressStats): void {
    // The project size is not known before the scan starts, so the expectation
    // line is emitted on the first real sample rather than up front. Announcing
    // it once (rather than per-update) keeps it a reassurance instead of noise.
    if (!this.announcedExpectation && stats.totalFiles > 0) {
      this.totalFiles = stats.totalFiles
      this.begin()
    }
    this.maybeEncourage(stats)
    if (this.isTTY) {
      const now = Date.now()
      if (now - this.lastRenderAt < 80) return // smooth, cheap, ~12fps
      this.lastRenderAt = now
      this.renderTtyLine(stats)
      return
    }
    this.renderNonTtyLine(stats)
  }

  /**
   * Print a progress milestone at most once per band. Written ABOVE the live bar
   * so it does not fight the redraw for the same line.
   */
  private maybeEncourage(stats: IndexProgressStats): void {
    const total = stats.totalFiles > 0 ? stats.totalFiles : this.totalFiles
    if (total <= 0) return
    const done = stats.processedFiles + (stats.skippedFiles ?? 0)
    const pct = Math.min(100, Math.floor((done / total) * 100))
    const line = encouragementFor(pct, isBigProject(total))
    if (!line) return
    // One announcement per band, identified by which band the run is in.
    const band = pct >= 95 ? 95 : pct >= 80 ? 80 : pct >= 50 ? 50 : pct >= 25 ? 25 : 0
    if (band === this.lastEncouragementBand) return
    this.lastEncouragementBand = band
    if (this.isTTY) {
      // Clear the bar, print the note, and let the next update redraw it.
      this.stream.write(`\r\x1b[2K  ${line}\n`)
      this.lastLineLength = 0
    } else {
      this.stream.write(`[index] ${line}\n`)
    }
  }

  private renderTtyLine(stats: IndexProgressStats): void {
    const total = stats.totalFiles > 0 ? stats.totalFiles : this.totalFiles
    const done = stats.processedFiles + (stats.skippedFiles ?? 0)
    const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0
    const rate = typeof stats.filesPerSecond === "number" ? `${stats.filesPerSecond.toFixed(1)}/s` : "?"
    const remaining = estimateRemainingMs(stats, this.startedAt)
    const eta = remaining === null ? "…" : formatDuration(remaining)
    const elapsed = formatDuration(this.elapsedMs)

    // Fixed-width bar so the line does not jitter as digits change width.
    const BAR = 24
    const filled = total > 0 ? Math.round((pct / 100) * BAR) : 0
    const bar = "█".repeat(filled) + "░".repeat(BAR - filled)

    const parts = [
      `  ${bar} ${String(pct).padStart(3)}%`,
      `${countWithCommas(done)}/${countWithCommas(total)} files`,
      rate,
      `elapsed ${elapsed}`,
      `ETA ${eta}`,
    ]
    if (stats.symbols !== undefined) parts.push(`${countWithCommas(stats.symbols)} symbols`)
    if (stats.relationships !== undefined) parts.push(`${countWithCommas(stats.relationships)} rels`)
    if (stats.embeddings !== undefined) parts.push(`${countWithCommas(stats.embeddings)} embeddings`)

    let line = parts.join("  ")
    if (stats.errorFiles) line += `  ⚠ ${stats.errorFiles} errors`
    if (stats.currentFile) {
      // Keep the tail short; long absolute paths would wrap and break the erase.
      const f = stats.currentFile.length > 48 ? "…" + stats.currentFile.slice(-47) : stats.currentFile
      line += `  ${f}`
    }
    this.writeTty(line)
  }

  private writeTty(line: string): void {
    // Erase the previous line completely, then write. Padding guards against a
    // shorter line leaving the tail of a longer previous line visible.
    const pad = this.lastLineLength > line.length ? " ".repeat(this.lastLineLength - line.length) : ""
    this.stream.write(`\r\x1b[2K${line}${pad}`)
    this.lastLineLength = line.length + pad.length
  }

  /**
   * Non-TTY: emit a milestone line, not a redraw. Bucket by completion percentage
   * AND by wall-clock, so neither a very long run nor a stalled run floods the log.
   */
  private renderNonTtyLine(stats: IndexProgressStats): void {
    const total = stats.totalFiles > 0 ? stats.totalFiles : this.totalFiles
    if (total <= 0) return
    const done = stats.processedFiles + (stats.skippedFiles ?? 0)
    const pct = Math.min(100, Math.floor((done / total) * 100))
    const bucket = Math.floor(pct / 5) // one line per 5% of completion
    const now = Date.now()
    const dueByBucket = bucket > this.lastNonTtyBucket
    const dueByTime = now - this.lastRenderAt >= this.nonTtyIntervalMs
    // Only the very last milestone is always worth logging.
    const isFinal = pct >= 100
    if (!isFinal && !dueByBucket && !dueByTime) return
    if (bucket === this.lastNonTtyBucket) return

    this.lastNonTtyBucket = bucket
    this.lastRenderAt = now
    const remaining = estimateRemainingMs(stats, this.startedAt)
    const eta = remaining === null ? "…" : formatDuration(remaining)
    this.stream.write(
      `[index] ${pct}% ${countWithCommas(done)}/${countWithCommas(total)} files` +
        ` elapsed=${formatDuration(this.elapsedMs)} eta=${eta}` +
        (stats.errorFiles ? ` errors=${stats.errorFiles}` : "") +
        `\n`,
    )
  }

  /** Clear the live line before the summary prints. */
  clear(): void {
    if (this.isTTY) {
      this.stream.write("\r\x1b[2K")
      this.lastLineLength = 0
    }
  }

  /**
   * Post-run messaging. `ok: false` means the run failed — we do not congratulate
   * the user or suggest a support ticket for a run that did not finish.
   */
  finish(result: { ok: boolean; totalFiles: number; errorCount?: number; cancelled?: boolean }): void {
    this.clear()
    const elapsed = this.elapsedMs
    if (!result.ok) return

    const mins = elapsed / 60_000
    if (mins >= 5) {
      this.stream.write(
        `\nThat took ${formatDuration(elapsed)} — longer than we expect.\n` +
          `If it felt like it hung, that is worth reporting: ${SUPPORT_EMAIL}\n`,
      )
    } else if (elapsed >= SLOW_RUN_MS) {
      this.stream.write(
        `\nTook ${formatDuration(elapsed)}.\n` +
          `If this is slower than usual for your project, tell us: ${SUPPORT_EMAIL}\n`,
      )
    }
  }

  /** Exposed for the CLI's "nothing to do" fast path. */
  get didAnnounce(): boolean {
    return this.announcedExpectation
  }
}