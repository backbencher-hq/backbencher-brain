#!/usr/bin/env bun
/**
 * merge-arm-slices.ts — MERGE A LANE'S CHUNKED ARM INTO ONE CLOSURE, OR REFUSE.
 *
 * ── WHY THIS EXISTS, AND IT IS FOUR FAILED ARMS AND FIVE LANE-SPECIFIC MERGES ────────────────────
 *
 * A whole-population arm does not fit in this environment's process lifetime. The cpp lane proved it
 * four times: a harness background job is reaped at the turn's end, a persistent terminal session is
 * reaped at the turn's end, and the window a turn gives a process is SHORTER THAN ONE 2,000-FILE SLICE
 * on its worst day. MEASURED, same window, same invocation, the slice width the only variable:
 *
 *     width 2,000 -> DIED (925 bytes, header only)
 *     width 1,000 -> DIED (no slice, no line for 8 min)
 *     width   500 -> OK, slice [6000, 6500) completed
 *
 * So the population is measured as a UNION OF SLICES, and the merge is what turns them into a closure.
 * There are already FIVE lane-specific merges of this shape (dart, groovy, html, svelte, yaml), and
 * five copies of one rule is how the sixth copy gets it wrong — the dart merge's first version read its
 * closure totals off `files[0]` and printed ONE SLICE'S totals beside the POPULATION'S edge count.
 *
 * ── THE THREE CHECKS, AND NOTHING IS WRITTEN IF ANY FAILS ─────────────────────────────────────────
 *
 *   (a) EVERY SLICE'S `parsed` EQUALS THE WIDTH OF ITS CLAIMED RANGE          -> exit 5
 *   (b) THE UNION IS CONTIGUOUS FROM 0, NO OVERLAP, NO SHORTFALL              -> exit 5
 *   (c) THE ELEVEN TERMS SUM TO THE MERGED EDGE COUNT                          -> exit 6
 *
 * ── AND THE CHECK IS CONTIGUITY, NOT UNIFORMITY ──────────────────────────────────────────────────
 *
 * A lane that SHRINKS its slices to fit a worse window produces a tiling of MIXED WIDTHS — cpp's own
 * logs carry three 2,000-wide slices beside a 500-wide one, contiguous from 0. A merge that assumed one
 * width would REFUSE A LEGITIMATE TILING, which is the one place a per-language merge would hard-code
 * whatever width it happened to use. SO THE SLICE SIZE IS A LANE-LOCAL PARAMETER, and this instrument
 * takes it from the slices rather than being told it.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────────────────────
 *
 *   bun script/m14/merge-arm-slices.ts --dir .tmp-cpp --population 23237 [--write out.json]
 *   bun script/m14/merge-arm-slices.ts --files a.txt b.txt --population 23237
 *
 * Every number this instrument prints carries its own population — the merged slice count, the covered
 * range, and the declared total — because a closure without its population is not a closure.
 */

import * as fs from "node:fs"
import * as path from "node:path"

const argv = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const has = (name: string): boolean => argv.includes(name)

/** One slice's own report. `start`/`end` come from the gate's CHUNK line; `end` is what it CLAIMED. */
interface Slice {
  file: string
  start: number
  end: number
  claimedTotal: number
  parsed: number
  /** The TOTAL row's eleven closure terms, in the gate's column order. */
  terms: {
    edges: number; resolved: number; collRes: number; ambDecl: number; ambKind: number
    unresolved: number; extOK: number; extPending: number; extFAIL: number
    bindOK: number; bindPending: number; bindFAIL: number; causeOK: number; causeFAIL: number
  }
}

const CHUNK_RE = /admitted files \[(\d+),\s*(\d+)\) of (\d+), and (\d+) of them were measured/
const TOTAL_RE = /^TOTAL\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m

function parseSlice(file: string): Slice | null {
  const src = fs.readFileSync(file, "utf8")
  const c = src.match(CHUNK_RE)
  if (!c) return null
  const t = src.match(TOTAL_RE)
  if (!t) return null
  const n = t.slice(1, 15).map(Number)
  return {
    file,
    start: Number(c[1]),
    end: Number(c[2]),
    claimedTotal: Number(c[3]),
    parsed: Number(c[4]),
    terms: {
      edges: n[0], resolved: n[1], collRes: n[2], ambDecl: n[3], ambKind: n[4], unresolved: n[5],
      extOK: n[6], extPending: n[7], extFAIL: n[8], bindOK: n[9], bindPending: n[10],
      bindFAIL: n[11], causeOK: n[12], causeFAIL: n[13],
    },
  }
}

const TERM_NAMES = [
  "resolved", "ambDecl", "unresolved", "bindOK", "bindPending", "bindFAIL",
  "extOK", "extPending", "extFAIL", "causeOK", "causeFAIL",
] as const

function main(): void {
  const dir = arg("--dir")
  const popArg = arg("--population")
  const write = arg("--write")
  const explicit = argv.flatMap((a, i) => (a === "--files" ? argv.slice(i + 1).filter((x) => !x.startsWith("--")) : []))

  let files: string[] = []
  if (dir) {
    files = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".txt") && !f.includes(".err"))
      .map((f) => path.join(dir, f))
  } else if (explicit.length > 0) files = explicit
  if (files.length === 0) {
    console.error("merge-arm-slices: no slice logs found. Pass --dir <dir> or --files <a> <b> ...")
    process.exit(2)
  }

  const slices: Slice[] = []
  const unparsed: string[] = []
  for (const f of files) {
    const s = parseSlice(f)
    if (s) slices.push(s)
    else unparsed.push(f)
  }
  // A file with a CHUNK line but no TOTAL is an INCOMPLETE slice — a dead process, not a slice. It is
  // reported and IGNORED rather than refused, because a dead slice contributes nothing and the lane's
  // checkpoint will re-run it. A file with neither is not a slice at all.
  const incomplete = unparsed.filter((f) => CHUNK_RE.test(fs.readFileSync(f, "utf8")))

  slices.sort((a, b) => a.start - b.start)

  console.log(`merge-arm-slices: ${slices.length} complete slice(s), ${incomplete.length} incomplete (ignored), ${unparsed.length - incomplete.length} not a slice`)
  for (const f of incomplete) console.log(`  INCOMPLETE (dead process, will be re-run): ${path.basename(f)}`)
  if (slices.length === 0) {
    console.error("merge-arm-slices: no COMPLETE slice to merge — refusing to write anything")
    process.exit(5)
  }

  const population = popArg !== undefined ? Number(popArg) : slices[0].claimedTotal
  if (!Number.isFinite(population) || population <= 0) {
    console.error(`merge-arm-slices: bad population ${String(popArg)}`)
    process.exit(2)
  }
  const foreign = slices.filter((s) => s.claimedTotal !== population)
  if (foreign.length > 0) {
    console.error(`merge-arm-slices: REFUSED — a slice claims a DIFFERENT population (${foreign.map((s) => `${path.basename(s.file)}=${s.claimedTotal}`).join(", ")} against ${population})`)
    process.exit(5)
  }

  // ── (a) EVERY SLICE'S parsed EQUALS THE WIDTH OF ITS CLAIMED RANGE ──────────────────────────────
  const widthWrong = slices.filter((s) => s.parsed !== s.end - s.start)
  if (widthWrong.length > 0) {
    console.error("merge-arm-slices: REFUSED — a slice's parsed count does not equal its claimed width:")
    for (const s of widthWrong) console.error(`  ${path.basename(s.file)}: [${s.start}, ${s.end}) width ${s.end - s.start} but parsed ${s.parsed}`)
    process.exit(5)
  }

  // ── (b) CONTIGUOUS FROM 0, NO OVERLAP, NO SHORTFALL ─────────────────────────────────────────────
  let cursor = 0
  for (const s of slices) {
    if (s.start !== cursor) {
      const kind = s.start < cursor ? "OVERLAP" : "GAP"
      console.error(`merge-arm-slices: REFUSED — the tiling is ${kind === "GAP" ? "INCOMPLETE" : "OVERLAPPING"}: ${kind} at ${cursor}..${s.start}`)
      console.error(`  slices present: ${slices.map((x) => `[${x.start},${x.end})`).join(" ")}`)
      console.error(`  covered ${cursor} of ${population}, shortfall ${population - cursor}`)
      console.error("  A merge may not write a partial population, and it may not average its way over a hole.")
      process.exit(5)
    }
    cursor = s.end
  }
  if (cursor !== population) {
    console.error(`merge-arm-slices: REFUSED — the tiling is INCOMPLETE: covered ${cursor} of ${population}, shortfall ${population - cursor}`)
    console.error("  A merge may not write a partial population, and it may not average its way over a hole.")
    process.exit(5)
  }

  // ── THE MERGED TOTAL ────────────────────────────────────────────────────────────────────────────
  const merged = {
    edges: 0, resolved: 0, collRes: 0, ambDecl: 0, ambKind: 0, unresolved: 0,
    extOK: 0, extPending: 0, extFAIL: 0, bindOK: 0, bindPending: 0, bindFAIL: 0,
    causeOK: 0, causeFAIL: 0,
  }
  for (const s of slices) for (const k of Object.keys(merged) as (keyof typeof merged)[]) merged[k] += s.terms[k]

  // ── (c) THE ELEVEN TERMS SUM TO THE MERGED EDGE COUNT ──────────────────────────────────────────
  const sum = TERM_NAMES.reduce((n, k) => n + merged[k], 0)
  const perSliceBad = slices.filter((s) => TERM_NAMES.reduce((n, k) => n + s.terms[k], 0) !== s.terms.edges)

  console.log("")
  console.log(`population: parsed=${population}/${population} admitted=${population} exts=(slices' own) index=(slices' own)`)
  console.log(`slices: ${slices.length} · covered [0, ${population}) contiguous, no overlap, no shortfall`)
  console.log(`widths present: ${[...new Set(slices.map((s) => s.end - s.start))].sort((a, b) => a - b).join(", ")} (MIXED WIDTHS ARE LEGITIMATE — contiguity is the check, not uniformity)`)
  console.log("")
  console.log("  resolved        " + merged.resolved)
  console.log("  amb(decl)       " + merged.ambDecl)
  console.log("  unresolved      " + merged.unresolved)
  console.log("  bindOK          " + merged.bindOK)
  console.log("  bind?           " + merged.bindPending)
  console.log("  bindFAIL        " + merged.bindFAIL)
  console.log("  extOK           " + merged.extOK)
  console.log("  ext?            " + merged.extPending)
  console.log("  extFAIL         " + merged.extFAIL)
  console.log("  causeOK         " + merged.causeOK)
  console.log("  causeFAIL       " + merged.causeFAIL)
  console.log("  ── SUM          " + sum)
  console.log("  EDGES           " + merged.edges)
  console.log("  collRes (beside, never added) " + merged.collRes)
  console.log("  amb(kind) (a SUBSET of amb(decl), never added) " + merged.ambKind)
  console.log("")

  if (perSliceBad.length > 0) {
    console.error("merge-arm-slices: REFUSED — a slice's OWN terms do not sum to its own edge count:")
    for (const s of perSliceBad) console.error(`  ${path.basename(s.file)}: sum ${TERM_NAMES.reduce((n, k) => n + s.terms[k], 0)} vs edges ${s.terms.edges}`)
    process.exit(6)
  }
  if (sum !== merged.edges) {
    console.error(`merge-arm-slices: REFUSED — the eleven terms sum to ${sum} but the merged edge count is ${merged.edges} (shortfall ${merged.edges - sum})`)
    console.error("  A NUMBER THAT LOOKS LIKE A CLOSURE IS WORSE THAN A MISSING ONE, because the missing one is still being looked for.")
    process.exit(6)
  }

  console.log(`CLOSURE EXACT: the eleven terms sum to the edge count, ${merged.edges} = ${merged.edges}, over ${slices.length} slice(s) covering 0..${population}.`)
  console.log(`refusals that did NOT fire: extFAIL ${merged.extFAIL} · bindFAIL ${merged.bindFAIL} · causeFAIL ${merged.causeFAIL}`)

  if (write) {
    const out = {
      meta: {
        instrument: "merge-arm-slices.ts",
        population: {
          parsed: population, corpusTotal: population, admitted: population,
          string: `parsed=${population}/${population} admitted=${population} exts=(slices' own) index=(slices' own)`,
        },
        slices: slices.map((s) => ({ file: path.basename(s.file), range: [s.start, s.end], parsed: s.parsed, edges: s.terms.edges })),
        incompleteIgnored: incomplete.map((f) => path.basename(f)),
        tilingRule: "every slice's parsed equals its claimed width; the union is contiguous from 0 with no overlap and no shortfall; mixed widths are legitimate",
        closureRule: "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges",
      },
      closure: { ...merged, sum, exact: true },
    }
    fs.writeFileSync(write, JSON.stringify(out, null, 2) + "\n")
    console.log(`wrote ${write}`)
  }
}

main()
