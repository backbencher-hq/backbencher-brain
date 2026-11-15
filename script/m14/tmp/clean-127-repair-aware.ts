// script/m14/tmp/clean-127-repair-aware.ts
//
// Repair-aware G3, computed from the committed evidence so the classification can be
// designed (and argued with) before it is wired into the gate.
//
// G3's identity is line-inclusive on the symbol side:
//   baseOf = ^(\d+:(function|class|...):[^@]+)
// so `222:function:impAppDelLogWindows@M` -> `225:function:impAppDelLogWindows@M` — a
// corrected POSITION — is counted once as VANISHED and once as ADDED. A gate that counts
// a position correction as a loss is the wrong instrument for a grammar whose release note
// is a position fix.
//
// A symbol identity must therefore be (kind, name, owner) and carry the line only as
// evidence, never as identity. Same for pairs: the dump emits `undefined` in the line slot
// for every relationship, so pair identity is already position-free — which means the pair
// side has been honest all along and only the symbol side needs repair.
//
// Run: bun script/m14/tmp/clean-127-repair-aware.ts
import { readFileSync } from "node:fs"

const EVIDENCE = process.env.EVIDENCE ?? "validation/m14/results/M14.0.F11.clean.json"
const d = JSON.parse(readFileSync(EVIDENCE, "utf8")).data.g3 as any

/** Clean reserved words — a name in this set is not a symbol under any reading. */
const CLEAN_KEYWORDS = new Set([
  "where", "type", "instance", "class", "import", "from", "of", "if", "then", "else",
  "case", "let", "in", "with", "derive", "foreign", "export", "module", "implementation",
  "definition", "system", "infix", "infixl", "infixr", "special", "generic", "priority",
])

/** Names bound by StdEnv rather than declared by the file under analysis. */
const CLEAN_PREDEFINES = new Set([
  "Int", "Real", "Bool", "Char", "String", "List", "Maybe", "Array", "Void",
  "otherwise", "True", "False", "Nil", "Cons", "Just", "Nothing", "File", "World",
])

/** Split a G3 symbol row `N:kind:name@owner` into its parts. */
function parseSymbol(row: string): { file: string; line: number | null; kind: string; name: string; owner: string | null } {
  const file = row.split(/\s+/)[0]
  const rest = row.slice(file.length).trim()
  const m = rest.match(/^(\d+):([a-z]+):(.+)$/)
  if (!m) return { file, line: null, kind: "?", name: rest, owner: null }
  const line = Number(m[1])
  const kind = m[2]
  let name = m[3]
  let owner: string | null = null
  const at = name.lastIndexOf("@")
  if (at >= 0) { owner = name.slice(at + 1); name = name.slice(0, at) }
  return { file, line, kind, name, owner }
}

/** Identity without the line: what a position fix must not be able to change. */
const ident = (s: { kind: string; name: string; owner: string | null }) => `${s.kind}:${s.name}@${s.owner ?? ""}`

const vanished: string[] = d.vanishedSymbols ?? []
const added: string[] = d.addedSymbols ?? []
const lost: string[] = d.lostPairs ?? []
const gained: string[] = d.addedPairs ?? []

const vSyms = vanished.map(parseSymbol)
const aSyms = added.map(parseSymbol)
const addedByIdent = new Map<string, { line: number | null }[]>()
for (const s of aSyms) {
  const k = ident(s)
  const list = addedByIdent.get(k) ?? []
  list.push({ line: s.line })
  addedByIdent.set(k, list)
}

const moved: string[] = []
const retiredKeyword: string[] = []
const retiredPredefine: string[] = []
const residue: string[] = []

for (let i = 0; i < vSyms.length; i++) {
  const s = vSyms[i]
  const row = vanished[i]
  const hit = addedByIdent.get(ident(s))
  if (hit && hit.some((h) => h.line !== s.line)) { moved.push(row); continue }
  if (CLEAN_KEYWORDS.has(s.name)) { retiredKeyword.push(row); continue }
  if (CLEAN_PREDEFINES.has(s.name)) { retiredPredefine.push(row); continue }
  residue.push(row)
}

/** Pair rows: `undefined:<kind>:<src>-><dst>#<...>` — parse both endpoints. */
function parsePair(row: string): { file: string; kind: string; src: string; dst: string } | null {
  const sp = row.split(/\s+/)
  const file = sp[0]
  const rest = row.slice(file.length).trim()
  const m = rest.match(/^([^:]*):([a-z]+):(.*)$/)
  if (!m) return null
  const arrow = m[3].indexOf("->")
  if (arrow < 0) return null
  return { file, kind: m[2], src: m[3].slice(0, arrow), dst: m[3].slice(arrow + 2).replace(/#.*$/, "") }
}

const lostRows = lost.map(parsePair).filter(Boolean) as { file: string; kind: string; src: string; dst: string }[]
const pairRetired: string[] = []
const pairResidue: string[] = []
lost.forEach((row, i) => {
  const p = lostRows[i]
  if (p && (CLEAN_KEYWORDS.has(p.src) || CLEAN_KEYWORDS.has(p.dst))) { pairRetired.push(row); return }
  pairResidue.push(row)
})

const pct = (n: number, t: number) => `${n} (${t ? ((n / t) * 100).toFixed(1) : "0.0"}%)`
console.log(`evidence: ${EVIDENCE}`)
console.log(`\n=== symbols (raw vanished ${d.vanished}, added ${d.symAdded}) ===`)
console.log(`  moved (same kind:name@owner, different line)   ${pct(moved.length, vanished.length)}`)
console.log(`  retired: Clean keyword published as a symbol   ${pct(retiredKeyword.length, vanished.length)}`)
console.log(`  retired: StdEnv predefine published as a symbol ${pct(retiredPredefine.length, vanished.length)}`)
console.log(`  RESIDUE — needs adjudication                   ${pct(residue.length, vanished.length)}`)
console.log(`\n=== pairs (raw lost ${d.lost}, added ${d.pairsAdded}) ===`)
console.log(`  retired: an endpoint is a Clean keyword        ${pct(pairRetired.length, lost.length)}`)
console.log(`  RESIDUE — needs adjudication                   ${pct(pairResidue.length, lost.length)}`)

const byFile = new Map<string, number>()
for (const r of residue) { const f = r.split(/\s+/)[0]; byFile.set(f, (byFile.get(f) ?? 0) + 1) }
console.log(`\nresidue symbols by file (${byFile.size} files):`)
for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(3)}  ${f}`)
console.log(`\nfirst 30 residue symbols:`)
for (const r of residue.slice(0, 30)) console.log(`  ${r}`)
console.log(`\nfirst 20 residue pairs:`)
for (const r of pairResidue.slice(0, 20)) console.log(`  ${r}`)
