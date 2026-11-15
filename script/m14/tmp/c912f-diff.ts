// #912 A/B classifier against the FINAL analyzer bytes.
// Usage: bun script/m14/tmp/c912f-diff.ts <corpus>
import { readFileSync } from "node:fs"

const corpus = process.argv[2]
const pre = JSON.parse(readFileSync(`/tmp/c912f-pre-${corpus}.json`, "utf8"))
const post = JSON.parse(readFileSync(`/tmp/c912f-post-${corpus}.json`, "utf8"))

let filesChanged = 0
const addedSym: string[] = []
const removedSym: string[] = []
const addedRel: string[] = []
const removedRel: string[] = []
const rows: string[] = []

for (const rel of Object.keys(pre).sort()) {
  const a = pre[rel]
  const b = post[rel]
  if (!a || !b || a.error || b.error) {
    if (a?.error || b?.error) rows.push(`  ERROR-SKEW ${rel}: pre=${a?.error ?? "-"} post=${b?.error ?? "-"}`)
    continue
  }
  const sa = new Set<string>(a.symbols)
  const sb = new Set<string>(b.symbols)
  const ra = new Set<string>(a.rels)
  const rb = new Set<string>(b.rels)
  const as = b.symbols.filter((s: string) => !sa.has(s))
  const rs = a.symbols.filter((s: string) => !sb.has(s))
  const ar = b.rels.filter((r: string) => !ra.has(r))
  const rr = a.rels.filter((r: string) => !rb.has(r))
  if (!as.length && !rs.length && !ar.length && !rr.length) continue
  filesChanged++
  rows.push(`  ${rel}  +${as.length}sym -${rs.length}sym +${ar.length}rel -${rr.length}rel`)
  for (const s of as) addedSym.push(`${rel}|${s}`)
  for (const s of rs) removedSym.push(`${rel}|${s}`)
  for (const r of ar) addedRel.push(`${rel}|${r}`)
  for (const r of rr) removedRel.push(`${rel}|${r}`)
}

const totals = (o: Record<string, any>) => ({
  files: Object.keys(o).length,
  symbols: Object.values(o).reduce((n: number, v: any) => n + (v.symbols?.length ?? 0), 0),
  rels: Object.values(o).reduce((n: number, v: any) => n + (v.rels?.length ?? 0), 0),
})
console.log(`=== ${corpus}: pre ${JSON.stringify(totals(pre))} -> post ${JSON.stringify(totals(post))}`)
console.log(`files changed: ${filesChanged}`)
for (const r of rows) console.log(r)
console.log(`symbols added (${addedSym.length}):`)
for (const s of addedSym) console.log(`  + ${s}`)
console.log(`symbols removed (${removedSym.length}):`)
for (const s of removedSym) console.log(`  - ${s}`)
console.log(`relationships added (${addedRel.length}):`)
for (const s of addedRel) console.log(`  + ${s}`)
console.log(`relationships removed (${removedRel.length}):`)
for (const s of removedRel) console.log(`  - ${s}`)
