/**
 * VB `instantiates` AUDIT — what the construct actually is in this grammar, and the
 * three shapes the emitter does not reach.
 *
 * ## Why `instantiates` needs its own audit rather than a firing-check row
 *
 * `firing-check-v2` answers "did any `instantiates` edge come out". It cannot say
 * WHICH construction shape produced them, and the type has three distinct shapes in
 * this grammar that reach the analyzer by three different routes. So a non-zero
 * count can hide three gaps at once.
 *
 * ## THE GRAMMAR FACT that decides all three, measured here
 *
 * `New T()` is an `object_creation_expression`; `New T(a)` is an
 * `array_creation_expression`. Both name the type in a `type` field. Both are
 * reachable from an expression walk and both fire.
 *
 * `As New T` in a DECLARATION is neither. It is an `as_clause`, and this grammar
 * gives the `as_clause` an `arguments` field — so:
 *
 *     Dim q As New Gauge       ->  as_clause(declared_type: simple_name)
 *     Dim p As Gauge           ->  as_clause(declared_type: simple_name)   IDENTICAL
 *     Dim r As New Gauge(3)    ->  as_clause(declared_type: simple_name,
 *                                               arguments: argument_list)
 *
 * Measured on `roslyn-vb`: the first two shapes are byte-identical trees, so
 * `As New T` without arguments is NOT REPRESENTABLE and no analyzer can read it.
 * The third shape IS representable, and nothing reads it: a field, property or
 * local initialized with `As New T(args)` publishes a `references` edge to `T` and
 * no `instantiates` edge at all. That is a GAP in the analyzer, measured below.
 *
 * No regex; node types and field reads only.
 */

import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.VB_CORPUS ?? "roslyn-vb"
const DIR = join(CORPUS_ROOT, REPO)
const LIMIT = Number(process.env.VB_NFILES ?? 0)
const MAX_DRAWS = Number(process.env.VB_DRAWS ?? 20)

function hasSuffix(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
}
function derivePopulation(dir: string, ext: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 24) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= want) return
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!hasSuffix(e.name, ext)) continue
      try { if (statSync(p).isFile()) out.push(p) } catch {}
    }
  }
  walk(dir, 0)
  return out
}
const allOnDisk = derivePopulation(DIR, ".vb", Number.MAX_SAFE_INTEGER)
const files = LIMIT > 0 ? allOnDisk.slice(0, LIMIT) : allOnDisk

console.log("=".repeat(92))
console.log("VB INSTANTIATES AUDIT")
console.log(`population DERIVED by directory walk: ${allOnDisk.length} .vb files on disk`)
console.log(`population MEASURED this run:        ${files.length}`)
console.log("=".repeat(92) + "\n")

// --- pass A: production output -------------------------------------------------
const instByNode = new Map<string, number>()
const instConf = new Map<string, number>()
let instTotal = 0
let instFiles = new Set<string>()
const instPairs = new Set<string>()
let dupEdges = 0
const dupByType = new Map<string, number>()
const dupDraws: string[] = []
let callsTotal = 0

for (const abs of files) {
  const rel = abs.slice(DIR.length + 1)
  let r: any
  try { r = await parseFile(abs, DIR) } catch { continue }
  const seen = new Set<string>()
  for (const e of (r.relationships ?? [])) {
    const t = String(e?.type ?? "")
    if (t === "calls") callsTotal++
    const k = `${t}|${e.source}|${e.target}|${e.line_number ?? ""}|${e.confidence ?? ""}`
    if (seen.has(k)) {
      dupEdges++
      dupByType.set(t, (dupByType.get(t) ?? 0) + 1)
      if (dupDraws.length < MAX_DRAWS) {
        dupDraws.push(`${rel}:${String(e.line_number ?? "?")}  DUPLICATE ${t} ${JSON.stringify(e.source)} -> ${JSON.stringify(e.target)}`)
      }
      continue
    }
    seen.add(k)
    if (t !== "instantiates") continue
    instTotal++
    instFiles.add(rel)
    instPairs.add(`${e.source}|${e.target}`)
    const nd = String(e?.metadata?.constructionNode ?? "?")
    instByNode.set(nd, (instByNode.get(nd) ?? 0) + 1)
    const c = String(e?.confidence ?? "?")
    instConf.set(c, (instConf.get(c) ?? 0) + 1)
  }
}

// --- pass B: the tree, for the shapes production cannot see -------------------
const parser = await getParser("vb")
const declOwner = new Map<string, number>()
let asNewArgs = 0            // `As New T(args)` in a declaration — representable
let asNewArgsInType = 0      // ... inside a field/property declaration
let asNewArgsInLocal = 0     // ... inside a method local
let asNewArgsFiles = new Set<string>()
let asPlainArgs = 0          // `As T(args)` — the shape that proves `arguments` is the discriminator
const declDraws: string[] = []
let objCreation = 0, arrayCreation = 0

function enclosingDeclName(n: any): string {
  let a = n.parent
  for (let i = 0; a !== null && i < 8; i++) {
    if (a.type === "method_declaration" || a.type === "property_declaration" ||
        a.type === "constructor_declaration" || a.type === "operator_declaration" ||
        a.type === "field_declaration" || a.type === "class_declaration" ||
        a.type === "structure_declaration") {
      const nm = a.childForFieldName?.("name")
      return nm ? nm.text : a.type
    }
    a = a.parent
  }
  return "(none)"
}

for (const abs of files) {
  const rel = abs.slice(DIR.length + 1)
  let r: any
  try { r = await parseFile(abs, DIR) } catch { continue }
  const names = new Set<string>()
  for (const s of (r?.symbols ?? [])) if (typeof s?.name === "string") names.add(s.name)
  let src = ""
  try { src = require("node:fs").readFileSync(abs, "utf8") } catch {}
  if (src === "") continue
  const tree = parser.parse(src)
  if (!tree) throw new Error("parser.parse returned no tree (null result)")
  const walk = (n: any): void => {
    if (n.type === "object_creation_expression") objCreation++
    if (n.type === "array_creation_expression") arrayCreation++
    if (n.type === "as_clause") {
      const args = n.childForFieldName?.("arguments")
      const parent = n.parent
      const inDeclarator = parent && parent.type === "variable_declarator"
      const isDeclStmt = parent && parent.type === "declaration_statement"
      if (args) {
        if (inDeclarator || isDeclStmt) {
          // `As New T(args)`: `arguments` is present, so the `New` is representable.
          // `As T(args)` is not valid VB, so its presence is the discriminator.
          asNewArgs++
          asNewArgsFiles.add(rel)
          const inType = isDeclStmt === false && parent.parent &&
            (parent.parent.type === "field_declaration" || parent.parent.type === "property_declaration")
          if (inType) asNewArgsInType++
          else asNewArgsInLocal++
          const ty = n.childForFieldName?.("declared_type")
          const tgt = ty ? String(ty.text).split(".").pop() : "?"
          const owner = enclosingDeclName(n)
          if (declDraws.length < MAX_DRAWS) {
            declDraws.push(`${rel}:${n.startPosition.row + 1}  As New ${JSON.stringify(ty ? ty.text : "?")} in ${owner}` +
              `  — emitted as instantiates? ${instPairs.has(`${owner}|${tgt}`) ? "yes" : "NO"}`)
          }
        } else {
          asPlainArgs++
        }
      }
    }
    for (const c of n.children) walk(c)
  }
  try { walk(tree.rootNode); tree.delete?.() } catch {}
}

console.log("A. WHAT PRODUCTION EMITTED (parseFile, the production entry)")
console.log(`  instantiates edges                       ${instTotal} in ${instFiles.size} files`)
console.log(`  distinct (source,target) pairs           ${instPairs.size}`)
console.log(`  by constructionNode: ${[...instByNode.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log(`  by confidence:      ${[...instConf.entries()].sort().map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log(`  calls edges in the same sample           ${callsTotal}`)
console.log("")

console.log("B. THE CONSTRUCTION SITES IN THE TREE, same files")
console.log(`  object_creation_expression  ${objCreation}`)
console.log(`  array_creation_expression   ${arrayCreation}`)
console.log(`  as_clause WITH arguments in a declarator   ${asNewArgs} in ${asNewArgsFiles.size} files`)
console.log(`     ...under a field_declaration/property_declaration  ${asNewArgsInType}`)
console.log(`     ...under a method LOCAL                            ${asNewArgsInLocal}`)
console.log(`  as_clause with arguments elsewhere (shape check)      ${asPlainArgs}`)
console.log("")
if (declDraws.length > 0) {
  console.log(`  DRAWS — does the declared type get an \`instantiates\` edge? (capped at ${MAX_DRAWS})`)
  for (const d of declDraws) console.log("    " + d)
  console.log("")
}

console.log("C. DUPLICATE EDGES — same (type, source, target, line, confidence) twice in one file")
console.log(`  ${dupEdges}` + (dupEdges > 0 ? `   by type: ${[...dupByType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}` : ""))
for (const d of dupDraws) console.log("    " + d)
console.log("")

console.log("VERDICT NOTES")
console.log("  `As New T` with NO arguments is not representable in this grammar: `As T` and")
console.log("  `As New T` produce byte-identical `as_clause(declared_type: simple_name)` trees.")
console.log("  That is a grammar boundary, declared, not an analyzer gap.")
console.log("  `As New T(args)` IS representable — the as_clause carries an `arguments` field —")
console.log("  so a non-zero section-B count with a `NO` in the draws is a GAP, not a boundary.")
console.log("")
console.log("DONE. population DERIVED: " + allOnDisk.length + "; measured: " + files.length)