// script/m60/analyzer-complexity-gate.ts — dimension 9 of the lane-audit formula,
// and M12's own `complexityContract`, made adjudicable.
//
// WHY THIS EXISTS
// ---------------
// `reviews/LANE-AUDIT-FORMULA.md` §9 asks a lane for a *scored* complexity row:
//
//   "Measure the analyzer (parse + analyze) and the product entry (parseFile)
//    separately, normalized per 1k nodes and in a fixed size band, against a
//    sibling language in the same family ... **Every perf row carries a load
//    context.** A row measured under concurrent load is unscored, not evidence
//    (#871; the C row was 10x inflated with no disclosure — #909)."
//
// Owner standard (`reviews/m60-oo-family-plan.md` §3.7/R6) asks for the same thing
// per lane on two real corpora plus "a census of the static shape that causes it
// (repeated full-tree queries inside a visitor, which is how an analyzer becomes
// quadratic on a big file)".
//
// Measured at HEAD, none of that is enforced. The cell reads green because
// `script/verify-m12-final-audit.ts` asks only whether the artifact EXISTS:
//
//   const complexity = existsSync(resolve(resultsDir, `${lang}-complexity.json`))
//
// Forty-one artifacts exist. #909 was diagnosed on the C lane, fixed in the shared
// harness (`script/m12/measure-analyzer.ts` now records the file set, the load
// context and the extension rule) and verified for **c and cpp only**. The rule was
// never swept to the family — the exact mechanism M60 exists to kill ("a milestone
// says a rule ONCE, for the lane that exposed it, and the rule is then the
// FAMILY's"). Measured HEAD state, this gate's own first run:
//
//   * 41 artifacts, **3 different shapes** — `per_analyzer_complexity:<lang>` with
//     an idempotent `runs` array (25 lanes), `<lang>_corpus_tracked_complexity`
//     with a single `measurement` (6 lanes), and a bare flat measurement with no
//     `kind` at all (10 lanes). Nothing reconciles them.
//   * **2** carry an attribution frame (c, cpp). The other 39 carry a wall-time
//     number that cannot be told apart from a heavy file set or a loaded box.
//   * **18 of 41** analyzer docs declare a budget. M12's `complexityContract`
//     requires `declared_budget_per_analyzer`; 23 lanes satisfy it by prose silence,
//     and the 18 that do declare one are prose nothing parses — the fsharp lane's
//     declaration trails off mid-sentence ("376-file corpus dominated by") and no
//     gate ever noticed.
//
// So the class this instrument makes un-recurrable is not "an analyzer is slow". It
// is "an envelope row was scored without the two facts that make it a measurement".
//
// WHAT IT ADJUDICATES
// -------------------
// Per lane (`src/ast/real-*-analyzer.ts`, the 41-lane universe M12-FINAL-AUDIT
// names) it reads the committed artifact, the lane's declared budget, and returns
// exactly one verdict, worst-reason-wins:
//
//   within-budget      frame complete, count matches the declaration, row <= budget
//   over-budget        frame complete, count matches, and the row exceeds it
//                      (or throughput falls below the declared floor)
//   count-mismatch     frame complete, but the artifact measured a different file
//                      count than the declaration names, so the comparison is not
//                      like-for-like — reported, never scored as a pass
//   no-budget-declared the doc never declares one (M12's contract, unmet)
//   budget-unparsed    the doc declares one and nothing machine-readable came out
//   unscorable         the artifact exists and carries NO frame: #871's "not
//                      evidence", the class #909 fixed for two lanes
//   absent             no artifact
//
// LIKE-FOR-LIKE IS PART OF THE MEASUREMENT
// ----------------------------------------
// The repo has already paid for comparing two different file sets and calling the
// difference a regression (`reviews/m60-c-lane-audit.md`, the #909 correction). A
// declared "400-file corpus < 60 s" and a 141-file artifact are not comparable, so
// this gate refuses to convert the difference into a pass OR a failure: it reports
// `count-mismatch` and prints both counts. Normalizing by files would assume the
// linearity that §9 exists to test.
//
// ENFORCEMENT IS STAGED, DELIBERATELY
// -----------------------------------
// The census is new and 39 lanes carry unadjudicated debt, so failing on that debt
// on day one would be the mirror of the "gate that cannot fail" class this program
// keeps finding. `--gate` therefore hard-fails on exactly the events that mean a
// NUMBER MOVED: a registered lane missing, a lane's severity worse than registered,
// an unregistered lane arriving with a timed corpus row, a registered artifact
// vanishing. Improvements are printed and require `--strict` to fail, because the
// register must be re-emitted in the same commit that improves a lane (the
// deliberate-act rule `symbol-sentinel-register.json` uses).
//
// Run:
//   bun script/m60/analyzer-complexity-gate.ts                  # print + self-tests
//   bun script/m60/analyzer-complexity-gate.ts --emit            # + the artifact
//   bun script/m60/analyzer-complexity-gate.ts --update-register # + the register
//   bun script/m60/analyzer-complexity-gate.ts --gate [--strict] # adjudicate
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const DOC_DIR = path.join(ROOT, "docs/analyzers")
const RESULTS_DIR = path.join(ROOT, "validation/m12/results")
const OUT = path.join(ROOT, "validation/m60/results/analyzer-complexity.json")
const REGISTER = path.join(ROOT, "validation/m60/analyzer-budget-register.json")

/**
 * THE LANE UNIVERSE IS THE MILESTONE'S OWN, NOT THIS SCRIPT'S.
 *
 * M12's own audit (`script/verify-m12-final-audit.ts`) enumerates
 * `validation/m12/fixtures/*` and looks for `<dir>-complexity.json` or
 * `<dir>-corpus-complexity.json`. Those directory names are therefore the lane keys
 * every M12 artifact is named by — `make` and `objective-c`, not `makefile`/`objc`.
 *
 * Measured while building this gate: deriving lanes from `src/ast/real-*-analyzer.ts`
 * instead reads the makefile lane as ABSENT, because its analyzer is
 * `real-makefile-analyzer.ts` while its artifact is `make-corpus-complexity.json`. One
 * lane, two vocabularies, no gate that could see the split — the same "milestone says a
 * name once" seam this program keeps finding. The analyzer alias below is the second
 * direction of `family-closure.ts`'s ANALYZER_FILE_ALIAS and is measured, not assumed:
 * a lane whose analyzer cannot be resolved is REPORTED, never silently skipped.
 */
const LANE_ANALYZER_ALIAS: Record<string, string> = { make: "real-makefile-analyzer.ts" }

/** The repo's two artifact spellings for one lane: `<key>-complexity.json` (the shared
 *  harness) and `<key>-corpus-complexity.json` (the older per-lane measure scripts). */
function artifactPath(lang: string): string | null {
  for (const name of [`${lang}-complexity.json`, `${lang}-corpus-complexity.json`]) {
    const p = path.join(RESULTS_DIR, name)
    if (existsSync(p)) return p
  }
  return null
}

/** The lane's doc, under either spelling (docs follow the LANE key; the analyzer file
 *  name is the fallback, because `make`'s doc is `real-make-analyzer.md`). */
export function docFor(lang: string): string | null {
  const candidates = [`real-${lang}-analyzer.md`, LANE_ANALYZER_ALIAS[lang]?.replace(/\.ts$/, ".md") ?? ""].filter(Boolean)
  for (const c of candidates) {
    const p = path.join(DOC_DIR, c)
    if (existsSync(p)) return p
  }
  return null
}

/** The lane's analyzer file, alias-aware, or null with the reason. */
export function analyzerFor(lang: string): string | null {
  const p = path.join(ROOT, "src/ast", LANE_ANALYZER_ALIAS[lang] ?? `real-${lang}-analyzer.ts`)
  return existsSync(p) ? path.relative(ROOT, p) : null
}

export interface TimedRow {
  label: string
  files: number
  wallMs: number
  userCpuMsPerFile: number | null
  loadAvg1: number | null
  loadQuiet: boolean | null
  symbols: number | null
  relationships: number | null
}

export interface Frame {
  artifact: string
  /** `per_analyzer` = measure-analyzer.ts, `corpus_tracked`/`flat_corpus` = the older shapes. */
  shape: "per_analyzer" | "corpus_tracked" | "flat_corpus" | "unreadable"
  kind: string | null
  /** #909's three facts: the set, the extension rule, and the load it ran under. */
  hasLoadRule: boolean
  hasManifest: boolean
  setDigest: string | null
  manifestFileCount: number | null
  extensionFiltered: boolean | null
  extensions: string | null
  revision: string | null
  timedRows: TimedRow[]
  corpusRows: number
  /** Prose that records the corpus rule (older shapes), when present. */
  policyProse: string[]
  shapeError: string | null
}

/**
 * #909's frame, per shape. The older shapes are NOT treated as frameless by fiat:
 * each required fact is checked for presence, so the reason a lane is unscorable is
 * always named (missing load context is the one that bites all 39).
 */
export function readFrame(file: string, raw: string): Frame {
  const base: Frame = {
    artifact: path.relative(ROOT, file),
    shape: "unreadable",
    kind: null,
    hasLoadRule: false,
    hasManifest: false,
    setDigest: null,
    manifestFileCount: null,
    extensionFiltered: null,
    extensions: null,
    revision: null,
    timedRows: [],
    corpusRows: 0,
    policyProse: [],
    shapeError: null,
  }
  let doc: any
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    return { ...base, shapeError: `unparsable JSON: ${String((e as Error).message).slice(0, 120)}` }
  }
  if (!doc || typeof doc !== "object") return { ...base, shapeError: "not a JSON object" }

  const kind: string | null = typeof doc.kind === "string" ? doc.kind : null
  const isPerAnalyzer = typeof kind === "string" && kind.startsWith("per_analyzer_complexity:")
  const isTracked = typeof kind === "string" && kind.endsWith("_corpus_tracked_complexity")
  // The flat shape is identified by its own vocabulary, never by "everything else":
  // an unrecognised shape must report as unreadable, not silently pass.
  const looksFlat = !kind && typeof doc.wallTimeMs === "number" && typeof doc.files === "number"
  const shape: Frame["shape"] = isPerAnalyzer ? "per_analyzer" : isTracked ? "corpus_tracked" : looksFlat ? "flat_corpus" : "unreadable"

  const manifest = doc.corpusManifest ?? null
  const hasManifest = !!manifest && typeof manifest === "object"
  const setDigest = hasManifest && typeof manifest.setDigest === "string" ? manifest.setDigest : null
  const manifestFileCount = hasManifest && typeof manifest.fileCount === "number" ? manifest.fileCount : null
  const extensionFiltered = hasManifest && typeof manifest.extensionFiltered === "boolean" ? manifest.extensionFiltered : null
  const extensions = hasManifest && Array.isArray(manifest.extensions) ? manifest.extensions.join(",") : null

  const toRow = (label: string, m: any): TimedRow => ({
    label,
    files: typeof m?.files === "number" ? m.files : 0,
    wallMs: typeof m?.wallTimeMs === "number" ? m.wallTimeMs : Number.NaN,
    userCpuMsPerFile: typeof m?.userCpuMsPerFile === "number" ? m.userCpuMsPerFile : null,
    loadAvg1: typeof m?.loadAvg1 === "number" ? m.loadAvg1 : null,
    loadQuiet: typeof m?.loadQuiet === "boolean" ? m.loadQuiet : null,
    symbols: typeof m?.symbols === "number" ? m.symbols : null,
    relationships: typeof m?.relationships === "number" ? m.relationships : null,
  })

  const timedRows: TimedRow[] = []
  if (Array.isArray(doc.runs)) {
    for (const r of doc.runs) {
      if (!r || typeof r !== "object") continue
      if (typeof r.wallTimeMs === "number") timedRows.push(toRow(String(r.name ?? "run"), r))
      else if (r.measurement && typeof r.measurement.wallTimeMs === "number") timedRows.push(toRow(String(r.name ?? "run"), r.measurement))
    }
  } else if (doc.measurement && typeof doc.measurement.wallTimeMs === "number") {
    timedRows.push(toRow(String(doc.measurement.name ?? kind ?? "measurement"), doc.measurement))
  } else if (typeof doc.wallTimeMs === "number") {
    timedRows.push(toRow(String(doc.name ?? "corpus"), doc))
  }

  const corpusRows = timedRows.filter((r) => !/fixture/i.test(r.label)).length
  const policyProse = [doc.complexityPolicy, doc.corpusPolicy, doc.note].filter((s) => typeof s === "string") as string[]

  return {
    artifact: base.artifact,
    shape,
    kind,
    hasLoadRule: typeof doc.loadRule === "string" && doc.loadRule.length > 0,
    hasManifest,
    setDigest,
    manifestFileCount,
    extensionFiltered,
    extensions,
    revision: typeof doc.revision === "string" ? doc.revision : null,
    timedRows,
    corpusRows,
    policyProse,
    shapeError: shape === "unreadable" ? `unrecognised artifact shape (kind=${kind ?? "none"})` : null,
  }
}

/** Why a frame cannot score a row — named, never a bare false. */
export function frameGaps(f: Frame): string[] {
  const gaps: string[] = []
  if (f.shape === "unreadable") gaps.push(f.shapeError ?? "unrecognised artifact shape")
  if (f.timedRows.length === 0) gaps.push("no timed row at all")
  if (f.corpusRows === 0) gaps.push("fixtures-only: no corpus row")
  if (!f.hasLoadRule) gaps.push("no loadRule (#871: a row without load context is not scored)")
  if (!f.hasManifest) gaps.push("no corpusManifest (#909: which files were measured is not recorded)")
  else {
    if (!f.setDigest) gaps.push("corpusManifest has no setDigest (the file set is not re-derivable)")
    if (f.extensionFiltered === false) gaps.push("extensionFiltered=false: EVERY file in the directory is measured under this language's name")
  }
  if (f.shape === "per_analyzer") {
    for (const r of f.timedRows) {
      if (/fixture/i.test(r.label)) continue
      if (r.loadAvg1 === null) gaps.push(`corpus row "${r.label}" carries no loadAvg1`)
      if (r.loadQuiet === false) gaps.push(`corpus row "${r.label}" was measured on a busy box (loadQuiet=false)`)
      if (r.userCpuMsPerFile === null) gaps.push(`corpus row "${r.label}" carries no userCpuMsPerFile (the load-stable number)`)
    }
  }
  return gaps
}

// ============================================================================
// The declared budget — parsed from the lane's own doc, with what failed to parse
// returned rather than swallowed.
// ============================================================================
export interface Budget {
  source: string | null
  raw: string | null
  fixturesMs: number | null
  corpusMs: number | null
  corpusFiles: number | null
  symbolsPerSecMin: number | null
  relationshipsPerSecMin: number | null
  /** The doc's own "(met: N s)" self-report, when it makes one — reported, never trusted. */
  selfReportedFixturesMs: number | null
  /** Fragments that look like a bound but yielded no number. A parse miss is data. */
  unparsed: string[]
}

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, min: 60_000 }

function toMs(n: string, unit: string): number | null {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  const m = UNIT_MS[unit.toLowerCase()]
  return m ? Math.round(v * m) : null
}

/** The budget paragraph: the line declaring it plus any continuation lines up to a blank. */
export function budgetParagraph(doc: string): { text: string; line: number } | null {
  const lines = doc.split("\n")
  const start = lines.findIndex((l) => /declared budget/i.test(l))
  if (start < 0) return null
  let end = start
  while (end + 1 < lines.length && lines[end + 1].trim() !== "" && !/^#{1,6}\s/.test(lines[end + 1])) end++
  return { text: lines.slice(start, end + 1).join(" "), line: start + 1 }
}

export function parseBudget(doc: string, source: string | null): Budget {
  const para = budgetParagraph(doc)
  if (!para) {
    return {
      source: null, raw: null, fixturesMs: null, corpusMs: null, corpusFiles: null,
      symbolsPerSecMin: null, relationshipsPerSecMin: null, selfReportedFixturesMs: null, unparsed: [],
    }
  }
  const text = para.text
  const unparsed: string[] = []

  const fixturesMatch = text.match(/fixtures?[^;]{0,40}?<\s*([\d.]+)\s*(ms|s|min)\b/i)
  const fixturesMs = fixturesMatch ? toMs(fixturesMatch[1], fixturesMatch[2]) : null

  // A bound only counts as the corpus bound when "corpus" appears in the same clause.
  const corpusMatch = text.match(/corpus[^;]{0,60}?<\s*([\d.]+)\s*(ms|s|min)\b/i)
  const corpusMs = corpusMatch ? toMs(corpusMatch[1], corpusMatch[2]) : null

  const filesMatch =
    text.match(/(\d[\d,]{0,6})[-\s]*file\s+corpus/i) ??
    text.match(/corpus\s*(?:subset\s*)?\((\d[\d,]{0,6})\s*files?\)/i) ??
    text.match(/(\d[\d,]{0,6})\s*files?\)?[^;]{0,20}?<\s*[\d.]+\s*(?:ms|s|min)\b/i)
  const corpusFiles = filesMatch ? Number(filesMatch[1].replace(/,/g, "")) : null

  const symMatch = text.match(/symbols\/s\s*[≥>=]+\s*([\d,]+)/i)
  const relMatch = text.match(/relationships\/s\s*[≥>=]+\s*([\d,]+)/i)
  const metMatch = text.match(/met:\s*([\d.]+)\s*(ms|s|min)\b/i)

  // A clause that NAMES a corpus and a size but yields no bound is a parse miss, not a
  // silence: the fsharp lane's declaration stops mid-sentence ("376-file corpus
  // dominated by") and the typescript lane's names a count with no bound ("The 399-file
  // corpus subset is"). Both must read as unpaid work, never as "no budget declared".
  const namesCorpusSize = (clause: string) =>
    /\d[\d,]*[-\s]*file\s+corpus/i.test(clause) || /corpus\s*(?:subset\s*)?\(?\d[\d,]*\s*files?\)?/i.test(clause)
  // Split on `;` AND on a period followed by whitespace, so a declaration that names a
  // corpus count in a NEW sentence is still a segment of its own: typescript's
  // "... fixtures < 2 s (met: 0.23 s). The 399-file corpus subset is ..." names 399 files
  // with no bound, and a whole-paragraph test let the earlier fixture bound mask it.
  // (Split points are `; ` and `.) ` shapes; a decimal point is not followed by whitespace.)
  for (const clause of text.split(/[;]|\.\s+/)) {
    if (!namesCorpusSize(clause)) continue
    if (!/<\s*[\d.]+\s*(?:ms|s|min)\b/i.test(clause)) unparsed.push(clause.trim().slice(0, 120))
  }
  if (!fixturesMatch && !namesCorpusSize(text)) unparsed.push(text.trim().slice(0, 120))

  return {
    source: source ? `${source}:${para.line}` : null,
    raw: text.trim(),
    fixturesMs,
    corpusMs,
    corpusFiles,
    symbolsPerSecMin: symMatch ? Number(symMatch[1].replace(/,/g, "")) : null,
    relationshipsPerSecMin: relMatch ? Number(relMatch[1].replace(/,/g, "")) : null,
    selfReportedFixturesMs: metMatch ? toMs(metMatch[1], metMatch[2]) : null,
    unparsed: [...new Set(unparsed)],
  }
}

// ============================================================================
// The verdict.
// ============================================================================
export type Verdict = "within-budget" | "over-budget" | "count-mismatch" | "no-budget-declared" | "budget-unparsed" | "unscorable" | "absent"

/** Higher is worse. Regression = a lane moving up this scale. */
export const SEVERITY: Record<Verdict, number> = {
  "within-budget": 0,
  "over-budget": 1,
  "count-mismatch": 2,
  "no-budget-declared": 3,
  "budget-unparsed": 4,
  unscorable: 5,
  absent: 6,
}

export interface LaneVerdict {
  lang: string
  analyzerFile: string
  doc: string | null
  verdict: Verdict
  severity: number
  reasons: string[]
  budget: Budget | null
  frame: Frame | null
  /** The row the budget is compared against, when one exists. */
  comparedRow: TimedRow | null
  note: string | null
}

export function classify(lang: string, analyzerFile: string, frame: Frame | null, budget: Budget | null, docPath: string | null): LaneVerdict {
  const base = { lang, analyzerFile, doc: docPath, budget, frame, comparedRow: null as TimedRow | null, note: null as string | null }

  if (!frame) {
    return { ...base, verdict: "absent", severity: SEVERITY.absent, reasons: [`no complexity artifact under validation/m12/results/ (${lang}-complexity.json or ${lang}-corpus-complexity.json)`] }
  }

  const gaps = frameGaps(frame)
  if (gaps.length) {
    // Order matters: an unattributed row is unscorable BEFORE it is compared, so a
    // lane cannot read "within budget" against a number nobody can re-derive.
    // The row is still ATTACHED — it is the row the lane would be judged on, and
    // dropping it would hide the measured facts (cpp's 58-file draw against a declared
    // 195-file budget) behind the reason it cannot be scored.
    const largest = frame.timedRows.filter((r) => !/fixture/i.test(r.label)).sort((a, b) => b.files - a.files)[0] ?? null
    return { ...base, comparedRow: largest, verdict: "unscorable", severity: SEVERITY.unscorable, reasons: gaps }
  }

  const row = frame.timedRows.filter((r) => !/fixture/i.test(r.label)).sort((a, b) => b.files - a.files)[0]
  if (!row) {
    return { ...base, verdict: "unscorable", severity: SEVERITY.unscorable, reasons: ["frame complete but no corpus row to compare"] }
  }

  if (!budget) {
    return { ...base, comparedRow: row, verdict: "no-budget-declared", severity: SEVERITY["no-budget-declared"], reasons: ["the lane's doc declares no budget (M12 complexityContract: declared_budget_per_analyzer)"] }
  }
  // SCORING REQUIRES A BOUND. A declaration that yielded only a file count (or only a
  // fixture bound) cannot adjudicate a corpus row, and reading that as "within budget"
  // is exactly the vacuous pass this gate exists to remove.
  if (budget.corpusMs === null && budget.symbolsPerSecMin === null && budget.relationshipsPerSecMin === null) {
    return {
      ...base, comparedRow: row, verdict: "budget-unparsed", severity: SEVERITY["budget-unparsed"],
      reasons: budget.unparsed.length
        ? budget.unparsed.map((u) => `declared budget names a corpus but no machine-readable bound: "${u}"`)
        : ["declared budget contains no corpus time bound or throughput floor to adjudicate a corpus row"],
    }
  }

  const reasons: string[] = []
  if (budget.corpusFiles !== null && row.files !== budget.corpusFiles) {
    reasons.push(`declared budget names ${budget.corpusFiles} file(s); the artifact measured ${row.files} — not like-for-like, so it is neither scored nor failed`)
    return { ...base, comparedRow: row, verdict: "count-mismatch", severity: SEVERITY["count-mismatch"], reasons }
  }

  let over = false
  if (budget.corpusMs !== null && row.wallMs > budget.corpusMs) {
    over = true
    reasons.push(`corpus row ${row.wallMs.toFixed(0)} ms > declared ${budget.corpusMs} ms on ${row.files} files`)
  }
  if (budget.symbolsPerSecMin !== null && row.symbols !== null) {
    const rate = row.wallMs > 0 ? row.symbols / (row.wallMs / 1000) : 0
    if (rate < budget.symbolsPerSecMin) { over = true; reasons.push(`symbols/s ${rate.toFixed(0)} < declared floor ${budget.symbolsPerSecMin}`) }
  }
  if (budget.relationshipsPerSecMin !== null && row.relationships !== null) {
    const rate = row.wallMs > 0 ? row.relationships / (row.wallMs / 1000) : 0
    if (rate < budget.relationshipsPerSecMin) { over = true; reasons.push(`relationships/s ${rate.toFixed(0)} < declared floor ${budget.relationshipsPerSecMin}`) }
  }

  const verdict: Verdict = over ? "over-budget" : "within-budget"
  if (!reasons.length) reasons.push(`corpus row ${row.wallMs.toFixed(0)} ms <= declared ${budget.corpusMs ?? "n/a"} ms on ${row.files} files`)
  return { ...base, comparedRow: row, verdict, severity: SEVERITY[verdict], reasons }
}

// ============================================================================
// The census.
// ============================================================================
export interface LaneCensus {
  lang: string
  analyzerFile: string
  doc: string | null
  artifact: string | null
  v: LaneVerdict
}

export function lanes(root: string = ROOT): { lang: string; analyzerFile: string | null; doc: string | null }[] {
  const dir = path.join(root, "validation/m12/fixtures")
  return readdirSync(dir)
    .filter((d) => !d.startsWith("."))
    .sort()
    .map((lang) => ({ lang, analyzerFile: analyzerFor(lang), doc: docFor(lang) }))
}

export function census(root: string = ROOT): LaneCensus[] {
  const out: LaneCensus[] = []
  for (const lane of lanes(root)) {
    const p = artifactPath(lane.lang)
    let frame: Frame | null = null
    if (p) {
      try {
        frame = readFrame(p, readFileSync(p, "utf8"))
      } catch (e) {
        frame = { ...(readFrame(p, "{}")), shape: "unreadable", shapeError: `unreadable: ${String((e as Error).message).slice(0, 80)}` }
      }
    }
    const budget = lane.doc ? parseBudget(readFileSync(lane.doc, "utf8"), path.relative(root, lane.doc)) : null
    const v = classify(lane.lang, lane.analyzerFile ?? "(unresolved)", frame, budget, lane.doc ? path.relative(root, lane.doc) : null)
    if (!lane.analyzerFile) v.reasons.push("no analyzer resolves for this lane (the lane-key/analyzer-file split is registered in LANE_ANALYZER_ALIAS)")
    out.push({ lang: lane.lang, analyzerFile: lane.analyzerFile ?? "(unresolved)", doc: lane.doc ? path.relative(root, lane.doc) : null, artifact: p ? path.relative(root, p) : null, v })
  }
  return out
}

// ============================================================================
// Self-tests: the parser and the classifier must discriminate, or nothing here means
// anything. Each case is a real shape from this repo's docs or artifacts.
// ============================================================================
export interface SelfTestResult { cases: number; failures: string[] }

function frameFor(over: Partial<Frame>): Frame {
  return {
    artifact: "validation/m12/results/selftest-complexity.json",
    shape: "per_analyzer",
    kind: "per_analyzer_complexity:selftest",
    hasLoadRule: true,
    hasManifest: true,
    setDigest: "deadbeefdeadbeef",
    manifestFileCount: 400,
    extensionFiltered: true,
    extensions: "x",
    revision: null,
    timedRows: [{ label: "corpus_subset", files: 400, wallMs: 30_000, userCpuMsPerFile: 20, loadAvg1: 1.2, loadQuiet: true, symbols: 10_000, relationships: 20_000 }],
    corpusRows: 1,
    policyProse: [],
    shapeError: null,
    ...over,
  }
}

const BUDGET_CASES: { name: string; doc: string; expect: Partial<Budget> }[] = [
  {
    name: "`fixtures < 2 s (met: 0.23 s); 400-file corpus < 60 s` (typescript)",
    doc: "Declared budgets: fixtures < 2 s (met: 0.23 s); 400-file corpus < 60 s\n",
    expect: { fixturesMs: 2000, corpusMs: 60_000, corpusFiles: 400, selfReportedFixturesMs: 230 },
  },
  {
    name: "`fixture wall < 500 ms; corpus (141 files) < 20 s, symbols/s >= 1,000` (clojure)",
    doc: "Declared budget: fixture wall < 500 ms; corpus (141 files) < 20 s, symbols/s ≥ 1,000, relationships/s ≥ 3,000.\n",
    expect: { fixturesMs: 500, corpusMs: 20_000, corpusFiles: 141, symbolsPerSecMin: 1000, relationshipsPerSecMin: 3000 },
  },
  {
    name: "`corpus subset (300 files) < 20 s` (kotlin)",
    doc: "Declared budget: fixtures < 2 s; corpus subset (300 files) < 20 s.\n",
    expect: { corpusMs: 20_000, corpusFiles: 300 },
  },
  {
    name: "a declaration that trails off mid-sentence is UNPARSED, not 'no budget' (fsharp)",
    doc: "Declared budgets: fixtures < 2 s (met: 0.76 s); 376-file corpus dominated by\n\n## next section\n",
    expect: { fixturesMs: 2000, corpusMs: null },
  },
  {
    name: "a template placeholder is UNPARSED (TEMPLATE.md)",
    doc: "Declared budget: `<budget>`\n",
    expect: { fixturesMs: null, corpusMs: null },
  },
  {
    name: "no declaration at all reads as no paragraph",
    doc: "## Complexity\n\nMeasured somewhere, somehow.\n",
    expect: { raw: null, source: null },
  },
]

const CLASSIFY_CASES: { name: string; frame: Frame | null; budget: Budget | null; expect: Verdict }[] = [
  { name: "no artifact is `absent`", frame: null, budget: null, expect: "absent" },
  {
    name: "an unattributed row is `unscorable`, never scored (the 39-lane class)",
    frame: frameFor({ hasLoadRule: false, hasManifest: false, setDigest: null, extensionFiltered: null, timedRows: [{ label: "corpus", files: 400, wallMs: 30_000, userCpuMsPerFile: null, loadAvg1: null, loadQuiet: null, symbols: 1, relationships: 1 }] }),
    budget: null,
    expect: "unscorable",
  },
  {
    name: "an empty --ext filter is `unscorable` even with a manifest (#909)",
    frame: frameFor({ extensionFiltered: false }),
    budget: { source: "d:1", raw: "400-file corpus < 60 s", fixturesMs: null, corpusMs: 60_000, corpusFiles: 400, symbolsPerSecMin: null, relationshipsPerSecMin: null, selfReportedFixturesMs: null, unparsed: [] },
    expect: "unscorable",
  },
  {
    name: "a fixtures-only artifact is `unscorable` (no corpus row)",
    frame: frameFor({ timedRows: [{ label: "fixtures", files: 4, wallMs: 400, userCpuMsPerFile: 10, loadAvg1: 1, loadQuiet: true, symbols: 1, relationships: 1 }], corpusRows: 0 }),
    budget: { source: "d:1", raw: "fixtures < 2 s", fixturesMs: 2000, corpusMs: null, corpusFiles: null, symbolsPerSecMin: null, relationshipsPerSecMin: null, selfReportedFixturesMs: null, unparsed: [] },
    expect: "unscorable",
  },
  {
    name: "a complete frame inside its budget is `within-budget`",
    frame: frameFor({}),
    budget: { source: "d:1", raw: "400-file corpus < 60 s", fixturesMs: null, corpusMs: 60_000, corpusFiles: 400, symbolsPerSecMin: null, relationshipsPerSecMin: null, selfReportedFixturesMs: null, unparsed: [] },
    expect: "within-budget",
  },
  {
    name: "a complete frame over its budget is `over-budget`",
    frame: frameFor({ timedRows: [{ label: "corpus_subset", files: 400, wallMs: 90_000, userCpuMsPerFile: 20, loadAvg1: 1.2, loadQuiet: true, symbols: 10, relationships: 10 }] }),
    budget: { source: "d:1", raw: "400-file corpus < 60 s", fixturesMs: null, corpusMs: 60_000, corpusFiles: 400, symbolsPerSecMin: null, relationshipsPerSecMin: null, selfReportedFixturesMs: null, unparsed: [] },
    expect: "over-budget",
  },
  {
    name: "throughput below the declared floor is `over-budget`",
    frame: frameFor({}),
    budget: { source: "d:1", raw: "400-file corpus < 60 s, symbols/s ≥ 1,000", fixturesMs: null, corpusMs: 60_000, corpusFiles: 400, symbolsPerSecMin: 1_000_000, relationshipsPerSecMin: null, selfReportedFixturesMs: null, unparsed: [] },
    expect: "over-budget",
  },
  {
    name: "a different file count is `count-mismatch`, not a pass and not a failure",
    frame: frameFor({}),
    budget: { source: "d:1", raw: "141-file corpus < 20 s", fixturesMs: null, corpusMs: 20_000, corpusFiles: 141, symbolsPerSecMin: null, relationshipsPerSecMin: null, selfReportedFixturesMs: null, unparsed: [] },
    expect: "count-mismatch",
  },
  {
    name: "an attributed lane with no declaration is `no-budget-declared`",
    frame: frameFor({}),
    budget: null,
    expect: "no-budget-declared",
  },
  {
    name: "a declaration that parsed to nothing is `budget-unparsed`",
    frame: frameFor({}),
    budget: { source: "d:1", raw: "<budget>", fixturesMs: null, corpusMs: null, corpusFiles: null, symbolsPerSecMin: null, relationshipsPerSecMin: null, selfReportedFixturesMs: null, unparsed: ["<budget>"] },
    expect: "budget-unparsed",
  },
]

export function selfTest(): SelfTestResult {
  const failures: string[] = []
  for (const c of BUDGET_CASES) {
    const got = parseBudget(c.doc, "self-test.md")
    for (const [k, want] of Object.entries(c.expect)) {
      const have = (got as any)[k]
      if (have !== want) failures.push(`${c.name}: ${k} expected ${JSON.stringify(want)}, got ${JSON.stringify(have)}`)
    }
  }
  // The unparsed half of the fsharp case, asserted separately because it is the whole
  // point: a declaration that yields nothing must not read as an absence of one.
  const fsharp = parseBudget(BUDGET_CASES[3].doc, "self-test.md")
  if (fsharp.unparsed.length === 0) failures.push("a trailing-off declaration must carry an unparsed fragment")
  const template = parseBudget(BUDGET_CASES[4].doc, "self-test.md")
  if (template.unparsed.length === 0) failures.push("a placeholder budget must carry an unparsed fragment")

  for (const c of CLASSIFY_CASES) {
    const got = classify("selftest", "real-selftest-analyzer.ts", c.frame, c.budget, "docs/analyzers/real-selftest-analyzer.md")
    if (got.verdict !== c.expect) failures.push(`${c.name}: expected ${c.expect}, got ${got.verdict} (${got.reasons.join("; ")})`)
  }

  // Severity is a total order and both directions must hold, or "a lane got worse"
  // cannot be distinguished from "a lane got better".
  if (!(SEVERITY.unscorable > SEVERITY["within-budget"])) failures.push("severity: unscorable must be worse than within-budget")
  if (!(SEVERITY["within-budget"] < SEVERITY["over-budget"])) failures.push("severity: over-budget must be worse than within-budget")
  if (!(SEVERITY["count-mismatch"] < SEVERITY["no-budget-declared"])) failures.push("severity: a lost declaration must be worse than a like-for-like mismatch")

  // The reader itself is exercised against the three real shapes: a shape this reader
  // does not recognise must read `unreadable`, never pass silently.
  const unreadable = readFrame(path.join(ROOT, "validation/m12/results/nope.json"), JSON.stringify({ hello: "world" }))
  if (unreadable.shape !== "unreadable") failures.push("an unrecognised artifact shape must read as unreadable")
  const broken = readFrame(path.join(ROOT, "validation/m12/results/nope.json"), "{not json")
  if (broken.shape !== "unreadable" || !broken.shapeError) failures.push("unparsable JSON must read as unreadable with a named error")

  // A git-history case this reader must get right: the three committed shapes must be
  // recognised as themselves, because every verdict rests on which facts each shape can
  // even carry. Read from the real artifacts, not from fixtures of my own invention.
  for (const [name, want] of [["c-complexity.json", "per_analyzer"], ["php-corpus-complexity.json", "corpus_tracked"], ["bash-corpus-complexity.json", "flat_corpus"]] as const) {
    const p = path.join(RESULTS_DIR, name)
    if (!existsSync(p)) { failures.push(`reader: ${name} missing from the tree`); continue }
    const f = readFrame(p, readFileSync(p, "utf8"))
    if (f.shape !== want) failures.push(`reader: ${name} read as ${f.shape}, expected ${want}`)
    if (f.shape === "per_analyzer" && f.timedRows.length === 0) failures.push(`reader: ${name} lost its runs array`)
  }

  // ---- The gate must be able to fail on each event it exists for (the "gate that
  // cannot fail" class: this repo has paid for a live predicate asserting a message
  // PREFIX, which every finding shares, so it could not fail on a conviction).
  const fake = (lang: string, verdict: Verdict, artifact: string | null = `validation/m12/results/${lang}-complexity.json`): LaneCensus => ({
    lang,
    analyzerFile: `src/ast/real-${lang}-analyzer.ts`,
    doc: `docs/analyzers/real-${lang}-analyzer.md`,
    artifact,
    v: { lang, analyzerFile: `real-${lang}-analyzer.ts`, doc: null, verdict, severity: SEVERITY[verdict], reasons: [`synthetic ${verdict}`], budget: null, frame: null, comparedRow: null, note: null },
  })
  const regOf = (lang: string, verdict: Verdict, over: Partial<RegisterEntry> = {}): RegisterEntry => ({
    lang, artifact: `validation/m12/results/${lang}-complexity.json`, verdict, severity: SEVERITY[verdict], status: "open",
    reasons: [], budgetSource: null, frame: { shape: null, loadRule: false, manifest: false, setDigest: null, extensionFiltered: null }, comparedRow: null, note: "", ...over,
  })
  const gateCase = (name: string, c: LaneCensus[], reg: Record<string, RegisterEntry> | null, expect: "fail" | "pass") => {
    const r = adjudicate(c, reg)
    const failed = r.failures.length > 0
    if (expect === "fail" && !failed) failures.push(`gate: ${name} must FAIL and did not`)
    if (expect === "pass" && failed) failures.push(`gate: ${name} must pass and failed with: ${r.failures[0]}`)
  }
  gateCase("a missing register has no baseline", [fake("x", "unscorable")], null, "fail")
  gateCase("a lane getting WORSE than registered", [fake("x", "unscorable")], { x: regOf("x", "within-budget", { status: "paid" }) }, "fail")
  gateCase("a paid entry regressing", [fake("x", "over-budget")], { x: regOf("x", "within-budget", { status: "paid" }) }, "fail")
  gateCase("a registered lane that vanished from the universe", [fake("y", "unscorable")], { x: regOf("x", "unscorable") }, "fail")
  gateCase("an unregistered lane arriving with a claim", [fake("x", "within-budget")], {}, "fail")
  gateCase("a registered artifact that disappeared while its verdict held", [fake("x", "unscorable", null)], { x: regOf("x", "unscorable") }, "fail")
  gateCase("a lane absent in both the register and the tree is stable", [fake("x", "absent", null)], { x: regOf("x", "absent", { artifact: null }) }, "pass")
  gateCase("registered, unchanged debt is a worklist and not a failure", [fake("x", "unscorable")], { x: regOf("x", "unscorable") }, "pass")
  gateCase("an improvement is reported, not failed", [fake("x", "within-budget")], { x: regOf("x", "unscorable") }, "pass")
  const improved = adjudicate([fake("x", "within-budget")], { x: regOf("x", "unscorable") })
  if (improved.improvements.length === 0) failures.push("gate: an improvement must be reported as such")

  return { cases: BUDGET_CASES.length + CLASSIFY_CASES.length + 9 + 8 + 3, failures }
}

// ============================================================================
// Register + gate
// ============================================================================
export interface RegisterEntry {
  lang: string
  artifact: string | null
  verdict: Verdict
  severity: number
  status: "open" | "paid" | "ruled"
  reasons: string[]
  budgetSource: string | null
  frame: { shape: string | null; loadRule: boolean; manifest: boolean; setDigest: string | null; extensionFiltered: boolean | null }
  comparedRow: { label: string; files: number; wallMs: number } | null
  note: string
}

export function registerFrom(c: LaneCensus[]): Record<string, RegisterEntry> {
  const out: Record<string, RegisterEntry> = {}
  for (const l of c) {
    out[l.lang] = {
      lang: l.lang,
      artifact: l.artifact,
      verdict: l.v.verdict,
      severity: l.v.severity,
      status: l.v.verdict === "within-budget" ? "paid" : "open",
      reasons: l.v.reasons,
      budgetSource: l.v.budget?.source ?? null,
      frame: {
        shape: l.v.frame?.shape ?? null,
        loadRule: l.v.frame?.hasLoadRule ?? false,
        manifest: l.v.frame?.hasManifest ?? false,
        setDigest: l.v.frame?.setDigest ?? null,
        extensionFiltered: l.v.frame?.extensionFiltered ?? null,
      },
      comparedRow: l.v.comparedRow ? { label: l.v.comparedRow.label, files: l.v.comparedRow.files, wallMs: Math.round(l.v.comparedRow.wallMs) } : null,
      note: l.v.budget?.unparsed.length
        ? `the lane's declared budget is prose-only ("${l.v.budget.unparsed[0].slice(0, 100)}") — an owner ruling is owed: either a fixed numeric bound, or an accepted large-file/parse-bound ruling with the measurement behind it recorded here. Until then this lane can be neither failed nor passed.`
        : "Seeded from the census at first landing (see the artifact). Debt here is a worklist, not a pass: re-measure with the shared harness so the row carries load context and a set digest, then re-emit this entry in the same commit.",
    }
  }
  return out
}

export interface GateResult { failures: string[]; worklist: string[]; improvements: string[] }

export function adjudicate(c: LaneCensus[], reg: Record<string, RegisterEntry> | null, strict = false): GateResult {
  const failures: string[] = []
  const worklist: string[] = []
  const improvements: string[] = []
  // Fail-closed: a gate that cannot find its own register has no baseline, and the
  // baseline is the only thing that makes "a number moved" decidable.
  if (!reg) return { failures: ["the register is missing — this gate has no baseline, so it cannot adjudicate anything"], worklist, improvements }

  const byLang = new Map(c.map((l) => [l.lang, l]))
  for (const [lang, entry] of Object.entries(reg)) {
    const live = byLang.get(lang)
    if (!live) { failures.push(`${lang}: registered lane is GONE (analyzer or lane set changed) — a vanished lane must be a deliberate deregistration`); continue }
    if (live.v.severity > entry.severity) {
      failures.push(`${lang}: WORSE than registered — ${entry.verdict} -> ${live.v.verdict} (${live.v.reasons.join("; ")})`)
    } else if (live.v.severity < entry.severity) {
      improvements.push(`${lang}: improved ${entry.verdict} -> ${live.v.verdict} — re-emit the register in the same commit`)
    }
    if (entry.artifact && !live.artifact) failures.push(`${lang}: registered artifact ${entry.artifact} no longer exists`)
    if (entry.status === "paid" && live.v.severity > 0) failures.push(`${lang}: registered as paid but now reads ${live.v.verdict}`)
    if (live.v.severity > 0) worklist.push(`${lang}: ${live.v.verdict} — ${live.v.reasons[0]}`)
  }
  if (strict && improvements.length) failures.push(...improvements.map((i) => `strict: ${i}`))
  for (const l of c) {
    if (reg[l.lang]) continue
    // A lane arriving with real evidence but no ruling is a new claim; a lane arriving
    // with no artifact at all is merely unregistered and stays on the worklist.
    if (l.v.verdict === "absent" || l.v.verdict === "unscorable") worklist.push(`${l.lang}: unregistered (${l.v.verdict})`)
    else failures.push(`${l.lang}: unregistered lane with a ${l.v.verdict} row — a new envelope claim needs a ruling in the same commit`)
  }
  return { failures, worklist, improvements }
}

// ============================================================================
async function main() {
  const argv = process.argv.slice(2)
  const has = (f: string) => argv.includes(f)
  const cols = census(ROOT)
  const st = selfTest()

  const byVerdict: Record<string, number> = {}
  for (const l of cols) byVerdict[l.v.verdict] = (byVerdict[l.v.verdict] ?? 0) + 1

  console.log(`analyzer complexity envelope — ${cols.length} lanes`)
  for (const l of cols) {
    const b = l.v.budget
    const declared = !b ? "—" : `fixtures<${b.fixturesMs ?? "?"}ms corpus<${b.corpusMs ?? "?"}ms/${b.corpusFiles ?? "?"}f`
    const row = l.v.comparedRow
    const measured = row ? `${row.wallMs.toFixed(0)}ms/${row.files}f` : "—"
    console.log(`  ${l.lang.padEnd(14)} ${l.v.verdict.padEnd(18)} declared ${declared.padEnd(34)} measured ${measured.padEnd(18)} ${l.v.frame?.shape ?? "-"}`)
  }
  console.log(`  byVerdict: ${JSON.stringify(byVerdict)}`)
  console.log(`  self-tests: ${st.cases - st.failures.length}/${st.cases} passed`)
  for (const f of st.failures) console.log(`    FAIL: ${f}`)

  // The disclosure that keeps the table honest: what the docs claim about their own
  // fixtures row, next to what the artifact says, for every lane that reports both.
  const selfReport = cols.filter((l) => l.v.budget?.selfReportedFixturesMs != null && l.v.frame)
  if (selfReport.length) {
    console.log(`  doc self-reports vs artifacts (a disagreement is a finding, not a verdict):`)
    for (const l of selfReport) {
      const fx = l.v.frame!.timedRows.find((r) => /fixture/i.test(r.label))
      if (!fx) continue
      const claimed = l.v.budget!.selfReportedFixturesMs!
      const delta = Math.abs(fx.wallMs - claimed) / Math.max(1, claimed)
      console.log(`    ${l.lang.padEnd(14)} doc says met ${claimed}ms, artifact says ${fx.wallMs.toFixed(0)}ms (${(delta * 100).toFixed(0)}% apart)`)
    }
  }

  if (has("--emit")) {
    mkdirSync(path.dirname(OUT), { recursive: true })
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          gate: "M60.R6/dimension-9",
          at: new Date().toISOString(),
          question:
            "Is every analyzer's time-complexity envelope a MEASUREMENT — a file set, an extension rule and a load context, scored against a declared budget — or a number nobody can re-derive?",
          method:
            "Read each lane's committed artifact (validation/m12/results/<lang>[-corpus]-complexity.json), check #909's frame facts for the artifact's own shape, parse the lane's declared budget out of docs/analyzers/<analyzer>.md, and adjudicate. Unattributed rows are reported as unscorable rather than scored; a declared file count that differs from the measured one is reported as count-mismatch rather than converted into a pass by normalizing.",
          lanes: cols.length,
          byVerdict,
          selfTests: { cases: st.cases, passed: st.cases - st.failures.length, failures: st.failures },
          disclosure:
            "This instrument reads artifacts; it does not time anything, and it deliberately does not normalize across file counts or assume linearity — both are the questions §9 asks. The static quadratic-shape census (repeated full-tree queries inside a visitor) and the per-1k-node normalization are registered here as NOT BUILT, with their size measured: no artifact in this repo records a node count.",
          census: cols.map((l) => ({
            lang: l.lang,
            analyzerFile: l.analyzerFile,
            doc: l.doc,
            artifact: l.artifact,
            verdict: l.v.verdict,
            severity: l.v.severity,
            reasons: l.v.reasons,
            budget: l.v.budget,
            frame: l.v.frame
              ? {
                  shape: l.v.frame.shape,
                  kind: l.v.frame.kind,
                  loadRule: l.v.frame.hasLoadRule,
                  manifest: l.v.frame.hasManifest,
                  setDigest: l.v.frame.setDigest,
                  extensionFiltered: l.v.frame.extensionFiltered,
                  revision: l.v.frame.revision,
                  corpusRows: l.v.frame.corpusRows,
                  timedRows: l.v.frame.timedRows,
                }
              : null,
            comparedRow: l.v.comparedRow,
          })),
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`  -> ${path.relative(ROOT, OUT)}`)
  }

  if (has("--update-register")) {
    const seed = registerFrom(cols)
    mkdirSync(path.dirname(REGISTER), { recursive: true })
    writeFileSync(
      REGISTER,
      JSON.stringify(
        {
          schemaVersion: 1,
          milestone: "M60",
          rule: "R6 — one line base for lines; R6's sibling here is dimension 9 of reviews/LANE-AUDIT-FORMULA.md: an analyzer's time-complexity envelope must be a measurement",
          instrument: "script/m60/analyzer-complexity-gate.ts",
          artifact: path.relative(ROOT, OUT),
          purpose:
            "M12's complexityContract requires `declared_budget_per_analyzer` and an envelope that carries its own frame; verify-m12-final-audit.ts asks only whether the artifact EXISTS, so 39 lanes' envelope cell reads green on a number #909 already ruled unscorable. This register makes the class un-recurrable (a lane that gets worse, or a new lane arriving with a claim, fails) while the debt is a worklist.",
          statuses: {
            open: "measured and reported; the lane's envelope is not yet a scored measurement",
            paid: "within its declared budget with a complete frame — a paid entry that regresses FAILS",
            ruled: "an owner ruling recorded here with the measurement behind it",
          },
          severity: SEVERITY,
          staging: {
            current: "unadjudicated debt is PRINTED as a worklist; the gate hard-fails only on a lane getting WORSE, a registered artifact vanishing, a paid entry regressing, a registered lane disappearing, and an unregistered lane arriving with a timed, declared budget",
            why: "the census is new and 39 of 41 lanes carry the debt; failing on it on day one would be the mirror of the 'gate that cannot fail' class this program keeps finding",
            next: "once every lane carries a scored row, the worklist becomes a hard failure",
          },
          improvementsRequireStrict: "an improvement is printed and requires --strict to fail; the register must be re-emitted in the same commit that improves a lane",
          notBuilt: [
            "the static quadratic-shape census (repeated full-tree queries inside a visitor, and per-symbol linear scans over symbol/relationship arrays) — owner-named in reviews/m60-oo-family-plan.md §3.7/R6, still absent",
            "per-1k-node normalization: no complexity artifact in this repo records a node count, so ms/1k nodes — the number the formula compares against a sibling language — cannot be derived from any of them",
            "a fixed size band for cross-lane comparison (the C audit's 8-40 KB band is a probe at script/m14/tmp/c-audit-band.ts, not an artifact)",
          ],
          seededAt: new Date().toISOString(),
          _meta: {
            growthRule: "a severity increase, a vanished artifact, a regression out of `paid`, or an unregistered lane with a claim fails the gate; growth is never absorbed into the baseline",
            seededFrom: "the first census run at this commit; every entry's verdict is the census's own reading, not a hand ruling",
          },
          entries: seed,
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`  -> ${path.relative(ROOT, REGISTER)}`)
  }

  if (has("--gate")) {
    const reg: Record<string, RegisterEntry> | null = existsSync(REGISTER) ? (JSON.parse(readFileSync(REGISTER, "utf8")).entries ?? null) : null
    const r = adjudicate(cols, reg, has("--strict"))
    console.log(`  gate: ${r.failures.length} failure(s), ${r.worklist.length} worklist item(s), ${r.improvements.length} improvement(s)`)
    for (const f of r.failures) console.log(`    FAIL: ${f}`)
    for (const i of r.improvements) console.log(`    NOTE: ${i}`)
    if (r.worklist.length) {
      console.log(`    worklist (not failed: this is registered, unadjudicated debt):`)
      for (const w of r.worklist) console.log(`      ${w}`)
    }
    if (r.failures.length) process.exit(2)
  }

  if (st.failures.length) process.exit(2)
}

if (process.argv[1] && path.basename(process.argv[1]) === "analyzer-complexity-gate.ts") {
  main().catch((e) => {
    console.error("analyzer-complexity-gate failed:", e)
    process.exit(1)
  })
}
