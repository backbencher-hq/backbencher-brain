#!/usr/bin/env tsx
/**
 * CLEAN lane — CAUSE C ADJUDICATION over the FULL 2,181-file identity dump.
 *
 * ## The question this answers
 *
 * `clean-cause-c.mts` ran on a 120-file slice and put 91.2% of unattached targets in
 * `UNPROVEN_EXTERNAL` — the honest but weak bucket meaning "nothing in this slice
 * declares it". A 120-file slice cannot distinguish stdlib from a local name declared in
 * a file the slice did not include. The full identity dump can.
 *
 * `validation/m14/measurements/clean/ambiguity-split-2181-abc.json` names its shard
 * directory: `/tmp/opencode/clean-abc/identity`, 16 shards, one JSON object per line:
 *
 *   { f: <relpath>, s: [[name, kind, owner, line, scope, visibility], ...],
 *     r: [[typeCode, source, target, line, side, bucket], ...] }
 *
 * So the population available without re-parsing is: 2,181 files, 62,980 declarations,
 * 29,196 distinct published names, 233,885 edges. Every count below is over that
 * population and says so.
 *
 * ## What counts as EXTERNAL, and what does not
 *
 * The distinction the round brief's cause C needs is not "looks like stdlib", it is:
 *
 *   RESOLVABLE      the target string, or its final segment after a `.`/`:` separator, is
 *                   a name the corpus PUBLISHES. The consumer had it in front of it. An
 *                   edge here that does not attach is a real miss and is fixable.
 *   MODULE_ONLY     the target is `Module:Item` or `Module.Item` where `Module` is a name
 *                   the corpus publishes and `Item` is not. The corpus declares the
 *                   module but not that item, so the item is outside what this index
 *                   knows. Counted separately from RESOLVABLE because the fix differs:
 *                   retargeting to the module alone would fabricate an edge.
 *   NOTHING         neither the target nor its final segment nor its module qualifier is
 *                   published anywhere in 2,181 files. This is the strongest externality
 *                   claim the corpus can support, and it is still a claim about THIS
 *                   corpus, not about the language.
 *
 * Nothing here decides whether a `NOTHING` target is stdlib, a builtin, or a name from a
 * dependency the corpus does not vendor. That is stated rather than guessed.
 *
 * ## Usage
 *
 *   npx tsx script/m14/clean-cause-c-full.mts [--in <shard-dir>] [--json <out>]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const IN = arg("in") ?? "/tmp/opencode/clean-abc/identity"
const JSON_OUT = arg("json")

const SPLIT = /[.:]/
const lastSeg = (t: string) => t.split(SPLIT).pop()!

function main() {
  const files = fs.readdirSync(IN).filter((f) => f.startsWith("identity-") && f.endsWith(".ndjson")).sort()
  if (!files.length) { console.error(`no identity-<shard>.ndjson under ${IN}`); process.exit(2) }

  /** every name the corpus publishes */
  const published = new Set<string>()
  /** name -> count of declarations */
  const declCount = new Map<string, number>()
  /** edge rows */
  const edges: { t: number; tgt: string; side: number; bucket: string }[] = []
  let fileRows = 0

  for (const f of files) {
    for (const line of fs.readFileSync(path.join(IN, f), "utf8").split("\n")) {
      if (!line.trim()) continue
      const o = JSON.parse(line)
      fileRows++
      for (const s of o.s ?? []) {
        const n = String(s[0])
        if (!n) continue
        published.add(n)
        declCount.set(n, (declCount.get(n) ?? 0) + 1)
      }
      for (const r of o.r ?? []) edges.push({ t: r[0], tgt: String(r[2]), side: r[4], bucket: String(r[5]) })
    }
  }

  console.log(`CAUSE C ADJUDICATION — full identity dump`)
  console.log(`shard dir:     ${IN}`)
  console.log(`shards:        ${files.length}`)
  console.log(`file rows:     ${fileRows}`)
  console.log(`declarations:  ${declCount.size} distinct names`)
  console.log(`edges:         ${edges.length}\n`)

  type B = "RESOLVABLE" | "MODULE_ONLY" | "NOTHING"
  const buckets: Record<B, { n: number; targets: Set<string>; bySide: Record<string, number> }> = {
    RESOLVABLE: { n: 0, targets: new Set(), bySide: {} },
    MODULE_ONLY: { n: 0, targets: new Set(), bySide: {} },
    NOTHING: { n: 0, targets: new Set(), bySide: {} },
  }
  const byTargetBucket = new Map<string, B>()
  for (const e of edges) {
    const t = e.tgt
    let b: B
    if (!t) b = "NOTHING"
    else if (published.has(t)) b = "RESOLVABLE"
    else if (published.has(lastSeg(t))) b = "RESOLVABLE"
    else if (SPLIT.test(t) && published.has(t.split(SPLIT)[0])) b = "MODULE_ONLY"
    else b = "NOTHING"
    const k = buckets[b]
    k.n++
    k.targets.add(t)
    k.bySide[e.side] = (k.bySide[e.side] ?? 0) + 1
    byTargetBucket.set(t, b)
  }

  const TOTAL = edges.length
  console.log(`TARGET RESOLVABILITY, of ${TOTAL} edges`)
  console.log(`bucket           edges    share   distinct   sides (1=source 2=target)`)
  console.log(`-`.repeat(88))
  for (const b of ["RESOLVABLE", "MODULE_ONLY", "NOTHING"] as B[]) {
    const k = buckets[b]
    console.log(`${b.padEnd(16)}${String(k.n).padStart(6)}${`${(100 * k.n / TOTAL).toFixed(1)}%`.padStart(10)}${String(k.targets.size).padStart(11)}   ${JSON.stringify(k.bySide)}`)
  }

  const r = buckets.RESOLVABLE
  console.log(`\nRESOLVABLE = ${r.n} edges (${(100 * r.n / TOTAL).toFixed(1)}%) whose target IS published in the corpus.`)
  console.log(`Of those, the store's bare-name pass attaches only a target with no '.' and no ':'`)
  console.log(`(src/ast/parallel-indexer.ts:4126-4153), so the rest are resolution-work, not misses.`)

  console.log(`\nTop 40 NOTHING targets by frequency`)
  const nothingFreq = new Map<string, number>()
  for (const e of edges) if (byTargetBucket.get(e.tgt) === "NOTHING") nothingFreq.set(e.tgt, (nothingFreq.get(e.tgt) ?? 0) + 1)
  const top = [...nothingFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
  for (const [t, n] of top) {
    const decls = declCount.get(t) ?? 0
    console.log(`  ${String(n).padStart(7)}  ${t.padEnd(28)} declarations with this exact name: ${decls}`)
  }
  const nothingDistinct = buckets.NOTHING.targets.size
  console.log(`\nNOTHING covers ${nothingDistinct} distinct target strings.`)

  const moduleTop = new Map<string, number>()
  for (const e of edges) if (byTargetBucket.get(e.tgt) === "MODULE_ONLY") moduleTop.set(e.tgt, (moduleTop.get(e.tgt) ?? 0) + 1)
  console.log(`\nTop 25 MODULE_ONLY targets (module published, item not)`)
  for (const [t, n] of [...moduleTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(n).padStart(7)}  ${t}`)
  }

  if (JSON_OUT) {
    const ser: Record<string, any> = {}
    for (const b of ["RESOLVABLE", "MODULE_ONLY", "NOTHING"] as B[]) {
      ser[b] = { edges: buckets[b].n, distinctTargets: buckets[b].targets.size, bySide: buckets[b].bySide,
        targets: [...buckets[b].targets].sort() }
    }
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      shardDir: IN, shards: files.length, fileRows, distinctNames: published.size, edges: TOTAL,
      byBucket: ser,
      nothingTop: top, moduleOnlyTop: [...moduleTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200),
    }, null, 2))
    console.log(`\nJSON written: ${JSON_OUT}`)
  }
}

main()