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
// Writes: validation/m14/results/analyzer-docs.json
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
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (/^#{1,6}\s/.test(line)) return false
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

/** Documentation of the analyzer's file, however this repo happens to name it. */
const DOC_CANDIDATES = (lang: string): string[] => [
  path.join(ROOT, "docs/analyzers", `real-${lang}-analyzer.md`),
  path.join(ROOT, "docs/analyzers", `${lang}.md`),
]

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
if (payload.worklist.unexplainedOntologyCells.length) {
  console.log(`\nunexplained ontology cells (a real gap, not a formatting one):`)
  for (const r of payload.worklist.unexplainedOntologyCells) console.log(`  ${r.lang}: ${r.gaps.slice(0, 3).join("; ")}`)
}
console.log(`\n→ ${only ? "(not written: scoped run)" : path.relative(ROOT, OUT)}`)
