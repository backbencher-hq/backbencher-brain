// M49/M37 #866: diff the two corpus dumps (pre-fix tree vs working tree) set-
// wise, per language, and report ONLY what actually changed:
//   * REMOVED symbols / relations  -> must be zero for the sweep to be
//     "additions only"
//   * RE-ATTRIBUTED symbols        -> same name+kind+line, different owner
//     (a moved owner is not a loss, but it must be listed, not hidden)
//   * ADDED symbols / relations
//   * MOVED relation sources       -> same (type,target,line), different source
//
// Usage: bun script/m14/tmp/866-sweep-diff.ts --pre=/tmp/866-pre.json --post=/tmp/866-post.json
import { readFileSync } from "node:fs"

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d
const pre = JSON.parse(readFileSync(arg("pre", "/tmp/866-pre.json"), "utf8")) as Record<string, { symbols: string[]; rels: string[] }>
const post = JSON.parse(readFileSync(arg("post", "/tmp/866-post.json"), "utf8")) as Record<string, { symbols: string[]; rels: string[] }>

const count = (arr: string[]) => {
  const m = new Map<string, number>()
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1)
  return m
}

type Report = {
  lang: string
  filesPre: number
  filesPost: number
  filesChanged: number
  removedSymbols: string[]
  addedSymbols: string[]
  reattributedSymbols: string[]
  removedRels: string[]
  addedRels: string[]
  movedRelSources: string[]
}

const byLang = new Map<string, Report>()
const get = (lang: string) => {
  let r = byLang.get(lang)
  if (!r) {
    r = { lang, filesPre: 0, filesPost: 0, filesChanged: 0, removedSymbols: [], addedSymbols: [], reattributedSymbols: [], removedRels: [], addedRels: [], movedRelSources: [] }
    byLang.set(lang, r)
  }
  return r
}

// symbol line: S|name|kind|owner|line ; relation line: R|type|source|target|line
const symKey = (s: string) => s.split("|").slice(0, 3).join("|") + "|" + s.split("|")[4] // name|kind|line (owner dropped)

for (const file of Object.keys(pre)) {
  const lang = file.split("|")[0]
  const r = get(lang)
  r.filesPre++
  if (!post[file]) {
    r.removedSymbols.push(`FILE GONE: ${file}`)
    continue
  }
  r.filesPost++
  const a = pre[file]
  const b = post[file]

  // --- symbols ------------------------------------------------------------
  const aSym = count(a.symbols)
  const bSym = count(b.symbols)
  const removed: string[] = []
  const added: string[] = []
  for (const [k, n] of aSym) {
    const m = bSym.get(k) ?? 0
    for (let i = 0; i < n - m; i++) removed.push(k)
  }
  for (const [k, n] of bSym) {
    const m = aSym.get(k) ?? 0
    for (let i = 0; i < n - m; i++) added.push(k)
  }
  // Re-attribution: a symbol removed at name|kind|line whose name|kind|line
  // reappears under a different owner. Paired by (name,kind,line).
  const ownerOf = (line: string) => line.split("|")[3]
  const reattributed: string[] = []
  const stillRemoved: string[] = []
  for (const rem of removed) {
    const key = symKey(rem)
    const candidate = added.find((x) => symKey(x) === key && ownerOf(x) !== ownerOf(rem))
    if (candidate) {
      reattributed.push(`${rem}  ->  owner=${ownerOf(candidate)}`)
      added.splice(added.indexOf(candidate), 1)
    } else stillRemoved.push(rem)
  }
  // --- relationships ------------------------------------------------------
  const aRel = count(a.rels)
  const bRel = count(b.rels)
  const relRemoved: string[] = []
  const relAdded: string[] = []
  for (const [k, n] of aRel) {
    const m = bRel.get(k) ?? 0
    for (let i = 0; i < n - m; i++) relRemoved.push(k)
  }
  for (const [k, n] of bRel) {
    const m = aRel.get(k) ?? 0
    for (let i = 0; i < n - m; i++) relAdded.push(k)
  }
  // Moved source: same type|target|line, different source.
  const relKeyNoSrc = (line: string) => {
    const p = line.split("|")
    return `${p[1]}|${p[3]}|${p[4]}`
  }
  const moved: string[] = []
  const trulyRemoved: string[] = []
  for (const rem of relRemoved) {
    const key = relKeyNoSrc(rem)
    const cand = relAdded.find((x) => relKeyNoSrc(x) === key && x.split("|")[2] !== rem.split("|")[2])
    if (cand) {
      moved.push(`${key}  src ${rem.split("|")[2]} -> ${cand.split("|")[2]}`)
      relAdded.splice(relAdded.indexOf(cand), 1)
    } else trulyRemoved.push(rem)
  }

  if (stillRemoved.length || relAdded.length || reattributed.length || trulyRemoved.length || moved.length || added.length) r.filesChanged++
  for (const x of stillRemoved) r.removedSymbols.push(`${file} :: ${x}`)
  for (const x of added) r.addedSymbols.push(`${file} :: ${x}`)
  for (const x of reattributed) r.reattributedSymbols.push(`${file} :: ${x}`)
  for (const x of trulyRemoved) r.removedRels.push(`${file} :: ${x}`)
  for (const x of relAdded) r.addedRels.push(`${file} :: ${x}`)
  for (const x of moved) r.movedRelSources.push(`${file} :: ${x}`)
}

for (const file of Object.keys(post)) {
  if (pre[file]) continue
  const lang = file.split("|")[0]
  get(lang).addedSymbols.push(`FILE APPEARED IN POST ONLY: ${file}`)
}

for (const r of [...byLang.values()].sort((x, y) => x.lang.localeCompare(y.lang))) {
  console.log(`\n===== ${r.lang} =====`)
  console.log(`files: pre=${r.filesPre} post=${r.filesPost} changed=${r.filesChanged}`)
  console.log(`symbols:  +${r.addedSymbols.length}  -${r.removedSymbols.length}  re-attributed(owner moved)=${r.reattributedSymbols.length}`)
  console.log(`relations: +${r.addedRels.length}  -${r.removedRels.length}  source-moved=${r.movedRelSources.length}`)
  const show = (title: string, arr: string[], cap = 40) => {
    if (!arr.length) return
    console.log(`  ${title} (${arr.length}):`)
    for (const x of arr.slice(0, cap)) console.log(`    ${x}`)
    if (arr.length > cap) console.log(`    ... ${arr.length - cap} more`)
  }
  show("REMOVED SYMBOLS", r.removedSymbols)
  show("RE-ATTRIBUTED SYMBOLS (owner moved)", r.reattributedSymbols)
  show("REMOVED RELATIONS", r.removedRels)
  show("SOURCE-MOVED RELATIONS", r.movedRelSources, 80)
  show("ADDED SYMBOLS", r.addedSymbols, 60)
  show("ADDED RELATIONS", r.addedRels, 30)
}
