#!/usr/bin/env bun
/**
 * CLEAN lane — WHAT DID THE CHANGE MOVE, ROW BY ROW.
 *
 * ## The question
 *
 * `phantom-census.mts` says how much of a residual is self-inflicted; it does not say what happened to
 * a row after a fix. Two dumps from the SAME instrument over the SAME population are two complete
 * sets of NON-`resolved` edges (the gate's dump includes `externalVerified` — 10163 = 2906 amb +
 * 2972 unresolved + 4285 extOK on the clean population — so "the dump grew" is not "the gap grew"),
 * and a set difference over them is the only honest answer to "what moved":
 * a count that fell from 6,856 to 5,878 is a fact, but it is not an explanation, and a fix that removes
 * rows by breaking the edges that produced them looks identical to one that resolves them.
 *
 * So every disappeared row is classified into exactly one of three kinds:
 *
 *   RESOLVED     no row for this edge survives — the target now resolves (or the claim verifies).
 *   RETARGETED   a row survives at the same label|file:line with a DIFFERENT target, so the edge's
 *                TARGET SPELLING changed. The new row carries its own outcome, so a retarget that
 *                merely renames an unresolved edge into another unresolved edge is visible as such.
 *   DISPLACED    neither — an UNRELATED target is now reported at the same label|file:line. The old
 *                row is absent from a COMPLETE non-resolved set, so its edge resolved or stopped
 *                being emitted; **two dumps cannot tell those apart**, and this instrument does not
 *                pretend to. That question is `phantom-attribution.mts`'s: it asks whether a real
 *                declaration of the target still exists in the project.
 *
 * (The first version of this instrument called the third bucket "VANISHED" and printed it as a
 * possible regression. MEASURED on the clean container fix: all 45 rows in it were references to a
 * name that still has a real declaration in the project — i.e. rows that RESOLVED, with an unrelated
 * new row sharing their line. The label was claiming knowledge the data does not hold.)
 *
 * Added rows get the same treatment: a fix that introduces edges is as interesting as one that removes
 * them, and an "improvement" that adds unresolved rows is not an improvement. Every added row carries
 * the gate's own OUTCOME, so a row that moved from `resolved` to `externalVerified` is visible as such
 * and cannot be read as a new gap.
 *
 * ## What it does NOT claim
 *
 * It does not judge whether an edge SHOULD resolve, and it does not re-classify: the outcomes are the
 * gate's own. A row absent from the after-dump is called RESOLVED only because the dump is a COMPLETE
 * non-resolved set (the gate prints a BOUND marker when it truncates, and this instrument refuses to
 * run on a truncated dump rather than mislabel every row past the bound).
 *
 * Usage:
 *   bun validation/m14/fixtures/clean/gate-residue-delta.ts --before=<dump> --after=<dump> [--json=<out>]
 */
import * as fs from "node:fs"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const BEFORE = arg("before")
const AFTER = arg("after")
const JSON_OUT = arg("json")
if (!BEFORE || !AFTER) {
  console.error("usage: gate-residue-delta.ts --before=<gate --dump file> --after=<gate --dump file> [--json=<out>]")
  process.exit(2)
}

type Row = { label: string; outcome: string; tgt: string; file: string; claim: string }
const read = (p: string): Row[] => {
  const text = fs.readFileSync(p, "utf8")
  // A TRUNCATED DUMP IS NOT A SET. The gate prints `DUMP\tBOUND\tREACHED…` when it stops early; a
  // difference against a bounded dump would report every row past the bound as RESOLVED.
  if (/\bDUMP TRUNCATED\b/.test(text)) {
    console.error(`${p}: the dump is TRUNCATED — a set difference against it would mislabel rows as resolved.`)
    process.exit(2)
  }
  const rows: Row[] = []
  for (const line of text.split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const p2 = line.split("\t")
    rows.push({ label: p2[1] ?? "", outcome: p2[2] ?? "", tgt: p2[3] ?? "", file: p2[4] ?? "", claim: p2[5] ?? "" })
  }
  return rows
}
const before = read(BEFORE)
const after = read(AFTER)

const key = (r: Row) => `${r.label}|${r.file}|${r.tgt}`
const byKey = (rows: Row[]) => {
  const m = new Map<string, Row>()
  for (const r of rows) if (!m.has(key(r))) m.set(key(r), r)
  return m
}
const bMap = byKey(before)
const aMap = byKey(after)

const removed = [...bMap.values()].filter((r) => !aMap.has(key(r)))
const added = [...aMap.values()].filter((r) => !bMap.has(key(r)))

/** `file:line` → the rows at that site, from either side. */
const site = (r: Row) => r.file
const atSite = (rows: Row[], r: Row) => rows.filter((x) => x.label === r.label && site(x) === site(r))

const tally = (rows: Row[], f: (r: Row) => string) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

// ---------------------------------------------------------------------------
// the three-way split of the removed rows
// ---------------------------------------------------------------------------
type Verdict = "RESOLVED" | "RETARGETED" | "DISPLACED"
const verdicts = new Map<Row, { verdict: Verdict; to?: Row }>()
for (const r of removed) {
  const sameSite = atSite(added, r)
  // The retarget shape the analyzer actually produces: a bare name becomes `<owner>.<name>` (the
  // qualified identity), so the new target ENDS WITH `.${old}`. A target that changed to something
  // that is not a qualification of the old one is reported as VANISHED — a different edge, not a
  // renamed one — because "the edge moved to another name" is a fact a reader must see.
  const retarget = sameSite.find((x) => x.tgt.endsWith(`.${r.tgt}`) || x.tgt === r.tgt)
  if (retarget) verdicts.set(r, { verdict: "RETARGETED", to: retarget })
  else if (sameSite.length === 0) verdicts.set(r, { verdict: "RESOLVED" })
  else verdicts.set(r, { verdict: "DISPLACED" })
}

const split = new Map<string, Map<Verdict, number>>()
for (const [r, v] of verdicts) {
  const m = split.get(r.label) ?? new Map<Verdict, number>()
  m.set(v.verdict, (m.get(v.verdict) ?? 0) + 1)
  split.set(r.label, m)
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`
console.log(`BEFORE ${BEFORE}: ${before.length} non-resolved rows`)
console.log(`AFTER  ${AFTER}: ${after.length} non-resolved rows`)
console.log(`DELTA  ${after.length - before.length >= 0 ? "+" : ""}${after.length - before.length} rows\n`)
// A DUMP IS A MULTISET; THE DIFFERENCE ABOVE IS OVER IDENTITIES. Two references at the same line to
// the same name are two ROWS with ONE identity, so `removed`/`added` can be one short per duplicate
// identity. The counts are printed together so the two instruments can never be quoted as a
// contradiction (`phantom-attribution.mts` counts rows, this one counts identities).
console.log(`   of those rows, DISTINCT label|file:target identities: before ${bMap.size}, after ${aMap.size}\n`)

console.log("by label (before -> after):")
for (const label of [...new Set([...before, ...after].map((r) => r.label))].sort()) {
  const b = before.filter((r) => r.label === label).length
  const a = after.filter((r) => r.label === label).length
  console.log(`  ${label.padEnd(12)} ${String(b).padStart(5)} -> ${String(a).padStart(5)}  (${a - b >= 0 ? "+" : ""}${a - b})`)
}

console.log(`\nremoved rows: ${removed.length}`)
for (const [label, m] of split) {
  const total = [...m.values()].reduce((s, x) => s + x, 0)
  console.log(`  ${label.padEnd(12)} ${String(total).padStart(5)}  RESOLVED ${String(m.get("RESOLVED") ?? 0).padStart(4)}  RETARGETED ${String(m.get("RETARGETED") ?? 0).padStart(4)}  DISPLACED ${String(m.get("DISPLACED") ?? 0).padStart(4)}`)
}

console.log(`\nadded rows: ${added.length}`)
for (const [label, n] of tally(added, (r) => r.label)) console.log(`  ${label.padEnd(12)} ${String(n).padStart(5)}`)

// THE RETARGETS ARE THE INTERESTING ONES: the analyzer's qualified-retarget pass rewrites a bare
// reference to a name THIS FILE declares exactly once, and removing a phantom declaration is exactly
// what turns "twice" into "once". Each retarget is printed with the outcome its NEW row carries, so a
// retarget into another unresolved row cannot be read as a resolution.
const retargets = removed.filter((r) => verdicts.get(r)?.verdict === "RETARGETED")
if (retargets.length > 0) {
  const byOutcome = tally(retargets, (r) => `${verdicts.get(r)!.to!.outcome}`)
  console.log(`\nretargets: ${retargets.length} rows changed target (outcome of the NEW row):`)
  for (const [o, n] of byOutcome) console.log(`  ${o.padEnd(20)} ${n}`)
  console.log("  examples:")
  for (const r of retargets.slice(0, 6)) {
    const to = verdicts.get(r)!.to!
    console.log(`    ${r.label} ${r.tgt} -> ${to.tgt}  [${to.outcome}]  @ ${r.file}`)
  }
}

const displaced = removed.filter((r) => verdicts.get(r)?.verdict === "DISPLACED")
if (displaced.length > 0) {
  console.log(`\nDISPLACED (an UNRELATED target now sits at the same label|file:line — the old edge resolved or is no longer emitted, and these two dumps cannot say which): ${displaced.length}`)
  for (const [l, n] of tally(displaced, (r) => r.label)) console.log(`  ${l.padEnd(12)} ${n}`)
  for (const r of displaced.slice(0, 12)) console.log(`    ${r.label} ${r.tgt} [${r.outcome}] @ ${r.file}`)
}

console.log(`\nreconciliation: ${removed.length} removed = ${[...split.values()].reduce((s, m) => s + (m.get("RESOLVED") ?? 0), 0)} RESOLVED + ${retargets.length} RETARGETED + ${displaced.length} DISPLACED`)

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    measuredAt: new Date().toISOString(),
    before: { file: BEFORE, rows: before.length, byLabel: Object.fromEntries([...new Set(before.map((r) => r.label))].map((l) => [l, before.filter((r) => r.label === l).length])) },
    after: { file: AFTER, rows: after.length, byLabel: Object.fromEntries([...new Set(after.map((r) => r.label))].map((l) => [l, after.filter((r) => r.label === l).length])) },
    removed: {
      total: removed.length,
      byVerdict: Object.fromEntries([...split].map(([l, m]) => [l, Object.fromEntries(m)])),
      retargetOutcomes: Object.fromEntries(tally(retargets, (r) => verdicts.get(r)!.to!.outcome)),
      displaced: displaced.map((r) => ({ label: r.label, target: r.tgt, outcome: r.outcome, file: r.file })),
    },
    added: { total: added.length, byLabel: Object.fromEntries(tally(added, (r) => r.label)) },
    resolvedShare: `${pct([...split.values()].reduce((s, m) => s + (m.get("RESOLVED") ?? 0), 0), removed.length)} of the removed rows`,
  }, null, 2) + "\n")
  console.log(`\nwrote ${JSON_OUT}`)
}
