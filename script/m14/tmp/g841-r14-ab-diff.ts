// #841 round 14 A/B diff: baseline dump vs recovery dump, set-wise.
// A "loss" is any symbol or relationship key present in the baseline and
// absent after the change — the primary gate (must be zero on the diff).
// Gains are expected exactly where the recovery reconstructs class ownership.
import { readFileSync } from "node:fs"

const BASE = "/tmp/g841-r14-base.json"
const AFTER = "/tmp/g841-r14-after.json"

type Dump = Record<string, { symbols: string[]; rels: string[] }>
const base: Dump = JSON.parse(readFileSync(BASE, "utf8"))
const after: Dump = JSON.parse(readFileSync(AFTER, "utf8"))

const keys = new Set([...Object.keys(base), ...Object.keys(after)])
let aggLossS = 0, aggGainS = 0, aggLossR = 0, aggGainR = 0
let lossFiles = 0, gainFiles = 0
const lossSamples: string[] = []
const gainSamples: string[] = []

for (const k of [...keys].sort()) {
  const b = base[k] ?? { symbols: [], rels: [] }
  const a = after[k] ?? { symbols: [], rels: [] }
  if (!base[k]) {
    console.log(`WHOLE-FILE-ONLY-IN-AFTER ${k}`)
    continue
  }
  if (!after[k]) {
    console.log(`WHOLE-FILE-ONLY-IN-BASE  ${k}`)
    lossFiles++
    continue
  }
  const bS = new Set(b.symbols), aS = new Set(a.symbols)
  const bR = new Set(b.rels), aR = new Set(a.rels)
  const lostS = [...bS].filter((x) => !aS.has(x))
  const lostR = [...bR].filter((x) => !aR.has(x))
  const gainS = [...aS].filter((x) => !bS.has(x))
  const gainR = [...aR].filter((x) => !bR.has(x))
  if (lostS.length || lostR.length) {
    lossFiles++
    aggLossS += lostS.length
    aggLossR += lostR.length
    for (const s of lostS.slice(0, 3)) if (lossSamples.length < 25) lossSamples.push(`${k}  S  ${s}`)
    for (const r of lostR.slice(0, 3)) if (lossSamples.length < 25) lossSamples.push(`${k}  R  ${r}`)
  }
  if (gainS.length || gainR.length) {
    gainFiles++
    aggGainS += gainS.length
    aggGainR += gainR.length
    // Recovered-ownership gains (class symbols, contains edges, no-owner ->
    // owner method moves) are the intent; everything else is surfaced.
    for (const s of gainS) {
      const expected = /\|class\|/.test(s) || /\|constructor\|/.test(s)
      if (!expected && gainSamples.length < 30) gainSamples.push(`${k}  S  ${s}`)
    }
    for (const r of gainR) {
      const expected = /^R\|contains\|/.test(r)
      if (!expected && gainSamples.length < 30) gainSamples.push(`${k}  R  ${r}`)
    }
  }
}

console.log("")
console.log(`files: base=${Object.keys(base).length} after=${Object.keys(after).length}`)
console.log(`LOSSES: files=${lossFiles} symbols=${aggLossS} rels=${aggLossR}   <- must be 0`)
console.log(`GAINS:  files=${gainFiles} symbols=${aggGainS} rels=${aggGainR}`)
if (lossSamples.length) {
  console.log("\n--- loss samples (up to 25) ---")
  for (const l of lossSamples) console.log(l)
}
if (gainSamples.length) {
  console.log("\n--- gain samples (up to 25, excluding recovered ownership) ---")
  for (const l of gainSamples) console.log(l)
}
