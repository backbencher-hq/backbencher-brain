// script/m14/tmp/clean-127-pair-residue.ts
//
// The 17 pair residue rows, adjudicated against the source.
//
// The symbol residue could be judged by "is this name declared at module level in its own
// file?", which is decisive because a symbol must be declared where it is defined. A pair
// endpoint cannot be judged that way: `instantiates:determine_dir_and_filename->GetModuleName`
// legitimately targets a name imported from another module, so absence from the file is not
// evidence against it. What IS decidable per row:
//
//   the endpoint is a local binding in this file (`name ... =` inside a where block, or a
//   parameter in an argument position) -> the pinned analyzer's edge target is a non-symbol
//   the endpoint is a qualified name or an imported/uppercase constructor -> the edge is real
//
// Run: bun script/m14/tmp/clean-127-pair-residue.ts
import { readFileSync } from "node:fs"
import path from "node:path"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const EVIDENCE = process.env.EVIDENCE ?? "validation/m14/results/M14.0.F11.clean.json"
const g3 = JSON.parse(readFileSync(EVIDENCE, "utf8")).data.g3 as any

function parsePairRow(row: string) {
  const file = row.split(/\s+/)[0]
  const rest = row.slice(file.length).trim()
  const m = rest.match(/^([^:]*):([a-z]+):(.*)$/)
  if (!m) return null
  const arrow = m[3].indexOf("->")
  if (arrow < 0) return null
  return { file, kind: m[2], src: m[3].slice(0, arrow), dst: m[3].slice(arrow + 2).replace(/#.*$/, "") }
}

/** How does a name appear in the file? */
function appearances(src: string, name: string) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const lines = src.split("\n")
  let localBinding = false
  let anyOccurrence = 0
  const samples: string[] = []
  const localRe = new RegExp(`^[\\t ]+${esc}(?![A-Za-z0-9_'\\\`])[^=]*=`)
  const headRe = new RegExp(`(?<![A-Za-z0-9_'\\\`])${esc}(?![A-Za-z0-9_'\\\`])`)
  let indentOfFirst: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!headRe.test(l)) continue
    anyOccurrence++
    if (indentOfFirst === null) indentOfFirst = l.match(/^[\t ]*/)?.[0].length ?? 0
    if (localRe.test(l)) localBinding = true
    if (samples.length < 3) samples.push(`L${i + 1}: ${l.trim().slice(0, 100)}`)
  }
  return { localBinding, anyOccurrence, samples, indentOfFirst }
}

function main() {
  const residue: string[] = g3.pairResidue ?? []
  console.log(`${residue.length} pair residue rows\n`)
  let nonSymbol = 0
  let qualified = 0
  let other = 0
  for (const row of residue) {
    const p = parsePairRow(row)
    if (!p) { console.log(`  UNPARSED ${row}`); continue }
    const src = readFileSync(path.join(CORPUS, p.file), "utf8")
    const sd = appearances(src, p.dst)
    let cls: string
    if (p.dst.includes(".") || p.dst.includes("'")) { cls = "qualified target (imported)"; qualified++ }
    else if (/^[A-Z]/.test(p.dst)) { cls = "constructor/type target (may be imported)"; other++ }
    else if (sd.localBinding) { cls = "PAIR RESIDUE: target is a local binding in this file"; nonSymbol++ }
    else { cls = "needs reading"; other++ }
    console.log(`  ${row}`)
    console.log(`      -> ${cls}  (src occurrences ${appearances(src, p.src).anyOccurrence})`)
    for (const s of sd.samples) console.log(`         ${s}`)
  }
  console.log(`\nsummary: target-is-a-local-binding ${nonSymbol}, qualified ${qualified}, other ${other}`)
}

main()
