#!/usr/bin/env npx tsx
/**
 * THE MATLAB DECLARATION'S CAUSE RULINGS, WITH THIS LANE'S MEASURED CAUSE.
 *
 * `script/m14/sliced-declaration.ts` is the fleet's DERIVER, and its `CAUSE_TEXT` table is a
 * generic per-type sentence written from the go lane's shape (a call disambiguated by its
 * receiver, a name declared in several files, an import naming a package outside the admitted
 * set). That sentence is WRONG for this lane: the matlab population's edges do not fail to
 * resolve because of name collisions — they fail because the admitted population DECLARES NO
 * MATLAB SYMBOL AT ALL. Its three files are Objective-C source the router routes to matlab by
 * matching the English word `function ` inside a comment, so there is no declaration for any
 * edge to bind to (0 classdef sections, 0 function definitions; measured in
 * validation/m14/fixtures/matlab/measurements/matlab-constructs.txt).
 *
 * The deriver's numbers are EXACT (TABLE 1's own columns) and this file never changes a number:
 * it REPLACES the generic `what`/`falsifier` prose with the measured cause, recomputes the wall
 * from the declaration's own `types` rows so the count cannot drift from the arm, and keeps the
 * arm's own sampled worklist names (evidence of WHICH targets, never a count).
 *
 * WHY A LANE INSTRUMENT RATHER THAN A PATCHED JSON: a lane-specific declaration writer is the
 * fleet's own pattern (`go-declaration.ts`, the bash/ruled writers), and a generator re-run must
 * not silently restore a cause sentence from another language. This script is idempotent.
 *
 * Run: npx tsx script/m14/matlab-declaration.ts
 * Writes: validation/m14/instruments/matlab/incoming-declaration.json (in place)
 */
import { readFileSync, writeFileSync } from "node:fs"

const DECL = "validation/m14/instruments/matlab/incoming-declaration.json"
const CENSUS = "validation/m14/fixtures/matlab/measurements/matlab-constructs.txt"

interface Row {
  edges: number
  resolved: number
  external: number
  ambiguous: number
  otherUnresolved: number
  unclassed: number
  closure?: Record<string, number>
}

const doc = JSON.parse(readFileSync(DECL, "utf8"))
const types: Record<string, Row> = doc.types ?? {}

/** The arm's sampled names are EVIDENCE of which targets the wall holds, never its count. Keep
 *  the sentence the deriver already built so the names stay the ARM's, not this file's. */
function worklistSentence(what: string): string {
  const marker = "The arm's worklist samples"
  const at = what.indexOf(marker)
  if (at < 0) return ""
  return what.slice(at - 1).trimEnd()
}

const POPULATION_CAUSE =
  "CAUSE, MEASURED — THE POPULATION, NOT A NAME COLLISION: the admitted set is 3 files, and all " +
  "three are Objective-C source the router admits to matlab by matching the English word " +
  "`function ` inside a comment (the three files and their trigger lines are recorded in " +
  `${CENSUS}). The population contains 0 classdef sections, 0 function definitions and 0 ` +
  "declarations of any kind, so an edge can only be unresolved: resolution binds a target to a " +
  "DECLARATION, and this population declares no MATLAB symbol for any edge to reach. The count is " +
  "TABLE 1's exact column over the whole population, not a sample."

const rulings: Record<string, any> = doc.causeRulings ?? {}
for (const [cause, ruling] of Object.entries(rulings) as [string, any][]) {
  const label = cause.split("_")[0]
  const row = types[label]
  if (!row) continue
  const wall = Number(row.edges) - Number(row.resolved)
  const kept = worklistSentence(String(ruling?.what ?? ""))
  ruling.population = doc.meta?.population ?? ruling.population
  ruling.count = wall
  ruling.what =
    `${label}: ${row.resolved} of ${row.edges} edges resolved; the remaining ${wall} are ` +
    `${row.ambiguous ?? 0} ambiguous + ${row.otherUnresolved ?? 0} unresolved (TABLE 1's own ` +
    `columns, summed over ${doc.meta?.slices ?? 1} slice(s) — EXACT, not sampled). ${POPULATION_CAUSE}` +
    (kept ? ` ${kept}` : "")
  ruling.falsifier = {
    run:
      `npx tsx script/m14/incoming-gate.ts matlab 0 (the whole population in one process) — ` +
      `TABLE 1's resolved column for ${label} is the count`,
    wouldFail:
      `a run in which one of those ${wall} edges RESOLVES against a declaration in the admitted ` +
      `set (resolved > 0): that would mean the population does contain MATLAB declarations and ` +
      `the wall was the run's scope, not the population's content.`,
  }
}

doc.resolution_caveats = [
  ...(Array.isArray(doc.resolution_caveats) ? doc.resolution_caveats : []),
  "THE POPULATION IS OBJECTIVE-C SOURCE ADMITTED BY THE ROUTER'S SUBSTRING TEST: the three admitted `.m` files are not MATLAB source (their text carries `#import`, `@interface`, `NSString`), and their comments contain the word `function ` that src/ast/language-detection.ts:405 matches. Every edge in this declaration is therefore a statement about what the MATLAB analyzer emits when production routes non-MATLAB text to it — not a statement about a MATLAB codebase. The genuine-MATLAB evidence for the analyzer's eleven types is the fixture suite (validation/m14/fixtures/matlab/, 12 fixtures, 0 fail), and the census (validation/m14/fixtures/matlab/measurements/matlab-constructs.txt) carries the construct counts that show the population declares nothing.",
]
doc.meta = {
  ...(doc.meta ?? {}),
  laneCause:
    "The wall in this lane is the POPULATION's content, not name collisions: 3 admitted files, all Objective-C by content, 0 genuine MATLAB constructs (0 classdef, 0 function definitions, 0 methods/properties/events sections, 0 +pkg/ or @Class/ folders). The analyzer is exercised by the fixture suite, which is the only genuine MATLAB source this lane has.",
}

writeFileSync(DECL, JSON.stringify(doc, null, 2) + "\n")
console.log(
  `matlab declaration cause rulings replaced with the measured cause — ${Object.keys(rulings).length} ruling(s), ` +
    `population ${doc.meta?.population}, edges ${doc.meta?.measuredEdges}`,
)
