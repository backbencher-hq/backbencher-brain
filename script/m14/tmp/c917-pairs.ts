// #917: the F5 lane compares (label,target) pairs, source-agnostically. What
// pairs did the recovery ADD and REMOVE?
import { readFileSync } from "node:fs"

const corpus = process.argv[2] ?? "sqlite"
const pre = JSON.parse(readFileSync(`/tmp/c917-ab-pre-${corpus}.json`, "utf8"))
const post = JSON.parse(readFileSync(`/tmp/c917-ab-post-${corpus}.json`, "utf8"))

const pairsOf = (rows: string[]) => {
  const set = new Set<string>()
  for (const r of rows) {
    // "<line>:<type>:<source>-><target>#<meta>"
    const m = r.match(/^\d+:([^:]+):(.*?)#/)
    if (!m) continue
    const type = m[1]
    const rest = m[2]
    const arrow = rest.lastIndexOf("->")
    const target = arrow >= 0 ? rest.slice(arrow + 2) : rest
    set.add(`${type}|${target}`)
  }
  return set
}

let addedTotal = 0
let removedTotal = 0
const addedSample: string[] = []
const removedSample: string[] = []
for (const rel of Object.keys(pre)) {
  const a = pre[rel], b = post[rel]
  if (!a || !b || a.error || b.error) continue
  const pa = pairsOf(a.rels), pb = pairsOf(b.rels)
  const added = [...pb].filter((p) => !pa.has(p))
  const removed = [...pa].filter((p) => !pb.has(p))
  if (!added.length && !removed.length) continue
  addedTotal += added.length
  removedTotal += removed.length
  for (const p of added.slice(0, 12)) addedSample.push(`${rel}  +${p}`)
  for (const p of removed.slice(0, 12)) removedSample.push(`${rel}  -${p}`)
}
console.log(`== ${corpus}: (label,target) pairs added=${addedTotal} removed=${removedTotal}`)
console.log(`added pairs:`)
for (const s of addedSample.slice(0, 30)) console.log(`   ${s}`)
console.log(`removed pairs:`)
for (const s of removedSample.slice(0, 30)) console.log(`   ${s}`)
