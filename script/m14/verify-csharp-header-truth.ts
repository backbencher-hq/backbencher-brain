/**
 * C# HEADER TRUTH — does the analyzer's own header describe the analyzer it heads?
 *
 * WHY THIS GATE EXISTS. On 2026-11-19 the close-out reversed a relationship ruling: `decorates`
 * went from excluded to emitted, and the analyzer gained 39,788 edges for it. The file's header
 * was not updated. It still read:
 *
 *   "THE OTHER THREE VALUES - decorates, mixes_in, part_of - are NOT emitted here ...
 *    its ATTRIBUTE is passive metadata, published as symbol metadata `decorators`, not as
 *    an applied callable - an ONTOLOGICAL ruling"
 *
 * — the exact claim the close-out disproved, sitting at line 9 of the file, contradicting line
 * 2646 of the same file. Section G of `completeness-inventory.ts` passed it, because section G
 * checks that a head comment is PRESENT, not that it is TRUE:
 *
 *   `detail: cfg.docs.join(", ") + " + head comment present"`
 *
 * That is the gap. A lane's header is the first thing a reader sees and the last thing anyone
 * re-reads, so a stale header does not merely misinform — it outranks the code in a reader's
 * mind, and it is invisible to every gate that checks presence rather than content.
 *
 * WHAT THIS ASSERTS, and it is deliberately narrow:
 *
 *   1. COUNT       the header names a relationship count ("TWELVE", "ELEVEN", ...) and that
 *                  number equals the count the ANALYZER actually emits. Derived from the
 *                  source's `RelationshipType.<X>` references, intersected with the 14-value
 *                  ontology, so it cannot be satisfied by editing prose alone.
 *   2. NAMES       every type the analyzer emits is named in the header's vocabulary sentence,
 *                  and no type it does NOT emit is listed as emitted.
 *   3. EXCLUSIONS  every type the header calls "not emitted" / "NOT emitted here" is genuinely
 *                  absent from the emission set. This is the check that would have caught the
 *                  2026-11-19 defect: the header excluded `decorates` while the code emitted it.
 *
 * WHAT IT DOES NOT ASSERT. Whether the header's PROSE is well-written, or whether its rationale
 * is correct — only that its countable claims match the code. A header that says "twelve" and
 * means it for the wrong reason passes; that is a review question, not a gate question.
 *
 * RUN: npx tsx script/m14/verify-csharp-header-truth.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

// PORTABLE ROOT. `import.meta.dir` is Bun-only and is `undefined` under tsx/Node, which throws
// `ERR_INVALID_ARG_TYPE` before the script runs — the same trap `grammar-node-inventory.ts` hit
// (P3-1). Every other script in this directory runs under `npx tsx`, so the documented runner
// must work.
const HERE = (() => {
  try {
    const dir = (import.meta as { dir?: string }).dir
    if (typeof dir === "string" && dir.length > 0) return dir
  } catch {
    // not Bun — fall through
  }
  return path.dirname(fileURLToPath(import.meta.url))
})()

const ROOT = path.resolve(HERE, "../..")
const ANALYZER = path.join(ROOT, "src/ast/real-csharp-analyzer.ts")

/** The 14-value ontology, from src/ast/types.ts. A subset is emitted; the rest are ruled. */
const ONTOLOGY = [
  "calls", "extends", "implements", "uses", "imports", "exports", "contains",
  "references", "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of",
] as const

/** The English number words a header might use, mapped to their value. */
const NUMBER_WORDS: Record<string, number> = {
  TEN: 10, ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14,
}

const src = fs.readFileSync(ANALYZER, "utf8")

// ---------------------------------------------------------------- 1. what the code emits
//
// Read the EMISSION SET from the analyzer's own source: every `RelationshipType.<X>` reference,
// intersected with the ontology. This is the same technique `widen-blast-radius.ts` uses, and it
// is deliberately not a hand-maintained list — a list would drift the moment someone adds a type.
const emitted = new Set<string>()
for (const t of ONTOLOGY) {
  const cap = t[0].toUpperCase() + t.slice(1)
  if (new RegExp(`RelationshipType\\.${cap}\\b`).test(src)) emitted.add(t)
}
const notEmitted = ONTOLOGY.filter((t) => !emitted.has(t))

console.log(`header-truth audit — csharp`)
console.log(`  analyzer: src/ast/real-csharp-analyzer.ts`)
console.log(`  emitted (${emitted.size}): ${[...emitted].sort().join(", ")}`)
console.log(`  not emitted (${notEmitted.length}): ${notEmitted.join(", ")}`)

// ---------------------------------------------------------------- 2. the header's claims
//
// The header is the leading comment block: everything before the first non-comment line.
const lines = src.split("\n")
const headerLines: string[] = []
for (const line of lines) {
  const t = line.trim()
  if (t.startsWith("//")) { headerLines.push(line); continue }
  if (t === "") { if (headerLines.length > 0) continue; else continue }
  break
}
const header = headerLines.join("\n")
if (header.length === 0) {
  console.log(`\nVERDICT: FAIL — no leading comment block found; the header claim cannot be checked.`)
  process.exit(1)
}
console.log(`  header: ${headerLines.length} comment line(s)`)

const problems: string[] = []
const notes: string[] = []

// ---- 2a. the COUNT claim -----------------------------------------------------
// The header states a count as "TWELVE of the live FOURTEEN-value relationship vocabulary".
const countMatch = /(?<num>TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN)\s+of\s+the\s+live\s+FOURTEEN/i
  .exec(header.replace(/\n/g, " "))
if (!countMatch) {
  problems.push(
    "the header does not state its relationship count in the auditable form " +
    "`<WORD> of the live FOURTEEN-value relationship vocabulary` — a count that cannot be read " +
    "cannot be checked against the code")
} else {
  const claimed = NUMBER_WORDS[countMatch.groups!.num.toUpperCase()]
  if (claimed === undefined) {
    problems.push(`header claims "${countMatch.groups!.num}" which is not a number this gate knows`)
  } else if (claimed !== emitted.size) {
    problems.push(
      `header claims ${claimed} emitted relationship types but the analyzer emits ${emitted.size} ` +
      `(${[...emitted].sort().join(", ")})`)
  } else {
    notes.push(`count matches: header says ${claimed}, analyzer emits ${emitted.size}`)
  }
}

// ---- 2b. the EXCLUSION claim -------------------------------------------------
// "THE TWO VALUES NOT EMITTED HERE - mixes_in and part_of - and NEITHER is a grammar claim"
// or "THE OTHER THREE VALUES - a, b, c - are NOT emitted here"
//
// This is the check that catches the 2026-11-19 defect. A type named in an exclusion sentence is
// asserted ABSENT; if the code emits it, the header is false.
//
// The two phrasings are both real, and the first is what the current header uses. A regex that
// only matched the second would silently pass this check — a check that cannot fire is worse than
// no check, so both forms are enumerated and a non-match is REPORTED rather than ignored.
const flat = header.replace(/\n/g, " ")
const exclusionPatterns: Array<{ name: string; re: RegExp; group: string }> = [
  {
    name: "VALUES NOT EMITTED HERE",
    re: /THE OTHER\s+(?<num>TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|TWO|THREE|FOUR)\s+VALUES?\s*-\s*(?<names>[a-z_,\s]+?)\s*-\s*(?:and\s+NEITHER|are\s+NOT\s+emitted|is\s+NOT\s+emitted)/i,
    group: "names",
  },
  {
    name: "VALUES NOT EMITTED HERE (bare)",
    re: /THE\s+(?<num>TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|TWO|THREE|FOUR)\s+VALUES?\s+NOT\s+EMITTED\s+HERE\s*-\s*(?<names>[a-z_,\s]+?)\s*-/i,
    group: "names",
  },
  {
    name: "X and Y are NOT emitted",
    re: /(?<names>[a-z_]+(?:\s*(?:,|\band\b)\s*[a-z_]+)+)\s+are\s+NOT\s+emitted/i,
    group: "names",
  },
]

let exclusionChecked = false
for (const { name, re, group } of exclusionPatterns) {
  const m = re.exec(flat)
  if (!m) continue
  exclusionChecked = true
  checkExcluded(m.groups![group], name)
  break
}

function checkExcluded(namesRaw: string, patternName: string): void {
  const named = namesRaw
    .split(/,|\band\b/)
    .map((s) => s.trim())
    .filter((s) => ONTOLOGY.includes(s as typeof ONTOLOGY[number]))
  if (named.length === 0) {
    problems.push(
      `the exclusion sentence ("${patternName}") names no relationship type this gate knows: ` +
      `"${namesRaw.trim()}" — if the header excludes types, it must name them in the ontology's spelling`)
    return
  }
  for (const t of named) {
    if (emitted.has(t)) {
      problems.push(
        `header says \`${t}\` is NOT emitted, but the analyzer emits it — this is exactly the ` +
        `2026-11-19 defect (header excluded \`decorates\` while the code emitted 39,788 edges)`)
    } else {
      notes.push(`exclusion correct: \`${t}\` is not emitted`)
    }
  }
}

if (!exclusionChecked) {
  // Not fatal — a header may simply not phrase its exclusions this way — but it is REPORTED,
  // because a silently skipped check cannot be distinguished from a passing one.
  notes.push(
    "no exclusion sentence matched the known phrasings — the exclusion check did NOT run. " +
    "If the header does exclude types, rephrase as `THE TWO VALUES NOT EMITTED HERE - x and y -`")
}

// ---- 2c. every emitted type is NAMED somewhere in the header ------------------
// A header that claims "twelve" and lists eleven has not described twelve.
const missingNames = [...emitted].filter((t) => !new RegExp(`\\b${t}\\b`).test(header))
if (missingNames.length > 0) {
  problems.push(
    `the analyzer emits ${missingNames.length} type(s) the header never names: ` +
    `${missingNames.join(", ")}`)
} else {
  notes.push(`every emitted type is named in the header`)
}

// ---------------------------------------------------------------- 3. report
console.log()
for (const n of notes) console.log(`  ok   ${n}`)
if (problems.length > 0) {
  console.log(`\nPROBLEMS (${problems.length}):`)
  for (const p of problems) console.log(`  ! ${p}`)
  console.log(`\n  The header is the first thing a reader sees. A stale one outranks the code in`)
  console.log(`  the reader's mind, and completeness section G checks only that it EXISTS.`)
  console.log(`  Re-derive the count and the exclusion list from the analyzer, not from memory.`)
  process.exit(1)
}

console.log(`\nVERDICT: PASS — the header's countable claims match the analyzer.`)
console.log(`  Count: ${emitted.size} emitted. Exclusions: ${notEmitted.length} genuinely absent.`)
console.log(`  Prose quality and rationale are NOT asserted; only the numbers and names are.`)