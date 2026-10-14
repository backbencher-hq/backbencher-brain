// live-rate-series.ts — the `files/s` the CLI renders WHILE an index is in
// flight, captured as a series instead of inferred from the total.
//
// WHY THIS EXISTS: the progress line's rate is
//
//     fps = processedFiles / (now - startTime)
//
// (src/ast/parallel-indexer.ts, the pool's progress callback — and the same
// sample `bb status` prints from the live status file). Both terms move, so the
// number is a *running average over the whole run*: it climbs through the parse
// as the pool saturates, peaks when the last file is stored, and then decays
// through the derived pass — resolution, enrichment, gravity, taint, health,
// ANALYZE — where `processedFiles` no longer grows but the clock does. The last
// thing a reader sees is therefore not a parse rate, and the whole-run
// files/s printed by `docs/indexing/performance.md` arithmetic is lower than
// anything the bar showed.
//
// Measuring that from the totals cannot separate the two effects. This captures
// the actual rendered line, so "the rate fell" can be attributed to the tail
// rather than to a slowdown in parsing.
//
// Usage:
//   npx tsx script/perf/live-rate-series.ts --repo <dir> [--data-dir <dir>]
//   npx tsx script/perf/live-rate-series.ts --parse <typescript-file>
//
//   --repo   run `bb index` on <dir> under a PTY (via `script(1)`) and parse the
//            transcript; fresh data dir by default, so nothing is incremental
//   --parse  parse an existing `script(1)` transcript (no run)
//
// The PTY is load-bearing: the renderer is TTY-gated (src/cli/index-progress.ts),
// so a redirected run prints no rate at all. A PTY also makes the CLI's first-run
// embedding prompt reachable, and that prompt blocks on a pty with no input —
// this writes the "skip" answer, which is what a non-TTY run takes silently.
//
// Prints one JSON object on stdout. Nothing here is a gate; the bounded
// scaling claim is script/perf/verify-scaling-linear.ts.

import fs from "fs"
import os from "os"
import path from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "node:url"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

interface Sample {
  tSec: number | null
  done: number
  total: number
  rate: number
}

/** The rendered progress line, e.g.
 *  `  ████░░ 12%  321/2581 files  18.9/s  elapsed 17s  ETA 2m 1s  3,190 symbols`.
 *  Matched on the stable middle of the line: counts, rate, elapsed. */
const LINE_RE = /(\d[\d,]*)\/(\d[\d,]*) files\s+([\d.]+|[\d.]+)s?\/s\s+elapsed\s+((?:\d+m\s+)?[\d.]+s)/

function toSeconds(label: string): number | null {
  const m = label.match(/(?:(\d+)m\s+)?([\d.]+)s/)
  if (!m) return null
  return Number(m[1] ?? 0) * 60 + Number(m[2])
}

function seriesFrom(transcript: string): { series: Sample[]; summary: string | null; rawLines: number } {
  const lines = transcript
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const series: Sample[] = []
  for (const line of lines) {
    const m = line.match(LINE_RE)
    if (!m) continue
    series.push({
      done: Number(m[1].replace(/,/g, "")),
      total: Number(m[2].replace(/,/g, "")),
      rate: Number(m[3]),
      tSec: toSeconds(m[4]),
    })
  }
  const summary = lines.filter((l) => /indexed [\d,]+ files/.test(l)).slice(-1)[0] ?? null
  return { series, summary, rawLines: lines.length }
}

function summarise(series: Sample[], summary: string | null, extra: Record<string, unknown> = {}) {
  const peak = series.reduce<Sample | null>((a, b) => (a === null || b.rate > a.rate ? b : a), null)
  const last = series.length ? series[series.length - 1] : null
  const parsed = summary?.match(/indexed ([\d,]+) files.*in ([\d.]+)s/)
  const wholeRun = parsed ? Number(parsed[1].replace(/,/g, "")) / Number(parsed[2]) : null
  return {
    ...extra,
    progressLines: series.length,
    first: series[0] ?? null,
    peak,
    last,
    // The two numbers that make the shape legible: what the bar peaked at while
    // the pool was saturated, and what the run as a whole achieved.
    peakRate: peak?.rate ?? null,
    peakAtSec: peak?.tSec ?? null,
    parseEndRate: last?.rate ?? null,
    wholeRunFilesPerSec: wholeRun === null ? null : Number(wholeRun.toFixed(3)),
    ratioPeakToWholeRun: peak && wholeRun ? Number((peak.rate / wholeRun).toFixed(3)) : null,
    summary,
    series,
  }
}

function parseOnly(file: string) {
  const transcript = fs.readFileSync(file, "utf8")
  const { series, summary, rawLines } = seriesFrom(transcript)
  return summarise(series, summary, { mode: "parse", file, rawLines })
}

function runUnderPty(repo: string, dataDir: string | undefined) {
  const which = spawnSync("bash", ["-lc", "command -v script"], { encoding: "utf8" })
  if (which.status !== 0) {
    console.error("live-rate-series: `script(1)` not found on PATH; use --parse on a transcript instead")
    process.exit(2)
  }
  const abs = path.resolve(repo)
  const dd = dataDir ? path.resolve(dataDir) : path.join(os.tmpdir(), `bb-live-rate-${path.basename(abs)}-${Date.now()}`)
  fs.mkdirSync(dd, { recursive: true })
  const raw = path.join(os.tmpdir(), `bb-live-rate-${path.basename(abs)}-${Date.now()}.raw`)
  const cmd = `node bin/bb index '${abs}' --no-setup`
  // BSD `script` (macOS) takes the file before the command; util-linux takes the
  // command with -c. Both are invoked with a PTY, which is the point.
  const args = process.platform === "darwin" ? ["-q", raw, ...cmd.split(" ")] : ["-q", "-c", cmd, raw]
  // The "skip embedding setup" answer: on a PTY with no input the first-run
  // wizard blocks forever, and a non-TTY run takes this path silently.
  const res = spawnSync("script", args, {
    cwd: REPO_ROOT,
    input: "4\n",
    stdio: ["pipe", "ignore", "ignore"],
    env: { ...process.env, BB_DATA_DIR: dd, BB_LOG_LEVEL: "warn" },
  })
  const transcript = fs.existsSync(raw) ? fs.readFileSync(raw, "utf8") : ""
  const { series, summary, rawLines } = seriesFrom(transcript)
  return summarise(series, summary, {
    mode: "run",
    repo: abs,
    dataDir: dd,
    transcript: raw,
    rawLines,
    scriptExit: res.status,
  })
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const repo = arg("--repo")
const parseFile = arg("--parse")
if (!repo && !parseFile) {
  console.error("usage: live-rate-series.ts --repo <dir> [--data-dir <dir>] | --parse <typescript-file>")
  process.exit(2)
}
const out = repo ? runUnderPty(repo, arg("--data-dir")) : parseOnly(parseFile!)
console.log(JSON.stringify(out, null, 1))
