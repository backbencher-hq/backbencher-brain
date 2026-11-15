// #918 A/B classification: every symbol and every (label,target) PAIR the
// pointer-heading recovery changed, sorted into recovered / role-change /
// re-attribution / REAL-LOSS. The lane compares pairs source-agnostically, so
// the pair diff is the lane-relevant one; the symbol diff answers "did we lose
// a name".
//   bun script/m14/tmp/c918-abdiff.ts <corpus> <repoDir>
import { readFileSync } from "node:fs"
import path from "node:path"

const corpus = process.argv[2]
const repoDir = process.argv[3]
const pre = JSON.parse(readFileSync(`/tmp/c918-ab-pre-${corpus}.json`, "utf8"))
const post = JSON.parse(readFileSync(`/tmp/c918-ab-post-${corpus}.json`, "utf8"))

const pairOf = (r: string): string => {
  const m = r.match(/^\d+:([^:]+):(.*?)#/)
  if (!m) return r
  const rest = m[2]
  const arrow = rest.lastIndexOf("->")
  return `${m[1]}|${arrow >= 0 ? rest.slice(arrow + 2) : rest}`
}
const srcOf = (r: string): string => {
  const m = r.match(/^\d+:[^:]+:(.*?)#/)
  if (!m) return "?"
  const arrow = m[1].lastIndexOf("->")
  return arrow >= 0 ? m[1].slice(0, arrow) : m[1]
}
const lineOf = (r: string): number => parseInt(r.match(/^(\d+):/)?.[1] ?? "0", 10)

let filesChanged = 0
let symAdded = 0
let symRemoved = 0
const symRemovedRows: string[] = []
const symAddedRows: string[] = []
let pairsAdded = 0
let pairsRemoved = 0
const pairAddedRows: string[] = []
const pairRemovedRows: string[] = []
let realLoss = 0
const realLossRows: string[] = []
let reAttributed = 0
const recoveredNames = new Set<string>()

for (const rel of Object.keys(pre)) {
  const a = pre[rel]
  const b = post[rel]
  if (!a || !b || a.error || b.error) continue
  const symA = new Set<string>(a.symbols)
  const symB = new Set<string>(b.symbols)
  const removedSyms: string[] = (a.symbols as string[]).filter((s) => !symB.has(s))
  const addedSyms: string[] = (b.symbols as string[]).filter((s) => !symA.has(s))
  const relA: string[] = a.rels
  const relB: string[] = b.rels
  const setA = new Set(relA)
  const setB = new Set(relB)
  const removedRels = relA.filter((r) => !setB.has(r))
  const addedRels = relB.filter((r) => !setA.has(r))
  if (!removedSyms.length && !addedSyms.length && !removedRels.length && !addedRels.length) continue
  filesChanged++
  for (const s of addedSyms) if (s.includes(":function:")) recoveredNames.add(s.split(":")[2]?.split("@")[0] ?? "")
  symAdded += addedSyms.length
  symRemoved += removedSyms.length
  for (const s of removedSyms.slice(0, 30)) symRemovedRows.push(`${rel} -${s}`)
  for (const s of addedSyms.slice(0, 30)) symAddedRows.push(`${rel} +${s}`)
  // pair-level
  const pairsA = new Map<string, string[]>()
  for (const r of relA) {
    const k = pairOf(r)
    pairsA.set(k, [...(pairsA.get(k) ?? []), r])
  }
  const pairsB = new Map<string, string[]>()
  for (const r of relB) {
    const k = pairOf(r)
    pairsB.set(k, [...(pairsB.get(k) ?? []), r])
  }
  for (const k of pairsA.keys()) {
    if (pairsB.has(k)) {
      // same pair survives; did the SOURCE change (re-attribution)?
      const before = pairsA.get(k)!.map(srcOf).sort().join(",")
      const after = pairsB.get(k)!.map(srcOf).sort().join(",")
      if (before !== after) reAttributed++
      continue
    }
    pairsRemoved++
    const target = k.split("|")[1]
    const isName = recoveredNames.has(target)
    pairRemovedRows.push(`${rel} -${k}${isName ? "  [HEADING-NAME-OR-RECOVERED-NAME]" : ""} sources=${pairsA.get(k)!.map(srcOf).join(",")}`)
    if (!isName) {
      realLoss++
      realLossRows.push(`${rel} -${k} sources=${pairsA.get(k)!.map(srcOf).join(",")}`)
    }
  }
  for (const k of pairsB.keys()) {
    if (pairsA.has(k)) continue
    pairsAdded++
    pairAddedRows.push(`${rel} +${k} sources=${pairsB.get(k)!.map(srcOf).join(",")}`)
  }
}

console.log(`== ${corpus}: files changed=${filesChanged}`)
console.log(`symbols: +${symAdded} -${symRemoved}`)
console.log(`pairs:   +${pairsAdded} -${pairsRemoved}   re-attributions(same pair, new source)=${reAttributed}`)
console.log(`pairs removed whose target is NOT a recovered name (candidate REAL LOSS)=${realLoss}`)
console.log(`\n-- symbols added (first 25) --`)
for (const s of symAddedRows.slice(0, 25)) console.log(`   ${s}`)
console.log(`\n-- symbols removed (first 25) --`)
for (const s of symRemovedRows.slice(0, 25)) console.log(`   ${s}`)
console.log(`\n-- pairs added (first 30) --`)
for (const s of pairAddedRows.slice(0, 30)) console.log(`   ${s}`)
console.log(`\n-- pairs removed (first 40) --`)
for (const s of pairRemovedRows.slice(0, 40)) console.log(`   ${s}`)
