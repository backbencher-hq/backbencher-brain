/**
 * js-r5-bound — R5's BOUND FOR THE JAVASCRIPT LANE, read off the lane's own cause census.
 *
 * R5 (charter §21.41): "A RECEIVER-TYPING EVIDENCE CLASS IS BOUNDED BY THE DECLARED-POPULATION
 * SHARE; THE UNDECLARED SHARE IS A VOCABULARY PROBLEM." MEASURED (dart lane, proxicall's 16,395
 * unresolved `uses` rows): W1 the file binds it 2,316 (14.1%) · W2 the PROJECT declares it 155
 * (0.9%) · W3 the project declares it NOWHERE 13,924 (84.9%). "So a receiver-typing evidence class
 * could move at most 155 rows, not 16,395 — for the other 84.9% there is no declaration for ANY
 * evidence class to point at." The charter names typescript, javascript, cpp and dart as the lanes
 * measuring the same bound on their own populations. THIS IS THE JAVASCRIPT HALF.
 *
 * WHY IT READS THE CENSUS INSTEAD OF RE-PARSING THE CORPUS. The lane's own census
 * (`script/m14/js-resolution-classify.ts`) ALREADY classifies every non-resolved edge into exactly
 * these three classes, and it does so from the ANALYZER'S OWN OUTPUT plus the PROJECT'S OWN KEY
 * SPACE — never from a name's spelling (the census's own header records the first version's
 * mistake: "a name's shape says nothing about what kind of thing it is"). So the bound is a READ of
 * the census, not a second parse of the corpus: one census, two questions answered from it.
 *
 * THE THREE CLASSES, as the census names them:
 *   W1 · THE FILE BINDS THE NAME      → BINDING-LOCAL · BINDING-LOCAL-CALL-RECEIVER · BINDING-REQUIRE
 *   W2 · THE PROJECT DECLARES IT      → MEMBER-DECLARED-ELSEWHERE (receiver untyped)
 *                                       SEGMENT-MEMBER-DECLARED (receiver untyped)
 *                                       REFS-MEMBER-ELSEWHERE · DECORATES-MEMBER-ELSEWHERE
 *   W3 · THE PROJECT DECLARES IT NOWHERE → NOTHING-ANYWHERE · SEGMENT-NOTHING-ANYWHERE
 *                                       UNKNOWN-RECEIVER-ROOT · PROJECT-SYMBOL-RECEIVER · …
 *
 * AND THE ROWS THAT ARE NOT WALLS AT ALL, because an evidence class ALREADY BOUND THEM (the
 * owner-qualification buckets): TYPED-RECEIVER-MEMBER-DECLARED · THIS-RECEIVER-MEMBER-DECLARED ·
 * STATIC-CLASS-RECEIVER-MEMBER-DECLARED. Those are the RESOLVED share, and they are reported
 * separately, never folded into W2.
 *
 * USAGE
 *   bun run script/m14/js-r5-bound.ts [census.json]
 * The census's OWN header (its command, its corpus root, its population) is printed with the bound,
 * so no number here can be read without the population it was measured on.
 */
import { readFileSync } from "node:fs"

const path = process.argv[2] ?? ".tmp-js/classify-cap0.json"
const census = JSON.parse(readFileSync(path, "utf8")) as any

/** wall name → the census buckets that compose it. */
const WALLS: { wall: string; buckets: string[] }[] = [
  {
    wall: "untyped receivers (local · parameter · call-rooted · catch)",
    buckets: [
      "UNTYPED-LOCAL-RECEIVER (declared wall: no stated type)",
      "UNTYPED-PARAMETER-RECEIVER (declared wall: no stated type)",
      "CALL-ROOTED-RECEIVER (receiver is a call result; declared wall)",
      "CATCH-PARAM-RECEIVER (declared wall: no stated type)",
    ],
  },
  {
    wall: "field segments (`x.body`; the segment name is declared nowhere)",
    buckets: [
      "SEGMENT-NOTHING-ANYWHERE",
      "SEGMENT-MEMBER-DECLARED (receiver untyped)",
      "SEGMENT-HOST-NAME",
    ],
  },
  {
    wall: "typed receiver, member declared nowhere",
    buckets: [
      "TYPED-RECEIVER-MEMBER-UNDECLARED",
      "TYPED-RECEIVER-MEMBER-AMBIGUOUS-OWNER",
    ],
  },
  {
    wall: "dynamic `this` (this in a plain function; no stated type)",
    buckets: ["DYNAMIC-THIS-RECEIVER (declared wall: no stated type)"],
  },
  {
    wall: "unknown receiver root (out-of-corpus API)",
    buckets: [
      "UNKNOWN-RECEIVER-ROOT (out-of-corpus API)",
      "PROJECT-SYMBOL-RECEIVER (member not a declaration)",
    ],
  },
]

const W1 = new Set([
  "BINDING-LOCAL",
  "BINDING-LOCAL-CALL-RECEIVER",
  "BINDING-REQUIRE",
  "NEW-LOCAL-BINDING",
  "REFS-LOCAL-BINDING",
  "EXTENDS-LOCAL-BINDING",
  "RENDERS-LOCAL-BINDING",
  "DECORATES-LOCAL-BINDING",
])
const W2 = new Set([
  "MEMBER-DECLARED-ELSEWHERE (receiver untyped)",
  "SEGMENT-MEMBER-DECLARED (receiver untyped)",
  "REFS-MEMBER-ELSEWHERE",
  "DECORATES-MEMBER-ELSEWHERE",
  // The member IS declared, but by TWO OR MORE owners — a declaration EXISTS and the site does not
  // say which. That is W2 (there is something for an owner-qualification instrument to point at),
  // not W3, and the difference is the whole bound: a member index settles an ambiguous owner and
  // settles nothing at all about a member nobody declares.
  "TYPED-RECEIVER-MEMBER-AMBIGUOUS-OWNER",
])
/** the rows an evidence class ALREADY bound — the RESOLVED share, reported apart from W2. */
const RESOLVED = new Set([
  "TYPED-RECEIVER-MEMBER-DECLARED (owner qualification)",
  "THIS-RECEIVER-MEMBER-DECLARED (owner qualification)",
  "STATIC-CLASS-RECEIVER-MEMBER-DECLARED (owner qualification)",
])

/** every bucket name → count, across every label. THE TWO DECLARATION CLASSES ARE SUMMED, because a
 *  wall is not a class: the census publishes the UNRESOLVED class in `buckets` and the AMBIGUOUS
 *  class in `ambiguousBuckets` (the same rows the name model could not settle, which is why a wall
 *  is "ambiguous + unresolved"), and the D7 wall table is the SUM of the two. */
const counts = new Map<string, number>()
const perLabel = new Map<string, Map<string, number>>()
for (const key of ["buckets", "ambiguousBuckets"]) {
  for (const [label, list] of Object.entries(census[key] ?? {}) as [string, [string, number][]][]) {
    const m = perLabel.get(label) ?? new Map<string, number>()
    for (const [name, n] of list) {
      m.set(name, (m.get(name) ?? 0) + n)
      counts.set(name, (counts.get(name) ?? 0) + n)
    }
    perLabel.set(label, m)
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)

console.log("JAVASCRIPT — R5's BOUND (charter §21.41 R5), read off the lane's own cause census")
console.log(`  census file      : ${path}`)
console.log(`  census command   : ${census.command ?? "(none recorded)"}`)
console.log(`  census root      : ${census.corpusRoot ?? "(none recorded)"}`)
console.log(`  census population: ${JSON.stringify(census.population ?? {})}`)
console.log("")
console.log("  THE RULE: a receiver-typing evidence class can move at most the W2 share — the rows")
console.log("  whose name the PROJECT DECLARES. For the W3 share there is no declaration for any")
console.log("  evidence class to point at, so it is a VOCABULARY problem, not a typing gap.")
console.log("")

for (const w of WALLS) {
  const w1 = w.buckets.filter((b) => W1.has(b)).reduce((a, b) => a + (counts.get(b) ?? 0), 0)
  const w2 = w.buckets.filter((b) => W2.has(b)).reduce((a, b) => a + (counts.get(b) ?? 0), 0)
  const res = w.buckets.filter((b) => RESOLVED.has(b)).reduce((a, b) => a + (counts.get(b) ?? 0), 0)
  const total = w.buckets.reduce((a, b) => a + (counts.get(b) ?? 0), 0)
  const w3 = total - w1 - w2 - res
  console.log(`  ${w.wall}`)
  console.log(`    total                       ${String(total).padStart(8)}`)
  console.log(`    W1 · the file binds it      ${String(w1).padStart(8)}  ${pct(w1, total)}`)
  console.log(`    W2 · the project declares it${String(w2).padStart(8)}  ${pct(w2, total)}   ← the CEILING for a receiver-typing evidence class`)
  console.log(`    W3 · declared NOWHERE       ${String(w3).padStart(8)}  ${pct(w3, total)}   ← a vocabulary problem`)
  console.log(`    (already bound by an evidence class — the RESOLVED share: ${res})`)
  for (const b of w.buckets) {
    const n = counts.get(b) ?? 0
    if (n === 0) continue
    const cls = W1.has(b) ? "W1" : W2.has(b) ? "W2" : RESOLVED.has(b) ? "RESOLVED" : "W3"
    console.log(`      ${String(n).padStart(8)}  [${cls.padEnd(8)}] ${b}`)
  }
  console.log("")
}

console.log("  EVERY BUCKET IN THE CENSUS, BY LABEL (the wall composition, for the D7 dispositions)")
for (const [label, m] of perLabel) {
  const total = [...m.values()].reduce((a, b) => a + b, 0)
  console.log(`  ${label} — ${total} non-resolved row(s)`)
  for (const [name, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
    const cls = W1.has(name) ? "W1" : W2.has(name) ? "W2" : RESOLVED.has(name) ? "RESOLVED" : "W3"
    console.log(`      ${String(n).padStart(8)}  [${cls.padEnd(8)}] ${name}`)
  }
}
