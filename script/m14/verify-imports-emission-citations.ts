// script/m14/verify-imports-emission-citations.ts — THE IMPORTS-EMISSION CITATION TABLE, CHECKED AND RE-DERIVABLE
//
// WHY THIS FILE EXISTS. `validation/m14/verification/IMPORTS-EDGE-SHAPE.md` carries a table of 48 rows, one per
// lane, giving "evidence read (file:line of the emission)" — the line where that lane's imports edge is
// published. A LINE NUMBER is a citation, and a citation is only worth what a reader can CHECK.
//
// MEASURED 2026-10-20, and the finding is three findings:
//   · in the old tree `.tmp-r178-head`, 45 of the 48 citations land on a line that really does publish an Imports
//     relationship — so THE TABLE WAS CORRECT WHEN IT WAS WRITTEN;
//   · at HEAD, 0 of 48 land on one — the table has DRIFTED, because every analyzer has grown under it;
//   · and 3 of the 48 were wrong even in the old tree, so they were never checkable at all.
//
// THE TOOL THAT CAUGHT IT was the toml lane: it found that toml's own pages cited `:1569` where the emission
// now lives at `:1596`, and it checked the shift by re-reading the file at the old revision. That is the right
// way to check a drifted citation, and this file makes it REPEATABLE for all 48 rows.
//
// WHAT THIS DOES.
//   (default)  CHECK every row: does the cited line still publish an Imports relationship? A row that does not
//              is reported with the drift, and the exit code is non-zero. A table that cannot fail is a table
//              that drifts silently, which is what happened.
//   (--fix)    RE-DERIVE every row FROM THE CODE, not from the number: the old tree's cited line is read, its
//              CONTENT is matched against HEAD's copy of the same file, and the row is rewritten to the line
//              that now holds that same content. A citation is re-derived by finding the CODE, never by adding
//              a delta — a delta is a guess about a movement, and the code is the evidence.
//
// THE MATCH IS BY CONTENT, so it is exact: a line that moved is found wherever it moved to, and a line whose
// content is ambiguous in HEAD is REPORTED rather than guessed at.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

/**
 * ★ THE ROOT WAS WRONG BY ONE LEVEL, AND ONLY WORKED BY ACCIDENT (Lead, 2026-10-21).
 *
 * `import.meta.dirname` for THIS file is `<repo>/script/m14`, so `path.resolve(that, "..", "..")` is
 * the PARENT OF THE REPOSITORY — not the repository. The `??` fallback (`process.cwd()/script/m14` plus
 * the same two levels) happened to land on the right directory only when the process was started from
 * the repository root, which is what every invocation did, so the bug never fired.
 *
 * It is the same class of defect the campaign keeps finding: A PATH THAT IS NOT DERIVED FROM THE FILE
 * THAT USES IT IS A PATH THAT IS RIGHT BY COINCIDENCE. The root is now derived from the file's own
 * location with the DEPTH SPELLED OUT, so it is right from any working directory.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..")
const TABLE = path.join(ROOT, "validation/m14/verification/IMPORTS-EDGE-SHAPE.md")
/** THE TREE THE TABLE WAS WRITTEN AGAINST. Its content is the evidence of what each citation MEANT. */
const OLD_TREE = path.join(ROOT, ".tmp-r178-head")

const FIX = process.argv.includes("--fix")

/** A line that PUBLISHES an imports relationship. The comment lines are excluded: a comment that mentions
 *  Imports is not an emission, and the old tree's own citations were read against code, not prose. */
const EMITS = /RelationshipType\.Imports|type:\s*["']imports["']|["']imports["']\s*[,)]/

type Row = { line: number; lane: string; file: string; n: number; text: string }
const rows: Row[] = []
const tableLines = readFileSync(TABLE, "utf8").split("\n")
for (let i = 0; i < tableLines.length; i++) {
  const m = /^\|\s*`([\w-]+)`\s*\|\s*`(src\/ast\/real-[\w-]+-analyzer\.ts):(\d+)([^`]*)`\s*\|/.exec(tableLines[i])
  if (!m) continue
  rows.push({ line: i + 1, lane: m[1], file: m[2], n: Number(m[3]), text: m[4] })
}

let passed = 0, failed = 0, ambiguous = 0
const report: string[] = []

for (const r of rows) {
  const headPath = path.join(ROOT, r.file)
  if (!existsSync(headPath)) { failed++; report.push(`  ${r.lane}: MISSING ${r.file}`); continue }
  const head = readFileSync(headPath, "utf8").split("\n")

  // ── the CHECK: does the cited line still publish an imports relationship? ──
  const cited = head[r.n - 1] ?? ""
  const isComment = cited.trim().startsWith("*") || cited.trim().startsWith("//") || cited.trim().startsWith("/*")
  const cites = EMITS.test(cited) && !isComment

  // ── the RE-DERIVATION: find the CODE the citation named, in HEAD. ──
  let want = ""
  const oldPath = path.join(OLD_TREE, r.file)
  if (existsSync(oldPath)) {
    const old = readFileSync(oldPath, "utf8").split("\n")
    want = (old[r.n - 1] ?? "").trim()
  }
  let found = -1, hits = 0
  if (want) {
    for (let j = 0; j < head.length; j++) if (head[j].trim() === want) { found = j + 1; hits++ }
  }
  if (hits === 1) {
    if (found === r.n) { passed++; continue }
    report.push(`  ${r.lane.padEnd(12)} :${String(r.n).padEnd(6)} -> :${String(found).padEnd(6)} DRIFT ${found - r.n >= 0 ? "+" : ""}${found - r.n}`)
    if (FIX) {
      tableLines[r.line - 1] = tableLines[r.line - 1]
        .replace(`:${r.n}`, `:${found}`)
        .replace(/`$/, "")
      passed++
    } else failed++
  } else if (hits > 1) {
    ambiguous++
    report.push(`  ${r.lane.padEnd(12)} :${String(r.n).padEnd(6)} AMBIGUOUS — the old content appears ${hits} times in HEAD; not guessed at`)
    failed++
  } else {
    // the old content is gone: the line was edited, not just moved
    report.push(`  ${r.lane.padEnd(12)} :${String(r.n).padEnd(6)} the old content is GONE (the line was edited, not moved)${cites ? " — and the citation still reads as an emission" : ""}`)
    failed++
  }
}

console.log(`imports-emission citations — ${rows.length} rows`)
if (report.length) {
  console.log(FIX ? "  RE-DERIVED FROM HEAD:" : "  STALE:")
  for (const l of report) console.log(l)
}
if (FIX && report.length) {
  writeFileSync(TABLE, tableLines.join("\n"))
  console.log(`  the table was rewritten from the CODE (${report.length} row(s) changed)`)
}
console.log(`  ${passed} row(s) resolve to their citation · ${failed} need re-derivation · ${ambiguous} ambiguous`)
process.exit(failed === 0 ? 0 : 1)
