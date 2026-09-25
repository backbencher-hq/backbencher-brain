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
 * carries the HEAD, the harness digest and the analyzer digest it was measured at,
 * sampled BEFORE and AFTER the lane; a lane whose inputs moved mid-run is recorded
 * `tree-moved` and never counted as measured. A lane measured with a dirty analyzer
 * is marked `dirty` and can never be cited as re-derivable.
 *
 * CLI:
 *   bun script/m60/verify-oracle-sharpness.ts --full            # measure every lane not yet measured
 *   bun script/m60/verify-oracle-sharpness.ts --lang java,scala # measure named lanes, merge into state
 *   bun script/m60/verify-oracle-sharpness.ts --report          # print the table, run nothing
 *   bun script/m60/verify-oracle-sharpness.ts --selftest        # the instrument's own negatives
 *
 * State: $BB_M60_OS_STATE, default $TMPDIR/m60-oracle-sharpness.json (a working
 * file, NOT evidence — the m14 evidence harness owns validation/m14/results, and an
 * artifact is emitted there only when every lane is measured at one clean digest).
 * Logs: one file per lane next to the state file, so a kill loses at most one lane.
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
const LOG_DIR = path.join(path.dirname(STATE), "m60-os-logs")
// A PRIVATE cold pool: the sweep draws a whole corpus, so rotation is irrelevant to
// its counts, but sharing a pool with another agent's runs would make the two runs
// race on the same journal file.
const WORK = process.env.BB_M60_OS_WORK ?? path.join(os.tmpdir(), "m60-os-work")
const SAMPLE = "100000"

const LANE_ORDER = Object.keys(LANGS)

const sha = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex").slice(0, 16)
const shaFile = (p: string) => { try { return sha(fs.readFileSync(p)) } catch { return "absent" } }
const git = (args: string[]) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" })
  return (r.stdout ?? "").trim()
}
const analyzerFiles = () => fs.readdirSync(path.join(ROOT, "src", "ast"))
  .filter((f) => /^real-.*-analyzer\.ts$/.test(f)).sort()

/** The inputs this measurement depends on: the harness, every analyzer, each lane's
 *  grammar binary. Sampled before and after each lane. */
function fingerprint() {
  const head = git(["rev-parse", "HEAD"])
  const analyzerDigests = analyzerFiles().map((f) => `${f}:${shaFile(path.join(ROOT, "src", "ast", f))}`)
  return {
    head,
    headShort: head.slice(0, 8),
    differential: shaFile(DIFFERENTIAL),
    analyzers: sha(analyzerDigests.join("\n")),
    analyzersDirty: git(["status", "--porcelain", "--", ...analyzerFiles().map((f) => `src/ast/${f}`)]).length > 0,
    differentialDirty: git(["status", "--porcelain", "--", "script/m14/differential.ts"]).length > 0,
  }
}
const fpKey = (f: ReturnType<typeof fingerprint>) => `${f.head}:${f.differential}:${f.analyzers}`

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

const REPO_RE = /^\[([^\]]+)\] ([a-z0-9_]+): files=(\d+) tree-truth=(\d+) covered=(\d+) \((\d+)%\) MISSING=(\d+) \| analyzer-edges=(\d+) unexplained=(\d+) \((\d+)%\) heuristic=(\d+) hash=([0-9a-f]+)/
const STRICT_RE = /^\s+\[strict\] ([a-z0-9_]+): truth=(\d+) covered-as-written=(\d+) strict-missing=(\d+) hidden=(\d+) hard=(\d+) soft=(\d+)\s+\(published rule: covered=(\d+) missing=(\d+)\)/
const HOLD_RE = /^\s+\[strict\] ([a-z0-9_]+): identities hold/
const BREACH_RE = /STRICT-INVARIANT BREACH ([a-z0-9_]+): (.+)$/

function parseLane(lang: string, logPath: string, log: string): { repos: RepoRow[]; breaches: string[]; hardSamples: string[]; softSamples: string[] } {
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
    const s = STRICT_RE.exec(line)
    if (s) {
      if (!pending) throw new Error(`${lang}: a [strict] line with no repo line above it — the log is not the one this parser reads`)
      pending.strictCovered = +s[2]
      pending.strictMissing = +s[3]
      pending.hidden = +s[4]
      pending.hard = +s[5]
      pending.soft = +s[6]
      // the parentheses carry the PUBLISHED numbers for the SAME corpus — identity B
      // is checked against them, not against a re-implementation of the loose rule.
      if (+s[8] !== pending.publishedCovered || +s[9] !== pending.publishedMissing) {
        breaches.push(`${pending.repo}: the [strict] line reports published covered=${s[8]} missing=${s[9]} but the repo line reported ${pending.publishedCovered}/${pending.publishedMissing} (the two halves of the log disagree)` )
      }
      continue
    }
    const b = BREACH_RE.exec(line)
    if (b && b[1] === lang) { breaches.push(`${lang}: ${b[2]}`); continue }
    if (HOLD_RE.test(line)) continue
    if (/^    HARD /.test(line)) { if (hardSamples.length < 60) hardSamples.push(line.replace(/^    HARD /, "")); continue }
    if (/^    SOFT /.test(line)) { if (softSamples.length < 20) softSamples.push(line.replace(/^    SOFT /, "")); continue }
  }
  return { repos, breaches, hardSamples, softSamples }
}

function verdictOf(row: Omit<LaneRow, "verdict">): string {
  if (row.breaches.length) return "instrument-breach"
  if (row.after && fpKey(row.measuredAt) !== fpKey(row.after)) return "tree-moved"
  const truth = row.repos.reduce((a, r) => a + r.truth, 0)
  if (truth === 0) return "no-corpus"
  if (row.measuredAt.analyzersDirty) return "dirty"
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
  const before = fingerprint()
  const logPath = path.join(LOG_DIR, `${lang}.log`)
  const fd = fs.openSync(logPath, "w")
  const t0 = Date.now()
  const proc = spawnSync("bun", ["script/m14/differential.ts", "--lang", lang, "--sample", SAMPLE], {
    cwd: ROOT, stdio: ["ignore", fd, fd],
    env: { ...process.env, BB_F5_STRICT: "1", BB_F5_SHOW_SAMPLES: "1", BB_M14_WORK: WORK },
  })
  fs.closeSync(fd)
  const durationMs = Date.now() - t0
  const after = fingerprint()
  const log = fs.readFileSync(logPath, "utf8")
  const parsed = parseLane(lang, logPath, log)
  const row: Omit<LaneRow, "verdict"> = {
    lang, measuredAt: before, after, durationMs, log: logPath,
    repos: parsed.repos, breaches: parsed.breaches,
    hardSamples: parsed.hardSamples, softSamples: parsed.softSamples,
    stdoutTail: proc.status === 0 ? null : log.trim().split("\n").slice(-6),
  }
  const verdict = proc.status === 0 ? verdictOf(row) : "run-failed"
  return { ...row, verdict }
}

function loadState(): any {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")) } catch { return { schemaVersion: 1, lanes: {} } }
}
function saveState(state: any) {
  state.updatedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(STATE), { recursive: true })
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n")
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
      `  ${pad(row.verdict, 9)} [${row.measuredAt.headShort}${row.measuredAt.analyzersDirty ? " dirty" : ""}]`,
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
  console.log(failures.length === 0 ? "selftest: the instrument separates the known-hidden pair and its identities convict a broken pass" : `selftest: ${failures.length} FAILURE(S)`)
  return failures.length === 0 ? 0 : 1
}

function main() {
  const args = process.argv.slice(2)
  const langsArg = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : null
  const wantFull = args.includes("--full")
  const selftestOnly = args.includes("--selftest")
  const reportOnly = args.includes("--report")

  if (selftestOnly) process.exit(selftest())
  if (args.includes("--help") || args.length === 0) {
    console.log("bun script/m60/verify-oracle-sharpness.ts [--full|--lang a,b|--report|--selftest]")
    console.log(`state: ${STATE}`)
    process.exit(0)
  }

  const state = loadState()
  const current = fingerprint()
  const langs = langsArg ? langsArg.split(",").map((s) => s.trim()).filter(Boolean) : LANE_ORDER
  const unknown = langs.filter((l) => !LANE_ORDER.includes(l))
  if (unknown.length) { console.error(`unknown lane(s): ${unknown.join(", ")}`); process.exit(2) }

  if (reportOnly) { printTable(state); process.exit(0) }

  const todo = langs.filter((lang) => {
    const row: LaneRow | undefined = state.lanes[lang]
    if (!row) return true
    if (!wantFull && !langsArg) return false
    // re-measure a row that was measured at a different harness/analyzer digest, or
    // whose inputs moved under it, or that was measured dirty
    return fpKey(row.measuredAt) !== fpKey(current) || row.verdict === "tree-moved" || row.verdict === "dirty" || row.verdict === "run-failed"
  })

  console.log(`oracle sharpness sweep — ${todo.length} lane(s) to measure, at ${current.headShort} (harness ${current.differential}${current.differentialDirty ? " DIRTY" : ""}, analyzers ${current.analyzers}${current.analyzersDirty ? " DIRTY" : ""})`)
  console.log(`state ${STATE}; one log per lane in ${LOG_DIR}\n`)

  for (const lang of todo) {
    process.stdout.write(`[${new Date().toISOString()}] ${lang} … `)
    const row = measureLane(lang)
    state.lanes[lang] = row
    saveState(state)
    const sum = (f: (r: RepoRow) => number) => row.repos.reduce((a, r) => a + f(r), 0)
    console.log(
      `${(row.durationMs / 1000).toFixed(0)}s files=${sum((r) => r.files)} truth=${sum((r) => r.truth)}` +
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
  if (breach.length) console.error(`\nINSTRUMENT BREACH: ${breach.join(", ")} — a breach invalidates the lane's row, re-measure it`)
  if (missing.length) console.log(`\nnot measured yet: ${missing.join(", ")}`)
  process.exitCode = hard.length || breach.length ? 1 : 0
}

main()
