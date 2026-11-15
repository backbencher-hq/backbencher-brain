/**
 * THE CONTROL for one candidate analyzer change: spell a `contains` target by its
 * owner's path instead of its bare name, and read what that would cost.
 *
 * ## The change under test
 *
 * `real-zig-analyzer.ts:1112-1134` emits every `contains` edge as
 * `{source: s.ownerName, target: s.name}`. The target is the member's BARE name,
 * so a reverse walk binds it against every declaration published under that bare
 * name across the whole index. `ambiguity-split.ts` measured, over a 600-file
 * draw, that 3,261 `contains` edges fall in bucket B1 — the target is published
 * under two or more kinds, AND the edge is already carrying the coordinate that
 * would select one: for `contains` the source IS the owner's absolute dotted
 * path, which is exactly the prefix of the member's own published `qualifiedName`.
 *
 * So the candidate change is one expression: `target: s.ownerName + "." + s.name`.
 *
 * ## Why this file exists instead of just doing it
 *
 * Because that change is not obviously safe, and the cost is asymmetric in a way
 * that a count of the upside alone would hide. `contains` is the lane's best
 * resolving type — 99.99% of its edges bind file-locally at the full population —
 * so it has a large working population to damage. And a `contains` edge whose
 * qualified target is NOT published does not merely stay ambiguous: it stops
 * binding AT ALL, converting a resolved edge into a dangling one. An ambiguity
 * and a break are different failures and only one of them is visible in a
 * before/after ambiguous count.
 *
 * So this file computes FOUR classes over the whole population and refuses to
 * print a verdict without all four:
 *
 *   FIX     currently AMBIGUOUS, qualified target binds to exactly one kind.
 *           This is the upside: the class the change is for.
 *   RISK    currently UNAMBIGUOUS, qualified target does NOT bind at all.
 *           This is the downside: an edge that works today and would dangle.
 *           It is the number that decides whether the change is admissible.
 *   NEUTRAL currently unambiguous and qualified still binds — no movement either
 *           way, recorded so the four classes sum to the population.
 *   LOST    currently AMBIGUOUS and qualified target binds to >1 kind, so the
 *           change cannot help it and does not hurt it. Kept separate from
 *           NEUTRAL because it is the residual the change leaves behind.
 *
 * ## The resolution map is `incoming-check`'s, reproduced
 *
 * A bare name indexed beside every `qualifiedName` that differs from it, and a
 * target ambiguous when it maps to two or more distinct `SymbolKind`s. This is
 * copied from `ambiguity-split.ts` and `incoming-check.ts` rather than invented,
 * because "would this bind" has to mean the same thing the reverse walk means,
 * or the answer is about a resolver that does not exist.
 *
 * Both tiers are reported. A `contains` member is almost always in the same file
 * as its owner, so FILE-LOCAL is the tier the graph performs; CORPUS is reported
 * beside it because a corpus-tier figure on its own flatters a contains edge that
 * the index will resolve locally anyway.
 *
 * ## No new walk
 *
 * Reads the `raw-N.json` per-edge dumps the sharded full-population census
 * already wrote, so this is a re-reading of a measured population rather than a
 * second population that could differ. The union hash is re-asserted against the
 * published draw hash; if it does not match, this file refuses.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/zig/contains-qualify-control.ts <sharddir> <drawHash>
 */
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"

const shardDir = process.argv[2]
const publishedDrawHash = process.argv[3]

if (!shardDir || !publishedDrawHash) {
  console.error("usage: contains-qualify-control.ts <sharddir> <drawHash>")
  process.exit(2)
}

type Site = { file: string; q: string; k: string; l: number }
type SymRec = { name: string; kind: string; qualifiedName: string; line: number }
type EdgeRec = { t: string; src: string; tgt: string; file: number }

const rawFiles = readdirSync(shardDir)
  .filter((n) => /^raw-\d+\.json$/.test(n))
  .sort()
if (rawFiles.length === 0) {
  console.error(`no raw-N.json in ${shardDir}`)
  process.exit(2)
}

/** `incoming-check.ts`'s map, reproduced: spelling -> the DISTINCT kinds under
 *  which it is published. A symbol contributes under its bare name AND, when it
 *  differs, under its qualified name — so a target spelled `Owner.member` is
 *  looked up exactly the way the reverse walk looks it up. */
const kindsOf = new Map<string, Set<string>>()
/** file -> the set of qualified names published in that file, for the file-local tier. */
const qByFile = new Map<string, Set<string>>()
/** file -> the set of bare names published in that file. */
const nByFile = new Map<string, Set<string>>()

const addKind = (k: string, kind: string): void => {
  let set = kindsOf.get(k)
  if (!set) kindsOf.set(k, (set = new Set()))
  set.add(kind)
}
const addTo = (m: Map<string, Set<string>>, k: string, v: string): void => {
  let set = m.get(k)
  if (!set) m.set(k, (set = new Set()))
  set.add(v)
}

const contains: { e: EdgeRec; file: string }[] = []
const seenFiles = new Set<string>()
let shards = 0
let totalEdges = 0
let totalSymbols = 0

for (const rf of rawFiles) {
  const j = JSON.parse(readFileSync(path.join(shardDir, rf), "utf8"))
  shards++
  totalEdges += (j.edges as EdgeRec[]).length
  const perFile: { key: string; symbols: SymRec[] }[] = j.files
  // `edge.file` is an index into THIS SHARD's `files` array, not into any global
  // list. Resolving it against a merged file list reads the wrong file and turns
  // the file-local tier into noise: it printed 0.57% where the census's own
  // file-local column reads 99.99% for this same type on this same population.
  // Carried per shard, because the index is only meaningful there.
  for (const f of perFile) {
    if (seenFiles.has(f.key)) throw new Error(`shard overlap on ${f.key}`)
    seenFiles.add(f.key)
    totalSymbols += f.symbols.length
    const q = new Set<string>()
    const n = new Set<string>()
    for (const s of f.symbols) {
      if (s.name.length === 0) continue
      addKind(s.name, s.kind)
      n.add(s.name)
      if (s.qualifiedName.length > 0 && s.qualifiedName !== s.name) {
        addKind(s.qualifiedName, s.kind)
        q.add(s.qualifiedName)
      } else {
        q.add(s.name)
      }
      const site: Site = { file: f.key, q: s.qualifiedName || s.name, k: s.kind, l: s.line ?? 0 }
      void site
    }
    qByFile.set(f.key, q)
    nByFile.set(f.key, n)
  }
  for (const e of j.edges as EdgeRec[]) {
    if (e.t === "contains") contains.push({ e, file: perFile[e.file]?.key ?? "" })
  }
}

const files = [...seenFiles].sort()
const unionHash = `sha256:` + createHash("sha256").update(files.join("\n")).digest("hex")
if (unionHash !== publishedDrawHash) {
  console.error(`REFUSING: union hash ${unionHash} != published draw ${publishedDrawHash}`)
  console.error("These shards are not the population the draw published; the counts below")
  console.error("would be correct numbers about a different set of files.")
  process.exit(1)
}

/**
 * THE DIRECTION GUARD, and it exists because this file was run on the wrong dump
 * and answered confidently.
 *
 * This is a COUNTERFACTUAL instrument: it reads a dump whose `contains` targets are
 * the BEFORE spelling and asks what a qualified spelling would do. Pointed at a
 * dump that has ALREADY had the change applied, every target is qualified, so
 * re-qualifying produces `Owner.Owner.member`, nothing binds, and the file
 * reports:
 *
 *     RISK 80,066 (100.00% of today's unique)
 *     VERDICT: the change is NOT ADMISSIBLE — 80,066 edges that bind uniquely today
 *
 * Which is the opposite of the truth, stated with the same confidence and no
 * caveat. The number is not a typo; it is the counterfactual correctly computed
 * over the wrong direction, and nothing in the file distinguished the two.
 *
 * So the guard is the direction itself, read off the data: an edge whose target
 * already begins with its own source plus a dot is a POST-change spelling. Above a
 * majority the dump is post-change and this instrument has no question to ask.
 */
let alreadyQualified = 0
for (const { e } of contains) {
  if (String(e.tgt).startsWith(`${e.src}.`)) alreadyQualified++
}
const qualifiedShare = contains.length === 0 ? 0 : alreadyQualified / contains.length
if (qualifiedShare > 0.5) {
  console.error(`REFUSING: ${alreadyQualified}/${contains.length} (${(qualifiedShare * 100).toFixed(2)}%) of`)
  console.error("`contains` targets in this dump ALREADY begin with their own source + '.',")
  console.error("so they carry the POST-change spelling and this counterfactual has no question to ask.")
  console.error("Point this file at the BEFORE dump (the one whose targets are bare member names).")
  process.exit(2)
}
console.log(`direction guard: ${alreadyQualified}/${contains.length} targets already qualified (${(qualifiedShare * 100).toFixed(2)}%) — dump reads as BEFORE, counterfactual is meaningful`)

// The two tiers. `hits` is the corpus tier; `local` the file tier, which is the
// walk the graph actually performs for a member of a container in the same file.
const corpusKinds = (spelling: string): number => kindsOf.get(spelling)?.size ?? 0
const fileKinds = (f: string, spelling: string): number => {
  const q = qByFile.get(f)
  const n = nByFile.get(f)
  let size = 0
  if (n?.has(spelling)) size++
  if (q?.has(spelling) && !n?.has(spelling)) size++
  return size
}

type Row = {
  edges: number
  nowUniqueCorpus: number
  nowAmbigCorpus: number
  nowUnboundCorpus: number
  FIX: number
  RISK: number
  NEUTRAL: number
  LOST: number
  nowUniqueLocal: number
  fixLocal: number
  riskLocal: number
  riskExamples: string[]
}
const row: Row = {
  edges: 0,
  nowUniqueCorpus: 0,
  nowAmbigCorpus: 0,
  nowUnboundCorpus: 0,
  FIX: 0,
  RISK: 0,
  NEUTRAL: 0,
  LOST: 0,
  nowUniqueLocal: 0,
  fixLocal: 0,
  riskLocal: 0,
  riskExamples: [],
}

for (const { e, file } of contains) {
  row.edges++
  const nowCorpus = corpusKinds(e.tgt)
  const nowLocal = fileKinds(file, e.tgt)
  if (nowLocal === 1) row.nowUniqueLocal++

  if (nowCorpus === 1) row.nowUniqueCorpus++
  else if (nowCorpus === 0) row.nowUnboundCorpus++
  // The third arm. It was MISSING in the first version of this file, which is why
  // it printed `ambiguous 0 (0.00%)` and `FIX … n/a of today's ambiguous` on a
  // population whose whole point is the ambiguous count. The FIX/RISK/NEUTRAL/LOST
  // partition was unaffected — it is derived from the branches below, and the sum
  // check caught that — but every DENOMINATOR this file printed from
  // `nowAmbigCorpus` read zero, and a denominator that reads zero makes a rate
  // unprintable rather than wrong-looking, which is the easy kind of bug to carry.
  else row.nowAmbigCorpus++

  const qual = `${e.src}.${e.tgt}`
  const afterCorpus = corpusKinds(qual)
  const afterLocal = fileKinds(file, qual)

  if (nowCorpus === 0) {
    // Already unbound today: the change cannot make it worse. Counted NEUTRAL so
    // the four classes still partition the population.
    row.NEUTRAL++
    continue
  }
  if (nowCorpus === 1) {
    // Works today. This is the class the change could damage.
    if (afterCorpus === 1 && afterLocal === 1) row.NEUTRAL++
    else {
      row.RISK++
      if (row.riskExamples.length < 8) {
        row.riskExamples.push(
          `${e.src} -> ${e.tgt} @ ${file}  qualified "${qual}" corpus=${afterCorpus} local=${afterLocal}`,
        )
      }
    }
    continue
  }
  // Ambiguous today. The change helps only if it selects exactly one.
  if (afterCorpus === 1 && afterLocal === 1) {
    row.FIX++
    if (afterLocal === 1) row.fixLocal++
  } else {
    row.LOST++
  }
}

const pct = (a: number, b: number): string => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(2)}%`)

console.log(`population   ${files.length} files   ${totalSymbols} symbols   ${totalEdges} edges`)
console.log(`union hash == published draw hash  ${unionHash}`)
console.log(`shards       ${shards}`)
console.log(``)
console.log(`contains edges under test  ${row.edges}`)
console.log(``)
console.log(`AS PUBLISHED TODAY (target = bare member name)`)
console.log(`  corpus tier   unique ${row.nowUniqueCorpus} (${pct(row.nowUniqueCorpus, row.edges)})   ambiguous ${row.nowAmbigCorpus} (${pct(row.nowAmbigCorpus, row.edges)})   unbound ${row.nowUnboundCorpus} (${pct(row.nowUnboundCorpus, row.edges)})`)
console.log(`  file tier     unique ${row.nowUniqueLocal} (${pct(row.nowUniqueLocal, row.edges)})`)
console.log(``)
console.log(`COUNTERFACTUAL (target = owner path + "." + member name)`)
console.log(`  FIX     ambiguous today, qualified binds to exactly one kind   ${row.FIX}   ${pct(row.FIX, row.nowAmbigCorpus)} of today's ambiguous`)
console.log(`  RISK    unique today, qualified does NOT bind                  ${row.RISK}   ${pct(row.RISK, row.nowUniqueCorpus)} of today's unique`)
console.log(`  NEUTRAL no movement either way                                ${row.NEUTRAL}`)
console.log(`  LOST    ambiguous today, qualified still ambiguous             ${row.LOST}`)
console.log(`  sum     ${row.FIX + row.RISK + row.NEUTRAL + row.LOST}  (equals the population: ${row.FIX + row.RISK + row.NEUTRAL + row.LOST === row.edges})`)
console.log(``)
console.log(`NET on the ambiguous count: ${row.FIX - row.LOST >= 0 ? "-" : "+"}${Math.abs(row.FIX - row.LOST)}  (${row.FIX} fixed, ${row.LOST} left)`)
console.log(`NET on the UNIQUE count:     ${row.RISK} edges would stop binding uniquely`)
if (row.riskExamples.length > 0) {
  console.log(``)
  console.log(`RISK examples:`)
  for (const x of row.riskExamples) console.log(`  ${x}`)
}
console.log(``)
const trade = row.FIX - row.RISK
console.log(``)
// The verdict states the TRADE and keeps the strict rule visible, because the
// first version of this line collapsed a ratio into a binary and called a
// +31,800 / -5 result "NOT ADMISSIBLE" on a `RISK === 0` threshold nobody in this
// programme set. A one-line verdict that hides its own threshold is a verdict
// nobody can argue with, which is the problem. Both readings are printed so the
// reader applies whichever policy they actually hold.
console.log(
  `TRADE: ${row.FIX} edges gain a unique binding, ${row.RISK} lose one — net ${trade >= 0 ? "+" : ""}${trade}` +
    ` (${row.RISK === 0 ? "no loss" : `${((row.RISK / Math.max(row.FIX, 1)) * 100).toFixed(3)}% of the gain is lost`}).`,
)
console.log(`  strict rule (RISK must be 0):        ${row.RISK === 0 ? "ADMISSIBLE" : "NOT ADMISSIBLE"}`)
console.log(`  ratio rule (RISK must be < 1% of FIX): ${row.RISK / Math.max(row.FIX, 1) < 0.01 ? "ADMISSIBLE" : "NOT ADMISSIBLE"}`)
console.log(`  No policy on this ratio was set by the programme. The two lines above are this file's own thresholds, stated so they can be disagreed with.`)