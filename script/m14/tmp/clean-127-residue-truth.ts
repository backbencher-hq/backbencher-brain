// script/m14/tmp/clean-127-residue-truth.ts
//
// The residue, adjudicated against the source text — the only arbiter that does not depend
// on either grammar.
//
// G3's residue is the set of symbol names the pinned analyzer published that the candidate
// does not, after moves, keyword retirements and predefine retirements are removed. Each row
// is `file  line:kind:name@owner`. The question that decides whether a row is a LOSS or a
// pinned-side fabrication is textual and answerable without either parser:
//
//   declared   — the name appears as a definition (`name <args> = ...`) or a signature
//                (`name :: ...`) at the head of some line in that same file  -> real symbol
//   not-declared — it appears only in argument position / inside an expression. Then the
//                pinned analyzer published something that is not a declaration.
//
// Run: bun script/m14/tmp/clean-127-residue-truth.ts
import { readFileSync } from "node:fs"
import path from "node:path"

const CORPUS = "<corpus-root>/bb_tests/repositories"
const EVIDENCE = process.env.EVIDENCE ?? "validation/m14/results/M14.0.F11.clean.json"
const g3 = JSON.parse(readFileSync(EVIDENCE, "utf8")).data.g3 as any

const CLEAN_KEYWORDS = new Set(["where","type","instance","class","import","from","of","if","then","else","case","let","in","with","derive","foreign","export","module","implementation","definition","system","infix","infixl","infixr","special","generic","priority"])
const CLEAN_PREDEFINES = new Set(["Int","Real","Bool","Char","String","List","Maybe","Array","Void","otherwise","True","False","Nil","Cons","Just","Nothing","File","World"])

function parseSymbol(row: string) {
  const file = row.split(/\s+/)[0]
  const rest = row.slice(file.length).trim()
  const m = rest.match(/^(\d+):([a-z]+):(.+)$/)
  if (!m) return null
  let name = m[3]
  let owner: string | null = null
  const at = name.lastIndexOf("@")
  if (at >= 0) { owner = name.slice(at + 1); name = name.slice(0, at) }
  return { file, line: Number(m[1]), kind: m[2], name, owner }
}
const ident = (s: any) => `${s.kind}:${s.name}@${s.owner ?? ""}`

const vanished = (g3.vanishedSymbols ?? []).map(parseSymbol).filter(Boolean)
const added = (g3.addedSymbols ?? []).map(parseSymbol).filter(Boolean)
const addedIdent = new Map<string, number[]>()
for (const s of added) { const l = addedIdent.get(ident(s)) ?? []; l.push(s.line); addedIdent.set(ident(s), l) }

const residue = vanished.filter((s: any) => {
  const hit = addedIdent.get(ident(s))
  if (hit && hit.some((l) => l !== s.line)) return false
  if (CLEAN_KEYWORDS.has(s.name) || CLEAN_PREDEFINES.has(s.name)) return false
  return true
})

/** Is the name a declaration head somewhere in this file? */
function declaredIn(src: string, name: string): { declared: boolean; signature: boolean; atLines: number[] } {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const defRe = new RegExp(`^[\\t ]*${esc}(?![A-Za-z0-9_'\\\`])(?![^=]*->)(?![\\t ]*::)[^=]*=`, "")
  const sigRe = new RegExp(`^[\\t ]*${esc}(?![A-Za-z0-9_'\\\`])[\\t ]*::`, "")
  let declared = false, signature = false
  const atLines: number[] = []
  const lines = src.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l) continue
    if (sigRe.test(l)) { signature = true; atLines.push(i + 1); continue }
    if (defRe.test(l)) { declared = true; atLines.push(i + 1) }
  }
  return { declared, signature, atLines }
}

/** Every occurrence of the name as a whole word, with the line text. */
function occurrences(src: string, name: string, limit = 3): string[] {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(?<![A-Za-z0-9_'\\\`])${esc}(?![A-Za-z0-9_'\\\`])`, "g")
  const out: string[] = []
  const lines = src.split("\n")
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    if (re.test(lines[i])) { out.push(`L${i + 1}: ${lines[i].trim().slice(0, 110)}`); re.lastIndex = 0 }
  }
  return out
}

const buckets = { declared: [] as any[], notDeclared: [] as any[] }
const byFile = new Map<string, string[]>()
for (const s of residue) {
  let src: string
  try { src = readFileSync(path.join(CORPUS, s.file), "utf8") } catch { continue }
  const d = declaredIn(src, s.name)
  const rec = { ...s, ...d, occ: occurrences(src, s.name) }
  if (d.declared || d.signature) buckets.declared.push(rec)
  else buckets.notDeclared.push(rec)
  const l = byFile.get(s.file) ?? []
  l.push(`${s.line}:${s.kind}:${s.name}${d.declared || d.signature ? " [DECLARED]" : " [not declared]"}`)
  byFile.set(s.file, l)
}

console.log(`residue ${residue.length} symbols across ${byFile.size} files`)
console.log(`  the name is a definition/signature head in its own file: ${buckets.declared.length}  <- candidate-side LOSS`)
console.log(`  the name is NOT a declaration anywhere in its file:      ${buckets.notDeclared.length}  <- pinned-side fabrication`)

console.log(`\n--- NOT DECLARED (fabrications), first 25 with the line pinned reported and real occurrences`)
for (const r of buckets.notDeclared.slice(0, 25)) {
  console.log(`  ${r.file}  ${r.line}:${r.kind}:${r.name}@${r.owner}`)
  for (const o of r.occ.slice(0, 2)) console.log(`      ${o}`)
}

console.log(`\n--- DECLARED (candidate-side losses), all ${buckets.declared.length}`)
for (const r of buckets.declared) {
  console.log(`  ${r.file}  ${r.line}:${r.kind}:${r.name}@${r.owner}  signature=${r.signature} defLines=${r.atLines.slice(0, 6).join(",")}`)
}

console.log(`\n--- per file`)
for (const [f, l] of byFile) console.log(`  ${f}\n      ${l.join("\n      ")}`)
