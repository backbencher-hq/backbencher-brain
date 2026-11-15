/**
 * DECLARATION SPAN ANCHOR — the before/after for the M60 containment fix.
 *
 * ## WHAT CHANGED, AND WHAT THIS FILE PROVES ABOUT IT
 *
 * `src/ast/real-xml-analyzer.ts` anchored a vocabulary DECLARATION's symbol range to the
 * `name=` Attribute node whenever the value shared the attribute's line (M19). That is the
 * right LINE and the wrong SPAN: the declaration's range landed inside its own element, so
 * every `contains` edge from a declaration to a child construct had a target outside its
 * source, and the attribute symbol `name` occupied the identical byte range as the
 * declaration itself. The fix anchors to the ELEMENT when the tag, the attribute and the
 * value all share one line — the only shape in which the element's row and the attribute's
 * row are the same row, so the reported line cannot move.
 *
 * The claim this file exists to test is therefore narrow and falsifiable:
 *
 *   **no symbol's reported startLine changes, no symbol is added or removed, and the
 *   number of byte ranges held by two or more distinct names falls.**
 *
 * ## WHY IT SPAWNS A CHILD PROCESS PER LEG, AND WHY THAT IS NOT A DETAIL
 *
 * Each leg runs in its own `tsx` process. Two earlier versions of this comparison ran both
 * legs in ONE process, and both produced a vacuous pass for the same reason:
 *
 *   1. The analyzer path was built with three `..` from `validation/m14/fixtures/xml`, which
 *      lands on `validation/` and not the repo root. `git stash push -- <path that does not
 *      exist>` prints a warning, stashes nothing, and exits 0 — so both legs ran the
 *      MODIFIED analyzer and the run reported 0 lines moved.
 *   2. With the path fixed, `parseFile` is imported once at module scope and the analyzer
 *      module is then CACHED, so popping the stash changed the bytes on disk without
 *      changing the module the second leg was already holding. BEFORE and AFTER came out
 *      byte-identical at 369 colliding spans, which is the number HEAD produces — i.e. the
 *      second leg never saw the fix at all.
 *
 * A fresh process per leg removes the second failure by construction, and the stash is
 * ASSERTED after it is taken so the first cannot recur silently: if the working tree is
 * still dirty for that path, this exits 2 rather than comparing two identical runs.
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It says nothing about whether the wider span is the RIGHT span for a consumer. It
 * establishes only that the change is invisible to line-addressed consumers, which is the
 * risk the M19 fix was written to remove. Whether containment becomes verifiable is
 * measured by `validation/m14/fixtures/xml/containment-ledger.mts`, which is the instrument
 * that found the defect.
 *
 * CLI: npx tsx validation/m14/fixtures/xml/declaration-span-before-after.mts [--json OUT]
 */
import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WORKERS = Number(process.env.BB_XML_WORKERS ?? "1")
const MAX_FILES = Number(process.env.BB_SPAN_MAX ?? "0")
const HERE = import.meta.dirname
const SELF = path.join(HERE, "declaration-span-before-after.mts")
const outArg = process.argv.indexOf("--json")
const OUT = outArg >= 0 ? process.argv[outArg + 1]! : path.join(HERE, "declaration-span-before-after.json")
const REL_ANALYZER = "src/ast/real-xml-analyzer.ts"

type Leg = { rows: { key: string; startLine: number; startIndex: number }[]; symbols: number; spanCollisions: number; collisionDetail: string[]; nonNumericSpans: number }

const { detectLanguageFromPath } = (await import("../../../../src/ast/language-detection")) as any

// ── the corpus, on the gate's own rule ───────────────────────────────────────
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      // `isDirectory()` is load-bearing, not defensive: `git ls-files` lists a GITLINK
      // entry and a directory passes a bare `.size > 512 * 1024` test on most filesystems,
      // so the next line reads a directory and dies with EISDIR. The corpus has at least
      // one submodule and the first version of this file found it.
      if (statSync(abs).isDirectory()) continue
      if (statSync(abs).size > 512 * 1024) continue
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "xml") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
const admittedTotal = files.length
const admitted = MAX_FILES > 0 ? files.slice(0, MAX_FILES) : files

// ── the child: one leg, in its own process ───────────────────────────────────
if (process.argv.includes("--leg")) {
  // The file list is READ, not rediscovered. Discovery reads every tracked file under
  // 512 KiB in ~114 repositories to run `detectLanguageFromPath` on it, which is minutes
  // of the run — and doing it once per leg meant the two legs spent most of their time
  // re-reading 6 GB of corpus instead of parsing XML. It also makes the two legs
  // comparable by construction rather than by the discovery being deterministic.
  const listIn = process.argv[process.argv.indexOf("--leg-in") + 1]
  const expect = Number(process.argv[process.argv.indexOf("--leg-expect") + 1])
  if (!listIn) throw new Error("--leg needs --leg-in PATH")
  // JSON, not a delimited list. The first version wrote `repo\tdir\trel` and parsed it
  // with a `lastIndexOf("\t")` written for THREE fields, so `dir` and `abs` both came out
  // empty, `parseFile("")` threw EISDIR, and the parent — which does not check the child's
  // stderr unless the exit code is non-zero — read a partial file and reported a claim over
  // a handful of files. 369 -> 154 is what that produced; the real figures are 0.
  const loaded = JSON.parse(readFileSync(listIn, "utf8")) as { repo: string; dir: string; rel: string; abs: string }[]
  if (!Number.isFinite(expect) || loaded.length !== expect) {
    throw new Error(`file list holds ${loaded.length} entries, expected ${expect} — refusing to report a comparison over a different population than the parent drew`)
  }
  files.length = 0
  for (const f of loaded) {
    if (statSync(f.abs).isDirectory()) throw new Error(`file list names a directory: ${f.abs}`)
    files.push(f)
  }
  const { parseFile } = (await import("../../../../src/ast/pool-worker")) as any
  const rows: Leg["rows"] = []
  let symbols = 0
  const spanOwners = new Map<string, Set<string>>()
  const spanFile = new Map<string, string>()
  let cursor = 0
  let nonNumericSpans = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= admitted.length) return
      const f = admitted[i]
      // `parseFile(filePath, projectPath)` — the second argument is the PROJECT path.
      const r = await parseFile(f.abs, f.dir)
      const file = `${f.repo}/${f.rel}`
      for (const s of r.symbols ?? []) {
        symbols++
        if (typeof s.startIndex !== "number" || typeof s.endIndex !== "number") nonNumericSpans++
        // Keyed by FILE as well as by range. The third defect in this probe, and the
        // one that produced the number that looked most like a finding: 154 "collisions"
        // after a fix that the ledger measured as 0. Byte offsets repeat across files —
        // `name="name"` at 3332..3343 in gtksourceview's language.rng and `name="bold"` at
        // 3332..3343 in another file in the same draw are two attributes in two documents,
        // not two names at one range. Every other instrument in this lane keys per file
        // (containment-ledger.mts counts inside its per-file loop), so this one did not,
        // and the two disagreed about a named property of the same 400 files.
        const span = `${file}\u0000${s.startIndex}\u0000${s.endIndex}`
        const set = spanOwners.get(span) ?? new Set<string>()
        set.add(s.name)
        spanOwners.set(span, set)
        if (!spanFile.has(span)) spanFile.set(span, file)
        rows.push({ key: `${file}\u0000${s.name}\u0000${s.ownerName ?? ""}`, startLine: s.startLine, startIndex: s.startIndex })
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, () => worker()))
  let spanCollisions = 0
  const collisionDetail: string[] = []
  for (const [span, set] of spanOwners) {
    if (set.size < 2) continue
    spanCollisions++
    if (collisionDetail.length < 20) collisionDetail.push(`${spanFile.get(span)} ${span.split("\u0000").slice(1).join("..")} :: ${[...set].sort().join(" + ")}`)
  }
  // Written to a FILE, not to stdout. The payload carries real NUL bytes (the row key
  // separator) and the first version piped it through `process.stdout.write` into the
  // parent's `spawnSync` buffer, where one of them arrived as a truncated escape and
  // `JSON.parse` refused the lot. A file also stops a multi-megabyte payload from being
  // at the mercy of a pipe buffer.
  const legOut = process.argv[process.argv.indexOf("--leg-out") + 1]
  if (!legOut) throw new Error("--leg needs --leg-out PATH")
  writeFileSync(legOut, JSON.stringify({ rows, symbols, spanCollisions, collisionDetail, nonNumericSpans } satisfies Leg))
  process.exit(0)
}

// ── the parent: two child processes, one per revision ────────────────────────
console.error(`declaration-span-before-after: ${admitted.length} admitted files (${admittedTotal} discovered), ${WORKERS} worker(s)`)
if (admittedTotal === 0) throw new Error("no files admitted — the corpus root is wrong")

const LIST = "/tmp/opencode/declaration-span-files.json"
writeFileSync(LIST, JSON.stringify(admitted.map((f) => ({ repo: f.repo, dir: f.dir, rel: f.rel, abs: f.abs }))))

const dirty = execFileSync("git", ["status", "--porcelain", "--", REL_ANALYZER], { encoding: "utf8" }).trim()
if (dirty.length === 0) {
  console.error(`REFUSING TO RUN: ${REL_ANALYZER} is clean, so there is no change to compare and both legs would read the same bytes.`)
  process.exit(2)
}
execFileSync("git", ["stash", "push", "--", REL_ANALYZER], { stdio: "ignore" })

/**
 * And the three defects this file's own header now names, all of which produced a
 * confident wrong number rather than a crash: the stash path resolved outside the repo so
 * both legs read one revision; the analyzer module was cached so the second leg read the
 * first leg's bytes; and the collision map was keyed by byte range alone, across files.
 *
 * A `timeout`-killed run must not leave the working tree reverted. `finally` does not run
 * when node is terminated by SIGTERM, and the first full-population attempt of this probe
 * was killed at 900 s that way — which left `src/ast/real-xml-analyzer.ts` stashed, the
 * NEXT run refusing for the wrong reason ("no change to compare"), and the change itself
 * sitting in `stash@{0}` where it was nearly lost. The handler pops and then re-raises.
 */
let stashPopped = false
const popStash = (): void => {
  if (stashPopped) return
  stashPopped = true
  try {
    execFileSync("git", ["stash", "pop"], { stdio: "ignore" })
  } catch {
    // Nothing to pop, or a conflict. The next run's refusal check is the backstop.
  }
}
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => {
    popStash()
    process.exit(1)
  })
}
const stillDirty = execFileSync("git", ["status", "--porcelain", "--", REL_ANALYZER], { encoding: "utf8" }).trim()
if (stillDirty.length > 0) {
  console.error(`REFUSING TO RUN: git stash push -- ${REL_ANALYZER} left the working tree dirty, so the BEFORE leg would read the same bytes as the AFTER leg.`)
  process.exit(2)
}

const runLeg = (label: string, tag: string): Leg => {
  const legOut = `/tmp/opencode/declaration-span-${tag}.json`
  const r = spawnSync("npx", ["tsx", SELF, "--leg", "--leg-in", LIST, "--leg-expect", String(admitted.length), "--leg-out", legOut], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`${label} leg failed (exit ${r.status}): ${(r.stderr ?? "").slice(-4000)}`)
  if (r.stderr && r.stderr.includes("Error") && !r.stderr.includes("[INFO]")) {
    throw new Error(`${label} leg printed an error the exit code did not reflect: ${r.stderr.slice(-2000)}`)
  }
  const leg = JSON.parse(readFileSync(legOut, "utf8")) as Leg
  console.error(`  ${label}: ${leg.symbols} symbols, ${leg.rows.length} keyed rows, ${leg.spanCollisions} spans held by 2+ names, ${leg.nonNumericSpans} symbols without a numeric span`)
  for (const d of leg.collisionDetail.slice(0, 6)) console.error(`    collide ${d}`)
  return leg
}

let before: Leg
try {
  console.error(`before leg: ${REL_ANALYZER} at HEAD (working-tree change stashed)`)
  before = runLeg("BEFORE", "before")
} finally {
  popStash()
}
console.error("after leg: working-tree change restored")
const after = runLeg("AFTER", "after")
if (execFileSync("git", ["status", "--porcelain", "--", REL_ANALYZER], { encoding: "utf8" }).trim().length === 0) {
  console.error("REFUSING TO REPORT: the working tree is clean after the pop, so the AFTER leg read the same bytes as the BEFORE leg.")
  process.exit(2)
}

// ── compare ──────────────────────────────────────────────────────────────────
const beforeByKey = new Map(before.rows.map((r) => [r.key, r]))
const afterByKey = new Map(after.rows.map((r) => [r.key, r]))
let startLineMoved = 0
let startIndexMoved = 0
const movedExamples: string[] = []
for (const [key, a] of afterByKey) {
  const b = beforeByKey.get(key)
  if (!b) continue
  if (b.startLine !== a.startLine) {
    startLineMoved++
    if (movedExamples.length < 20) movedExamples.push(`startLine ${key.replaceAll("\u0000", " ")} ${b.startLine} -> ${a.startLine}`)
  }
  if (b.startIndex !== a.startIndex) startIndexMoved++
}
let onlyBefore = 0
for (const key of beforeByKey.keys()) if (!afterByKey.has(key)) onlyBefore++
let onlyAfter = 0
for (const key of afterByKey.keys()) if (!beforeByKey.has(key)) onlyAfter++

const report = {
  generatedBy: "validation/m14/fixtures/xml/declaration-span-before-after.mts",
  claim: "anchoring an all-on-one-line vocabulary declaration to the ELEMENT instead of the name= Attribute changes no symbol's reported startLine, adds and removes no symbol, and reduces the number of byte ranges held by two or more distinct names",
  method: "two child processes, one per revision, each importing the analyzer fresh; the working-tree change is stashed for the BEFORE leg and the stash is asserted both ways",
  corpus: { root: CR, admittedTotal, admitted: admitted.length, workers: WORKERS },
  before: { symbols: before.symbols, spansHeldByTwoOrMoreNames: before.spanCollisions },
  after: { symbols: after.symbols, spansHeldByTwoOrMoreNames: after.spanCollisions },
  delta: {
    symbols: after.symbols - before.symbols,
    startLineMoved,
    startIndexMoved,
    rowsOnlyInBefore: onlyBefore,
    rowsOnlyInAfter: onlyAfter,
    spansHeldByTwoOrMoreNames: after.spanCollisions - before.spanCollisions,
    movedExamples,
  },
  limitations: [
    "The comparison is on (name, ownerName) as the worker publishes them. A symbol whose NAME changed appears as one row removed and one added rather than as a moved line, so both are counted and reported separately.",
    "production parseFile does not forward metadata.isVocabDeclaration or metadata.elementRange — pool-worker's symbol metadata is a WHITELIST — so the shape population cannot be counted through this entry point. The residual cost of the partial fix is measured by containment-ledger.mts instead, which counts the edges whose containment is still unverifiable.",
    "It runs on the gate's own population (every git-tracked file the router hands to the XML analyzer) unless BB_SPAN_MAX bounds it, and the bound is printed rather than assumed.",
  ],
}
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)
console.error(`wrote ${OUT}`)
console.log(
  [
    `symbols                   ${before.symbols} -> ${after.symbols}  (${report.delta.symbols >= 0 ? "+" : ""}${report.delta.symbols})`,
    `spans held by 2+ names    ${before.spanCollisions} -> ${after.spanCollisions}  (${report.delta.spansHeldByTwoOrMoreNames >= 0 ? "+" : ""}${report.delta.spansHeldByTwoOrMoreNames})`,
    `startLine moved           ${startLineMoved}`,
    `rows only in BEFORE/AFTER ${onlyBefore} / ${onlyAfter}`,
  ].join("\n"),
)
if (startLineMoved !== 0 || onlyBefore !== 0 || onlyAfter !== 0 || after.symbols !== before.symbols || report.delta.spansHeldByTwoOrMoreNames >= 0) {
  console.error(`CLAIM FALSIFIED by this run`)
  process.exit(2)
}
console.error(`CLAIM HOLDS on this population`)
