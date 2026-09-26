#!/usr/bin/env bun
/**
 * M60 — the oracle's SHARPNESS, measured on every lane instead of assumed.
 *
 * WHAT THIS IS. The differential's coverage match is `label + normTarget(target)`,
 * and `normTarget` is the LAST SEGMENT — the qualifier is discarded. So a truth row
 * is satisfiable by an analyzer edge that merely shares its leaf. That is not a
 * thought experiment: the groovy anonymous-body defect (d6a7cd89) was PUBLISHED as
 * `MISSING=2` when **4** rows were missing, because the truth's
 * `anonymous_IdentityTypeDecoder.decode -> IdentityTypeDecoder.decode` was matched
 * by the analyzer's `IdentityDecoder.decode -> PropertyDecoder.decode`. One call to
 * `lastSegment` threw away both the owner and the difference.
 *
 * `BB_F5_STRICT=1` makes the differential re-match each file's truth rows on the
 * target AS WRITTEN (generics/args stripped, qualifier KEPT) and report the rows the
 * published rule PASSES anyway. This script drives that flag across the family, at
 * FULL EXTENT, and writes one row per lane.
 *
 * WHY A SWEEP AND NOT 25 FIXTURES. `MISSING=0` is a claim about a corpus, not about
 * a shape, and it is the claim every lane's F5 row rests on. A fixture cannot make
 * it; only re-reading the corpus under a sharper rule can. Java and groovy were
 * measured first (reviews/m60-oracle-sharpness.md) and both read zero — a result
 * that is only worth having because the instrument is falsified before it is
 * believed: `--selftest` reproduces the groovy 2-vs-4 arithmetic on the published
 * rule's own predicate, and the invariants below are asserted per repo at runtime.
 *
 * THE THREE IDENTITIES (printed as STRICT-INVARIANT BREACH when they fail — an
 * instrument that cannot fail is not evidence):
 *   A  covered-as-written + strict-missing == truth
 *   B  strict-missing − hidden == the PUBLISHED missing count for the same corpus
 *      (a strict miss with no same-leaf analyzer row is by definition a row the
 *       published rule also missed, so the two counts must agree exactly)
 *   C  hard <= hidden
 *
 * VERDICTS. `hard` is the shape the groovy defect had: the rule matched a DIFFERENT
 * qualified target. `soft` is a spelling asymmetry (one side qualified, the other
 * bare) — a CONTRACT question, not automatically a defect, and counted separately so
 * a lane that legitimately publishes bare targets is not libelled as hiding rows.
 *
 * FINGERPRINTING, because this tree is edited by several actors at once. Every row
 * carries the digest of the IMPORT CLOSURE it actually reads — the harness's closure,
 * the lane's analyzer closure, the lane's grammar binary — sampled BEFORE and AFTER
 * the lane; a lane whose inputs moved mid-run is recorded `tree-moved` and never
 * counted as measured. The identity is a property of the BYTES, not of the commit:
 * keying it on HEAD (the first version of this script did) discarded the javascript row
 * while its own inputs never changed, because an unrelated commit had landed somewhere
 * in the tree. A lane whose closure contains a dirty file is marked `dirty` and can
 * never be cited as re-derivable.
 *
 * CITING IT. The state is a working file in $TMPDIR, so no gate may read it; `--emit`
 * writes the cited form to validation/m60/results/oracle-sharpness.json, and it
 * publishes a lane only when that lane's row is a measurement OF THIS TREE — the
 * closure digest must equal the digest it was measured at, no closure input may be
 * dirty, and the verdict must be citable. Every other lane is listed in `refused`
 * with its reason, and `complete` is true only when every lane published: an
 * incomplete artefact says so rather than looking finished. The completion matrix
 * reads this file for its `sharp` column, so a lane whose published (leaf) rule hid
 * rows cannot be reported as done.
 *
 * CLI:
 *   bun script/m60/verify-oracle-sharpness.ts --full            # measure every lane not yet measured
 *   bun script/m60/verify-oracle-sharpness.ts --lang java,scala # measure named lanes, merge into state
 *   bun script/m60/verify-oracle-sharpness.ts --report          # print the table, run nothing
 *   bun script/m60/verify-oracle-sharpness.ts --emit            # write the citable artefact (refuses per lane, never per run)
 *   bun script/m60/verify-oracle-sharpness.ts --selftest        # the instrument's own negatives
 *
 * State: $BB_M60_OS_STATE, default $TMPDIR/m60-oracle-sharpness.json (a working
 * file, NOT evidence — `--emit` is what turns a measurement into evidence).
 *
 * WHAT KILLED THE FIRST SWEEP, because the fix has to be the real cause. It died at
 * lane 9 of 25 with "a [strict] line with no repo line above it". The [strict] line
 * was real and its repo line was real: `[svelte] svelte: files=4456 … covered=3189
 * (99.9%) …`. REPO_RE demanded `\((\d+)%\)` — an INTEGER percentage — and the
 * harness prints coverage as a decimal the moment it is not whole, so the repo line
 * was invisible, the strict line was orphaned, and the parser threw. Nothing about the
 * lane was wrong: the instrument could not read its own harness's output for a
 * non-integer, and the row it lost (svelte, truth 3,193, MISSING 4) was a real result.
 * The first hypothesis ("another sweep truncated the log") was FALSIFIED by reading the
 * log and testing the pattern: the same bytes fail in a private log directory with no
 * other run alive. The parser now reads decimals, and a repo line it still cannot read
 * is a `parseError`, never silence.
 *
 * CONCURRENCY, hardened anyway: a shared state and log directory is a real hazard even
 * though it was not this crash (the log's lane timestamps overlap, which two
 * processes explain and one sequential loop does not). Logs live in a PER-RUN
 * directory (`m60-os-logs/<run>/<lane>.log`, run = pid + base36 clock) and a
 * measuring run takes a lock. Three properties make the class survivable, each
 * falsified in `--selftest`:
 *   (1) an unreadable lane log is a `parseError`, not a throw: the lane is recorded
 *       `instrument-breach` (uncitable, re-measured by the next `--full`) while the
 *       sweep continues;
 *   (2) a measuring run takes a lock (`<state>.lock`) and REFUSES to start while
 *       another live sweep holds it — a lock whose holder is gone, or whose pid was
 *       recycled by an unrelated process, is reclaimed with a printed note;
 *   (3) every progress line carries the run id, so a log written by two runs can be
 *       told apart instead of being read as one non-monotonic timeline.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { LANGS, normTarget, strictKey, strictTargetText, qualifierOf, sharpnessInvariants } from "../m14/differential"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const DIFFERENTIAL = path.join(ROOT, "script", "m14", "differential.ts")
const STATE = process.env.BB_M60_OS_STATE ?? path.join(os.tmpdir(), "m60-oracle-sharpness.json")
// The run id: this process's pid plus a base36 clock, so two sweeps started in the same
// second still differ. It names this run's log directory, the lock, and every progress
// line — the three places a concurrent run used to be invisible.
const RUN = process.env.BB_M60_OS_RUN ?? `${process.pid.toString(36)}-${Date.now().toString(36)}`
const LOG_DIR = path.join(path.dirname(STATE), "m60-os-logs", RUN)
const LOCK = `${STATE}.lock`
// A PRIVATE cold pool: the sweep draws a whole corpus, so rotation is irrelevant to
// its counts, but sharing a pool with another agent's runs would make the two runs
// race on the same journal file.
const WORK = process.env.BB_M60_OS_WORK ?? path.join(os.tmpdir(), "m60-os-work")
const SAMPLE = "100000"

const LANE_ORDER = Object.keys(LANGS)

const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex").slice(0, 16)
const shaFile = (p: string) => { try { return sha(fs.readFileSync(p)) } catch { return "absent" } }
/**
 * git, WITHOUT trimming its stdout. Porcelain v1 is `XY<space>path` per line, and the
 * leading space of the FIRST line is data: trimming the whole output ate it, so every
 * dirty-path message named its first file one character short (`src/ast/...` was
 * reported as `rc/ast/...` — measured on the typescript row of this sweep). The count
 * was right, which is why nothing else moved; the message sent a reader to a path that
 * does not exist. Consumers trim what they need.
 */
const git = (args: string[]) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout ?? ""

/** Porcelain v1 -> paths. The status prefix is two characters plus one space, sliced
 *  (never trimmed) per line; blank lines are an artefact of the trailing newline. */
export function porcelainPaths(stdout: string): string[] {
  return stdout.split("\n").filter(Boolean).map((l) => l.slice(3).trim())
}

/** The lane's IMPORT CLOSURE — the files whose content the measurement actually
 *  reads. HEAD is NOT part of the identity: this tree is edited by several actors
 *  at once, so keying on the commit made every lane `tree-moved` the moment an
 *  unrelated commit landed anywhere (measured: the javascript lane's first row was
 *  discarded that way while its own inputs never changed). What makes a row
 *  re-derivable is that these bytes are the same, which is a property of the files,
 *  not of the commit graph. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.json`, path.join(base, "index.ts")]) {
    try { if (fs.statSync(cand).isFile()) return cand } catch { /* keep looking */ }
  }
  return null
}
export function closure(entry: string, seen = new Set<string>()): Set<string> {
  const abs = path.resolve(entry)
  if (seen.has(abs)) return seen
  seen.add(abs)
  let src = ""
  try { src = fs.readFileSync(abs, "utf8") } catch { return seen }
  for (const m of src.matchAll(/(?:from|import|import\(|require\()\s*["']([^"']+)["']/g)) {
    const r = resolveImport(abs, m[1])
    if (r) closure(r, seen)
  }
  return seen
}

/** The inputs one lane's row depends on: the harness's own closure, the lane's
 *  analyzer closure, and the lane's grammar binary. Sampled before and after. */
function fingerprint(lang: string) {
  const cfg = (LANGS as any)[lang] as { analyzerFile: string; wasm: string } | undefined
  const files = new Set<string>([...closure(DIFFERENTIAL)])
  if (cfg?.analyzerFile) for (const f of closure(path.join(ROOT, "src", "ast", `${cfg.analyzerFile}.ts`))) files.add(f)
  const wasm = cfg?.wasm ? path.join(ROOT, "wasm", cfg.wasm) : null
  const inputs = [...files].map((f) => path.relative(ROOT, f)).sort()
  const digests = inputs.map((rel) => `${rel}:${shaFile(path.join(ROOT, rel))}`)
  if (wasm) digests.push(`wasm/${path.basename(wasm)}:${shaFile(wasm)}`)
  const dirty = porcelainPaths(git(["status", "--porcelain", "--", ...inputs]))
  const head = git(["rev-parse", "HEAD"]).trim()
  return {
    head,
    headShort: head.slice(0, 8),
    inputs: inputs.length + (wasm ? 1 : 0),
    digest: sha(digests.join("\n")),
    dirty,
    dirtyInputs: dirty.length,
  }
}
const fpKey = (f: ReturnType<typeof fingerprint>) => f.digest

interface RepoRow {
  repo: string
  files: number
  truth: number
  publishedCovered: number
  publishedMissing: number
  analyzerEdges: number
  unexplained: number
  strictCovered: number
  strictMissing: number
  hidden: number
  hard: number
  soft: number
  hash: string
}
interface LaneRow {
  lang: string
  /** Which run measured it (pid+clock). Two sweeps sharing one state used to be
   *  indistinguishable in the record; a row that cannot name its run cannot be
   *  ordered against another run's rows. */
  run: string
  /** Set when the lane's log could not be read as this parser's own output. Such a row
   *  is `instrument-breach` and never cites: no count is derived from it. */
  parseError: string | null
  at?: string
  measuredAt: ReturnType<typeof fingerprint>
  after: ReturnType<typeof fingerprint> | null
  durationMs: number
  log: string
  repos: RepoRow[]
  breaches: string[]
  hardSamples: string[]
  softSamples: string[]
  stdoutTail: string[] | null
  verdict: string
}

// Coverage is printed as a DECIMAL when it is not whole: the pattern's `(\d+)%`
// refused `(99.9%)`, the svelte repo line became invisible, and the sweep died at lane
// 9 of 25 blaming an orphan [strict] line. A percentage is decoration — the counts are
// read by name — so it is matched as a number, not as an integer.
const REPO_RE = /^\[([^\]]+)\] ([a-z0-9_]+): files=(\d+) tree-truth=(\d+) covered=(\d+) \((\d+(?:\.\d+)?)%\) MISSING=(\d+) \| analyzer-edges=(\d+) unexplained=(\d+) \((\d+(?:\.\d+)?)%\) heuristic=(\d+) hash=([0-9a-f]+)/
/** The SHAPE of a repo line, without the fields: used to prove that a line the strict
 *  pattern cannot read is reported as a PARSER failure, not as a lane that has no repo
 *  line. Without this, an unreadable repo line silently becomes "there was no repo line
 *  here" — the exact sentence this instrument shipped when it lost a sweep. */
const LOOSE_REPO_RE = /^\[[^\]]+\] [a-z0-9_]+: files=\d+ tree-truth=\d+/
const STRICT_RE = /^\s+\[strict\] ([a-z0-9_]+): truth=(\d+) covered-as-written=(\d+) strict-missing=(\d+) hidden=(\d+) hard=(\d+) soft=(\d+)\s+\(published rule: covered=(\d+) missing=(\d+)\)/
const HOLD_RE = /^\s+\[strict\] ([a-z0-9_]+): identities hold/
const BREACH_RE = /STRICT-INVARIANT BREACH ([a-z0-9_]+): (.+)$/

export function parseLane(lang: string, log: string): { repos: RepoRow[]; breaches: string[]; hardSamples: string[]; softSamples: string[]; parseError: string | null } {
  const repos: RepoRow[] = []
  const breaches: string[] = []
  const hardSamples: string[] = []
  const softSamples: string[] = []
  let pending: RepoRow | null = null
  for (const line of log.split("\n")) {
    const r = REPO_RE.exec(line)
    if (r) {
      pending = {
        repo: r[1], files: +r[3], truth: +r[4], publishedCovered: +r[5], publishedMissing: +r[7],
        analyzerEdges: +r[8], unexplained: +r[9], hash: r[12],
        strictCovered: 0, strictMissing: 0, hidden: 0, hard: 0, soft: 0,
      }
      repos.push(pending)
      continue
    }
    if (LOOSE_REPO_RE.test(line)) {
      // Fail closed with a message that names the parser, not the lane: the line LOOKS
      // like a repo row and the strict pattern refused it, so no count in this log can
      // be trusted to be complete (a missing repo row silently drops its whole corpus
      // from the lane's totals).
      return {
        repos, breaches, hardSamples, softSamples,
        parseError: `a repo line matches this log's shape but not this parser's field pattern — the missing field is the parser's, not the lane's: ${line.trim().slice(0, 160)}`,
      }
    }
    const s = STRICT_RE.exec(line)
    if (s) {
      if (!pending) {
        // FAIL CLOSED, BUT NOT FAIL-THE-SWEEP (measured 2026-09-25): a concurrent run
        // truncated this lane's log, the orphan check threw, and a 25-lane sweep died at
        // lane 9 — losing the other 16 lanes' measurements to one unreadable file. The
        // refusal is the same (no row is fabricated from this log); the blast radius is
        // one lane, and the next `--full` re-measures it, because an `instrument-breach`
        // verdict is uncitable by construction.
        return {
          repos, breaches, hardSamples, softSamples,
          parseError: `a [strict] line with no repo line above it — the log is not the one this parser reads: ${line.trim().slice(0, 140)}`,
        }
      }
      // GROUPS: 2 truth, 3 covered-as-written, 4 strict-missing, 5 hidden, 6 hard, 7 soft,
      // 8 published covered, 9 published missing. Read by NAME, then verified — this
      // parser shipped an off-by-one that printed `strict-missing=12790` over a log that
      // said 0, i.e. exactly the failure this instrument exists to find, so the checks
      // below are what make the mapping falsifiable instead of trusted.
      const [strictTruth, covered, missing, hidden, hard, soft, pubCovered, pubMissing] =
        [+s[2], +s[3], +s[4], +s[5], +s[6], +s[7], +s[8], +s[9]]
      if (line.replace(/\s+/g, " ").trim() !== `[strict] ${lang}: truth=${strictTruth} covered-as-written=${covered} strict-missing=${missing} hidden=${hidden} hard=${hard} soft=${soft} (published rule: covered=${pubCovered} missing=${pubMissing})`) {
        breaches.push(`${pending.repo}: the [strict] line does not round-trip through the parser's own field order — the regex and the reader disagree: ${line.trim()}`)
      }
      if (strictTruth !== pending.truth) {
        breaches.push(`${pending.repo}: the [strict] line reports truth=${strictTruth} but the repo line reported ${pending.truth} (the pass read a different truth set than the published loops)`)
      }
      if (covered + missing !== strictTruth) {
        breaches.push(`${pending.repo}: parser identity A: covered-as-written ${covered} + strict-missing ${missing} != truth ${strictTruth}`)
      }
      // the parentheses carry the PUBLISHED numbers for the SAME corpus — identity B is
      // checked against them, not against a re-implementation of the loose rule.
      if (pubCovered !== pending.publishedCovered || pubMissing !== pending.publishedMissing) {
        breaches.push(`${pending.repo}: the [strict] line reports published covered=${pubCovered} missing=${pubMissing} but the repo line reported ${pending.publishedCovered}/${pending.publishedMissing} (the two halves of the log disagree)`)
      }
      if (missing - hidden !== pending.publishedMissing) {
        breaches.push(`${pending.repo}: parser identity B: strict-missing ${missing} − hidden ${hidden} != published missing ${pending.publishedMissing}`)
      }
      pending.strictCovered = covered
      pending.strictMissing = missing
      pending.hidden = hidden
      pending.hard = hard
      pending.soft = soft
      continue
    }
    const b = BREACH_RE.exec(line)
    if (b && b[1] === lang) { breaches.push(`${lang}: ${b[2]}`); continue }
    if (HOLD_RE.test(line)) continue
    if (/^    HARD /.test(line)) { if (hardSamples.length < 60) hardSamples.push(line.replace(/^    HARD /, "")); continue }
    if (/^    SOFT /.test(line)) { if (softSamples.length < 20) softSamples.push(line.replace(/^    SOFT /, "")); continue }
  }
  return { repos, breaches, hardSamples, softSamples, parseError: null }
}

function verdictOf(row: Omit<LaneRow, "verdict">): string {
  // An unreadable log is refused FIRST and by name: the row is not a measurement of the
  // lane at all, so no count derived from it may be read as one (header, CONCURRENCY).
  if (row.parseError) return "instrument-breach"
  if (row.breaches.length) return "instrument-breach"
  if (row.after && fpKey(row.measuredAt) !== fpKey(row.after)) return "tree-moved"
  if (row.repos.length === 0) return "no-output"
  const truth = row.repos.reduce((a, r) => a + r.truth, 0)
  if (truth === 0) return "no-corpus"
  if (row.measuredAt.dirtyInputs > 0) return "dirty"
  const hard = row.repos.reduce((a, r) => a + r.hard, 0)
  const soft = row.repos.reduce((a, r) => a + r.soft, 0)
  const hidden = row.repos.reduce((a, r) => a + r.hidden, 0)
  if (hard > 0) return "hard-masks"
  if (hidden > 0) return "hidden-soft-only"
  if (soft > 0) return "soft-asymmetry" // strict-miss rows already counted published
  return "agrees"
}

function measureLane(lang: string): LaneRow {
  fs.mkdirSync(LOG_DIR, { recursive: true })
  fs.mkdirSync(WORK, { recursive: true })
  const before = fingerprint(lang)
  const logPath = path.join(LOG_DIR, `${lang}.log`)
  const fd = fs.openSync(logPath, "w")
  const t0 = Date.now()
  const proc = spawnSync("bun", ["script/m14/differential.ts", "--lang", lang, "--sample", SAMPLE], {
    cwd: ROOT, stdio: ["ignore", fd, fd],
    env: { ...process.env, BB_F5_STRICT: "1", BB_F5_SHOW_SAMPLES: "1", BB_M14_WORK: WORK },
  })
  fs.closeSync(fd)
  const durationMs = Date.now() - t0
  const after = fingerprint(lang)
  const log = fs.readFileSync(logPath, "utf8")
  const parsed = parseLane(lang, log)
  const row: Omit<LaneRow, "verdict"> = {
    lang, run: RUN, at: new Date().toISOString(), measuredAt: before, after, durationMs, log: logPath,
    repos: parsed.repos, parseError: parsed.parseError,
    breaches: parsed.parseError ? [...parsed.breaches, parsed.parseError] : parsed.breaches,
    hardSamples: parsed.hardSamples, softSamples: parsed.softSamples,
    stdoutTail: proc.status === 0 ? null : log.trim().split("\n").slice(-6),
  }
  const verdict = proc.status === 0 ? verdictOf(row) : "run-failed"
  return { ...row, verdict }
}

interface LockFile { pid: number; run: string; startedAt: string; head: string }

/** Whether the sweep that took the lock is still there. Liveness first (a dead pid is
 *  reclaimable), then identity: a pid RECYCLED by an unrelated process is not a holder,
 *  and a lock left by a killed sweep must not block the next run forever. */
function lockHolder(pid: number): { alive: boolean; isThisScript: boolean } {
  try { process.kill(pid, 0) } catch { return { alive: false, isThisScript: false } }
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8")
    return { alive: true, isThisScript: cmd.includes("verify-oracle-sharpness") }
  } catch {
    // No /proc (or not readable): the pid IS alive, so refuse. The conservative side of
    // a lock is to leave the other run's state alone.
    return { alive: true, isThisScript: true }
  }
}

/** The lock decision as a PURE function, so `--selftest` can falsify it instead of
 *  trusting the three-branch IO path above. */
export function lockOutcome(
  lock: LockFile | null,
  holder: { alive: boolean; isThisScript: boolean },
): "take" | "refuse" | "reclaim" {
  if (!lock || !lock.pid) return "take"
  if (!holder.alive || !holder.isThisScript) return "reclaim"
  return "refuse"
}

function readLock(): LockFile | null {
  try { return JSON.parse(fs.readFileSync(LOCK, "utf8")) } catch { return null }
}

/** Take the state's lock for a MEASURING run. Returns false when another live sweep
 *  holds it — that run's rows are safe (its logs and lock are per-run), so this one
 *  refuses rather than interleaving two runs into one state file. */
function acquireLock(): boolean {
  const held = readLock()
  const outcome = lockOutcome(held, held ? lockHolder(held.pid) : { alive: false, isThisScript: false })
  if (outcome === "refuse") {
    console.error(`refused: another sweep is measuring with this state — pid ${held!.pid}, run ${held!.run}, started ${held!.startedAt}, head ${held!.head}.`)
    console.error(`  its logs and lock are per-run, so its rows are safe; wait for it, or give this run its own state with BB_M60_OS_STATE.`)
    return false
  }
  if (outcome === "reclaim") {
    console.log(`note: reclaiming a stale lock (pid ${held!.pid}, run ${held!.run}) — its holder is gone, or the pid was recycled by another process`)
  }
  fs.mkdirSync(path.dirname(LOCK), { recursive: true })
  fs.writeFileSync(LOCK, JSON.stringify({
    pid: process.pid, run: RUN, startedAt: new Date().toISOString(), head: git(["rev-parse", "HEAD"]).trim(),
  }, null, 2) + "\n")
  return true
}

function releaseLock(): void { try { fs.unlinkSync(LOCK) } catch { /* already gone */ } }

function loadState(): any {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")) } catch { return { schemaVersion: 1, lanes: {} } }
}
function saveState(state: any) {
  state.updatedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(STATE), { recursive: true })
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n")
}

const ARTIFACT = process.env.BB_M60_OS_ARTIFACT ?? path.join(ROOT, "validation", "m60", "results", "oracle-sharpness.json")

/** The verdicts that describe a RUN rather than an analyzer: a row carrying one of
 *  these is not evidence about the lane, so it can never be published as if it were
 *  (the instrument's own rule — see verdictOf — and the reason `--emit` refuses per
 *  lane instead of refusing the whole run). */
const NOT_CITABLE = new Set(["tree-moved", "dirty", "run-failed", "instrument-breach", "no-output", "no-corpus"])

/**
 * WHY A LANE'S ROW IS OR IS NOT PUBLISHABLE — the pure half of the emission, so the
 * decision can be falsified (--selftest) instead of trusted. Note the asymmetry it
 * encodes: a verdict that describes the ANALYZER (`hard-masks`) IS published, because
 * a finding is the thing this artefact exists to carry, while a verdict that
 * describes the RUN (`tree-moved`, `dirty`, `run-failed`, `instrument-breach`,
 * `no-output`, `no-corpus`) is refused, because it is not evidence about the lane.
 * A digest mismatch is checked before dirtiness: a moved input means the row's bytes
 * are gone, a dirty one means they were never committed.
 */
export function emitRefusal(
  verdict: string,
  measuredDigest: string,
  nowDigest: string,
  dirty: { atMeasurement: string[]; now: string[] },
): string | null {
  if (verdict === "not-measured") return "not measured"
  if (measuredDigest !== nowDigest) return `inputs moved since measurement (${measuredDigest} → ${nowDigest})`
  const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean)
  const a = uniq(dirty.atMeasurement)
  const n = uniq(dirty.now)
  // The two sides are reported SEPARATELY: a row measured while an input was dirty can
  // never be published (its bytes are in no commit), even after that input is committed
  // — and a reader chasing the refusal needs to know which of the two it is looking at.
  // Measured confusion: the first version said "closure carries dirty input(s)" for both,
  // so a refusal after the upstream commit still read as if the tree were dirty now.
  if (a.length > 0 && n.length > 0) return `closure was dirty when measured (${a.join(", ")}) and is still dirty now (${n.join(", ")})`
  if (a.length > 0) return `closure was dirty when measured: ${a.join(", ")} — the row's bytes are in no commit, even if that file has landed since`
  if (n.length > 0) return `closure is dirty now: ${n.join(", ")} — the row would not describe a commit`
  if (NOT_CITABLE.has(verdict)) return `verdict ${verdict}`
  return null
}

/**
 * EMIT — the cited form (validation/m60/results/oracle-sharpness.json).
 *
 * What makes a row evidence here is not that it was measured, but that it still
 * describes THIS tree: the lane's closure digest must equal the digest the row was
 * measured at, and no input in that closure may be dirty (a dirty input means the
 * bytes that produced the row are not in any commit). A lane that fails either test
 * goes to `refused` with its reason, so an incomplete artefact is visibly incomplete.
 * Zero citable lanes refuses to write at all: an artefact with no rows would be
 * quotable as a table of results while carrying none.
 */
function emitArtifact(state: any): number {
  const rows: Record<string, any> = {}
  const refused: { lang: string; reason: string }[] = []
  for (const lang of LANE_ORDER) {
    const row: LaneRow | undefined = state.lanes?.[lang]
    if (!row) { refused.push({ lang, reason: "not measured" }); continue }
    const now = fingerprint(lang)
    const reason = emitRefusal(row.verdict, row.measuredAt.digest, now.digest, {
      atMeasurement: [...(row.measuredAt.dirty ?? []), ...(row.after?.dirty ?? [])],
      now: now.dirty ?? [],
    })
    if (reason) { refused.push({ lang, reason }); continue }
    const sum = (f: (r: RepoRow) => number) => row.repos.reduce((a, r) => a + f(r), 0)
    rows[lang] = {
      verdict: row.verdict,
      run: row.run ?? null,
      at: row.at ?? state.updatedAt ?? null,
      head: row.measuredAt.headShort,
      digest: row.measuredAt.digest,
      files: sum((r) => r.files),
      truth: sum((r) => r.truth),
      publishedMissing: sum((r) => r.publishedMissing),
      strictMissing: sum((r) => r.strictMissing),
      hidden: sum((r) => r.hidden),
      hard: sum((r) => r.hard),
      soft: sum((r) => r.soft),
      hardSamples: row.hardSamples.slice(0, 10),
      softSamples: row.softSamples.slice(0, 5),
      repos: row.repos.map((r) => ({
        repo: r.repo, files: r.files, truth: r.truth, publishedMissing: r.publishedMissing,
        strictMissing: r.strictMissing, hidden: r.hidden, hard: r.hard, soft: r.soft, hash: r.hash,
      })),
    }
  }
  const complete = Object.keys(rows).length === LANE_ORDER.length
  if (Object.keys(rows).length === 0) {
    console.error("emit refused: no lane's row is a measurement of this tree (nothing to publish is not a zero-count result)")
    for (const r of refused) console.error(`  ${pad(r.lang, 11)} ${r.reason}`)
    return 2
  }
  const artefact = {
    gate: "M60.SHARP",
    title: "Oracle sharpness — the differential's leaf matching rule re-run against each lane's truth as written",
    at: new Date().toISOString(),
    commit: git(["rev-parse", "HEAD"]).trim(),
    instrument: "script/m60/verify-oracle-sharpness.ts",
    method: "one `bun script/m14/differential.ts --lang X --sample " + SAMPLE + "` per lane with BB_F5_STRICT=1 BB_F5_SHOW_SAMPLES=1 into a private cold pool; the artefact publishes a lane only when its import closure still has the digest it was measured at and carries no dirty input; a lane whose published rule matched a DIFFERENT qualified target is `hard` and revokes the lane's `diff` cell in M60.LCM (a lane with hard>0 cannot be reported as done), `soft` is a spelling asymmetry and is disclosed, not libelled",
    measuredSources: {
      clean: true,
      dirty: [],
      rule: "git status --porcelain over each lane's import closure (differential + the lane's analyzer + its grammar binary), sampled before and after every lane",
    },
    expected: LANE_ORDER.length,
    citable: Object.keys(rows).length,
    complete,
    rows,
    refused,
    columns: {
      verdict: "agrees | hidden-soft-only | soft-asymmetry (hard>0 is `hard-masks` and is refused only when its inputs moved — it is published, because it is a finding)",
      run: "which sweep measured the row (pid+clock): a state shared by two runs used to be indistinguishable, so a row could not be ordered against another run's rows",
      files: "corpus files the lane's own discovery admitted, at full extent",
      truth: "truth rows derived for those files",
      publishedMissing: "rows MISSING under the published leaf rule (normTarget = last segment)",
      strictMissing: "rows not covered when the target is compared AS WRITTEN (generics stripped, qualifier kept)",
      hidden: "strict misses the published rule nevertheless covered (- hidden == publishedMissing is asserted per repo)",
      hard: "hidden rows where BOTH sides are qualified and disagree — the groovy d6a7cd89 shape",
      soft: "hidden rows where one side is a bare leaf — a spelling contract question",
    },
  }
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true })
  fs.writeFileSync(ARTIFACT, JSON.stringify(artefact, null, 1) + "\n")
  console.log(`\nemitted ${path.relative(ROOT, ARTIFACT)} — ${Object.keys(rows).length}/${LANE_ORDER.length} lane(s) citable${complete ? " (complete)" : " (INCOMPLETE: the refused list is part of the artefact)"}`)
  for (const r of refused) console.log(`  refused ${pad(r.lang, 11)} ${r.reason}`)
  return 0
}

const pad = (s: any, n: number) => String(s).padEnd(n)
const num = (s: any, n: number) => String(s).padStart(n)

function printTable(state: any) {
  console.log(`${pad("lane", 11)}${num("files", 7)}${num("truth", 8)}${num("pubMISS", 8)}${num("strictMISS", 11)}${num("hidden", 8)}${num("hard", 5)}${num("soft", 6)}  verdict  [fp]`)
  let totals = { files: 0, truth: 0, pub: 0, miss: 0, hidden: 0, hard: 0, soft: 0 }
  for (const lang of LANE_ORDER) {
    const row: LaneRow | undefined = state.lanes[lang]
    if (!row) { console.log(`${pad(lang, 11)}${num("—", 7)}  (not measured)`); continue }
    const sum = (f: (r: RepoRow) => number) => row.repos.reduce((a, r) => a + f(r), 0)
    totals.files += sum((r) => r.files); totals.truth += sum((r) => r.truth)
    totals.pub += sum((r) => r.publishedMissing); totals.miss += sum((r) => r.strictMissing)
    totals.hidden += sum((r) => r.hidden); totals.hard += sum((r) => r.hard); totals.soft += sum((r) => r.soft)
    console.log(
      `${pad(lang, 11)}${num(sum((r) => r.files), 7)}${num(sum((r) => r.truth), 8)}${num(sum((r) => r.publishedMissing), 8)}` +
      `${num(sum((r) => r.strictMissing), 11)}${num(sum((r) => r.hidden), 8)}${num(sum((r) => r.hard), 5)}${num(sum((r) => r.soft), 6)}` +
      `  ${pad(row.verdict, 9)} [${row.measuredAt.headShort} in=${row.measuredAt.digest}${row.measuredAt.dirtyInputs ? " dirty" : ""}]`,
    )
  }
  console.log(`${pad("TOTAL", 11)}${num(totals.files, 7)}${num(totals.truth, 8)}${num(totals.pub, 8)}${num(totals.miss, 11)}${num(totals.hidden, 8)}${num(totals.hard, 5)}${num(totals.soft, 6)}`)
}

/**
 * The instrument's own negatives. A counter that has never been shown to fire is
 * decoration, so this reproduces the ONE case where the published rule is known to
 * have hidden rows — the groovy anonymous-body defect, d6a7cd89 — from the strings
 * the artifact published, not from a re-run:
 *   published MISSING=2, actually 4 missing
 *   loose  : normTarget('anonymous_IdentityTypeDecoder.decode') == 'decode' == a WRONG analyzer edge's leaf
 *   strict : the two targets are different strings
 */
function selftest(): number {
  const failures: string[] = []
  const check = (name: string, ok: boolean) => { console.log(`${ok ? "  ok  " : "  FAIL"} ${name}`); if (!ok) failures.push(name) }
  // The pair as the artifact PUBLISHED it (reviews/m60-oracle-sharpness.md, state B):
  //   truth target   IdentityTypeDecoder.decode
  //   the edge the published rule accepted   PropertyDecoder.decode
  //   the edge the analyzer actually publishes  IdentityTypeDecoder.decode
  const truthTarget = "IdentityTypeDecoder.decode"
  const wrongAnalyzerTarget = "PropertyDecoder.decode"
  const rightAnalyzerTarget = "IdentityTypeDecoder.decode"
  check("loose rule DISCARDS the qualifier (the defect's mechanism)", normTarget(truthTarget) === normTarget(wrongAnalyzerTarget))
  check("strict rule separates them", strictKey("overrides", truthTarget) !== strictKey("overrides", wrongAnalyzerTarget))
  check("strict rule accepts the right target", strictKey("overrides", truthTarget) === strictKey("overrides", rightAnalyzerTarget))
  check("the OWNER the loose rule threw away is not what separated them (the comparison is on targets)", qualifierOf("anonymous_IdentityTypeDecoder.decode") === "anonymous_IdentityTypeDecoder")
  check("a bare target is its own written form", strictTargetText("decode") === "decode" && normTarget("decode") === "decode")
  check("generics/args are stripped on both rules (they are not the qualifier)", strictTargetText("List<User>") === "List" && normTarget("List<User>") === "List")
  check("qualifierOf names the owner, empty for a bare target", qualifierOf(truthTarget) === "IdentityTypeDecoder" && qualifierOf("decode") === "")
  // The invariants must CONVICT a broken pass, not merely accept a sound one, and each
  // one is asserted by its own message — counting breaches would pass for the wrong reason.
  const convicts = (name: string, probe: any, needle: RegExp) => {
    const breaches = sharpnessInvariants(probe)
    check(name, breaches.some((b) => needle.test(b)))
  }
  const good = { truth: 10, covered: 8, missing: 2, hidden: 1, hard: 1, publishedMissing: 1 }
  check("invariants accept an arithmetic pass", sharpnessInvariants(good).length === 0)
  convicts("invariant A convicts a partitioned pass", { ...good, covered: 7 }, /^A:/)
  convicts("invariant B convicts a pass that read a different truth set", { ...good, hidden: 0 }, /^B:/)
  convicts("invariant C convicts hard > hidden", { ...good, hard: 3 }, /^C:/)
  check("and a pass with no hidden row and matching counts is accepted", sharpnessInvariants({ truth: 10, covered: 8, missing: 2, hidden: 2, hard: 0, publishedMissing: 0 }).length === 0)

  // THE PARSER IS PART OF THE INSTRUMENT, and it shipped an off-by-one that printed
  // `strict-missing=12790` over a log that said 0 — a false alarm of exactly the class
  // this sweep exists to find. These cases pin the field mapping and prove the round-trip
  // guard convicts a shifted line instead of accepting it.
  const repoLine = "[lodash] javascript: files=55 tree-truth=12232 covered=12232 (100%) MISSING=0 | analyzer-edges=12232 unexplained=0 (0%) heuristic=0 hash=494e1b94766e8ade"
  const strictLine = "  [strict] javascript: truth=12232 covered-as-written=12232 strict-missing=0 hidden=0 hard=0 soft=0  (published rule: covered=12232 missing=0)"
  const okLog = `${repoLine}\n${strictLine}\n    [strict] javascript: identities hold, and the published rule hid nothing on this corpus\n`
  const okParse = parseLane("javascript", okLog)
  check("parser maps the [strict] fields by name", okParse.repos[0]?.strictCovered === 12232 && okParse.repos[0]?.strictMissing === 0 && okParse.repos[0]?.hidden === 0 && okParse.repos[0]?.hard === 0 && okParse.repos[0]?.soft === 0)
  check("parser accepts a sound log", okParse.breaches.length === 0)
  check("parser reads the repo row too", okParse.repos[0]?.truth === 12232 && okParse.repos[0]?.publishedMissing === 0 && okParse.repos[0]?.hash === "494e1b94766e8ade")
  const shifted = parseLane("javascript", `${repoLine}\n  [strict] javascript: truth=12232 covered-as-written=12232 strict-missing=0 hidden=3 hard=3 soft=0  (published rule: covered=12232 missing=0)\n`)
  check("parser CONVICTS a log whose hidden count breaks identity B", shifted.breaches.some((b) => /identity B/.test(b)))
  const renamed = parseLane("javascript", `${repoLine}\n  [strict] javascript: truth=12232 covered-as-written=0 strict-missing=12232 hidden=0 hard=0 soft=0  (published rule: covered=12232 missing=0)\n`)
  check("parser CONVICTS a log that reports the wrong field for the wrong value", renamed.breaches.length > 0)
  // FAIL CLOSED, BUT NOT FAIL-THE-SWEEP. Measured 2026-09-25: a concurrent run
  // truncated one lane's log, the orphan check threw, and a 25-lane sweep died at lane
  // 9 — that lane's row was never fabricated (correct), but the other 16 lanes went
  // unmeasured (not correct). The contract is now: no row, no throw.
  // THE REAL LINE THAT KILLED LANE 9 OF 25, copied from the log, not synthesised:
  // a fractional coverage (`99.9%`) that the old `(\d+)%` refused.
  const decimalRepoLine = "[svelte] svelte: files=4456 tree-truth=3193 covered=3189 (99.9%) MISSING=4 | analyzer-edges=3080 unexplained=0 (0%) heuristic=7 hash=f10e015bdc6a0b30"
  const decimalLog = `${decimalRepoLine}\n  [strict] svelte: truth=3193 covered-as-written=3189 strict-missing=4 hidden=0 hard=0 soft=0  (published rule: covered=3189 missing=4)\n`
  const decimalParse = parseLane("svelte", decimalLog)
  check("parser reads a FRACTIONAL coverage (99.9%) — the real svelte line that killed lane 9 of 25",
    decimalParse.parseError === null && decimalParse.repos.length === 1 && decimalParse.repos[0].truth === 3193 && decimalParse.repos[0].strictMissing === 4)
  check("parser still reads an integer coverage (the decimal fix is not a widening of the counts)",
    parseLane("javascript", okLog).repos.length === 1 && parseLane("javascript", okLog).parseError === null)
  check("a repo-SHAPED line the parser cannot read fails closed instead of vanishing", (() => {
    const unreadable = `${decimalRepoLine.replace("heuristic=7 hash=", "heuristic=seven hash=")}\n${strictLine}\n`
    const r = parseLane("svelte", unreadable)
    return r.parseError !== null && r.repos.length === 0 && /missing field is the parser's/.test(r.parseError ?? "")
  })())
  const orphan = parseLane("javascript", `${strictLine}\n`)
  check("parser FAILS CLOSED on a [strict] line with no repo row (no row is fabricated)",
    orphan.parseError !== null && orphan.repos.length === 0)
  check("parser does NOT throw on an unreadable log (the defect that killed lane 9 of 25)", (() => {
    try { parseLane("javascript", `${strictLine}\n`); parseLane("javascript", "not a log at all\n"); return true } catch { return false }
  })())
  check("an unreadable lane log lands as an instrument breach, never as a measurement",
    verdictOf({ parseError: orphan.parseError, breaches: [orphan.parseError ?? ""], repos: [] } as any) === "instrument-breach")
  // The lock, as a decision table: a live sweep refuses, a stale or recycled pid reclaims.
  check("lock: nothing held -> take", lockOutcome(null, { alive: false, isThisScript: false }) === "take")
  check("lock: a LIVE sweep holds it -> refuse", lockOutcome({ pid: 4242, run: "x", startedAt: "t", head: "h" }, { alive: true, isThisScript: true }) === "refuse")
  check("lock: a dead holder is reclaimed", lockOutcome({ pid: 4242, run: "x", startedAt: "t", head: "h" }, { alive: false, isThisScript: false }) === "reclaim")
  check("lock: a RECYCLED pid is reclaimed (the holder is not this script)", lockOutcome({ pid: 4242, run: "x", startedAt: "t", head: "h" }, { alive: true, isThisScript: false }) === "reclaim")
  check("parser records HARD/SOFT samples for triage", parseLane("javascript", `${repoLine}\n${strictLine}\n    HARD file.js :: calls a -> X.y   vs analyzer -> Z.y\n`).hardSamples.length === 1)

  // The emission's own negatives. An artefact that publishes a lane it should refuse
  // is worse than no artefact, so the decision is falsified on both sides: the
  // run-describing verdicts must be refused, the analyzer-describing ones must be
  // PUBLISHED (a hard mask is the finding this file exists to carry), and the two
  // provenance tests must convict with a message that names what moved.
  const cleanDirty = { atMeasurement: [], now: [] }
  const atM = { atMeasurement: ["src/ast/real-kotlin-analyzer.ts"], now: [] }
  const nowD = { atMeasurement: [], now: ["src/ast/real-erlang-analyzer.ts"] }
  check("emit: a clean measured row is publishable", emitRefusal("agrees", "d1", "d1", cleanDirty) === null)
  check("emit: a HARD MASK is published, not refused (a finding is evidence)", emitRefusal("hard-masks", "d1", "d1", cleanDirty) === null)
  check("emit: the soft verdicts are published too", ["hidden-soft-only", "soft-asymmetry"].every((v) => emitRefusal(v, "d1", "d1", cleanDirty) === null))
  check("emit: every run-describing verdict is refused",
    ["tree-moved", "dirty", "run-failed", "instrument-breach", "no-output", "no-corpus"].every((v) => (emitRefusal(v, "d1", "d1", cleanDirty) ?? "").startsWith("verdict ")))
  check("emit: an unmeasured lane is refused by name", emitRefusal("not-measured", "d1", "d1", cleanDirty) === "not measured")
  check("emit: a moved input is refused and the two digests are named",
    /inputs moved since measurement \(d1 → d2\)/.test(emitRefusal("agrees", "d1", "d2", cleanDirty) ?? ""))
  check("emit: a closure dirty WHEN MEASURED is refused even if that file has landed since",
    /was dirty when measured/.test(emitRefusal("agrees", "d1", "d1", atM) ?? "") &&
    (emitRefusal("agrees", "d1", "d1", atM) ?? "").includes("src/ast/real-kotlin-analyzer.ts"))
  check("emit: a closure dirty NOW is a different message (the distinction the first version lost)",
    /is dirty now/.test(emitRefusal("agrees", "d1", "d1", nowD) ?? "") &&
    (emitRefusal("agrees", "d1", "d1", nowD) ?? "").includes("src/ast/real-erlang-analyzer.ts"))
  check("emit: dirty on both sides names both lists",
    /was dirty when measured .*and is still dirty now/.test(emitRefusal("agrees", "d1", "d1", { atMeasurement: ["a.ts"], now: ["b.ts"] }) ?? ""))
  check("emit: a lane that is BOTH moved and dirty reports the move (the stronger statement)",
    /inputs moved/.test(emitRefusal("agrees", "d1", "d2", nowD) ?? ""))
  check("emit: duplicate dirty inputs are named once",
    (emitRefusal("agrees", "d1", "d1", { atMeasurement: ["a.ts", "a.ts"], now: [] }) ?? "").match(/a\.ts/g)?.length === 1)
  // The porcelain reader is part of the instrument because the message it builds is
  // what a reader acts on. Measured defect: a whole-output trim made the FIRST dirty
  // path lose its leading character, so the refusal named `rc/ast/...` for a file
  // whose path starts `src/`.
  check("porcelain: a leading-space status line keeps its path intact",
    porcelainPaths(" M src/ast/real-kotlin-analyzer.ts\n")[0] === "src/ast/real-kotlin-analyzer.ts")
  check("porcelain: the first line is not special-cased (the trim bug's exact site)",
    porcelainPaths(" M a.ts\n?? b.ts\n")[0] === "a.ts" && porcelainPaths(" M a.ts\n?? b.ts\n")[1] === "b.ts")
  check("porcelain: a missing trailing newline is not a path", porcelainPaths(" M a.ts").length === 1)
  check("porcelain: an empty status is no paths", porcelainPaths("").length === 0)
  // The fingerprint must be a CONTENT identity over the closure, so that a commit
  // anywhere else in the tree cannot invalidate a lane whose inputs are unchanged.
  const jsClosure = closure(DIFFERENTIAL)
  check("fingerprint: the harness closure is non-trivial", jsClosure.size > 1)
  check("fingerprint: the closure contains its own entry (a one-file fingerprint would be vacuous)", jsClosure.has(path.resolve(DIFFERENTIAL)))
  check("fingerprint: the closure is relative-import only (a package spec is not a local input)", resolveImport(DIFFERENTIAL, "node:fs") === null && resolveImport(DIFFERENTIAL, "../m14/differential") !== null)
  check("fingerprint: a lane's identity is the analyzer it names, and differs between lanes", fpKey(fingerprint("javascript")) !== fpKey(fingerprint("typescript")))
  console.log(failures.length === 0 ? "selftest: the instrument separates the known-hidden pair, its identities convict a broken pass, and its parser round-trips a real log" : `selftest: ${failures.length} FAILURE(S)`)
  return failures.length === 0 ? 0 : 1
}

function main() {
  const args = process.argv.slice(2)
  const langsArg = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : null
  const wantFull = args.includes("--full")
  const selftestOnly = args.includes("--selftest")
  const reportOnly = args.includes("--report")
  const emitOnly = args.includes("--emit")

  if (selftestOnly) process.exit(selftest())
  if (args.includes("--help") || args.length === 0) {
    console.log("bun script/m60/verify-oracle-sharpness.ts [--full|--lang a,b|--report|--fingerprint|--selftest]")
    console.log(`state: ${STATE}`)
    process.exit(0)
  }
  // A diagnostic worth having on its own: WHICH files a lane's row depends on, and
  // whether any of them is dirty — i.e. why a row is or is not re-derivable.
  if (args.includes("--fingerprint")) {
    const only = langsArg ? langsArg.split(",").map((s) => s.trim()).filter(Boolean) : LANE_ORDER
    for (const lang of only) {
      const fp = fingerprint(lang)
      const cfg = (LANGS as any)[lang]
      const closureFiles = [...closure(DIFFERENTIAL)].map((f) => path.relative(ROOT, f))
        .concat(cfg?.analyzerFile ? [...closure(path.join(ROOT, "src", "ast", `${cfg.analyzerFile}.ts`))].map((f) => path.relative(ROOT, f)) : [])
      console.log(`${pad(lang, 11)} ${fp.inputs} input(s) digest=${fp.digest}${fp.dirtyInputs ? ` DIRTY(${fp.dirtyInputs}): ${fp.dirty.join(", ")}` : " clean"}`)
      if (args.includes("--verbose")) for (const f of [...new Set(closureFiles)].sort()) console.log(`    ${f}`)
    }
    process.exit(0)
  }

  const state = loadState()
  const langs = langsArg ? langsArg.split(",").map((s) => s.trim()).filter(Boolean) : LANE_ORDER
  const unknown = langs.filter((l) => !LANE_ORDER.includes(l))
  if (unknown.length) { console.error(`unknown lane(s): ${unknown.join(", ")}`); process.exit(2) }

  if (reportOnly) { printTable(state); process.exit(0) }
  // Emission reads the state and fingerprints the tree; it measures nothing, so it
  // takes no lane list and cannot be combined into a measurement run by accident.
  if (emitOnly) process.exit(emitArtifact(state))

  const now = fingerprint(langs[0])
  const todo = langs.filter((lang) => {
    const row: LaneRow | undefined = state.lanes[lang]
    if (!row) return true
    if (!wantFull && !langsArg) return false
    // Re-measure a row whose OWN inputs changed under it, and every row whose verdict
    // says it describes a RUN rather than the lane — the SAME predicate the emission
    // refuses with, so "cannot be cited" and "must be measured again" cannot drift
    // apart. (The first version listed three of those six verdicts by hand and so re-ran
    // neither `instrument-breach` nor `no-output` rows, which is how the breach
    // message's own instruction — "re-measure it" — was unfulfillable.)
    return fpKey(row.measuredAt) !== fpKey(fingerprint(lang)) || NOT_CITABLE.has(row.verdict)
  })

  if (!acquireLock()) process.exit(3)
  try {
    console.log(`oracle sharpness sweep — ${todo.length} lane(s) to measure, at ${now.headShort} (harness closure ${now.inputs} file(s), digest ${now.digest}${now.dirtyInputs ? ` DIRTY: ${now.dirty.join(", ")}` : ""})`)
    console.log(`state ${STATE}; run ${RUN}; one log per lane in ${LOG_DIR}\n`)

    for (const lang of todo) {
      const row = measureLane(lang)
      state.lanes[lang] = row
      saveState(state)
      const sum = (f: (r: RepoRow) => number) => row.repos.reduce((a, r) => a + f(r), 0)
      // ONE console.log, built AFTER the row exists: the prefix used to be written
      // before measuring, so a lane that died left `[ts] svelte … ` in the sweep's log
      // with the error under it, which reads as a truncated RESULT rather than a
      // missing one (measured 2026-09-25, and it is what made the crash look like it
      // happened while printing svelte).
      console.log(
        `[${new Date().toISOString()}] ${RUN} ${pad(lang, 11)} … ${(row.durationMs / 1000).toFixed(0)}s files=${sum((r) => r.files)} truth=${sum((r) => r.truth)}` +
        ` published-missing=${sum((r) => r.publishedMissing)} strict-missing=${sum((r) => r.strictMissing)}` +
        ` hidden=${sum((r) => r.hidden)} hard=${sum((r) => r.hard)} soft=${sum((r) => r.soft)} → ${row.verdict}`,
      )
      if (row.breaches.length) for (const b of row.breaches) console.log(`    BREACH ${b}`)
      if (row.stdoutTail) for (const l of row.stdoutTail) console.log(`    ${l}`)
    }


    console.log()
    printTable(state)
    saveState(state)

    const hard = LANE_ORDER.filter((l) => state.lanes[l]?.verdict === "hard-masks")
    const breach = LANE_ORDER.filter((l) => state.lanes[l]?.verdict === "instrument-breach")
    const missing = LANE_ORDER.filter((l) => !state.lanes[l])
    if (hard.length) console.error(`\nHARD MASKS (the published rule hid rows): ${hard.join(", ")} — triage each, then fix the analyzer or the rule`)
    if (breach.length) console.error(`\nINSTRUMENT BREACH: ${breach.join(", ")} — a breach invalidates the lane's row, and the next --full re-measures it (its verdict is uncitable by construction)`)
    if (missing.length) console.log(`\nnot measured yet: ${missing.join(", ")}`)
    process.exitCode = hard.length || breach.length ? 1 : 0
  } finally {
    releaseLock()
  }
}

if (process.argv[1]?.endsWith("verify-oracle-sharpness.ts")) main()
