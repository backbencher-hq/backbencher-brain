/**
 * Read a V8 `.cpuprofile` and print a SELF-TIME ranking.
 *
 * The sampling profiler's node tree gives each function a `hitCount`; self time
 * is a node's own hitCount divided by its total, and the useful question is
 * "which function is on the stack when the samples land", not "which function
 * calls it" — a caller can be cheap while everything beneath it is expensive.
 * So this prints SELF time, with the caller's name for orientation, and it
 * attributes a sample to the DEEPEST analyzer frame in the stack so a cost
 * inside `findChild` called from `descriptionOf` is reported against the frame
 * that decides to call it.
 *
 *   node probe/read-profile.mts <file.cpuprofile> [frameFilter]
 */
import * as fs from "fs"

const file = process.argv[2]
const frameFilter = process.argv[3] ?? "real-graphql-analyzer"
const prof = JSON.parse(fs.readFileSync(file, "utf8"))

const byId = new Map<number, any>()
for (const n of prof.nodes) byId.set(n.id, n)

/** Walk up to find the nearest frame matching `frameFilter`, else the deepest. */
function attribute(stack: string[], filter: string): string {
  const names = stack.map((id) => byId.get(id)?.callFrame?.functionName ?? "(anonymous)")
  for (let i = names.length - 1; i >= 0; i--) {
    const n = names[i]
    if (n.includes(filter)) return `${n}  <- called by ${names[i - 1] ?? "(top)"}`
  }
  return `${names[names.length - 1]}  <- called by ${names[names.length - 2] ?? "(top)"}`
}

const self = new Map<string, number>()
const total = new Map<string, number>()
let samples = 0

for (const n of prof.nodes) {
  const hits = n.hitCount ?? 0
  if (!hits) continue
  samples += hits
  // the stack of this node, root-first, is the parent chain
  const stack: string[] = []
  let cur: any = n
  const guard = new Set<number>()
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id)
    stack.push(cur.id)
    cur = cur.parent ? byId.get(cur.parent) : null
  }
  stack.reverse()
  const key = attribute(stack, frameFilter)
  self.set(key, (self.get(key) ?? 0) + hits)
  // inclusive: every frame on the stack gets the hit
  for (const id of stack) {
    const cf = byId.get(id)?.callFrame
    const k = cf?.functionName ?? "(anonymous)"
    total.set(k, (total.get(k) ?? 0) + hits)
  }
}

const pct = (n: number) => `${((n / samples) * 100).toFixed(2)}%`
console.log(`=== SELF TIME, ${samples} samples, profile ${file} ===`)
const rows = [...self.entries()].sort((a, b) => b[1] - a[1])
for (const [k, n] of rows.slice(0, 30)) {
  console.log(`  ${pct(n).padStart(7)}  ${String(n).padStart(6)}  ${k}`)
}
console.log(`\n=== INCLUSIVE TIME (top 20) ===`)
for (const [k, n] of [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${pct(n).padStart(7)}  ${String(n).padStart(6)}  ${k}`)
}
