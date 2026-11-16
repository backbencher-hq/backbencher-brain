// script/m14/tmp/clean-127-residue-scope.ts
//
// Whose defect is each residue row? Asked of the candidate tree, not of a regex.
//
// A textual `name ... =` test cannot separate a module-level declaration from a `where`-local
// binding, and that distinction IS the verdict: the analyzer's own design drops where-locals
// as scoped noise (M11.11 closure boundary), so a name that only exists as a local is a
// pinned-side fabrication, while a module-level declaration the candidate analyzer does not
// publish is a real candidate-side loss.
//
// This parses each residue file with the CANDIDATE grammar and, for every declaration node,
// records the declared name and its scope:
//
//   module   — not inside a where_block / class / instance
//   local    — inside a where_block  (scoped noise; must NOT be a symbol)
//   member   — inside a class_declaration / instance_declaration (a Method)
//
// Run: CLEAN_CANDIDATE=/tmp/tree-sitter-clean-127.wasm bun script/m14/tmp/clean-127-residue-scope.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const CANDIDATE = process.env.CLEAN_CANDIDATE ?? "/tmp/tree-sitter-clean-127.wasm"
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

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(CANDIDATE))
  const parser = new P()
  parser.setLanguage(lang)

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

  const files = [...new Set(residue.map((s: any) => s.file))]
  const declsByFile = new Map<string, Map<string, Set<string>>>()

  for (const rel of files) {
    const src = readFileSync(path.join(CORPUS, rel), "utf8")
    const root = parser.parse(src).rootNode
    const map = new Map<string, Set<string>>()
    const add = (name: string, scope: string) => {
      const s = map.get(name) ?? new Set<string>()
      s.add(scope)
      map.set(name, s)
    }
    const stack: any[] = [root]
    const scopeOf = (n: any): string => {
      let cur = n.parent
      let inMember = false
      while (cur) {
        if (cur.type === "where_block") return "local"
        if (cur.type === "class_declaration" || cur.type === "instance_declaration") inMember = true
        cur = cur.parent
      }
      return inMember ? "member" : "module"
    }
    while (stack.length) {
      const n = stack.pop()
      if (n.type === "function_declaration") {
        // The analyzer reads the first `identifier` child; the grammar also exposes a field.
        const byField = n.childForFieldName?.("name") ?? null
        let nm = byField?.text
        if (!nm) {
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "identifier") { nm = c.text; break } }
        }
        if (nm) add(nm, scopeOf(n))
      } else if (n.type === "type_signature") {
        let sig = n.childForFieldName?.("name") ?? null
        if (!sig) for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "signature_name") { sig = c; break } }
        if (sig?.text) add(sig.text, scopeOf(n))
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
    declsByFile.set(rel, map)
  }

  const buckets: Record<string, any[]> = { moduleLoss: [], localNoise: [], memberLoss: [], absent: [], otherName: [] }
  for (const s of residue) {
    const map = declsByFile.get(s.file)
    const scopes = map?.get(s.name)
    if (!scopes) {
      // Names carrying a backtick (Clean's redefinition tick) are a distinct class: the
      // analyzer's emitted name contains a character that is not part of the identifier.
      if (s.name.includes("`")) buckets.otherName.push(s)
      else buckets.absent.push(s)
      continue
    }
    if (scopes.has("module")) buckets.moduleLoss.push(s)
    else if (scopes.has("member")) buckets.memberLoss.push(s)
    else if (scopes.has("local")) buckets.localNoise.push(s)
  }

  const total = residue.length
  const pct = (n: number) => `${n} (${((n / total) * 100).toFixed(1)}%)`
  console.log(`residue ${total} symbols across ${files.length} files — scope asked of the CANDIDATE tree\n`)
  console.log(`  module-level declaration, candidate analyzer dropped it   ${pct(buckets.moduleLoss.length)}   <- REAL candidate-side loss`)
  console.log(`  class/instance member, candidate analyzer dropped it      ${pct(buckets.memberLoss.length)}   <- REAL candidate-side loss`)
  console.log(`  where-local only — scoped noise, must NOT be a symbol     ${pct(buckets.localNoise.length)}   <- pinned-side fabrication`)
  console.log(`  no declaration of that name anywhere in the file          ${pct(buckets.absent.length)}   <- pinned-side fabrication`)
  console.log(`  name contains a backtick (analyzer emitted a non-identifier) ${pct(buckets.otherName.length)}`)

  console.log(`\n--- REAL LOSSES (module level) ${buckets.moduleLoss.length}`)
  for (const s of buckets.moduleLoss) console.log(`  ${s.file}  ${s.line}:${s.kind}:${s.name}@${s.owner}`)
  console.log(`\n--- REAL LOSSES (class/instance member) ${buckets.memberLoss.length}`)
  for (const s of buckets.memberLoss) console.log(`  ${s.file}  ${s.line}:${s.kind}:${s.name}@${s.owner}`)
  console.log(`\n--- where-local noise ${buckets.localNoise.length}`)
  for (const s of buckets.localNoise.slice(0, 40)) console.log(`  ${s.file}  ${s.line}:${s.kind}:${s.name}@${s.owner}`)
  console.log(`\n--- no declaration at all ${buckets.absent.length}`)
  for (const s of buckets.absent) console.log(`  ${s.file}  ${s.line}:${s.kind}:${s.name}@${s.owner}`)
  console.log(`\n--- backtick names ${buckets.otherName.length}`)
  for (const s of buckets.otherName) console.log(`  ${s.file}  ${s.line}:${s.kind}:${JSON.stringify(s.name)}@${s.owner}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
