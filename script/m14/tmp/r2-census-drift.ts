/**
 * M49.R2 triage — MOVED or NEW?
 *
 * The census (`validation/m12/results/regex-census.json`) is a POSITIONAL index of
 * analyzer regexes (`file:line:source`) and R2 asserts it against HEAD's committed
 * blobs (`scanHeadAnalyzers`). Its two FATALs therefore read "7 unrecorded in census"
 * and "3 not present in HEAD" — and NEITHER statement distinguishes the two very
 * different things those can be:
 *
 *   MOVED  the same (file, source) pair at a new line. The register's ruling is that
 *          identity is file+source ("positions move on every edit, sources do not"),
 *          so this is a re-anchor of the index, not a policy event.
 *   NEW    a source the census has never carried. The policy is SHRINK-ONLY: a new
 *          analyzer regex must be audited at its call site, classified, registered in
 *          `validation/m49/regex-debt-register.json` when the class requires review,
 *          and documented in `reviews/regex-policy.md` — or converted to a char-scan.
 *          Regenerating the census over it would launder it into the baseline.
 *
 * Run: bun script/m14/tmp/r2-census-drift.ts
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { ROOT, diffScans, normSource, scanHeadAnalyzers } from "../../m12/census-truth"

const CENSUS = path.join(ROOT, "validation/m12/results/regex-census.json")
const REVIEW_CLASSES = new Set(["needs_review", "replaceable"])
const pairKey = (file: string, source: string) => `${file}\u0000${normSource(source)}`

async function main() {
  const census = JSON.parse(readFileSync(CENSUS, "utf8"))
  const committed: any[] = census.perFile.flatMap((f: any) => f.usages)
  const head = await scanHeadAnalyzers()
  const { missing, stale } = diffScans(committed, head)

  const censusPairs = new Map<string, number[]>()
  for (const e of committed) {
    const k = pairKey(e.file, e.source)
    censusPairs.set(k, [...(censusPairs.get(k) ?? []), e.line])
  }
  const headByEntryKey = new Map<string, any>()
  for (const e of head) headByEntryKey.set(`${e.file}:${e.line}:${normSource(e.source)}`, e)

  const movedIn: any[] = []
  const newIn: any[] = []
  for (const k of missing) {
    const e = headByEntryKey.get(k)!
    const pair = pairKey(e.file, e.source)
    if (censusPairs.has(pair)) movedIn.push({ ...e, censusLines: censusPairs.get(pair)! })
    else newIn.push(e)
  }

  const movedOut: any[] = []
  const gone: any[] = []
  for (const k of stale) {
    const e = committed.find((c: any) => `${c.file}:${c.line}:${normSource(c.source)}` === k)!
    const stillAt = head.filter((h: any) => pairKey(h.file, h.source) === pairKey(e.file, e.source)).map((h: any) => h.line).sort((a: number, b: number) => a - b)
    if (stillAt.length) movedOut.push({ ...e, headLines: stillAt })
    else gone.push(e)
  }

  console.log(`census: ${committed.length} positional usage(s) | HEAD: ${head.length} | declared total: ${census.totalRegexUsages}`)
  console.log(`\nMISSING (in HEAD, not in the census at that position): ${missing.length}`)
  for (const e of movedIn) {
    console.log(`  MOVED   ${e.file}:${e.line}  (census had ${e.censusLines.join(",")})  ${normSource(e.source)}`)
  }
  for (const e of newIn) {
    const cls = e.classification ?? "(unclassified)"
    console.log(`  NEW     ${e.file}:${e.line}  [${cls}${REVIEW_CLASSES.has(cls) ? " — register + document required" : " — normalization class, document only"}]  ${normSource(e.source)}`)
  }
  console.log(`\nSTALE (in the census, not in HEAD at that position): ${stale.length}`)
  for (const e of movedOut) {
    console.log(`  MOVED   ${e.file}:${e.line} -> HEAD ${e.headLines.join(",")}  ${normSource(e.source)}`)
  }
  for (const e of gone) {
    console.log(`  GONE    ${e.file}:${e.line}  [${e.classification}]  ${normSource(e.source)}`)
  }

  // The net question the policy asks: did the register GROW?
  console.log(`\nnet: ${head.length} at HEAD vs ${census.totalRegexUsages} declared (${head.length - committed.length >= 0 ? "+" : ""}${head.length - committed.length} positional; ${newIn.length} NEW source(s), ${gone.length} retired)`)
  const newReview = newIn.filter((e) => REVIEW_CLASSES.has(e.classification))
  console.log(`new sources needing a debt-register row: ${newReview.length}`)
  for (const e of newReview) console.log(`  ${e.file}:${e.line}  ${normSource(e.source)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
