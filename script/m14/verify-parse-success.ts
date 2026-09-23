/**
 * M14.0.F10 — corpus parse-success floor gate
 *
 * WHY THIS EXISTS (registered by #742 and #743, built here):
 *
 * F5 compares the analyzer against the oracle, and BOTH walk the same partial
 * tree. A grammar that cannot represent half a corpus therefore produces two
 * perfectly equal sides — parity measures agreement, not coverage — so a silent
 * under-count inside ERROR regions is invisible to every gate this project
 * already has. Recovery keeps symbols flowing, which is what makes the loss
 * silent: a 60 % error rate and a 0 % error rate can both be "no symbol loss".
 *
 * This gate measures the other half — how much of each corpus the PINNED grammar
 * can actually parse — and makes the result a recorded floor that cannot regress
 * unwatched. It does not fix a grammar, and it does not judge recovery.
 *
 * ROUTING IS THE PRODUCT'S. A corpus file is a candidate for a lane when
 * `detectLanguageFromPath` — the same function the pipeline uses, including the
 * `.h` objective-c/C++/C sniff — names that lane's language. So cpp's measure
 * includes the headers production routes to cpp (which is exactly the surface
 * #743 was about), and c's includes the plain C headers production routes to c
 * (the `.c`-only figure is reported beside it per extension, so the two numbers
 * can be reconciled rather than confused).
 *
 * SAMPLING IS DETERMINISTIC AND UNBIASED. Candidates are ordered by a hash of
 * their relative path, then capped. This matters: a sorted-path cap of 200 on
 * nlohmann-json draws `benchmarks/` and friends and reports a 7.0 % floor where
 * the corpus's real rate is 30.6 % — a sample that cannot see the damage it
 * exists to watch. The hash order is stable across runs, so the sample digest
 * pins the exact file set, and a lane whose set changed reports `sample-moved`
 * and is NOT compared (the honest state, not a pass).
 *
 * ONE FRESH WASM MODULE PER LANE. Every lane is measured in its own child
 * process: one web-tree-sitter module degrades after ~19-31 lanes in a
 * fixed-size heap and then returns empty trees before it aborts (M49 W11), which
 * is how a dead parser becomes a clean 0 % lane. A child per lane cannot reach
 * that state at all.
 *
 * Verdicts per lane:
 *   fail          — the parse-failure rate exceeds the pinned floor, or a lane
 *                   pinned at 0 % has any failure at all
 *   pass          — at or below the floor
 *   pass-improved — strictly below the floor; the floor can be tightened
 *   sample-moved  — the candidate set changed; counts are not comparable (exit 2)
 *   unpinned      — no floor recorded yet (pin with --update-baseline)
 *
 * Exit codes: 0 pass · 1 regression · 2 a lane could not be compared.
 *
 * Usage:
 *   bun script/m14/verify-parse-success.ts                      # gate (all lanes)
 *   bun script/m14/verify-parse-success.ts --lang cpp           # scoped probe
 *   bun script/m14/verify-parse-success.ts --repo nlohmann-json
 *   bun script/m14/verify-parse-success.ts --sample 0           # full extent per lane (census)
 *   bun script/m14/verify-parse-success.ts --sample 400         # cap each lane (the default)
 *   bun script/m14/verify-parse-success.ts --update-baseline    # re-pin floors
 *   bun script/m14/verify-parse-success.ts --baseline <path>    # floor file to read
 *   bun script/m14/verify-parse-success.ts --selftest           # prove every branch of
 *                                                              # the comparison can fire
 *                                                              # (one real lane, no writes)
 *
 * Evidence: validation/m14/results/M14.0.F10.json
 * Baseline: validation/m14/parse-success-baseline.json
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execSync, spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { LANGS, LANG_REPOS, SECOND_CORPUS } from "./differential"
import { emitEvidence } from "./evidence-harness"

const ROOT = path.resolve(__dirname, "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const EVIDENCE_PATH = path.join(ROOT, "validation/m14/results/M14.0.F10.json")

/** Rate comparison epsilon: percentages are floats and a pinned rate must not fail on noise. */
const EPS = 0.05

const hasArg = (f: string) => process.argv.includes(f)
const argValue = (f: string) => {
  const i = process.argv.indexOf(f)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const BASELINE_PATH = argValue("--baseline") ?? path.join(ROOT, "validation/m14/parse-success-baseline.json")
const SCOPED_LANG = argValue("--lang")
const SCOPED_REPO = argValue("--repo")
const UPDATE_BASELINE = hasArg("--update-baseline")
// --selftest: prove the comparison can fail, on a REAL measurement, before the
// gate is trusted inside the battery. A gate whose only observed state is "pass"
// is decoration (the class M60's G-gates keep paying for), so this runs the same
// predicate the battery runs, against mutated floors.
const SELFTEST = hasArg("--selftest")
// Defaults to a cap of 400 files per lane. Full extent is available (`--sample 0`)
// and is the honest census, but it is not the gate's job: grails-core alone does
// not finish a full Java parse inside ten minutes, and a gate nobody runs is not a
// gate. The cap is hash-ordered (so it is unbiased, unlike a sorted-path draw) and
// digest-pinned (so the exact file set is part of the floor), and every row states
// whether it was capped. Measured on nlohmann-json: cap 200 = 33.0% against a full
// extent of 30.6%, i.e. the capped figure tracks the corpus, which is what a floor
// needs; the census figure for reconciliation is `--sample 0`.
const SAMPLE_LIMIT = parseInt(argValue("--sample") ?? "400", 10)
const SCOPED = Boolean(SCOPED_LANG || SCOPED_REPO)
const CHILD_LANG = argValue("--child-lang")
const CHILD_REPO = argValue("--child-repo")
const CHILD_OUT = argValue("--child-out")

interface Lane {
  key: string
  lang: string
  repo: string
  which: "primary" | "second"
  wasm: string
  /** the id `detectLanguageFromPath` returns for this lane's language */
  detected: string
}

/**
 * Lane language id → the id the production detector returns. Almost always the
 * same; `objc` is the one exception, and a silent empty candidate set is exactly
 * the kind of zero this gate exists to refuse, so it is named here rather than
 * discovered as a 0-file lane.
 */
const DETECTED_ID: Record<string, string> = { objc: "objective-c" }

/**
 * A lane's wasm comes from the sweep's own map (`LANGS`), never from a name this
 * file builds: the csharp module is `tree-sitter-c_sharp.wasm`, and deriving the
 * filename from the language id found that out the hard way.
 */
function laneOf(lang: string, repo: string, which: "primary" | "second"): Lane | null {
  const cfg = LANGS[lang]
  if (!cfg) {
    console.error(`parse-success gate: no LANGS entry for ${lang} — extend the sweep's map, not this file`)
    return null
  }
  return { key: `${repo}:${lang}`, lang, repo, which, wasm: cfg.wasm, detected: DETECTED_ID[lang] ?? lang }
}

function laneList(): Lane[] {
  const out: Lane[] = []
  for (const [lang, repo] of Object.entries(LANG_REPOS)) {
    const l = laneOf(lang, repo, "primary")
    if (l) out.push(l)
  }
  for (const [lang, repo] of Object.entries(SECOND_CORPUS)) {
    if (out.some((l) => l.key === `${repo}:${lang}`)) continue
    const l = laneOf(lang, repo, "second")
    if (l) out.push(l)
  }
  return out
}

// --------------------------------------------------------------------- child

function walk(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.isFile()) out.push(full)
  }
}

/**
 * Files the PRODUCT routes to this language, ordered by hash of relative path
 * (a stable shuffle, unbiased across directories) and then capped.
 */
function candidates(repoDir: string, lang: string, detectedId: string): string[] {
  const all: string[] = []
  walk(repoDir, all)
  const hits: string[] = []
  for (const f of all) {
    const ext = f.slice(f.lastIndexOf(".") + 1).toLowerCase()
    // Only the ambiguous header needs its content; every other extension routes
    // on the name alone, so the walk stays cheap on large corpora.
    let detected = detectLanguageFromPath(f)
    if (ext === "h" || ext === "hpp") {
      let head = ""
      try {
        head = readFileSync(f, "utf8").slice(0, 65536)
      } catch {
        continue
      }
      detected = detectLanguageFromPath(f, head)
    }
    if (detected === detectedId) hits.push(f)
  }
  const rel = (f: string) => path.relative(repoDir, f)
  hits.sort((a, b) => {
    const ha = createHash("sha256").update(rel(a)).digest("hex")
    const hb = createHash("sha256").update(rel(b)).digest("hex")
    return ha < hb ? -1 : ha > hb ? 1 : 0
  })
  return SAMPLE_LIMIT > 0 ? hits.slice(0, SAMPLE_LIMIT) : hits
}

function digestOf(repo: string, lang: string, repoDir: string, files: string[]): string {
  const h = createHash("sha256")
  h.update(`${repo}:${lang}\n`)
  for (const f of files) h.update(`${path.relative(repoDir, f)}\n`)
  return h.digest("hex").slice(0, 16)
}

/** ERROR nodes and MISSING tokens counted separately: they are different defects. */
function censusOf(root: any): { err: boolean; miss: boolean; errorLines: Set<number> } {
  const out = { err: false, miss: false, errorLines: new Set<number>() }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "ERROR") {
      out.err = true
      out.errorLines.add(n.startPosition.row + 1)
    }
    if (n.isMissing) out.miss = true
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return out
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid]
}

function repoPin(repo: string): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: path.join(CORPUS_ROOT, repo) }).toString().trim()
  } catch {
    return null
  }
}

/**
 * Provenance for a number-naming artifact: the commit it describes and how many
 * ANALYZER sources the working tree had modified when it ran. Grammar damage is
 * a property of the pinned wasm, so a dirty analyzer does not move these numbers
 * — but a reader is entitled to know, rather than having to assume.
 */
function provenance(): { atCommit: string | null; treeModifiedInputs: number } {
  let atCommit: string | null = null
  let treeModifiedInputs = 0
  try {
    atCommit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
    const dirty = execSync("git status --porcelain -- src/ast", { cwd: ROOT }).toString().trim()
    treeModifiedInputs = dirty ? dirty.split("\n").filter(Boolean).length : 0
  } catch {
    /* provenance is recorded as unknown rather than guessed */
  }
  return { atCommit, treeModifiedInputs }
}

async function measureLane(lane: Lane, outPath: string) {
  const repoDir = path.join(CORPUS_ROOT, lane.repo)

  if (!existsSync(repoDir)) {
    writeFileSync(outPath, JSON.stringify({ lane: lane.key, skipped: "corpus-absent" }))
    return
  }

  const files = candidates(repoDir, lane.lang, lane.detected)
  if (files.length === 0) {
    throw new Error(
      `lane ${lane.key} has 0 candidate files under the product's routing (${path.relative(CORPUS_ROOT, repoDir)}): ` +
        `a 0-file lane is exactly the silent zero this gate refuses — fix the routing, do not record a floor for it`,
    )
  }
  const digest = digestOf(lane.repo, lane.lang, repoDir, files)

  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar: any = await Language.load(readFileSync(path.join(ROOT, "wasm", lane.wasm)))
  const parser = new Parser()
  parser.setLanguage(grammar)

  let files_ = 0
  let errorFiles = 0
  let missingFiles = 0
  let eitherFiles = 0
  let emptyFiles = 0
  let errorLines = 0
  const damagedFilesWithLines: number[] = []
  const buckets: Record<string, { files: number; errorFiles: number }> = {}
  const exts: Record<string, { files: number; errorFiles: number }> = {}

  for (const f of files) {
    let src: string
    try {
      src = readFileSync(f, "utf8")
    } catch {
      continue
    }
    const rel = path.relative(repoDir, f)
    const top = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "."
    const bucket = (buckets[top] ??= { files: 0, errorFiles: 0 })
    bucket.files++
    const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase() || "(none)"
    const extRow = (exts[ext] ??= { files: 0, errorFiles: 0 })
    extRow.files++

    let root: any
    try {
      root = parser.parse(src)?.rootNode
    } catch {
      files_++
      errorFiles++
      eitherFiles++
      bucket.errorFiles++
      extRow.errorFiles++
      continue
    }
    if (!root || root.childCount === 0) emptyFiles++
    const st = root ? censusOf(root) : { err: false, miss: false, errorLines: new Set<number>() }
    files_++
    if (st.err) {
      errorFiles++
      bucket.errorFiles++
      extRow.errorFiles++
      errorLines += st.errorLines.size
      damagedFilesWithLines.push(st.errorLines.size)
    }
    if (st.miss) missingFiles++
    if (st.err || st.miss) eitherFiles++
  }

  const pct = (n: number) => (files_ ? Number(((100 * n) / files_).toFixed(3)) : 0)
  writeFileSync(
    outPath,
    JSON.stringify({
      lane: lane.key,
      lang: lane.lang,
      repo: lane.repo,
      which: lane.which,
      repoPin: repoPin(lane.repo),
      files: files_,
      candidateCount: files.length,
      capped: SAMPLE_LIMIT > 0 && files.length >= SAMPLE_LIMIT,
      sampleLimit: SAMPLE_LIMIT > 0 ? SAMPLE_LIMIT : null,
      sampleDigest: digest,
      errorFiles,
      missingFiles,
      eitherFiles,
      emptyFiles,
      eitherPct: pct(eitherFiles),
      errPct: pct(errorFiles),
      missPct: pct(missingFiles),
      errorLines,
      errorLinesMedian: median(damagedFilesWithLines),
      errorLinesMax: damagedFilesWithLines.length ? Math.max(...damagedFilesWithLines) : 0,
      buckets,
      exts,
    }),
  )
}

// ------------------------------------------------------------------ verdicts
//
// The comparison lives here, once, because the self-test has to exercise THE
// predicate the battery runs rather than a copy of it (a self-test of a copy
// proves the copy works).

function verdictFor(
  row: any,
  pinned: any | undefined,
  updateBaseline: boolean,
): { verdict: string; failed: boolean; improved: boolean } {
  if (!pinned) {
    return { verdict: updateBaseline ? "pinned" : "unpinned", failed: false, improved: false }
  }
  if (pinned.sampleDigest !== row.sampleDigest) {
    return { verdict: "sample-moved", failed: false, improved: false }
  }
  if (row.eitherPct > pinned.eitherPct + EPS || (pinned.eitherPct === 0 && row.eitherFiles > 0)) {
    return { verdict: "FAIL", failed: true, improved: false }
  }
  if (row.eitherPct < pinned.eitherPct - EPS) {
    return { verdict: "pass-improved", failed: false, improved: true }
  }
  return { verdict: "pass", failed: false, improved: false }
}

/** fail → 1, needs-repin → 2, everything else → 0. A moved sample is NOT a pass. */
function exitCodeFor(verdict: string): number {
  return verdict === "fail" ? 1 : verdict === "needs-repin" ? 2 : 0
}

// -------------------------------------------------------------------- parent

/**
 * `--selftest`: measure ONE lane for real, then drive the gate's own comparison
 * through every branch it claims to implement. Fails loudly when a branch cannot
 * be reached — a lane with no failures cannot exercise the regression direction,
 * and saying so is the point (a self-test that quietly proves half the predicate
 * is the failure mode this repository keeps finding).
 *
 * Writes nothing: no evidence, no baseline.
 */
async function runSelfTest(): Promise<void> {
  const lang = SCOPED_LANG ?? "c"
  const repo = SCOPED_REPO ?? "jq"
  const lane = laneList().find((l) => l.lang === lang && l.repo === repo)
  if (!lane) {
    console.error(`F10 selftest: no lane ${repo}:${lang} in the sweep's map`)
    process.exit(2)
  }

  const work = mkdtempSync(path.join(tmpdir(), "bb-f10-selftest-"))
  const outPath = path.join(work, "row.json")
  const r = spawnSync(
    process.execPath,
    [
      process.argv[1],
      "--child-lang",
      lane.lang,
      "--child-repo",
      lane.repo,
      "--child-out",
      outPath,
      ...(SAMPLE_LIMIT > 0 ? ["--sample", String(SAMPLE_LIMIT)] : []),
    ],
    { stdio: ["ignore", "ignore", "inherit"], cwd: ROOT, env: process.env },
  )
  if (r.status !== 0 || !existsSync(outPath)) {
    console.error(`F10 selftest: the measurement child failed (rc=${r.status}) — nothing was proven`)
    process.exit(1)
  }
  const row = JSON.parse(readFileSync(outPath, "utf8"))
  rmSync(work, { recursive: true, force: true })

  const bad: string[] = []
  const want = (label: string, got: unknown, expect: unknown) => {
    if (got !== expect) bad.push(`${label}: expected ${String(expect)}, got ${String(got)}`)
  }
  const base = { sampleDigest: row.sampleDigest, eitherPct: row.eitherPct }

  console.log(`\nM14.0.F10 — self-test on the real measurement of ${lane.key}`)
  console.log(`  measured: ${row.files} files, ${row.eitherPct}% carry an ERROR node or a MISSING token`)

  // Non-vacuity: a 0-file lane is the silent zero this gate exists to refuse, and
  // a lane with NO failures cannot exercise the regression direction at all.
  if (!(row.files > 0)) bad.push("the lane measured 0 files — the gate has nothing to watch")
  if (!(row.eitherFiles > 0)) {
    bad.push(
      `the lane (${lane.key}) has no damaged file, so the FAIL direction cannot be exercised — pick a lane with a rate`,
    )
  }

  // The predicate's five branches, on the measured row.
  want("floor equal to the measurement passes", verdictFor(row, base, false).verdict, "pass")
  want(
    "floor above the measurement reports pass-improved",
    verdictFor(row, { ...base, eitherPct: row.eitherPct + 10 }, false).verdict,
    "pass-improved",
  )
  want(
    "floor below the measurement FAILS (the regression direction)",
    verdictFor(row, { ...base, eitherPct: Math.max(0, row.eitherPct - 10) }, false).verdict,
    "FAIL",
  )
  want(
    "a floor pinned at 0% with any damage FAILS (the hard 0% rule of #742/#743)",
    verdictFor(row, { ...base, eitherPct: 0 }, false).verdict,
    "FAIL",
  )
  want(
    "a CLEAN lane against a 0% floor still passes (the false-positive direction)",
    verdictFor({ ...row, eitherPct: 0, eitherFiles: 0 }, { ...base, eitherPct: 0 }, false).verdict,
    "pass",
  )
  want(
    "a moved sample is NOT a pass",
    verdictFor(row, { ...base, sampleDigest: "0000000000000000" }, false).verdict,
    "sample-moved",
  )
  want("an unpinned lane reports unpinned", verdictFor(row, undefined, false).verdict, "unpinned")
  want("an unpinned lane under --update-baseline reports pinned", verdictFor(row, undefined, true).verdict, "pinned")

  // The exit mapping, which is what a battery actually reads.
  want("exit code for fail", exitCodeFor("fail"), 1)
  want("exit code for needs-repin", exitCodeFor("needs-repin"), 2)
  want("exit code for pass", exitCodeFor("pass"), 0)
  want("exit code for pass-improved", exitCodeFor("pass-improved"), 0)

  if (bad.length) {
    console.error(`\nSELFTEST FAIL — ${bad.length} branch(es) do not behave as claimed:`)
    for (const b of bad) console.error(`  - ${b}`)
    process.exit(1)
  }
  console.log("\nSELFTEST PASS — every branch of the comparison is reachable and behaves as claimed")
  process.exit(0)
}

async function main() {
  if (SELFTEST) return await runSelfTest()
  if (CHILD_LANG && CHILD_REPO && CHILD_OUT) {
    const lane = laneList().find((l) => l.lang === CHILD_LANG && l.repo === CHILD_REPO)
    if (!lane) throw new Error(`unknown lane ${CHILD_REPO}:${CHILD_LANG}`)
    await measureLane(lane, CHILD_OUT)
    return
  }

  const lanes = laneList().filter(
    (l) => (!SCOPED_LANG || l.lang === SCOPED_LANG) && (!SCOPED_REPO || l.repo === SCOPED_REPO),
  )
  if (lanes.length === 0) {
    console.error(`no lane matches ${SCOPED_LANG ?? ""} ${SCOPED_REPO ?? ""}`)
    process.exit(2)
  }

  const baseline = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { lanes: Record<string, any> })
    : { lanes: {} as Record<string, any> }

  const work = mkdtempSync(path.join(tmpdir(), "bb-f10-"))
  const rows: any[] = []

  console.log(`\nM14.0.F10 — corpus parse-success floor${SAMPLE_LIMIT > 0 ? ` (cap ${SAMPLE_LIMIT}/lane)` : " (full extent)"}`)
  console.log(
    `${"lane".padEnd(26)} ${"files".padStart(6)} ${"either".padStart(14)} ${"ERROR".padStart(14)} ${"MISSING".padStart(14)} ${"err-lines med/max".padStart(18)}  VERDICT`,
  )

  for (const lane of lanes) {
    const outPath = path.join(work, `${lane.repo}__${lane.lang}.json`)
    const r = spawnSync(
      process.execPath,
      [
        process.argv[1],
        "--child-lang",
        lane.lang,
        "--child-repo",
        lane.repo,
        "--child-out",
        outPath,
        ...(SAMPLE_LIMIT > 0 ? ["--sample", String(SAMPLE_LIMIT)] : []),
      ],
      { stdio: ["ignore", "ignore", "inherit"], cwd: ROOT, env: process.env },
    )
    if (r.status !== 0 || !existsSync(outPath)) {
      throw new Error(`lane ${lane.key} child failed (rc=${r.status}): one fresh module per lane is the contract`)
    }
    rows.push(JSON.parse(readFileSync(outPath, "utf8")))
  }
  rmSync(work, { recursive: true, force: true })

  let failures = 0
  let improved = 0
  for (const row of rows) {
    if (row.skipped) {
      console.log(`${row.lane.padEnd(26)} ${"—".padStart(6)}  corpus absent — skipped`)
      row.verdict = "skip"
      continue
    }
    const pinned = baseline.lanes[row.lane]
    // The comparison is `verdictFor` — the same function the self-test drives.
    const v = verdictFor(row, pinned, UPDATE_BASELINE)
    row.verdict = v.verdict
    if (v.failed) failures++
    if (v.improved) improved++
    row.pinnedEitherPct = pinned?.eitherPct ?? null

    const fmt = (n: number) => `${n} (${row.files ? ((100 * n) / row.files).toFixed(1) : "0.0"}%)`
    console.log(
      `${row.lane.padEnd(26)} ${String(row.files).padStart(6)} ${fmt(row.eitherFiles).padStart(14)} ${fmt(row.errorFiles).padStart(14)} ${fmt(row.missingFiles).padStart(14)} ${`${row.errorLinesMedian}/${row.errorLinesMax}`.padStart(18)}  ${row.verdict}${row.capped ? " (capped)" : ""}`,
    )
  }

  // ------------------------------------------------------------- report tail
  const scored = rows.filter((r) => r.verdict !== "skip")
  console.log(`\nlanes measured: ${scored.length} | failures: ${failures} | improved (re-pin): ${improved}`)
  const worst = [...scored].sort((a, b) => b.eitherPct - a.eitherPct).slice(0, 8)
  console.log("worst eight by parse-failure rate (the family's grammar floor — not a recovery claim):")
  for (const w of worst) {
    console.log(
      `  ${w.lane.padEnd(26)} ${w.eitherPct.toFixed(1).padStart(5)}% of ${String(w.files).padStart(5)} files` +
        `  (ERROR ${w.errPct.toFixed(1)}% / MISSING ${w.missPct.toFixed(1)}%; damaged lines median ${w.errorLinesMedian}, max ${w.errorLinesMax})`,
    )
  }
  if (failures > 0) {
    console.log("\nREGRESSIONS:")
    for (const r of scored.filter((r) => r.verdict === "FAIL")) {
      console.log(`  ${r.lane}: ${r.eitherPct}% vs pinned ${r.pinnedEitherPct}%`)
    }
  }
  const moved = scored.filter((r) => r.verdict === "sample-moved")
  if (moved.length) {
    console.log(`\nsample-moved (disclosed, NOT compared — re-pin once the corpus is stable): ${moved.map((r) => r.lane).join(", ")}`)
  }

  // --------------------------------------------------------------- evidence
  // A lane that could not be compared is NOT a pass: the gate reports it and
  // exits 2 so a battery reads "needs re-pin" rather than green. A gate that
  // cannot fail on a moved corpus is the class this project keeps paying for.
  const verdict = failures > 0 ? "fail" : moved.length > 0 ? "needs-repin" : "pass"
  if (!SCOPED) {
    // Emitted through the shared harness, so the artifact carries the standard
    // governance/schema fields and G8 can see M14.0.F10's producer in source
    // (a hand-written JSON file is an ORPHAN artifact to that gate — which is how
    // the first draft of this gate failed it).
    const checks = scored.map((r) => ({
      id: `M14.0.F10.${r.lane}`,
      description: `parse-success floor for ${r.lane}: ${r.eitherPct}% of ${r.files} files carry an ERROR node or a MISSING token (floor ${r.pinnedEitherPct ?? "unpinned"})`,
      status: (r.verdict === "FAIL" ? "fail" : "pass") as "pass" | "fail",
      detail:
        `files=${r.files} ERROR=${r.errorFiles} MISSING=${r.missingFiles} either=${r.eitherFiles} ` +
        `damaged-lines median=${r.errorLinesMedian} max=${r.errorLinesMax} digest=${r.sampleDigest} verdict=${r.verdict}`,
    }))
    emitEvidence({
      issueId: "M14.0.F10",
      title: "corpus parse-success floor — how much of each corpus the pinned grammar can parse",
      claimLevel: "L1",
      layers: [
        "corpus routing (the pipeline's own detectLanguageFromPath, including the .h sniff)",
        "pinned grammar per lane (wasm), one fresh module per lane in its own child process",
        "per-lane floors in validation/m14/parse-success-baseline.json, sample-digest pinned",
      ],
      checks,
      limitations: [
        {
          description:
            "This measures the GRAMMAR's surface, not recovery quality: symbols flow through an ERROR region, so a high rate and a zero rate can both be 'no symbol loss' — that is why F5 stays green and why this gate exists separately.",
        },
        {
          description:
            "The corpora are local checkouts; each lane records its repo pin so a moved corpus is visible beside its floor.",
        },
        {
          description:
            "A lane whose candidate set changed reports sample-moved and is NOT compared — the honest state, not a pass. The gate exits 2 in that case.",
        },
        {
          description:
            "The rate is the full production-routed surface, so the c figure includes plain C headers and the cpp figure includes the headers production sniffs as C++. The per-extension split is recorded beside every row so these reconcile with the .c-only census in reviews/m49-w17-parse-success-census.md.",
        },
      ],
      corpusPins: Object.fromEntries(
        scored.filter((r) => r.repoPin).map((r) => [r.repo, r.repoPin]),
      ),
      data: {
        method:
          "files routed by the pipeline's detectLanguageFromPath, ordered by a hash of their relative path and capped deterministically; each lane parsed in its own child process with a fresh module; ERROR nodes and MISSING tokens counted separately; the rate compared against a pinned per-lane floor whose sample digest must match",
        sampleLimit: SAMPLE_LIMIT > 0 ? SAMPLE_LIMIT : null,
        baseline: path.relative(ROOT, BASELINE_PATH),
        ...provenance(),
        rows,
        failures,
        improved,
        verdict,
      },
    })
    console.log(`\nwrote ${path.relative(ROOT, EVIDENCE_PATH)}`)
  } else {
    console.log("\nscoped run — M14.0.F10 NOT written (the canonical artifact is the full lane set)")
  }

  if (UPDATE_BASELINE && !SCOPED) {
    const next = {
      gate: "M14.0.F10",
      purpose:
        "Per-lane parse-success floors. A floor is the measured failure rate on a deterministic, digest-pinned sample; the gate fails when a lane exceeds it. Re-pin only with --update-baseline, only for the whole lane set, and only when the change is understood.",
      establishedAt: new Date().toISOString(),
      ...provenance(),
      sampleLimit: SAMPLE_LIMIT > 0 ? SAMPLE_LIMIT : null,
      lanes: Object.fromEntries(
        scored.map((r) => [
          r.lane,
          {
            repo: r.repo,
            lang: r.lang,
            repoPin: r.repoPin,
            sampleLimit: r.sampleLimit,
            files: r.files,
            sampleDigest: r.sampleDigest,
            eitherPct: r.eitherPct,
            errPct: r.errPct,
            missPct: r.missPct,
            errorLinesMedian: r.errorLinesMedian,
            errorLinesMax: r.errorLinesMax,
          },
        ]),
      ),
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n")
    console.log(`wrote ${path.relative(ROOT, BASELINE_PATH)} (${Object.keys(next.lanes).length} lane floors)`)
  }

  if (verdict === "needs-repin") {
    console.log("\nexit 2: at least one lane could not be compared (sample moved). Re-pin with --update-baseline once the corpus is stable.")
  }
  process.exit(exitCodeFor(verdict))
}

main()
