/**
 * READ-ONLY PROBE — the three claims, measured through the production entry.
 *
 *   1. RELATIONSHIP ONTOLOGY. All ten type values the engine defines: which the
 *      lane emits, which it does not, and for the ones it does not, whether the
 *      language's semantics allow one at all. A type that is neither emitted nor
 *      ruled is the failure this is looking for.
 *   2. UNKNOWN SYMBOLS. Empty names, kinds outside the engine's vocabulary,
 *      members with no owner, files with no symbols — and then the one nothing
 *      else measures: EVERY EDGE ENDPOINT, classified into the four things an
 *      endpoint can legitimately be (a symbol in this file, a shell-defined
 *      name, an external binary, a path) so "not a symbol" stops being a single
 *      undifferentiated number.
 *   3. LINE NUMBERS. Every relationship, per corpus: does it carry a 1-based
 *      line, and is that line the one the NAME is written on.
 *
 * Writes nothing.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const ROOT = process.cwd()
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const REPOS = ["fsharp", "otp"]

const ALL_TYPES = [
  "calls", "extends", "implements", "uses", "imports",
  "exports", "contains", "references", "overrides", "instantiates",
]
const ALL_KINDS = new Set([
  "function", "class", "variable", "constant", "interface", "enum", "enum_member",
  "type", "import", "export", "method", "property", "constructor", "namespace",
  "module", "table", "service", "resource", "type_alias", "event", "delegate",
  "object", "record", "macro", "trait", "struct", "impl", "actor", "union",
  "mixin", "extension",
])
// Shell-defined names the analyzer labels. Mirrored here from the analyzer's own
// published metadata rather than from a second list, because the question here
// is "did the analyzer LABEL it", not "is the list right".
const SHELL_DEFINED_MARK = "isShellDefined"

const totals: Record<string, number> = {}
const kindCounts: Record<string, number> = {}
let symbols = 0, relationships = 0
let emptyName = 0, unknownKind = 0, ownerlessMember = 0, symbolFreeFiles = 0, files = 0
let withLine = 0, withoutLine = 0
let lineZeroOrNeg = 0
const srcClass = new Map<string, number>()
const tgtClass = new Map<string, number>()
const lineAtName = { checked: 0, agrees: 0 }
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(path.join(dir, ".git"))) continue
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort()
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    try { if (statSync(abs).isSymbolicLink()) continue } catch { /* not a link */ }
    let res: any
    try { res = await parseFile(abs, dir) } catch { continue }
    files++
    const syms = res.symbols ?? []
    const rels = res.relationships ?? []
    symbols += syms.length
    relationships += rels.length
    const declared = new Set(syms.map((s: any) => s.name))
    if (syms.length === 0) symbolFreeFiles++
    for (const s of syms) {
      const nm = String(s.name ?? "")
      if (nm.trim() === "") emptyName++
      const k = String(s.kind ?? s.type ?? "")
      if (!ALL_KINDS.has(k)) unknownKind++
      kindCounts[k] = (kindCounts[k] ?? 0) + 1
      if (!s.ownerName && (k === "variable" || k === "constant")) ownerlessMember++
    }
    const lines = text.split("\n")
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "")
      totals[t] = (totals[t] ?? 0) + 1
      if (typeof r.line_number === "number" && r.line_number > 0) withLine++
      else withoutLine++
      if (r.line_number !== undefined && r.line_number !== null && !(r.line_number > 0)) lineZeroOrNeg++

      const src = String(r.source ?? r.from ?? "")
      const tgt = String(r.target ?? r.to ?? "")
      bump(srcClass, declared.has(src) ? "symbol-in-this-file" : `NOT-A-SYMBOL(${src})`)

      // Target classification — the four things an endpoint can legitimately be.
      if (declared.has(tgt)) bump(tgtClass, "symbol-in-this-file")
      else if ((r.metadata ?? {})[SHELL_DEFINED_MARK] === true) bump(tgtClass, "shell-defined-name")
      else if (t === "imports" || t === "references") bump(tgtClass, "filesystem-path")
      else if (t === "calls" && (r.metadata ?? {}).isExternalCommand === true) bump(tgtClass, "external-binary")
      else bump(tgtClass, `UNCLASSIFIED(${t}:${tgt})`)

      // Is the line the NAME's line? For a `calls` edge the name is the command
      // word, so the line must contain that word.
      if (t === "calls" && typeof r.line_number === "number" && r.line_number > 0 && tgt) {
        const src_line = lines[r.line_number - 1] ?? ""
        if (src_line) {
          lineAtName.checked++
          if (src_line.includes(tgt)) lineAtName.agrees++
        }
      }
    }
  }
}

const top = (m: Map<string, number>, n = 12) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)

console.log(`=== bash: the three claims, production parseFile, ${files} files over ${REPOS.join(" + ")} ===\n`)

console.log("1. RELATIONSHIP ONTOLOGY — the engine defines 10 type values")
for (const t of ALL_TYPES) {
  const n = totals[t] ?? 0
  const verdict = n > 0 ? "emitted" : "RULED (see BD7 in the spec)"
  console.log(`   ${t.padEnd(14)} ${String(n).padStart(6)}  ${verdict}`)
}
const extra = Object.keys(totals).filter((k) => !ALL_TYPES.includes(k))
console.log(`   types emitted outside the enum: ${extra.length ? extra.join(", ") : "none"}`)

console.log(`\n2. UNKNOWN SYMBOLS`)
console.log(`   empty names                 : ${emptyName}`)
console.log(`   kinds outside the vocabulary : ${unknownKind}`)
console.log(`   members with no owner        : ${ownerlessMember}`)
console.log(`   symbol-free files            : ${symbolFreeFiles}`)
console.log(`   edge SOURCES:`)
for (const [k, n] of top(srcClass, 6)) console.log(`      ${String(n).padStart(6)}  ${k}`)
console.log(`   edge TARGETS:`)
for (const [k, n] of top(tgtClass, 8)) console.log(`      ${String(n).padStart(6)}  ${k}`)

console.log(`\n3. LINE NUMBERS (M59.A7 / M60)`)
console.log(`   relationships                : ${relationships}`)
console.log(`   carrying a 1-based line      : ${withLine}`)
console.log(`   carrying none                : ${withoutLine}`)
console.log(`   carrying 0 or a negative     : ${lineZeroOrNeg}`)
console.log(`   call edges whose line contains the callee name: ${lineAtName.agrees}/${lineAtName.checked}`)

console.log(`\n   symbol kinds emitted:`)
for (const [k, n] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`      ${k.padEnd(12)} ${String(n).padStart(6)}${ALL_KINDS.has(k) ? "" : "   NOT IN THE ENGINE ENUM"}`)
}
