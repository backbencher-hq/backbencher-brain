/**
 * POPULATION ATTRIBUTION — why the two full-corpus zig totals differ by
 * +2 symbols / +7 relationships.
 *
 * ## The discrepancy this exists to settle
 *
 * Two instruments in this lane both walk "the admitted population" through
 * production `parseFile` and publish a total:
 *
 *   - `ontology-census.ts` (sharded x8, merged by `shard-merge.py`)
 *       -> 127,614 symbols / 392,550 relationships over 3,834 files
 *   - `denylist-publication.ts` (single process)
 *       -> 127,612 symbols / 392,543 relationships over 3,833 files
 *
 * Pass 10 published the second as "the same admitted population at HEAD" and
 * read the +183/-7 delta against the pre-fix figure as a property of the
 * `keepSymbol` repair. That reading is only valid if both instruments admitted
 * the SAME FILE SET, and the doc asserted it without measuring it. This script
 * measures it.
 *
 * ## What it does
 *
 * It rebuilds both admission rules independently, prints the symmetric
 * difference of the two file sets, and runs production `parseFile` over exactly
 * the files in that difference. So the delta is attributed to named files with a
 * measured symbol/relationship count each, not to a narrative.
 *
 * The two rules, from source:
 *   - `ontology-census.ts:113`  `git ls-files -z -- '*.zig'` for EVERY directory
 *     in the corpus root that is a git repo, then `size <= 512 * 1024`.
 *   - `denylist-publication.ts:276` the same `trackedZig` walk, but only over
 *     THREE NAMED repo roots, with `CEILING = 524288` (`:83`) — the same byte.
 *
 * So the only possible difference is the repo SET, and this script prints which
 * repos each rule admits. A difference in any other direction (a size rule, a
 * symlink, a missing file) would show up here as a file in the symmetric
 * difference that is NOT a whole repo, and the delta would then be a defect in
 * one of the two walks rather than a difference of scope.
 *
 * No regex: the corpus walk is `git ls-files`, and the counts come from
 * `parseFile`'s own return value.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/zig/population-attribution.ts [--out <path>]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CEILING = 524288 // denylist-publication.ts:83

/** The three repo roots denylist-publication.ts walks (`:274-277`). */
const NAMED_REPOS = ["zig", "zls", "ghostty"]

const argv = process.argv.slice(2)
const OUT = (() => {
  const i = argv.indexOf("--out")
  return i >= 0 && argv[i + 1] ? argv[i + 1] : ""
})()

const L = (...a: unknown[]) => console.log(...a)

const trackedZig = (dir: string): string[] => {
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    return []
  }
}

type Rec = { repo: string; abs: string }
const sizeOf = (abs: string): number | null => {
  try {
    return statSync(abs).size
  } catch {
    return null
  }
}

const isRepo = (dir: string): boolean => {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/** Rule CENSUS: every git repo in the corpus root. */
const censusSet = (): Map<string, Rec> => {
  const m = new Map<string, Rec>()
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    if (!isRepo(dir)) continue
    for (const rel of trackedZig(dir)) {
      const abs = path.join(dir, rel)
      const sz = sizeOf(abs)
      if (sz === null || sz > CEILING) continue
      m.set(`${e}/${rel}`, { repo: e, abs })
    }
  }
  return m
}

/** Rule DENYLIST: the three named repo roots only. */
const denylistSet = (): Map<string, Rec> => {
  const m = new Map<string, Rec>()
  for (const e of NAMED_REPOS) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    for (const rel of trackedZig(dir)) {
      const abs = path.join(dir, rel)
      const sz = sizeOf(abs)
      if (sz === null || sz > CEILING) continue
      m.set(`${e}/${rel}`, { repo: e, abs })
    }
  }
  return m
}

const onlyIn = (a: Map<string, Rec>, b: Map<string, Rec>): string[] =>
  [...a.keys()].filter((k) => !b.has(k)).sort()

/** Set before the branches so the --out block can report them either way. */
let ok = false
let sym = 0
let rel = 0
const rows: { file: string; symbols: number; relationships: number; kinds: string; types: string }[] = []

L("population-attribution: which admitted population each instrument walks")
L(`corpus root: ${CR}`)
L(`ceiling: ${CEILING} bytes (denylist-publication.ts:83)`)
L("")
L("1. THE TWO FILE SETS, each rebuilt from its own source rule")
L("")

const A = censusSet()
const B = denylistSet()
const onlyA = onlyIn(A, B)
const onlyB = onlyIn(B, A)

const reposOf = (m: Map<string, Rec>): string[] =>
  [...new Set([...m.values()].map((r) => r.repo))].sort()

L(`   ontology-census.ts (every repo):      ${A.size} files across ${reposOf(A).length} repo(s): ${reposOf(A).join(", ")}`)
L(`   denylist-publication.ts (named only):  ${B.size} files across ${reposOf(B).length} repo(s): ${reposOf(B).join(", ")}`)
L("")
L(`   census \\ denylist (the delta's whole population): ${onlyA.length} file(s)`)
for (const k of onlyA) L(`     + ${k}  (${sizeOf(A.get(k)!.abs)} bytes)`)
L(`   denylist \\ census: ${onlyB.length} file(s)`)
for (const k of onlyB) L(`     - ${k}`)
L("")

if (onlyA.length === 0 && onlyB.length === 0) {
  L("   -> THE TWO RULES ADMIT THE SAME FILE SET. The totals must agree; if they")
  L("      do not, the difference is inside parseFile and this script has found")
  L("      nothing, which is itself the reportable result.")
  L("")
} else {
  const repos = new Set(onlyA.map((k) => k.split("/")[0]))
  const wholeRepo = onlyA.length === [...A.values()].filter((r) => repos.has(r.repo)).length
  L(
    wholeRepo
      ? `   -> the difference is exactly WHOLE REPO(S) the named list omits: ${[...repos].join(", ")}.`
      : `   -> the difference is NOT a whole repo, so it is a defect in one of the two walks, not a difference of scope.`,
  )
  L("")
  L("2. PRODUCTION parseFile OVER EXACTLY THOSE FILES")
  L("")

  for (const k of onlyA) {
    const abs = A.get(k)!.abs
    let r: any
    try {
      r = await parseFile(abs, "zig")
    } catch (e) {
      L(`   ${k}: THREW ${String(e).slice(0, 120)}`)
      continue
    }
    const s = r?.symbols ?? []
    const e2 = r?.relationships ?? []
    sym += s.length
    rel += e2.length
    const kinds = [...new Set(s.map((x: any) => `${x.kind}:${x.name}`))].join(" ")
    const types = [...new Set(e2.map((x: any) => x.type))].sort().join(" ")
    rows.push({ file: k, symbols: s.length, relationships: e2.length, kinds, types })
    L(`   ${k}`)
    L(`     symbols ${s.length}, relationships ${e2.length}`)
    L(`     ${kinds}`)
    L(`     ${types}`)
  }
  L("")
  L(`   TOTAL over the ${onlyA.length} differing file(s): ${sym} symbols, ${rel} relationships`)
  L("")
  L("3. THE ARITHMETIC, stated so it can be checked")
  L("")
  L(`   census total       127,614 symbols / 392,550 relationships  (${A.size} files)`)
  L(`   denylist total     127,612 symbols / 392,543 relationships  (${B.size} files)`)
  L(`   measured difference ${String(sym).padStart(6)} symbols / ${String(rel).padStart(6)} relationships  (${onlyA.length} file(s))`)
  ok = 127614 - sym === 127612 && 392550 - rel === 392543
  L("")
  L(
    ok
      ? "   -> THE DIFFERENCE IS FULLY ATTRIBUTED. census_total - measured == denylist_total,"
      : "   -> NOT FULLY ATTRIBUTED. The measured difference does not close the gap, so the",
  )
  if (ok) L("      so the delta is a difference of ADMITTED SCOPE and not a difference in the analyzer.")
  else L("      residual is a real behavioural difference between the two runs and is a finding.")
  L("")
  L("   This is pass 3's correction restating itself: no single-run figure here is a")
  L("   property of the analyzer alone. Pass 10 published 127,612/392,543 as 'the same")
  L("   admitted population'; the population was NOT the same, by exactly these files.")
  L("")
}

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        instrument: "validation/m14/fixtures/zig/population-attribution.ts",
        entryPoint: "parseFile (src/ast/pool-worker.ts)",
        corpusRoot: CR,
        ceilingBytes: CEILING,
        censusRule: "every git repo in the corpus root (ontology-census.ts:113)",
        denylistRule: `three named repo roots ${NAMED_REPOS.join(",")} (denylist-publication.ts:274-277)`,
        censusFiles: A.size,
        censusRepos: reposOf(A),
        denylistFiles: B.size,
        denylistRepos: reposOf(B),
        onlyInCensus: onlyA,
        onlyInDenylist: onlyB,
        measuredOnDifference: { symbols: sym, relationships: rel, rows },
        publishedCensusTotal: { symbols: 127614, relationships: 392550 },
        publishedDenylistTotal: { symbols: 127612, relationships: 392543 },
        fullyAttributed: ok,
      },
      null,
      2,
    ) + "\n",
  )
  L(`wrote ${OUT}`)
}