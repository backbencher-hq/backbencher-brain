// #743 grammar-wave A/B classification: every symbol and every (label,target) PAIR
// the candidate grammar changed in the analyzer's own output, sorted into
// added / re-attribution / REAL-LOSS. A grammar change must never lose a symbol or
// a relationship: a moved source is re-attribution, a vanished one is real loss.
//   bun script/m14/tmp/c743-abdiff.ts <c|cpp> <repo>
import { readFileSync } from "node:fs"
const kind = process.argv[2]
const repo = process.argv[3]
const pre = JSON.parse(readFileSync(`/tmp/c743ab-${kind}-pre-${repo}.json`, "utf8"))
const post = JSON.parse(readFileSync(`/tmp/c743ab-${kind}-post-${repo}.json`, "utf8"))

const pairOf = (r: string): string => {
  const m = r.match(/^\d+:([^:]+):(.*?)#/)
  if (!m) return r
  const arrow = m[2].lastIndexOf("->")
  return `${m[1]}|${arrow >= 0 ? m[2].slice(arrow + 2) : m[2]}`
}
const srcOf = (r: string): string => {
  const m = r.match(/^\d+:[^:]+:(.*?)#/)
  if (!m) return "?"
  const arrow = m[1].lastIndexOf("->")
  return arrow >= 0 ? m[1].slice(0, arrow) : m[1]
}
const lineOf = (r: string): number => parseInt(r.match(/^(\d+):/)?.[1] ?? "0", 10)

let filesChanged = 0
let symAdded = 0, symRemoved = 0
const symAddedRows: string[] = [], symRemovedRows: string[] = []
let pairsAdded = 0, pairsRemoved = 0
let reAttributed = 0, realLoss = 0
const realLossRows: string[] = []
const recovered: string[] = []
const qualifierChurn: string[] = []
const vanishedNames: string[] = []

for (const rel of Object.keys(pre)) {
  const a = pre[rel], b = post[rel]
  if (!a || !b || a.error || b.error) continue
  const symA = new Set<string>(a.symbols), symB = new Set<string>(b.symbols)
  const removedSyms: string[] = a.symbols.filter((s: string) => !symB.has(s))
  const addedSyms: string[] = b.symbols.filter((s: string) => !symA.has(s))
  const setA = new Set<string>(a.rels), setB = new Set<string>(b.rels)
  const removedRels: string[] = a.rels.filter((r: string) => !setB.has(r))
  const addedRels: string[] = b.rels.filter((r: string) => !setA.has(r))
  if (!removedSyms.length && !addedSyms.length && !removedRels.length && !addedRels.length) continue
  filesChanged++
  symAdded += addedSyms.length; symRemoved += removedSyms.length
  for (const s of addedSyms.slice(0, 6)) symAddedRows.push(`${rel}  +${s}`)
  for (const s of removedSyms.slice(0, 12)) symRemovedRows.push(`${rel}  -${s}`)
  for (const s of addedSyms) if (s.includes(":function:")) recovered.push(s.split(":")[2]?.split("@")[0] ?? s)
  pairsAdded += addedRels.length; pairsRemoved += removedRels.length
  // a removed pair whose (label,target) survives under a different source line is a
  // RE-ATTRIBUTION (the tree moved); one with no counterpart at all is REAL-LOSS.
  const addedKeys = new Set(addedRels.map(pairOf))
  for (const r of removedRels) {
    if (addedKeys.has(pairOf(r))) reAttributed++
    else { realLoss++; if (realLossRows.length < 25) realLossRows.push(`${rel}:${lineOf(r)} ${srcOf(r)}`) }
  }
}
// A removed symbol whose BASE NAME (kind:name, before any @qualifier) reappears in
// the added set is a QUALIFIER change (the tree moved it out of its namespace),
// not a lost name. Only base names that vanish entirely are vani... losses.
const baseOf = (s: string): string => {
  const m = s.match(/^(\d+:(?:function|class|method|variable|interface|enum):[^@]+)/)
  return m ? m[1] : s
}
for (const rel of Object.keys(pre)) {
  const a = pre[rel], b = post[rel]
  if (!a || !b || a.error || b.error) continue
  const symA = new Set<string>(a.symbols), symB = new Set<string>(b.symbols)
  const removed: string[] = a.symbols.filter((s: string) => !symB.has(s))
  const added: string[] = b.symbols.filter((s: string) => !symA.has(s))
  const addedBases = new Set(added.map(baseOf))
  for (const s of removed) {
    if (addedBases.has(baseOf(s))) qualifierChurn.push(`${rel}  ${s} -> ${added.find(x => baseOf(x) === baseOf(s))}`)
    else vanishedNames.push(`${rel}  ${s}`)
  }
}

console.log(`### ${kind}/${repo}`)
console.log(`files changed: ${filesChanged} | symbols +${symAdded} -${symRemoved} | pairs +${pairsAdded} -${pairsRemoved}`)
console.log(`pairs re-attributed: ${reAttributed} | REAL-LOSS: ${realLoss}`)
console.log(`symbols: qualifier-changed (name kept, owner moved): ${qualifierChurn.length} | vanished names: ${vanishedNames.length}`)
if (qualifierChurn.length) { console.log("qualifier changes (sample):"); for (const r of qualifierChurn.slice(0, 12)) console.log("   ", r) }
if (vanishedNames.length) { console.log("VANISHED names (sample):"); for (const r of vanishedNames.slice(0, 12)) console.log("   ", r) }
if (recovered.length) console.log(`recovered function symbols (first 12): ${[...new Set(recovered)].slice(0, 12).join(", ")}`)
if (symAddedRows.length) { console.log("symbols added (sample):"); for (const r of symAddedRows.slice(0, 15)) console.log("   ", r) }
if (symRemovedRows.length) { console.log("symbols REMOVED (sample):"); for (const r of symRemovedRows.slice(0, 15)) console.log("   ", r) }
if (realLossRows.length) { console.log("REAL-LOSS pairs (sample):"); for (const r of realLossRows) console.log("   ", r) }
