/**
 * DOC TABLE CHECK — does every number in `docs/analyzers/julia.md`
 * equal what the instruments actually produced?
 *
 * ## Why this file exists
 *
 * This lane's doc published **10,936** ambiguous-target edges in prose while the table
 * printed directly above it summed to **11,098**. The census had been printing
 * **11,101** all along. So the error was not a measurement that was wrong — it was a
 * measurement that was correct and got transcribed into the wrong slot, and nothing in
 * the lane could see it: the census passes, the fixtures pass, the mutants die, the
 * arbiter agrees, and the doc is wrong.
 *
 * That is the failure mode this file closes. Every number below is read out of the
 * census JSON and compared against the number in the markdown table it claims to come
 * from. A drift in either direction fails.
 *
 * It is deliberately NOT a regex sweep over the prose. Prose contains figures that are
 * not table cells (quoted historical runs, ratios, a deliberately-wrong number quoted
 * in order to be corrected), and a scan that cannot tell a claim from a citation will
 * either miss real drift or force the doc to stop writing down why a number changed.
 * What is checked here is the class that has no excuse: a TABLE CELL whose value the
 * instrument can produce exactly.
 *
 * ## A DEGRADED census may not be compared against a clean doc
 *
 * Measured 2026-10-04: this check printed **FAIL — 41 mismatch(es)** against a doc whose every
 * cell is correct. The cause was not the doc. It read `/tmp/census.json`, a census left by an
 * earlier run of the day in which ONE file degraded —
 * `StaticArrays.jl/test/matrix_multiply_add.jl`, cause `wasmParseThrew`, `analysedFiles` 1,984 of
 * 1,985 — and compared that population's totals against figures measured over the clean one.
 *
 * The shape of the failure is what makes it worth a guard rather than a footnote: every one of the
 * 41 deltas was NEGATIVE and small (calls 122,150 -> 122,105; symbols 36,806 -> 36,803; one fewer
 * file in every type's file column). A degraded file's symbols and edges leave every total while
 * `admittedFiles` still reads 1,985, so the shortfall is indistinguishable from doc drift unless
 * the reader knows which population produced the instrument's side. Left alone this gate reports a
 * false alarm on a correct doc and, worse, trains the reader to ignore it.
 *
 * So a census carrying `degradedFiles.length > 0` is REFUSED for the census-backed sections, by
 * name and by cause, and the exit code says REFUSED rather than FAIL or PASS. Refusing rather than
 * passing is the point: this file's whole reason to exist is that a silent pass is the failure mode.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/julia/census.ts --json /tmp/census.json
 *   npx tsx validation/m14/fixtures/julia/doc-tables-check.ts [--json /tmp/census.json]
 *
 * `BB_JULIA_WORKERS=1` on the census is what produces a census this check will accept; see the
 * width section of the analyzer doc for why width 4 is exposed and width 1 is clean by construction.
 *
 * Exit 0 when every cell matches, 1 on mismatch, 2 when the census is degraded and the comparison
 * would not be like-for-like. Each mismatch is named by table, row and column so the fix is local.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..", "..", "..")
const DOC = path.join(ROOT, "docs/analyzers/julia.md")

function arg(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const CENSUS = arg("--json", "/tmp/census.json")

const lines = fs.readFileSync(DOC, "utf8").split("\n")

/** Find a markdown table by its header cells and return its body rows as cell arrays. */
function table(headerMustContain: string[]): string[][] {
  const isSep = (s: string) => /^\|[\s:|-]+\|$/.test(s.trim())
  for (let i = 0; i < lines.length - 2; i++) {
    const h = lines[i]
    if (!h.trim().startsWith("|")) continue
    if (!headerMustContain.every((c) => h.includes(c))) continue
    if (!isSep(lines[i + 1])) continue
    const rows: string[][] = []
    for (let j = i + 2; j < lines.length; j++) {
      const l = lines[j]
      if (!l.trim().startsWith("|")) break
      if (isSep(l)) continue
      rows.push(
        l
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim()),
      )
    }
    if (rows.length) return rows
  }
  return []
}

/** A cell is a bare thousands-separated integer, possibly wrapped in **bold** or `code`. */
function int(cell: string | undefined): number | null {
  if (cell == null) return null
  const cleaned = cell.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s/g, "")
  if (!/^\d{1,3}(,\d{3})*$/.test(cleaned)) return null
  return Number(cleaned.replace(/,/g, ""))
}

const problems: string[] = []
let checked = 0

/**
 * Join a paragraph that the author wrapped across lines. The doc hard-wraps prose at ~100
 * columns, so `By kind:` and `By relation:` each continue onto the following line, and a
 * checker that reads one line at a time finds half of every figure it is meant to verify
 * and reports it as MISSING rather than as the line-wrap it is.
 */
function paragraph(startsWith: string): string {
  const i = lines.findIndex((l) => l.startsWith(startsWith))
  if (i < 0) return ""
  let out = lines[i]
  let j = i + 1
  while (j < lines.length) {
    const nxt = lines[j]
    // a continuation is a non-empty line that is not a heading, table row, list item,
    // code fence or blank line.
    if (!nxt.trim() || /^[\s#|`>*-]/.test(nxt)) break
    out += " " + nxt.trim()
    j++
  }
  return out
}

/**
 * The same, for a paragraph located by CONTENT rather than by its opening words. Anchoring a
 * check on the exact phrasing it is meant to police is how a prose figure becomes uncheckable:
 * the negative control for section 7 renamed "Five fixtures" to "Six fixtures" and the anchor
 * missed, so the run reported a missing paragraph instead of the wrong number.
 */
function paragraphContaining(needle: string): string {
  const i = lines.findIndex((l) => l.includes(needle))
  if (i < 0) return ""
  let out = lines[i]
  let j = i + 1
  while (j < lines.length) {
    const nxt = lines[j]
    if (!nxt.trim() || /^[\s#|`>*-]/.test(nxt)) break
    out += " " + nxt.trim()
    j++
  }
  return out
}

/**
 * The same, but walking BACKWARD from the match to the paragraph's first line.
 *
 * Needed because the sentence this reads hard-wraps mid-enumeration: the needle
 * "edges are sourced from `global`/`root`" sits on the SECOND line, so `paragraphContaining`
 * returned a string beginning "…1,653 more from `root` and `exports` 794" and the seven figures
 * came back as [1653, 794, …]. A paragraph reader that cannot find the start of the paragraph it
 * is reading reports a shifted column as a wrong number.
 *
 * The backward walk uses a NARROWER terminator set than the forward one, and the difference is the
 * whole fix: this paragraph's first line opens with `**26,228 …`, so a backward rule that treats a
 * leading `*` as a list marker stops immediately and reads the same shifted seven figures. It stops
 * at a blank line, a heading, a table row, a blockquote, a fence, or a real list item (`- `/`* `/`+ `)
 * — the space after the marker is what separates a bullet from emphasis.
 */
function paragraphAround(needle: string): string {
  let i = lines.findIndex((l) => l.includes(needle))
  if (i < 0) return ""
  const isFwd = (l: string) => l.trim() !== "" && !/^[\s#|`>*-]/.test(l)
  const isBack = (l: string) => {
    if (l.trim() === "") return false
    if (/^\s*([-*+])\s/.test(l)) return false // a real list item
    return !/^\s*(#|\||>|```)/.test(l)
  }
  let start = i
  while (start > 0 && isBack(lines[start - 1])) start--
  let out = lines.slice(start, i + 1).join(" ")
  let j = i + 1
  while (j < lines.length) {
    if (!isFwd(lines[j])) break
    out += " " + lines[j].trim()
    j++
  }
  return out
}

function expect(where: string, cell: string | undefined, want: number | undefined, note = ""): void {
  const got = int(cell)
  checked++
  if (got === null) {
    problems.push(`${where}: cell is not a bare integer (${JSON.stringify(cell)}) — cannot check`)
    return
  }
  if (want === undefined) {
    problems.push(`${where}: instrument produced no value to compare against`)
    return
  }
  if (got !== want) problems.push(`${where}: doc says ${got.toLocaleString()}, instrument says ${want.toLocaleString()}${note ? ` (${note})` : ""}`)
}

/**
 * Percentages are compared with a tolerance of one unit in the last printed place, because
 * the doc truncates where the instrument rounds: `contains` both-ends is 10466/10467 =
 * 99.9904%, which the doc prints 99.9% and `toFixed(1)` would print 100.0%. Forcing the
 * doc to 100% would be a worse number — it is the banned "100% coverage" shape — so the
 * convention is that a doc figure may TRUNCATE but may never overstate. The check is
 * therefore one-sided: `doc <= instrument` and within one ulp.
 */
function expectPct(where: string, docPct: number, truePct: number): void {
  checked++
  const eps = 0.1
  if (docPct > truePct + eps) problems.push(`${where}: doc OVERSTATES — ${docPct}% vs instrument ${truePct.toFixed(4)}%`)
  else if (docPct < truePct - eps) problems.push(`${where}: doc says ${docPct}%, instrument says ${truePct.toFixed(4)}%`)
}

// The census-backed sections (1-6) need the census JSON. Section 7 does not — it reads the
// fixture expectations and the mutants module off disk — so a missing census must not stop it
// from running: the drift it catches is exactly the kind that happens when nobody re-ran the
// corpus. A missing census is reported as SKIPPED, never as a pass.
const haveCensus = fs.existsSync(CENSUS)
const census = haveCensus ? JSON.parse(fs.readFileSync(CENSUS, "utf8")) : {}
const pt = census.production?.perType ?? {}
const inc = census.incoming?.perType ?? {}
if (!haveCensus) {
  console.log(`doc tables check — sections 1-6 SKIPPED: no census at ${CENSUS}`)
  console.log(`  run: npx tsx validation/m14/fixtures/julia/census.ts --json ${CENSUS}`)
  console.log(`  section 7 (fixture and mutant counts) does not need a census and still runs.\n`)
}

/**
 * Is the census we are about to compare against CLEAN?
 *
 * `degradedFiles` names every file `parseFile` returned `fallback: true` for, by cause. Such a
 * file is absent from every total in `production` while `admittedFiles` still counts it, so a
 * degraded census and a clean doc are two different populations and the cells cannot agree even
 * when the doc is right. `analysedFiles` is the independent witness: it must equal `admittedFiles`.
 *
 * A census that predates the current corpus is the same hazard without a marker — hence the
 * admitted/analysed equality test, which catches a truncated or partial walk too.
 */
const degraded: { file?: string; bytes?: number; cause?: string }[] = Array.isArray(
  census.production?.degradedFiles,
)
  ? census.production.degradedFiles
  : []
const admitted = census.admittedFiles
const analysed = census.production?.analysedFiles
const censusIsClean = degraded.length === 0 && (admitted === undefined || analysed === admitted)
const censusAge = haveCensus
  ? fs.statSync(CENSUS).mtime.toISOString().replace("T", " ").slice(0, 19)
  : "n/a"
if (haveCensus && !censusIsClean) {
  console.log(`doc tables check — sections 1-6 REFUSED: the census is not a clean whole-population run`)
  console.log(`  census              ${CENSUS}`)
  console.log(`  census mtime        ${censusAge}`)
  console.log(`  admittedFiles       ${admitted}`)
  console.log(`  analysedFiles       ${analysed}`)
  console.log(`  degradedFiles       ${degraded.length}`)
  for (const d of degraded.slice(0, 20)) {
    console.log(`      ${d.cause ?? "unknown cause"}  ${d.file ?? "<no name>"}  (${d.bytes ?? "?"} bytes)`)
  }
  if (degraded.length > 20) console.log(`      …and ${degraded.length - 20} more`)
  console.log(
    `  A degraded file leaves every total while admittedFiles still counts it, so its shortfall` +
      `\n  reads as doc drift and is not. Comparing is refused rather than reported, and this is` +
      `\n  NOT a pass: exit 2. Re-run the census at a width that completes:` +
      `\n      BB_JULIA_WORKERS=1 npx tsx validation/m14/fixtures/julia/census.ts --json ${CENSUS}`,
  )
  console.log(`\n  section 7 (fixture and mutant counts) needs no census and still runs.\n`)
}

// ── 1. the verdict table: emitted edge count and file count per type ──────────────
// Columns: | type | Emitted? | verdict/measurement | files |
if (haveCensus && censusIsClean) {
const verdict = table(["Relationship type", "Emitted?", "Files"])
if (!verdict.length) problems.push("verdict table: not found")
for (const row of verdict) {
  const t = (row[0] ?? "").replace(/`/g, "")
  if (!pt[t]) continue
  // A RULED row carries NO edge count by construction — its measurement cell quotes the
  // probe ("0 of 12 named constructs … the 325 nearest candidates"), so the last figure
  // in the cell is the probe's, not the edge count. Checking it as an edge count is the
  // checker inventing a claim the row deliberately does not make. What IS checked is that
  // a ruled row says RULED and that its edge count, where it states one, is zero.
  if ((row[1] ?? "").toUpperCase().includes("RULED")) {
    checked++
    if (!pt[t] || (pt[t] as any).emitted !== 0) {
      problems.push(`verdict table / ${t}: marked RULED but the instrument emitted ${(pt[t] as any)?.emitted} edges`)
    }
    continue
  }
  // the measurement cell reads e.g. "relationship, **86,876**" or
  // "relationship **and** `ImportInfo[]`, **1,502** rows" — the edge count is the last
  // figure in the cell, and the trailing "rows" is not a figure.
  const nums = (row[2] ?? "").match(/\d{1,3}(?:,\d{3})*/g) ?? []
  if (!nums.length) {
    problems.push(`verdict table / ${t}: no figure in the measurement cell (${JSON.stringify(row[2])})`)
    continue
  }
  expect(`verdict table / ${t} / edges`, nums[nums.length - 1], pt[t].emitted, "cell may carry several figures; last is the edge count")
  expect(`verdict table / ${t} / files`, row[3], Array.isArray(pt[t].files) ? pt[t].files.length : undefined)
}

// ── 2. the incoming bucket table, one column per bucket ───────────────────────────
// Columns: type | edges | in-file unique | disamb | residual | ccall | ext-by-import
//          | corpus-only | local binding | unresolvable | synthetic scope
const BUCKET_COLS = [
  "in-file-unique",
  "in-file-ambiguous-disambiguated",
  "in-file-ambiguous-residual",
  "foreign-ccall",
  "external-by-import",
  "corpus-only",
  "local-binding",
  "unresolvable",
  "synthetic-scope",
] as const
const incoming = table(["type", "edges", "in-file unique"])
if (!incoming.length) problems.push("incoming bucket table: not found")
for (const row of incoming) {
  const t = (row[0] ?? "").replace(/`/g, "")
  const b = inc[t]?.target
  if (!b) continue
  expect(`incoming table / ${t} / edges`, row[1], pt[t]?.emitted)
  BUCKET_COLS.forEach((bucket, i) => {
    expect(`incoming table / ${t} / ${bucket}`, row[2 + i], b[bucket] ?? 0)
  })
}

// ── 3. the residual-ambiguity sub-table, which must sum to the doc's own total ────
// Columns: | | disambiguated | residual | total |
const ambTable = table(["disambiguated", "residual", "total"])
if (!ambTable.length) {
  problems.push("ambiguity table (disambiguated/residual/total): not found — if it was removed, drop this check")
} else {
  let sumAmb = 0
  let sumDis = 0
  let sumRes = 0
  for (const row of ambTable) {
    const label = (row[0] ?? "").replace(/[`*]/g, "").trim()
    if (label === "sum" || label === "") {
      sumDis = int(row[1]) ?? sumDis
      sumRes = int(row[2]) ?? sumRes
      sumAmb = int(row[3]) ?? sumAmb
      continue
    }
    const b = inc[label]?.target
    if (!b) continue
    const dis = b["in-file-ambiguous-disambiguated"] ?? 0
    const res = b["in-file-ambiguous-residual"] ?? 0
    expect(`ambiguity table / ${label} / disambiguated`, row[1], dis)
    expect(`ambiguity table / ${label} / residual`, row[2], res)
    expect(`ambiguity table / ${label} / row total`, row[3], dis + res, "must equal disambiguated + residual on the same row")
    sumDis += dis
    sumRes += res
  }
  expect("ambiguity table / sum / disambiguated", ambTable[ambTable.length - 1]?.[1], sumDis)
  expect("ambiguity table / sum / residual", ambTable[ambTable.length - 1]?.[2], sumRes)
  expect("ambiguity table / sum / total", ambTable[ambTable.length - 1]?.[3], sumDis + sumRes)

  // And the instrument's own total, which is the number the prose must quote.
  const instrumentTotal = Object.values(inc).reduce(
    (acc: number, perType: any) => acc + ((perType?.target?.["in-file-ambiguous-disambiguated"] ?? 0) + (perType?.target?.["in-file-ambiguous-residual"] ?? 0)),
    0,
  )
  expect("ambiguity table / sum / total vs instrument", ambTable[ambTable.length - 1]?.[3], instrumentTotal, "sum of both buckets over all types")
}

// ── 4. the six-questions table's RESOLVED column, in percent ──────────────────────
// Columns: type | EXISTS | FIRES | CORRECT | LABELLED | RESOLVED (both ends) | CONFIDENT
// The RESOLVED cell reads "**19.8%** (src 78.1 / tgt 23.1 / neither 18.7)".
const six = table(["type", "EXISTS", "FIRES", "CORRECT", "LABELLED", "RESOLVED"])
if (!six.length) problems.push("six-questions table: not found")
for (const row of six) {
  const t = (row[0] ?? "").replace(/`/g, "")
  const r = pt[t]?.resolution
  if (!r || !r.edges) continue

  // The FIRES cell reads "86,876 / 926 files" — edges over files. Both are instrument
  // values, so both are checked. This was added after a negative control: injecting
  // `3 / 3` -> `9 / 3` into the `overrides` row was NOT caught when only the RESOLVED
  // column was read, which is the same "a gate that cannot fail" shape this file exists
  // to close, one level down.
  const fires = (row[2] ?? "").match(/([\d,]+)\s*\/\s*([\d,]+)/)
  if (fires) {
    expect(`six questions / ${t} / FIRES edges`, fires[1], r.edges)
    const filesN = Array.isArray(pt[t]?.files) ? (pt[t]!.files as string[]).length : undefined
    // the cell's second figure is the file count and may carry a "files" suffix; it is
    // checked only when the row's type actually has a file list to compare against.
    if (filesN !== undefined) expect(`six questions / ${t} / FIRES files`, fires[2], filesN)
  }

  const cell = row[5] ?? ""
  const both = Number((((r.both ?? 0) / r.edges) * 100).toFixed(1))
  const pct = cell.match(/([\d.]+)%/)?.[1]
  checked++
  if (pct == null) {
    problems.push(`six questions / ${t}: RESOLVED cell has no percentage (${JSON.stringify(cell)})`)
    continue
  }
  expectPct(`six questions / ${t} / both-ends`, Number(pct), (r.both / r.edges) * 100)
  // src / tgt / neither, when quoted
  const rest = cell.match(/src\s+([\d.]+)\s*\/\s*tgt\s+([\d.]+)\s*\/\s*neither\s+([\d.]+)/)
  if (rest) {
    const src = ((r.both + (r.srcOnly ?? 0)) / r.edges) * 100
    const tgt = ((r.both + (r.tgtOnly ?? 0)) / r.edges) * 100
    const nei = ((r.neither ?? 0) / r.edges) * 100
    expectPct(`six questions / ${t} / src`, Number(rest[1]), src)
    expectPct(`six questions / ${t} / tgt`, Number(rest[2]), tgt)
    expectPct(`six questions / ${t} / neither`, Number(rest[3]), nei)
  }
}

// ── 5. the production totals line ────────────────────────────────────────────────
{
  const want = census.production?.symbols
  const line = lines.find((l) => l.startsWith("**Production totals.**"))
  checked++
  if (!line) problems.push("production totals: line not found")
  else {
    const got = line.match(/([\d,]+)\s+symbols/)?.[1]
    expect("production totals / symbols", got, want)
  }
}

// ── 6. the by-kind and by-relation paragraphs (both wrap across lines) ───────────
{
  const byKind = paragraph("By kind:")
  checked++
  if (!byKind) problems.push("by-kind paragraph: not found")
  else {
    for (const [kind, n] of Object.entries(census.production?.symbolKinds ?? {})) {
      // reads "function 16,834 · property 4,499 · …" — kind names are bare, not `code`.
      const re = new RegExp("\\b" + kind + "\\s+([\\d,]+)")
      expect(`by kind / ${kind}`, byKind.match(re)?.[1], n as number)
    }
  }
  const byRel = paragraph("By relation:")
  checked++
  if (!byRel) problems.push("by-relation paragraph: not found")
  else {
    for (const [type, v] of Object.entries(pt)) {
      if (!(v as any).emitted) continue
      // reads "**calls 86,876** · references 36,147 · …" — the FIRST type is inside a bold
      // span that opens before the name, so the bold markers sit on both sides of the pair.
      const re = new RegExp("\\*?\\*?" + type + "\\s+\\*?\\*?([\\d,]+)")
      expect(`by relation / ${type}`, byRel.match(re)?.[1], (v as any).emitted)
    }
  }
}
} // end census-backed sections 1-6

// ── 7. the fixture and mutant counts, which need NO census ────────────────────────
//
// These four numbers drifted twice and no cell covered them. The doc said "Four fixtures
// … 38 expected symbols, 33 expected relationships, 20 forbidden relationships … 21
// mutants … 21 killed" in one section and "25 killed, 0 survived, of 25" in another, while
// the files on disk held 5 fixtures, 49/46/32 and 28 mutants. `bun run run-fixtures` and
// `mutation-check --all` both passed throughout: they report what IS there, and nothing
// compared that against what the doc SAYS is there. Two runs of the same gate agreeing with
// each other is not a check.
//
// Unlike sections 1-6 these values do not depend on the corpus, so they are derived from the
// expectation JSON and the mutants module directly and need no census. That is deliberate:
// the drift happened on a run where the census was irrelevant.
{
  const FIXDIR = path.join(ROOT, "validation/m14/fixtures/julia")
  const expFiles = fs
    .readdirSync(FIXDIR)
    .filter((f) => f.endsWith(".expectation.json"))
    .sort()

  // The expectation keys hold ARRAYS of expected rows, not counts — the doc's "49 expected
  // symbols" is the summed LENGTH. Reading them as scalars is the first version of this check
  // and it summed four zeros while the count check beside it passed.
  const totals = { expectSymbols: 0, expectRelationships: 0, forbidRelationships: 0, forbidSymbols: 0 }
  for (const f of expFiles) {
    const e = JSON.parse(fs.readFileSync(path.join(FIXDIR, f), "utf8"))
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
      if (Array.isArray(e[k])) totals[k] += e[k].length
    }
  }

  // "Five fixtures, **49 expected symbols, 46 expected relationships, 32 forbidden
  // relationships, 8\nforbidden symbols**; `bun run …` → 5 pass, 0 fail." — wrapped, so joined.
  // Anchored on the CONTENT, not on the spelled-out count. The first version anchored on the
  // literal "Five fixtures,", so renaming the count to a wrong number turned the check into
  // "paragraph: not found" instead of "doc says 6, directory holds 5" — a failure either
  // way, but one that reads as a broken checker rather than as drift.
  const fx = paragraphContaining("expected symbols")
  checked++
  if (!fx) {
    problems.push("fixture paragraph: not found (the paragraph stating the expected-symbol total) — if it was reworded, update this check")
  } else {
    // The fixture count is spelled out ("Five fixtures"), so `expect`/`int` cannot read it.
    // This is checked rather than tolerated: the drift it catches began as exactly this
    // sentence reading "Four" when the directory held five.
    // THE WORD LIST IS PART OF THE INSTRUMENT, so it grows with the suite rather than capping it.
    // The 2026-10-28 fixture (`callable-shapes`) took the directory to eleven and the check refused
    // the doc's own "Eleven" as an unknown word — a stale vocabulary reported as a doc defect, which
    // is the shape this file exists to catch in its own output.
    const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen"]
    checked++
    const spelled = fx.match(/^(\w+)\s+fixtures/)?.[1]
    const spelledN = WORDS.indexOf(spelled ?? "")
    if (spelledN < 0) problems.push(`fixtures / count: ${JSON.stringify(spelled)} is not a number word this check knows`)
    else if (spelledN !== expFiles.length) problems.push(`fixtures / count: doc says "${spelled}" (${spelledN}), directory holds ${expFiles.length}`)
    expect("fixtures / expectSymbols", fx.match(/([\d,]+)\s+expected symbols/)?.[1], totals.expectSymbols)
    expect("fixtures / expectRelationships", fx.match(/([\d,]+)\s+expected relationships/)?.[1], totals.expectRelationships)
    expect("fixtures / forbidRelationships", fx.match(/([\d,]+)\s+forbidden relationships/)?.[1], totals.forbidRelationships)
    expect("fixtures / forbidSymbols", fx.match(/([\d,]+)\s+forbidden symbols/)?.[1], totals.forbidSymbols)
    const pass = fx.match(/(\d+)\s+pass,\s+(\d+)\s+fail/)
    checked++
    if (!pass) problems.push(`fixtures / pass-fail: no "N pass, M fail" in the fixture paragraph (${JSON.stringify(fx.slice(0, 120))})`)
    else if (Number(pass[1]) !== expFiles.length || Number(pass[2]) !== 0) {
      problems.push(`fixtures / pass-fail: doc says ${pass[1]} pass ${pass[2]} fail, expected ${expFiles.length} pass 0 fail`)
    }
  }

  const { JULIA_MUTANTS } = await import(path.join(ROOT, "script/m60/julia-mutants"))
  const n = JULIA_MUTANTS.length

  // "`script/m60/julia-mutants.ts` holds **28 mutants**."
  const mp = paragraph("`script/m60/julia-mutants.ts` holds")
  checked++
  if (!mp) problems.push("mutant count sentence: not found")
  else expect("mutants / count", mp.match(/holds\s+\*\*([\d,]+)\s+mutants/)?.[1], n)

  // "… and it runs them: **28 killed, 0 survived, of 28**."
  // The KILLED and SURVIVED figures are what `mutation-check --all` prints; the OF total is
  // the module's length. All three are asserted against the module, so a mutant added
  // without a re-run cannot leave the doc claiming the old total survived.
  //
  // EVERY line carrying the figure is checked, not the first. The doc states it in two places
  // (§ "No regex in this lane" and § "The fixture lane and its mutants") and the negative
  // control drifted the FIRST one; a check reading only the first line of a figure that appears
  // twice is the same two-places-one-number defect this check exists to catch, one level up.
  const runLines = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /\bkilled,\s+[\d,]+\s+survived,\s+of\s+[\d,]+/.test(l))
  checked++
  if (!runLines.length) problems.push("mutation-run sentence: no \"N killed, M survived, of K\" anywhere in the doc")
  for (const { l, i } of runLines) {
    const m = l.match(/([\d,]+)\s+killed,\s+([\d,]+)\s+survived,\s+of\s+([\d,]+)/)
    const at = `doc:${i + 1}`
    if (!m) {
      problems.push(`mutation-run sentence / ${at}: unparseable (${JSON.stringify(l.trim().slice(0, 90))})`)
      continue
    }
    expect(`mutants / killed / ${at}`, m[1], n, "every mutant is killed, so killed == module length")
    expect(`mutants / survived / ${at}`, m[2], 0)
    expect(`mutants / of-total / ${at}`, m[3], n)
  }

  // The pattern above only sees the "N killed, M survived, of K" phrasing, and the doc states the
  // count in two other shapes: a table cell reading "25 mutants, 25 killed, 0 survivors" and a
  // sentence reading "All 25 mutants die". Both said 25 while the module held 28, and neither was
  // caught — because the check anchored on a PHRASING rather than on the quantity. This is the same
  // two-places-one-number defect the block above was written for, one syntactic level down: a
  // figure is a figure however it is worded, so every "N mutant(s)" in the doc is now read, and a
  // line that states a mutant count in any shape must agree with the module.
  //
  // "mutant" also appears in prose that is not a count ("a mutant that cannot fail is
  // decoration", "13 Julia mutants"), so the read is deliberately narrow: a number immediately
  // before or after the noun, and NOT inside the lines already checked above (which are counted
  // once, by their own three figures).
  {
    const alreadyChecked = new Set(runLines.map(({ i }) => i))
    const countLines = lines
      .map((l, i) => ({ l: l.trim(), i }))
      .filter(({ l }) => /mutants?\b/i.test(l))
      .filter(({ i }) => !alreadyChecked.has(i))
    checked++
    if (countLines.length === 0) {
      problems.push("mutant count: no line in the doc states a mutant count outside the killed/survived/of phrasing — if that sentence was reworded away, say so here")
    }
    let read = 0
    // A figure can be a CLAIM about the module's current size or a CITATION of a value this file
    // used to print. Both are written as "N mutants" and only one is a claim, so they are told apart
    // by an explicit historical marker in the words immediately before the figure. Citations are
    // counted and named rather than silently skipped: a marker list that quietly exempts text is the
    // same hole this check was written to close, so the number of exemptions is itself checked to be
    // non-zero-and-explained only when the doc really does cite a past figure.
    const CITATION = /said|used to|previously|earlier|formerly|no longer|drifted|corrected/i
    let citations = 0
    for (const { l, i } of countLines) {
      for (const m of l.matchAll(/([\d,]+)\s+mutants?\b/gi)) {
        const before = l.slice(Math.max(0, m.index - 60), m.index)
        if (CITATION.test(before)) {
          citations++
          continue
        }
        read++
        expect(`mutants / count / doc:${i + 1}`, m[1], n, `figure "${m[1]} mutants" must equal the module length`)
      }
    }
    if (read === 0) {
      problems.push("mutant count: found lines naming mutants but no current-state \"N mutants\" figure to compare — if the phrasing changed, update this check")
    }
    console.log(`  (mutant-count scan: ${read} current-state figure(s) checked, ${citations} historical citation(s) exempted by an explicit past-tense marker)`)
  }
}

// ── 8. the incoming-check block, against a LIVE run of the shared instrument ───────
//
// The doc quotes a verbatim `script/m14/incoming-check.ts` block over a PINNED five-file set.
// It was quoted before `932a20d27` added `imports`/`exports` and `f2e84906f` fixed the
// 17-module `using`, and it was never re-run: the block still read `imports 48` and
// `references 390` where the same five unchanged corpus files now give 50 and 391. The doc
// names this failure mode in its own words — "a quoted block is a SNAPSHOT, and a quoted block
// is not evidence about the present" — and then committed a stale snapshot of a block whose
// file set is FIXED, which is the one case where the excuse does not apply: a pinned set has no
// sampling excuse, so a moved number is a code change nobody re-quoted.
//
// This runs the shared instrument on the file set THE DOC NAMES — parsed out of the doc, not
// duplicated here, so there is one source of truth — and compares every cell. It costs ~20 s.
{
  const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
  // The pinned set, read from the doc's own fenced command so a change to one is a change to both.
  const cmdBlock = lines.findIndex((l) => l.includes("incoming-check.ts julia"))
  const pinned: string[] = []
  for (let i = cmdBlock; i >= 0 && i < lines.length && pinned.length < 5; i++) {
    const m = lines[i].match(/\$R\/([\w./-]+\.jl)/)
    if (m) pinned.push(path.join(CORPUS, m[1]))
  }
  if (cmdBlock < 0 || pinned.length !== 5) {
    problems.push(`incoming-check: could not read the pinned 5-file set from the doc (found ${pinned.length}) — the doc must name it for this check to mean anything`)
  } else if (pinned.some((f) => !fs.existsSync(f))) {
    problems.push(`incoming-check: pinned file missing from the corpus: ${pinned.filter((f) => !fs.existsSync(f)).join(", ")}`)
  } else {
    const { execFileSync } = await import("node:child_process")
    let live: any = null
    try {
      const out = execFileSync("npx", ["tsx", "script/m14/incoming-check.ts", "julia", ...pinned, "--json"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 32 * 1024 * 1024,
      })
      // the instrument logs INFO lines to stderr and the JSON to stdout
      live = JSON.parse(out.slice(out.indexOf("{")))
    } catch (e: any) {
      problems.push(`incoming-check: instrument failed — ${String(e?.message ?? e).split("\n")[0]}`)
    }
    if (live) {
      // the quoted block: a fixed-width table inside a fence.
      const rows = new Map<string, string[]>()
      for (const l of lines) {
        const m = l.match(/^(calls|uses|contains|imports|references|exports|extends|implements|overrides|instantiates)\s+(yes|NO)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$/)
        if (m) rows.set(m[1], m.slice(2))
      }
      checked++
      if (!rows.size) problems.push("incoming-check: the quoted per-type block was not found in the doc")
      for (const [type, want] of Object.entries(live.perType ?? live.types ?? {})) {
        const got = rows.get(type)
        if (!got) {
          problems.push(`incoming-check / ${type}: no row in the doc's quoted block`)
          continue
        }
        checked++
        if ((want.fired ? "yes" : "NO") !== got[0]) problems.push(`incoming-check / ${type} / fired: doc says ${got[0]}, instrument ${want.fired ? "yes" : "NO"}`)
        expect(`incoming-check / ${type} / edges`, got[1], want.edges)
        expect(`incoming-check / ${type} / targetsDistinct`, got[2], want.targetsDistinct)
        expect(`incoming-check / ${type} / ambiguousTargets`, got[3], want.ambiguousTargets)
        expect(`incoming-check / ${type} / unresolvedTargets`, got[4], want.unresolvedTargets)
      }
      // the header line and the two footer totals.
      const hdr = lines.find((l) => /incoming check — julia, \d+ file\(s\), [\d,]+ symbols/.test(l))
      checked++
      if (!hdr) problems.push("incoming-check: header line not found")
      else {
        expect("incoming-check / symbols", hdr.match(/([\d,]+)\s+symbols/)?.[1], live.symbols)
        expect("incoming-check / files", hdr.match(/julia,\s+(\d+)\s+file/)?.[1], pinned.length)
      }
      const decls = lines.find((l) => l.includes("distinct declarations named by at least one edge"))
      checked++
      if (!decls) problems.push("incoming-check: 'distinct declarations' line not found")
      else expect("incoming-check / distinct declarations", decls.match(/edge\s+:\s+([\d,]+)/)?.[1], live.distinctIncomingTargets)
      const orph = lines.find((l) => l.includes("declarations nothing names (orphans)"))
      checked++
      if (!orph) problems.push("incoming-check: orphans line not found")
      else {
        expect("incoming-check / orphans", orph.match(/orphans\)\s+:\s+([\d,]+)/)?.[1], live.orphanDeclarations)
        expect("incoming-check / orphan denominator", orph.match(/of\s+([\d,]+)\s*$/)?.[1], live.symbols)
      }
      const amb = lines.find((l) => l.includes("target names resolving to >1 published symbol"))
      checked++
      if (!amb) problems.push("incoming-check: ambiguity line not found")
      else expect("incoming-check / ambiguous names", amb.match(/:\s+([\d,]+)\s*$/)?.[1], live.ambiguousTargetNames?.length)
    }
  }
}

// ── 9. the synthetic-source sentence, against census.production.syntheticSources ────
//
// "26,228 `calls`, 7,757 `uses`, 4,020 `global` + 3,231 `root` `references` and 716
// `instantiates` … `imports` carries 1,653 more from `root` and `exports` 794"
//
// THIRD occurrence of one root cause in this file: a figure that moves, sits in prose, and is
// read by nobody. The doc's own correction note for the FIRST occurrence named the blind spot
// ("doc-tables-check.ts reads table cells and this is prose") and then two later corpus-changing
// commits moved two of the seven figures without the sentence being re-read. So the note was
// right and was not acted on; this closes it.
if (haveCensus && censusIsClean) {
  const ss = census.production?.syntheticSources ?? {}
  const SYN_ORDER = [
    "calls|global",
    "uses|global",
    "references|global",
    "references|root",
    "instantiates|global",
    "imports|root",
    "exports|root",
  ] as const
  const sent = paragraphAround("edges are sourced from `global`/`root`")
  checked++
  if (!sent) {
    problems.push("synthetic-sources sentence: not found (the paragraph stating the global/root source counts) — if it was reworded, update this check")
  } else {
    // The sentence states them in prose order, which is census-key order, so the figures can be
    // read positionally and checked against the keys in the same order. Reading them by key name
    // would be impossible — the sentence writes "4,020 `global` + 3,231 `root` `references`",
    // which names the type last and the scope first.
    // `[\d,]+` is wrong here: the sentence separates figures with a comma after a backticked
    // type name ("`calls`, 7,757"), and a bare comma matches `[\d,]+` on its own — so the first
    // attempt read the seven figures as [26228, ",", 7757, ",", 4020, 3231, 716]. A figure
    // pattern that also matches punctuation reads a shifted column, not a wrong one.
    const figs = sent.match(/\d{1,3}(?:,\d{3})*/g) ?? []
    SYN_ORDER.forEach((key, i) => {
      const want = ss[key]
      if (typeof want !== "number") {
        problems.push(`synthetic sources / ${key}: census has no such key (${Object.keys(ss).join(", ")})`)
        return
      }
      expect(`synthetic sources / ${key}`, figs[i], want, `figure ${i + 1} of the sentence, in census-key order`)
    })
  }
}

// ── report ───────────────────────────────────────────────────────────────────────
console.log(`doc tables check — ${path.relative(ROOT, DOC)}`)
console.log(
  `census: ${
    haveCensus
      ? censusIsClean
        ? `${CENSUS} (mtime ${censusAge}; clean: 0 degraded, analysedFiles ${analysed} of ${admitted})`
        : `${CENSUS} (mtime ${censusAge}) — NOT CLEAN, sections 1-6 REFUSED`
      : "ABSENT — sections 1-6 not checked"
  }`,
)
console.log(`cells checked: ${checked}`)

// The doc quotes this gate's OWN cell count in prose ("N cells"), and that quote drifted: the checker
// grew from 209 to 294 cells as this file's tables grew, and the prose kept saying 209 for four
// commits. Nothing caught it, because the figure lives in a fenced code block and this gate reads
// table cells on purpose — the same "a right measurement in the wrong slot" shape this file exists to
// catch, one level up. So the count is now checked against the doc: the quoted figure must equal what
// this run actually checked.
//
// The count is a MOVING figure by construction — it grows with every census-comparable table cell the
// doc adds — so this check fails on a doc edit that adds a checked table without updating the quote,
// which is the correct time to fail. It is compared as a number found in the doc's own "cells checked:"
// line, so the doc keeps one quoted figure and one meaning.
//
// It is CENSUS-DEPENDENT, though, and that has to be said rather than scored. Most of the cells it
// counts come from sections 1-6, so a run with no census — or with a census this file has just
// REFUSED — necessarily checks far fewer, and comparing that against the doc's full-run figure would
// report "the doc claims MORE coverage than the gate delivers" about a doc that is exactly right.
// Measured 2026-10-04: the refusal path above reported that sentence, naming a correct doc as stale.
// So the comparison only runs on a full census-backed pass, and the partial run SAYS it is partial.
const censusBackedSectionsRan = haveCensus && censusIsClean
{
  const quoted = /cells checked:\s*([\d,]+)/.exec(lines.join("\n"))
  if (!quoted) {
    problems.push(
      `self-count: the doc quotes no "cells checked:" figure, so this gate's own coverage is undocumented. ` +
        `Add the line to the doc's gate section, or say explicitly that it is deliberately unquoted.`,
    )
  } else if (!censusBackedSectionsRan) {
    console.log(
      `\nself-count SKIPPED — the doc quotes "cells checked: ${quoted[1].replace(/,/g, "")}" and this run checked ${checked}.`,
    )
    console.log(
      `  Sections 1-6 did not run, so ${checked} is not comparable to a full run's figure. Comparing them would`,
    )
    console.log(`  name a correct doc stale. The quoted figure is checked on a census-backed run.`)
  } else {
    const want = Number(quoted[1].replace(/,/g, ""))
    if (want !== checked) {
      problems.push(
        `self-count: the doc quotes "cells checked: ${want}" and this run checked ${checked}. ` +
          `${want > checked ? "The doc claims MORE coverage than the gate delivers" : "the doc understates the gate's coverage"} — ` +
          `either the doc's figure is stale or a table stopped being checked.`,
      )
    }
  }
}

if (problems.length > 0) {
  console.log(`\nFAIL — ${problems.length} mismatch(es):`)
  for (const p of problems) console.log(`  ${p}`)
  process.exit(1)
}
// A degraded census is refused AFTER section 7 has run (section 7 reads fixtures and mutants off
// disk and needs no census), so its result is still reported — but the census-backed comparison is
// not scored. Exit 2 is distinct from 1 (FAIL) and from the 2 used for a MISSING census below, and
// the banner above says which of the two it is, because both mean "not a green run of this gate".
if (haveCensus && !censusIsClean) {
  console.log(`\nREFUSED (partial) — the ${checked} census-independent cell(s) match, but sections 1-6 were NOT compared.`)
  console.log(`The census named above is degraded or incomplete, so its totals are a different population`)
  console.log(`from the doc\'s. A FAIL here would be a false alarm on a correct doc; a PASS would be the`)
  console.log(`silent-pass failure this file exists to prevent. Neither is printed. Re-run the census:`)
  console.log(`    BB_JULIA_WORKERS=1 npx tsx validation/m14/fixtures/julia/census.ts --json ${CENSUS}`)
  process.exit(2)
}
// A clean run with no census checked FEWER cells than a clean run with one. Printing PASS
// there would be the "an empty result over a non-empty corpus is a failed check" shape this
// project already has a rule about: the skip must be visible in the exit code.
if (!haveCensus) {
  console.log(`\nPASS (partial) — the ${checked} census-independent cell(s) match, but sections 1-6 were SKIPPED.`)
  console.log(`This is NOT a green run of the doc gate. Re-run with a census.`)
  process.exit(2)
}
console.log(`\nPASS — every table cell equals the instrument's value`)
process.exit(0)
