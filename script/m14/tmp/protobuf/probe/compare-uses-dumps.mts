/**
 * COMPARE two `uses-target-dump.mts` outputs and classify every edge whose
 * emitted target differs.
 *
 * ## Why the classifier excludes degraded files
 *
 * The 500-parse WASM trap in `src/ast/engine.ts` (`getParser` calls `p.delete()`
 * on the shared cached `Parser`) degrades a file to a regex extractor whose
 * symbols carry no `kind` and no `metadata.id`. A degraded file publishes
 * nothing, so every edge INTO it looks unbound and every comparison run disagrees
 * with the last one on files it never touched.
 *
 * `uses-target-dump.mts` records which files the comparison is safe over by
 * reporting `degraded`, but not WHICH files were degraded, so this classifier
 * re-derives them: an edge is only compared when the file publishes at least one
 * id in the SAME run's published set. A file that degraded publishes nothing, so
 * it drops out of both arms and cannot manufacture a difference.
 *
 * ## The four outcomes
 *
 *   FIXED  the target was published by NO file before and by >=1 after.
 *   BROKE  published by >=1 before and by NO file after. This is the number that
 *          decides admissibility: a change that recovers 6 and breaks 1 is a
 *          trade, not a fix.
 *   SWAP   published by >=1 in both runs, but a DIFFERENT declaration. The
 *          reverse walk would follow a real edge to a wrong declaration, which
 *          is worse than an unresolved edge, so it is counted on its own.
 *   OTHER  anything else — chiefly a file that degraded in one run only.
 *
 * ## The number that would overturn this
 *
 * `BROKE >= 1` overturns the change. So does `SWAP >= 1`. A run in which BOTH
 * dumps report `degraded 0` and the classified difference is empty establishes
 * that nothing moved; a run that observes the trap establishes nothing either
 * way and says so.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/compare-uses-dumps.mts A.json B.json
 */
import { readFileSync } from "node:fs"

const [aPath, bPath] = process.argv.slice(2)
if (!aPath || !bPath) {
  console.error("usage: compare-uses-dumps.mts <before.json> <after.json>")
  process.exit(2)
}
const A = JSON.parse(readFileSync(aPath, "utf8"))
const B = JSON.parse(readFileSync(bPath, "utf8"))

/** Only files that actually published something in BOTH runs are comparable. */
function live(dump: any): Set<string> {
  const byFile = new Map<string, number>()
  for (const id of Object.keys(dump.published)) for (const f of dump.published[id]) byFile.set(f, (byFile.get(f) ?? 0) + 1)
  return new Set([...byFile].filter(([, n]) => n > 0).map(([f]) => f))
}
const liveA = live(A), liveB = live(B)
const comparable = new Set([...liveA].filter((f) => liveB.has(f)))

// The three fields are joined by JSON rather than by a literal NUL. The
// separator was a real NUL byte in an earlier revision, which is correct as a
// key (NUL cannot occur in a path or a symbol id) and had the side effect of
// making git classify this SOURCE FILE as binary: committed as `Bin`, no diff,
// no line review, and skipped by every text scanner in the tree. Same key,
// same injectivity, no control byte in the file.
const key = (e: any) => JSON.stringify([e.file, e.source, e.target])
const a = new Map<string, any>()
for (const e of A.edges) if (comparable.has(e.file)) a.set(key(e), e)
const b = new Map<string, any>()
for (const e of B.edges) if (comparable.has(e.file)) b.set(key(e), e)

const gone = [...a.values()].filter((e) => !b.has(key(e)))
const added = [...b.values()].filter((e) => !a.has(key(e)))

const na = (t: string) => (A.published[t] ?? []).length
const nb = (t: string) => (B.published[t] ?? []).length

type Row = { file: string; source: string; from: string; to: string }
const fixed: Row[] = [], broke: Row[] = [], swap: Row[] = [], other: Row[] = []
for (const e of gone) {
  // The replacement is the new edge at the same file and source. `added` is tiny
  // by construction, so a linear scan is cheaper than another index.
  const cand = added.filter((x) => x.file === e.file && x.source === e.source)
  const to = cand.length === 1 ? cand[0].target : null
  const row = { file: e.file, source: e.source, from: e.target, to }
  if (to === null) { other.push(row); continue }
  const was = na(e.target), now = nb(to)
  if (was === 0 && now >= 1) fixed.push(row)
  else if (was >= 1 && now === 0) broke.push(row)
  else if (was >= 1 && now >= 1) swap.push(row)
  else other.push(row)
}

const w = (s: string, n: number) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`A ${aPath}\n  edges ${A.edges.length}, degraded ${A.degraded}, published ids ${A.distinctPublishedIds}`)
console.log(`B ${bPath}\n  edges ${B.edges.length}, degraded ${B.degraded}, published ids ${B.distinctPublishedIds}`)
const carryingA = new Set(A.edges.map((e: any) => e.file)).size
console.log(`\nfiles publishing >=1 id: A ${liveA.size}, B ${liveB.size}, comparable (in both) ${comparable.size} of ${liveA.size} in A`)
console.log(`files carrying a uses edge in A: ${carryingA} of ${comparable.size} comparable`)
console.log(`edges compared ${a.size}; identical ${[...a.keys()].filter((k) => b.has(k)).length}; differing ${gone.length} removed / ${added.length} added`)
console.log(`\n${w("outcome", 9)}${w("edges", 8)}`)
console.log("-".repeat(17))
for (const [lbl, lst] of [["FIXED", fixed], ["BROKE", broke], ["SWAP", swap], ["OTHER", other]] as [string, Row[]][]) {
  console.log(`${w(lbl, 9)}${w(String(lst.length), 8)}`)
  for (const r of lst) console.log(`   ${w(r.from, 50)} -> ${w(r.to ?? "(edge dropped)", 50)} ${r.file}`)
}
const verdict = broke.length > 0 ? "REJECT — a bound edge stopped resolving" : swap.length > 0 ? "REJECT — a bound edge now points at a different declaration" : fixed.length > 0 ? "ACCEPT — no bound edge lost, N gained" : "NO CHANGE OBSERVED"
console.log(`\nverdict: ${verdict}`)
if (A.degraded > 0 || B.degraded > 0) console.log(`NOTE: a degraded file was present in ${A.degraded > 0 ? "A" : "B"}; degraded files are excluded from the comparison, so the counts above are the comparable remainder.`)
console.log(`OVERTURN: BROKE >= 1 or SWAP >= 1 rejects the change. Both are ${broke.length} and ${swap.length}.`)