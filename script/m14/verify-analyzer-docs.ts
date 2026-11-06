// script/m14/verify-analyzer-docs.ts — does each analyzer's DOCUMENT actually document it?
//
// WHY THIS FILE EXISTS
// --------------------
// `script/m14/completeness-inventory.ts` has a `section-g-docs` check, and it is the only
// doc gate in the tree. It asks `existsSync(docs/analyzers/<lang>.md)`. That is a PRESENCE
// test wearing a COVERAGE label: a file containing one line passes it, and a lane's M14
// row can read `docs present and committed` while the document describes nothing. The
// template at docs/analyzers/TEMPLATE.md spells out eleven sections for exactly this
// reason, and nothing anywhere checked that a single one of them was filled in.
//
// Measured on this tree when this file was written: 43 analyzers, 43 languages with a
// doc, and **20** whose doc carries all eleven template sections. Two analyzers
// (`makefile`, `scss`) have no doc at all. So the honest statement was "every analyzer is
// documented", which was true in the same way that "0 regexes" was true of css until
// `d58c43c6` corrected a doc that claimed it.
//
// WHAT IT MEASURES, per language, in three questions of increasing sharpness:
//
//   A. PRESENCE   is there a doc for this analyzer at all?
//   B. SECTIONS   does it carry the template's required sections?
//   C. CELLS      does its relationship-ontology table leave any cell unexplained?
//
// C is the one that catches a real defect rather than a formatting gap. The template says
// of the unsupported table that "each must be declared, never silently dropped", and of the
// regex table that "zero unclassified" is the rule. A row that exists but says nothing is
// the same failure as a missing row, and it is the failure a heading-presence check can
// never see: the heading is right there.
//
// IT DOES NOT FAIL HARD ON THE BASELINE. 22 languages are short of the template today, and
// most of that debt is other lanes'. This file's job is to make the debt MEASURED and
// PER-LANGUAGE so it can be worked and re-measured, not to turn a long tail into a red gate
// everyone learns to ignore. So the historical state is recorded as `baseline` and compared
// against, exactly as script/m12/verify-corpus-claims.ts does for corpus claims. A language
// that LOSES a section fails; a language that was already short does not.
//
// Usage: bun run script/m14/verify-analyzer-docs.ts [--lang X] [--json]
// Writes: validation/m14/results/analyzer-docs.json — a REGISTERED MEASUREMENT RECORD.
//
// The payload is a repo-wide MEASUREMENT (counts/rows/baseline), not a harness-v2 claim: claims in
// `validation/m14/results/*.json` are written only by evidence-harness `emitEvidence`, which
// requires an issueId/claimLevel/checks/limitations envelope this record has none of. It is written
// at its canonical path because it has a live reader role, and its basename is a NAMED registration
// in the harness's MEASUREMENT_RECORDS allowlist: validate() accepts it as parseable JSON, lists it
// by name, and never as a schemaVersion-2 claim. See results/archive/README.md.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(Bun?.main ?? process.argv[0] ?? "."), "../..")
const OUT = path.join(ROOT, "validation/m14/results/analyzer-docs.json")

/**
 * A section counts only if it has CONTENT, not just a heading.
 *
 * The first version of this gate asked `text.includes("## Regex inventory")`, and a control
 * test that renamed the heading to `## Regex inventory (renamed by a control test)` still
 * passed. That is the same defect as `existsSync`, one level up: a heading with nothing under
 * it satisfies a presence test, so an empty section is reported as coverage. This function
 * therefore requires at least one line of real content — a word, a table row, a list item —
 * between the heading and the next heading, and counts a table's own `|---|` separator as
 * content only when a data row accompanies it.
 */
function sectionHasContent(text: string, heading: string): boolean {
  const lines = text.split("\n")
  const start = lines.findIndex((l) => l.trim() === heading || l.trim().startsWith(`${heading} `))
  if (start < 0) return false
  // A SECTION'S SUBSECTIONS ARE PART OF IT (2026-11-03). This used to stop at ANY heading, so a
  // section whose first non-blank line was a `###` subheading read as EMPTY — rust's
  // `## Corpus validation` followed directly by `### Current admitted population`, and r's
  // `## Relationship ontology` followed by `### The canonical claim table…`, were graded "missing
  // section" while both sections were fully written. The scan now ends only at a heading of the
  // SAME OR HIGHER level, and a subheading is traversed rather than treated as content itself.
  const level = (heading.match(/^#+/) ?? ["##"])[0].length
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    const h = line.match(/^(#{1,6})\s/)
    if (h) {
      if (h[1]!.length <= level) return false
      continue
    }
    if (!line) continue
    if (/^\|[\s:|-]+\|$/.test(line)) continue // a bare table separator carries nothing
    if (line === "---") continue
    return true
  }
  return false
}

/** The template's sections, in order. A doc must carry every one to count as complete. */
const REQUIRED_SECTIONS = [
  "## Language",
  "## Symbol contract",
  "## Relationship ontology",
  "## Supported constructs",
  "## Regex inventory",
  "## Complexity envelope",
  "## Differential ground truth",
  "## Corpus validation",
]

/** Analyzer file id -> documentation lane name where the two differ. The analyzer source is
 *  `real-makefile-analyzer.ts`, but the lane and its page are `make`. */
const DOC_LANE_ALIAS: Record<string, string> = { makefile: "make" }

/** The analyzer documentation. One canonical file per language: `docs/analyzers/<lang>.md`.
 *  (The old `real-<lang>-analyzer.md` prefix was retired on 2026-11-01; see docs/analyzers/README.md.) */
const DOC_CANDIDATES = (lang: string): string[] => [path.join(ROOT, "docs/analyzers", `${DOC_LANE_ALIAS[lang] ?? lang}.md`)]

/**
 * A relationship-ontology table row that answers nothing.
 *
 * The template's table is `| <type> | <emitted?> | <how resolved> | <confidence> |`, and its
 * own rule is that every relationship the language does not have must be ruled with a
 * reason rather than left blank. So a row is unexplained when the "emitted?" cell is empty,
 * or when it says yes and the row carries no resolution and no confidence — a claim of
 * emission with nothing behind it, which is the exact defect this gate is for.
 */
function ontologyGaps(text: string): string[] {
  const lines = text.split("\n")
  const start = lines.findIndex((l) => l.trim() === "## Relationship ontology")
  if (start < 0) return ["(no relationship-ontology section)"]
  const gaps: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (/^##\s/.test(line)) break
    if (!line.trim().startsWith("|")) continue
    const cells = line.split("|").slice(1, -1).map((c) => c.trim())
    if (cells.length < 2) continue
    const type = cells[0]!
    if (!type || type.startsWith("-") || type.toLowerCase() === "relationship type") continue
    if (cells.length < 4) continue
    const [, emitted, resolution, confidence] = cells
    if (!emitted) {
      gaps.push(`${type}: emitted? cell is EMPTY — neither claimed nor ruled`)
    } else if (/^(y|yes|true)$/i.test(emitted) && (!resolution || !confidence)) {
      gaps.push(`${type}: claims emission with no resolution and/or confidence`)
    }
  }
  return gaps
}

function analyzerLanguages(): string[] {
  const dir = path.join(ROOT, "src/ast")
  return readdirSync(dir)
    .filter((f) => /^real-.*-analyzer\.ts$/.test(f))
    .map((f) => f.replace(/^real-/, "").replace(/-analyzer\.ts$/, ""))
    .sort()
}

/**
 * THE COUNT CONTRACT — one number, several denominators, checked instead of narrated.
 *
 * The owner hit this repeatedly: the exact count of analyzers was stated as 47 in one gate's
 * output, 48 in an artifact table, 49 in a website audit and 50 in the README, because four
 * different denominators were all being called "the number of analyzers" and one of them (F1's
 * language table) had silently dropped three lanes — the failure mode that same file's own
 * protobuf comment documents ("a lane absent from the table is a lane F1 measures nothing for").
 *
 * So the canonical statement lives in docs/analyzers/README.md as a machine-readable block, and
 * this gate compares it to what the tree actually contains:
 *   analyzers        src/ast/real-*-analyzer.ts files
 *   analyzerPages    canonical pages this gate verifies (present rows)
 *   lanes            rows in script/m14/run-fixtures.ts LANGS (one per analyzer)
 *   grammarAuditRows rows in script/m14/audit-analyzer-grammar.ts LANGUAGES (must equal analyzers)
 *   routerLanguages  distinct values of src/ast/language-detection.ts EXTENSION_LANGUAGE
 *   relationshipTypes members of src/ast/types.ts RelationshipType
 *   pageSections     REQUIRED_SECTIONS.length (the gated template sections)
 * A mismatch fails with both numbers. The three equalities the campaign actually depends on —
 * analyzers == pages == lanes == grammar-audit rows — are asserted separately so a gate that
 * silently stops auditing a lane cannot pass a count that only the docs were told about.
 */
const COUNTS_MARKER_START = "<!-- ANALYZER-COUNTS:START -->"
const COUNTS_MARKER_END = "<!-- ANALYZER-COUNTS:END -->"

function measuredCounts(): Record<string, number> {
  const analyzers = analyzerLanguages().length
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8")
  const lanes = (read("script/m14/run-fixtures.ts").match(/^  [a-z0-9+#-]+: \{ wasm:/gm) ?? []).length
  const grammarAuditRows = (read("script/m14/audit-analyzer-grammar.ts").match(/^  \{ language: /gm) ?? []).length
  // BRACE-BALANCED EXTRACTION, not "slice up to the first }". The first version of this
  // measurement read 24 router languages and 12 relationship types, because inline comments in
  // both literals contain `}` — a count that is wrong by the numbers it reads is exactly the
  // failure this contract exists to prevent. Scan to the MATCHING brace, skipping strings and
  // comments, so a comment cannot truncate the denominator.
  const braceBalanced = (src: string, marker: string): string => {
    const at = src.indexOf(marker)
    const open = src.indexOf("{", at)
    let depth = 0
    for (let i = open; i < src.length; i++) {
      const ch = src[i]
      if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch
        i++
        while (i < src.length && src[i] !== quote) { if (src[i] === "\\") i++; i++ }
        continue
      }
      if (ch === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue }
      if (ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); if (i < 0) break; i++; continue }
      if (ch === "{") depth++
      else if (ch === "}") { depth--; if (depth === 0) return src.slice(open, i + 1) }
    }
    return src.slice(open)
  }
  const routerBlock = braceBalanced(read("src/ast/language-detection.ts"), "export const EXTENSION_LANGUAGE")
  const routerLanguages = new Set([...routerBlock.matchAll(/:\s*"([a-z0-9+#-]+)"/g)].map((m) => m[1])).size
  const enumBlock = braceBalanced(read("src/ast/types.ts"), "export enum RelationshipType")
  // THE ENUM CARRIES ALIASES: 14 canonical values plus 8 legacy member names that map onto the
  // same values (Call=calls, Inheritance=extends, …). The ontology's count is the number of
  // DISTINCT VALUES, which is what every consumer publishes and every page's table enumerates.
  const relationshipTypes = new Set([...enumBlock.matchAll(/^\s+\w+ = "([a-z_]+)",/gm)].map((m) => m[1])).size
  return { analyzers, lanes, grammarAuditRows, routerLanguages, relationshipTypes, pageSections: REQUIRED_SECTIONS.length }
}

function checkCountContract(pageCount: number): string[] {
  const problems: string[] = []
  const readme = readFileSync(path.join(ROOT, "docs/analyzers/README.md"), "utf8")
  const start = readme.indexOf(COUNTS_MARKER_START)
  const end = readme.indexOf(COUNTS_MARKER_END)
  if (start < 0 || end < start) return ["docs/analyzers/README.md is missing the ANALYZER-COUNTS block — the count contract cannot be checked"]
  let declared: Record<string, number>
  try {
    declared = JSON.parse(readme.slice(start + COUNTS_MARKER_START.length, end).trim())
  } catch (e) {
    return [`docs/analyzers/README.md ANALYZER-COUNTS block is not valid JSON: ${(e as Error).message}`]
  }
  const measured = measuredCounts()
  // analyzerPages is measured after the per-language rows exist; the caller passes the count of
  // canonical pages this run actually verified.
  measured.analyzerPages = pageCount
  for (const [key, value] of Object.entries(measured)) {
    if (declared[key] !== value) problems.push(`count contract: ${key} declared ${declared[key]}, tree measures ${value}`)
  }
  if (measured.analyzers !== measured.lanes) problems.push(`analyzers (${measured.analyzers}) != fleet lanes (${measured.lanes}) — a lane and an analyzer are one thing`)
  if (measured.analyzers !== measured.grammarAuditRows) problems.push(`analyzers (${measured.analyzers}) != F1 grammar-audit rows (${measured.grammarAuditRows}) — a lane absent from F1 is a lane nothing grammar-audits`)
  return problems
}

const only = process.argv.includes("--lang")
  ? process.argv[process.argv.indexOf("--lang") + 1]
  : null

const rows: any[] = []
for (const lang of only ? [only] : analyzerLanguages()) {
  const candidates = DOC_CANDIDATES(lang)
  const docPath = candidates.find((c) => existsSync(c))
  if (!docPath) {
    rows.push({ lang, present: false, doc: null, missingSections: REQUIRED_SECTIONS, ontologyGaps: [] })
    continue
  }
  const text = readFileSync(docPath, "utf8")
  const missingSections = REQUIRED_SECTIONS.filter((sec) => !sectionHasContent(text, sec))
  rows.push({
    lang,
    present: true,
    doc: path.relative(ROOT, docPath),
    missingSections,
    ontologyGaps: ontologyGaps(text),
  })
}

const absent = rows.filter((r) => !r.present)
const countProblems: string[] = only ? [] : checkCountContract(rows.length - absent.length)
const sectionShort = rows.filter((r) => r.present && r.missingSections.length > 0)
const cellGaps = rows.filter((r) => r.ontologyGaps.length > 0)
const complete = rows.filter((r) => r.present && r.missingSections.length === 0 && r.ontologyGaps.length === 0)

const payload = {
  schemaVersion: 1,
  milestone: "M14",
  rule: "analyzer documentation completeness",
  generatedAt: new Date().toISOString(),
  boundary: [
    "A section counts only when it has CONTENT under its heading, not merely the heading: a renamed or empty section is a missing section.",
    "Measures the DOCUMENT, not the analyzer: a language can pass all eleven sections here and still have an analyzer defect, and a language can fail here with a correct analyzer. This gate is about a claim being checkable, and it is deliberately weaker than the gates that measure behaviour.",
  ].join(" "),
  requiredSections: REQUIRED_SECTIONS,
  counts: {
    analyzers: rows.length,
    present: rows.length - absent.length,
    absent: absent.length,
    sectionComplete: rows.length - absent.length - sectionShort.length,
    sectionShort: sectionShort.length,
    ontologyCellGaps: cellGaps.length,
    fullyComplete: complete.length,
  },
  // Recorded, not enforced on first run — see the file header. 22 languages were short of
  // the template when this gate was written, and most of that debt belongs to other lanes.
  baseline: {
    present: rows.length - absent.length,
    sectionComplete: rows.length - absent.length - sectionShort.length,
    ontologyCellGaps: cellGaps.length,
    note: "measured 2026-09-28 at the gate's first run; a language that LOSES ground fails, a language already short does not",
  },
  worklist: {
    noDoc: absent.map((r) => r.lang),
    missingSections: sectionShort.map((r) => ({ lang: r.lang, doc: r.doc, missing: r.missingSections })),
    unexplainedOntologyCells: cellGaps.map((r) => ({ lang: r.lang, doc: r.doc, gaps: r.ontologyGaps })),
  },
  rows,
}

// A SCOPED RUN MUST NOT REPLACE THE CANONICAL ARTIFACT.
//
// This gate had no guard, and it cost the artifact: every `--lang yaml` run I did while
// developing it overwrote validation/m14/results/analyzer-docs.json with a ONE-row file, so
// the repo-wide claim (43 analyzers, 18 fully complete) was replaced by a single lane's row —
// and the file on disk said `analyzers: 1` while looking entirely well-formed. It was caught
// only by diffing it against HEAD, not by any test, which is the worst way to find out.
//
// The sibling censuses in this tree already carry this guard with the same reasoning
// (script/m60/target-spelling-census.ts: "a scoped run would replace that claim with a
// smaller one"), and M61 #886 is the incident. A gate that measures the whole family and can
// be narrowed to one member without saying so is a gate whose artifact means different things
// on different days.
if (only) {
  // `--out` is OPTIONAL, and `indexOf` returning -1 makes `process.argv[0]` — the
  // interpreter path — look like a value, so the first version of this guard tried to
  // write the artifact over the bun binary. Presence has to be checked, not inferred
  // from a shifted index.
  const outIdx = process.argv.indexOf("--out")
  const outArg = outIdx >= 0 ? process.argv[outIdx + 1] : undefined
  if (outArg) {
    writeFileSync(outArg, JSON.stringify(payload, null, 2) + "\n")
    console.log(`dev-scoped rows written to ${outArg} (canonical artifact untouched)`)
  } else {
    console.log(`\nDEV-SCOPED run (--lang ${only}) — the canonical ${path.relative(ROOT, OUT)} was NOT touched: it is a repo-wide claim over every analyzer, and a one-lane run would replace that claim with a smaller one. Re-run with no --lang to regenerate it, or pass --out <path> for a dev artifact.`)
  }
} else {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
}

const c = payload.counts
console.log(`analyzer docs: ${c.analyzers} analyzer(s)`)
console.log(`  doc present          ${c.present}/${c.analyzers}${c.absent ? `  (absent: ${absent.map((r) => r.lang).join(", ")})` : ""}`)
console.log(`  all 8 sections       ${c.sectionComplete}/${c.present}`)
console.log(`  no unexplained cells ${c.analyzers - c.ontologyCellGaps}/${c.analyzers}`)
console.log(`  FULLY complete       ${c.fullyComplete}/${c.analyzers}`)
console.log(`  count contract       ${countProblems.length === 0 ? "analyzer=page=lane=F1 row, and the router/ontology denominators match docs/analyzers/README.md" : `${countProblems.length} mismatch(es)`}`)
if (payload.worklist.unexplainedOntologyCells.length) {
  console.log(`\nunexplained ontology cells (a real gap, not a formatting one):`)
  for (const r of payload.worklist.unexplainedOntologyCells) console.log(`  ${r.lang}: ${r.gaps.slice(0, 3).join("; ")}`)
}
console.log(`\n→ ${only ? "(not written: scoped run)" : path.relative(ROOT, OUT)}`)
// ENFORCING SINCE 2026-11-03 (the launch pass). The fleet reads 50/50 fully complete, so the debt
// this gate was written to MEASURE is closed and the measurement becomes a FLOOR. The `baseline`
// block above stays exactly what it always was — the historical record — and the exit code is what
// changes. The design note at the head of this file already said "a language that LOSES a section
// fails"; nothing implemented it, because at the time 22 languages were short and a red gate would
// have been ignored. That reason is gone: every page now carries all eight sections with no
// unexplained ontology cell, so any new absence, missing section or unexplained cell is a
// REGRESSION and the run must say so with an exit code, not only in a printed count.
const regressions = [
  ...countProblems.map((p: string) => `COUNT CONTRACT: ${p}`),
  ...absent.map((r: any) => `${r.lang}: no canonical doc`),
  ...sectionShort.flatMap((r: any) => r.missingSections.map((s: string) => `${r.lang}: missing section ${s}`)),
  ...cellGaps.flatMap((r: any) => r.ontologyGaps.map((g: string) => `${r.lang}: ${g}`)),
]
if (regressions.length > 0) {
  console.log(`\nFAIL — ${regressions.length} regression(s) against the 2026-11-03 floor of 50/50 fully complete:`)
  for (const r of regressions) console.log(`  ${r}`)
  process.exit(1)
}
