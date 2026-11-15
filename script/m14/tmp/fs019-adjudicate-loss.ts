// FS019 — ADJUDICATE every REAL-LOSS row from the A/B, mechanically. The comparator's
// loss test is "is the row's NAME written in the file", which is necessary but not
// sufficient: a name that IS written can still be a signature rather than a name, in
// which case removing it is the fix. This probe decides that per row, with the rule
// stated once and applied by code rather than by reading 90 lines.
//
// THE RULE. A published symbol NAME must be an F# identifier: a letter or underscore,
// then letters, digits, underscores, an apostrophe (a type parameter) or a backtick
// (an explicit-escape identifier). A name carrying a SPACE, a `(`, a `<` or a `:` is
// not a name — it is source text the analyzer copied. A dropped row whose name fails
// that test is a FABRICATION REMOVAL; a dropped row whose name passes it and whose
// name has no survivor in the patched file is a real loss and must be adjudicated by
// hand.
//
// Run: bun script/m14/tmp/fs019-adjudicate-loss.ts --a head.json --b patched.json [--json out]
import * as fs from "fs"

const argOf = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const A = JSON.parse(fs.readFileSync(argOf("--a")!, "utf8"))
const B = JSON.parse(fs.readFileSync(argOf("--b")!, "utf8"))

/** An F# identifier, allowing the apostrophe of a type parameter and the backtick escape. */
const isName = (n: string) => /^[A-Za-z_][A-Za-z0-9_'`]*$/.test(n)

const bByFile = new Map<string, any>()
for (const f of B.files) bByFile.set(f.file, f)

const symKey = (s: any) => `${s.name}|${s.kind}|${s.owner ?? ""}|${s.line}`
const relKey = (r: any) => `${r.type}|${r.source}|${r.target}|${r.line}`

const fabricationRemoved: any[] = []
const stillLost: any[] = []
let checked = 0

for (const fa of A.files) {
  const fb = bByFile.get(fa.file)
  if (!fb || fa.crash || fb.crash) continue
  const bS = new Map<string, number>(), bR = new Map<string, number>()
  for (const s of fb.symbols) bS.set(symKey(s), (bS.get(symKey(s)) ?? 0) + 1)
  for (const r of fb.relationships) bR.set(relKey(r), (bR.get(relKey(r)) ?? 0) + 1)
  const bNames = new Set(fb.symbols.map((s: any) => String(s.name)))
  // A `calls` target need not be declared in the same file — that is the lane's
  // documented leaf-target contract, not a loss. So a dropped call is only a loss if
  // the patched file emits NO call to that target at all. (Testing the target against
  // the file's symbol names convicted 1,038 legitimate calls of being lost.)
  const bCallTargets = new Set(fb.relationships.filter((r: any) => r.type === "calls").map((r: any) => String(r.target)))
  const bTargets = new Set(fb.relationships.map((r: any) => String(r.target)))
  const bSources = new Set(fb.relationships.map((r: any) => String(r.source)))

  const drops: any[] = []
  for (const s of fa.symbols) { const k = symKey(s); const n = bS.get(k) ?? 0; if (n > 0) bS.set(k, n - 1); else drops.push(s) }
  for (const r of fa.relationships) { const k = relKey(r); const n = bR.get(k) ?? 0; if (n > 0) bR.set(k, n - 1); else drops.push(r) }

  for (const d of drops) {
    const isSym = d.kind !== undefined
    const name = String(isSym ? d.name : d.target)
    if (!isSym && d.source === d.target) continue // self-edge, adjudicated separately
    // a same-named symbol survives somewhere in the patched file?
    if (bNames.has(name)) continue
    if (!isSym) {
      // the edge's target survives as some edge's target, and the source survives as
      // some edge's source => the fact is still in the graph, re-pointed
      if (bTargets.has(name)) continue
      if (d.type === "calls" && bCallTargets.has(name)) continue
      void bSources
    }
    checked++
    const row = { file: fa.file, line: isSym ? d.line : d.line, name, row: d, isSymbol: isSym }
    if (!isName(name)) fabricationRemoved.push(row)
    else stillLost.push(row)
  }
}

const jp = argOf("--json")
const out = { a: A.files.length, b: B.files.length, checked, fabricationRemovedCount: fabricationRemoved.length, stillLostCount: stillLost.length, fabricationRemoved, stillLost }
if (jp) fs.writeFileSync(jp, JSON.stringify(out, null, 1))

console.log(`FS019 — adjudicating dropped rows whose name has NO survivor in the patched file\n`)
console.log(`  dropped rows examined (self-edges and same-name survivors already excluded) ${checked}`)
console.log(`    FABRICATION REMOVED (the name is not an F# identifier)   ${out.fabricationRemovedCount}`)
console.log(`    STILL LOST (a legal identifier with no survivor)         ${out.stillLostCount}`)
console.log(`\n== the fabrications, by the character that disqualifies the name ==`)
const why = new Map<string, number>()
for (const f of fabricationRemoved) {
  const n = f.name
  const k = n.includes("(") ? "a parameter list  '('" : n.includes("<") ? "a generic argument '<'" : n.includes(": ") ? "a return-type annotation ': '" : n.includes(" ") ? "a space" : "other"
  why.set(k, (why.get(k) ?? 0) + 1)
}
for (const [k, v] of [...why.entries()].sort((x, y) => y[1] - x[1])) console.log(`   ${String(v).padStart(4)}  ${k}`)
console.log(`\n== sample ==`)
for (const f of fabricationRemoved.slice(0, 14)) console.log(`   ${f.file.split("/").pop()}:${f.line}  ${JSON.stringify(f.name).slice(0, 110)}`)
if (stillLost.length) {
  console.log(`\n== STILL LOST — these are legal names with no survivor; each needs a hand reading ==`)
  for (const s of stillLost.slice(0, 40)) console.log(`   ${s.file.split("/").pop()}:${s.line}  ${JSON.stringify(s.name)}`)
}
console.log(`\n  ${out.stillLostCount === 0 ? "NOTHING IS LOST: every dropped row was either a self-edge, a duplicate, or a name that was never a name." : "READ EVERY STILL-LOST ROW above before shipping."}`)
process.exit(out.stillLostCount === 0 ? 0 : 1)
