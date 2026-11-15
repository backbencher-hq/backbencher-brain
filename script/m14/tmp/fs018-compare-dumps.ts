// FS018 — compare two FS015 dumps directly (HEAD vs patched) over the same file set,
// classifying every delta row. The FS015 driver runs the LIVE analyzer, so comparing
// "head mode" against a dump taken from the same tree compares the tree with itself —
// which reports "no regressions" for any patch, including a broken one. This reads two
// dump files and does the arithmetic, so the comparison is between two RUNS.
//
// CLASSIFICATION, per dropped row (a row present at HEAD, absent in the patch):
//   REAL-LOSS  the row's name IS written in that file's source text at or after the
//              row's line — a real declaration or call the patch destroyed.
//   REATTRIB   a row with the same type and one endpoint changed was ADDED — the fact
//              moved owner/target rather than vanishing.
//   DROP       neither: the name is not in the file at all, so the row was a
//              fabrication and removing it is the point of the fix.
//
// Run: bun script/m14/tmp/fs018-compare-dumps.ts --a head.json --b patched.json [--json out]
import * as fs from "fs"

const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const A = JSON.parse(fs.readFileSync(argOf("--a")!, "utf8"))
const B = JSON.parse(fs.readFileSync(argOf("--b")!, "utf8"))

const symKey = (s: any) => `${s.name}|${s.kind}|${s.owner ?? ""}|${s.line}`
const relKey = (r: any) => `${r.type}|${r.source}|${r.target}|${r.line}`

const bByFile = new Map<string, any>()
for (const f of B.files) bByFile.set(f.file, f)
const aByFile = new Map<string, any>()
for (const f of A.files) aByFile.set(f.file, f)

let filesChanged = 0, onlyInA = 0, onlyInB = 0
let aSym = 0, bSym = 0, aRel = 0, bRel = 0
const symGains: any[] = [], symDrops: any[] = []
const relGains: any[] = [], relDrops: any[] = []
const crashesA = A.files.filter((f: any) => f.crash).length
const crashesB = B.files.filter((f: any) => f.crash).length

for (const [file, fa] of aByFile) {
  const fb = bByFile.get(file)
  if (!fb) { onlyInA++; continue }
  if (fa.crash || fb.crash) { if (fa.crash !== fb.crash) onlyInA++ ; continue }
  aSym += fa.symbols.length; bSym += fb.symbols.length
  aRel += fa.relationships.length; bRel += fb.relationships.length
  if (JSON.stringify(fa.symbols) !== JSON.stringify(fb.symbols) || JSON.stringify(fa.relationships) !== JSON.stringify(fb.relationships)) filesChanged++

  const bS = new Map<string, any[]>()
  for (const s of fb.symbols) { const k = symKey(s); const arr = bS.get(k) ?? []; arr.push(s); bS.set(k, arr) }
  const bR = new Map<string, any[]>()
  for (const r of fb.relationships) { const k = relKey(r); const arr = bR.get(k) ?? []; arr.push(r); bR.set(k, arr) }

  for (const s of fa.symbols) { const arr = bS.get(symKey(s)); if (arr && arr.length) arr.pop(); else symDrops.push({ file, row: s, src: fa.src }) }
  for (const r of fa.relationships) { const arr = bR.get(relKey(r)); if (arr && arr.length) arr.pop(); else relDrops.push({ file, row: r, src: fa.src }) }
  for (const arr of bS.values()) for (const s of arr) symGains.push({ file, row: s })
  for (const arr of bR.values()) for (const r of arr) relGains.push({ file, row: r })
}
for (const file of bByFile.keys()) if (!aByFile.has(file)) onlyInB++

// classification. THREE named classes before the loss test, because a fix that removes
// a whole edge CLASS must not be reported as a mass loss:
//
//   SELF-EDGE   the dropped row had source === target: a name containing itself, a
//               statement about the graph's bookkeeping rather than the code.
//   DUPLICATE   the dropped row is one of two rows for the same (file, name) and the
//               SURVIVOR is the one that keeps the members — a de-duplication.
// Everything else must clear the loss test below.
const gainByFileName = new Map<string, any[]>()
for (const g of symGains) {
  const arr = gainByFileName.get(`${g.file}|${g.row.name}|${g.row.kind}`) ?? []
  arr.push(g.row); gainByFileName.set(`${g.file}|${g.row.name}|${g.row.kind}`, arr)
}
  const bNames = new Map<string, any[]>()
  for (const f of B.files) for (const s of (f.symbols ?? [])) {
    const arr = bNames.get(`${f.file}|${s.name}`) ?? []
    arr.push(s); bNames.set(`${f.file}|${s.name}`, arr)
  }
const gainSrc = new Map(relGains.map((g) => [`${g.file}|${g.row.type}|${g.row.target}`, g.row.source]))
const selfEdges: any[] = [], duplicates: any[] = []
const reattributed: any[] = [], fabrications: any[] = [], realLoss: any[] = []
for (const d of relDrops) {
  if (d.row.source === d.row.target) { selfEdges.push(d); continue }
  const name = String(d.row.target ?? "")
  const srcLine = d.row.line ?? 0
  const written = d.src ? d.src.split("\n").slice(Math.max(0, srcLine - 1)).join("\n").includes(name) : false
  if (!written) { fabrications.push(d); continue }
  const moved = gainSrc.get(`${d.file}|${d.row.type}|${name}`)
  if (moved !== undefined && moved !== d.row.source) { reattributed.push({ ...d, newSource: moved }); continue }
  const survSym = bNames.get(`${d.file}|${name}`)
  if (survSym && survSym.length) { duplicates.push({ ...d, survivor: survSym[0] }); continue }
  realLoss.push(d)
}
for (const d of symDrops) {
  if (d.row.owner === d.row.name) { selfEdges.push(d); continue }
  const name = String(d.row.name ?? "")
  const srcLine = d.row.line ?? 0
  const written = d.src ? d.src.split("\n").slice(Math.max(0, srcLine - 1)).join("\n").includes(name) : false
  // A drop is a DUPLICATE when the patched file still publishes a symbol of the same
  // NAME — not merely when a same-named row appears among the GAINS. The distinction
  // matters because a removed REDUNDANT DECLARATION produces no gain: the surviving
  // symbol is byte-identical to one HEAD already had, so it never enters the gain
  // list, and a gain-only test reads a correct de-duplication as a loss.
  const surviving = bNames.get(`${d.file}|${name}`)
  if (surviving && surviving.length) { duplicates.push({ ...d, survivor: surviving[0] }); continue }
  const moved = symGains.find((g) => g.file === d.file && g.row.name === name && g.row.kind === d.row.kind)
  if (moved && (moved.row.owner ?? null) !== (d.row.owner ?? null)) { reattributed.push({ ...d, newOwner: moved.row.owner }); continue }
  realLoss.push(d)
}

const uniq = <T,>(a: T[], k: (x: T) => string): T[] => { const seen = new Set<string>(); return a.filter((x) => { const s = k(x); if (seen.has(s)) return false; seen.add(s); return true }) }
const out = {
  a: { repo: A.repo, limit: A.limit, files: A.files.length, crashes: crashesA, symbols: aSym, relationships: aRel },
  b: { repo: B.repo, limit: B.limit, files: B.files.length, crashes: crashesB, symbols: bSym, relationships: bRel },
  filesCompared: Math.min(A.files.length, B.files.length), filesChanged, onlyInA, onlyInB,
  symGains: uniq(symGains, (x) => JSON.stringify(x)), relGains: uniq(relGains, (x) => JSON.stringify(x)),
  drops: uniq([...relDrops, ...symDrops], (x) => JSON.stringify(x)),
  realLoss: uniq(realLoss, (x) => JSON.stringify(x)), reattributed: uniq(reattributed, (x) => JSON.stringify(x)),
  fabricationsRemoved: uniq(fabrications, (x) => JSON.stringify(x)),
  selfEdgesRemoved: uniq(selfEdges, (x) => JSON.stringify(x)),
  duplicatesRemoved: uniq(duplicates, (x) => JSON.stringify(x)),
}
const jp = argOf("--json")
if (jp) fs.writeFileSync(jp, JSON.stringify(out, null, 1))

console.log(`FS018 — dump comparison   A=${A.files.length} files   B=${B.files.length} files`)
console.log(`  crashes            ${crashesA} -> ${crashesB}`)
console.log(`  files compared     ${out.filesCompared}   files whose output changed ${filesChanged}   onlyInA ${onlyInA}   onlyInB ${onlyInB}`)
console.log(`  symbols            ${aSym} -> ${bSym}  (${bSym - aSym >= 0 ? "+" : ""}${bSym - aSym})`)
console.log(`  relationships      ${aRel} -> ${bRel}  (${bRel - aRel >= 0 ? "+" : ""}${bRel - aRel})`)
console.log(`\n  GAINS   symbols ${out.symGains.length}   relationships ${out.relGains.length}`)
const gainByLabel = new Map<string, number>()
for (const g of out.relGains) { const k = `${g.row.type}:${g.row.nodeType ?? "?"}`; gainByLabel.set(k, (gainByLabel.get(k) ?? 0) + 1) }
for (const [k, v] of [...gainByLabel.entries()].sort((x, y) => y[1] - x[1])) console.log(`     ${String(v).padStart(6)}  ${k}`)
for (const g of out.symGains.slice(0, 10)) console.log(`     sym  ${g.file}  ${JSON.stringify(g.row)}`)
console.log(`\n  DROPS classified:`)
console.log(`     SELF-EDGE REMOVED (source === target)                ${out.selfEdgesRemoved.length}`)
const seByNode = new Map<string, number>()
for (const s of out.selfEdgesRemoved) { const k = String(s.row.nodeType ?? s.row.type); seByNode.set(k, (seByNode.get(k) ?? 0) + 1) }
for (const [k, v] of [...seByNode.entries()].sort((x, y) => y[1] - x[1])) console.log(`        ${String(v).padStart(5)}  ${k}`)
console.log(`     DUPLICATE REMOVED (a survivor of the same name kept) ${out.duplicatesRemoved.length}`)
const dupByNode = new Map<string, number>()
for (const s of out.duplicatesRemoved) { const k = String(s.row.nodeType ?? s.row.type); dupByNode.set(k, (dupByNode.get(k) ?? 0) + 1) }
for (const [k, v] of [...dupByNode.entries()].sort((x, y) => y[1] - x[1])) console.log(`        ${String(v).padStart(5)}  ${k}`)
console.log(`     RE-ATTRIBUTED (same fact, endpoint moved)            ${out.reattributed.length}`)
for (const r of out.reattributed.slice(0, 12)) console.log(`        ${r.file}  ${JSON.stringify(r.row)}  ->  ${JSON.stringify(r.newOwner ?? r.newSource)}`)
console.log(`     FABRICATION REMOVED (name not in the file at all)   ${out.fabricationsRemoved.length}`)
for (const f of out.fabricationsRemoved.slice(0, 12)) console.log(`        ${f.file}  ${JSON.stringify(f.row)}`)
console.log(`     REAL-LOSS (the name IS written in the file)          ${out.realLoss.length}`)
for (const l of out.realLoss.slice(0, 40)) console.log(`        ${l.file}  ${JSON.stringify(l.row)}`)
console.log(`\n  ${out.realLoss.length === 0 ? "REAL-LOSS is 0 — nothing the patch wrote in a file was dropped." : "REAL-LOSS IS NOT ZERO: read every row above before shipping."}`)
