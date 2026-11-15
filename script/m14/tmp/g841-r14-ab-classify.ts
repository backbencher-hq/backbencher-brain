// #841 round 14 A/B classifier: separates EXPECTED re-parenting moves from
// genuine losses. A moved symbol keeps name+kind+line and only changes owner;
// a moved relationship keeps type/line and changes source or target only.
// Anything that cannot be explained as a move is a genuine loss and is dumped.
import { readFileSync } from "node:fs"

const base: Record<string, { symbols: string[]; rels: string[] }> = JSON.parse(readFileSync("/tmp/g841-r14-base.json", "utf8"))
const after: Record<string, { symbols: string[]; rels: string[] }> = JSON.parse(readFileSync("/tmp/g841-r14-after.json", "utf8"))

function parseS(k: string) { const p = k.split("|"); return { name: p[1], kind: p[2], owner: p[3], line: p[4] } }
function parseR(k: string) { const p = k.split("|"); return { type: p[1], source: p[2], target: p[3], line: p[4] } }

let movedS = 0, movedR = 0, lostS = 0, lostR = 0
let filesWithGenuineLoss = 0
const genuine: string[] = []

for (const k of Object.keys(base).sort()) {
  if (!after[k]) { genuine.push(`WHOLE FILE MISSING AFTER: ${k}`); filesWithGenuineLoss++; continue }
  const bS = base[k].symbols, aS = new Set(after[k].symbols)
  const bR = base[k].rels, aR = new Set(after[k].rels)
  let fileGenuine = 0

  for (const s of bS) {
    if (aS.has(s)) continue
    const p = parseS(s)
    const moved = after[k].symbols.some((x) => { const q = parseS(x); return q.name === p.name && q.kind === p.kind && q.line === p.line })
    if (moved) movedS++
    else { lostS++; fileGenuine++; if (genuine.length < 60) genuine.push(`${k}\n    S LOST  ${s}`) }
  }
  for (const r of bR) {
    if (aR.has(r)) continue
    const p = parseR(r)
    const moved = after[k].rels.some((x) => { const q = parseR(x); return q.type === p.type && q.line === p.line && (q.target === p.target || q.source === p.source) })
    if (moved) movedR++
    else { lostR++; fileGenuine++; if (genuine.length < 60) genuine.push(`${k}\n    R LOST  ${r}`) }
  }
  if (fileGenuine > 0) filesWithGenuineLoss++
}

console.log(`MOVED (expected re-parentings): symbols=${movedS} rels=${movedR}`)
console.log(`GENUINE LOSSES: files=${filesWithGenuineLoss} symbols=${lostS} rels=${lostR}   <- must be 0`)
if (genuine.length) {
  console.log("\n--- genuine-loss samples ---")
  for (const g of genuine) console.log(g)
}
